import { getContextConfig, saveContextConfig } from "./contextConfig.js";
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

export function renameBranch(chatId: string, branchId: string, name: string): BranchSummary | null {
  const result = db.prepare(
    "UPDATE branches SET name = ? WHERE id = ? AND chat_id = ?"
  ).run(name, branchId, chatId);
  if (result.changes === 0) return null;

  const row = db.prepare(
    "SELECT id, chat_id, name, parent_message_id, created_at FROM branches WHERE id = ? AND chat_id = ?"
  ).get(branchId, chatId) as {
    id: string;
    chat_id: string;
    name: string;
    parent_message_id: string | null;
    created_at: string;
  };
  return mapBranchRow(row);
}

export type DeleteBranchResult =
  | { ok: true; activeBranchId: string; branches: BranchSummary[] }
  | { ok: false; reason: "not_found" | "last_branch" };

export function deleteBranch(chatId: string, branchId: string): DeleteBranchResult {
  const branch = db.prepare("SELECT id FROM branches WHERE id = ? AND chat_id = ?")
    .get(branchId, chatId) as { id: string } | undefined;
  if (!branch) return { ok: false, reason: "not_found" };

  const count = db.prepare("SELECT COUNT(*) AS count FROM branches WHERE chat_id = ?")
    .get(chatId) as { count: number };
  if (count.count <= 1) return { ok: false, reason: "last_branch" };

  db.transaction(() => {
    db.prepare("DELETE FROM messages WHERE chat_id = ? AND branch_id = ?").run(chatId, branchId);
    db.prepare("DELETE FROM branches WHERE id = ? AND chat_id = ?").run(branchId, chatId);
  })();

  const branches = listBranches(chatId);
  return { ok: true, activeBranchId: branches[0].id, branches };
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
    "INSERT INTO messages (id, chat_id, branch_id, role, content, attachments, token_count, parent_id, deleted, created_at, character_name, sort_order, token_count_source, generation_stats, generation_started_at, generation_completed_at, generation_duration_ms, rag_sources) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
        index + 1, row.token_count_source || null, row.generation_stats || null,
        row.generation_started_at || null, row.generation_completed_at || null, row.generation_duration_ms ?? null, row.rag_sources || "[]"
      );
    });
    const config = getContextConfig(chatId, parent.branch_id);
    const later = db.prepare("SELECT id FROM messages WHERE chat_id = ? AND branch_id = ? AND deleted = 0 AND role IN ('user', 'assistant') AND sort_order > ? LIMIT 1").get(chatId, parent.branch_id, parent.sort_order);
    saveContextConfig(chatId, branchId, { ...config,
      // A fork into earlier history must not inherit facts learned after that point.
      ...(later ? { summary: "" } : {}),
      excludedMessageIds: (config.excludedMessageIds || []).flatMap(id => idMap.has(id) ? [idMap.get(id)!] : [])
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
