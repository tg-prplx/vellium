import { db } from "../../db.js";

/*
 * Regenerating the tail reply keeps the previous one as a stashed variant
 * (deleted = 2) instead of removing it. Every prompt, export and fork query
 * reads only deleted = 0, so stashed rows stay invisible until selected.
 */

interface VariantRow {
  id: string;
  role: string;
  parent_id: string | null;
  sort_order: number;
}

/** A regenerated reply kept as an alternative the user can switch back to. */
const DELETED_STASHED_VARIANT = 2;

function markMessageTree(chatId: string, branchId: string, messageId: string, from: number, to: number) {
  db.prepare(`
    WITH RECURSIVE descendants(id, created_at, sort_order) AS (
      SELECT id, created_at, sort_order
      FROM messages
      WHERE id = ? AND chat_id = ? AND branch_id = ? AND deleted = ?
      UNION ALL
      SELECT m.id, m.created_at, m.sort_order
      FROM messages m
      JOIN descendants d ON m.parent_id = d.id
      WHERE m.chat_id = ? AND m.branch_id = ? AND m.deleted = ?
        AND (
          m.created_at > d.created_at
          OR (
            m.created_at = d.created_at
            AND (
              m.sort_order > d.sort_order
              OR (m.sort_order = d.sort_order AND m.id > d.id)
            )
          )
        )
    )
    UPDATE messages
    SET deleted = ?
    WHERE id IN (SELECT id FROM descendants)
  `).run(messageId, chatId, branchId, from, chatId, branchId, from, to);
}

/** Hide a tail reply (with its reasoning/tool rows) so a regenerated reply can replace it. */
export function stashReplyVariant(chatId: string, branchId: string, messageId: string, parentId: string | null) {
  db.transaction(() => {
    // Old multi-character turns may lack a parent; the new reply will use the resolved one.
    if (parentId) {
      db.prepare("UPDATE messages SET parent_id = ? WHERE id = ? AND chat_id = ? AND branch_id = ? AND parent_id IS NULL")
        .run(parentId, messageId, chatId, branchId);
    }
    markMessageTree(chatId, branchId, messageId, 0, DELETED_STASHED_VARIANT);
  })();
}

function visibleTail(chatId: string, branchId: string) {
  return db.prepare(
    "SELECT * FROM messages WHERE chat_id = ? AND branch_id = ? AND role IN ('user', 'assistant') AND deleted = 0 ORDER BY sort_order DESC, created_at DESC, id DESC LIMIT 1"
  ).get(chatId, branchId) as VariantRow | undefined;
}

/**
 * Replies to the same parent that were generated after the previous visible turn.
 * The sort-order floor keeps stale stashes from an edited or deleted history out.
 */
function listVariantRows(chatId: string, branchId: string, tail: VariantRow): VariantRow[] {
  const previous = db.prepare(
    "SELECT MAX(sort_order) AS floor FROM messages WHERE chat_id = ? AND branch_id = ? AND deleted = 0 AND role IN ('user', 'assistant') AND sort_order < ?"
  ).get(chatId, branchId, tail.sort_order) as { floor: number | null };
  return db.prepare(`
    SELECT * FROM messages
    WHERE chat_id = ? AND branch_id = ? AND role = 'assistant' AND deleted IN (0, ?)
      AND parent_id IS ? AND sort_order > ?
    ORDER BY created_at ASC, sort_order ASC, id ASC
  `).all(chatId, branchId, DELETED_STASHED_VARIANT, tail.parent_id, previous.floor ?? -1) as VariantRow[];
}

export interface ReplyVariantInfo {
  messageId: string;
  index: number;
  count: number;
}

export function getReplyVariantInfo(chatId: string, branchId: string): ReplyVariantInfo | null {
  const tail = visibleTail(chatId, branchId);
  if (!tail || tail.role !== "assistant") return null;
  const variants = listVariantRows(chatId, branchId, tail);
  const index = variants.findIndex((row) => row.id === tail.id);
  if (variants.length < 2 || index < 0) return null;
  return { messageId: tail.id, index, count: variants.length };
}

export type SelectReplyVariantResult = "ok" | "not_tail" | "out_of_range";

/** Swap the visible tail reply with a neighbouring stashed variant. */
export function selectReplyVariant(chatId: string, branchId: string, messageId: string, direction: -1 | 1): SelectReplyVariantResult {
  return db.transaction((): SelectReplyVariantResult => {
    const tail = visibleTail(chatId, branchId);
    if (!tail || tail.role !== "assistant" || tail.id !== messageId) return "not_tail";
    const variants = listVariantRows(chatId, branchId, tail);
    const target = variants[variants.findIndex((row) => row.id === tail.id) + direction];
    if (!target) return "out_of_range";
    markMessageTree(chatId, branchId, tail.id, 0, DELETED_STASHED_VARIANT);
    markMessageTree(chatId, branchId, target.id, DELETED_STASHED_VARIANT, 0);
    return "ok";
  })();
}

/** Add the tail reply's variant position so the client can offer ‹ n/m ›. */
export function withReplyVariants<T extends { id: string }>(chatId: string, branchId: string, timeline: T[]): Array<T & { variants?: { index: number; count: number } }> {
  const info = getReplyVariantInfo(chatId, branchId);
  if (!info) return timeline;
  return timeline.map((message) => message.id === info.messageId ? { ...message, variants: { index: info.index, count: info.count } } : message);
}
