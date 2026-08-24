import { Router, raw } from "express";
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { db, INOCHI_MODELS_DIR, newId, now } from "../db.js";
import { parseInochiModel, type ParsedInochiModel } from "../modules/inochiAvatar/model.js";

const router = Router();
const RUNTIME_VERSION = "Inochi2D SDK WebAssembly";
const RUNTIME_CACHE_VERSION = "inochi2d-sdk-f4b4917a";
const MODEL_CACHE_VERSION = "inochi2d-original-v1";

interface AvatarRow {
  character_id: string;
  asset_id: string;
  display_name: string;
  filename: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

function runtimeDirectory() {
  const packageEntrypoint = import.meta.resolve("@vellium/inochi2d-runtime");
  return dirname(fileURLToPath(packageEntrypoint));
}

function runtimeWasmAsset() {
  return path.join(runtimeDirectory(), "generated", "inochi2d.wasm");
}

function readMetadata(row: AvatarRow): ParsedInochiModel {
  try {
    return JSON.parse(row.metadata_json) as ParsedInochiModel;
  } catch {
    return {
      displayName: row.display_name,
      filename: row.filename,
      metadata: {},
      parameters: [],
      emotionParameters: []
    };
  }
}

function avatarResponse(row?: AvatarRow) {
  const parsed = row ? readMetadata(row) : null;
  return {
    runtime: {
      available: true,
      version: RUNTIME_VERSION,
      wasmUrl: `/api/inochi-avatars/runtime.wasm?v=${RUNTIME_CACHE_VERSION}`
    },
    avatar: row && parsed ? {
      characterId: row.character_id,
      assetId: row.asset_id,
      displayName: row.display_name,
      filename: row.filename,
      modelUrl: `/api/inochi-avatars/assets/${encodeURIComponent(row.asset_id)}/model.inp?v=${MODEL_CACHE_VERSION}`,
      updatedAt: row.updated_at,
      parameters: parsed.parameters,
      emotionParameters: parsed.emotionParameters
    } : null
  };
}

router.get("/character/:characterId", (req, res) => {
  const row = db.prepare("SELECT * FROM inochi2d_avatars WHERE character_id = ?")
    .get(req.params.characterId) as AvatarRow | undefined;
  res.json(avatarResponse(row));
});

router.get("/runtime.wasm", async (_req, res) => {
  try {
    res.type("application/wasm");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(await readFile(runtimeWasmAsset()));
  } catch {
    res.status(500).json({ error: "Bundled Inochi2D WebAssembly runtime is missing; reinstall Vellium" });
  }
});

router.post("/character/:characterId/model", raw({ type: "application/octet-stream", limit: "256mb" }), async (req, res) => {
  const character = db.prepare("SELECT id FROM characters WHERE id = ?").get(req.params.characterId);
  if (!character) {
    res.status(404).json({ error: "Character not found" });
    return;
  }
  const requestedFilename = decodeURIComponent(String(req.query.filename || "avatar.inp")).slice(0, 240);
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const assetId = newId();
  const staging = path.join(INOCHI_MODELS_DIR, `.${assetId}.staging`);
  const destination = path.join(INOCHI_MODELS_DIR, assetId);
  try {
    const parsed = parseInochiModel(body, requestedFilename);
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, "model.inp"), body, { mode: 0o600 });
    await rename(staging, destination);
    const previous = db.prepare("SELECT asset_id FROM inochi2d_avatars WHERE character_id = ?")
      .get(req.params.characterId) as { asset_id: string } | undefined;
    const timestamp = now();
    db.prepare(`
      INSERT INTO inochi2d_avatars (character_id, asset_id, display_name, filename, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(character_id) DO UPDATE SET
        asset_id = excluded.asset_id,
        display_name = excluded.display_name,
        filename = excluded.filename,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(req.params.characterId, assetId, parsed.displayName, parsed.filename, JSON.stringify(parsed), timestamp, timestamp);
    if (previous?.asset_id && previous.asset_id !== assetId) {
      await rm(path.join(INOCHI_MODELS_DIR, previous.asset_id), { recursive: true, force: true });
    }
    const row = db.prepare("SELECT * FROM inochi2d_avatars WHERE character_id = ?")
      .get(req.params.characterId) as AvatarRow;
    res.json(avatarResponse(row));
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    await rm(destination, { recursive: true, force: true }).catch(() => undefined);
    res.status(400).json({ error: error instanceof Error ? error.message : "Inochi2D model import failed" });
  }
});

router.delete("/character/:characterId", async (req, res) => {
  const row = db.prepare("SELECT asset_id FROM inochi2d_avatars WHERE character_id = ?")
    .get(req.params.characterId) as { asset_id: string } | undefined;
  db.prepare("DELETE FROM inochi2d_avatars WHERE character_id = ?").run(req.params.characterId);
  if (row?.asset_id) await rm(path.join(INOCHI_MODELS_DIR, row.asset_id), { recursive: true, force: true });
  res.json(avatarResponse());
});

router.get("/assets/:assetId/model.inp", async (req, res) => {
  const assetId = String(req.params.assetId || "");
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(assetId)) {
    res.status(400).end();
    return;
  }
  try {
    const row = db.prepare("SELECT asset_id FROM inochi2d_avatars WHERE asset_id = ?")
      .get(assetId) as { asset_id: string } | undefined;
    if (!row) throw new Error("Unknown model");
    const data = await readFile(path.join(INOCHI_MODELS_DIR, assetId, "model.inp"));
    res.type("application/octet-stream");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.send(data);
  } catch {
    res.status(404).end();
  }
});

export default router;
