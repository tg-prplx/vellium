import { Router } from "express";
import { db, maskApiKey, isLocalhostUrl, DEFAULT_SETTINGS } from "../db.js";
import { fetchCustomAdapterModels } from "../services/customProviderAdapters.js";
import { fetchKoboldModels, normalizeProviderType } from "../services/providerApi.js";
import { normalizeApiParamPolicy } from "../services/apiParamPolicy.js";

const router = Router();
const MODEL_FETCH_TIMEOUT_MS = 15_000;
const MODEL_FETCH_RETRY_DELAYS_MS = [0, 250, 750];

interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  api_key_cipher: string;
  proxy_url: string | null;
  full_local_only: number;
  provider_type: string;
  adapter_id: string | null;
  manual_models: string | null;
}

interface ProviderPreviewInput {
  baseUrl?: unknown;
  apiKey?: unknown;
  fullLocalOnly?: unknown;
  providerType?: unknown;
  adapterId?: unknown;
  manualModels?: unknown;
}

function parseManualModels(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))];
  } catch {
    return [];
  }
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
    adapterId: row.adapter_id,
    manualModels: parseManualModels(row.manual_models)
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

function normalizeOpenAiBaseUrl(raw: string): string {
  const trimmed = String(raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeFetchFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) {
    return `${error.message}: ${cause.message}`;
  }
  if (cause && typeof cause === "object") {
    const code = String((cause as { code?: unknown }).code || "").trim();
    const syscall = String((cause as { syscall?: unknown }).syscall || "").trim();
    const address = String((cause as { address?: unknown }).address || "").trim();
    const port = String((cause as { port?: unknown }).port || "").trim();
    const details = [code, syscall, address && port ? `${address}:${port}` : address || port].filter(Boolean).join(" ");
    if (details) return `${error.message}: ${details}`;
  }
  return error.message || String(error);
}

async function fetchModelsResponse(url: string, apiKey: string) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MODEL_FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    const delay = MODEL_FETCH_RETRY_DELAYS_MS[attempt] ?? 0;
    if (delay > 0) await sleep(delay);

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error(`Model endpoint timed out after ${MODEL_FETCH_TIMEOUT_MS}ms`));
    }, MODEL_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Connection: "close",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        cache: "no-store",
        signal: controller.signal
      });
      if ([429, 502, 503, 504].includes(response.status) && attempt < MODEL_FETCH_RETRY_DELAYS_MS.length - 1) {
        lastError = new Error(`Model endpoint returned HTTP ${response.status}`);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= MODEL_FETCH_RETRY_DELAYS_MS.length - 1) break;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Model endpoint unreachable: ${url} (${describeFetchFailure(lastError)})`);
}

async function fetchOpenAiCompatibleModels(baseUrlRaw: string, apiKeyRaw: string): Promise<Array<{ id: string }>> {
  const baseUrl = normalizeOpenAiBaseUrl(baseUrlRaw);
  if (!baseUrl) {
    throw new Error("Base URL is required");
  }

  const apiKey = String(apiKeyRaw || "").trim();
  const endpoint = `${baseUrl}/models`;
  const response = await fetchModelsResponse(endpoint, apiKey);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Model endpoint returned HTTP ${response.status}: ${endpoint}`);
  }

  const body = await response.json() as {
    data?: Array<{ id?: unknown }>;
    models?: Array<{ id?: unknown }>;
  };
  const out: Array<{ id: string }> = [];

  if (Array.isArray(body.data)) {
    for (const item of body.data) {
      const id = String(item?.id || "").trim();
      if (id) out.push({ id });
    }
  }
  if (Array.isArray(body.models)) {
    for (const item of body.models) {
      const id = String(item?.id || "").trim();
      if (id) out.push({ id });
    }
  }

  const uniq = new Map<string, { id: string }>();
  for (const row of out) uniq.set(row.id, row);
  return Array.from(uniq.values());
}

function mergeManualModels(models: Array<{ id: string }>, manualModels: Array<{ id: string }>) {
  if (models.length === 0) return manualModels;
  return [
    ...models,
    ...manualModels.filter((item) => !models.some((model) => model.id === item.id))
  ];
}

async function resolveWithManualFallback(
  manualModels: Array<{ id: string }>,
  fetchModels: () => Promise<Array<{ id: string }>>
) {
  try {
    return mergeManualModels(await fetchModels(), manualModels);
  } catch (error) {
    if (manualModels.length > 0) return manualModels;
    throw error;
  }
}

function assertProviderAllowed(baseUrl: string, fullLocalOnly: boolean) {
  const settings = getSettings();
  if (settings.fullLocalMode && !isLocalhostUrl(baseUrl)) {
    throw new Error("Provider blocked by Full Local Mode");
  }
  if (fullLocalOnly && !isLocalhostUrl(baseUrl)) {
    throw new Error("Provider is set to Local-only. Disable Local-only for external URLs.");
  }
}

function toPreviewProvider(body: ProviderPreviewInput) {
  const providerType = normalizeProviderType(body.providerType);
  const manualModels = Array.isArray(body.manualModels)
    ? [...new Set(body.manualModels.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];

  return {
    base_url: String(body.baseUrl || "").trim(),
    api_key_cipher: String(body.apiKey || "").trim(),
    full_local_only: body.fullLocalOnly === true || body.fullLocalOnly === 1 ? 1 : 0,
    provider_type: providerType,
    adapter_id: providerType === "custom" ? String(body.adapterId || "").trim() || null : null,
    manual_models: JSON.stringify(manualModels)
  } satisfies Pick<ProviderRow, "base_url" | "api_key_cipher" | "full_local_only" | "provider_type" | "adapter_id" | "manual_models">;
}

async function resolveProviderModels(row: Pick<ProviderRow, "base_url" | "api_key_cipher" | "full_local_only" | "provider_type" | "adapter_id" | "manual_models">) {
  const manualModels = parseManualModels(row.manual_models).map((id) => ({ id }));
  assertProviderAllowed(row.base_url, Boolean(row.full_local_only));

  const providerType = normalizeProviderType(row.provider_type);
  if (providerType === "koboldcpp") {
    return resolveWithManualFallback(manualModels, async () => {
      const koboldModels = await fetchKoboldModels(row);
      return koboldModels.map((id) => ({ id }));
    });
  }

  if (providerType === "custom") {
    return resolveWithManualFallback(manualModels, async () => {
      const customModels = await fetchCustomAdapterModels(row);
      return customModels.map((id) => ({ id }));
    });
  }

  return resolveWithManualFallback(
    manualModels,
    () => fetchOpenAiCompatibleModels(row.base_url, row.api_key_cipher)
  );
}

router.post("/", (req, res) => {
  const { id, name, baseUrl, apiKey, proxyUrl, fullLocalOnly, providerType, adapterId, manualModels } = req.body;
  const normalizedType = normalizeProviderType(providerType);
  const normalizedAdapterId = normalizedType === "custom" ? String(adapterId || "").trim() : null;
  const normalizedManualModels = Array.isArray(manualModels)
    ? [...new Set(manualModels.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];

  db.prepare(`
    INSERT INTO providers (id, name, base_url, api_key_cipher, proxy_url, full_local_only, provider_type, adapter_id, manual_models)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      base_url = excluded.base_url,
      api_key_cipher = excluded.api_key_cipher,
      proxy_url = excluded.proxy_url,
      full_local_only = excluded.full_local_only,
      provider_type = excluded.provider_type,
      adapter_id = excluded.adapter_id,
      manual_models = excluded.manual_models
  `).run(
    id,
    name,
    baseUrl,
    apiKey || "local-key",
    proxyUrl || null,
    fullLocalOnly ? 1 : 0,
    normalizedType,
    normalizedAdapterId,
    JSON.stringify(normalizedManualModels)
  );

  const row = db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow;
  res.json(rowToProfile(row));
});

router.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM providers ORDER BY name ASC").all() as ProviderRow[];
  res.json(rows.map(rowToProfile));
});

router.post("/preview/models", async (req, res) => {
  try {
    const preview = toPreviewProvider((req.body ?? {}) as ProviderPreviewInput);
    const models = await resolveProviderModels(preview);
    res.json(models);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message || "Failed to load provider models" });
  }
});

router.post("/preview/test", async (req, res) => {
  try {
    const preview = toPreviewProvider((req.body ?? {}) as ProviderPreviewInput);
    await resolveProviderModels(preview);
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.json({ ok: false, error: message || "Connection check failed" });
  }
});

router.get("/:id/models", async (req, res) => {
  const row = db.prepare("SELECT * FROM providers WHERE id = ?").get(req.params.id) as ProviderRow | undefined;
  if (!row) { res.json([]); return; }
  try {
    res.json(await resolveProviderModels(row));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message || "Failed to load provider models" });
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
  try {
    await resolveProviderModels(row);
    res.json(true);
  } catch {
    res.json(false);
  }
});

export default router;
