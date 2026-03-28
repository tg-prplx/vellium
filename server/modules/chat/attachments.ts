import { roughTokenCount } from "../../db.js";
import type { ChatAttachment } from "../../domain/rpEngine.js";
import { getChatRagBinding, ingestRagDocument } from "../../services/rag.js";
import type { MessageAttachmentPayload } from "./routeHelpers.js";

interface PromptTimelineItem {
  content: string;
  tokenCount?: number;
}

export function sanitizeAttachments(input: unknown): MessageAttachmentPayload[] {
  if (!Array.isArray(input)) return [];
  const out: MessageAttachmentPayload[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const raw = item as MessageAttachmentPayload;
    const type = raw.type === "image" ? "image" : (raw.type === "text" ? "text" : null);
    if (!type) continue;

    const base: MessageAttachmentPayload = {
      id: String(raw.id || ""),
      filename: String(raw.filename || ""),
      type,
      url: String(raw.url || ""),
      mimeType: String(raw.mimeType || "")
    };

    if (type === "image") {
      const dataUrl = String(raw.dataUrl || "");
      // Keep only data:image/* URLs to avoid arbitrary payload injection.
      if (dataUrl.startsWith("data:image/")) {
        // Rough cap at ~15MB per attachment payload.
        base.dataUrl = dataUrl.slice(0, 15 * 1024 * 1024);
      }
      out.push(base);
      continue;
    }

    if (type === "text") {
      const content = String(raw.content || "");
      if (content) base.content = content.slice(0, 20000);
      out.push(base);
    }
  }
  return out.slice(0, 12);
}

export function toChatAttachments(input: MessageAttachmentPayload[] | null | undefined): ChatAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: ChatAttachment[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "image") {
      out.push({
        type: "image",
        dataUrl: String(item.dataUrl || ""),
        filename: String(item.filename || "")
      });
      continue;
    }
    if (item.type === "text") {
      out.push({
        type: "text",
        filename: String(item.filename || "")
      });
    }
  }
  return out;
}

export async function autoIngestTextAttachmentsForChat(params: {
  chatId: string;
  messageId: string;
  attachments: MessageAttachmentPayload[];
  settings: Record<string, unknown>;
}) {
  const textAttachments = params.attachments
    .filter((item) => item.type === "text" && typeof item.content === "string" && item.content.trim().length > 0);
  if (textAttachments.length === 0) return;

  const ragBinding = getChatRagBinding(params.chatId, params.settings);
  if (!ragBinding.enabled || ragBinding.collectionIds.length === 0) return;

  const ingestTasks: Promise<unknown>[] = [];
  for (const collectionId of ragBinding.collectionIds) {
    for (let index = 0; index < textAttachments.length; index += 1) {
      const attachment = textAttachments[index];
      const title = String(attachment.filename || "").trim().slice(0, 180) || `Attachment ${index + 1}`;
      const sourceToken = String(attachment.id || attachment.filename || index);
      const sourceId = `${params.chatId}:${params.messageId}:${sourceToken}`.slice(0, 200);
      ingestTasks.push(
        ingestRagDocument({
          collectionId,
          title,
          text: String(attachment.content || ""),
          sourceType: "chat_attachment",
          sourceId,
          metadata: {
            origin: "chat_attachment",
            chatId: params.chatId,
            messageId: params.messageId,
            filename: String(attachment.filename || ""),
            mimeType: String(attachment.mimeType || "")
          },
          settings: params.settings,
          force: false
        })
      );
    }
  }

  if (ingestTasks.length === 0) return;
  const results = await Promise.allSettled(ingestTasks);
  const failed = results.filter((row) => row.status === "rejected").length;
  if (failed > 0) {
    console.warn(`[RAG] Failed to auto-ingest ${failed}/${results.length} attachment jobs for chat ${params.chatId}`);
  }
}

export function normalizeCharacterIdList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const id = String(item || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function normalizeLorebookIdList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const id = String(item || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function buildAttachmentPromptAppendix(attachments: MessageAttachmentPayload[]): string {
  const textAttachments = attachments
    .filter((item) => item.type === "text" && typeof item.content === "string" && item.content.trim().length > 0);
  if (textAttachments.length === 0) return "";
  return "\n\n---\n[Attached files]\n" + textAttachments
    .map((item) => `[${item.filename}]:\n${String(item.content || "").slice(0, 4000)}`)
    .join("\n\n");
}

export function buildPromptContentWithAttachments(content: string, attachments: MessageAttachmentPayload[]): string {
  return `${String(content || "")}${buildAttachmentPromptAppendix(attachments)}`;
}

export function resolveLorebookIds(row: { lorebook_id: string | null; lorebook_ids?: string | null } | undefined): string[] {
  if (!row) return [];
  const ids = normalizeLorebookIdList((() => {
    try {
      return JSON.parse(row.lorebook_ids || "[]");
    } catch {
      return [];
    }
  })());
  if (ids.length > 0) return ids;
  return row.lorebook_id ? [row.lorebook_id] : [];
}

function tokenizeWords(input: string): string[] {
  return String(input || "")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function selectFirstResponderByMention(content: string, orderedCharacterNames: string[]): string | undefined {
  if (!orderedCharacterNames.length) return undefined;
  const messageWords = tokenizeWords(content);
  if (!messageWords.length) return undefined;

  const firstWordPos = new Map<string, number>();
  messageWords.forEach((word, idx) => {
    if (!firstWordPos.has(word)) firstWordPos.set(word, idx);
  });

  let best: { name: string; score: number; order: number } | null = null;

  orderedCharacterNames.forEach((name, order) => {
    const rawWords = tokenizeWords(name);
    if (!rawWords.length) return;
    const filtered = rawWords.filter((word) => word.length > 1);
    const nameWords = [...new Set((filtered.length > 0 ? filtered : rawWords))];
    let score = Number.POSITIVE_INFINITY;

    for (const word of nameWords) {
      const pos = firstWordPos.get(word);
      if (pos !== undefined && pos < score) score = pos;
    }

    if (!Number.isFinite(score)) return;
    if (!best || score < best.score || (score === best.score && order < best.order)) {
      best = { name, score, order };
    }
  });

  return best?.name;
}

export function getContextWindowBudget(settings: Record<string, unknown>): number {
  const raw = Number(settings.contextWindowSize);
  if (!Number.isFinite(raw) || raw <= 0) return 8192;
  return Math.max(512, Math.min(32768, Math.floor(raw)));
}

export function getTailBudgetPercent(
  settings: Record<string, unknown>,
  key: "contextTailBudgetWithSummaryPercent" | "contextTailBudgetWithoutSummaryPercent",
  fallback: number
): number {
  const raw = Number(settings[key]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(5, Math.min(95, raw));
}

export function selectTimelineForPrompt(
  timeline: PromptTimelineItem[],
  contextSummary: string,
  contextWindowBudget: number,
  withSummaryPercent: number,
  withoutSummaryPercent: number
) {
  const hasSummary = Boolean(contextSummary.trim());
  // Leave headroom for system prompt, summary block, and model overhead.
  const historyTokenBudget = hasSummary
    ? Math.max(256, Math.floor(contextWindowBudget * (withSummaryPercent / 100)))
    : Math.max(512, Math.floor(contextWindowBudget * (withoutSummaryPercent / 100)));

  const selected: PromptTimelineItem[] = [];
  let used = 0;
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const msg = timeline[i];
    const msgTokens = Math.max(1, Number(msg.tokenCount) || roughTokenCount(msg.content));
    if (selected.length > 0 && used + msgTokens > historyTokenBudget) break;
    selected.unshift(msg);
    used += msgTokens;
  }
  return selected;
}
