import { buildOpenAiSamplingPayload } from "../../services/apiParamPolicy.js";
import { prepareMcpTools, type McpServerConfig } from "../../services/mcp.js";
import type { ProviderRow } from "./routeHelpers.js";
import {
  consumeSseEventBlocks,
  extractOpenAiStreamErrorMessage,
  extractOpenAiStreamTextDelta,
  extractSseEventData,
  extractSseEventType
} from "./openAiStream.js";

export interface OpenAICompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ToolCallTrace {
  callId: string;
  name: string;
  args: string;
  result: string;
}

interface MarkdownImageMatch {
  markdown: string;
  url: string;
}

interface StructuredToolResultMedia {
  markdown: string;
  url: string;
}

interface RawToolCallCandidate {
  raw: string;
  payload: string;
}

interface StreamedToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ToolCallStreamEvent {
  phase: "start" | "delta" | "done";
  callId: string;
  name: string;
  args: string;
  result?: string;
}

export const REASONING_CALL_NAME = "__reasoning__";
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gi;

function clampToolIterationLimit(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 4;
  return Math.max(1, Math.min(12, Math.floor(value)));
}

function parseToolCallingPolicy(raw: unknown): "conservative" | "balanced" | "aggressive" {
  if (raw === "conservative" || raw === "balanced" || raw === "aggressive") {
    return raw;
  }
  return "balanced";
}

function normalizeAssistantContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const row = item as { type?: unknown; text?: unknown };
        if (row.type === "text") return String(row.text ?? "");
        return "";
      })
      .filter(Boolean);
    return parts.join("\n").trim();
  }
  if (content === null || content === undefined) return "";
  return String(content);
}

export function extractOpenAiStreamToolCallDeltas(parsed: unknown): StreamedToolCallDelta[] {
  if (!parsed || typeof parsed !== "object") return [];
  const root = parsed as {
    choices?: Array<{
      delta?: {
        tool_calls?: Array<{
          index?: unknown;
          id?: unknown;
          type?: unknown;
          function?: {
            name?: unknown;
            arguments?: unknown;
          };
        }>;
        function_call?: {
          name?: unknown;
          arguments?: unknown;
        };
      };
    }>;
  };
  const delta = root.choices?.[0]?.delta;
  if (!delta || typeof delta !== "object") return [];

  const toolCallDeltas = Array.isArray(delta.tool_calls)
    ? delta.tool_calls
      .map((item, index) => ({
        index: Number.isFinite(Number(item?.index)) ? Number(item?.index) : index,
        id: typeof item?.id === "string" ? item.id : undefined,
        type: typeof item?.type === "string" ? item.type : undefined,
        function: item?.function && typeof item.function === "object"
          ? {
              name: typeof item.function.name === "string" ? item.function.name : undefined,
              arguments: typeof item.function.arguments === "string" ? item.function.arguments : undefined
            }
          : undefined
      }))
      .filter((item) => Number.isFinite(item.index))
    : [];
  if (toolCallDeltas.length > 0) return toolCallDeltas;

  const legacyFunctionCall = delta.function_call;
  if (legacyFunctionCall && typeof legacyFunctionCall === "object") {
    return [{
      index: 0,
      type: "function",
      function: {
        name: typeof legacyFunctionCall.name === "string" ? legacyFunctionCall.name : undefined,
        arguments: typeof legacyFunctionCall.arguments === "string" ? legacyFunctionCall.arguments : undefined
      }
    }];
  }

  return [];
}

function extractMarkdownImages(text: string): MarkdownImageMatch[] {
  const source = String(text || "");
  if (!source) return [];
  const matches: MarkdownImageMatch[] = [];

  for (const match of source.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    const markdown = String(match[0] || "").trim();
    const url = String(match[1] || "").trim();
    if (!markdown || !url) continue;
    matches.push({ markdown, url });
  }

  return matches;
}

function extractStructuredToolResultImages(text: string): StructuredToolResultMedia[] {
  const source = String(text || "").trim();
  if (!source.startsWith("{")) return [];
  try {
    const parsed = JSON.parse(source) as {
      kind?: unknown;
      media?: Array<{ type?: unknown; markdown?: unknown; url?: unknown }>;
    };
    if (parsed.kind !== "vellium_media_result" || !Array.isArray(parsed.media)) return [];
    return parsed.media
      .map((item) => {
        const markdown = String(item?.markdown || "").trim();
        const url = String(item?.url || "").trim();
        if (!markdown || !url) return null;
        return { markdown, url };
      })
      .filter((item): item is StructuredToolResultMedia => item !== null);
  } catch {
    return [];
  }
}

export function appendMissingToolImageMarkdown(content: string, toolTraces: ToolCallTrace[]): { content: string; appended: string } {
  const assistantText = String(content || "");
  const existingImageUrls = new Set(
    extractMarkdownImages(assistantText).map((item) => item.url)
  );
  const appendedMarkdown: string[] = [];

  for (const trace of toolTraces) {
    const images = [
      ...extractStructuredToolResultImages(String(trace.result || "")),
      ...extractMarkdownImages(String(trace.result || ""))
    ];
    for (const image of images) {
      if (existingImageUrls.has(image.url)) continue;
      existingImageUrls.add(image.url);
      appendedMarkdown.push(image.markdown);
    }
  }

  if (appendedMarkdown.length === 0) {
    return {
      content: assistantText,
      appended: ""
    };
  }

  const appended = `${assistantText.trimEnd() ? "\n\n" : ""}${appendedMarkdown.join("\n\n")}`;
  return {
    content: `${assistantText.trimEnd()}${appended}`,
    appended
  };
}

function flattenContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const row = item as { type?: unknown; text?: unknown };
    if (row.type === "text") parts.push(String(row.text ?? ""));
    if (row.type === "image_url") parts.push("[Image attachment]");
  }
  return parts.join("\n").trim();
}

function flattenReasoningValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => flattenReasoningValue(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  if (typeof row.text === "string") return row.text;
  if (typeof row.content === "string") return row.content;
  if (typeof row.summary === "string") return row.summary;
  const nested = [row.reasoning, row.reasoning_content, row.output_text];
  return nested
    .map((item) => flattenReasoningValue(item))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function extractOpenAIReasoningDelta(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const root = parsed as { choices?: Array<{ delta?: Record<string, unknown> }> };
  const delta = root.choices?.[0]?.delta;
  if (!delta || typeof delta !== "object") return "";

  const direct = [
    delta.reasoning,
    delta.reasoning_content,
    delta.reasoning_text,
    delta.reasoningText
  ]
    .map((item) => flattenReasoningValue(item))
    .find((item) => Boolean(item));
  if (direct) return direct;

  if (Array.isArray(delta.content)) {
    const fromParts = delta.content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const row = part as Record<string, unknown>;
        const type = String(row.type || "");
        if (!/reason/i.test(type)) return "";
        return flattenReasoningValue(row);
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (fromParts) return fromParts;
  }

  return "";
}

export const KOBOLD_TAGS = {
  systemOpen: "{{[SYSTEM]}}",
  systemClose: "{{[SYSTEM_END]}}",
  inputOpen: "{{[INPUT]}}",
  inputClose: "{{[INPUT_END]}}",
  outputOpen: "{{[OUTPUT]}}",
  outputClose: "{{[OUTPUT_END]}}"
};

export function buildKoboldPromptFromMessages(
  messages: Array<{ role: string; content: unknown }>,
  samplerConfig: Record<string, unknown>
): { prompt: string; memory: string } {
  const systemParts: string[] = [];
  const convoParts: string[] = [];
  for (const msg of messages) {
    const role = String(msg.role || "user");
    const text = flattenContentToText(msg.content).trim();
    if (!text) continue;
    if (role === "system") {
      systemParts.push(text);
      continue;
    }
    if (role === "assistant") {
      convoParts.push(`${KOBOLD_TAGS.outputOpen}\n${text}\n${KOBOLD_TAGS.outputClose}`);
      continue;
    }
    if (role === "tool") {
      convoParts.push(`${KOBOLD_TAGS.inputOpen}\n[Tool]\n${text}\n${KOBOLD_TAGS.inputClose}`);
      continue;
    }
    convoParts.push(`${KOBOLD_TAGS.inputOpen}\n${text}\n${KOBOLD_TAGS.inputClose}`);
  }

  const customMemory = String(samplerConfig.koboldMemory || "").trim();
  const memoryBlocks = [
    customMemory,
    ...systemParts.map((part) => `${KOBOLD_TAGS.systemOpen}\n${part}\n${KOBOLD_TAGS.systemClose}`)
  ].filter(Boolean);
  const memory = memoryBlocks.join("\n\n");
  const prompt = [...convoParts, KOBOLD_TAGS.outputOpen].join("\n\n");
  return { prompt, memory };
}

function parseToolServers(raw: unknown): McpServerConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Partial<McpServerConfig>;
      const id = String(row.id || "").trim();
      const command = String(row.command || "").trim();
      if (!id || !command) return null;
      const timeoutMs = Number(row.timeoutMs);
      return {
        id,
        name: String(row.name || id),
        command,
        args: String(row.args || ""),
        cwd: String(row.cwd || "").trim() || undefined,
        env: String(row.env || ""),
        enabled: row.enabled !== false,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 15000
      } as McpServerConfig;
    })
    .filter((item): item is McpServerConfig => item !== null);
}

function normalizeToolCallAlias(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function resolveRequestedToolName(rawName: string, availableNames: string[]): string {
  const trimmed = String(rawName || "").trim();
  if (!trimmed) return "";
  if (availableNames.includes(trimmed)) return trimmed;
  const normalized = normalizeToolCallAlias(trimmed);
  return availableNames.find((name) => normalizeToolCallAlias(name) === normalized) || "";
}

function buildParsedToolCall(rawPayload: string, availableNames: string[], idPrefix: string): OpenAIToolCall | null {
  const payload = String(rawPayload || "").trim();
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as {
      name?: unknown;
      tool?: unknown;
      tool_name?: unknown;
      arguments?: unknown;
      args?: unknown;
      input?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const requestedName = String(
      parsed.function?.name
      || parsed.name
      || parsed.tool_name
      || parsed.tool
      || ""
    ).trim();
    const resolvedName = resolveRequestedToolName(requestedName, availableNames);
    if (!resolvedName) return null;

    const rawArguments = parsed.function?.arguments
      ?? parsed.arguments
      ?? parsed.args
      ?? parsed.input
      ?? {};
    const serializedArgs = typeof rawArguments === "string"
      ? rawArguments
      : JSON.stringify(rawArguments ?? {});

    return {
      id: `${idPrefix}-${resolvedName}`,
      type: "function",
      function: {
        name: resolvedName,
        arguments: serializedArgs
      }
    };
  } catch {
    return null;
  }
}

function collectBalancedJsonCandidates(text: string): RawToolCallCandidate[] {
  const source = String(text || "");
  const out: RawToolCallCandidate[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const raw = source.slice(start, index + 1);
        if (/"(?:name|tool|tool_name|function|arguments|args|input)"/i.test(raw)) {
          out.push({
            raw,
            payload: raw
          });
        }
        start = -1;
      }
    }
  }

  return out;
}

function collectRawToolCallCandidates(text: string): RawToolCallCandidate[] {
  const source = String(text || "");
  if (!source) return [];
  const candidates: RawToolCallCandidate[] = [];
  const seen = new Set<string>();
  const pushCandidate = (candidate: RawToolCallCandidate) => {
    const raw = String(candidate.raw || "");
    const payload = String(candidate.payload || "").trim();
    if (!raw || !payload) return;
    const key = `${raw}\n---\n${payload}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ raw, payload });
  };

  const taggedPattern = /\[TOOL_REQUEST\]\s*([\s\S]*?)\s*\[END_TOOL_REQUEST\]/gi;
  for (const match of source.matchAll(taggedPattern)) {
    pushCandidate({
      raw: String(match[0] || ""),
      payload: String(match[1] || "")
    });
  }

  const fencedPattern = /```(?:json|tool|tool_call|tools)?\s*([\s\S]*?)```/gi;
  for (const match of source.matchAll(fencedPattern)) {
    pushCandidate({
      raw: String(match[0] || ""),
      payload: String(match[1] || "")
    });
  }

  const callPattern = /([A-Za-z0-9_.:-]+)\s*\(\s*(\{[\s\S]*?\})\s*\)/g;
  for (const match of source.matchAll(callPattern)) {
    const toolName = String(match[1] || "").trim();
    const argsPayload = String(match[2] || "").trim();
    if (!toolName || !argsPayload) continue;
    pushCandidate({
      raw: String(match[0] || ""),
      payload: JSON.stringify({
        name: toolName,
        arguments: JSON.parse(argsPayload)
      })
    });
  }

  for (const candidate of collectBalancedJsonCandidates(source)) {
    pushCandidate(candidate);
  }

  return candidates;
}

function stripRawToolCallText(text: string, rawBlocks: string[]): string {
  let visible = String(text || "");
  for (const raw of [...rawBlocks].sort((a, b) => b.length - a.length)) {
    if (!raw) continue;
    visible = visible.replace(raw, "");
  }
  return visible.trim();
}

export function extractTextToolCalls(text: string, availableNames: string[]): {
  toolCalls: OpenAIToolCall[];
  visibleContent: string;
} {
  const source = String(text || "");
  if (!source) {
    return { toolCalls: [], visibleContent: "" };
  }

  const toolCalls: OpenAIToolCall[] = [];
  const rawBlocks: string[] = [];
  const seenCalls = new Set<string>();
  const candidates = collectRawToolCallCandidates(source);

  for (const candidate of candidates) {
    const toolCall = buildParsedToolCall(candidate.payload, availableNames, `text-tool-${toolCalls.length + 1}`);
    if (!toolCall) continue;
    const callKey = `${String(toolCall.function?.name || "")}\n${String(toolCall.function?.arguments || "")}`;
    if (seenCalls.has(callKey)) continue;
    seenCalls.add(callKey);
    toolCalls.push(toolCall);
    rawBlocks.push(candidate.raw);
  }

  return {
    toolCalls,
    visibleContent: toolCalls.length > 0 ? stripRawToolCallText(source, rawBlocks) : source.trim()
  };
}

function parseToolNameList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);
}

function parseToolStates(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = String(key || "").trim();
    if (!name) continue;
    if (typeof value === "boolean") out[name] = value;
  }
  return out;
}

function matchToolPattern(toolName: string, pattern: string): boolean {
  const t = toolName.toLowerCase();
  const p = pattern.toLowerCase();
  if (!p) return false;
  if (!p.includes("*")) return t === p;
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  try {
    return new RegExp(`^${escaped}$`, "i").test(t);
  } catch {
    return t === p;
  }
}

function filterToolsForModel(
  tools: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>,
  allowlistRaw: unknown,
  denylistRaw: unknown,
  statesRaw: unknown
) {
  const allowlist = parseToolNameList(allowlistRaw);
  const denylist = parseToolNameList(denylistRaw);
  const states = parseToolStates(statesRaw);
  return tools.filter((tool) => {
    const name = String(tool?.function?.name || "").trim();
    if (!name) return false;
    if (states[name] === false) return false;
    const allowed = allowlist.length === 0 || allowlist.some((pattern) => matchToolPattern(name, pattern));
    if (!allowed) return false;
    const denied = denylist.some((pattern) => matchToolPattern(name, pattern));
    return !denied;
  });
}

async function requestChatCompletion(
  provider: ProviderRow,
  modelId: string,
  body: Record<string, unknown>,
  signal: AbortSignal
) {
  const baseUrl = String(provider.base_url || "").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.api_key_cipher}`
    },
    body: JSON.stringify({ model: modelId, ...body }),
    signal
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`[API Error: ${response.status}] ${errText.slice(0, 500)}`);
  }
  return response.json() as Promise<{
    choices?: Array<{
      message?: {
        content?: unknown;
        tool_calls?: OpenAIToolCall[];
      };
    }>;
  }>;
}

async function requestChatCompletionStream(
  provider: ProviderRow,
  modelId: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  onToolEvent?: (event: ToolCallStreamEvent) => void,
  onAssistantDelta?: (delta: string) => void
): Promise<{
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: OpenAIToolCall[];
    };
  }>;
}> {
  const baseUrl = String(provider.base_url || "").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.api_key_cipher}`
    },
    body: JSON.stringify({ model: modelId, ...body, stream: true }),
    signal
  });
  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`[API Error: ${response.status}] ${errText.slice(0, 500)}`);
  }
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("text/event-stream")) {
    throw new Error(`Streaming tool calling unsupported: expected text/event-stream, got ${contentType || "unknown"}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const assistantTextParts: string[] = [];
  const streamedToolCalls = new Map<number, OpenAIToolCall>();
  const startedCallIds = new Set<string>();
  let buffer = "";

  const emitToolDelta = (call: OpenAIToolCall) => {
    const callId = String(call.id || "");
    const args = String(call.function?.arguments || "");
    const name = String(call.function?.name || "").trim() || "tool";
    if (!callId) return;
    if (!startedCallIds.has(callId)) {
      startedCallIds.add(callId);
      onToolEvent?.({
        phase: "start",
        callId,
        name,
        args
      });
      return;
    }
    onToolEvent?.({
      phase: "delta",
      callId,
      name,
      args
    });
  };

  const processEventBlock = (eventBlock: string) => {
    const eventType = extractSseEventType(eventBlock);
    const payload = extractSseEventData(eventBlock);
    if (!payload || payload === "[DONE]") return;
    try {
      const parsed = JSON.parse(payload) as unknown;
      const streamError = extractOpenAiStreamErrorMessage(parsed);
      if (eventType === "error" || streamError) {
        throw new Error(streamError || "Provider stream returned an error event");
      }
      const textDelta = extractOpenAiStreamTextDelta(parsed);
      if (textDelta) {
        assistantTextParts.push(textDelta);
        onAssistantDelta?.(textDelta);
      }
      const toolCallDeltas = extractOpenAiStreamToolCallDeltas(parsed);
      for (const delta of toolCallDeltas) {
        const index = Number.isFinite(delta.index) ? delta.index : streamedToolCalls.size;
        const existing = streamedToolCalls.get(index) || {
          id: delta.id || `tool-call-${index + 1}`,
          type: delta.type || "function",
          function: {
            name: "",
            arguments: ""
          }
        };
        existing.id = delta.id || existing.id || `tool-call-${index + 1}`;
        existing.type = delta.type || existing.type || "function";
        existing.function = existing.function || {};
        if (typeof delta.function?.name === "string" && delta.function.name) {
          existing.function.name = `${String(existing.function.name || "")}${delta.function.name}`;
        }
        if (typeof delta.function?.arguments === "string" && delta.function.arguments) {
          existing.function.arguments = `${String(existing.function.arguments || "")}${delta.function.arguments}`;
        }
        streamedToolCalls.set(index, existing);
        emitToolDelta(existing);
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Malformed provider stream chunk");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const consumed = consumeSseEventBlocks(buffer);
    buffer = consumed.rest;
    for (const eventBlock of consumed.events) {
      processEventBlock(eventBlock);
    }
  }

  const flushed = consumeSseEventBlocks(buffer, true);
  for (const eventBlock of flushed.events) {
    processEventBlock(eventBlock);
  }

  const toolCalls = [...streamedToolCalls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, call]) => call);

  return {
    choices: [{
      message: {
        content: assistantTextParts.join(""),
        tool_calls: toolCalls
      }
    }]
  };
}

export async function runToolCallingCompletion(params: {
  provider: ProviderRow;
  modelId: string;
  samplerConfig: Record<string, unknown>;
  apiMessages: OpenAICompletionMessage[];
  settings: Record<string, unknown>;
  signal: AbortSignal;
  onToolEvent?: (event: ToolCallStreamEvent) => void;
  onAssistantDelta?: (delta: string) => void;
}): Promise<{ content: string; toolCalls: ToolCallTrace[]; streamMessages?: Array<Record<string, unknown>>; assistantWasStreamed?: boolean } | null> {
  const autoAttach = params.settings.mcpAutoAttachTools !== false;
  if (!autoAttach) return null;

  const servers = parseToolServers(params.settings.mcpServers);
  if (!servers.length) return null;

  const mcp = await prepareMcpTools(servers, { signal: params.signal });
  try {
    const exposedTools = filterToolsForModel(
      mcp.tools,
      params.settings.mcpToolAllowlist,
      params.settings.mcpToolDenylist,
      params.settings.mcpToolStates
    );
    if (!exposedTools.length) return null;

    const policy = parseToolCallingPolicy(params.settings.toolCallingPolicy);
    const maxToolCallsRaw = clampToolIterationLimit(params.settings.maxToolCallsPerTurn);
    const maxToolCalls = policy === "conservative" ? Math.min(2, maxToolCallsRaw) : maxToolCallsRaw;
    const policyInstruction = policy === "conservative"
      ? "Use tools only when strictly necessary. If a direct answer is sufficient, do not call tools."
      : policy === "aggressive"
        ? "Prefer using tools when they can improve accuracy, freshness, or completeness of the answer."
        : "Use tools only when they clearly help produce a better answer.";
    const workingMessages = [
      ...params.apiMessages,
      {
        role: "system",
        content: policyInstruction
      }
    ] as Array<Record<string, unknown>>;
    const sc = params.samplerConfig;
    const openAiSampling = buildOpenAiSamplingPayload({
      samplerConfig: sc,
      apiParamPolicy: params.settings.apiParamPolicy,
      fields: ["temperature", "topP", "frequencyPenalty", "presencePenalty", "maxTokens", "stop"],
      defaults: {
        temperature: 0.9,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
        maxTokens: 2048
      }
    });
    const toolTraces: ToolCallTrace[] = [];
    let executedTools = 0;

    while (executedTools < maxToolCalls) {
      let body: Awaited<ReturnType<typeof requestChatCompletion>>;
      let assistantPassWasStreamed = false;
      const completionRequest = {
        messages: workingMessages,
        ...openAiSampling,
        tools: exposedTools,
        ...(policy === "aggressive" ? { tool_choice: "auto" } : {})
      };

      if (executedTools === 0) {
        body = await requestChatCompletion(params.provider, params.modelId, completionRequest, params.signal);
      } else {
        try {
          body = await requestChatCompletionStream(
            params.provider,
            params.modelId,
            completionRequest,
            params.signal,
            params.onToolEvent,
            params.onAssistantDelta
          );
          assistantPassWasStreamed = true;
        } catch (streamErr) {
          const streamMessage = streamErr instanceof Error ? streamErr.message : "";
          if (!/stream|sse|event-stream/i.test(streamMessage)) throw streamErr;
          body = await requestChatCompletion(params.provider, params.modelId, {
            ...completionRequest,
            stream: false
          }, params.signal);
        }
      }

      const assistant = body.choices?.[0]?.message;
      const assistantContent = normalizeAssistantContent(assistant?.content);
      let toolCalls = Array.isArray(assistant?.tool_calls) ? assistant.tool_calls : [];
      let visibleAssistantContent = assistantContent;
      if (toolCalls.length === 0) {
        const extracted = extractTextToolCalls(
          assistantContent,
          exposedTools.map((tool) => tool.function.name)
        );
        toolCalls = extracted.toolCalls;
        visibleAssistantContent = extracted.visibleContent;
      }

      if (toolCalls.length === 0) {
        // Keep the original assistant answer instead of re-running without tools.
        if (executedTools === 0) {
          return { content: visibleAssistantContent, toolCalls: [] };
        }
        return {
          content: visibleAssistantContent,
          toolCalls: toolTraces,
          assistantWasStreamed: assistantPassWasStreamed
        };
      }

      workingMessages.push({
        role: "assistant",
        content: visibleAssistantContent,
        tool_calls: toolCalls
      });

      for (const call of toolCalls) {
        if (executedTools >= maxToolCalls) break;
        const toolName = String(call.function?.name || "");
        const fallbackId = `${toolName || "tool"}_${executedTools + 1}`;
        const toolCallId = String(call.id || fallbackId);
        const toolArgs = String(call.function?.arguments || "");
        params.onToolEvent?.({
          phase: "start",
          callId: toolCallId,
          name: toolName,
          args: toolArgs
        });
        const toolResult = await mcp.executeToolCall(toolName, toolArgs, params.signal);
        params.onToolEvent?.({
          phase: "done",
          callId: toolCallId,
          name: toolName,
          args: toolArgs,
          result: toolResult.traceText
        });
        toolTraces.push({
          callId: toolCallId,
          name: toolName,
          args: toolArgs,
          result: toolResult.traceText
        });
        workingMessages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: toolResult.modelText
        });
        executedTools += 1;
      }
    }

    // Tool-call budget reached: perform final streamed assistant pass in caller.
    return { content: "", toolCalls: toolTraces, streamMessages: workingMessages };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    // If provider doesn't support tools/function calling, fallback to regular streaming flow.
    if (/tool|function.?call|tool_choice|unsupported/i.test(message)) {
      return null;
    }
    throw err;
  } finally {
    await mcp.close();
  }
}

export function serializeToolTrace(trace: ToolCallTrace): string {
  const name = String(trace.name || "unknown_tool").trim();
  const args = String(trace.args || "").trim();
  const result = String(trace.result || "").trim();
  const safeArgs = args ? args.slice(0, 5000) : "{}";
  const safeResult = result ? result.slice(0, 12000) : "(empty)";
  return JSON.stringify({
    kind: "tool_call",
    callId: String(trace.callId || "").trim(),
    name,
    args: safeArgs,
    result: safeResult
  });
}
