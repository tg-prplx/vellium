import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";

/**
 * Data profiles: independent databases + media under one installation root.
 *
 * Layout under the data root:
 *   profiles.json          registry and the active profile id
 *   <root>/                "default" profile (legacy layout, so existing data never moves)
 *   profiles/<id>/         every other profile
 *   keys/, backups/, local-models/   installation-wide, shared by all profiles
 *
 * The active profile is read once at startup; switching writes the registry and
 * restarts the app so no module keeps paths, caches or streams from the old profile.
 */
export const DEFAULT_PROFILE_ID = "default";
export const PROFILES_FILENAME = "profiles.json";
export const PROFILES_DIRNAME = "profiles";
const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_PROFILE_NAME_LENGTH = 60;

export interface DataProfileEntry {
  id: string;
  name: string;
  createdAt: string;
}

export interface DataProfileRegistry {
  version: 1;
  active: string;
  profiles: DataProfileEntry[];
}

function defaultEntry(): DataProfileEntry {
  return { id: DEFAULT_PROFILE_ID, name: "Default", createdAt: new Date(0).toISOString() };
}

export function isValidProfileId(id: unknown): id is string {
  return typeof id === "string" && PROFILE_ID_PATTERN.test(id);
}

export function normalizeProfileName(raw: unknown): string {
  const name = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_PROFILE_NAME_LENGTH);
  if (!name) throw new Error("Profile name is required");
  return name;
}

export function readProfileRegistry(root: string): DataProfileRegistry {
  const fallback: DataProfileRegistry = { version: 1, active: DEFAULT_PROFILE_ID, profiles: [defaultEntry()] };
  const path = join(root, PROFILES_FILENAME);
  if (!existsSync(path)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DataProfileRegistry>;
    const seen = new Set<string>();
    const profiles = (Array.isArray(parsed.profiles) ? parsed.profiles : [])
      .filter((entry): entry is DataProfileEntry => Boolean(entry) && isValidProfileId(entry.id) && !seen.has(entry.id) && Boolean(seen.add(entry.id)))
      .map((entry) => ({
        id: entry.id,
        name: (() => { try { return normalizeProfileName(entry.name); } catch { return entry.id; } })(),
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date(0).toISOString()
      }));
    if (!profiles.some((entry) => entry.id === DEFAULT_PROFILE_ID)) profiles.unshift(defaultEntry());
    const active = isValidProfileId(parsed.active) && profiles.some((entry) => entry.id === parsed.active) ? parsed.active : DEFAULT_PROFILE_ID;
    return { version: 1, active, profiles };
  } catch {
    // A corrupt registry must never hide data: fall back to the legacy default profile.
    return fallback;
  }
}

export function writeProfileRegistry(root: string, registry: DataProfileRegistry) {
  mkdirSync(root, { recursive: true });
  const path = join(root, PROFILES_FILENAME);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`);
  renameSync(temp, path);
}

export function profileDataDir(root: string, profileId: string): string {
  if (profileId === DEFAULT_PROFILE_ID) return root;
  if (!isValidProfileId(profileId)) throw new Error("Invalid profile id");
  return join(root, PROFILES_DIRNAME, profileId);
}

/** Directory of the active profile; a missing profile directory falls back to the default one. */
export function resolveActiveProfile(root: string): { id: string; dir: string } {
  const registry = readProfileRegistry(root);
  const dir = profileDataDir(root, registry.active);
  if (registry.active !== DEFAULT_PROFILE_ID && !existsSync(dir)) {
    console.warn(`[profiles] Active profile "${registry.active}" is missing; using the default profile.`);
    return { id: DEFAULT_PROFILE_ID, dir: root };
  }
  return { id: registry.active, dir };
}

export function newProfileId(): string {
  return `p-${randomUUID().slice(0, 8)}`;
}
