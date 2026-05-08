import type { Response } from "express";
import { existsSync, readFileSync, statSync } from "fs";
import { dirname, relative, resolve } from "path";
import { db, isLocalhostUrl, roughTokenCount } from "../../db.js";
import { buildOpenAiSamplingPayload } from "../../services/apiParamPolicy.js";
import { unifiedGenerateText, type UnifiedGenerateMessage } from "../../services/unifiedGeneration.js";
import { prepareMcpTools, type PreparedMcpServerDiagnostic } from "../../services/mcp.js";
import { prepareWorkspaceTools } from "../../services/workspaceTools.js";
import { getContextWindowBudget, getTailBudgetPercent, selectTimelineForPrompt } from "../chat/attachments.js";
import {
  consumeSseEventBlocks,
  extractOpenAiStreamErrorMessage,
  extractOpenAiStreamTextDelta,
  extractSseEventData,
  extractSseEventType
} from "../chat/openAiStream.js";
import { consumeThinkChunk, createThinkStreamState, flushThinkState, splitThinkContent } from "../chat/reasoning.js";
import { getSettings, type ProviderRow } from "../chat/routeHelpers.js";
import { extractOpenAIReasoningDelta, extractOpenAiStreamToolCallDeltas, extractTextToolCalls } from "../chat/tooling.js";
import {
  assignAgentMessageRunId,
  completeAgentRun,
  createAgentRun,
  getAgentThread,
  insertAgentEvent,
  insertAgentMessage,
  listAgentMessages,
  listAgentSkills,
  setAgentThreadStatus,
  updateAgentThreadMemory
} from "./repository.js";

const MAX_HISTORY_MESSAGES = 80;
const MAX_SUBAGENT_DEPTH = 2;
const MAX_TOOL_CALLS_PER_STEP = 4;
const MAX_SUBAGENTS_PER_STEP = 2;
const MAX_PROMPT_MESSAGE_CHARS = 8_000;
const MAX_MEMORY_PROMPT_CHARS = 1_800;
const MAX_SKILL_PROMPT_CHARS = 1_600;
const MAX_COMPACTED_HISTORY_ITEMS = 8;
const MAX_COMPACTED_HISTORY_ITEM_CHARS = 220;
const MAX_PROJECT_INSTRUCTIONS_CHARS = 32 * 1024;
const AGENT_PROJECT_DOC_FILENAMES = ["AGENTS.override.md", "AGENTS.md"];
const READ_ONLY_STALL_THRESHOLD = 2;
const WORKSPACE_READ_ONLY_TOOL_NAMES = new Set([
  "workspace_list_files",
  "workspace_stat_path",
  "workspace_read_file",
  "workspace_search_text",
  "workspace_git_status",
  "workspace_git_diff"
]);
const WORKSPACE_EDIT_TOOL_NAMES = new Set([
  "workspace_write_file",
  "workspace_multi_edit",
  "workspace_insert_text",
  "workspace_replace_text",
  "workspace_make_directory",
  "workspace_move_path",
  "workspace_delete_path"
]);

export const activeAgentAbortControllers = new Map<string, AbortController>();
export const activeAgentSteeringNotes = new Map<string, Array<{
  messageId: string;
  runId: string;
  content: string;
  attachments: unknown[];
  createdAt: string;
}>>();

type AgentSubagentRole = "general" | "research" | "builder" | "reviewer";

type AgentTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type PreparedAgentToolbox = {
  tools: AgentTool[];
  diagnostics: PreparedMcpServerDiagnostic[];
  executeToolCall: (callName: string, rawArgs: string | undefined, signal?: AbortSignal) => Promise<{
    modelText: string;
    traceText: string;
  }>;
  close: () => Promise<void>;
};

type AgentStepResult = {
  summary: string;
  assistantMessage: string;
  status: "continue" | "needs_user" | "done";
  skillIds: string[];
  toolCalls: Array<{ tool: string; arguments: Record<string, unknown>; reason: string }>;
  subagents: Array<{ title: string; goal: string; instructions: string; role: AgentSubagentRole }>;
  updates: string[];
};

type AgentRuntimeToolName = "agent_log_plan" | "agent_refresh_memory";

const AGENT_RUNTIME_TOOL_DEFINITIONS: AgentTool[] = [
  {
    type: "function",
    function: {
      name: "agent_log_plan",
      description: "Record a user-visible step note or plan checkpoint in the trace. Use only when the plan is worth showing.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short label for the plan note." },
          content: { type: "string", description: "The compact plan/checkpoint content to show in the trace." }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agent_refresh_memory",
      description: "Request a durable memory refresh for this run only when the thread memory should materially change.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why this run changed the durable memory." },
          summary: { type: "string", description: "Optional compact memory focus to emphasize during refresh." }
        },
        additionalProperties: false
      }
    }
  }
];

type RuntimeEventWriter = {
  emitEvent: (event: ReturnType<typeof insertAgentEvent>) => void;
  emitMessage: (message: ReturnType<typeof insertAgentMessage>) => void;
  emitDelta: (delta: string) => void;
  emitReasoningDelta: (delta: string) => void;
  getDraft: () => { content: string; reasoning: string };
  clearDraft: () => void;
};

const activeAgentRuntimeWriters = new Map<string, RuntimeEventWriter>();

type AgentLaunchIntent = {
  mode: "resume" | "retry";
  sourceRunId: string;
  sourceStatus: "running" | "done" | "error" | "aborted";
  sourceTitle: string;
};

type AgentRunExecution = {
  stepCount: number;
  toolCalls: number;
  subagents: number;
  planEvents: number;
  usedSynthesis: boolean;
  memoryRefreshRequested: boolean;
};

type AgentRunOutcome = {
  runId: string;
  finalMessage: string;
  reasoning: string;
  summary: string;
  status: "done" | "error" | "aborted";
  streamedResponse: boolean;
  execution: AgentRunExecution;
};

type OpenAIToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

const AGENT_STEP_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Compact internal summary of this planning step."
    },
    assistantMessage: {
      type: "string",
      description: "Concise user-facing message, or an empty string when tool work is needed first."
    },
    status: {
      type: "string",
      enum: ["continue", "needs_user", "done"],
      description: "Use continue when requesting tool/subagent work, needs_user when blocked, done when complete."
    },
    skillIds: {
      type: "array",
      items: { type: "string" },
      description: "Enabled custom skill ids to activate next, if any."
    },
    toolCalls: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tool: {
            type: "string",
            description: "Exact tool name from the tool catalog."
          },
          argumentsJson: {
            type: "string",
            description: "A JSON object string containing the arguments for the selected tool."
          },
          reason: {
            type: "string",
            description: "Why this tool call is the next best action."
          }
        },
        required: ["tool", "argumentsJson", "reason"],
        additionalProperties: false
      },
      description: "Tool calls the runtime should execute before finalizing."
    },
    subagents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          goal: { type: "string" },
          instructions: { type: "string" },
          role: {
            type: "string",
            enum: ["general", "research", "builder", "reviewer"]
          }
        },
        required: ["title", "goal", "instructions", "role"],
        additionalProperties: false
      },
      description: "Bounded side tasks to delegate, if any."
    },
    updates: {
      type: "array",
      items: { type: "string" },
      description: "Short trace updates worth showing or remembering."
    }
  },
  required: ["summary", "assistantMessage", "status", "skillIds", "toolCalls", "subagents", "updates"],
  additionalProperties: false
} as const;

const FOLLOWUP_INTENT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["continuation", "new_task", "unclear"],
      description: "Whether the latest user message continues the prior task, starts a new task, or is unclear."
    },
    confidence: {
      type: "number",
      description: "Classifier confidence from 0 to 1."
    },
    reason: {
      type: "string",
      description: "Short reason for the classification."
    }
  },
  required: ["intent", "confidence", "reason"],
  additionalProperties: false
} as const;

type AgentPromptHistorySelection = {
  history: UnifiedGenerateMessage[];
  compactedNote: string;
};

type AgentPromptHistoryItem = {
  role: string;
  originalContent: UnifiedGenerateMessage["content"];
  content: string;
  tokenCount: number;
};

export function enqueueAgentSteeringNote(input: {
  threadId: string;
  messageId: string;
  runId: string;
  content: string;
  attachments?: unknown[];
  createdAt?: string;
}) {
  const queue = activeAgentSteeringNotes.get(input.threadId) || [];
  queue.push({
    messageId: input.messageId,
    runId: input.runId,
    content: sanitizeText(input.content, 12000),
    attachments: Array.isArray(input.attachments) ? input.attachments.slice(0, 12) : [],
    createdAt: sanitizeText(input.createdAt, 80) || new Date().toISOString()
  });
  activeAgentSteeringNotes.set(input.threadId, queue);
}

function flushSse(res: Response) {
  if (typeof (res as Response & { flush?: () => void }).flush === "function") {
    (res as Response & { flush?: () => void }).flush?.();
  }
}

function beginSse(res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders?.();
}

function sendSsePayload(res: Response, payload: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  flushSse(res);
}

function sendDone(res: Response) {
  sendSsePayload(res, { type: "done" });
  res.end();
}

function sanitizeText(raw: unknown, maxLength: number) {
  return String(raw ?? "").trim().slice(0, maxLength);
}

function isAbortLikeMessage(message: string) {
  const normalized = String(message || "").trim().toLowerCase();
  return normalized === "aborted"
    || normalized === "aborterror"
    || normalized.includes("aborted")
    || normalized.includes("aborterror")
    || normalized.includes("operation was aborted");
}

function normalizeOpenAiBaseUrl(raw: string) {
  const trimmed = String(raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function providerSupportsDeveloperRole(provider: ProviderRow) {
  return /(^https?:\/\/)?([a-z0-9-]+\.)*openai\.com(\/|$)/i.test(String(provider.base_url || "").trim());
}

function normalizeChatCompletionRole(role: string, provider: ProviderRow) {
  if (role === "developer" && !providerSupportsDeveloperRole(provider)) {
    return "system";
  }
  return role;
}

function normalizeAssistantContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const row = item as { type?: unknown; text?: unknown };
        return row.type === "text" ? String(row.text ?? "") : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (content === null || content === undefined) return "";
  return String(content).trim();
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
  return [
    row.reasoning,
    row.reasoning_content,
    row.reasoning_text,
    row.reasoningText,
    row.thinking,
    row.thinking_content,
    row.thinking_text,
    row.thinkingText,
    row.output_text
  ]
    .map((item) => flattenReasoningValue(item))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractOpenAiCompletionReasoning(body: {
  reasoning?: unknown;
  reasoning_content?: unknown;
  reasoning_text?: unknown;
  reasoningText?: unknown;
  thinking?: unknown;
  thinking_content?: unknown;
  thinking_text?: unknown;
  thinkingText?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
      reasoning?: unknown;
      reasoning_content?: unknown;
      reasoning_text?: unknown;
      reasoningText?: unknown;
      thinking?: unknown;
      thinking_content?: unknown;
      thinking_text?: unknown;
      thinkingText?: unknown;
    };
  }>;
}): string {
  const message = body.choices?.[0]?.message;
  const directReasoning = [
    body.reasoning,
    body.reasoning_content,
    body.reasoning_text,
    body.reasoningText,
    body.thinking,
    body.thinking_content,
    body.thinking_text,
    body.thinkingText,
    message?.reasoning,
    message?.reasoning_content,
    message?.reasoning_text,
    message?.reasoningText,
    message?.thinking,
    message?.thinking_content,
    message?.thinking_text,
    message?.thinkingText
  ]
    .map((item) => flattenReasoningValue(item))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const split = splitThinkContent(normalizeAssistantContent(message?.content));
  return [directReasoning, split.reasoning].filter(Boolean).join("\n\n").trim();
}

function normalizeBoundedInteger(raw: unknown, fallback: number, min: number, max: number) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function compactWhitespace(text: string) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function trimPromptText(raw: unknown, maxLength: number) {
  return sanitizeText(String(raw ?? "").replace(/\r\n?/g, "\n"), maxLength);
}

function trimToolContext(raw: unknown, maxLength: number) {
  const text = trimPromptText(raw, Math.max(400, maxLength * 2));
  if (!text) return "";
  if (text.length <= maxLength) return text;
  const head = text.slice(0, Math.max(160, Math.floor(maxLength * 0.7))).trimEnd();
  const tail = text.slice(-Math.max(100, Math.floor(maxLength * 0.18))).trimStart();
  return `${head}\n\n...[tool output compacted]...\n\n${tail}`.slice(0, maxLength + 80);
}

function buildCompactedHistoryNote(messages: Array<{ role: string; content: string }>) {
  if (messages.length === 0) return "";
  const selected = messages
    .filter((message) => compactWhitespace(message.content))
    .slice(-MAX_COMPACTED_HISTORY_ITEMS)
    .map((message) => {
      const role = message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user";
      return `- ${role}: ${sanitizeText(compactWhitespace(message.content), MAX_COMPACTED_HISTORY_ITEM_CHARS)}`;
    })
    .filter(Boolean);
  if (selected.length === 0) return "";
  const omittedCount = Math.max(0, messages.length - selected.length);
  return [
    "Compacted earlier thread context:",
    omittedCount > 0 ? `- Omitted earlier turns: ${omittedCount}` : "",
    ...selected
  ].filter(Boolean).join("\n");
}

function buildAttachmentParts(attachments: Array<Record<string, unknown>> | undefined) {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  const parts: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> = [];
  const textAttachments = attachments
    .filter((item) => item?.type === "text" && typeof item.content === "string" && String(item.content || "").trim())
    .map((item) => {
      const filename = sanitizeText(item.filename, 180) || "attachment.txt";
      const content = sanitizeText(item.content, 4000);
      return `[${filename}]\n${content}`;
    });
  if (textAttachments.length > 0) {
    parts.push({
      type: "text",
      text: `\n\n---\n[Attached files]\n${textAttachments.join("\n\n")}`
    });
  }
  for (const attachment of attachments) {
    if (attachment?.type !== "image") continue;
    const dataUrl = sanitizeText(attachment.dataUrl, 15 * 1024 * 1024);
    if (!dataUrl.startsWith("data:image/")) continue;
    parts.push({
      type: "image_url",
      image_url: { url: dataUrl }
    });
  }
  return parts;
}

function buildPromptContentWithAttachments(content: unknown, attachments: Array<Record<string, unknown>> | undefined): UnifiedGenerateMessage["content"] {
  const baseText = trimPromptText(content, MAX_PROMPT_MESSAGE_CHARS);
  const attachmentParts = buildAttachmentParts(
    Array.isArray(attachments) ? attachments : undefined
  );
  if (attachmentParts.length === 0) {
    return baseText;
  }
  return [
    {
      type: "text" as const,
      text: baseText.trim() ? baseText : "[Attachment message]"
    },
    ...attachmentParts
  ];
}

function buildAgentMessagePromptContent(message: ReturnType<typeof listAgentMessages>[number]): UnifiedGenerateMessage["content"] {
  return buildPromptContentWithAttachments(
    message.content,
    Array.isArray(message.attachments) ? message.attachments as Array<Record<string, unknown>> : undefined
  );
}

function buildSteeringNoteSummary(note: {
  content: string;
  attachments: unknown[];
  createdAt: string;
}) {
  const lines = ["User correction received during the active run."];
  const content = sanitizeText(note.content, 4000);
  if (content) {
    lines.push(content);
  }
  const attachments = Array.isArray(note.attachments)
    ? note.attachments.filter((item) => item && typeof item === "object").slice(0, 6) as Array<Record<string, unknown>>
    : [];
  if (attachments.length > 0) {
    const attachmentSummary = attachments
      .map((attachment) => {
        const filename = sanitizeText(attachment.filename, 160) || "attachment";
        if (attachment.type === "text" && typeof attachment.content === "string") {
          return `${filename}: ${sanitizeText(attachment.content, 400)}`;
        }
        if (attachment.type === "image") {
          return `${filename}: [Image attachment]`;
        }
        return filename;
      })
      .filter(Boolean)
      .join("\n");
    if (attachmentSummary) {
      lines.push(`Attachments:\n${attachmentSummary}`);
    }
  }
  const createdAt = sanitizeText(note.createdAt, 80);
  if (createdAt) {
    lines.push(`Received at: ${createdAt}`);
  }
  return lines.join("\n\n");
}

function flattenPromptContent(content: UnifiedGenerateMessage["content"]) {
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

function shouldIncludeAgentMessageInPromptHistory(message: ReturnType<typeof listAgentMessages>[number]) {
  if (message.role === "system" && message.metadata?.hidden) return false;
  if (message.role === "assistant" && message.metadata?.intermediate === true) return false;
  if (message.role === "assistant" && message.metadata?.interrupted === true) return false;
  if (message.role === "user" && message.metadata?.followupIntent === "continuation") return false;
  if (message.role === "user" && message.metadata?.steering === true) {
    const content = compactWhitespace(message.content);
    return content.length > 0 && content.length > 24;
  }
  return true;
}

function buildPromptHistory(params: {
  threadId: string;
  settings: ReturnType<typeof getSettings>;
  fixedContent: string[];
}): AgentPromptHistorySelection {
  const history: AgentPromptHistoryItem[] = listAgentMessages(params.threadId, MAX_HISTORY_MESSAGES)
    .filter(shouldIncludeAgentMessageInPromptHistory)
    .map((message) => {
      const originalContent = buildAgentMessagePromptContent(message);
      const content = flattenPromptContent(originalContent);
      return {
        role: message.role,
        originalContent,
        content,
        tokenCount: roughTokenCount(content)
      };
    })
    .filter((message) => message.content);
  if (history.length === 0) {
    return { history: [], compactedNote: "" };
  }

  const reserveTokens = normalizeBoundedInteger(
    params.settings.agentReplyReserveTokens,
    1400,
    256,
    12000
  );
  const fixedTokenCost = params.fixedContent
    .filter(Boolean)
    .reduce((sum, item) => sum + roughTokenCount(String(item || "")), 0);
  const contextBudget = Math.max(
    512,
    getContextWindowBudget(params.settings) - reserveTokens - fixedTokenCost
  );
  const selected = selectTimelineForPrompt(
    history,
    "",
    contextBudget,
    getTailBudgetPercent(params.settings, "contextTailBudgetWithSummaryPercent", 35),
    getTailBudgetPercent(params.settings, "contextTailBudgetWithoutSummaryPercent", 75)
  ) as AgentPromptHistoryItem[];
  const selectedMessages = selected.map((message) => ({
    role: message.role,
    content: message.originalContent
  }));
  const droppedCount = Math.max(0, history.length - selectedMessages.length);
  if (droppedCount === 0 || params.settings.agentAutoCompactEnabled === false) {
    return {
      history: selectedMessages.map((message) => ({ role: message.role as UnifiedGenerateMessage["role"], content: message.content })),
      compactedNote: ""
    };
  }

  let compactedNote = buildCompactedHistoryNote(history.slice(0, droppedCount));
  let compactedTokens = roughTokenCount(compactedNote);
  let selectedTokens = selectedMessages.reduce((sum, message) => sum + roughTokenCount(flattenPromptContent(message.content)), 0);
  let trimmedSelected = [...selectedMessages];
  while (trimmedSelected.length > 1 && compactedTokens + selectedTokens > contextBudget) {
    const removed = trimmedSelected.shift();
    selectedTokens -= removed ? roughTokenCount(flattenPromptContent(removed.content)) : 0;
    compactedNote = buildCompactedHistoryNote(history.slice(0, history.length - trimmedSelected.length));
    compactedTokens = roughTokenCount(compactedNote);
  }

  return {
    history: trimmedSelected.map((message) => ({ role: message.role as UnifiedGenerateMessage["role"], content: message.content })),
    compactedNote
  };
}

function latestUserMessageText(threadId: string) {
  const messages = listAgentMessages(threadId, 12);
  return [...messages].reverse().find((message) => message.role === "user")?.content.trim() || "";
}

function drainSteeringNotes(threadId: string, runId: string) {
  const queue = activeAgentSteeringNotes.get(threadId) || [];
  if (queue.length === 0) return [];
  const matching = queue.filter((note) => note.runId === runId);
  const remaining = queue.filter((note) => note.runId !== runId);
  if (remaining.length > 0) {
    activeAgentSteeringNotes.set(threadId, remaining);
  } else {
    activeAgentSteeringNotes.delete(threadId);
  }
  return matching;
}

function applySteeringNotes(params: {
  threadId: string;
  runId: string;
  writeEvent?: (type: string, title: string, content?: string, payload?: Record<string, unknown>) => void;
  scratchpad?: string[];
  toolLoopMessages?: Array<Record<string, unknown>>;
}) {
  const notes = drainSteeringNotes(params.threadId, params.runId);
  if (notes.length === 0) return 0;
  notes.forEach((note, index) => {
    const summary = buildSteeringNoteSummary(note);
    params.writeEvent?.("status", "User correction received", summary, {
      messageId: note.messageId,
      steering: true,
      sequence: index + 1
    });
    params.scratchpad?.push("[User correction]\nA new user correction arrived after the run started. Re-read the latest user message and incorporate it before continuing.");
    params.toolLoopMessages?.push({
      role: "user",
      content: buildPromptContentWithAttachments(
        note.content || "[Correction message]",
        Array.isArray(note.attachments) ? note.attachments as Array<Record<string, unknown>> : undefined
      )
    });
  });
  return notes.length;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || "",
    (() => {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      return start >= 0 && end > start ? trimmed.slice(start, end + 1) : "";
    })()
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function toolCallCacheKey(toolName: string, rawArgs: string) {
  const parsedArgs = parseJsonObject(rawArgs);
  const normalizedArgs = parsedArgs ? stableStringify(parsedArgs) : sanitizeText(compactWhitespace(rawArgs), 3000);
  return `${toolName}\n${normalizedArgs}`;
}

function insertAndEmitAssistantMessage(params: {
  threadId: string;
  runId: string;
  content: string;
  reasoning?: string;
  metadata?: Record<string, unknown>;
  writer?: RuntimeEventWriter;
}) {
  const content = sanitizeText(params.content, 12000);
  const reasoning = sanitizeText(params.reasoning, 12000);
  if (!content && !reasoning) return null;
  const message = insertAgentMessage({
    threadId: params.threadId,
    runId: params.runId,
    role: "assistant",
    content,
    metadata: {
      ...(params.metadata || {}),
      reasoning: reasoning || undefined
    }
  });
  if (message) {
    params.writer?.emitMessage(message);
    params.writer?.clearDraft();
  }
  return message;
}

function extractJsonStringField(raw: string, fieldNames: string[], maxLength: number) {
  const source = String(raw || "");
  for (const fieldName of fieldNames) {
    const match = source.match(new RegExp(`"${fieldName}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i"));
    if (!match?.[1]) continue;
    try {
      return sanitizeText(JSON.parse(`"${match[1]}"`), maxLength);
    } catch {
      return sanitizeText(
        match[1]
          .replace(/\\"/g, "\"")
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\\\/g, "\\"),
        maxLength
      );
    }
  }
  return "";
}

function salvageAgentStep(raw: string): AgentStepResult | null {
  const summary = extractJsonStringField(raw, ["summary"], 600);
  const assistantMessage = extractJsonStringField(raw, ["assistantMessage", "assistant_message", "message"], 8000);
  const statusMatch = String(raw || "").match(/"status"\s*:\s*"(continue|needs_user|done)"/i);
  const rawStatus = statusMatch?.[1]?.toLowerCase();
  const status = rawStatus === "continue" || rawStatus === "needs_user" ? rawStatus : "done";
  if (!summary && !assistantMessage) return null;
  return {
    summary,
    assistantMessage,
    status,
    skillIds: [],
    toolCalls: [],
    subagents: [],
    updates: []
  };
}

function normalizeStringArray(raw: unknown, maxItems: number, maxLength = 160): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => sanitizeText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeToolCalls(raw: unknown): Array<{ tool: string; arguments: Record<string, unknown>; reason: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_TOOL_CALLS_PER_STEP)
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const row = item as Record<string, unknown>;
      const tool = sanitizeText(row.tool ?? row.name, 200);
      const reason = sanitizeText(row.reason ?? row.why, 400);
      const args = [row.arguments, row.args, row.argumentsJson, row.arguments_json]
        .reduce<Record<string, unknown> | null>((current, candidate) => {
          if (current) return current;
          if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
            return candidate as Record<string, unknown>;
          }
          if (typeof candidate === "string") {
            return parseJsonObject(candidate);
          }
          return null;
        }, null) || {};
      if (!tool) return null;
      return { tool, arguments: args, reason };
    })
    .filter((item): item is { tool: string; arguments: Record<string, unknown>; reason: string } => item !== null);
}

function isAgentRuntimeToolName(toolName: string): toolName is AgentRuntimeToolName {
  return toolName === "agent_log_plan" || toolName === "agent_refresh_memory";
}

function normalizeSubagentRole(raw: unknown): AgentSubagentRole {
  return raw === "research" || raw === "builder" || raw === "reviewer" ? raw : "general";
}

function normalizeSubagents(raw: unknown): Array<{ title: string; goal: string; instructions: string; role: AgentSubagentRole }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_SUBAGENTS_PER_STEP)
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const row = item as Record<string, unknown>;
      const title = sanitizeText(row.title, 140);
      const goal = sanitizeText(row.goal, 600);
      const instructions = sanitizeText(row.instructions ?? row.brief, 1500);
      const role = normalizeSubagentRole(row.role);
      if (!title || !goal) return null;
      return { title, goal, instructions, role };
    })
    .filter((item): item is { title: string; goal: string; instructions: string; role: AgentSubagentRole } => item !== null);
}

function normalizeAgentStep(raw: Record<string, unknown>): AgentStepResult {
  return {
    summary: sanitizeText(raw.summary, 600),
    assistantMessage: sanitizeText(raw.assistantMessage ?? raw.assistant_message ?? raw.message, 8000),
    status: raw.status === "continue" || raw.status === "needs_user" ? raw.status : "done",
    skillIds: normalizeStringArray(raw.skillIds ?? raw.skill_ids, 6, 120),
    toolCalls: normalizeToolCalls(raw.toolCalls ?? raw.tool_calls),
    subagents: normalizeSubagents(raw.subagents ?? raw.sub_agents),
    updates: normalizeStringArray(raw.updates ?? raw.plan, 8, 300)
  };
}

function messageLooksLikeIntermediateProgress(message: string) {
  const normalized = compactWhitespace(String(message || "")).toLowerCase();
  if (!normalized) return false;
  const startsLikeProgress = /^(first|first,|next|next,|i(?:'|’)ll|i will|let me|starting by|going to|ok|okay|got it|understood|working on it|need to start|need to begin|i need to|i should|сначала|сперва|для начала|сейчас|сначала быстро|я сначала|я посмотрю|я проверю|понял|поняла|ок|хорошо|приступаю|начну|начинаю|начинаем|продолжаю|нужно начать|надо начать|нужно сначала|надо сначала|нужно продолжить|надо продолжить|сейчас посмотрю|сейчас проверю|посмотрю|проверю|осмотрю)/i.test(normalized);
  const hasProgressVerb = /(inspect|check|look|review|search|read|open|edit|change|update|fix|implement|run|compare|start|begin|analy[sz]e|create|write|build|посмотр|провер|изучу|откро|внес|исправ|обнов|запущ|сравн|проанализ|начн|приступ|сделаю|осмотр|созда|напиш|собер|подготов|выполн)/i.test(normalized);
  const soundsFinal = /(done|completed|finished|implemented|fixed|updated|here('| i)?s|result|готово|сделал|заверш|исправил|обновил|итог|результат|наш[её]л|подготовил)/i.test(normalized);
  return startsLikeProgress && hasProgressVerb && !soundsFinal;
}

export function isPotentialAgentFollowupCueText(rawInput: unknown) {
  const source = String(rawInput || "").replace(/\r\n?/g, "\n").trim();
  const normalized = compactWhitespace(source).toLowerCase();
  if (!normalized || normalized.length > 180) return false;
  if (source.includes("\n") || /[?？]/.test(source)) return false;
  if (/[-_]/.test(source)) return false;
  if (/```|https?:\/\/|www\.|[{}[\]();=<>]/i.test(source)) return false;
  if (/(?:^|[\s/\\])[\w.-]+\.(?:ts|tsx|js|jsx|json|md|css|html|py|go|rs|java|kt|swift|c|cpp|h|hpp|toml|yaml|yml)(?:\b|$)/i.test(source)) return false;

  const tokens = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu) || [];
  if (tokens.length === 0 || tokens.length > 8) return false;
  if (tokens.some((token) => token.length > 36)) return false;
  return true;
}

function userAskedForAPlan(rawInput: string) {
  const normalized = compactWhitespace(String(rawInput || "")).toLowerCase();
  if (!normalized) return false;
  return /(plan|outline|what would you do|what will you do|how would you approach|спланиру|план|опиши шаги|что будешь делать|как будешь делать)/i.test(normalized);
}

function userAskedForExecution(rawInput: string) {
  const normalized = compactWhitespace(String(rawInput || "")).toLowerCase();
  if (!normalized) return false;
  return /(fix|implement|change|update|edit|review|inspect|search|find|run|build|test|refactor|open|look at|workspace|project|repo|code|landing|page|style|css|html|исправ|сделай|реализ|обнов|измени|проверь|посмотр|найди|запусти|проект|код|лендинг|страниц|css|html)/i.test(normalized);
}

function userAskedForWorkspaceMutation(rawInput: string) {
  const normalized = compactWhitespace(String(rawInput || "")).toLowerCase();
  if (!normalized) return false;
  if (/(do not edit|don't edit|without editing|no file changes|only explain|только объясни|не редактируй|без изменений|не меняй файлы|в чат)/i.test(normalized)) {
    return false;
  }
  return /(fix|implement|change|update|edit|write|create|add|remove|delete|refactor|modify|patch|make|style|css|html|landing|page|component|исправ|сделай|реализ|обнов|измени|добав|удал|созд|напиши|поправ|редач|отрефактор|сверст|верстк|стил|лендинг|страниц|компонент|код)/i.test(normalized);
}

function messageLooksLikeCodeInsteadOfWorkspaceEdit(message: string) {
  const source = String(message || "").trim();
  if (!source) return false;
  const hasCodeFence = /```/.test(source);
  const hasCodeShape = /(<[a-z][\s\S]*>|(?:^|\n)\s*(?:const|let|var|function|class|interface|type|import|export)\s|(?:^|\n)\s*[.#]?[A-Za-z0-9_-]+\s*\{)/.test(source);
  const suggestsManualApply = /(paste|replace|put this|use this code|copy this|встав|замени|скопируй|используй этот код|код ниже)/i.test(source);
  return hasCodeFence || (hasCodeShape && suggestsManualApply);
}

function hasWorkspaceEditTools(toolbox: PreparedAgentToolbox | null | undefined) {
  return Boolean(toolbox?.tools.some((tool) => WORKSPACE_EDIT_TOOL_NAMES.has(sanitizeText(tool.function.name, 200))));
}

function isReadOnlyWorkspaceTool(toolName: string) {
  return WORKSPACE_READ_ONLY_TOOL_NAMES.has(toolName);
}

function isWorkspaceEditTool(toolName: string) {
  return WORKSPACE_EDIT_TOOL_NAMES.has(toolName);
}

function shouldContinueAfterIntermediateReply(params: {
  threadId: string;
  stepResult: AgentStepResult;
  toolbox: PreparedAgentToolbox | null;
  step: number;
  maxIterations: number;
}) {
  if (params.step >= params.maxIterations) return false;
  if (!params.toolbox?.tools.length) return false;
  if (params.stepResult.status !== "done") return false;
  if (params.stepResult.toolCalls.length > 0 || params.stepResult.subagents.length > 0) return false;
  if (!messageLooksLikeIntermediateProgress(params.stepResult.assistantMessage)) return false;
  const thread = getAgentThread(params.threadId);
  if (thread?.mode === "ask") return false;
  const latestInput = latestUserMessageText(params.threadId);
  if (!userAskedForExecution(latestInput)) return false;
  if (userAskedForAPlan(latestInput)) return false;
  return true;
}

function shouldContinueDirectToolLoopAfterIntermediateReply(params: {
  threadId: string;
  message: string;
  toolbox: PreparedAgentToolbox | null;
  assistantPasses: number;
  maxAssistantPasses: number;
}) {
  if (params.assistantPasses >= params.maxAssistantPasses) return false;
  if (!params.toolbox?.tools.length) return false;
  if (!messageLooksLikeIntermediateProgress(params.message)) return false;
  const thread = getAgentThread(params.threadId);
  if (thread?.mode === "ask") return false;
  const latestInput = latestUserMessageText(params.threadId);
  if (!userAskedForExecution(latestInput)) return false;
  if (userAskedForAPlan(latestInput)) return false;
  return true;
}

function parseToolNameList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => sanitizeText(item, 200).toLowerCase())
    .filter(Boolean);
}

function parseToolStates(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = sanitizeText(key, 200);
    if (!name || typeof value !== "boolean") continue;
    out[name] = value;
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

function filterTools(tools: AgentTool[], allowlistRaw: unknown, denylistRaw: unknown, statesRaw: unknown) {
  const allowlist = parseToolNameList(allowlistRaw);
  const denylist = parseToolNameList(denylistRaw);
  const states = parseToolStates(statesRaw);
  return tools.filter((tool) => {
    const name = sanitizeText(tool?.function?.name, 200);
    if (!name) return false;
    if (states[name] === false) return false;
    const allowed = allowlist.length === 0 || allowlist.some((pattern) => matchToolPattern(name, pattern));
    if (!allowed) return false;
    const denied = denylist.some((pattern) => matchToolPattern(name, pattern));
    return !denied;
  });
}

async function prepareToolbox(threadId: string): Promise<PreparedAgentToolbox | null> {
  const thread = getAgentThread(threadId);
  const settings = getSettings();
  if (!thread || thread.toolMode === "disabled") return null;
  const toolboxes: Array<{
    tools: AgentTool[];
    diagnostics: PreparedMcpServerDiagnostic[];
    executeToolCall: PreparedAgentToolbox["executeToolCall"];
    close: PreparedAgentToolbox["close"];
  }> = [];

  const includeFileTools = settings.agentWorkspaceToolsEnabled !== false;
  const includeCommandTool = settings.agentCommandToolEnabled !== false;
  if (includeFileTools || includeCommandTool) {
    const workspaceTools = prepareWorkspaceTools(thread.workspaceRoot || process.cwd(), {
      includeFileTools,
      includeCommandTool,
      securityPolicy: {
        allowDangerousFileOps: settings.agentDangerousFileOpsEnabled === true,
        allowNetworkCommands: settings.agentNetworkCommandsEnabled === true,
        allowShellCommands: settings.agentShellCommandsEnabled === true,
        allowGitWriteCommands: settings.agentGitWriteCommandsEnabled === true
      }
    });
    toolboxes.push({
      tools: workspaceTools.tools as AgentTool[],
      diagnostics: [],
      executeToolCall: workspaceTools.executeToolCall,
      close: workspaceTools.close
    });
  }

  const servers = Array.isArray(settings.mcpServers) ? settings.mcpServers : [];
  if (servers.length > 0) {
    const prepared = await prepareMcpTools(servers);
    const filtered = filterTools(
      prepared.tools as AgentTool[],
      settings.mcpToolAllowlist,
      settings.mcpToolDenylist,
      settings.mcpToolStates
    );
    toolboxes.push({
      tools: filtered,
      diagnostics: prepared.diagnostics,
      executeToolCall: prepared.executeToolCall,
      close: prepared.close
    });
  }

  if (toolboxes.length === 0) return null;
  const registry = new Map<string, typeof toolboxes[number]>();
  const mergedTools: AgentTool[] = [];
  const diagnostics: PreparedMcpServerDiagnostic[] = [];
  for (const toolbox of toolboxes) {
    diagnostics.push(...toolbox.diagnostics);
    for (const tool of toolbox.tools) {
      const name = sanitizeText(tool?.function?.name, 200);
      if (!name || registry.has(name)) continue;
      registry.set(name, toolbox);
      mergedTools.push(tool);
    }
  }

  if (mergedTools.length === 0 && diagnostics.length === 0) {
    await Promise.all(toolboxes.map((toolbox) => toolbox.close().catch(() => undefined)));
    return null;
  }

  return {
    tools: mergedTools,
    diagnostics,
    executeToolCall: async (callName, rawArgs, signal) => {
      const target = registry.get(callName);
      if (!target) {
        return {
          modelText: `Tool not found: ${callName}`,
          traceText: `Tool not found: ${callName}`
        };
      }
      return target.executeToolCall(callName, rawArgs, signal);
    },
    close: async () => {
      await Promise.all(toolboxes.map((toolbox) => toolbox.close().catch(() => undefined)));
    }
  };
}

function resolveProviderForThread(threadId: string) {
  const thread = getAgentThread(threadId);
  const settings = getSettings();
  const providerId = sanitizeText(thread?.providerId ?? settings.activeProviderId, 120);
  const modelId = sanitizeText(thread?.modelId ?? settings.activeModel, 200);
  const provider = providerId
    ? db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId) as ProviderRow | undefined
    : undefined;
  return { provider, modelId, settings };
}

function buildToolCatalog(tools: AgentTool[], runtimeTools: AgentTool[] = []) {
  const combinedTools = [...runtimeTools, ...tools];
  if (combinedTools.length === 0) return "No tools available.";
  const visibleTools = combinedTools.slice(0, 28);
  const catalog = visibleTools.map((tool) => {
    const schema = sanitizeText(JSON.stringify(tool.function.parameters || {}), 260);
    return `- ${tool.function.name}: ${tool.function.description}\n  parameters: ${schema}`;
  });
  if (combinedTools.length > visibleTools.length) {
    catalog.push(`- ... ${combinedTools.length - visibleTools.length} more tools available.`);
  }
  return catalog.join("\n");
}

function buildSkillCatalog(skills: ReturnType<typeof listAgentSkills>) {
  if (skills.length === 0) return "No custom skills available.";
  return skills
    .filter((skill) => skill.enabled)
    .slice(0, 8)
    .map((skill) => `- ${skill.id}: ${skill.name} — ${sanitizeText(skill.description, 140)}`)
    .join("\n") || "No enabled skills available.";
}

function buildActiveSkillInstructions(skills: ReturnType<typeof listAgentSkills>, activeSkillIds: string[]) {
  const selected = skills.filter((skill) => skill.enabled && activeSkillIds.includes(skill.id));
  if (selected.length === 0) return "";
  return selected
    .map((skill) => `[${skill.name}]\n${trimPromptText(skill.instructions, MAX_SKILL_PROMPT_CHARS)}`)
    .join("\n\n");
}

function buildEnabledSkillInstructions(threadId: string) {
  const skills = listAgentSkills(threadId)
    .filter((skill) => skill.enabled)
    .map((skill) => `[${skill.name}]\n${trimPromptText(skill.instructions, MAX_SKILL_PROMPT_CHARS)}`);
  return skills.join("\n\n");
}

function buildScratchpadText(scratchpad: string[]) {
  if (scratchpad.length === 0) return "No prior run steps yet.";
  return scratchpad.slice(-6).map((item) => trimPromptText(item, 1400)).join("\n\n");
}

function normalizeToolLoopMessagesForPlainCompletion(messages: Array<Record<string, unknown>>): UnifiedGenerateMessage[] {
  return messages
    .map((message) => {
      const role = String(message.role || "user");
      const content = message.content as UnifiedGenerateMessage["content"];
      if (role === "tool") {
        const toolCallId = sanitizeText(message.tool_call_id, 200);
        const toolText = flattenPromptContent(content).trim();
        return {
          role: "user",
          content: [
            `[Tool result${toolCallId ? `: ${toolCallId}` : ""}]`,
            toolText || "[Tool returned no visible output.]"
          ].join("\n")
        };
      }
      if (role === "assistant" && Array.isArray(message.tool_calls)) {
        const assistantText = flattenPromptContent(content).trim();
        const toolNames = (message.tool_calls as OpenAIToolCall[])
          .map((call) => sanitizeText(call.function?.name, 200))
          .filter(Boolean);
        return {
          role: "assistant",
          content: [
            assistantText,
            toolNames.length > 0 ? `[Requested tools: ${toolNames.join(", ")}]` : "[Requested workspace tools]"
          ].filter(Boolean).join("\n\n")
        };
      }
      return {
        role,
        content
      };
    })
    .filter((message) => flattenPromptContent(message.content).trim());
}

function buildMemoryNote(threadId: string) {
  const thread = getAgentThread(threadId);
  const summary = sanitizeText(thread?.memorySummary, MAX_MEMORY_PROMPT_CHARS);
  if (!summary) return "";
  return [
    "Durable thread memory:",
    summary
  ].join("\n");
}

function findInstructionRoot(startDir: string) {
  let current = resolve(startDir || process.cwd());
  while (true) {
    if (existsSync(resolve(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }
}

function buildProjectInstructionsNote(threadId: string) {
  const thread = getAgentThread(threadId);
  const workspaceRoot = sanitizeText(thread?.workspaceRoot, 1200) || process.cwd();
  const instructionRoot = findInstructionRoot(workspaceRoot);
  const directories: string[] = [];
  let cursor = resolve(workspaceRoot);
  while (true) {
    directories.push(cursor);
    if (cursor === instructionRoot) break;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  directories.reverse();

  const sections: string[] = [];
  let consumedChars = 0;
  for (const directory of directories) {
    for (const filename of AGENT_PROJECT_DOC_FILENAMES) {
      const filePath = resolve(directory, filename);
      try {
        if (!statSync(filePath).isFile()) continue;
        const raw = readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n").trim();
        if (!raw) continue;
        const relativePath = relative(instructionRoot, filePath).split("\\").join("/") || filename;
        const availableChars = MAX_PROJECT_INSTRUCTIONS_CHARS - consumedChars;
        if (availableChars <= 0) break;
        const content = raw.length > availableChars
          ? `${raw.slice(0, Math.max(0, availableChars - 18))}\n\n[Instructions truncated]`
          : raw;
        const section = `[${relativePath}]\n${content}`;
        sections.push(section);
        consumedChars += section.length + 2;
      } catch {
        // Ignore unreadable instruction files.
      }
    }
    if (consumedChars >= MAX_PROJECT_INSTRUCTIONS_CHARS) break;
  }

  if (sections.length === 0) return "";
  return [
    "Project instructions collected from scoped AGENTS files. More specific files appear later and take precedence when they conflict.",
    ...sections
  ].join("\n\n");
}

function buildEnvironmentContextNote(threadId: string) {
  const thread = getAgentThread(threadId);
  const workspaceRoot = sanitizeText(thread?.workspaceRoot, 1200) || process.cwd();
  const shell = sanitizeText(process.env.SHELL, 120) || "sh";
  return [
    "<environment_context>",
    `  <cwd>${workspaceRoot}</cwd>`,
    `  <shell>${shell}</shell>`,
    "</environment_context>",
    "This selected workspace root is the default working folder for file tools and workspace commands."
  ].join("\n");
}

function buildDeveloperMessage(threadId: string, extraRules: string[]) {
  const thread = getAgentThread(threadId);
  const settings = getSettings();
  const securityRules = [
    settings.agentDangerousFileOpsEnabled === true
      ? "Dangerous file operations are enabled for this agent runtime."
      : "Dangerous file operations are blocked unless the user explicitly enables them in Settings.",
    settings.agentNetworkCommandsEnabled === true
      ? "Network-reaching workspace commands are enabled for this agent runtime."
      : "Network-reaching workspace commands are blocked unless the user explicitly enables them in Settings.",
    settings.agentShellCommandsEnabled === true
      ? "Shell-style and inline-script commands are enabled for this agent runtime."
      : "Shell-style and inline-script commands are blocked unless the user explicitly enables them in Settings.",
    settings.agentGitWriteCommandsEnabled === true
      ? "Git write commands are enabled for this agent runtime."
      : "Git write commands are blocked unless the user explicitly enables them in Settings."
  ];
  return [
    thread?.mode ? `Current mode: ${thread.mode}.` : "",
    buildModePolicy(thread?.mode),
    sanitizeText(thread?.developerPrompt, 8000),
    ...securityRules,
    ...extraRules
  ].filter(Boolean).join("\n");
}

function buildModePolicy(mode: unknown) {
  if (mode === "ask") {
    return [
      "- Default to a direct answer. Do not orchestrate just because tools or subagents exist.",
      "- Ask a clarifying question only when the request is materially ambiguous.",
      "- Prefer zero or one tool call unless verification is genuinely needed."
    ].join("\n");
  }
  if (mode === "research") {
    return [
      "- Gather evidence before concluding. Separate observed facts from inference.",
      "- Use tools proactively when they improve accuracy or freshness.",
      "- Use subagents for parallel side investigations only when they are clearly bounded."
    ].join("\n");
  }
  return [
    "- Prefer concrete progress, implementation steps, and verification over analysis-only replies.",
    "- Use tools when they unlock execution or validation.",
    "- For code/file changes, modify files in the selected workspace with edit tools instead of pasting replacement code into chat.",
    "- Adapt the workflow to the task: inspect first when the area is unfamiliar, prefer targeted edits, and verify the result when the change is risky, broad, or explicitly requested.",
    "- Use subagents for bounded side tasks that unblock the main goal."
  ].join("\n");
}

function buildSubagentRolePolicy(role: AgentSubagentRole) {
  if (role === "research") {
    return [
      "- Behave like a bounded researcher for the parent run.",
      "- Gather facts, check contradictions, and return concise evidence-rich findings."
    ].join("\n");
  }
  if (role === "builder") {
    return [
      "- Behave like a bounded implementation subagent.",
      "- Focus on concrete progress, executable steps, and clear completion criteria."
    ].join("\n");
  }
  if (role === "reviewer") {
    return [
      "- Behave like a strict review subagent.",
      "- Look for regressions, weak assumptions, missing checks, and hidden risk."
    ].join("\n");
  }
  return [
    "- Behave like a bounded general-purpose subagent.",
    "- Keep work tightly scoped to the delegated side task."
  ].join("\n");
}

function buildDirectReplyMessages(params: {
  threadId: string;
  settings: ReturnType<typeof getSettings>;
  extraContext?: string[];
}): UnifiedGenerateMessage[] {
  const thread = getAgentThread(params.threadId);
  const memoryNote = buildMemoryNote(params.threadId);
  const projectInstructionsNote = buildProjectInstructionsNote(params.threadId);
  const environmentContextNote = buildEnvironmentContextNote(params.threadId);
  const enabledSkillInstructions = buildEnabledSkillInstructions(params.threadId);
  const baseSystemPrompt = [
    "You are Vellium Agent.",
    thread?.systemPrompt || ""
  ].filter(Boolean).join("\n");
  const developerMessage = buildDeveloperMessage(params.threadId, [
    "Answer directly when the user request is simple.",
    "Do not mention internal planning, orchestration, skills, or tool policy unless the user explicitly asks."
  ]);
  const historySelection = buildPromptHistory({
    threadId: params.threadId,
    settings: params.settings,
    fixedContent: [
      baseSystemPrompt,
      developerMessage,
      projectInstructionsNote,
      environmentContextNote,
      memoryNote,
      enabledSkillInstructions,
      ...(params.extraContext || [])
    ]
  });
  const messages: UnifiedGenerateMessage[] = [{
    role: "system",
    content: baseSystemPrompt
  }];
  if (developerMessage) {
    messages.push({ role: "developer", content: developerMessage });
  }
  if (projectInstructionsNote) {
    messages.push({ role: "user", content: projectInstructionsNote });
  }
  if (environmentContextNote) {
    messages.push({ role: "user", content: environmentContextNote });
  }
  if (memoryNote) {
    messages.push({ role: "developer", content: memoryNote });
  }
  if (enabledSkillInstructions) {
    messages.push({ role: "developer", content: `Enabled skills:\n${enabledSkillInstructions}` });
  }
  for (const note of params.extraContext || []) {
    if (!note) continue;
    messages.push({ role: "developer", content: note });
  }
  if (historySelection.compactedNote) {
    messages.push({ role: "system", content: historySelection.compactedNote });
  }
  messages.push(...historySelection.history);
  return messages;
}

function buildDirectToolLoopMessages(params: {
  threadId: string;
  settings: ReturnType<typeof getSettings>;
  tools?: AgentTool[];
  extraContext?: string[];
}): Array<Record<string, unknown>> {
  const thread = getAgentThread(params.threadId);
  const memoryNote = buildMemoryNote(params.threadId);
  const projectInstructionsNote = buildProjectInstructionsNote(params.threadId);
  const environmentContextNote = buildEnvironmentContextNote(params.threadId);
  const enabledSkillInstructions = buildEnabledSkillInstructions(params.threadId);
  const toolCatalog = buildToolCatalog(params.tools || []);
  const baseSystemPrompt = [
    "You are Vellium Agent operating inside a selectable workspace.",
    thread?.systemPrompt || ""
  ].filter(Boolean).join("\n");
  const developerMessage = buildDeveloperMessage(params.threadId, [
    "Work like a coding agent: inspect first, use tools when they materially help, and chain multiple tool calls when the task requires it.",
    "When the user asks to create, fix, update, refactor, style, or otherwise change project files, apply the change with workspace_write_file, workspace_multi_edit, workspace_replace_text, or workspace_insert_text. Do not dump code into chat as a substitute for editing files.",
    "Prefer targeted edit tools such as multi-edit, replace-text, and insert-text over full rewrites when the change is local.",
    "Avoid repeated read-only calls. If you already inspected the relevant file/range, move to an edit tool or explain what blocks the edit.",
    "After editing, summarize changed files and verification. Only include large code blocks when the user explicitly asks for code in chat.",
    "Use an adaptive workflow instead of forcing the same sequence on every task.",
    "If the change is small and obvious, keep the loop short. If the change is risky or broad, inspect the result and verify before finalizing.",
    "Keep user-facing text compact. Prefer action over meta-commentary.",
    "When native function calling is unavailable or unreliable, request tools in plain text using exactly this format and no extra prose:",
    "[TOOL_REQUEST]",
    "{\"name\":\"exact_tool_name\",\"arguments\":{}}",
    "[END_TOOL_REQUEST]",
    "Available tools:",
    toolCatalog
  ]);
  const historySelection = buildPromptHistory({
    threadId: params.threadId,
    settings: params.settings,
    fixedContent: [
      baseSystemPrompt,
      developerMessage,
      projectInstructionsNote,
      environmentContextNote,
      memoryNote,
      enabledSkillInstructions,
      ...(params.extraContext || [])
    ]
  });
  const messages: Array<Record<string, unknown>> = [{
    role: "system",
    content: baseSystemPrompt
  }];
  if (developerMessage) {
    messages.push({ role: "developer", content: developerMessage });
  }
  if (projectInstructionsNote) {
    messages.push({ role: "user", content: projectInstructionsNote });
  }
  if (environmentContextNote) {
    messages.push({ role: "user", content: environmentContextNote });
  }
  if (memoryNote) {
    messages.push({ role: "developer", content: memoryNote });
  }
  if (enabledSkillInstructions) {
    messages.push({ role: "developer", content: `Enabled skills:\n${enabledSkillInstructions}` });
  }
  for (const note of params.extraContext || []) {
    if (!note) continue;
    messages.push({ role: "developer", content: note });
  }
  if (historySelection.compactedNote) {
    messages.push({ role: "system", content: historySelection.compactedNote });
  }
  messages.push(...historySelection.history.map((message) => ({
    role: message.role,
    content: message.content
  })));
  return messages;
}

function shouldUseDirectReplyPath(params: {
  threadId: string;
  launchIntent?: AgentLaunchIntent;
  extraContext?: string[];
}) {
  if (params.launchIntent || (params.extraContext?.length || 0) > 0) return false;
  const thread = getAgentThread(params.threadId);
  const latestInput = latestUserMessageText(params.threadId).toLowerCase();
  if (!latestInput || latestInput.length > 180 || latestInput.includes("\n")) return false;
  if (/(```|\/|\\|npm |pnpm |yarn |pytest|jest|stack trace|error:|package\.json|tsconfig|workspace|tool|command)/i.test(latestInput)) {
    return false;
  }
  if (/^(hi|hello|hey|yo|привет|здарова|здравствуйте)\b/i.test(latestInput)) return true;
  if (/(who are you|what can you do|что ты умеешь|что ты можешь)/i.test(latestInput)) return true;
  if (thread?.mode === "ask" && latestInput.length <= 120 && latestInput.split(/\s+/).length <= 20) return true;
  return false;
}

function shouldUseDirectToolLoop(params: {
  threadId: string;
  toolbox: PreparedAgentToolbox | null;
  launchIntent?: AgentLaunchIntent;
  extraContext?: string[];
}) {
  if (!params.toolbox?.tools.length) return false;
  const thread = getAgentThread(params.threadId);
  const { provider } = resolveProviderForThread(params.threadId);
  if (!provider) return false;
  const latestInput = latestUserMessageText(params.threadId);
  if (!latestInput && thread?.mode !== "build") return false;
  if (shouldUseDirectReplyPath(params)) return false;
  if (latestInput.length > 2400) return false;
  const hasContinuationContext = !params.launchIntent && (params.extraContext?.length || 0) > 0;
  const toolNames = new Set(params.toolbox.tools.map((tool) => sanitizeText(tool.function.name, 200)).filter(Boolean));
  const hasCommandTool = toolNames.has("workspace_run_command");
  const hasFileTools = [
    "workspace_list_files",
    "workspace_read_file",
    "workspace_search_text",
    "workspace_write_file",
    "workspace_replace_text"
  ].some((name) => toolNames.has(name));
  const commandCue = /(command|run|test|build|lint|npm |pnpm |yarn |node |python |bash|shell|terminal|package\.json|tsconfig|запусти|команд|терминал|сборк|тест)/i;
  const fileCue = /(file|workspace|directory|folder|code|bug|fix|implement|change|search|read|edit|repo|project|grep|inspect|analy[sz]e|проект|файл|директор|папк|исправ|реализ|проверь|найди|прочитай|поиск|код)/i;
  const wantsCommandPath = commandCue.test(latestInput);
  const wantsFilePath = fileCue.test(latestInput);
  const wantsMutationPath = userAskedForWorkspaceMutation(latestInput);
  if (hasContinuationContext && thread?.mode !== "ask") {
    return hasCommandTool || hasFileTools;
  }
  if (thread?.mode === "research") {
    return (hasCommandTool || hasFileTools) && (latestInput.split(/\s+/).length > 4 || wantsCommandPath || wantsFilePath || wantsMutationPath);
  }
  if (thread?.mode === "build" && (wantsCommandPath || wantsFilePath || wantsMutationPath)) {
    return (wantsCommandPath && hasCommandTool) || (wantsFilePath && hasFileTools) || (hasCommandTool && hasFileTools);
  }
  if (wantsCommandPath && hasCommandTool) return true;
  if (wantsFilePath && hasFileTools) return true;
  return false;
}

function buildPlannerMessages(params: {
  threadId: string;
  settings: ReturnType<typeof getSettings>;
  activeSkillIds: string[];
  scratchpad: string[];
  toolbox: PreparedAgentToolbox | null;
  depth: number;
  remainingSubagents: number;
  extraContext?: string[];
}): UnifiedGenerateMessage[] {
  const thread = getAgentThread(params.threadId);
  const skills = listAgentSkills(params.threadId);
  const toolCatalog = buildToolCatalog(params.toolbox?.tools || [], AGENT_RUNTIME_TOOL_DEFINITIONS);
  const skillCatalog = buildSkillCatalog(skills);
  const activeSkillInstructions = buildActiveSkillInstructions(skills, params.activeSkillIds);
  const modePolicy = buildModePolicy(thread?.mode);
  const memoryNote = buildMemoryNote(params.threadId);
  const projectInstructionsNote = buildProjectInstructionsNote(params.threadId);
  const environmentContextNote = buildEnvironmentContextNote(params.threadId);

  const runtimePrompt = [
    "You are the Vellium Agent runtime.",
    thread?.systemPrompt || "",
    "",
    "Available skills:",
    skillCatalog,
    "",
    "Available tools:",
    toolCatalog,
    "",
    "Rules:",
    modePolicy,
    `- Current run depth: ${params.depth}. Maximum subagent depth: ${MAX_SUBAGENT_DEPTH}.`,
    `- Remaining subagent budget for this run tree: ${Math.max(0, params.remainingSubagents)}.`,
    "- Return JSON only. No markdown, no prose outside JSON.",
    "- Use exact tool names from the catalog when requesting tool calls.",
    "- Put tool arguments in toolCalls[].argumentsJson as a serialized JSON object string.",
    "- For code/file modification requests, request workspace edit tools. Do not put replacement code in assistantMessage instead of changing files.",
    "- Prefer targeted file edits over full rewrites when the requested change is local.",
    "- Avoid repeated read-only calls to the same file or query; once enough context is available, edit or ask a focused blocking question.",
    "- agent_log_plan is optional. Use it only when a plan/checkpoint is worth showing in the trace.",
    "- agent_refresh_memory is optional. Use it only when this run materially changes the durable memory.",
    "- Use subagents only for bounded side tasks that can be delegated without blocking the main task.",
    "- Allowed subagent roles: general, research, builder, reviewer.",
    `- Request at most ${MAX_TOOL_CALLS_PER_STEP} tool calls and ${MAX_SUBAGENTS_PER_STEP} subagents in one step.`,
    params.remainingSubagents <= 0 ? "- Do not request subagents in this step." : "",
    "- If you already have enough information, set status to done or needs_user and avoid unnecessary tools.",
    "- Keep assistantMessage concise and directly useful to the user.",
    "",
    "Required JSON shape:",
    "{\"summary\":\"...\",\"assistantMessage\":\"...\",\"status\":\"continue|needs_user|done\",\"skillIds\":[\"...\"],\"toolCalls\":[{\"tool\":\"exact_name\",\"argumentsJson\":\"{}\",\"reason\":\"...\"}],\"subagents\":[{\"title\":\"...\",\"goal\":\"...\",\"role\":\"general|research|builder|reviewer\",\"instructions\":\"...\"}],\"updates\":[\"...\"]}"
  ].filter(Boolean).join("\n");
  const developerMessage = buildDeveloperMessage(params.threadId, [
    "- You are deciding the next best action for an agent turn.",
    "- Use the available tool catalog instead of inventing capabilities.",
    "- Put planner tool arguments in toolCalls[].argumentsJson as a JSON object string.",
    "- For code/file modification requests, choose workspace edit tools instead of writing patch/code text in assistantMessage.",
    "- Prefer targeted file edits over full rewrites when the requested change is local."
  ]);
  const scratchpadNote = params.scratchpad.length > 0 ? `Run scratchpad:\n${buildScratchpadText(params.scratchpad)}` : "";
  const historySelection = buildPromptHistory({
    threadId: params.threadId,
    settings: params.settings,
    fixedContent: [
      runtimePrompt,
      developerMessage,
      projectInstructionsNote,
      environmentContextNote,
      memoryNote,
      activeSkillInstructions,
      scratchpadNote,
      ...(params.extraContext || [])
    ]
  });

  const messages: UnifiedGenerateMessage[] = [{ role: "system", content: runtimePrompt }];
  if (developerMessage) {
    messages.push({ role: "developer", content: developerMessage });
  }
  if (projectInstructionsNote) {
    messages.push({ role: "user", content: projectInstructionsNote });
  }
  if (environmentContextNote) {
    messages.push({ role: "user", content: environmentContextNote });
  }
  if (memoryNote) {
    messages.push({ role: "developer", content: memoryNote });
  }
  if (activeSkillInstructions) {
    messages.push({ role: "developer", content: `Active skill instructions:\n${activeSkillInstructions}` });
  }
  if (scratchpadNote) {
    messages.push({ role: "developer", content: scratchpadNote });
  }
  for (const note of params.extraContext || []) {
    if (!note) continue;
    messages.push({ role: "developer", content: note });
  }
  if (historySelection.compactedNote) {
    messages.push({ role: "system", content: historySelection.compactedNote });
  }
  messages.push(...historySelection.history);
  messages.push({
    role: "user",
    content: "Decide the next best action for this agent thread and return JSON only."
  });
  return messages;
}

function buildSynthesisMessages(params: {
  threadId: string;
  settings: ReturnType<typeof getSettings>;
  scratchpad: string[];
  activeSkillIds: string[];
  extraContext?: string[];
}): UnifiedGenerateMessage[] {
  const thread = getAgentThread(params.threadId);
  const skills = listAgentSkills(params.threadId);
  const activeSkillInstructions = buildActiveSkillInstructions(skills, params.activeSkillIds);
  const modePolicy = buildModePolicy(thread?.mode);
  const memoryNote = buildMemoryNote(params.threadId);
  const projectInstructionsNote = buildProjectInstructionsNote(params.threadId);
  const environmentContextNote = buildEnvironmentContextNote(params.threadId);
  const baseSystemPrompt = [
    "Write the final user-facing assistant reply for this Vellium agent thread.",
    thread?.systemPrompt || "",
    modePolicy,
    "Use the gathered scratchpad and keep the answer concise, concrete, and helpful."
  ].filter(Boolean).join("\n");
  const developerMessage = buildDeveloperMessage(params.threadId, [
    "Turn the gathered results into a concise final answer.",
    "Do not expose internal planning or tool policy unless the user explicitly asks."
  ]);
  const scratchpadNote = `Run scratchpad:\n${buildScratchpadText(params.scratchpad)}`;
  const historySelection = buildPromptHistory({
    threadId: params.threadId,
    settings: params.settings,
    fixedContent: [
      baseSystemPrompt,
      developerMessage,
      projectInstructionsNote,
      environmentContextNote,
      memoryNote,
      activeSkillInstructions,
      scratchpadNote,
      ...(params.extraContext || [])
    ]
  });
  const messages: UnifiedGenerateMessage[] = [{
    role: "system",
    content: baseSystemPrompt
  }];
  if (developerMessage) {
    messages.push({ role: "developer", content: developerMessage });
  }
  if (projectInstructionsNote) {
    messages.push({ role: "user", content: projectInstructionsNote });
  }
  if (environmentContextNote) {
    messages.push({ role: "user", content: environmentContextNote });
  }
  if (memoryNote) {
    messages.push({ role: "developer", content: memoryNote });
  }
  if (activeSkillInstructions) {
    messages.push({ role: "developer", content: `Active skill instructions:\n${activeSkillInstructions}` });
  }
  for (const note of params.extraContext || []) {
    if (!note) continue;
    messages.push({ role: "developer", content: note });
  }
  if (historySelection.compactedNote) {
    messages.push({ role: "system", content: historySelection.compactedNote });
  }
  messages.push(...historySelection.history);
  messages.push({
    role: "system",
    content: scratchpadNote
  });
  messages.push({
    role: "user",
    content: "Produce the final answer to the user now."
  });
  return messages;
}

function buildMemoryMessages(params: {
  threadId: string;
  settings: ReturnType<typeof getSettings>;
  summary: string;
  finalMessage: string;
}): UnifiedGenerateMessage[] {
  const thread = getAgentThread(params.threadId);
  const currentMemory = buildMemoryNote(params.threadId);
  const environmentContextNote = buildEnvironmentContextNote(params.threadId);
  const baseSystemPrompt = [
    "Update the durable memory for this Vellium agent thread.",
    thread?.systemPrompt || "",
    "Write plain text only.",
    "Keep only durable context that should influence future runs: stable user preferences, important decisions, artifacts in progress, constraints, tool findings worth keeping, and unresolved next steps.",
    "Exclude temporary chatter and details that are obvious from the latest user request alone.",
    "Keep the summary compact and scannable."
  ].filter(Boolean).join("\n");
  const developerMessage = buildDeveloperMessage(params.threadId, [
    "Refresh only durable memory that should influence future runs.",
    "Do not duplicate the entire conversation."
  ]);
  const latestSummaryNote = `Latest run summary:\n${sanitizeText(params.summary, 1200) || "No summary."}`;
  const finalMessageNote = sanitizeText(params.finalMessage, 8000);
  const historySelection = buildPromptHistory({
    threadId: params.threadId,
    settings: params.settings,
    fixedContent: [baseSystemPrompt, developerMessage, environmentContextNote, currentMemory, latestSummaryNote, finalMessageNote]
  });
  const messages: UnifiedGenerateMessage[] = [{
    role: "system",
    content: baseSystemPrompt
  }];
  if (developerMessage) {
    messages.push({ role: "developer", content: developerMessage });
  }
  if (environmentContextNote) {
    messages.push({ role: "user", content: environmentContextNote });
  }
  if (currentMemory) {
    messages.push({ role: "developer", content: currentMemory });
  }
  if (historySelection.compactedNote) {
    messages.push({ role: "system", content: historySelection.compactedNote });
  }
  messages.push(...historySelection.history);
  messages.push({
    role: "system",
    content: latestSummaryNote
  });
  messages.push({
    role: "assistant",
    content: finalMessageNote
  });
  messages.push({
    role: "user",
    content: "Refresh the durable memory summary for future agent runs."
  });
  return messages;
}

async function refreshThreadMemory(params: {
  threadId: string;
  runId: string;
  summary: string;
  finalMessage: string;
  signal: AbortSignal;
  writer?: RuntimeEventWriter;
}) {
  const thread = getAgentThread(params.threadId);
  if (!thread) return null;
  const { provider, modelId, settings } = resolveProviderForThread(params.threadId);
  if (!provider || !modelId || params.signal.aborted) return null;

  const memoryResult = await unifiedGenerateText({
    provider,
    modelId,
    messages: buildMemoryMessages({
      threadId: params.threadId,
      settings,
      summary: params.summary,
      finalMessage: params.finalMessage
    }),
    samplerConfig: settings.samplerConfig,
    apiParamPolicy: settings.apiParamPolicy,
    signal: params.signal
  });
  const nextSummary = sanitizeText(memoryResult.content, 4000);
  if (!nextSummary) return null;
  const updatedThread = updateAgentThreadMemory(params.threadId, nextSummary);
  if (updatedThread && params.writer) {
    const event = insertAgentEvent({
      threadId: params.threadId,
      runId: params.runId,
      type: "memory",
      title: "Thread memory updated",
      content: nextSummary,
      payload: {
        memoryUpdatedAt: updatedThread.memoryUpdatedAt
      }
    });
    if (event) {
      params.writer.emitEvent(event);
    }
  }
  return updatedThread;
}

async function streamTextDeltas(text: string, writer: RuntimeEventWriter) {
  const chunks = String(text || "").match(/[\s\S]{1,36}/g) ?? [];
  for (const chunk of chunks) {
    writer.emitDelta(chunk);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function requestOpenAiToolCompletion(params: {
  provider: ProviderRow;
  modelId: string;
  messages: Array<Record<string, unknown>>;
  tools: AgentTool[];
  toolChoice?: "auto" | "required";
  samplerConfig: Record<string, unknown>;
  apiParamPolicy: unknown;
  signal: AbortSignal;
}) {
  const baseUrl = normalizeOpenAiBaseUrl(params.provider.base_url);
  const openAiSampling = buildOpenAiSamplingPayload({
    samplerConfig: params.samplerConfig,
    apiParamPolicy: params.apiParamPolicy,
    fields: ["temperature", "topP", "frequencyPenalty", "presencePenalty", "maxTokens", "stop"],
    defaults: {
      temperature: 0.3,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxTokens: 1600
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
      messages: params.messages.map((message) => ({
        ...message,
        role: normalizeChatCompletionRole(String(message.role || "user"), params.provider)
      })),
      tools: params.tools,
      tool_choice: params.toolChoice || "auto",
      ...openAiSampling
    }),
    signal: params.signal
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(errText || `OpenAI-compatible request failed (${response.status})`);
  }
  return await response.json().catch(() => ({})) as {
    reasoning?: unknown;
    reasoning_content?: unknown;
    reasoning_text?: unknown;
    reasoningText?: unknown;
    thinking?: unknown;
    thinking_content?: unknown;
    thinking_text?: unknown;
    thinkingText?: unknown;
    choices?: Array<{
      message?: {
        content?: unknown;
        tool_calls?: OpenAIToolCall[];
        reasoning?: unknown;
        reasoning_content?: unknown;
        reasoning_text?: unknown;
        reasoningText?: unknown;
        thinking?: unknown;
        thinking_content?: unknown;
        thinking_text?: unknown;
        thinkingText?: unknown;
      };
    }>;
  };
}

async function requestOpenAiToolCompletionStream(params: {
  provider: ProviderRow;
  modelId: string;
  messages: Array<Record<string, unknown>>;
  tools?: AgentTool[];
  toolChoice?: "auto" | "required";
  samplerConfig: Record<string, unknown>;
  apiParamPolicy: unknown;
  signal: AbortSignal;
  onAssistantDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
}) {
  const baseUrl = normalizeOpenAiBaseUrl(params.provider.base_url);
  const openAiSampling = buildOpenAiSamplingPayload({
    samplerConfig: params.samplerConfig,
    apiParamPolicy: params.apiParamPolicy,
    fields: ["temperature", "topP", "frequencyPenalty", "presencePenalty", "maxTokens", "stop"],
    defaults: {
      temperature: 0.3,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxTokens: 1600
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
      messages: params.messages.map((message) => ({
        ...message,
        role: normalizeChatCompletionRole(String(message.role || "user"), params.provider)
      })),
      ...(params.tools?.length ? { tools: params.tools, tool_choice: params.toolChoice || "auto" } : {}),
      stream: true,
      ...openAiSampling
    }),
    signal: params.signal
  });
  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "");
    throw new Error(errText || `OpenAI-compatible streaming request failed (${response.status})`);
  }
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("text/event-stream")) {
    throw new Error(`Streaming unsupported: expected text/event-stream, got ${contentType || "unknown"}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const assistantTextParts: string[] = [];
  const reasoningParts: string[] = [];
  const streamedToolCalls = new Map<number, OpenAIToolCall>();
  const thinkState = createThinkStreamState();
  let buffer = "";

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
      const reasoningDelta = extractOpenAIReasoningDelta(parsed);
      if (reasoningDelta) {
        reasoningParts.push(reasoningDelta);
        params.onReasoningDelta?.(reasoningDelta);
      }
      const textDelta = extractOpenAiStreamTextDelta(parsed);
      if (textDelta) {
        const split = consumeThinkChunk(thinkState, textDelta);
        if (split.reasoning) {
          reasoningParts.push(split.reasoning);
          params.onReasoningDelta?.(split.reasoning);
        }
        if (split.content) {
          assistantTextParts.push(split.content);
          params.onAssistantDelta?.(split.content);
        }
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
    if (params.signal.aborted) {
      await reader.cancel();
      break;
    }
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
  const tail = flushThinkState(thinkState);
  if (tail.reasoning) {
    reasoningParts.push(tail.reasoning);
    params.onReasoningDelta?.(tail.reasoning);
  }
  if (tail.content) {
    assistantTextParts.push(tail.content);
    params.onAssistantDelta?.(tail.content);
  }

  return {
    choices: [{
      message: {
        content: assistantTextParts.join(""),
        reasoning: reasoningParts.join("").trim(),
        tool_calls: [...streamedToolCalls.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, call]) => call)
      }
    }]
  };
}

async function requestTextToolCompletion(params: {
  provider: ProviderRow;
  modelId: string;
  messages: Array<Record<string, unknown>>;
  samplerConfig: Record<string, unknown>;
  apiParamPolicy: unknown;
  signal: AbortSignal;
}) {
  const result = await unifiedGenerateText({
    provider: params.provider,
    modelId: params.modelId,
    messages: normalizeToolLoopMessagesForPlainCompletion(params.messages),
    samplerConfig: params.samplerConfig,
    apiParamPolicy: params.apiParamPolicy,
    signal: params.signal
  });
  return {
    reasoning: result.reasoning,
    choices: [{
      message: {
        content: result.content,
        reasoning: result.reasoning,
        tool_calls: []
      }
    }]
  };
}

function isStructuredPlannerFormatError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /response_format|json_schema|json_object|structured|schema|unsupported|not supported|unknown parameter|invalid parameter/i.test(message);
}

async function requestOpenAiStructuredCompletion(params: {
  provider: ProviderRow;
  modelId: string;
  messages: UnifiedGenerateMessage[];
  samplerConfig: Record<string, unknown>;
  apiParamPolicy: unknown;
  signal: AbortSignal;
  responseFormat: Record<string, unknown>;
}) {
  const baseUrl = normalizeOpenAiBaseUrl(params.provider.base_url);
  const openAiSampling = buildOpenAiSamplingPayload({
    samplerConfig: params.samplerConfig,
    apiParamPolicy: params.apiParamPolicy,
    fields: ["temperature", "topP", "frequencyPenalty", "presencePenalty", "maxTokens", "stop"],
    defaults: {
      temperature: 0.2,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxTokens: 1800
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
      messages: params.messages.map((message) => ({
        ...message,
        role: normalizeChatCompletionRole(String(message.role || "user"), params.provider)
      })),
      response_format: params.responseFormat,
      ...openAiSampling
    }),
    signal: params.signal
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(errText || `OpenAI-compatible structured planner request failed (${response.status})`);
  }
  const body = await response.json().catch(() => ({})) as {
    reasoning?: unknown;
    reasoning_content?: unknown;
    reasoning_text?: unknown;
    reasoningText?: unknown;
    thinking?: unknown;
    thinking_content?: unknown;
    thinking_text?: unknown;
    thinkingText?: unknown;
    choices?: Array<{
      message?: {
        content?: unknown;
        reasoning?: unknown;
        reasoning_content?: unknown;
        reasoning_text?: unknown;
        reasoningText?: unknown;
        thinking?: unknown;
        thinking_content?: unknown;
        thinking_text?: unknown;
        thinkingText?: unknown;
      };
    }>;
  };
  return {
    content: sanitizeText(normalizeAssistantContent(body.choices?.[0]?.message?.content), 12000),
    reasoning: sanitizeText(extractOpenAiCompletionReasoning(body), 12000),
    providerType: "openai" as const
  };
}

async function generatePlannerResult(params: {
  provider: ProviderRow;
  modelId: string;
  messages: UnifiedGenerateMessage[];
  samplerConfig: Record<string, unknown>;
  apiParamPolicy: unknown;
  signal: AbortSignal;
}) {
  if (String(params.provider.provider_type || "openai") === "openai") {
    try {
      return await requestOpenAiStructuredCompletion({
        ...params,
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "agent_step",
            strict: true,
            schema: AGENT_STEP_RESPONSE_SCHEMA
          }
        }
      });
    } catch (error) {
      if (!isStructuredPlannerFormatError(error)) {
        throw error;
      }
    }

    try {
      return await requestOpenAiStructuredCompletion({
        ...params,
        responseFormat: { type: "json_object" }
      });
    } catch (error) {
      if (!isStructuredPlannerFormatError(error)) {
        throw error;
      }
    }
  }

  return unifiedGenerateText({
    provider: params.provider,
    modelId: params.modelId,
    messages: params.messages,
    samplerConfig: params.samplerConfig,
    apiParamPolicy: params.apiParamPolicy,
    signal: params.signal
  });
}

export type AgentFollowupIntent = {
  intent: "continuation" | "new_task" | "unclear";
  confidence: number;
  reason: string;
};

function normalizeFollowupIntent(raw: unknown): AgentFollowupIntent {
  const parsed = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const intent = parsed.intent === "continuation" || parsed.intent === "new_task" ? parsed.intent : "unclear";
  const confidence = Number(parsed.confidence);
  return {
    intent,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    reason: sanitizeText(parsed.reason, 500)
  };
}

export async function classifyAgentFollowupIntent(params: {
  threadId: string;
  latestUserMessage: string;
  context: {
    threadMode?: string;
    previousUserGoal?: string;
    latestAssistantCheckpoint?: string;
    recentRunStatus?: string;
    recentRunSummary?: string;
  };
}): Promise<AgentFollowupIntent> {
  const { provider, modelId, settings } = resolveProviderForThread(params.threadId);
  if (!provider || !modelId) {
    return { intent: "unclear", confidence: 0, reason: "No provider/model configured for follow-up classification." };
  }

  const prompt = [
    "Classify the latest user message in an autonomous agent thread.",
    "",
    "Labels:",
    "- continuation: the user is primarily telling the agent to resume, proceed, reduce chatter, or correct a perceived lack of progress on the prior task.",
    "- new_task: the user introduces a new standalone goal, object to create/change, question, file/path, command, or topic.",
    "- unclear: there is not enough signal to decide.",
    "",
    "Choose continuation only when the previous task context is needed to interpret the latest message.",
    "Do not classify as continuation merely because the message is short.",
    "",
    `Thread mode: ${sanitizeText(params.context.threadMode, 80) || "unknown"}`,
    `Previous user goal:\n${sanitizeText(params.context.previousUserGoal, 3000) || "[none]"}`,
    `Latest assistant checkpoint:\n${sanitizeText(params.context.latestAssistantCheckpoint, 2000) || "[none]"}`,
    `Recent run status: ${sanitizeText(params.context.recentRunStatus, 80) || "unknown"}`,
    `Recent run summary:\n${sanitizeText(params.context.recentRunSummary, 1200) || "[none]"}`,
    `Latest user message:\n${sanitizeText(params.latestUserMessage, 1000)}`
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const messages: UnifiedGenerateMessage[] = [
      {
        role: "system",
        content: "You are a precise intent classifier. Return only the requested JSON object."
      },
      {
        role: "user",
        content: prompt
      }
    ];
    const result = String(provider.provider_type || "openai") === "openai"
      ? await requestOpenAiStructuredCompletion({
        provider,
        modelId,
        messages,
        samplerConfig: settings.samplerConfig,
        apiParamPolicy: settings.apiParamPolicy,
        signal: controller.signal,
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "agent_followup_intent",
            strict: true,
            schema: FOLLOWUP_INTENT_RESPONSE_SCHEMA
          }
        }
      })
      : await unifiedGenerateText({
        provider,
        modelId,
        messages,
        samplerConfig: settings.samplerConfig,
        apiParamPolicy: settings.apiParamPolicy,
        signal: controller.signal
      });
    return normalizeFollowupIntent(parseJsonObject(result.content));
  } catch (error) {
    const reason = error instanceof Error && isAbortLikeMessage(error.message)
      ? "Follow-up classifier timed out."
      : "Follow-up classifier failed.";
    return { intent: "unclear", confidence: 0, reason };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateAssistantTextWithOptionalStream(params: {
  provider: ProviderRow;
  modelId: string;
  messages: UnifiedGenerateMessage[];
  samplerConfig: Record<string, unknown>;
  apiParamPolicy: unknown;
  signal: AbortSignal;
  writer?: RuntimeEventWriter;
}) {
  if (params.writer && String(params.provider.provider_type || "openai") === "openai") {
    try {
      const body = await requestOpenAiToolCompletionStream({
        provider: params.provider,
        modelId: params.modelId,
        messages: params.messages.map((message) => ({
          role: message.role,
          content: message.content
        })),
        samplerConfig: params.samplerConfig,
        apiParamPolicy: params.apiParamPolicy,
        signal: params.signal,
        onAssistantDelta: (delta) => params.writer?.emitDelta(delta),
        onReasoningDelta: (delta) => params.writer?.emitReasoningDelta(delta)
      });
      const content = sanitizeText(normalizeAssistantContent(body.choices?.[0]?.message?.content), 12000);
      const reasoning = sanitizeText(extractOpenAiCompletionReasoning(body), 12000);
      if (content) {
        return { content, reasoning, streamed: true };
      }
    } catch {
      // Fall through to the regular completion path.
    }
  }

  const result = await unifiedGenerateText({
    provider: params.provider,
    modelId: params.modelId,
    messages: params.messages,
    samplerConfig: params.samplerConfig,
    apiParamPolicy: params.apiParamPolicy,
    signal: params.signal
  });
  return {
    content: sanitizeText(result.content, 12000),
    reasoning: sanitizeText(result.reasoning, 12000),
    streamed: false
  };
}

async function runDirectReply(params: {
  threadId: string;
  title: string;
  parentRunId?: string | null;
  onRunCreated?: (runId: string) => void;
  signal: AbortSignal;
  extraContext?: string[];
  writer?: RuntimeEventWriter;
}): Promise<AgentRunOutcome> {
  const { provider, modelId, settings } = resolveProviderForThread(params.threadId);
  const run = createAgentRun({
    threadId: params.threadId,
    parentRunId: params.parentRunId,
    title: params.title,
    depth: 0
  });
  if (!run) {
    throw new Error("Failed to create agent run");
  }
  params.onRunCreated?.(run.id);
  if (!provider || !modelId) {
    const fallback = "No provider/model configured for this agent thread. Set one in Settings or in the thread inspector.";
    completeAgentRun(run.id, "error", fallback);
    return {
      runId: run.id,
      finalMessage: fallback,
      reasoning: "",
      summary: fallback,
      status: "error",
      streamedResponse: false,
      execution: {
        stepCount: 0,
        toolCalls: 0,
        subagents: 0,
        planEvents: 0,
        usedSynthesis: false,
        memoryRefreshRequested: false
      }
    };
  }
  if (settings.fullLocalMode && !isLocalhostUrl(provider.base_url)) {
    const blocked = "Provider blocked by Full Local Mode.";
    completeAgentRun(run.id, "error", blocked);
    return {
      runId: run.id,
      finalMessage: blocked,
      reasoning: "",
      summary: blocked,
      status: "error",
      streamedResponse: false,
      execution: {
        stepCount: 0,
        toolCalls: 0,
        subagents: 0,
        planEvents: 0,
        usedSynthesis: false,
        memoryRefreshRequested: false
      }
    };
  }
  try {
    const result = await generateAssistantTextWithOptionalStream({
      provider,
      modelId,
      messages: buildDirectReplyMessages({
        threadId: params.threadId,
        settings,
        extraContext: params.extraContext
      }),
      samplerConfig: settings.samplerConfig,
      apiParamPolicy: settings.apiParamPolicy,
      signal: params.signal,
      writer: params.writer
    });
    const finalMessage = sanitizeText(result.content, 12000) || "Task complete.";
    const summary = sanitizeText(finalMessage, 4000) || "Run completed.";
    completeAgentRun(run.id, "done", summary);
    return {
      runId: run.id,
      finalMessage,
      reasoning: result.reasoning,
      summary,
      status: "done",
      streamedResponse: result.streamed,
      execution: {
        stepCount: 1,
        toolCalls: 0,
        subagents: 0,
        planEvents: 0,
        usedSynthesis: false,
        memoryRefreshRequested: false
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Agent run failed");
    completeAgentRun(run.id, isAbortLikeMessage(message) ? "aborted" : "error", message);
    throw error;
  }
}

async function runDirectToolLoop(params: {
  threadId: string;
  title: string;
  parentRunId?: string | null;
  onRunCreated?: (runId: string) => void;
  signal: AbortSignal;
  toolbox: PreparedAgentToolbox;
  writer?: RuntimeEventWriter;
  extraContext?: string[];
}): Promise<AgentRunOutcome> {
  const { provider, modelId, settings } = resolveProviderForThread(params.threadId);
  const run = createAgentRun({
    threadId: params.threadId,
    parentRunId: params.parentRunId,
    title: params.title,
    depth: 0
  });
  if (!run) {
    throw new Error("Failed to create agent run");
  }
  params.onRunCreated?.(run.id);
  if (!provider || !modelId) {
    const fallback = "No provider/model configured for this agent thread. Set one in Settings or in the thread inspector.";
    completeAgentRun(run.id, "error", fallback);
    return {
      runId: run.id,
      finalMessage: fallback,
      reasoning: "",
      summary: fallback,
      status: "error",
      streamedResponse: false,
      execution: {
        stepCount: 0,
        toolCalls: 0,
        subagents: 0,
        planEvents: 0,
        usedSynthesis: false,
        memoryRefreshRequested: false
      }
    };
  }
  if (settings.fullLocalMode && !isLocalhostUrl(provider.base_url)) {
    const blocked = "Provider blocked by Full Local Mode.";
    completeAgentRun(run.id, "error", blocked);
    return {
      runId: run.id,
      finalMessage: blocked,
      reasoning: "",
      summary: blocked,
      status: "error",
      streamedResponse: false,
      execution: {
        stepCount: 0,
        toolCalls: 0,
        subagents: 0,
        planEvents: 0,
        usedSynthesis: false,
        memoryRefreshRequested: false
      }
    };
  }

  const writeEvent = (type: string, title: string, content = "", payload: Record<string, unknown> = {}) => {
    const event = insertAgentEvent({
      threadId: params.threadId,
      runId: run.id,
      type,
      title,
      content,
      payload: {
        depth: 0,
        ...payload
      }
    });
    if (event && params.writer) {
      params.writer.emitEvent(event);
    }
  };

  try {
    const availableTools = params.toolbox.tools;
    const workingMessages = buildDirectToolLoopMessages({
      threadId: params.threadId,
      settings,
      tools: availableTools,
      extraContext: params.extraContext
    });
    const maxToolCalls = Math.max(2, Math.min(8, (getAgentThread(params.threadId)?.maxIterations || 4) * 2));
    let toolCallsExecuted = 0;
    let assistantPasses = 0;
    let finalMessage = "";
    let finalReasoning = "";
    let usedSynthesis = false;
    let streamedResponse = false;
    let memoryRefreshRequested = false;

    const maxAssistantPasses = Math.max(3, getAgentThread(params.threadId)?.maxIterations || 4);
    const latestUserInput = latestUserMessageText(params.threadId);
    const hasContinuationContext = (params.extraContext?.length || 0) > 0;
    const wantsWorkspaceMutation = userAskedForWorkspaceMutation(latestUserInput) && hasWorkspaceEditTools(params.toolbox);
    const forceInitialTool = (wantsWorkspaceMutation || hasContinuationContext || getAgentThread(params.threadId)?.mode === "build")
      && availableTools.length > 0;
    let nativeToolModeAvailable = String(provider.provider_type || "openai") === "openai";
    const readOnlyToolCache = new Map<string, string>();
    let readOnlyToolStreak = 0;
    let workspaceEditCallsExecuted = 0;
    let antiStallNudgeQueued = false;
    while (toolCallsExecuted < maxToolCalls && assistantPasses < maxAssistantPasses) {
      if (params.signal.aborted) {
        throw new Error("Aborted");
      }
      if (wantsWorkspaceMutation && workspaceEditCallsExecuted === 0 && readOnlyToolStreak >= READ_ONLY_STALL_THRESHOLD && !antiStallNudgeQueued) {
        antiStallNudgeQueued = true;
        writeEvent(
          "warning",
          "Read-only loop guard",
          "The agent has only inspected files so far. Runtime nudged it to apply a workspace edit instead of continuing to read or paste code.",
          { readOnlyToolStreak }
        );
        workingMessages.push({
          role: "system",
          content: [
            "Runtime anti-stall note: the user asked for a code/file change, and the recent tool calls were read-only.",
            "If you have enough context, call workspace_multi_edit, workspace_replace_text, workspace_insert_text, or workspace_write_file next.",
            "Do not paste replacement code into chat as the final answer. If a file edit is impossible, state the specific blocker briefly."
          ].join("\n")
        });
      }
      applySteeringNotes({
        threadId: params.threadId,
        runId: run.id,
        writeEvent,
        toolLoopMessages: workingMessages
      });
      const shouldRequireTool = forceInitialTool && toolCallsExecuted === 0 && assistantPasses === 0;
      const toolChoice = shouldRequireTool ? "required" : "auto";
      const shouldStreamThisPass = Boolean(params.writer) && nativeToolModeAvailable;
      let assistantPassWasStreamed = false;
      let body: Awaited<ReturnType<typeof requestOpenAiToolCompletion>>;
      if (nativeToolModeAvailable && shouldStreamThisPass) {
        try {
          body = await requestOpenAiToolCompletionStream({
            provider,
            modelId,
            messages: workingMessages,
            tools: availableTools,
            toolChoice,
            samplerConfig: settings.samplerConfig,
            apiParamPolicy: settings.apiParamPolicy,
            signal: params.signal,
            onAssistantDelta: (delta) => params.writer?.emitDelta(delta),
            onReasoningDelta: (delta) => params.writer?.emitReasoningDelta(delta)
          });
          assistantPassWasStreamed = true;
        } catch (streamError) {
          const streamMessage = streamError instanceof Error ? streamError.message : "";
          if (/tool|function|tool_choice|required|unsupported|schema|chat\/completions/i.test(streamMessage)) {
            nativeToolModeAvailable = false;
            body = await requestTextToolCompletion({
              provider,
              modelId,
              messages: workingMessages,
              samplerConfig: settings.samplerConfig,
              apiParamPolicy: settings.apiParamPolicy,
              signal: params.signal
            });
          } else if (!/stream|sse|event-stream|unsupported/i.test(streamMessage)) {
            throw streamError;
          } else {
            try {
              body = await requestOpenAiToolCompletion({
                provider,
                modelId,
                messages: workingMessages,
                tools: availableTools,
                toolChoice,
                samplerConfig: settings.samplerConfig,
                apiParamPolicy: settings.apiParamPolicy,
                signal: params.signal
              });
            } catch (toolError) {
              const toolMessage = toolError instanceof Error ? toolError.message : "";
              if (!/tool|function|tool_choice|required|unsupported|schema|chat\/completions/i.test(toolMessage)) {
                throw toolError;
              }
              nativeToolModeAvailable = false;
              body = await requestTextToolCompletion({
                provider,
                modelId,
                messages: workingMessages,
                samplerConfig: settings.samplerConfig,
                apiParamPolicy: settings.apiParamPolicy,
                signal: params.signal
              });
            }
          }
        }
      } else if (nativeToolModeAvailable) {
        try {
          body = await requestOpenAiToolCompletion({
            provider,
            modelId,
            messages: workingMessages,
            tools: availableTools,
            toolChoice,
            samplerConfig: settings.samplerConfig,
            apiParamPolicy: settings.apiParamPolicy,
            signal: params.signal
          });
        } catch (toolError) {
          const toolMessage = toolError instanceof Error ? toolError.message : "";
          if (!/tool|function|tool_choice|required|unsupported|schema|chat\/completions/i.test(toolMessage)) {
            throw toolError;
          }
          nativeToolModeAvailable = false;
          body = await requestTextToolCompletion({
            provider,
            modelId,
            messages: workingMessages,
            samplerConfig: settings.samplerConfig,
            apiParamPolicy: settings.apiParamPolicy,
            signal: params.signal
          });
        }
      } else {
        body = await requestTextToolCompletion({
          provider,
          modelId,
          messages: workingMessages,
          samplerConfig: settings.samplerConfig,
          apiParamPolicy: settings.apiParamPolicy,
          signal: params.signal
        });
      }
      assistantPasses += 1;
      const assistant = body.choices?.[0]?.message;
      const assistantContent = normalizeAssistantContent(assistant?.content);
      const assistantReasoning = sanitizeText(extractOpenAiCompletionReasoning(body), 12000);
      const availableToolNames = availableTools.map((tool) => tool.function.name);
      const parsedTextToolCalls = extractTextToolCalls(assistantContent, availableToolNames);
      const visibleAssistantContent = parsedTextToolCalls.visibleContent || assistantContent;
      const toolCalls = Array.isArray(assistant?.tool_calls) && assistant.tool_calls.length > 0
        ? assistant.tool_calls
        : parsedTextToolCalls.toolCalls;

      if (!toolCalls.length) {
        const steeringNotesApplied = applySteeringNotes({
          threadId: params.threadId,
          runId: run.id,
          writeEvent,
          toolLoopMessages: workingMessages
        });
        if (steeringNotesApplied > 0) {
          workingMessages.push({
            role: "assistant",
            content: visibleAssistantContent
          });
          streamedResponse = false;
          continue;
        }
        if (shouldContinueDirectToolLoopAfterIntermediateReply({
          threadId: params.threadId,
          message: visibleAssistantContent,
          toolbox: params.toolbox,
          assistantPasses,
          maxAssistantPasses
        })) {
          writeEvent("warning", "Assistant continuation inferred", "Recovered a progress-style reply and continued instead of treating it as the final answer.", { pass: assistantPasses });
          workingMessages.push({
            role: "assistant",
            content: visibleAssistantContent
          });
          workingMessages.push({
            role: "system",
            content: [
              "Runtime note: the previous assistant reply looked like an intermediate progress update, not a completed result.",
              "Continue the task now. If workspace tools are available, the next assistant turn must call a workspace tool instead of another progress update.",
              "If you cannot call a tool, state the exact blocker briefly."
            ].join("\n")
          });
          finalReasoning = assistantReasoning || finalReasoning;
          streamedResponse = assistantPassWasStreamed && Boolean(visibleAssistantContent);
          continue;
        }
        if (forceInitialTool && toolCallsExecuted === 0 && assistantPasses < maxAssistantPasses) {
          writeEvent("warning", "Tool call required", "Runtime requested a concrete tool action instead of accepting a status-only assistant reply.", { pass: assistantPasses });
          workingMessages.push({
            role: "assistant",
            content: visibleAssistantContent
          });
          workingMessages.push({
            role: "system",
            content: [
              "Runtime correction: this agent turn requires concrete workspace progress.",
              "Call one of the available workspace tools now. Do not answer with a plan, greeting, apology, or status-only message.",
              "If the workspace blocks tool use, provide the exact blocker as the final answer."
            ].join("\n")
          });
          streamedResponse = false;
          continue;
        }
        if (wantsWorkspaceMutation
          && workspaceEditCallsExecuted === 0
          && messageLooksLikeCodeInsteadOfWorkspaceEdit(visibleAssistantContent)
          && assistantPasses < maxAssistantPasses) {
          writeEvent("warning", "Workspace edit required", "The assistant tried to answer with code instead of editing files. Runtime continued the run and requested an edit tool.", { pass: assistantPasses });
          workingMessages.push({
            role: "assistant",
            content: visibleAssistantContent
          });
          workingMessages.push({
            role: "system",
            content: [
              "Runtime correction: this is a coding/file modification task.",
              "Apply the change to the selected workspace with an edit/write tool. Do not provide a code dump as the final answer unless the user explicitly asked for code only."
            ].join("\n")
          });
          finalReasoning = assistantReasoning || finalReasoning;
          streamedResponse = false;
          continue;
        }
        finalMessage = sanitizeText(visibleAssistantContent, 12000) || finalMessage || "Task complete.";
        finalReasoning = assistantReasoning || finalReasoning;
        streamedResponse = assistantPassWasStreamed && Boolean(finalMessage);
        break;
      }

      if (visibleAssistantContent) {
        insertAndEmitAssistantMessage({
          threadId: params.threadId,
          runId: run.id,
          content: visibleAssistantContent,
          reasoning: assistantReasoning,
          metadata: {
            intermediate: true,
            toolPass: assistantPasses,
            toolCallNames: toolCalls
              .map((call) => sanitizeText(call.function?.name, 200))
              .filter(Boolean)
          },
          writer: params.writer
        });
      } else if (assistantReasoning) {
        params.writer?.clearDraft();
      }

      workingMessages.push({
        role: "assistant",
        content: visibleAssistantContent,
        tool_calls: toolCalls
      });

      for (const call of toolCalls) {
        if (toolCallsExecuted >= maxToolCalls) break;
        const toolName = sanitizeText(call.function?.name, 200);
        const toolArgs = String(call.function?.arguments || "");
        if (!toolName || !availableTools.some((tool) => tool.function.name === toolName)) {
          writeEvent("warning", "Tool skipped", `Unknown or disabled tool: ${toolName || "unknown"}`);
          continue;
        }
        if (toolName === "agent_log_plan") {
          const parsedArgs = parseJsonObject(toolArgs) || {};
          const title = sanitizeText(parsedArgs.title, 160) || `Checkpoint ${assistantPasses}`;
          const content = sanitizeText(parsedArgs.content, 4000);
          if (content) {
            writeEvent("plan", title, content, { internal: true, step: assistantPasses });
          }
          workingMessages.push({
            role: "tool",
            tool_call_id: String(call.id || `${toolName}-${toolCallsExecuted + 1}`),
            content: content || "Plan note recorded."
          });
          continue;
        }
        if (toolName === "agent_refresh_memory") {
          const parsedArgs = parseJsonObject(toolArgs) || {};
          const reason = sanitizeText(parsedArgs.reason || parsedArgs.summary, 800);
          memoryRefreshRequested = true;
          workingMessages.push({
            role: "tool",
            tool_call_id: String(call.id || `${toolName}-${toolCallsExecuted + 1}`),
            content: reason || "Memory refresh requested."
          });
          continue;
        }
        toolCallsExecuted += 1;
        const cacheKey = toolCallCacheKey(toolName, toolArgs);
        if (isReadOnlyWorkspaceTool(toolName) && readOnlyToolCache.has(cacheKey)) {
          const cached = sanitizeText(readOnlyToolCache.get(cacheKey), 2000);
          readOnlyToolStreak += 1;
          writeEvent("warning", "Duplicate read skipped", `Skipped repeated ${toolName}; using the previous result context.`, {
            tool: toolName,
            duplicate: true
          });
          workingMessages.push({
            role: "tool",
            tool_call_id: String(call.id || `${toolName}-${toolCallsExecuted}`),
            content: [
              `Duplicate ${toolName} skipped by runtime.`,
              cached ? `Previous result summary:\n${trimToolContext(cached, 1200)}` : "",
              wantsWorkspaceMutation ? "For this task, stop repeating read-only calls and use a workspace edit tool when ready." : "Use the previous result context and choose the next action."
            ].filter(Boolean).join("\n\n")
          });
          continue;
        }
        writeEvent("tool_call", toolName, "Tool requested by agent runtime.", {
          tool: toolName,
          arguments: toolArgs
        });
        const toolResult = await params.toolbox.executeToolCall(toolName, toolArgs, params.signal);
        const toolText = sanitizeText(toolResult.traceText || toolResult.modelText, 12000);
        writeEvent("tool_result", toolName, toolText, { tool: toolName });
        if (isWorkspaceEditTool(toolName) && !/^Workspace tool failed/i.test(toolText)) {
          workspaceEditCallsExecuted += 1;
          readOnlyToolStreak = 0;
          antiStallNudgeQueued = false;
        } else if (isReadOnlyWorkspaceTool(toolName)) {
          readOnlyToolStreak += 1;
          readOnlyToolCache.set(cacheKey, toolResult.modelText || toolText);
        } else {
          readOnlyToolStreak = 0;
        }
        workingMessages.push({
          role: "tool",
          tool_call_id: String(call.id || `${toolName}-${toolCallsExecuted}`),
          content: trimToolContext(
            toolResult.modelText || toolText,
            normalizeBoundedInteger(settings.agentToolContextChars, 2600, 400, 12000)
          )
        });
      }
    }

    if (!finalMessage) {
      usedSynthesis = true;
      const synthesisMessages = normalizeToolLoopMessagesForPlainCompletion(workingMessages);
      const result = await generateAssistantTextWithOptionalStream({
        provider,
        modelId,
        messages: synthesisMessages,
        samplerConfig: settings.samplerConfig,
        apiParamPolicy: settings.apiParamPolicy,
        signal: params.signal,
        writer: params.writer
      });
      finalMessage = result.content || "Task complete.";
      finalReasoning = result.reasoning || finalReasoning;
      streamedResponse = result.streamed;
    }

    const summary = sanitizeText(finalMessage, 4000) || "Run completed.";
    completeAgentRun(run.id, "done", summary);
    return {
      runId: run.id,
      finalMessage,
      reasoning: finalReasoning,
      summary,
      status: "done",
      streamedResponse,
      execution: {
        stepCount: assistantPasses,
        toolCalls: toolCallsExecuted,
        subagents: 0,
        planEvents: 0,
        usedSynthesis,
        memoryRefreshRequested
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Agent run failed");
    completeAgentRun(run.id, isAbortLikeMessage(message) ? "aborted" : "error", message);
    throw error;
  }
}

async function runAgentLoop(params: {
  threadId: string;
  title: string;
  depth: number;
  parentRunId?: string | null;
  onRunCreated?: (runId: string) => void;
  signal: AbortSignal;
  toolbox: PreparedAgentToolbox | null;
  subagentBudget: { remaining: number };
  toolDiagnostics?: PreparedMcpServerDiagnostic[];
  writer?: RuntimeEventWriter;
  extraContext?: string[];
  launchIntent?: AgentLaunchIntent;
}): Promise<AgentRunOutcome> {
  const thread = getAgentThread(params.threadId);
  if (!thread) {
    throw new Error("Agent thread not found");
  }
  const { provider, modelId, settings } = resolveProviderForThread(params.threadId);
  const run = createAgentRun({
    threadId: params.threadId,
    parentRunId: params.parentRunId,
    title: params.title,
    depth: params.depth
  });
  if (!run) {
    throw new Error("Failed to create agent run");
  }
  params.onRunCreated?.(run.id);

  const writeEvent = (type: string, title: string, content = "", payload: Record<string, unknown> = {}) => {
    const event = insertAgentEvent({
      threadId: params.threadId,
      runId: run.id,
      type,
      title,
      content,
      payload: {
        depth: params.depth,
        ...payload
      }
    });
    if (event && params.writer) {
      params.writer.emitEvent(event);
    }
    return event;
  };

  if (params.depth === 0 && params.launchIntent) {
    writeEvent(
      "status",
      params.launchIntent.mode === "resume" ? "Resuming prior run" : "Retrying prior run",
      `${params.launchIntent.sourceTitle || "Previous run"} · ${params.launchIntent.sourceStatus}`,
      {
        launchMode: params.launchIntent.mode,
        sourceRunId: params.launchIntent.sourceRunId,
        sourceStatus: params.launchIntent.sourceStatus,
        sourceTitle: params.launchIntent.sourceTitle
      }
    );
  }

  if (params.depth === 0 && Array.isArray(params.toolDiagnostics) && params.toolDiagnostics.some((item) => item.status === "failed")) {
    const failedServers = params.toolDiagnostics.filter((item) => item.status === "failed");
    writeEvent(
      "warning",
      params.toolbox?.tools.length ? "MCP partially available" : "MCP unavailable",
      failedServers
        .map((item) => `${item.serverName}: ${sanitizeText(item.error, 600) || "Unavailable"}`)
        .join("\n"),
      {
        failedServers: failedServers.map((item) => ({
          serverId: item.serverId,
          serverName: item.serverName,
          error: item.error || ""
        })),
        attachedTools: params.toolbox?.tools.length || 0
      }
    );
  }

  if (!provider || !modelId) {
    const fallback = "No provider/model configured for this agent thread. Set one in Settings or in the thread inspector.";
    writeEvent("warning", "Provider missing", fallback);
    completeAgentRun(run.id, "error", fallback);
    return {
      runId: run.id,
      finalMessage: fallback,
      reasoning: "",
      summary: fallback,
      status: "error",
      streamedResponse: false,
      execution: {
        stepCount: 0,
        toolCalls: 0,
        subagents: 0,
        planEvents: 0,
        usedSynthesis: false,
        memoryRefreshRequested: false
      }
    };
  }

  if (settings.fullLocalMode && !isLocalhostUrl(provider.base_url)) {
    const blocked = "Provider blocked by Full Local Mode.";
    writeEvent("error", "Provider blocked", blocked);
    completeAgentRun(run.id, "error", blocked);
    return {
      runId: run.id,
      finalMessage: blocked,
      reasoning: "",
      summary: blocked,
      status: "error",
      streamedResponse: false,
      execution: {
        stepCount: 0,
        toolCalls: 0,
        subagents: 0,
        planEvents: 0,
        usedSynthesis: false,
        memoryRefreshRequested: false
      }
    };
  }

  try {
    const scratchpad: string[] = [];
    let activeSkillIds: string[] = [];
    let finalMessage = "";
    let finalReasoning = "";
    let lastSummary = "";
    let pendingResults = false;
    let stepCount = 0;
    let toolCallCount = 0;
    let subagentCount = 0;
    let planEventCount = 0;
    let usedSynthesis = false;
    let streamedResponse = false;
    let memoryRefreshRequested = false;
    const maxIterations = Math.max(1, Math.min(12, thread.maxIterations || 6));
    const latestUserInput = latestUserMessageText(params.threadId);
    const wantsWorkspaceMutation = userAskedForWorkspaceMutation(latestUserInput) && hasWorkspaceEditTools(params.toolbox);
    const readOnlyToolCache = new Map<string, string>();
    let readOnlyToolStreak = 0;
    let workspaceEditCallsExecuted = 0;
    let antiStallNudgeQueued = false;

    for (let step = 1; step <= maxIterations; step += 1) {
      if (params.signal.aborted) {
        throw new Error("Aborted");
      }
      stepCount = step;
      applySteeringNotes({
        threadId: params.threadId,
        runId: run.id,
        writeEvent,
        scratchpad
      });
      if (wantsWorkspaceMutation && workspaceEditCallsExecuted === 0 && readOnlyToolStreak >= READ_ONLY_STALL_THRESHOLD && !antiStallNudgeQueued) {
        antiStallNudgeQueued = true;
        writeEvent(
          "warning",
          "Read-only loop guard",
          "The planner has repeated read-only context gathering. Runtime nudged it to apply a workspace edit or state the blocker.",
          { step, readOnlyToolStreak }
        );
        scratchpad.push([
          `[Step ${step}] Runtime anti-stall note: the user asked for a code/file change, but recent tool calls were read-only.`,
          "If enough context is available, request a workspace edit tool next. Do not repeat the same read/search."
        ].join("\n"));
      }

      const plannerMessages = buildPlannerMessages({
        threadId: params.threadId,
        settings,
        activeSkillIds,
        scratchpad,
        toolbox: params.toolbox,
        depth: params.depth,
        remainingSubagents: params.subagentBudget.remaining,
        extraContext: params.extraContext
      });

      const plannerResult = await generatePlannerResult({
        provider,
        modelId,
        messages: plannerMessages,
        samplerConfig: settings.samplerConfig,
        apiParamPolicy: settings.apiParamPolicy,
        signal: params.signal
      });
      if (plannerResult.reasoning && params.depth === 0) {
        finalReasoning = sanitizeText(plannerResult.reasoning, 12000) || finalReasoning;
      }

      const parsed = parseJsonObject(plannerResult.content);
      const salvaged = parsed ? null : salvageAgentStep(plannerResult.content);
      if (!parsed && !salvaged) {
        lastSummary = "Planner returned malformed structured output.";
        scratchpad.push(`[Step ${step}] Planner returned malformed structured output.\n${sanitizeText(plannerResult.content, 2000) || "No planner content."}`);
        writeEvent("warning", "Planner output invalid", "Planner returned malformed JSON. Falling back to answer synthesis.", { step });
        break;
      }

      const stepResult = parsed ? normalizeAgentStep(parsed) : salvaged!;
      if (!parsed && salvaged) {
        writeEvent("warning", "Planner output repaired", "Recovered the assistant reply from malformed structured output.", { step });
      }
      lastSummary = stepResult.summary || stepResult.assistantMessage || `Completed planning step ${step}`;
      const enabledSkillIds = new Set(listAgentSkills(params.threadId).filter((skill) => skill.enabled).map((skill) => skill.id));
      activeSkillIds = stepResult.skillIds.filter((id) => enabledSkillIds.has(id));
      const hasExternalToolCalls = stepResult.toolCalls.some((toolCall) => !isAgentRuntimeToolName(sanitizeText(toolCall.tool, 200)));
      const hasActionableWork = hasExternalToolCalls || stepResult.subagents.length > 0;

      const stepReports: string[] = [];
      pendingResults = false;

      for (const toolCall of stepResult.toolCalls) {
        const toolName = sanitizeText(toolCall.tool, 200);
        if (isAgentRuntimeToolName(toolName)) {
          if (toolName === "agent_log_plan") {
            const title = sanitizeText(toolCall.arguments.title, 160) || `Step ${step}`;
            const content = sanitizeText(toolCall.arguments.content || toolCall.reason || stepResult.summary, 4000);
            if (content) {
              planEventCount += 1;
              writeEvent("plan", title, content, { step, internal: true });
            }
          }
          if (toolName === "agent_refresh_memory") {
            memoryRefreshRequested = true;
            const reason = sanitizeText(toolCall.arguments.reason || toolCall.reason || toolCall.arguments.summary, 500);
            const summaryHint = sanitizeText(toolCall.arguments.summary, 800);
            stepReports.push(`[Memory refresh requested]\n${[reason, summaryHint].filter(Boolean).join("\n")}`.trim());
          }
          continue;
        }
        if (!params.toolbox) break;
        if (!toolName || !params.toolbox.tools.some((tool) => tool.function.name === toolName)) {
          writeEvent("warning", "Tool skipped", `Unknown or disabled tool: ${toolName}`, { step, tool: toolName });
          continue;
        }
        pendingResults = true;
        const rawArgs = JSON.stringify(toolCall.arguments || {});
        const cacheKey = toolCallCacheKey(toolName, rawArgs);
        if (isReadOnlyWorkspaceTool(toolName) && readOnlyToolCache.has(cacheKey)) {
          const cached = sanitizeText(readOnlyToolCache.get(cacheKey), 2000);
          readOnlyToolStreak += 1;
          writeEvent("warning", "Duplicate read skipped", `Skipped repeated ${toolName}; using previous result context.`, {
            step,
            tool: toolName,
            duplicate: true
          });
          stepReports.push([
            `[Duplicate ${toolName} skipped]`,
            cached ? `Previous result summary:\n${trimToolContext(cached, 1200)}` : "",
            wantsWorkspaceMutation ? "Runtime note: stop repeating read-only calls and request a workspace edit tool when ready." : "Use the previous result context and choose the next action."
          ].filter(Boolean).join("\n\n"));
          continue;
        }
        toolCallCount += 1;
        writeEvent(
          "tool_call",
          toolName,
          toolCall.reason || "Tool requested by planner.",
          { step, tool: toolName, arguments: toolCall.arguments }
        );
        const toolResult = await params.toolbox.executeToolCall(toolName, rawArgs, params.signal);
        const toolText = sanitizeText(toolResult.traceText || toolResult.modelText, 12000);
        writeEvent("tool_result", toolName, toolText, { step, tool: toolName });
        if (isWorkspaceEditTool(toolName) && !/^Workspace tool failed/i.test(toolText)) {
          workspaceEditCallsExecuted += 1;
          readOnlyToolStreak = 0;
          antiStallNudgeQueued = false;
        } else if (isReadOnlyWorkspaceTool(toolName)) {
          readOnlyToolStreak += 1;
          readOnlyToolCache.set(cacheKey, toolResult.modelText || toolText);
        } else {
          readOnlyToolStreak = 0;
        }
        stepReports.push(`[Tool ${toolName}]\n${trimToolContext(
          toolResult.modelText || toolText,
          normalizeBoundedInteger(settings.agentToolContextChars, 2600, 400, 12000)
        )}`);
      }

      for (const subagent of stepResult.subagents) {
        if (params.depth >= MAX_SUBAGENT_DEPTH) {
          writeEvent("warning", "Subagent skipped", `Depth limit reached for ${subagent.title}.`, { step, title: subagent.title });
          continue;
        }
        if (params.subagentBudget.remaining <= 0) {
          writeEvent("warning", "Subagent skipped", `Subagent budget exhausted for ${subagent.title}.`, {
            step,
            title: subagent.title,
            role: subagent.role,
            reason: "budget_exhausted"
          });
          continue;
        }
        params.subagentBudget.remaining -= 1;
        pendingResults = true;
        subagentCount += 1;
        writeEvent("subagent_start", subagent.title, `${subagent.role}: ${subagent.goal}`, {
          step,
          title: subagent.title,
          role: subagent.role
        });
        const subagentResult = await runAgentLoop({
          threadId: params.threadId,
          title: subagent.title,
          depth: params.depth + 1,
          parentRunId: run.id,
          signal: params.signal,
          toolbox: params.toolbox,
          subagentBudget: params.subagentBudget,
          writer: params.writer,
          extraContext: [
            `You are acting as a subagent for the parent goal "${params.title}".`,
            `Subagent title: ${subagent.title}`,
            `Subagent goal: ${subagent.goal}`,
            `Subagent role: ${subagent.role}.`,
            buildSubagentRolePolicy(subagent.role),
            subagent.instructions ? `Additional instructions: ${subagent.instructions}` : ""
          ].filter(Boolean)
        });
        writeEvent("subagent_done", subagent.title, subagentResult.finalMessage, {
          step,
          title: subagent.title,
          role: subagent.role,
          childRunId: subagentResult.runId,
          childStatus: subagentResult.status
        });
        stepReports.push(`[Subagent ${subagent.title}]\n${subagentResult.finalMessage}`);
      }

      if (stepReports.length > 0) {
        scratchpad.push(`[Step ${step}] ${lastSummary}\n\n${stepReports.join("\n\n")}`);
      } else if (stepResult.summary || stepResult.assistantMessage) {
        scratchpad.push(`[Step ${step}] ${[stepResult.summary, stepResult.assistantMessage].filter(Boolean).join("\n")}`);
      }

      if (!pendingResults) {
        const steeringNotesApplied = applySteeringNotes({
          threadId: params.threadId,
          runId: run.id,
          writeEvent,
          scratchpad
        });
        if (steeringNotesApplied > 0) {
          finalMessage = "";
          lastSummary = lastSummary || "User correction received";
          continue;
        }
        if (stepResult.status === "continue" && !hasActionableWork && (toolCallCount > 0 || subagentCount > 0 || step > 1)) {
          const looksIntermediate = messageLooksLikeIntermediateProgress(stepResult.assistantMessage);
          const shouldPreferSynthesis = looksIntermediate || toolCallCount > 0 || subagentCount > 0;
          writeEvent(
            "warning",
            "Planner continuation stalled",
            "Planner requested another step without any new tool calls or subagent work. Runtime stopped the loop and finalized from completed work instead of spinning.",
            { step, repaired: !parsed, looksIntermediate, toolCallsCompleted: toolCallCount, subagentsCompleted: subagentCount }
          );
          scratchpad.push(`[Step ${step}] Runtime note: planner requested continue without any new actionable work. Stop the loop and synthesize/finalize from completed work so far.`);
          finalMessage = shouldPreferSynthesis ? "" : (stepResult.assistantMessage || finalMessage || lastSummary);
          break;
        }
        if (shouldContinueAfterIntermediateReply({
          threadId: params.threadId,
          stepResult,
          toolbox: params.toolbox,
          step,
          maxIterations
        })) {
          const continuationNote = "Recovered progress-style reply; continuing the run instead of finishing early.";
          writeEvent("warning", "Planner continuation inferred", continuationNote, { step, inferred: true });
          scratchpad.push(`[Step ${step}] Runtime note: previous assistant draft looked like an intermediate progress update, not a completed result. Continue execution instead of stopping early.`);
          continue;
        }
        finalMessage = stepResult.assistantMessage || finalMessage || lastSummary;
        if (stepResult.status !== "continue") break;
      } else if (stepResult.status === "done" && stepResult.assistantMessage) {
        finalMessage = stepResult.assistantMessage;
      }
    }

    applySteeringNotes({
      threadId: params.threadId,
      runId: run.id,
      writeEvent,
      scratchpad
    });
    if (!finalMessage || pendingResults) {
      writeEvent("status", "Synthesizing answer", "Writing the final response.");
      usedSynthesis = true;
      const synthesis = await generateAssistantTextWithOptionalStream({
        provider,
        modelId,
        messages: buildSynthesisMessages({
          threadId: params.threadId,
          settings,
          scratchpad,
          activeSkillIds,
          extraContext: params.extraContext
        }),
        samplerConfig: settings.samplerConfig,
        apiParamPolicy: settings.apiParamPolicy,
        signal: params.signal,
        writer: params.depth === 0 ? params.writer : undefined
      });
      finalMessage = synthesis.content || finalMessage || lastSummary || "Task complete.";
      finalReasoning = synthesis.reasoning || finalReasoning;
      streamedResponse = synthesis.streamed;
    }

    const summary = sanitizeText(lastSummary || finalMessage, 4000) || "Run completed.";
    completeAgentRun(run.id, "done", summary);
    return {
      runId: run.id,
      finalMessage,
      reasoning: finalReasoning,
      summary,
      status: "done",
      streamedResponse,
      execution: {
        stepCount,
        toolCalls: toolCallCount,
        subagents: subagentCount,
        planEvents: planEventCount,
        usedSynthesis,
        memoryRefreshRequested
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Agent run failed");
    const status = isAbortLikeMessage(message) ? "aborted" : "error";
    writeEvent(status === "aborted" ? "warning" : "error", status === "aborted" ? "Run aborted" : "Run failed", message);
    completeAgentRun(run.id, status, message);
    if (status === "aborted" && params.depth > 0) {
        return {
          runId: run.id,
          finalMessage: "Subagent aborted.",
          reasoning: "",
          summary: message,
          status,
          streamedResponse: false,
          execution: {
            stepCount: 0,
            toolCalls: 0,
            subagents: 0,
            planEvents: 0,
            usedSynthesis: false,
            memoryRefreshRequested: false
          }
      };
    }
    if (status === "error" && params.depth > 0) {
        return {
          runId: run.id,
          finalMessage: message,
          reasoning: "",
          summary: message,
          status,
          streamedResponse: false,
          execution: {
            stepCount: 0,
            toolCalls: 0,
            subagents: 0,
            planEvents: 0,
            usedSynthesis: false,
            memoryRefreshRequested: false
          }
      };
    }
    throw error;
  }
}

function shouldRefreshMemoryForRun(params: {
  result: AgentRunOutcome;
  launchIntent?: AgentLaunchIntent;
  extraContext?: string[];
}) {
  if (params.result.status !== "done") return false;
  if (params.result.execution.memoryRefreshRequested) return true;
  if (params.launchIntent) return true;
  if ((params.extraContext?.length || 0) > 0) return true;
  return params.result.execution.toolCalls > 1
    || params.result.execution.subagents > 0
    || params.result.execution.planEvents > 1
    || (params.result.execution.usedSynthesis && params.result.execution.stepCount > 1)
    || params.result.execution.stepCount > 2;
}

export async function streamAgentTurn(params: {
  threadId: string;
  pendingUserMessageId?: string | null;
  res: Response;
  extraContext?: string[];
  launchIntent?: AgentLaunchIntent;
}): Promise<void> {
  const thread = getAgentThread(params.threadId);
  if (!thread) {
    params.res.status(404).json({ error: "Agent thread not found" });
    return;
  }

  beginSse(params.res);
  const abortController = new AbortController();
  activeAgentAbortControllers.set(params.threadId, abortController);
  let responseSettled = false;

  params.res.on("finish", () => {
    responseSettled = true;
    activeAgentAbortControllers.delete(params.threadId);
  });
  params.res.on("close", () => {
    if (!responseSettled) {
      abortController.abort();
    }
    activeAgentAbortControllers.delete(params.threadId);
  });

  let liveDraftContent = "";
  let liveDraftReasoning = "";
  let currentRunId: string | null = null;
  const writer: RuntimeEventWriter = {
    emitEvent(event) {
      sendSsePayload(params.res, { type: "agent_event", event });
    },
    emitMessage(message) {
      sendSsePayload(params.res, { type: "agent_message", message });
    },
    emitDelta(delta) {
      liveDraftContent += delta;
      sendSsePayload(params.res, { type: "delta", delta });
    },
    emitReasoningDelta(delta) {
      liveDraftReasoning += delta;
      sendSsePayload(params.res, { type: "reasoning_delta", delta });
    },
    getDraft() {
      return {
        content: liveDraftContent,
        reasoning: liveDraftReasoning
      };
    },
    clearDraft() {
      liveDraftContent = "";
      liveDraftReasoning = "";
    }
  };
  activeAgentRuntimeWriters.set(params.threadId, writer);

  let toolbox: PreparedAgentToolbox | null = null;
  try {
    toolbox = await prepareToolbox(params.threadId);
    const onRunCreated = (runId: string) => {
      currentRunId = runId;
      if (!params.pendingUserMessageId) return;
      assignAgentMessageRunId(params.threadId, params.pendingUserMessageId, runId);
    };
    let result: AgentRunOutcome;
    if (shouldUseDirectReplyPath({
      threadId: params.threadId,
      launchIntent: params.launchIntent,
      extraContext: params.extraContext
    })) {
      result = await runDirectReply({
        threadId: params.threadId,
        title: thread.title,
        onRunCreated,
        signal: abortController.signal,
        extraContext: params.extraContext,
        writer
      });
    } else if (shouldUseDirectToolLoop({
      threadId: params.threadId,
      toolbox,
      launchIntent: params.launchIntent,
      extraContext: params.extraContext
    })) {
      try {
        result = await runDirectToolLoop({
          threadId: params.threadId,
          title: thread.title,
          onRunCreated,
          signal: abortController.signal,
          toolbox: toolbox!,
          writer,
          extraContext: params.extraContext
        });
      } catch (toolLoopError) {
        const message = toolLoopError instanceof Error ? toolLoopError.message : String(toolLoopError || "");
        if (!/tool|function|unsupported|chat\/completions/i.test(message)) {
          throw toolLoopError;
        }
        result = await runAgentLoop({
          threadId: params.threadId,
          title: thread.title,
          depth: 0,
          onRunCreated,
          signal: abortController.signal,
          toolbox,
          subagentBudget: {
            remaining: Math.max(0, Math.min(6, Number.isFinite(thread.maxSubagents) ? thread.maxSubagents : 2))
          },
          toolDiagnostics: toolbox?.diagnostics,
          writer,
          extraContext: params.extraContext,
          launchIntent: params.launchIntent
        });
      }
    } else {
      result = await runAgentLoop({
        threadId: params.threadId,
        title: thread.title,
        depth: 0,
        onRunCreated,
        signal: abortController.signal,
        toolbox,
        subagentBudget: {
          remaining: Math.max(0, Math.min(6, Number.isFinite(thread.maxSubagents) ? thread.maxSubagents : 2))
        },
        toolDiagnostics: toolbox?.diagnostics,
        writer,
        extraContext: params.extraContext,
        launchIntent: params.launchIntent
      });
    }
    if (!result.streamedResponse) {
      await streamTextDeltas(result.finalMessage, writer);
    }
    insertAndEmitAssistantMessage({
      threadId: params.threadId,
      runId: result.runId,
      content: result.finalMessage,
      reasoning: result.reasoning || undefined,
      metadata: {
        summary: result.summary
      },
      writer
    });
    if (shouldRefreshMemoryForRun({
      result,
      launchIntent: params.launchIntent,
      extraContext: params.extraContext
    })) {
      try {
        await refreshThreadMemory({
          threadId: params.threadId,
          runId: result.runId,
          summary: result.summary,
          finalMessage: result.finalMessage,
          signal: abortController.signal,
          writer
        });
      } catch (memoryError) {
        const message = memoryError instanceof Error ? memoryError.message : String(memoryError || "Failed to refresh thread memory");
        const event = insertAgentEvent({
          threadId: params.threadId,
          runId: result.runId,
          type: "warning",
          title: "Memory refresh skipped",
          content: sanitizeText(message, 2000),
          payload: {}
        });
        if (event) {
          writer.emitEvent(event);
        }
      }
    }
    setAgentThreadStatus(params.threadId, result.status === "done" ? "idle" : "error");
    sendDone(params.res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Agent run failed");
    const status = isAbortLikeMessage(message) ? "aborted" : "error";
    const draft = writer.getDraft();
    if ((draft.content.trim() || draft.reasoning.trim()) && currentRunId) {
      insertAndEmitAssistantMessage({
        threadId: params.threadId,
        runId: currentRunId,
        content: draft.content.trim() || (status === "aborted" ? "" : "Partial agent response interrupted before completion."),
        reasoning: draft.reasoning,
        metadata: {
          interrupted: true,
          interruptedStatus: status,
          interruptedReason: sanitizeText(message, 1000)
        },
        writer
      });
    }
    setAgentThreadStatus(params.threadId, status === "aborted" ? "idle" : "error");
    sendSsePayload(params.res, {
      type: "agent_event",
      event: {
        id: `error-${Date.now()}`,
        threadId: params.threadId,
        runId: "",
        type: "error",
        title: status === "aborted" ? "Run aborted" : "Run failed",
        content: message,
        payload: {},
        order: 0,
        createdAt: new Date().toISOString()
      }
    });
    sendDone(params.res);
  } finally {
    await toolbox?.close().catch(() => undefined);
    activeAgentRuntimeWriters.delete(params.threadId);
    activeAgentSteeringNotes.delete(params.threadId);
    activeAgentAbortControllers.delete(params.threadId);
  }
}
