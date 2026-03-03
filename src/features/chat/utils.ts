import { marked } from "marked";
import type { AppSettings, FileAttachment, PromptBlock, RpSceneState } from "../../shared/types/contracts";
import { DEFAULT_CHAT_SECURITY_SETTINGS, DEFAULT_PROMPT_STACK, REASONING_CALL_NAME, type ChatMode } from "./constants";

export function replacePlaceholders(text: string, charName?: string, userName?: string): string {
  let result = text;
  if (charName) result = result.replace(/\{\{char\}\}/gi, charName);
  if (userName) result = result.replace(/\{\{user\}\}/gi, userName);
  return result;
}

export function renderMarkdown(text: string): string {
  return renderMarkdownSafe(text, DEFAULT_CHAT_SECURITY_SETTINGS);
}

function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/`/g, "&#96;");
}

function sanitizeLinkUrl(raw: string | null | undefined, allowExternalLinks: boolean): string | null {
  const href = String(raw || "").trim();
  if (!href) return null;
  if (/^(javascript|data|vbscript|file):/i.test(href)) return null;
  if (/^(https?:|mailto:)/i.test(href)) {
    return allowExternalLinks ? href : null;
  }
  if (/^(\/|#|\.{1,2}\/)/.test(href)) {
    return href;
  }
  return null;
}

function sanitizeImageUrl(raw: string | null | undefined, allowRemoteImages: boolean): string | null {
  const src = String(raw || "").trim();
  if (!src) return null;
  if (/^(javascript|data|vbscript|file):/i.test(src)) return null;
  if (/^https?:/i.test(src)) {
    return allowRemoteImages ? src : null;
  }
  if (/^(\/|\.{1,2}\/)/.test(src)) {
    return src;
  }
  return null;
}

function renderMarkdownSafe(text: string, security: AppSettings["security"]): string {
  if (security.sanitizeMarkdown === false) {
    return marked.parse(text, { async: false, breaks: true, gfm: true }) as string;
  }

  const renderer = new marked.Renderer();
  const customRenderer = renderer as any;

  customRenderer.html = (token: { text?: string } | string) => {
    const raw = typeof token === "string" ? token : String(token?.text || "");
    return escapeHtml(raw);
  };

  customRenderer.link = function link(token: { href?: string; title?: string | null; tokens?: unknown[] }) {
    const href = sanitizeLinkUrl(token?.href, security.allowExternalLinks);
    const textHtml = this.parser?.parseInline?.(Array.isArray(token?.tokens) ? token.tokens : []) || escapeHtml(token?.href || "");
    if (!href) return textHtml;
    const title = token?.title ? ` title="${escapeAttr(token.title)}"` : "";
    return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow"${title}>${textHtml}</a>`;
  };

  customRenderer.image = (token: { href?: string; text?: string; title?: string | null }) => {
    const src = sanitizeImageUrl(token?.href, security.allowRemoteImages);
    if (!src) return "";
    const alt = escapeAttr(String(token?.text || ""));
    const title = token?.title ? ` title="${escapeAttr(token.title)}"` : "";
    return `<img src="${escapeAttr(src)}" alt="${alt}"${title} loading="lazy" referrerpolicy="no-referrer" />`;
  };

  return marked.parse(text, {
    async: false,
    breaks: true,
    gfm: true,
    renderer
  }) as string;
}

export function renderContent(
  text: string,
  charName?: string,
  userName?: string,
  security: AppSettings["security"] = DEFAULT_CHAT_SECURITY_SETTINGS
): string {
  return renderMarkdownSafe(replacePlaceholders(text, charName, userName), security);
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
  if ((att.mimeType || "").toLowerCase() === "image/svg+xml") return null;
  if (att.dataUrl?.startsWith("data:image/")) return att.dataUrl;
  if (att.url?.startsWith("http://") || att.url?.startsWith("https://")) {
    return att.url.toLowerCase().includes(".svg") ? null : att.url;
  }
  if (att.url?.startsWith("/")) {
    return att.url.toLowerCase().includes(".svg") ? null : att.url;
  }
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
