import { Router } from "express";
import { db, newId, now } from "../db.js";
import { DEFAULT_PROMPT_BLOCKS } from "../domain/rpEngine.js";

const router = Router();

// Built-in RP preset definitions
const BUILTIN_PRESETS: Record<string, {
  mood: string;
  pacing: string;
  intensity: number;
  jailbreakOverride?: string;
}> = {
  slowburn: {
    mood: "tension, longing, anticipation",
    pacing: "slow",
    intensity: 0.5,
    jailbreakOverride: "Focus on emotional buildup, tension, and slow-developing relationships. Let feelings simmer. Avoid rushing to conclusions. Write with restraint and emotional subtlety."
  },
  dominant: {
    mood: "assertive, commanding, intense",
    pacing: "balanced",
    intensity: 0.8,
    jailbreakOverride: "Write assertive, confident characters. Emphasize power dynamics, control, and dominance in interactions. Characters should be bold and unapologetic."
  },
  romantic: {
    mood: "tender, warm, affectionate",
    pacing: "slow",
    intensity: 0.6,
    jailbreakOverride: "Focus on emotional intimacy, tenderness, and romantic connection. Write with warmth and vulnerability. Emphasize sweet moments and emotional openness."
  },
  action: {
    mood: "tense, adrenaline, danger",
    pacing: "fast",
    intensity: 0.9,
    jailbreakOverride: "Focus on action sequences, combat, and dynamic movement. Write with urgency and momentum. Keep scenes fast-paced with visceral detail."
  },
  mystery: {
    mood: "suspicious, intriguing, atmospheric",
    pacing: "balanced",
    intensity: 0.6,
    jailbreakOverride: "Create an atmosphere of suspense and intrigue. Drop subtle clues and red herrings. Write with tension and uncertainty. Keep the reader guessing."
  },
  submissive: {
    mood: "shy, obedient, eager to please",
    pacing: "slow",
    intensity: 0.7,
    jailbreakOverride: "Write characters that are submissive, yielding, and eager to serve. Emphasize vulnerability, shyness, and devotion. Characters blush, stammer, and seek approval. They find pleasure in pleasing others and being directed. Write body language that shows deference and nervous excitement."
  },
  seductive: {
    mood: "flirty, teasing, sensual, alluring",
    pacing: "slow",
    intensity: 0.8,
    jailbreakOverride: "Write with heavy sensual undertones. Characters are flirtatious, playful, and provocative. Emphasize body language, lingering touches, suggestive dialogue, and building sexual tension. Describe physical reactions, heated glances, and teasing exchanges. Let desire simmer beneath every interaction."
  },
  gentle_fem: {
    mood: "soft, nurturing, emotionally warm, caring",
    pacing: "slow",
    intensity: 0.6,
    jailbreakOverride: "Write feminine characters that are gentle, nurturing, and emotionally available. Emphasize soft touches, caring gestures, whispered words of comfort. Characters are maternal yet intimate, providing emotional safety while being physically affectionate. Focus on tenderness, soft skin, gentle caresses, and emotional vulnerability."
  },
  rough: {
    mood: "aggressive, primal, raw, intense",
    pacing: "fast",
    intensity: 0.95,
    jailbreakOverride: "Write with raw physicality and primal energy. Characters are rough, aggressive, and unapologetic in their desires. Emphasize physical dominance, grabbing, pinning, and forceful movement. Dialogue is direct, commanding, sometimes crude. Describe heavy breathing, sweat, and raw physical sensations. No restraint, no holding back."
  },
  passionate: {
    mood: "deep desire, fire, emotional intensity, burning",
    pacing: "balanced",
    intensity: 0.85,
    jailbreakOverride: "Write with burning passion and deep emotional connection. Characters are consumed by desire and love simultaneously. Emphasize desperate kisses, whispered confessions, bodies pressed together, emotional overwhelm. The intensity comes from both physical desire and deep emotional bond. Write as if each moment could be their last."
  }
};

router.post("/scene-state", (req, res) => {
  const state = req.body;
  if (!state?.chatId) {
    res.status(400).json({ error: "chatId is required" });
    return;
  }
  const payload = JSON.stringify(state);
  const ts = now();

  db.prepare(`
    INSERT INTO rp_scene_state (chat_id, payload, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).run(state.chatId, payload, ts);

  res.json({ ok: true });
});

router.get("/scene-state/:chatId", (req, res) => {
  const row = db.prepare("SELECT payload FROM rp_scene_state WHERE chat_id = ?")
    .get(req.params.chatId) as { payload: string } | undefined;
  if (!row) {
    res.json(null);
    return;
  }
  try {
    res.json(JSON.parse(row.payload));
  } catch {
    res.json(null);
  }
});

router.post("/author-note", (req, res) => {
  const { chatId, authorNote } = req.body;
  if (!chatId) {
    res.status(400).json({ error: "chatId is required" });
    return;
  }

  db.prepare("UPDATE chats SET author_note = ? WHERE id = ?")
    .run(String(authorNote || ""), chatId);

  res.json({ ok: true });
});

router.get("/author-note/:chatId", (req, res) => {
  const chatId = req.params.chatId;

  const chat = db.prepare("SELECT author_note FROM chats WHERE id = ?")
    .get(chatId) as { author_note: string | null } | undefined;
  if (chat?.author_note) {
    res.json({ authorNote: chat.author_note });
    return;
  }

  const legacy = db.prepare(
    "SELECT content FROM rp_memory_entries WHERE chat_id = ? AND role = 'author_note' ORDER BY created_at DESC LIMIT 1"
  ).get(chatId) as { content: string } | undefined;

  res.json({ authorNote: legacy?.content || "" });
});

router.post("/apply-preset", (req, res) => {
  const { chatId, presetId } = req.body;
  const preset = BUILTIN_PRESETS[presetId];

  if (!preset) {
    res.status(404).json({ error: "Preset not found" });
    return;
  }

  // Update scene state with preset values
  const existingState = db.prepare("SELECT payload FROM rp_scene_state WHERE chat_id = ?").get(chatId) as { payload: string } | undefined;
  const currentState = existingState ? JSON.parse(existingState.payload) : { chatId, variables: {}, mood: "neutral", pacing: "balanced", intensity: 0.5 };

  const newState = {
    ...currentState,
    chatId,
    mood: preset.mood,
    pacing: preset.pacing,
    intensity: preset.intensity
  };

  const ts = now();
  db.prepare(`
    INSERT INTO rp_scene_state (chat_id, payload, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).run(chatId, JSON.stringify(newState), ts);
  db.prepare("UPDATE chats SET active_preset = ? WHERE id = ?").run(presetId, chatId);

  // If preset has a jailbreak override, update the jailbreak prompt block
  if (preset.jailbreakOverride) {
    const blocks = db.prepare("SELECT * FROM prompt_blocks WHERE chat_id = ? ORDER BY ordering ASC")
      .all(chatId) as { id: string; kind: string }[];

    if (blocks.length > 0) {
      // Update existing jailbreak block
      db.prepare("UPDATE prompt_blocks SET content = ? WHERE chat_id = ? AND kind = 'jailbreak'")
        .run(preset.jailbreakOverride, chatId);
    }
  }

  res.json({
    ok: true,
    sceneState: newState,
    presetId
  });
});

// --- Get available presets ---
router.get("/presets", (_req, res) => {
  const presets = Object.entries(BUILTIN_PRESETS).map(([id, config]) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    mood: config.mood,
    pacing: config.pacing,
    intensity: config.intensity
  }));
  res.json(presets);
});

// --- Prompt Blocks CRUD ---

router.get("/blocks/:chatId", (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM prompt_blocks WHERE chat_id = ? ORDER BY ordering ASC"
  ).all(req.params.chatId) as { id: string; kind: string; enabled: number; ordering: number; content: string }[];

  if (rows.length === 0) {
    res.json(DEFAULT_PROMPT_BLOCKS);
    return;
  }

  res.json(rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    enabled: r.enabled === 1,
    order: r.ordering,
    content: r.content
  })));
});

router.put("/blocks/:chatId", (req, res) => {
  const { blocks } = req.body;
  const chatId = req.params.chatId;

  const deleteAll = db.prepare("DELETE FROM prompt_blocks WHERE chat_id = ?");
  const insert = db.prepare(
    "INSERT INTO prompt_blocks (id, chat_id, kind, enabled, ordering, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  const ts = now();
  const doSave = db.transaction(() => {
    deleteAll.run(chatId);
    for (const block of blocks) {
      insert.run(
        block.id || newId(),
        chatId,
        block.kind,
        block.enabled ? 1 : 0,
        block.order,
        block.content || "",
        ts
      );
    }
  });

  doSave();
  res.json({ ok: true });
});

export default router;
