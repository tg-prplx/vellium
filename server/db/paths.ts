import { mkdirSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { resolveActiveProfile } from "./profiles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveDefaultDataDir() {
  if (process.env.SLV_DATA_DIR) {
    return process.env.SLV_DATA_DIR;
  }
  if (process.env.VITEST) {
    throw new Error("Tests must set SLV_DATA_DIR to a temporary directory before importing server code.");
  }
  const cwdPackageJson = resolve(process.cwd(), "package.json");
  if (existsSync(cwdPackageJson)) {
    return resolve(process.cwd(), "data");
  }
  return resolve(__dirname, "..", "..", "data");
}

function resolveBundledPluginsDir() {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (process.env.SLV_BUNDLED_PLUGINS_DIR) {
    return process.env.SLV_BUNDLED_PLUGINS_DIR;
  }

  const cwdPackageJson = resolve(process.cwd(), "package.json");
  if (existsSync(cwdPackageJson)) {
    return resolve(process.cwd(), "bundled-plugins");
  }

  const candidates = [
    resourcesPath ? resolve(resourcesPath, "data", "bundled-plugins") : null,
    resolve(__dirname, "data", "bundled-plugins"),
    resolve(__dirname, "..", "data", "bundled-plugins"),
    resolve(__dirname, "..", "..", "data", "bundled-plugins")
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return candidates[0] || resolve(__dirname, "..", "..", "data", "bundled-plugins");
}

/** Installation-level root: holds profile data and the secret key directory. */
export const DATA_ROOT = resolveDefaultDataDir();
export const KEYS_DIR = join(DATA_ROOT, "keys");
export const BACKUPS_DIR = join(DATA_ROOT, "backups");
const activeProfile = resolveActiveProfile(DATA_ROOT);
/** Active profile id, fixed for the process lifetime (switching restarts the app). */
export const ACTIVE_PROFILE_ID = activeProfile.id;
/** Data directory of the active profile: database, media, plugins and exports. */
export const DATA_DIR = activeProfile.dir;
export const AVATARS_DIR = join(DATA_DIR, "avatars");
export const UPLOADS_DIR = join(DATA_DIR, "uploads");
export const PLUGINS_DIR = join(DATA_DIR, "plugins");
export const INOCHI_DIR = join(DATA_DIR, "inochi2d");
export const INOCHI_MODELS_DIR = join(INOCHI_DIR, "models");
export const BUNDLED_PLUGINS_DIR = resolveBundledPluginsDir();

const VELLIUM_DB_PATH = join(DATA_DIR, "vellum.db");
const LEGACY_DB_PATH = join(DATA_DIR, "sillytauri.db");

export function ensureDataDirs() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(AVATARS_DIR, { recursive: true });
  mkdirSync(UPLOADS_DIR, { recursive: true });
  mkdirSync(PLUGINS_DIR, { recursive: true });
  mkdirSync(INOCHI_MODELS_DIR, { recursive: true });
}

export function resolveDbPath() {
  return existsSync(VELLIUM_DB_PATH)
    ? VELLIUM_DB_PATH
    : existsSync(LEGACY_DB_PATH)
      ? LEGACY_DB_PATH
      : VELLIUM_DB_PATH;
}
