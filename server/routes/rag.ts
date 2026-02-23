import { Router } from "express";
import { db, DEFAULT_SETTINGS } from "../db.js";
import {
  createRagCollection,
  deleteRagCollection,
  deleteRagDocument,
  ingestRagDocument,
  listRagCollections,
  listRagDocuments,
  updateRagCollection
} from "../services/rag.js";

const router = Router();

function getSettings() {
  const row = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
  if (!row?.payload) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(row.payload);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      samplerConfig: { ...DEFAULT_SETTINGS.samplerConfig, ...(parsed.samplerConfig ?? {}) },
      promptTemplates: { ...DEFAULT_SETTINGS.promptTemplates, ...(parsed.promptTemplates ?? {}) }
    } as Record<string, unknown>;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

router.get("/collections", (_req, res) => {
  res.json(listRagCollections());
});

router.post("/collections", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const created = createRagCollection(name, String(req.body?.description || ""), req.body?.scope);
  res.json(created);
});

router.patch("/collections/:id", (req, res) => {
  const updated = updateRagCollection(req.params.id, {
    name: req.body?.name,
    description: req.body?.description,
    scope: req.body?.scope
  });
  if (!updated) {
    res.status(404).json({ error: "Collection not found" });
    return;
  }
  res.json(updated);
});

router.delete("/collections/:id", (req, res) => {
  deleteRagCollection(req.params.id);
  res.json({ ok: true, id: req.params.id });
});

router.get("/collections/:id/documents", (req, res) => {
  res.json(listRagDocuments(req.params.id));
});

router.post("/collections/:id/documents", async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const text = String(req.body?.text || "");
  if (!text.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  try {
    const result = await ingestRagDocument({
      collectionId: req.params.id,
      title: title || "Untitled",
      text,
      sourceType: String(req.body?.sourceType || "manual"),
      sourceId: req.body?.sourceId ? String(req.body.sourceId) : null,
      metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {},
      settings: getSettings(),
      force: req.body?.force === true
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : "ingest failed" });
  }
});

router.delete("/documents/:id", (req, res) => {
  deleteRagDocument(req.params.id);
  res.json({ ok: true, id: req.params.id });
});

export default router;
