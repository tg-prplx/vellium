import { Router, type Response } from "express";
import { createWriteStream } from "fs";
import { mkdir, rm } from "fs/promises";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { BACKUPS_DIR } from "../db/paths.js";
import { BackupFormatError, BackupPasswordError, readBackupHeader } from "../services/dataBackup/archive.js";
import {
  BackupNotFoundError,
  DataOperationBusyError,
  DataProfileNotFoundError,
  createBackup,
  createDataProfile,
  deleteBackup,
  deleteDataProfile,
  describeBackup,
  listBackups,
  listDataProfiles,
  renameDataProfile,
  resolveBackupFile,
  restoreBackup,
  selectDataProfile,
  uploadedBackupPath
} from "../services/dataBackup/dataProfiles.js";

const router = Router();
const MAX_UPLOAD_BYTES = 32 * 1024 ** 3;

function sendError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Data operation failed";
  const status = error instanceof DataProfileNotFoundError || error instanceof BackupNotFoundError
    ? 404
    : error instanceof DataOperationBusyError
      ? 409
      : error instanceof BackupPasswordError
        ? 401
        : 400;
  if (!(error instanceof BackupPasswordError) && status === 400 && !(error instanceof BackupFormatError)) {
    console.warn("[data]", message);
  }
  res.status(status).json({ error: message, code: error instanceof BackupPasswordError ? "backup_password" : undefined });
}

router.get("/profiles", async (_req, res) => {
  try { res.json(await listDataProfiles()); } catch (error) { sendError(res, error); }
});

router.post("/profiles", async (req, res) => {
  try { res.json(await createDataProfile(req.body?.name)); } catch (error) { sendError(res, error); }
});

router.patch("/profiles/:id", (req, res) => {
  try { res.json(renameDataProfile(String(req.params.id), req.body?.name)); } catch (error) { sendError(res, error); }
});

router.delete("/profiles/:id", async (req, res) => {
  try { await deleteDataProfile(String(req.params.id)); res.json({ ok: true }); } catch (error) { sendError(res, error); }
});

router.post("/profiles/:id/select", (req, res) => {
  try { res.json(selectDataProfile(String(req.params.id))); } catch (error) { sendError(res, error); }
});

router.get("/backups", async (_req, res) => {
  try { res.json(await listBackups()); } catch (error) { sendError(res, error); }
});

router.post("/backups", async (req, res) => {
  try { res.json(await createBackup({ profileId: req.body?.profileId, password: req.body?.password })); } catch (error) { sendError(res, error); }
});

router.get("/backups/:file/download", (req, res) => {
  try {
    const path = resolveBackupFile(req.params.file);
    res.download(path, String(req.params.file), { headers: { "Content-Type": "application/octet-stream" } });
  } catch (error) { sendError(res, error); }
});

router.delete("/backups/:file", async (req, res) => {
  try { await deleteBackup(req.params.file); res.json({ ok: true }); } catch (error) { sendError(res, error); }
});

// Raw streamed upload: backups can exceed the JSON body limit by orders of magnitude.
router.post("/backups/upload", async (req, res) => {
  if (!String(req.headers["content-type"] || "").startsWith("application/octet-stream")) {
    res.status(415).json({ error: "Upload the backup file as application/octet-stream" });
    return;
  }
  const { file, path } = uploadedBackupPath();
  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      callback(received > MAX_UPLOAD_BYTES ? new Error("Backup file is too large") : null, chunk);
    }
  });
  try {
    await mkdir(BACKUPS_DIR, { recursive: true });
    await pipeline(req, limiter, createWriteStream(path, { flags: "wx", mode: 0o600 }));
    await readBackupHeader(path);
    res.json(await describeBackup(file));
  } catch (error) {
    await rm(path, { force: true });
    sendError(res, error);
  }
});

router.post("/backups/:file/restore", async (req, res) => {
  try {
    res.json(await restoreBackup({ file: req.params.file, password: req.body?.password, name: req.body?.name }));
  } catch (error) { sendError(res, error); }
});

export default router;
