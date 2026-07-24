import { Router } from "express";
import type { Request } from "express";
import { db, DEFAULT_SETTINGS, isLocalhostUrl } from "../db.js";
import { describeBlockedMcpLaunch, discoverMcpToolCatalog, testMcpServerConnection, type McpServerConfig } from "../services/mcp.js";
import { normalizeApiParamPolicy } from "../services/apiParamPolicy.js";
import { fetchCustomAdapterModels, fetchCustomAdapterVoices } from "../services/customProviderAdapters.js";
import { normalizeCustomEndpointAdapters, normalizeCustomInspectorFields } from "../services/extensions.js";
import { normalizeManagedBackends } from "../../src/shared/managedBackends.js";
import { normalizeRuntimeTuningSettings } from "../services/runtimeTuning.js";

const router = Router();
const TTS_DISCOVERY_TIMEOUT_MS = 12_000;

const PROMPT_BLOCK_KINDS = new Set(["system", "jailbreak", "character", "author_note", "lore", "scene", "history"]);

function normalizeSimpleModeWallpaper(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value) return "";
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value)) return "";
  return value.length <= 16_000_000 ? value : "";
}

function normalizeWallpaperPosition(raw: unknown): "center" | "top" | "bottom" {
  return raw === "top" || raw === "bottom" ? raw : "center";
}

function clampWallpaperNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function normalizeSecuritySettings(raw: unknown) {
  const patch = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  return {
    sanitizeMarkdown: patch.sanitizeMarkdown !== false,
    allowExternalLinks: patch.allowExternalLinks === true,
    allowRemoteImages: patch.allowRemoteImages === true,
    allowUnsafeUploads: patch.allowUnsafeUploads === true
  };
}

function normalizePluginStates(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SETTINGS.pluginStates };
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(key || "").trim();
    if (!id) continue;
    out[id] = value === true;
  }
  return out;
}

function normalizePluginStateConfigured(raw: unknown, rawStates?: unknown): Record<string, boolean> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const id = String(key || "").trim();
      if (!id) continue;
      out[id] = value === true;
    }
    return out;
  }

  // Legacy migration: previously persisted `true` values may have been produced
  // by buggy flows or manifest defaults. We only trust explicit stored `false`
  // states as already-configured; everything else requires a fresh opt-in.
  if (rawStates && typeof rawStates === "object" && !Array.isArray(rawStates)) {
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(rawStates as Record<string, unknown>)) {
      const id = String(key || "").trim();
      if (!id) continue;
      out[id] = value === false;
    }
    return out;
  }

  return { ...DEFAULT_SETTINGS.pluginStateConfigured };
}

function normalizePluginData(raw: unknown): Record<string, Record<string, unknown>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SETTINGS.pluginData };
  const out: Record<string, Record<string, unknown>> = {};
  for (const [pluginId, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(pluginId || "").trim();
    if (!id || !value || typeof value !== "object" || Array.isArray(value)) continue;
    out[id] = { ...(value as Record<string, unknown>) };
  }
  return out;
}

function normalizePluginPermissionGrants(raw: unknown): Record<string, Record<string, boolean>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SETTINGS.pluginPermissionGrants };
  const out: Record<string, Record<string, boolean>> = {};
  for (const [pluginId, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(pluginId || "").trim();
    if (!id || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const grants: Record<string, boolean> = {};
    for (const [permission, enabled] of Object.entries(value as Record<string, unknown>)) {
      const key = String(permission || "").trim();
      if (!key) continue;
      grants[key] = enabled === true;
    }
    out[id] = grants;
  }
  return out;
}

function normalizePromptStack(raw: unknown): typeof DEFAULT_SETTINGS.promptStack {
  const fallback = (DEFAULT_SETTINGS.promptStack || []).map((block) => ({ ...block }));
  if (!Array.isArray(raw)) return fallback;
  const next = raw
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const row = item as {
        id?: unknown;
        kind?: unknown;
        enabled?: unknown;
        order?: unknown;
        content?: unknown;
      };
      const kind = String(row.kind || "").trim();
      if (!PROMPT_BLOCK_KINDS.has(kind)) return null;
      const orderRaw = Number(row.order);
      return {
        id: String(row.id || `prompt-${Date.now()}-${index}`),
        kind: kind as typeof fallback[number]["kind"],
        enabled: row.enabled !== false,
        order: Number.isFinite(orderRaw) ? Math.max(1, Math.floor(orderRaw)) : index + 1,
        content: String(row.content || "")
      };
    })
    .filter((item): item is typeof fallback[number] => item !== null);
  if (next.length === 0) return fallback;
  return next
    .sort((a, b) => a.order - b.order)
    .map((block, index) => ({ ...block, order: index + 1 }));
}

function getSettings() {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string };
  const stored = JSON.parse(row.payload);
  const mcpServers = Array.isArray(stored.mcpServers) ? stored.mcpServers : DEFAULT_SETTINGS.mcpServers;
  const promptStack = normalizePromptStack(stored.promptStack);
  // Merge with defaults for backward compat (new fields get default values)
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    ...normalizeRuntimeTuningSettings(stored),
    rpReasoningEnabled: stored.rpReasoningEnabled === true,
    includeReasoningInContext: stored.includeReasoningInContext !== false,
    agentsEnabled: stored.agentsEnabled === true,
    agentWorkspaceToolsEnabled: stored.agentWorkspaceToolsEnabled !== false,
    agentCommandToolEnabled: stored.agentCommandToolEnabled !== false,
    agentDangerousFileOpsEnabled: stored.agentDangerousFileOpsEnabled === true,
    agentNetworkCommandsEnabled: stored.agentNetworkCommandsEnabled === true,
    agentShellCommandsEnabled: stored.agentShellCommandsEnabled === true,
    agentGitWriteCommandsEnabled: stored.agentGitWriteCommandsEnabled === true,
    agentAutoCompactEnabled: stored.agentAutoCompactEnabled !== false,
    agentReplyReserveTokens: Number.isFinite(Number(stored.agentReplyReserveTokens))
      ? Math.max(256, Math.min(12000, Math.floor(Number(stored.agentReplyReserveTokens))))
      : DEFAULT_SETTINGS.agentReplyReserveTokens,
    agentToolContextChars: Number.isFinite(Number(stored.agentToolContextChars))
      ? Math.max(400, Math.min(12000, Math.floor(Number(stored.agentToolContextChars))))
      : DEFAULT_SETTINGS.agentToolContextChars,
    simpleModeWallpaper: normalizeSimpleModeWallpaper(stored.simpleModeWallpaper),
    simpleModeWallpaperDim: clampWallpaperNumber(
      stored.simpleModeWallpaperDim,
      DEFAULT_SETTINGS.simpleModeWallpaperDim,
      0.15,
      0.9
    ),
    simpleModeWallpaperBlur: clampWallpaperNumber(
      stored.simpleModeWallpaperBlur,
      DEFAULT_SETTINGS.simpleModeWallpaperBlur,
      0,
      24
    ),
    simpleModeWallpaperPosition: normalizeWallpaperPosition(stored.simpleModeWallpaperPosition),
    samplerConfig: { ...DEFAULT_SETTINGS.samplerConfig, ...(stored.samplerConfig ?? {}) },
    apiParamPolicy: normalizeApiParamPolicy(stored.apiParamPolicy),
    promptTemplates: { ...DEFAULT_SETTINGS.promptTemplates, ...(stored.promptTemplates ?? {}) },
    promptStack,
    security: normalizeSecuritySettings({ ...DEFAULT_SETTINGS.security, ...(stored.security ?? {}) }),
    pluginStates: normalizePluginStates({ ...DEFAULT_SETTINGS.pluginStates, ...(stored.pluginStates ?? {}) }),
    pluginStateConfigured: normalizePluginStateConfigured(
      { ...DEFAULT_SETTINGS.pluginStateConfigured, ...(stored.pluginStateConfigured ?? {}) },
      stored.pluginStates
    ),
    pluginData: normalizePluginData({ ...DEFAULT_SETTINGS.pluginData, ...(stored.pluginData ?? {}) }),
    pluginPermissionGrants: normalizePluginPermissionGrants({
      ...DEFAULT_SETTINGS.pluginPermissionGrants,
      ...(stored.pluginPermissionGrants ?? {})
    }),
    managedBackends: normalizeManagedBackends(stored.managedBackends),
    customInspectorFields: normalizeCustomInspectorFields(stored.customInspectorFields),
    customEndpointAdapters: normalizeCustomEndpointAdapters(stored.customEndpointAdapters),
    mcpServers
  };
}

function normalizeOpenAiBaseUrl(raw: string): string {
  const trimmed = String(raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

async function fetchOpenAiCompatibleModels(baseUrlRaw: string, apiKeyRaw: string): Promise<Array<{ id: string }>> {
  const baseUrl = normalizeOpenAiBaseUrl(baseUrlRaw);
  if (!baseUrl) return [];
  const apiKey = String(apiKeyRaw || "").trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`TTS model discovery timed out after ${TTS_DISCOVERY_TIMEOUT_MS}ms`)), TTS_DISCOVERY_TIMEOUT_MS);
  let body: { data?: Array<{ id?: unknown }>; models?: Array<{ id?: unknown }>; };
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Connection: "close", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`TTS model endpoint returned HTTP ${response.status}`);
    body = await response.json() as typeof body;
  } finally {
    clearTimeout(timeout);
  }
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

function extractVoiceIds(payload: unknown): Array<{ id: string }> {
  const out: Array<{ id: string }> = [];
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (typeof item === "string") {
        const id = item.trim();
        if (id) out.push({ id });
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const row = item as { id?: unknown; name?: unknown; voice?: unknown };
      const id = String(row.id ?? row.voice ?? row.name ?? "").trim();
      if (id) out.push({ id });
    }
  } else if (payload && typeof payload === "object") {
    const row = payload as { data?: unknown; voices?: unknown; items?: unknown };
    if (row.data !== undefined) out.push(...extractVoiceIds(row.data));
    if (row.voices !== undefined) out.push(...extractVoiceIds(row.voices));
    if (row.items !== undefined) out.push(...extractVoiceIds(row.items));
  }
  const uniq = new Map<string, { id: string }>();
  for (const item of out) uniq.set(item.id, item);
  return Array.from(uniq.values());
}

async function fetchOpenAiCompatibleVoices(baseUrlRaw: string, apiKeyRaw: string): Promise<Array<{ id: string }>> {
  const baseUrl = normalizeOpenAiBaseUrl(baseUrlRaw);
  if (!baseUrl) return [];
  const apiKey = String(apiKeyRaw || "").trim();
  const headers = { Connection: "close", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`TTS voice discovery timed out after ${TTS_DISCOVERY_TIMEOUT_MS}ms`)), TTS_DISCOVERY_TIMEOUT_MS);
  const candidates = [
    `${baseUrl}/audio/voices`,
    `${baseUrl}/voices`,
    `${baseUrl}/audio/speech/voices`
  ];
  try {
    for (const url of candidates) {
      try {
        const response = await fetch(url, { headers, cache: "no-store", signal: controller.signal });
        if (!response.ok) continue;
        const body = await response.json().catch(() => null);
        const voices = extractVoiceIds(body);
        if (voices.length > 0) return voices;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        // try next candidate endpoint
      }
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeMcpServer(raw: unknown, fallbackIndex = 1): McpServerConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<McpServerConfig> & {
    serverId?: unknown;
    displayName?: unknown;
    cmd?: unknown;
    arguments?: unknown;
    url?: unknown;
    cwd?: unknown;
  };
  const normalizeArgs = (value: unknown): string => {
    if (Array.isArray(value)) {
      return value
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
        .map((item) => (/\s/.test(item) ? JSON.stringify(item) : item))
        .join(" ");
    }
    return String(value || "").trim();
  };
  const normalizeEnv = (value: unknown): string => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.entries(value as Record<string, unknown>)
        .map(([key, entryValue]) => `${String(key || "").trim()}=${String(entryValue ?? "")}`)
        .filter((line) => !line.startsWith("="))
        .join("\n");
    }
    return String(value || "").trim();
  };
  const id = String(row.id || row.serverId || "").trim() || `mcp-${Date.now()}-${fallbackIndex}`;
  const name = String(row.name || row.displayName || id).trim() || id;
  const url = String(row.url || "").trim();
  const command = String(row.command || row.cmd || (url ? "npx" : "")).trim();
  const args = normalizeArgs(row.args || row.arguments || (url ? `-y mcp-remote ${url}` : ""));
  if (describeBlockedMcpLaunch(command, args)) return null;
  const env = normalizeEnv(row.env);
  const cwd = String(row.cwd || "").trim();
  const timeoutMsRaw = Number(row.timeoutMs);
  const defaultTimeout = url ? 45000 : 15000;
  return {
    id,
    name,
    command,
    args,
    cwd: cwd || undefined,
    env,
    enabled: row.enabled !== false,
    timeoutMs: Number.isFinite(timeoutMsRaw) ? Math.max(1000, Math.min(120000, Math.floor(timeoutMsRaw))) : defaultTimeout
  };
}

function parseMcpServersPayload(payload: unknown): McpServerConfig[] {
  if (Array.isArray(payload)) {
    return payload.map((item, idx) => normalizeMcpServer(item, idx + 1)).filter((s): s is McpServerConfig => s !== null);
  }
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      const one = normalizeMcpServer({
        id: new URL(trimmed).hostname || "mcp-http",
        name: new URL(trimmed).hostname || "MCP HTTP",
        url: trimmed
      }, 1);
      return one ? [one] : [];
    }
    return [];
  }
  if (!payload || typeof payload !== "object") return [];
  const row = payload as {
    mcpServers?: unknown;
    servers?: unknown;
    server?: unknown;
  };
  if (row.mcpServers !== undefined) return parseMcpServersPayload(row.mcpServers);
  if (row.servers !== undefined) return parseMcpServersPayload(row.servers);
  if (row.server !== undefined) return parseMcpServersPayload([row.server]);

  // Support dictionary shape: { "name": { ...config } }
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length > 0 && entries.every(([, value]) => value && typeof value === "object")) {
    return entries
      .map(([key, value], idx) => normalizeMcpServer({ ...(value as Record<string, unknown>), id: key, name: key }, idx + 1))
      .filter((s): s is McpServerConfig => s !== null);
  }

  const one = normalizeMcpServer(payload, 1);
  return one ? [one] : [];
}

async function fetchImportSource(source: string): Promise<{ sourceType: "url" | "json"; content: string }> {
  const trimmed = source.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(trimmed, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const content = await response.text();
      return { sourceType: "url", content };
    } finally {
      clearTimeout(timer);
    }
  }
  return { sourceType: "json", content: trimmed };
}

function hasConfiguredBasicAuth(req: Request): boolean {
  const secret = String(process.env.SLV_BASIC_AUTH || "").trim();
  if (!secret || !secret.includes(":")) return false;
  return String(req.headers.authorization || "").startsWith("Basic ");
}

function isPrivilegedMcpOriginAllowed(req: Request): boolean {
  if (hasConfiguredBasicAuth(req)) return true;
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1");
  } catch {
    return false;
  }
}

router.use("/mcp", (req, res, next) => {
  if (!isPrivilegedMcpOriginAllowed(req)) {
    res.status(403).json({ error: "MCP settings actions require a trusted app origin or Basic auth." });
    return;
  }
  next();
});

router.get("/", (_req, res) => {
  res.json(getSettings());
});

router.patch("/", (req, res) => {
  const patch = req.body as Record<string, unknown> | undefined;
  const patchData = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const current = getSettings();
  const runtimeTuning = normalizeRuntimeTuningSettings({ ...current, ...patchData });
  const updated = {
    ...current,
    ...patchData,
    ...runtimeTuning,
    rpReasoningEnabled: patchData.rpReasoningEnabled === undefined
      ? current.rpReasoningEnabled
      : patchData.rpReasoningEnabled === true,
    includeReasoningInContext: patchData.includeReasoningInContext === undefined
      ? current.includeReasoningInContext
      : patchData.includeReasoningInContext !== false,
    agentsEnabled: patchData.agentsEnabled === undefined ? current.agentsEnabled : patchData.agentsEnabled === true,
    agentWorkspaceToolsEnabled: patchData.agentWorkspaceToolsEnabled === undefined
      ? current.agentWorkspaceToolsEnabled
      : patchData.agentWorkspaceToolsEnabled !== false,
    agentCommandToolEnabled: patchData.agentCommandToolEnabled === undefined
      ? current.agentCommandToolEnabled
      : patchData.agentCommandToolEnabled !== false,
    agentDangerousFileOpsEnabled: patchData.agentDangerousFileOpsEnabled === undefined
      ? current.agentDangerousFileOpsEnabled
      : patchData.agentDangerousFileOpsEnabled === true,
    agentNetworkCommandsEnabled: patchData.agentNetworkCommandsEnabled === undefined
      ? current.agentNetworkCommandsEnabled
      : patchData.agentNetworkCommandsEnabled === true,
    agentShellCommandsEnabled: patchData.agentShellCommandsEnabled === undefined
      ? current.agentShellCommandsEnabled
      : patchData.agentShellCommandsEnabled === true,
    agentGitWriteCommandsEnabled: patchData.agentGitWriteCommandsEnabled === undefined
      ? current.agentGitWriteCommandsEnabled
      : patchData.agentGitWriteCommandsEnabled === true,
    agentAutoCompactEnabled: patchData.agentAutoCompactEnabled === undefined
      ? current.agentAutoCompactEnabled
      : patchData.agentAutoCompactEnabled !== false,
    agentReplyReserveTokens: patchData.agentReplyReserveTokens === undefined
      ? current.agentReplyReserveTokens
      : Math.max(256, Math.min(12000, Math.floor(Number(patchData.agentReplyReserveTokens) || current.agentReplyReserveTokens))),
    agentToolContextChars: patchData.agentToolContextChars === undefined
      ? current.agentToolContextChars
      : Math.max(400, Math.min(12000, Math.floor(Number(patchData.agentToolContextChars) || current.agentToolContextChars))),
    simpleModeWallpaper: patchData.simpleModeWallpaper === undefined
      ? current.simpleModeWallpaper
      : normalizeSimpleModeWallpaper(patchData.simpleModeWallpaper),
    simpleModeWallpaperDim: patchData.simpleModeWallpaperDim === undefined
      ? current.simpleModeWallpaperDim
      : clampWallpaperNumber(patchData.simpleModeWallpaperDim, current.simpleModeWallpaperDim, 0.15, 0.9),
    simpleModeWallpaperBlur: patchData.simpleModeWallpaperBlur === undefined
      ? current.simpleModeWallpaperBlur
      : clampWallpaperNumber(patchData.simpleModeWallpaperBlur, current.simpleModeWallpaperBlur, 0, 24),
    simpleModeWallpaperPosition: patchData.simpleModeWallpaperPosition === undefined
      ? current.simpleModeWallpaperPosition
      : normalizeWallpaperPosition(patchData.simpleModeWallpaperPosition),
    samplerConfig: { ...current.samplerConfig, ...(patchData.samplerConfig ?? {}) },
    apiParamPolicy: normalizeApiParamPolicy({
      ...(current.apiParamPolicy ?? {}),
      ...((patchData as { apiParamPolicy?: unknown }).apiParamPolicy ?? {})
    }),
    promptTemplates: { ...current.promptTemplates, ...(patchData.promptTemplates ?? {}) },
    promptStack: normalizePromptStack((patchData as { promptStack?: unknown }).promptStack ?? current.promptStack),
    security: normalizeSecuritySettings({
      ...current.security,
      ...((patchData as { security?: Record<string, unknown> }).security ?? {})
    }),
    pluginStates: normalizePluginStates({
      ...current.pluginStates,
      ...((patchData as { pluginStates?: Record<string, unknown> }).pluginStates ?? {})
    }),
    pluginStateConfigured: normalizePluginStateConfigured({
      ...current.pluginStateConfigured,
      ...((patchData as { pluginStateConfigured?: Record<string, unknown> }).pluginStateConfigured ?? {})
    }),
    pluginData: normalizePluginData({
      ...current.pluginData,
      ...((patchData as { pluginData?: Record<string, Record<string, unknown>> }).pluginData ?? {})
    }),
    pluginPermissionGrants: normalizePluginPermissionGrants({
      ...current.pluginPermissionGrants,
      ...((patchData as { pluginPermissionGrants?: Record<string, Record<string, boolean>> }).pluginPermissionGrants ?? {})
    }),
    managedBackends: normalizeManagedBackends(
      (patchData as { managedBackends?: unknown }).managedBackends ?? current.managedBackends
    ),
    customInspectorFields: normalizeCustomInspectorFields(
      (patchData as { customInspectorFields?: unknown }).customInspectorFields ?? current.customInspectorFields
    ),
    customEndpointAdapters: normalizeCustomEndpointAdapters(
      (patchData as { customEndpointAdapters?: unknown }).customEndpointAdapters ?? current.customEndpointAdapters
    )
  };
  db.prepare("UPDATE settings SET payload = ? WHERE id = 1").run(JSON.stringify(updated));
  res.json(updated);
});

router.post("/tts/models", async (req, res) => {
  const current = getSettings();
  const body = req.body as { baseUrl?: unknown; apiKey?: unknown; adapterId?: unknown } | undefined;
  const baseUrl = String(body?.baseUrl ?? current.ttsBaseUrl ?? "").trim();
  const apiKey = String(body?.apiKey ?? current.ttsApiKey ?? "").trim();
  const adapterId = String(body?.adapterId ?? current.ttsAdapterId ?? "").trim();

  if (!baseUrl) {
    res.json([]);
    return;
  }

  if (current.fullLocalMode && !isLocalhostUrl(baseUrl)) {
    res.status(403).json({ error: "TTS endpoint blocked by Full Local Mode" });
    return;
  }

  try {
    if (adapterId) {
      const models = await fetchCustomAdapterModels({ base_url: baseUrl, api_key_cipher: apiKey, adapter_id: adapterId });
      res.json(models.map((id) => ({ id })));
      return;
    }
    const models = await fetchOpenAiCompatibleModels(baseUrl, apiKey);
    res.json(models);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(502).json({ error: `TTS model endpoint unreachable: ${baseUrl} (${message || "request failed"})` });
  }
});

router.post("/tts/voices", async (req, res) => {
  const current = getSettings();
  const body = req.body as { baseUrl?: unknown; apiKey?: unknown; adapterId?: unknown } | undefined;
  const baseUrl = String(body?.baseUrl ?? current.ttsBaseUrl ?? "").trim();
  const apiKey = String(body?.apiKey ?? current.ttsApiKey ?? "").trim();
  const adapterId = String(body?.adapterId ?? current.ttsAdapterId ?? "").trim();

  if (!baseUrl) {
    res.json([]);
    return;
  }

  if (current.fullLocalMode && !isLocalhostUrl(baseUrl)) {
    res.status(403).json({ error: "TTS endpoint blocked by Full Local Mode" });
    return;
  }

  try {
    if (adapterId) {
      const voices = await fetchCustomAdapterVoices({ base_url: baseUrl, api_key_cipher: apiKey, adapter_id: adapterId });
      res.json(voices.map((id) => ({ id })));
      return;
    }
    const voices = await fetchOpenAiCompatibleVoices(baseUrl, apiKey);
    res.json(voices);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(502).json({ error: `TTS voice endpoint unreachable: ${baseUrl} (${message || "request failed"})` });
  }
});

router.post("/reset", (_req, res) => {
  db.prepare("UPDATE settings SET payload = ? WHERE id = 1").run(JSON.stringify(DEFAULT_SETTINGS));
  res.json({ ...DEFAULT_SETTINGS });
});

router.post("/mcp/test", async (req, res) => {
  const raw = (req.body as { server?: unknown } | undefined)?.server;
  if (!raw || typeof raw !== "object") {
    res.status(400).json({ ok: false, tools: [], error: "server payload is required" });
    return;
  }
  const row = raw as Partial<McpServerConfig>;
  const timeoutMs = Number(row.timeoutMs);
  const server: McpServerConfig = {
    id: String(row.id || "mcp-test"),
    name: String(row.name || "MCP Test"),
    command: String(row.command || ""),
    args: String(row.args || ""),
    env: String(row.env || ""),
    enabled: row.enabled !== false,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 15000
  };
  const result = await testMcpServerConnection(server);
  res.json(result);
});

router.post("/mcp/import", async (req, res) => {
  const source = String((req.body as { source?: unknown } | undefined)?.source || "").trim();
  if (!source) {
    res.status(400).json({ ok: false, servers: [], sourceType: "json", error: "source is required" });
    return;
  }

  try {
    if (/^https?:\/\//i.test(source)) {
      const directUrlServers = parseMcpServersPayload(source);
      if (directUrlServers.length > 0) {
        res.json({ ok: true, servers: directUrlServers, sourceType: "url" });
        return;
      }
    }

    const loaded = await fetchImportSource(source);
    let parsed: unknown;
    try {
      parsed = JSON.parse(loaded.content);
    } catch {
      res.status(400).json({ ok: false, servers: [], sourceType: loaded.sourceType, error: "Invalid JSON source" });
      return;
    }
    const servers = parseMcpServersPayload(parsed);
    if (servers.length === 0) {
      res.status(400).json({ ok: false, servers: [], sourceType: loaded.sourceType, error: "No MCP servers found in source" });
      return;
    }
    res.json({ ok: true, servers, sourceType: loaded.sourceType });
  } catch (err) {
    res.status(400).json({
      ok: false,
      servers: [],
      sourceType: /^https?:\/\//i.test(source) ? "url" : "json",
      error: err instanceof Error ? err.message : "Import failed"
    });
  }
});

router.post("/mcp/discover", async (req, res) => {
  const serverIdsRaw = (req.body as { serverIds?: unknown } | undefined)?.serverIds;
  const serverIds = Array.isArray(serverIdsRaw)
    ? serverIdsRaw.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  try {
    const current = getSettings();
    let servers = parseMcpServersPayload(current.mcpServers);
    if (serverIds.length > 0) {
      const allowed = new Set(serverIds);
      servers = servers.filter((server) => allowed.has(server.id));
    }
    const tools = await discoverMcpToolCatalog(servers);
    res.json({ ok: true, tools });
  } catch (err) {
    res.status(400).json({
      ok: false,
      tools: [],
      error: err instanceof Error ? err.message : "MCP discovery failed"
    });
  }
});

export default router;
