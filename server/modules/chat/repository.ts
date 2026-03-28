import { db, newId, now } from "../../db.js";
import { resolveBranch, type MessageRow } from "./routeHelpers.js";

export interface BranchSummary {
  id: string;
  chatId: string;
  name: string;
  parentMessageId: string | null;
  createdAt: string;
}

function mapBranchRow(row: {
  id: string;
  chat_id: string;
  name: string;
  parent_message_id: string | null;
  created_at: string;
}): BranchSummary {
  return {
    id: row.id,
    chatId: row.chat_id,
    name: row.name,
    parentMessageId: row.parent_message_id,
    createdAt: row.created_at
  };
}

export function deleteMessageTree(chatId: string, branchId: string, messageId: string) {
  db.prepare(`
    WITH RECURSIVE descendants(id, created_at, sort_order) AS (
      SELECT id, created_at, sort_order
      FROM messages
      WHERE id = ? AND chat_id = ? AND branch_id = ? AND deleted = 0
      UNION ALL
      SELECT m.id, m.created_at, m.sort_order
      FROM messages m
      JOIN descendants d ON m.parent_id = d.id
      WHERE m.chat_id = ? AND m.branch_id = ? AND m.deleted = 0
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
    SET deleted = 1
    WHERE id IN (SELECT id FROM descendants)
  `).run(messageId, chatId, branchId, chatId, branchId);
}

export function deleteChatCascade(chatId: string) {
  db.prepare("DELETE FROM messages WHERE chat_id = ?").run(chatId);
  db.prepare("DELETE FROM branches WHERE chat_id = ?").run(chatId);
  db.prepare("DELETE FROM prompt_blocks WHERE chat_id = ?").run(chatId);
  try {
    db.prepare("DELETE FROM rp_scene_state WHERE chat_id = ?").run(chatId);
  } catch {
    // Table might not exist in older databases.
  }
  try {
    db.prepare("DELETE FROM rp_memory_entries WHERE chat_id = ?").run(chatId);
  } catch {
    // Table might not exist in older databases.
  }
  db.prepare("DELETE FROM chats WHERE id = ?").run(chatId);
}

export function listBranches(chatId: string): BranchSummary[] {
  const rows = db.prepare(
    "SELECT id, chat_id, name, parent_message_id, created_at FROM branches WHERE chat_id = ? ORDER BY created_at ASC"
  ).all(chatId) as Array<{
    id: string;
    chat_id: string;
    name: string;
    parent_message_id: string | null;
    created_at: string;
  }>;

  if (rows.length > 0) {
    return rows.map(mapBranchRow);
  }

  const branchId = resolveBranch(chatId);
  const fallback = db.prepare(
    "SELECT id, chat_id, name, parent_message_id, created_at FROM branches WHERE id = ?"
  ).get(branchId) as {
    id: string;
    chat_id: string;
    name: string;
    parent_message_id: string | null;
    created_at: string;
  } | undefined;

  return fallback ? [mapBranchRow(fallback)] : [];
}

export function forkBranch(chatId: string, parentMessageId: string, name?: string): BranchSummary | null {
  const parent = db.prepare(
    "SELECT * FROM messages WHERE id = ? AND chat_id = ? AND deleted = 0"
  ).get(parentMessageId, chatId) as MessageRow | undefined;
  if (!parent) return null;

  const branchId = newId();
  const createdAt = now();
  const branchName = String(name || "").trim() || `Branch ${parentMessageId.slice(0, 6)}`;
  const sourceRows = db.prepare(
    "SELECT * FROM messages WHERE chat_id = ? AND branch_id = ? AND deleted = 0 AND sort_order <= ? ORDER BY sort_order ASC, created_at ASC, id ASC"
  ).all(chatId, parent.branch_id, parent.sort_order) as MessageRow[];

  const insertBranch = db.prepare(
    "INSERT INTO branches (id, chat_id, name, parent_message_id, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const insertMessage = db.prepare(
    "INSERT INTO messages (id, chat_id, branch_id, role, content, attachments, token_count, parent_id, deleted, created_at, character_name, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)"
  );

  const forkTx = db.transaction(() => {
    insertBranch.run(branchId, chatId, branchName, parentMessageId, createdAt);
    const idMap = new Map<string, string>();
    sourceRows.forEach((row, index) => {
      const copiedId = newId();
      idMap.set(row.id, copiedId);
      const mappedParentId = row.parent_id ? (idMap.get(row.parent_id) ?? null) : null;
      insertMessage.run(
        copiedId,
        chatId,
        branchId,
        row.role,
        row.content,
        row.attachments || "[]",
        row.token_count,
        mappedParentId,
        row.created_at,
        row.character_name || null,
        index + 1
      );
    });
  });

  forkTx();
  return {
    id: branchId,
    chatId,
    name: branchName,
    parentMessageId,
    createdAt
  };
}
