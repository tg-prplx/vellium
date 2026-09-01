import type {
  LlamaCppEndpointModel,
  LlamaCppEndpointState,
  LlamaCppEndpointStatus
} from "../../src/shared/types/llamaCpp.js";
import { fetchProviderResponse } from "./providerHttp.js";

const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
const MAX_MODELS = 128;
const MAX_VALUE_CHARS = 4_096;

type JsonRecord = Record<string, unknown>;

interface EndpointResponse {
  status: number;
  body: unknown;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function boundedString(value: unknown, maxChars = MAX_VALUE_CHARS): string {
  return String(value ?? "").trim().slice(0, maxChars);
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function normalizeLlamaCppServerBaseUrl(raw: string): string {
  let baseUrl = String(raw || "").trim().replace(/\/+$/, "");
  if (/\/v1$/i.test(baseUrl)) baseUrl = baseUrl.slice(0, -3);
  return baseUrl.replace(/\/+$/, "");
}

function requestHeaders(apiKey: string): HeadersInit {
  const key = String(apiKey || "").trim();
  return {
    Accept: "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {})
  };
}

async function readEndpoint(
  baseUrl: string,
  path: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<EndpointResponse> {
  const response = await fetchProviderResponse(`${baseUrl}${path}`, {
    method: "GET",
    headers: requestHeaders(apiKey),
    signal
  }, { retryDelaysMs: [0, 250], retryStatuses: [] });
  const text = (await response.text()).slice(0, MAX_RESPONSE_CHARS);
  let body: unknown = null;
  if (text.trim()) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { status: response.status, body };
}

async function readOptionalEndpoint(
  baseUrl: string,
  path: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<EndpointResponse | null> {
  try {
    return await readEndpoint(baseUrl, path, apiKey, signal);
  } catch {
    return null;
  }
}

function parseRouterModels(body: unknown): LlamaCppEndpointModel[] {
  const record = asRecord(body);
  const rows = Array.isArray(record?.data) ? record.data.slice(0, MAX_MODELS) : [];
  return rows.flatMap((value): LlamaCppEndpointModel[] => {
    const row = asRecord(value);
    if (!row) return [];
    const id = boundedString(row.id, 512);
    if (!id) return [];
    const status = asRecord(row.status);
    const rawState = boundedString(status?.value, 32).toLowerCase();
    const state: LlamaCppEndpointModel["state"] = ["loaded", "loading", "sleeping", "unloaded"].includes(rawState)
      ? rawState as LlamaCppEndpointModel["state"]
      : "unknown";
    const args = Array.isArray(status?.args)
      ? status.args.map((item) => boundedString(item, 512)).filter(Boolean).slice(0, 64)
      : [];
    return [{
      id,
      path: boundedString(row.path) || undefined,
      state,
      args,
      failed: status?.failed === true,
      exitCode: finiteNumber(status?.exit_code)
    }];
  });
}

function healthMessage(body: unknown): string {
  const record = asRecord(body);
  const error = asRecord(record?.error);
  return boundedString(error?.message ?? record?.message ?? record?.status, 512);
}

export function buildLlamaCppEndpointStatus(input: {
  baseUrl: string;
  health: EndpointResponse | null;
  props: EndpointResponse | null;
  slots: EndpointResponse | null;
  models: EndpointResponse | null;
  requestError?: string;
}): LlamaCppEndpointStatus {
  const props = asRecord(input.props?.body);
  const defaults = asRecord(props?.default_generation_settings);
  const params = asRecord(defaults?.params);
  const slots = Array.isArray(input.slots?.body) ? input.slots!.body.slice(0, 256) : [];
  const models = parseRouterModels(input.models?.body);
  const message = healthMessage(input.health?.body);
  const healthLooksNative = input.health?.status === 200 && message.toLowerCase() === "ok"
    || input.health?.status === 503 && /loading model/i.test(message);
  const propsLookNative = Boolean(props && (props.default_generation_settings || props.model_path || props.chat_template));
  const modelsLookNative = models.some((model) => model.state !== "unknown" || model.args.length > 0);
  const detected = healthLooksNative || propsLookNative || modelsLookNative;
  const unauthorized = [input.props, input.slots, input.models].some((response) => response?.status === 401 || response?.status === 403);

  let state: LlamaCppEndpointState = "not-detected";
  if (!input.health && !input.props && !input.models) state = "unreachable";
  else if (unauthorized && !propsLookNative && !modelsLookNative) state = "unauthorized";
  else if (models.some((model) => model.state === "loading") || input.health?.status === 503 && /loading/i.test(message)) state = "loading";
  else if (models.length > 0 && models.every((model) => model.state === "sleeping" || model.state === "unloaded")) state = "sleeping";
  else if (detected && input.health?.status === 200) state = "ready";

  const modelPath = boundedString(props?.model_path) || models.find((model) => model.state === "loaded")?.path;
  const modalities = Array.isArray(props?.modalities)
    ? props.modalities.map((item) => boundedString(item, 64)).filter(Boolean).slice(0, 16)
    : [];
  const error = state === "unreachable"
    ? boundedString(input.requestError || "llama.cpp endpoint is unreachable", 1_024)
    : state === "unauthorized"
      ? "llama.cpp management endpoints require a valid API key"
      : !detected
        ? "The endpoint is OpenAI-compatible, but native llama.cpp endpoints were not detected"
        : undefined;

  return {
    detected,
    state,
    baseUrl: input.baseUrl,
    modelPath: modelPath || undefined,
    contextSize: finiteNumber(defaults?.n_ctx),
    chatTemplate: boundedString(props?.chat_template) || undefined,
    modalities,
    slotCount: slots.length,
    busySlots: slots.filter((slot) => asRecord(slot)?.is_processing === true).length,
    samplerDefaults: {
      temperature: finiteNumber(params?.temperature),
      topP: finiteNumber(params?.top_p),
      topK: finiteNumber(params?.top_k),
      minP: finiteNumber(params?.min_p),
      repeatPenalty: finiteNumber(params?.repeat_penalty),
      maxTokens: finiteNumber(params?.max_tokens ?? params?.n_predict)
    },
    models,
    supportsModelControl: modelsLookNative,
    checkedAt: new Date().toISOString(),
    error
  };
}

export async function probeLlamaCppEndpoint(input: {
  baseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<LlamaCppEndpointStatus> {
  const baseUrl = normalizeLlamaCppServerBaseUrl(input.baseUrl);
  let requestError = "";
  const health = await readEndpoint(baseUrl, "/health", input.apiKey, input.signal).catch((error) => {
    requestError = error instanceof Error ? error.message : String(error);
    return null;
  });
  const [props, slots, models] = await Promise.all([
    readOptionalEndpoint(baseUrl, "/props", input.apiKey, input.signal),
    readOptionalEndpoint(baseUrl, "/slots", input.apiKey, input.signal),
    readOptionalEndpoint(baseUrl, "/models", input.apiKey, input.signal)
  ]);
  return buildLlamaCppEndpointStatus({ baseUrl, health, props, slots, models, requestError });
}

export async function setLlamaCppModelLoaded(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  loaded: boolean;
  signal?: AbortSignal;
}): Promise<void> {
  const baseUrl = normalizeLlamaCppServerBaseUrl(input.baseUrl);
  const model = boundedString(input.model, 512);
  if (!model) throw new Error("Model id is required");
  const response = await fetchProviderResponse(`${baseUrl}/models/${input.loaded ? "load" : "unload"}`, {
    method: "POST",
    headers: { ...requestHeaders(input.apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
    signal: input.signal
  }, { retryDelaysMs: [0], retryStatuses: [] });
  const text = (await response.text()).slice(0, 16_384);
  if (!response.ok) throw new Error(text || `llama.cpp returned HTTP ${response.status}`);
}
