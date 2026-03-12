import { getCustomEndpointAdapter, type CustomEndpointAdapter, type CustomEndpointAdapterEndpoint } from "./extensions.js";

type UnknownRecord = Record<string, unknown>;

interface CustomProviderLike {
  base_url: string;
  api_key_cipher?: string | null;
  adapter_id?: string | null;
}

function normalizeBaseUrl(raw: string) {
  return String(raw || "").trim().replace(/\/+$/, "");
}

function resolveUrl(baseUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${normalizeBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

function resolveContextPath(context: unknown, path: string): unknown {
  const normalized = String(path || "").trim();
  if (!normalized) return context;
  const tokens = normalized
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/\[\]/g, ".*")
    .split(".")
    .filter(Boolean);
  let values: unknown[] = [context];
  for (const token of tokens) {
    const next: unknown[] = [];
    for (const value of values) {
      if (token === "*") {
        if (Array.isArray(value)) {
          next.push(...value);
        }
        continue;
      }
      if (!value || typeof value !== "object") continue;
      const record = value as UnknownRecord;
      if (!(token in record)) continue;
      next.push(record[token]);
    }
    values = next;
    if (values.length === 0) break;
  }
  if (normalized.includes("[]")) return values;
  return values[0];
}

function applyTemplate(value: unknown, context: UnknownRecord): unknown {
  if (typeof value === "string") {
    const whole = value.match(/^\{\{([^{}]+)\}\}$/);
    if (whole) {
      const resolved = resolveContextPath(context, whole[1].trim());
      return resolved ?? "";
    }
    return value.replace(/\{\{([^{}]+)\}\}/g, (_match, token) => {
      const resolved = resolveContextPath(context, String(token || "").trim());
      if (resolved === null || resolved === undefined) return "";
      return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((item) => applyTemplate(item, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as UnknownRecord).map(([key, item]) => [key, applyTemplate(item, context)])
    );
  }
  return value;
}

function buildHeaders(provider: CustomProviderLike, adapter: CustomEndpointAdapter, endpoint: CustomEndpointAdapterEndpoint, context: UnknownRecord) {
  const headers: Record<string, string> = {};
  const apiKey = String(provider.api_key_cipher || "").trim();
  if (adapter.authMode === "bearer" && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (adapter.authMode === "header" && apiKey) {
    headers[adapter.authHeader || "X-API-Key"] = apiKey;
  }
  const templatedHeaders = endpoint.headersTemplate
    ? applyTemplate(endpoint.headersTemplate, context)
    : undefined;
  if (templatedHeaders && typeof templatedHeaders === "object" && !Array.isArray(templatedHeaders)) {
    for (const [key, value] of Object.entries(templatedHeaders as UnknownRecord)) {
      const header = String(key || "").trim();
      const headerValue = String(value || "").trim();
      if (!header || !headerValue) continue;
      headers[header] = headerValue;
    }
  }
  return headers;
}

async function requestEndpoint(provider: CustomProviderLike, adapter: CustomEndpointAdapter, endpoint: CustomEndpointAdapterEndpoint, context: UnknownRecord, signal?: AbortSignal) {
  const url = resolveUrl(provider.base_url, String(applyTemplate(endpoint.path, context)));
  const method = endpoint.method || "POST";
  const body = endpoint.bodyTemplate !== undefined ? applyTemplate(endpoint.bodyTemplate, context) : undefined;
  const headers = buildHeaders(provider, adapter, endpoint, context);
  if (body !== undefined && method !== "GET" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url, {
    method,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
    signal
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Custom adapter request failed (${response.status})`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function extractStrings(raw: unknown): string[] {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => extractStrings(item));
  }
  if (raw && typeof raw === "object") {
    const record = raw as UnknownRecord;
    const candidates = [record.id, record.name, record.model, record.content, record.text];
    return candidates.flatMap((item) => extractStrings(item));
  }
  return [];
}

function extractFirstText(raw: unknown, resultPath?: string) {
  const fromPath = resultPath ? resolveContextPath(raw, resultPath) : raw;
  const candidates = extractStrings(fromPath);
  return candidates[0] || "";
}

export function getCustomAdapterForProvider(provider: CustomProviderLike) {
  return getCustomEndpointAdapter(String(provider.adapter_id || ""));
}

export async function fetchCustomAdapterModels(provider: CustomProviderLike, signal?: AbortSignal): Promise<string[]> {
  const adapter = getCustomAdapterForProvider(provider);
  if (!adapter?.models?.enabled) return [];
  const payload = await requestEndpoint(provider, adapter, adapter.models, {
    provider: { baseUrl: provider.base_url },
    apiKey: String(provider.api_key_cipher || "")
  }, signal);
  const raw = adapter.models.resultPath ? resolveContextPath(payload, adapter.models.resultPath) : payload;
  return [...new Set(extractStrings(raw).filter(Boolean))];
}

export async function fetchCustomAdapterVoices(provider: CustomProviderLike, signal?: AbortSignal): Promise<string[]> {
  const adapter = getCustomAdapterForProvider(provider);
  if (!adapter?.voices?.enabled) return [];
  const payload = await requestEndpoint(provider, adapter, adapter.voices, {
    provider: { baseUrl: provider.base_url },
    apiKey: String(provider.api_key_cipher || "")
  }, signal);
  const raw = adapter.voices.resultPath ? resolveContextPath(payload, adapter.voices.resultPath) : payload;
  return [...new Set(extractStrings(raw).filter(Boolean))];
}

export async function testCustomAdapterConnection(provider: CustomProviderLike, signal?: AbortSignal): Promise<boolean> {
  const adapter = getCustomAdapterForProvider(provider);
  if (!adapter) return false;
  if (adapter.test?.enabled) {
    const payload = await requestEndpoint(provider, adapter, adapter.test, {
      provider: { baseUrl: provider.base_url },
      apiKey: String(provider.api_key_cipher || "")
    }, signal);
    if (!adapter.test.resultPath) return true;
    const result = resolveContextPath(payload, adapter.test.resultPath);
    if (typeof result === "boolean") return result;
    if (typeof result === "number") return result > 0;
    if (typeof result === "string") return result.trim().length > 0 && result !== "false";
    return Boolean(result);
  }
  if (adapter.models?.enabled) {
    await fetchCustomAdapterModels(provider, signal);
    return true;
  }
  return Boolean(adapter.chat?.enabled && provider.base_url);
}

export async function completeCustomAdapter(params: {
  provider: CustomProviderLike;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  samplerConfig?: Record<string, unknown>;
  messages?: Array<{ role: string; content: unknown }>;
  signal?: AbortSignal;
}) {
  const adapter = getCustomAdapterForProvider(params.provider);
  if (!adapter?.chat?.enabled) {
    throw new Error("Custom adapter is missing a chat endpoint");
  }
  const payload = await requestEndpoint(params.provider, adapter, adapter.chat, {
    provider: { baseUrl: params.provider.base_url },
    apiKey: String(params.provider.api_key_cipher || ""),
    model: params.modelId,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    sampler: params.samplerConfig || {},
    messages: params.messages || [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt }
    ]
  }, params.signal);
  return extractFirstText(payload, adapter.chat.resultPath);
}

export async function synthesizeCustomAdapterSpeech(params: {
  provider: CustomProviderLike;
  modelId: string;
  voice: string;
  input: string;
  signal?: AbortSignal;
}) {
  const adapter = getCustomAdapterForProvider(params.provider);
  if (!adapter?.tts?.enabled) {
    throw new Error("Custom adapter is missing a TTS endpoint");
  }
  const endpoint = adapter.tts;
  const url = resolveUrl(params.provider.base_url, String(applyTemplate(endpoint.path, {
    provider: { baseUrl: params.provider.base_url },
    apiKey: String(params.provider.api_key_cipher || ""),
    model: params.modelId,
    voice: params.voice,
    input: params.input
  })));
  const method = endpoint.method || "POST";
  const context = {
    provider: { baseUrl: params.provider.base_url },
    apiKey: String(params.provider.api_key_cipher || ""),
    model: params.modelId,
    voice: params.voice,
    input: params.input
  };
  const body = endpoint.bodyTemplate !== undefined ? applyTemplate(endpoint.bodyTemplate, context) : {
    model: params.modelId,
    voice: params.voice,
    input: params.input
  };
  const headers = buildHeaders(params.provider, adapter, endpoint, context);
  if (body !== undefined && method !== "GET" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url, {
    method,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
    signal: params.signal
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Custom adapter TTS failed (${response.status})`);
  }
  return {
    contentType: response.headers.get("content-type") || "audio/mpeg",
    buffer: Buffer.from(await response.arrayBuffer())
  };
}
