import { buildOpenAiSamplingPayload } from "../../services/apiParamPolicy.js";
import { prepareMcpTools, type McpServerConfig } from "../../services/mcp.js";
import type { ProviderRow } from "./routeHelpers.js";

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

export interface ToolCallStreamEvent {
  phase: "start" | "delta" | "done";
  callId: string;
  name: string;
  args: string;
  result?: string;
}

export const REASONING_CALL_NAME = "__reasoning__";

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
        env: String(row.env || ""),
        enabled: row.enabled !== false,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 15000
      } as McpServerConfig;
    })
    .filter((item): item is McpServerConfig => item !== null);
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

export async function runToolCallingCompletion(params: {
  provider: ProviderRow;
  modelId: string;
  samplerConfig: Record<string, unknown>;
  apiMessages: OpenAICompletionMessage[];
  settings: Record<string, unknown>;
  signal: AbortSignal;
  onToolEvent?: (event: ToolCallStreamEvent) => void;
}): Promise<{ content: string; toolCalls: ToolCallTrace[]; streamMessages?: Array<Record<string, unknown>> } | null> {
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
      const body = await requestChatCompletion(params.provider, params.modelId, {
        messages: workingMessages,
        stream: false,
        ...openAiSampling,
        tools: exposedTools,
        ...(policy === "aggressive" ? { tool_choice: "auto" } : {})
      }, params.signal);

      const assistant = body.choices?.[0]?.message;
      const assistantContent = normalizeAssistantContent(assistant?.content);
      const toolCalls = Array.isArray(assistant?.tool_calls) ? assistant.tool_calls : [];

      if (toolCalls.length === 0) {
        // No tool calls on first pass: fallback to standard streaming path.
        if (executedTools === 0) {
          return null;
        }
        // Tools were used already: run a final streamed assistant pass in caller.
        return { content: assistantContent, toolCalls: toolTraces, streamMessages: workingMessages };
      }

      workingMessages.push({
        role: "assistant",
        content: assistantContent,
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
          result: toolResult
        });
        toolTraces.push({
          callId: toolCallId,
          name: toolName,
          args: toolArgs,
          result: toolResult
        });
        workingMessages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: toolResult
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
