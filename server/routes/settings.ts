import { Router } from "express";
import { db, DEFAULT_SETTINGS } from "../db.js";

const router = Router();

function getSettings() {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string };
  const stored = JSON.parse(row.payload);
  // Merge with defaults for backward compat (new fields get default values)
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    samplerConfig: { ...DEFAULT_SETTINGS.samplerConfig, ...(stored.samplerConfig ?? {}) },
    promptTemplates: { ...DEFAULT_SETTINGS.promptTemplates, ...(stored.promptTemplates ?? {}) }
  };
}

router.get("/", (_req, res) => {
  res.json(getSettings());
});

router.patch("/", (req, res) => {
  const patch = req.body;
  const current = getSettings();
  const updated = { ...current, ...patch };
  db.prepare("UPDATE settings SET payload = ? WHERE id = 1").run(JSON.stringify(updated));
  res.json(updated);
});

router.post("/reset", (_req, res) => {
  db.prepare("UPDATE settings SET payload = ? WHERE id = 1").run(JSON.stringify(DEFAULT_SETTINGS));
  res.json({ ...DEFAULT_SETTINGS });
});

export default router;
