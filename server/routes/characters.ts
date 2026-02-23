import { Router } from "express";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { db, newId, now, AVATARS_DIR, DEFAULT_SETTINGS, isLocalhostUrl } from "../db.js";
import { parseCharacterLoreBook } from "../domain/lorebooks.js";
import { buildOpenAiSamplingPayload, buildKoboldSamplerConfig, normalizeApiParamPolicy } from "../services/apiParamPolicy.js";
import { buildKoboldGenerateBody, extractKoboldGeneratedText, normalizeProviderType, requestKoboldGenerate } from "../services/providerApi.js";

const router = Router();

interface CharacterRow {
  id: string;
  name: string;
  card_json: string;
  lorebook_id: string | null;
  avatar_path: string | null;
  tags: string | null;
  greeting: string | null;
  system_prompt: string | null;
  description: string | null;
  personality: string | null;
  scenario: string | null;
  mes_example: string | null;
  creator_notes: string | null;
  created_at: string;
}

interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  api_key_cipher: string;
  provider_type: string | null;
  full_local_only: number;
}

const KOBOLD_TAGS = {
  systemOpen: "{{[SYSTEM]}}",
  systemClose: "{{[SYSTEM_END]}}",
  inputOpen: "{{[INPUT]}}",
  inputClose: "{{[INPUT_END]}}",
  outputOpen: "{{[OUTPUT]}}"
};

function parseCardData(cardJson: string | null | undefined): Record<string, unknown> {
  if (!cardJson) return {};
  try {
    const parsed = JSON.parse(cardJson) as { data?: unknown };
    if (parsed?.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)) {
      return parsed.data as Record<string, unknown>;
    }
  } catch {
    // Ignore invalid JSON payloads.
  }
  return {};
}

function parseString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeOpenAiBaseUrl(raw: string): string {
  const trimmed = String(raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function getSettings(): Record<string, unknown> {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    const stored = JSON.parse(row.payload) as Record<string, unknown>;
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

async function completeProviderOnce(params: {
  provider: ProviderRow;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  samplerConfig?: Record<string, unknown>;
  apiParamPolicy?: unknown;
}): Promise<string> {
  const providerType = normalizeProviderType(params.provider.provider_type);
  const sc = params.samplerConfig || {};

  if (providerType === "koboldcpp") {
    const koboldSamplerConfig = buildKoboldSamplerConfig({
      samplerConfig: {
        ...sc,
        maxTokens: sc.maxTokens ?? 2048
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
    samplerConfig: sc,
    apiParamPolicy: params.apiParamPolicy,
    fields: ["temperature", "maxTokens"],
    defaults: {
      temperature: 0.2,
      maxTokens: 2048
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

async function translateCharacterField(params: {
  value: string;
  targetLanguage: string;
  provider: ProviderRow;
  modelId: string;
  apiParamPolicy?: unknown;
}): Promise<string> {
  const raw = String(params.value || "");
  if (!raw.trim()) return raw;
  const normalized = raw.replace(/\r\n/g, "\n");
  const protectedPattern = /\{\{[^{}]+\}\}/g;
  const textWithoutProtected = normalized.replace(protectedPattern, "").trim();
  if (!/\p{L}/u.test(textWithoutProtected)) {
    return raw;
  }
  const maxChunkChars = 2200;
  const chunkBySize = (text: string): string[] => {
    if (text.length <= maxChunkChars) return [text];
    const chunks: string[] = [];
    let cursor = 0;
    while (cursor < text.length) {
      let end = Math.min(cursor + maxChunkChars, text.length);
      if (end < text.length) {
        const nextBreak = text.lastIndexOf("\n\n", end);
        if (nextBreak > cursor + 300) end = nextBreak + 2;
      }
      chunks.push(text.slice(cursor, end));
      cursor = end;
    }
    return chunks;
  };

  const chunks = chunkBySize(normalized);
  const translatedChunks: string[] = [];

  for (const chunk of chunks) {
    const protectedParts: string[] = [];
    const protectedChunk = chunk.replace(protectedPattern, (match) => {
      const token = `[[[KEEP_${protectedParts.length}]]]`;
      protectedParts.push(match);
      return token;
    });

    let translatedChunk = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      translatedChunk = await completeProviderOnce({
        provider: params.provider,
        modelId: params.modelId,
        systemPrompt: [
          `Translate this character card field to ${params.targetLanguage}.`,
          "Output ONLY the translated text.",
          "Do NOT modify placeholder markers like [[[KEEP_0]]].",
          "Preserve placeholders, markdown, line breaks, and XML-like tags exactly as-is."
        ].join(" "),
        userPrompt: protectedChunk,
        samplerConfig: {
          temperature: 0.2,
          maxTokens: Math.max(800, Math.min(3072, Math.round(chunk.length * 1.2)))
        },
        apiParamPolicy: params.apiParamPolicy
      });
      if (String(translatedChunk || "").trim()) break;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }

    let restored = String(translatedChunk || "");
    let missingToken = false;
    for (let i = 0; i < protectedParts.length; i += 1) {
      const token = `[[[KEEP_${i}]]]`;
      if (!restored.includes(token)) {
        missingToken = true;
        break;
      }
      restored = restored.split(token).join(protectedParts[i]);
    }

    if (!restored.trim() || missingToken) {
      translatedChunks.push(chunk);
      continue;
    }
    translatedChunks.push(restored);
  }

  return translatedChunks.join("");
}

function characterToJson(row: CharacterRow) {
  const cardData = parseCardData(row.card_json);
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_path ? (row.avatar_path.startsWith("http") ? row.avatar_path : `/api/avatars/${row.avatar_path}`) : null,
    lorebookId: row.lorebook_id || null,
    tags: JSON.parse(row.tags || "[]") as string[],
    greeting: row.greeting || "",
    systemPrompt: row.system_prompt || "",
    description: row.description || "",
    personality: row.personality || "",
    scenario: row.scenario || "",
    mesExample: row.mes_example || "",
    creatorNotes: row.creator_notes || "",
    alternateGreetings: parseStringArray(cardData.alternate_greetings),
    postHistoryInstructions: parseString(cardData.post_history_instructions),
    creator: parseString(cardData.creator),
    characterVersion: parseString(cardData.character_version),
    creatorNotesMultilingual: parseRecord(cardData.creator_notes_multilingual),
    extensions: parseRecord(cardData.extensions),
    cardJson: row.card_json,
    createdAt: row.created_at
  };
}

// List all characters
router.get("/", (_req, res) => {
  const rows = db.prepare(
    "SELECT * FROM characters ORDER BY created_at DESC"
  ).all() as CharacterRow[];
  res.json(rows.map(characterToJson));
});

// Validate chara_card_v2 JSON
router.post("/validate", (req, res) => {
  const { rawJson } = req.body;
  try {
    const parsed = JSON.parse(rawJson) as { spec?: string; data?: Record<string, unknown> };
    const errors: string[] = [];
    if (parsed.spec !== "chara_card_v2") errors.push("spec must be chara_card_v2");
    if (!parsed.data) errors.push("missing data object");
    if (parsed.data && !parsed.data.name) errors.push("missing data.name");
    res.json({ valid: errors.length === 0, errors });
  } catch (e) {
    res.json({ valid: false, errors: [String(e)] });
  }
});

// Import character from chara_card_v2 JSON
router.post("/import", (req, res) => {
  const { rawJson } = req.body;
  try {
    const parsed = JSON.parse(rawJson) as { spec?: string; spec_version?: string; data?: Record<string, unknown> };
    if (parsed.spec !== "chara_card_v2") {
      res.status(400).json({ error: "Invalid spec — expected chara_card_v2" });
      return;
    }

    const data = (parsed.data || {}) as Record<string, unknown>;
    const id = newId();
    const name = String(data.name || "Unnamed").trim() || "Unnamed";
    const tags = JSON.stringify(Array.isArray(data.tags) ? data.tags : []);
    const greeting = String(data.first_mes || "");
    const systemPrompt = String(data.system_prompt || "");
    const description = String(data.description || "");
    const personality = String(data.personality || "");
    const scenario = String(data.scenario || "");
    const mesExample = String(data.mes_example || "");
    const creatorNotes = String(data.creator_notes || "");
    const avatarPath = data.avatar ? String(data.avatar) : null;
    const ts = now();

    const parsedLorebook = parseCharacterLoreBook(data);
    let lorebookId: string | null = null;

    const importTx = db.transaction(() => {
      if (parsedLorebook) {
        lorebookId = newId();
        db.prepare(
          "INSERT INTO lorebooks (id, name, description, entries_json, source_character_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(
          lorebookId,
          parsedLorebook.name,
          parsedLorebook.description,
          JSON.stringify(parsedLorebook.entries),
          id,
          ts,
          ts
        );
      }

      db.prepare(
        `INSERT INTO characters (id, name, card_json, lorebook_id, avatar_path, tags, greeting, system_prompt, description, personality, scenario, mes_example, creator_notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        name,
        rawJson,
        lorebookId,
        avatarPath,
        tags,
        greeting,
        systemPrompt,
        description,
        personality,
        scenario,
        mesExample,
        creatorNotes,
        ts
      );
    });

    importTx();

    const row = db.prepare("SELECT * FROM characters WHERE id = ?").get(id) as CharacterRow;
    res.json(characterToJson(row));
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Get character by ID
router.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM characters WHERE id = ?").get(req.params.id) as CharacterRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Character not found" });
    return;
  }
  res.json(characterToJson(row));
});

// Update character
router.put("/:id", (req, res) => {
  const id = req.params.id;
  const {
    name,
    description,
    personality,
    scenario,
    greeting,
    systemPrompt,
    tags,
    mesExample,
    creatorNotes,
    alternateGreetings,
    postHistoryInstructions,
    creator,
    characterVersion,
    creatorNotesMultilingual,
    extensions
  } = req.body;

  const existing = db.prepare("SELECT * FROM characters WHERE id = ?").get(id) as CharacterRow | undefined;
  if (!existing) {
    res.status(404).json({ error: "Character not found" });
    return;
  }

  // Rebuild card_json from form fields
  let cardData: Record<string, unknown>;
  try {
    const parsed = JSON.parse(existing.card_json);
    cardData = parsed.data || {};
  } catch {
    cardData = {};
  }

  cardData.name = name ?? existing.name;
  cardData.description = description ?? existing.description;
  cardData.personality = personality ?? existing.personality;
  cardData.scenario = scenario ?? existing.scenario;
  cardData.first_mes = greeting ?? existing.greeting;
  cardData.system_prompt = systemPrompt ?? existing.system_prompt;
  cardData.tags = tags ?? JSON.parse(existing.tags || "[]");
  cardData.mes_example = mesExample ?? existing.mes_example;
  cardData.creator_notes = creatorNotes ?? existing.creator_notes;
  if (alternateGreetings !== undefined) {
    cardData.alternate_greetings = parseStringArray(alternateGreetings);
  }
  if (postHistoryInstructions !== undefined) {
    cardData.post_history_instructions = parseString(postHistoryInstructions);
  }
  if (creator !== undefined) {
    cardData.creator = parseString(creator);
  }
  if (characterVersion !== undefined) {
    cardData.character_version = parseString(characterVersion);
  }
  if (creatorNotesMultilingual !== undefined) {
    cardData.creator_notes_multilingual = parseRecord(creatorNotesMultilingual);
  }
  if (extensions !== undefined) {
    cardData.extensions = parseRecord(extensions);
  }

  const cardJson = JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: cardData }, null, 2);
  const nextName = String(cardData.name || existing.name || "Unnamed").trim() || "Unnamed";
  const nextDescription = String(cardData.description || "");
  const nextPersonality = String(cardData.personality || "");
  const nextScenario = String(cardData.scenario || "");
  const nextGreeting = String(cardData.first_mes || "");
  const nextSystemPrompt = String(cardData.system_prompt || "");
  const nextTags = JSON.stringify(Array.isArray(cardData.tags) ? cardData.tags : []);
  const nextMesExample = String(cardData.mes_example || "");
  const nextCreatorNotes = String(cardData.creator_notes || "");

  db.prepare(
    `UPDATE characters SET name = ?, description = ?, personality = ?, scenario = ?, greeting = ?,
     system_prompt = ?, tags = ?, mes_example = ?, creator_notes = ?, card_json = ? WHERE id = ?`
  ).run(
    nextName,
    nextDescription,
    nextPersonality,
    nextScenario,
    nextGreeting,
    nextSystemPrompt,
    nextTags,
    nextMesExample,
    nextCreatorNotes,
    cardJson,
    id
  );

  const row = db.prepare("SELECT * FROM characters WHERE id = ?").get(id) as CharacterRow;
  res.json(characterToJson(row));
});

// Create translated character copy
router.post("/:id/translate-copy", async (req, res) => {
  const sourceId = req.params.id;
  const source = db.prepare("SELECT * FROM characters WHERE id = ?").get(sourceId) as CharacterRow | undefined;
  if (!source) {
    res.status(404).json({ error: "Character not found" });
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
  const sourceCardData = parseCardData(source.card_json);
  const originalName = String(sourceCardData.name || source.name || "Unnamed").trim() || "Unnamed";

  try {
    const translate = (value: string) => translateCharacterField({
      value,
      targetLanguage,
      provider,
      modelId,
      apiParamPolicy: settings.apiParamPolicy
    });

    const translatedName = await translate(originalName);
    const translatedDescription = await translate(String(sourceCardData.description || source.description || ""));
    const translatedPersonality = await translate(String(sourceCardData.personality || source.personality || ""));
    const translatedScenario = await translate(String(sourceCardData.scenario || source.scenario || ""));
    const translatedGreeting = await translate(String(sourceCardData.first_mes || source.greeting || ""));
    const translatedSystemPrompt = await translate(String(sourceCardData.system_prompt || source.system_prompt || ""));
    const translatedMesExample = await translate(String(sourceCardData.mes_example || source.mes_example || ""));
    const translatedPostHistoryInstructions = await translate(parseString(sourceCardData.post_history_instructions));
    const translatedAlternateGreetings: string[] = [];
    for (const greeting of parseStringArray(sourceCardData.alternate_greetings)) {
      translatedAlternateGreetings.push(await translate(greeting));
    }

    const suffix = ` (${targetLanguage})`;
    const translatedBaseName = String(translatedName || originalName).trim() || originalName;
    const finalName = translatedBaseName.endsWith(suffix) ? translatedBaseName : `${translatedBaseName}${suffix}`;

    const translatedCardData: Record<string, unknown> = {
      ...sourceCardData,
      name: finalName,
      description: translatedDescription,
      personality: translatedPersonality,
      scenario: translatedScenario,
      first_mes: translatedGreeting,
      system_prompt: translatedSystemPrompt,
      mes_example: translatedMesExample,
      post_history_instructions: translatedPostHistoryInstructions,
      alternate_greetings: translatedAlternateGreetings
    };

    const translatedCardJson = JSON.stringify({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: translatedCardData
    }, null, 2);

    let sourceTags: unknown[] = [];
    try {
      const parsedTags = JSON.parse(source.tags || "[]");
      sourceTags = Array.isArray(parsedTags) ? parsedTags : [];
    } catch {
      sourceTags = [];
    }
    const translatedTags = JSON.stringify(Array.isArray(translatedCardData.tags) ? translatedCardData.tags : sourceTags);
    const translatedCreatorNotes = String(translatedCardData.creator_notes || source.creator_notes || "");
    const translatedId = newId();
    const ts = now();

    db.prepare(
      `INSERT INTO characters (id, name, card_json, lorebook_id, avatar_path, tags, greeting, system_prompt, description, personality, scenario, mes_example, creator_notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      translatedId,
      finalName,
      translatedCardJson,
      source.lorebook_id,
      source.avatar_path,
      translatedTags,
      translatedGreeting,
      translatedSystemPrompt,
      translatedDescription,
      translatedPersonality,
      translatedScenario,
      translatedMesExample,
      translatedCreatorNotes,
      ts
    );

    const copied = db.prepare("SELECT * FROM characters WHERE id = ?").get(translatedId) as CharacterRow;
    res.json(characterToJson(copied));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Upload avatar
router.post("/:id/avatar", (req, res) => {
  const { base64Data, filename } = req.body;
  const existing = db.prepare("SELECT avatar_path FROM characters WHERE id = ?").get(req.params.id) as { avatar_path: string | null } | undefined;
  if (!existing) {
    res.status(404).json({ error: "Character not found" });
    return;
  }

  const rawExt = String((filename || "avatar.png").split(".").pop() || "png").toLowerCase();
  const safeExt = rawExt.replace(/[^a-z0-9]/g, "") || "png";
  const avatarFilename = `${req.params.id}-${Date.now()}.${safeExt}`;
  const filePath = join(AVATARS_DIR, avatarFilename);

  const buffer = Buffer.from(base64Data, "base64");
  writeFileSync(filePath, buffer);

  const previousAvatar = String(existing.avatar_path || "");
  if (previousAvatar && !previousAvatar.startsWith("http")) {
    const previousPath = join(AVATARS_DIR, previousAvatar);
    try {
      if (existsSync(previousPath) && previousPath !== filePath) {
        unlinkSync(previousPath);
      }
    } catch {
      // Ignore old avatar cleanup errors.
    }
  }

  db.prepare("UPDATE characters SET avatar_path = ? WHERE id = ?").run(avatarFilename, req.params.id);
  res.json({ avatarUrl: `/api/avatars/${avatarFilename}` });
});

// Delete character
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM characters WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
