import { Router } from "express";
import { db, roughTokenCount } from "../db.js";
import { getTimeline, type MessageRow } from "../modules/chat/routeHelpers.js";

const router = Router();

const normalizeSortOrder = db.transaction((chatId: string, branchId: string) => {
  const rows = db.prepare(
    "SELECT id FROM messages WHERE chat_id = ? AND branch_id = ? AND deleted = 0 ORDER BY sort_order ASC, created_at ASC, id ASC"
  ).all(chatId, branchId) as { id: string }[];

  const update = db.prepare("UPDATE messages SET sort_order = ? WHERE id = ?");
  rows.forEach((row, index) => {
    update.run(index + 1, row.id);
  });
});

router.patch("/:id", (req, res) => {
  const content = String(req.body?.content ?? "");
  const row = db.prepare("SELECT * FROM messages WHERE id = ? AND deleted = 0")
    .get(req.params.id) as MessageRow | undefined;

  if (!row) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  db.prepare(
    "UPDATE messages SET content = ?, token_count = ?, token_count_source = 'estimate', generation_stats = NULL, generation_started_at = NULL, generation_completed_at = NULL, generation_duration_ms = NULL WHERE id = ? AND chat_id = ? AND branch_id = ? AND deleted = 0"
  ).run(content, roughTokenCount(content), row.id, row.chat_id, row.branch_id);

  res.json({ ok: true, timeline: getTimeline(row.chat_id, row.branch_id) });
});

router.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM messages WHERE id = ? AND deleted = 0")
    .get(req.params.id) as MessageRow | undefined;

  if (!row) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const deleteMessage = db.transaction(() => {
    // UI delete should be precise: remove only the selected message.
    db.prepare(
      "UPDATE messages SET deleted = 1 WHERE id = ? AND chat_id = ? AND branch_id = ? AND deleted = 0"
    ).run(row.id, row.chat_id, row.branch_id);
    // Also remove tool/reasoning records directly attached to this message.
    db.prepare(
      "UPDATE messages SET deleted = 1 WHERE parent_id = ? AND chat_id = ? AND branch_id = ? AND role = 'tool' AND deleted = 0"
    ).run(row.id, row.chat_id, row.branch_id);
    normalizeSortOrder(row.chat_id, row.branch_id);
  });
  deleteMessage();

  res.json({ ok: true, timeline: getTimeline(row.chat_id, row.branch_id) });
});

export default router;
