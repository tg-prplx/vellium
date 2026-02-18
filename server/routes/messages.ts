import { Router } from "express";
import { db, roughTokenCount } from "../db.js";

const router = Router();

router.patch("/:id", (req, res) => {
  const { content } = req.body;
  db.prepare("UPDATE messages SET content = ?, token_count = ? WHERE id = ?")
    .run(content, roughTokenCount(content), req.params.id);
  res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
  db.prepare("UPDATE messages SET deleted = 1 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
