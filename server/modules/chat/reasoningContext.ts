import { roughTokenCount } from "../../db/utils.js";

const REASONING_CALL_NAME = "__reasoning__";

interface TimelineMessage {
  id: string;
  role: string;
  content: string;
  parentId?: string | null;
  tokenCount?: number;
}

export type ReasoningAwareMessage<T extends TimelineMessage> = T & {
  reasoningContent?: string;
};

interface StoredMediaReference {
  url: string;
  markdown?: string;
}

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gi;

export function extractStoredReasoning(content: string): string {
  try {
    const parsed = JSON.parse(String(content || "")) as {
      kind?: unknown;
      name?: unknown;
      result?: unknown;
    };
    if (parsed.kind !== "tool_call" || parsed.name !== REASONING_CALL_NAME) return "";
    return typeof parsed.result === "string" ? parsed.result.trim() : "";
  } catch {
    return "";
  }
}

export function extractStoredMediaReferences(content: string): StoredMediaReference[] {
  try {
    const toolTrace = JSON.parse(String(content || "")) as {
      kind?: unknown;
      result?: unknown;
    };
    if (toolTrace.kind !== "tool_call" || typeof toolTrace.result !== "string") return [];
    const mediaTrace = JSON.parse(toolTrace.result) as {
      kind?: unknown;
      media?: Array<{ type?: unknown; url?: unknown; markdown?: unknown }>;
    };
    if (mediaTrace.kind !== "vellium_media_result" || !Array.isArray(mediaTrace.media)) return [];
    return mediaTrace.media.flatMap((item): StoredMediaReference[] => {
      if (!item || item.type !== "image") return [];
      const url = String(item.url || "").trim();
      if (!url) return [];
      const markdown = String(item.markdown || "").trim();
      return [{ url, markdown: markdown || undefined }];
    });
  } catch {
    return [];
  }
}

export function stripStoredMediaLinks(content: string, media: StoredMediaReference[]): string {
  if (media.length === 0) return content;
  const urls = new Set(media.map((item) => item.url));
  let sanitized = String(content || "");
  for (const item of media) {
    if (!item.markdown) continue;
    sanitized = sanitized.split(item.markdown).join("");
  }
  sanitized = sanitized.replace(MARKDOWN_IMAGE_PATTERN, (markdown, url: string) => (
    urls.has(String(url || "").trim()) ? "" : markdown
  ));
  const normalized = sanitized
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized) return normalized;
  return media.length === 1
    ? "[Generated image shown to the user.]"
    : `[${media.length} generated images shown to the user.]`;
}

export function buildReasoningAwareTimeline<T extends TimelineMessage>(
  timeline: T[],
  includeReasoning: boolean
): Array<ReasoningAwareMessage<T>> {
  const reasoningByParent = new Map<string, string[]>();
  const mediaByParent = new Map<string, StoredMediaReference[]>();
  for (const message of timeline) {
    if (message.role !== "tool" || !message.parentId) continue;
    if (includeReasoning) {
      const reasoning = extractStoredReasoning(message.content);
      if (reasoning) {
        const values = reasoningByParent.get(message.parentId) ?? [];
        values.push(reasoning);
        reasoningByParent.set(message.parentId, values);
      }
    }
    const media = extractStoredMediaReferences(message.content);
    if (media.length > 0) {
      const values = mediaByParent.get(message.parentId) ?? [];
      values.push(...media);
      mediaByParent.set(message.parentId, values);
    }
  }

  return timeline
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const content = message.role === "assistant"
        ? stripStoredMediaLinks(message.content, mediaByParent.get(message.id) ?? [])
        : message.content;
      const reasoningContent = message.role === "assistant"
        ? reasoningByParent.get(message.id)?.join("\n\n").trim()
        : "";
      if (!reasoningContent && content === message.content) return { ...message };
      return {
        ...message,
        content,
        reasoningContent,
        tokenCount: roughTokenCount([content, reasoningContent].filter(Boolean).join("\n"))
      };
    });
}
