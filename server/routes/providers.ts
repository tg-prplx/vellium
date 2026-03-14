import { Router } from "express";
import { db, maskApiKey, isLocalhostUrl, DEFAULT_SETTINGS } from "../db.js";
import { fetchCustomAdapterModels, testCustomAdapterConnection } from "../services/customProviderAdapters.js";
import { fetchKoboldModels, normalizeProviderType, testKoboldConnection } from "../services/providerApi.js";
import { normalizeApiParamPolicy } from "../services/apiParamPolicy.js";

const router = Router();

interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  api_key_cipher: string;
  proxy_url: string | null;
  full_local_only: number;
  provider_type: string;
  adapter_id: string | null;
}

function rowToProfile(row: ProviderRow) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKeyMasked: maskApiKey(row.api_key_cipher),
    proxyUrl: row.proxy_url,
    fullLocalOnly: Boolean(row.full_local_only),
    providerType: normalizeProviderType(row.provider_type),
    adapterId: row.adapter_id
  };
}

function getSettings() {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string };
  const stored = JSON.parse(row.payload);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    samplerConfig: { ...DEFAULT_SETTINGS.samplerConfig, ...(stored.samplerConfig ?? {}) },
    apiParamPolicy: normalizeApiParamPolicy(stored.apiParamPolicy),
    promptTemplates: { ...DEFAULT_SETTINGS.promptTemplates, ...(stored.promptTemplates ?? {}) }
  };
}

router.post("/", (req, res) => {
  const { id, name, baseUrl, apiKey, proxyUrl, fullLocalOnly, providerType, adapterId } = req.body;
  const normalizedType = normalizeProviderType(providerType);
  const normalizedAdapterId = normalizedType === "custom" ? String(adapterId || "").trim() : null;

  db.prepare(`
    INSERT INTO providers (id, name, base_url, api_key_cipher, proxy_url, full_local_only, provider_type, adapter_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      base_url = excluded.base_url,
      api_key_cipher = excluded.api_key_cipher,
      proxy_url = excluded.proxy_url,
      full_local_only = excluded.full_local_only,
      provider_type = excluded.provider_type,
      adapter_id = excluded.adapter_id
  `).run(id, name, baseUrl, apiKey || "local-key", proxyUrl || null, fullLocalOnly ? 1 : 0, normalizedType, normalizedAdapterId);

  const row = db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow;
  res.json(rowToProfile(row));
});

router.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM providers ORDER BY name ASC").all() as ProviderRow[];
  res.json(rows.map(rowToProfile));
});

router.get("/:id/models", async (req, res) => {
  const row = db.prepare("SELECT * FROM providers WHERE id = ?").get(req.params.id) as ProviderRow | undefined;
  if (!row) { res.json([]); return; }

  const settings = getSettings();
  if (settings.fullLocalMode && !isLocalhostUrl(row.base_url)) {
    res.status(403).json({ error: "Provider blocked by Full Local Mode" });
    return;
  }
  if (row.full_local_only && !isLocalhostUrl(row.base_url)) {
    res.status(403).json({ error: "Provider is set to Local-only. Disable Local-only for external URLs." });
    return;
  }

  try {
    const providerType = normalizeProviderType(row.provider_type);
    if (providerType === "koboldcpp") {
      const koboldModels = await fetchKoboldModels(row);
      res.json(koboldModels.map((id) => ({ id })));
      return;
    }
    if (providerType === "custom") {
      const customModels = await fetchCustomAdapterModels(row);
      res.json(customModels.map((id) => ({ id })));
      return;
    }

    const response = await fetch(`${row.base_url}/models`, {
      headers: { Authorization: `Bearer ${row.api_key_cipher}` }
    });
    if (!response.ok) { res.json([]); return; }
    const body = await response.json() as { data?: { id: string }[] };
    const models = (body.data ?? []).map((m) => ({ id: m.id }));
    res.json(models);
  } catch {
    res.json([]);
  }
});

router.post("/set-active", (req, res) => {
  const { providerId, modelId } = req.body;
  const settings = getSettings();
  const updated = { ...settings, activeProviderId: providerId, activeModel: modelId };
  db.prepare("UPDATE settings SET payload = ? WHERE id = 1").run(JSON.stringify(updated));
  res.json(updated);
});

router.post("/:id/runtime-config", (req, res) => {
  const row = db.prepare("SELECT * FROM providers WHERE id = ?").get(req.params.id) as ProviderRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }

  const body = req.body as { baseUrl?: unknown; providerType?: unknown; adapterId?: unknown } | undefined;
  const baseUrl = String(body?.baseUrl ?? row.base_url).trim() || row.base_url;
  const providerType = normalizeProviderType(body?.providerType ?? row.provider_type);
  const adapterId = providerType === "custom" ? String(body?.adapterId ?? row.adapter_id ?? "").trim() || null : null;

  db.prepare(`
    UPDATE providers
    SET base_url = ?, provider_type = ?, adapter_id = ?
    WHERE id = ?
  `).run(baseUrl, providerType, adapterId, req.params.id);

  const updated = db.prepare("SELECT * FROM providers WHERE id = ?").get(req.params.id) as ProviderRow;
  res.json(rowToProfile(updated));
});

router.post("/:id/test", async (req, res) => {
  const row = db.prepare("SELECT * FROM providers WHERE id = ?").get(req.params.id) as ProviderRow | undefined;
  if (!row) { res.json(false); return; }

  const settings = getSettings();
  if (settings.fullLocalMode && !isLocalhostUrl(row.base_url)) {
    res.json(false);
    return;
  }
  if (row.full_local_only && !isLocalhostUrl(row.base_url)) {
    res.json(false);
    return;
  }

  const providerType = normalizeProviderType(row.provider_type);
  if (providerType === "koboldcpp") {
    const ok = await testKoboldConnection(row);
    res.json(ok);
    return;
  }
  if (providerType === "custom") {
    try {
      const ok = await testCustomAdapterConnection(row);
      res.json(ok);
    } catch {
      res.json(false);
    }
    return;
  }

  res.json(true);
});

export default router;
