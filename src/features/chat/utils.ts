import { marked } from "marked";
import type { FileAttachment, PromptBlock, RpSceneState } from "../../shared/types/contracts";
import { DEFAULT_PROMPT_STACK, REASONING_CALL_NAME, type ChatMode } from "./constants";

marked.setOptions({
  breaks: true,
  gfm: true
});

export function replacePlaceholders(text: string, charName?: string, userName?: string): string {
  let result = text;
  if (charName) result = result.replace(/\{\{char\}\}/gi, charName);
  if (userName) result = result.replace(/\{\{user\}\}/gi, userName);
  return result;
}

export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

export function renderContent(text: string, charName?: string, userName?: string): string {
  return renderMarkdown(replacePlaceholders(text, charName, userName));
}

export function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml"
  };
  return map[ext] || "application/octet-stream";
}

export function imageSourceFromAttachment(att: FileAttachment): string | null {
  if (att.type !== "image") return null;
  if (att.dataUrl?.startsWith("data:image/")) return att.dataUrl;
  if (att.url?.startsWith("http://") || att.url?.startsWith("https://") || att.url?.startsWith("/")) return att.url;
  return null;
}

export function normalizePromptStack(raw: PromptBlock[] | null | undefined): PromptBlock[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_PROMPT_STACK];
  return [...raw]
    .sort((a, b) => a.order - b.order)
    .map((block, index) => ({ ...block, order: index + 1 }));
}

export function resolveChatMode(state: Partial<RpSceneState> | null | undefined): ChatMode {
  if (state?.chatMode === "rp" || state?.chatMode === "light_rp" || state?.chatMode === "pure_chat") {
    return state.chatMode;
  }
  if (state?.pureChatMode === true) return "pure_chat";
  return "rp";
}

export function sanitizeSceneVariables(variables: Record<string, string> | null | undefined): Record<string, string> {
  const next = { ...(variables || {}) };
  delete next.location;
  delete next.time;
  return next;
}

export function readSceneVarPercent(variables: Record<string, string>, key: string, fallback: number): number {
  const raw = Number(variables[key]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export interface ParsedToolCallContent {
  callId: string;
  name: string;
  args: string;
  result: string;
}

export interface ParsedInlineReasoning {
  content: string;
  reasoning: string;
}

export function parseInlineReasoning(text: string): ParsedInlineReasoning {
  const source = String(text || "");
  const pattern = /<think>([\s\S]*?)<\/think>/gi;
  let lastIndex = 0;
  let visible = "";
  const reasoningParts: string[] = [];

  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    visible += source.slice(lastIndex, index);
    const reasoning = String(match[1] || "").trim();
    if (reasoning) reasoningParts.push(reasoning);
    lastIndex = index + match[0].length;
  }

  if (lastIndex === 0) {
    return {
      content: source,
      reasoning: ""
    };
  }

  visible += source.slice(lastIndex);
  return {
    content: visible,
    reasoning: reasoningParts.join("\n\n").trim()
  };
}

export function parseToolCallContent(content: string): ParsedToolCallContent {
  try {
    const parsed = JSON.parse(content) as Partial<ParsedToolCallContent> & { kind?: string };
    if (parsed && typeof parsed === "object" && parsed.kind === "tool_call") {
      return {
        callId: String(parsed.callId || "").trim(),
        name: String(parsed.name || "tool").trim() || "tool",
        args: String(parsed.args || "{}"),
        result: String(parsed.result || "")
      };
    }
  } catch {
    // Legacy tool format fallback below.
  }

  const lines = String(content || "").split("\n");
  const first = lines.find((line) => line.startsWith("Tool:")) || "";
  const name = first.replace(/^Tool:\s*/i, "").trim() || "tool";
  return {
    callId: "",
    name,
    args: name === REASONING_CALL_NAME ? "" : "{}",
    result: String(content || "")
  };
}
