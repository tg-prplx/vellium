import { Router } from "express";
import { db, newId, now, DEFAULT_SETTINGS, isLocalhostUrl } from "../db.js";
import { normalizeLoreBookEntries, parseSillyTavernWorldInfo } from "../domain/lorebooks.js";
import { buildKoboldGenerateBody, extractKoboldGeneratedText, normalizeProviderType, requestKoboldGenerate } from "../services/providerApi.js";
import { buildKoboldSamplerConfig, buildOpenAiSamplingPayload, normalizeApiParamPolicy } from "../services/apiParamPolicy.js";

const router = Router();

interface LoreBookRow {
  id: string;
  name: string;
  description: string | null;
  entries_json: string;
  source_character_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ProviderRow {
  id: string;
  base_url: string;
  api_key_cipher: string;
  full_local_only: number;
  provider_type: string;
}

const KOBOLD_TAGS = {
  systemOpen: "{{[SYSTEM]}}",
  systemClose: "{{[SYSTEM_END]}}",
  inputOpen: "{{[INPUT]}}",
  inputClose: "{{[INPUT_END]}}",
  outputOpen: "{{[OUTPUT]}}"
} as const;

function getSettings() {
  try {
    const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
    const stored = row ? JSON.parse(row.payload) as Record<string, unknown> : {};
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      samplerConfig: {
        ...(DEFAULT_SETTINGS.samplerConfig as Record<string, unknown>),
        ...((stored.samplerConfig as Record<string, unknown>) || {})
      },
      apiParamPolicy: normalizeApiParamPolicy(stored.apiParamPolicy)
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function normalizeOpenAiBaseUrl(raw: string): string {
  const trimmed = String(raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

async function completeProviderOnce(params: {
  provider: ProviderRow;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  apiParamPolicy?: unknown;
}): Promise<string> {
  const providerType = normalizeProviderType(params.provider.provider_type);

  if (providerType === "koboldcpp") {
    const koboldSamplerConfig = buildKoboldSamplerConfig({
      samplerConfig: {
        temperature: 0.2,
        maxTokens: 512
      },
      apiParamPolicy: params.apiParamPolicy
    });
    const memory = params.systemPrompt.trim()
      ? `${KOBOLD_TAGS.systemOpen}\n${params.systemPrompt.trim()}\n${KOBOLD_TAGS.systemClose}`
      : "";
    const body = buildKoboldGenerateBody({
      prompt: `${KOBOLD_TAGS.inputOpen}\n${params.userPrompt}\n${KOBOLD_TAGS.inputClose}\n\n${KOBOLD_TAGS.outputOpen}`,
      memory,
      samplerConfig: koboldSamplerConfig,
      includeMemory: true
    });
    const response = await requestKoboldGenerate(params.provider, body);
    if (!response.ok) return "";
    const parsed = await response.json().catch(() => ({}));
    return extractKoboldGeneratedText(parsed).trim();
  }

  const baseUrl = normalizeOpenAiBaseUrl(params.provider.base_url);
  if (!baseUrl) return "";
  const openAiSampling = buildOpenAiSamplingPayload({
    samplerConfig: {
      temperature: 0.2,
      maxTokens: 512
    },
    apiParamPolicy: params.apiParamPolicy,
    fields: ["temperature", "maxTokens"],
    defaults: {
      temperature: 0.2,
      maxTokens: 512
    }
  });
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.provider.api_key_cipher}`
    },
    body: JSON.stringify({
      model: params.modelId,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt }
      ],
      ...openAiSampling
    })
  });
  if (!response.ok) return "";
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content?.trim() ?? "";
}

async function translateLoreKey(params: {
  value: string;
  targetLanguage: string;
  provider: ProviderRow;
  modelId: string;
  apiParamPolicy?: unknown;
}): Promise<string> {
  const value = String(params.value || "").trim();
  if (!value) return "";
  if (!/\p{L}/u.test(value)) return value;
  const translated = await completeProviderOnce({
    provider: params.provider,
    modelId: params.modelId,
    apiParamPolicy: params.apiParamPolicy,
    systemPrompt: [
      `Translate this lorebook trigger phrase to ${params.targetLanguage}.`,
      "Output ONLY the translated trigger phrase.",
      "Do not explain anything.",
      "Preserve punctuation if present."
    ].join(" "),
    userPrompt: value
  });
  return String(translated || "").trim() || value;
}

function rowToJson(row: LoreBookRow) {
  let entries = normalizeLoreBookEntries([]);
  try {
    entries = normalizeLoreBookEntries(JSON.parse(row.entries_json || "[]"));
  } catch {
    entries = [];
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    entries,
    sourceCharacterId: row.source_character_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

router.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM lorebooks ORDER BY updated_at DESC, created_at DESC").all() as LoreBookRow[];
  res.json(rows.map(rowToJson));
});

router.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM lorebooks WHERE id = ?").get(req.params.id) as LoreBookRow | undefined;
  if (!row) {
    res.status(404).json({ error: "LoreBook not found" });
    return;
  }
  res.json(rowToJson(row));
});

router.post("/", (req, res) => {
  const id = newId();
  const ts = now();
  const name = String(req.body?.name || "").trim() || "New LoreBook";
  const description = String(req.body?.description || "").trim();
  const entries = normalizeLoreBookEntries(req.body?.entries);
  const sourceCharacterId = req.body?.sourceCharacterId ? String(req.body.sourceCharacterId) : null;

  db.prepare(
    "INSERT INTO lorebooks (id, name, description, entries_json, source_character_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, name, description, JSON.stringify(entries), sourceCharacterId, ts, ts);

  const row = db.prepare("SELECT * FROM lorebooks WHERE id = ?").get(id) as LoreBookRow;
  res.json(rowToJson(row));
});

router.post("/import/world-info", (req, res) => {
  const parsed = parseSillyTavernWorldInfo(req.body?.data);
  if (!parsed) {
    res.status(400).json({ error: "Invalid SillyTavern World Info JSON" });
    return;
  }

  const id = newId();
  const ts = now();
  db.prepare(
    "INSERT INTO lorebooks (id, name, description, entries_json, source_character_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, parsed.name, parsed.description, JSON.stringify(parsed.entries), null, ts, ts);

  const row = db.prepare("SELECT * FROM lorebooks WHERE id = ?").get(id) as LoreBookRow;
  res.json(rowToJson(row));
});

router.post("/:id/translate-copy", async (req, res) => {
  const sourceId = req.params.id;
  const source = db.prepare("SELECT * FROM lorebooks WHERE id = ?").get(sourceId) as LoreBookRow | undefined;
  if (!source) {
    res.status(404).json({ error: "LoreBook not found" });
    return;
  }

  const settings = getSettings();
  const providerId = String(
    (settings.translateProviderId as string | null)
    || (settings.activeProviderId as string | null)
    || ""
  ).trim();
  let modelId = String(
    (settings.translateModel as string | null)
    || (settings.activeModel as string | null)
    || ""
  ).trim();
  if (settings.translateProviderId && !settings.translateModel && settings.translateProviderId !== settings.activeProviderId) {
    modelId = "";
  }

  if (!providerId || !modelId) {
    res.status(400).json({ error: "Translate provider/model is not configured in Settings." });
    return;
  }

  const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId) as ProviderRow | undefined;
  if (!provider) {
    res.status(400).json({ error: "Translate provider not found." });
    return;
  }
  if (settings.fullLocalMode === true && !isLocalhostUrl(provider.base_url)) {
    res.status(400).json({ error: "Provider blocked by Full Local Mode." });
    return;
  }
  if (provider.full_local_only && !isLocalhostUrl(provider.base_url)) {
    res.status(400).json({ error: "Provider requires localhost endpoint." });
    return;
  }

  const targetLanguage = String(req.body?.targetLanguage || settings.translateLanguage || settings.responseLanguage || "English").trim() || "English";
  const parsedSource = rowToJson(source);

  try {
    const translatedEntries = [];
    for (const entry of parsedSource.entries) {
      const translatedKeys = await Promise.all(entry.keys.map((key) => translateLoreKey({
        value: key,
        targetLanguage,
        provider,
        modelId,
        apiParamPolicy: settings.apiParamPolicy
      })));
      const translatedSecondaryKeys = await Promise.all((entry.secondaryKeys || []).map((key) => translateLoreKey({
        value: key,
        targetLanguage,
        provider,
        modelId,
        apiParamPolicy: settings.apiParamPolicy
      })));
      translatedEntries.push({
        ...entry,
        keys: translatedKeys,
        secondaryKeys: translatedSecondaryKeys
      });
    }

    const translatedId = newId();
    const suffix = ` (${targetLanguage})`;
    const nextName = parsedSource.name.endsWith(suffix) ? parsedSource.name : `${parsedSource.name}${suffix}`;
    const ts = now();
    db.prepare(
      "INSERT INTO lorebooks (id, name, description, entries_json, source_character_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      translatedId,
      nextName,
      parsedSource.description,
      JSON.stringify(translatedEntries),
      parsedSource.sourceCharacterId || null,
      ts,
      ts
    );

    const row = db.prepare("SELECT * FROM lorebooks WHERE id = ?").get(translatedId) as LoreBookRow;
    res.json(rowToJson(row));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "LoreBook translation failed" });
  }
});

router.put("/:id", (req, res) => {
  const id = req.params.id;
  const existing = db.prepare("SELECT * FROM lorebooks WHERE id = ?").get(id) as LoreBookRow | undefined;
  if (!existing) {
    res.status(404).json({ error: "LoreBook not found" });
    return;
  }

  const parsedExistingEntries = (() => {
    try {
      return normalizeLoreBookEntries(JSON.parse(existing.entries_json || "[]"));
    } catch {
      return [];
    }
  })();

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : existing.name;
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : (existing.description || "");
  const entries = req.body?.entries !== undefined
    ? normalizeLoreBookEntries(req.body.entries)
    : parsedExistingEntries;

  const nextName = name || existing.name;
  const sourceCharacterId = req.body?.sourceCharacterId === undefined
    ? existing.source_character_id
    : (req.body.sourceCharacterId ? String(req.body.sourceCharacterId) : null);

  db.prepare(
    "UPDATE lorebooks SET name = ?, description = ?, entries_json = ?, source_character_id = ?, updated_at = ? WHERE id = ?"
  ).run(nextName, description, JSON.stringify(entries), sourceCharacterId, now(), id);

  const row = db.prepare("SELECT * FROM lorebooks WHERE id = ?").get(id) as LoreBookRow;
  res.json(rowToJson(row));
});

router.delete("/:id", (req, res) => {
  const id = req.params.id;
  db.prepare("UPDATE chats SET lorebook_id = NULL WHERE lorebook_id = ?").run(id);
  const chatRows = db.prepare("SELECT id, lorebook_id, lorebook_ids FROM chats").all() as Array<{ id: string; lorebook_id: string | null; lorebook_ids: string | null }>;
  for (const chat of chatRows) {
    let lorebookIds: string[] = [];
    try {
      lorebookIds = Array.isArray(JSON.parse(chat.lorebook_ids || "[]")) ? JSON.parse(chat.lorebook_ids || "[]") : [];
    } catch {
      lorebookIds = [];
    }
    const filtered = lorebookIds.filter((entryId) => entryId !== id);
    if (filtered.length === lorebookIds.length) continue;
    db.prepare("UPDATE chats SET lorebook_id = ?, lorebook_ids = ? WHERE id = ?").run(filtered[0] || null, JSON.stringify(filtered), chat.id);
  }
  db.prepare("UPDATE characters SET lorebook_id = NULL WHERE lorebook_id = ?").run(id);
  db.prepare("DELETE FROM lorebooks WHERE id = ?").run(id);
  res.json({ ok: true });
});

export default router;
