import { mkdirSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveDefaultDataDir() {
  if (process.env.SLV_DATA_DIR) {
    return process.env.SLV_DATA_DIR;
  }
  const cwdPackageJson = resolve(process.cwd(), "package.json");
  if (existsSync(cwdPackageJson)) {
    return resolve(process.cwd(), "data");
  }
  return resolve(__dirname, "..", "..", "data");
}

export const DATA_DIR = resolveDefaultDataDir();
export const AVATARS_DIR = join(DATA_DIR, "avatars");
export const UPLOADS_DIR = join(DATA_DIR, "uploads");
export const PLUGINS_DIR = join(DATA_DIR, "plugins");
export const BUNDLED_PLUGINS_DIR = existsSync(resolve(process.cwd(), "package.json"))
  ? resolve(process.cwd(), "data", "bundled-plugins")
  : resolve(__dirname, "..", "..", "data", "bundled-plugins");

const VELLIUM_DB_PATH = join(DATA_DIR, "vellum.db");
const LEGACY_DB_PATH = join(DATA_DIR, "sillytauri.db");

export function ensureDataDirs() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(AVATARS_DIR, { recursive: true });
  mkdirSync(UPLOADS_DIR, { recursive: true });
  mkdirSync(PLUGINS_DIR, { recursive: true });
}

export function resolveDbPath() {
  return existsSync(VELLIUM_DB_PATH)
    ? VELLIUM_DB_PATH
    : existsSync(LEGACY_DB_PATH)
      ? LEGACY_DB_PATH
      : VELLIUM_DB_PATH;
}
