import { Router } from "express";
import { db, newId, now } from "../db.js";

const router = Router();

interface PersonaRow {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  is_default: number;
  created_at: string;
}

// List all personas
router.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM user_personas ORDER BY is_default DESC, created_at ASC").all() as PersonaRow[];
  res.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    personality: r.personality,
    scenario: r.scenario,
    isDefault: r.is_default === 1,
    createdAt: r.created_at
  })));
});

// Create persona
router.post("/", (req, res) => {
  const { name, description, personality, scenario, isDefault } = req.body;
  const id = newId();
  const ts = now();

  // If setting as default, clear other defaults
  if (isDefault) {
    db.prepare("UPDATE user_personas SET is_default = 0").run();
  }

  db.prepare(
    "INSERT INTO user_personas (id, name, description, personality, scenario, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, name || "User", description || "", personality || "", scenario || "", isDefault ? 1 : 0, ts);

  res.json({ id, name: name || "User", description: description || "", personality: personality || "", scenario: scenario || "", isDefault: !!isDefault, createdAt: ts });
});

// Update persona
router.put("/:id", (req, res) => {
  const personaId = req.params.id;
  const { name, description, personality, scenario, isDefault } = req.body;

  // If setting as default, clear other defaults
  if (isDefault) {
    db.prepare("UPDATE user_personas SET is_default = 0").run();
  }

  db.prepare(
    "UPDATE user_personas SET name = ?, description = ?, personality = ?, scenario = ?, is_default = ? WHERE id = ?"
  ).run(name || "User", description || "", personality || "", scenario || "", isDefault ? 1 : 0, personaId);

  const row = db.prepare("SELECT * FROM user_personas WHERE id = ?").get(personaId) as PersonaRow | undefined;
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  res.json({
    id: row.id, name: row.name, description: row.description,
    personality: row.personality, scenario: row.scenario,
    isDefault: row.is_default === 1, createdAt: row.created_at
  });
});

// Delete persona
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM user_personas WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Set default persona
router.post("/:id/set-default", (req, res) => {
  db.prepare("UPDATE user_personas SET is_default = 0").run();
  db.prepare("UPDATE user_personas SET is_default = 1 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
