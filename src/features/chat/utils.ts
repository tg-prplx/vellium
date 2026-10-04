import { marked } from "marked";
import { resolveApiAssetUrl } from "../../shared/api";
import type { AppSettings, FileAttachment, PromptBlock, RpSceneState } from "../../shared/types/contracts";
import { DEFAULT_CHAT_SECURITY_SETTINGS, DEFAULT_PROMPT_STACK, REASONING_CALL_NAME, type ChatMode } from "./constants";
import { sanitizeHtmlFragment } from "./htmlSanitizer";

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

// Browsers drop ASCII tab/newline inside URLs, so "/\t/host" would become "//host".
function normalizeUrlInput(raw: string | null | undefined): string {
  return String(raw || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function sanitizeLinkUrl(raw: string | null | undefined, allowExternalLinks: boolean): string | null {
  const href = normalizeUrlInput(raw);
  if (!href) return null;
  if (/^(javascript|data|vbscript|file):/i.test(href)) return null;
  if (/^(https?:|mailto:)/i.test(href)) {
    return allowExternalLinks ? href : null;
  }
  if (isSameOriginRelativeUrl(href) || href.startsWith("#")) {
    return href;
  }
  return null;
}

// "//host/x" and "/\host/x" are protocol-relative URLs to another host, not app paths.
function isSameOriginRelativeUrl(value: string): boolean {
  return /^(\/|\.{1,2}\/)/.test(value) && !/^[\/\\]{2}/.test(value);
}

// Only loopback images bypass the remote-image setting; LAN/private hosts are
// treated as remote so model output cannot fire GET requests at routers or NAS.
function isTrustedLocalImageUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return hostname === "localhost"
      || hostname === "::1"
      || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
  } catch {
    return false;
  }
}

function sanitizeImageUrl(raw: string | null | undefined, allowRemoteImages: boolean): string | null {
  const src = normalizeUrlInput(raw);
  if (!src) return null;
  if (/^(javascript|data|vbscript|file):/i.test(src)) return null;
  if (/^https?:/i.test(src)) {
    return allowRemoteImages || isTrustedLocalImageUrl(src) ? src : null;
  }
  if (isSameOriginRelativeUrl(src)) {
    return src;
  }
  return null;
}

function renderMarkdownSafe(text: string, security: AppSettings["security"]): string {
  const renderer = new marked.Renderer();
  const customRenderer = renderer as any;
  const urlPolicy = {
    sanitizeLinkUrl: (raw: string) => sanitizeLinkUrl(raw, security.allowExternalLinks),
    sanitizeImageUrl: (raw: string) => sanitizeImageUrl(raw, security.allowRemoteImages)
  };

  // With strict sanitization off, inline HTML keeps formatting tags but still
  // passes an allowlist; it is never inserted raw.
  customRenderer.html = (token: { text?: string } | string) => {
    const raw = typeof token === "string" ? token : String(token?.text || "");
    return security.sanitizeMarkdown === false ? sanitizeHtmlFragment(raw, urlPolicy) : escapeHtml(raw);
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
    breaks: false,
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

function renderedHtmlHasVisibleContent(html: string): boolean {
  const source = String(html || "");
  if (/<(?:img|video|iframe|audio|table|hr)\b/i.test(source)) return true;
  const text = source
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#96;/gi, "x")
    .trim();
  return text.length > 0;
}

export function renderContentWithFallback(
  text: string,
  charName?: string,
  userName?: string,
  security: AppSettings["security"] = DEFAULT_CHAT_SECURITY_SETTINGS
): string {
  const replaced = replacePlaceholders(text, charName, userName);
  const html = renderMarkdownSafe(replaced, security);
  if (renderedHtmlHasVisibleContent(html) || !String(replaced || "").trim()) {
    return html;
  }
  const paragraphs = String(replaced).trim().split(/\r?\n(?:[ \t]*\r?\n)+/);
  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replace(/ {2,}\r?\n/g, "<br />").replace(/\r?\n/g, " ")}</p>`)
    .join("\n");
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
  const resolvedUrl = resolveApiAssetUrl(att.url);
  if (!resolvedUrl) return null;
  if (/^blob:/i.test(resolvedUrl)) return resolvedUrl;
  if (/^https?:/i.test(resolvedUrl) || resolvedUrl.startsWith("/")) {
    return resolvedUrl.toLowerCase().includes(".svg") ? null : resolvedUrl;
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
  resultSummary?: string;
  media?: Array<{
    type: "image";
    url: string;
    markdown?: string;
    alt?: string;
  }>;
}

export interface ParsedToolResultDisplay {
  result: string;
  resultSummary?: string;
  media: Array<{
    type: "image";
    url: string;
    markdown?: string;
    alt?: string;
  }>;
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

export function normalizeReasoningDisplayText(text: string) {
  const source = String(text || "").trim();
  if (!source) return "";
  const lines = source.split(/\r?\n/);
  const meaningfulLines = lines.map((line) => line.trim()).filter(Boolean);
  if (meaningfulLines.length < 6) return source;

  const codeOrListLines = meaningfulLines.filter((line) => /^(```|[-*+]\s|\d+[.)]\s|#{1,6}\s|\|)/.test(line)).length;
  if (codeOrListLines > 0) return source;

  const shortFragmentLines = meaningfulLines.filter((line) => (
    line.length <= 32 && line.split(/\s+/).length <= 3
  )).length;
  const shortFragmentRatio = shortFragmentLines / meaningfulLines.length;
  if (shortFragmentRatio < 0.7) return source;

  return meaningfulLines
    .join(" ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s+(['’]s\b)/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseToolResultDisplay(rawResult: string): ParsedToolResultDisplay {
  const source = String(rawResult || "").trim();
  if (!source.startsWith("{")) {
    return {
      result: String(rawResult || ""),
      resultSummary: undefined,
      media: []
    };
  }
  try {
    const parsed = JSON.parse(source) as {
      kind?: unknown;
      summary?: unknown;
      media?: Array<{ type?: unknown; url?: unknown; markdown?: unknown; alt?: unknown }>;
    };
    if (parsed.kind !== "vellium_media_result" || !Array.isArray(parsed.media)) {
      return {
        result: String(rawResult || ""),
        resultSummary: undefined,
        media: []
      };
    }
    const media = parsed.media
      .map((item) => {
        const type = String(item?.type || "").trim();
        const url = String(item?.url || "").trim();
        if (type !== "image" || !url) return null;
        return {
          type: "image" as const,
          url,
          markdown: String(item?.markdown || "").trim() || undefined,
          alt: String(item?.alt || "").trim() || undefined
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    return {
      result: String(rawResult || ""),
      resultSummary: String(parsed.summary || "").trim() || "Image created and shown to the user.",
      media
    };
  } catch {
    return {
      result: String(rawResult || ""),
      resultSummary: undefined,
      media: []
    };
  }
}

export function parseToolCallContent(content: string): ParsedToolCallContent {

  try {
    const parsed = JSON.parse(content) as Partial<ParsedToolCallContent> & { kind?: string };
    if (parsed && typeof parsed === "object" && parsed.kind === "tool_call") {
      const resultDisplay = parseToolResultDisplay(String(parsed.result || ""));
      return {
        callId: String(parsed.callId || "").trim(),
        name: String(parsed.name || "tool").trim() || "tool",
        args: String(parsed.args || "{}"),
        result: resultDisplay.result,
        resultSummary: resultDisplay.resultSummary,
        media: resultDisplay.media
      };
    }
  } catch {
    // Legacy tool format fallback below.
  }

  const lines = String(content || "").split("\n");
  const first = lines.find((line) => line.startsWith("Tool:")) || "";
  const name = first.replace(/^Tool:\s*/i, "").trim() || "tool";
  const resultDisplay = parseToolResultDisplay(String(content || ""));
  return {
    callId: "",
    name,
    args: name === REASONING_CALL_NAME ? "" : "{}",
    result: resultDisplay.result,
    resultSummary: resultDisplay.resultSummary,
    media: resultDisplay.media
  };
}
