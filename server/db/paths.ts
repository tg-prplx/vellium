import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.SLV_DATA_DIR || join(__dirname, "..", "..", "data");
export const AVATARS_DIR = join(DATA_DIR, "avatars");
export const UPLOADS_DIR = join(DATA_DIR, "uploads");

const VELLIUM_DB_PATH = join(DATA_DIR, "vellum.db");
const LEGACY_DB_PATH = join(DATA_DIR, "sillytauri.db");

export function ensureDataDirs() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(AVATARS_DIR, { recursive: true });
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

export function resolveDbPath() {
  return existsSync(VELLIUM_DB_PATH)
    ? VELLIUM_DB_PATH
    : existsSync(LEGACY_DB_PATH)
      ? LEGACY_DB_PATH
      : VELLIUM_DB_PATH;
}
