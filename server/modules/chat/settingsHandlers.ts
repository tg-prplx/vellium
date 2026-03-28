import type { Request, Response } from "express";
import { db } from "../../db.js";

export function updateChatSampler(req: Request, res: Response) {
  const chatId = req.params.id;
  const { samplerConfig } = req.body;
  db.prepare("UPDATE chats SET sampler_config = ? WHERE id = ?").run(JSON.stringify(samplerConfig), chatId);
  res.json({ ok: true });
}

export function getChatSampler(req: Request, res: Response) {
  const chatId = req.params.id;
  const row = db.prepare("SELECT sampler_config FROM chats WHERE id = ?").get(chatId) as { sampler_config: string | null } | undefined;
  if (row?.sampler_config) {
    try {
      res.json(JSON.parse(row.sampler_config));
      return;
    } catch {
      // Fall through to null response on malformed JSON.
    }
  }
  res.json(null);
}

export function updateChatPreset(req: Request, res: Response) {
  const chatId = req.params.id;
  const { presetId } = req.body;
  db.prepare("UPDATE chats SET active_preset = ? WHERE id = ?").run(presetId || null, chatId);
  res.json({ ok: true });
}

export function getChatPreset(req: Request, res: Response) {
  const chatId = req.params.id;
  const row = db.prepare("SELECT active_preset FROM chats WHERE id = ?").get(chatId) as { active_preset: string | null } | undefined;
  res.json({ presetId: row?.active_preset || null });
}
