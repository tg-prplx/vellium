import { Router } from "express";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { db, newId, now, AVATARS_DIR } from "../db.js";
import { parseCharacterLoreBook } from "../domain/lorebooks.js";

const router = Router();

interface CharacterRow {
  id: string;
  name: string;
  card_json: string;
  lorebook_id: string | null;
  avatar_path: string | null;
  tags: string | null;
  greeting: string | null;
  system_prompt: string | null;
  description: string | null;
  personality: string | null;
  scenario: string | null;
  mes_example: string | null;
  creator_notes: string | null;
  created_at: string;
}

function characterToJson(row: CharacterRow) {
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_path ? (row.avatar_path.startsWith("http") ? row.avatar_path : `/api/avatars/${row.avatar_path}`) : null,
    lorebookId: row.lorebook_id || null,
    tags: JSON.parse(row.tags || "[]") as string[],
    greeting: row.greeting || "",
    systemPrompt: row.system_prompt || "",
    description: row.description || "",
    personality: row.personality || "",
    scenario: row.scenario || "",
    mesExample: row.mes_example || "",
    creatorNotes: row.creator_notes || "",
    cardJson: row.card_json,
    createdAt: row.created_at
  };
}

// List all characters
router.get("/", (_req, res) => {
  const rows = db.prepare(
    "SELECT * FROM characters ORDER BY created_at DESC"
  ).all() as CharacterRow[];
  res.json(rows.map(characterToJson));
});

// Validate chara_card_v2 JSON
router.post("/validate", (req, res) => {
  const { rawJson } = req.body;
  try {
    const parsed = JSON.parse(rawJson) as { spec?: string; data?: Record<string, unknown> };
    const errors: string[] = [];
    if (parsed.spec !== "chara_card_v2") errors.push("spec must be chara_card_v2");
    if (!parsed.data) errors.push("missing data object");
    if (parsed.data && !parsed.data.name) errors.push("missing data.name");
    res.json({ valid: errors.length === 0, errors });
  } catch (e) {
    res.json({ valid: false, errors: [String(e)] });
  }
});

// Import character from chara_card_v2 JSON
router.post("/import", (req, res) => {
  const { rawJson } = req.body;
  try {
    const parsed = JSON.parse(rawJson) as { spec?: string; spec_version?: string; data?: Record<string, unknown> };
    if (parsed.spec !== "chara_card_v2") {
      res.status(400).json({ error: "Invalid spec — expected chara_card_v2" });
      return;
    }

    const data = (parsed.data || {}) as Record<string, unknown>;
    const id = newId();
    const name = String(data.name || "Unnamed").trim() || "Unnamed";
    const tags = JSON.stringify(Array.isArray(data.tags) ? data.tags : []);
    const greeting = String(data.first_mes || "");
    const systemPrompt = String(data.system_prompt || "");
    const description = String(data.description || "");
    const personality = String(data.personality || "");
    const scenario = String(data.scenario || "");
    const mesExample = String(data.mes_example || "");
    const creatorNotes = String(data.creator_notes || "");
    const avatarPath = data.avatar ? String(data.avatar) : null;
    const ts = now();

    const parsedLorebook = parseCharacterLoreBook(data);
    let lorebookId: string | null = null;

    const importTx = db.transaction(() => {
      if (parsedLorebook) {
        lorebookId = newId();
        db.prepare(
          "INSERT INTO lorebooks (id, name, description, entries_json, source_character_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(
          lorebookId,
          parsedLorebook.name,
          parsedLorebook.description,
          JSON.stringify(parsedLorebook.entries),
          id,
          ts,
          ts
        );
      }

      db.prepare(
        `INSERT INTO characters (id, name, card_json, lorebook_id, avatar_path, tags, greeting, system_prompt, description, personality, scenario, mes_example, creator_notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        name,
        rawJson,
        lorebookId,
        avatarPath,
        tags,
        greeting,
        systemPrompt,
        description,
        personality,
        scenario,
        mesExample,
        creatorNotes,
        ts
      );
    });

    importTx();

    const row = db.prepare("SELECT * FROM characters WHERE id = ?").get(id) as CharacterRow;
    res.json(characterToJson(row));
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Get character by ID
router.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM characters WHERE id = ?").get(req.params.id) as CharacterRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Character not found" });
    return;
  }
  res.json(characterToJson(row));
});

// Update character
router.put("/:id", (req, res) => {
  const id = req.params.id;
  const { name, description, personality, scenario, greeting, systemPrompt, tags, mesExample, creatorNotes } = req.body;

  const existing = db.prepare("SELECT * FROM characters WHERE id = ?").get(id) as CharacterRow | undefined;
  if (!existing) {
    res.status(404).json({ error: "Character not found" });
    return;
  }

  // Rebuild card_json from form fields
  let cardData: Record<string, unknown>;
  try {
    const parsed = JSON.parse(existing.card_json);
    cardData = parsed.data || {};
  } catch {
    cardData = {};
  }

  cardData.name = name ?? existing.name;
  cardData.description = description ?? existing.description;
  cardData.personality = personality ?? existing.personality;
  cardData.scenario = scenario ?? existing.scenario;
  cardData.first_mes = greeting ?? existing.greeting;
  cardData.system_prompt = systemPrompt ?? existing.system_prompt;
  cardData.tags = tags ?? JSON.parse(existing.tags || "[]");
  cardData.mes_example = mesExample ?? existing.mes_example;
  cardData.creator_notes = creatorNotes ?? existing.creator_notes;

  const cardJson = JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: cardData }, null, 2);

  db.prepare(
    `UPDATE characters SET name = ?, description = ?, personality = ?, scenario = ?, greeting = ?,
     system_prompt = ?, tags = ?, mes_example = ?, creator_notes = ?, card_json = ? WHERE id = ?`
  ).run(
    cardData.name, description ?? "", personality ?? "", scenario ?? "",
    greeting ?? "", systemPrompt ?? "", JSON.stringify(tags || []),
    mesExample ?? "", creatorNotes ?? "", cardJson, id
  );

  const row = db.prepare("SELECT * FROM characters WHERE id = ?").get(id) as CharacterRow;
  res.json(characterToJson(row));
});

// Upload avatar
router.post("/:id/avatar", (req, res) => {
  const { base64Data, filename } = req.body;
  const existing = db.prepare("SELECT avatar_path FROM characters WHERE id = ?").get(req.params.id) as { avatar_path: string | null } | undefined;
  if (!existing) {
    res.status(404).json({ error: "Character not found" });
    return;
  }

  const rawExt = String((filename || "avatar.png").split(".").pop() || "png").toLowerCase();
  const safeExt = rawExt.replace(/[^a-z0-9]/g, "") || "png";
  const avatarFilename = `${req.params.id}-${Date.now()}.${safeExt}`;
  const filePath = join(AVATARS_DIR, avatarFilename);

  const buffer = Buffer.from(base64Data, "base64");
  writeFileSync(filePath, buffer);

  const previousAvatar = String(existing.avatar_path || "");
  if (previousAvatar && !previousAvatar.startsWith("http")) {
    const previousPath = join(AVATARS_DIR, previousAvatar);
    try {
      if (existsSync(previousPath) && previousPath !== filePath) {
        unlinkSync(previousPath);
      }
    } catch {
      // Ignore old avatar cleanup errors.
    }
  }

  db.prepare("UPDATE characters SET avatar_path = ? WHERE id = ?").run(avatarFilename, req.params.id);
  res.json({ avatarUrl: `/api/avatars/${avatarFilename}` });
});

// Delete character
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM characters WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
