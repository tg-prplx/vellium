import Database from "better-sqlite3";
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import { lstat, mkdir, readdir, rename, rm, stat } from "fs/promises";
import { basename, join } from "path";
import packageMetadata from "../../../package.json";
import { db } from "../../db.js";
import { ACTIVE_PROFILE_ID, BACKUPS_DIR, DATA_ROOT } from "../../db/paths.js";
import {
  DEFAULT_PROFILE_ID,
  PROFILES_DIRNAME,
  PROFILES_FILENAME,
  newProfileId,
  normalizeProfileName,
  profileDataDir,
  readProfileRegistry,
  writeProfileRegistry,
  type DataProfileEntry
} from "../../db/profiles.js";
import { ENCRYPTED_SETTINGS_SECRET_KEYS } from "../../db/secretMigration.js";
import { exportMasterKey, rekeySecret } from "../secretVault.js";
import {
  SPECIAL_ENTRY_PREFIX,
  extractBackupArchive,
  readBackupHeader,
  writeBackupArchive,
  type BackupHeader,
  type BackupSourceFile
} from "./archive.js";

const MASTER_KEY_ENTRY = `${SPECIAL_ENTRY_PREFIX}master.key`;
const BACKUP_EXTENSION = ".vbak";
const BACKUP_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.vbak$/;
// Installation-wide or regenerated content that never belongs to a profile backup.
const ROOT_ONLY_ENTRIES = new Set([PROFILES_DIRNAME, PROFILES_FILENAME, "keys", "backups", "local-models", "bundled-plugins", ".trash"]);
const DATABASE_FILES = /^(vellum|sillytauri)\.db(-wal|-shm|-journal)?$/;

export type RestartMode = "relaunch" | "manual";

export interface DataProfileSummary extends DataProfileEntry {
  running: boolean;
  selected: boolean;
  databaseBytes: number | null;
}

export interface BackupSummary {
  file: string;
  bytes: number;
  createdAt: string;
  profileName: string;
  appVersion: string;
  encrypted: boolean;
  includesMasterKey: boolean;
}

let busyOperation: string | null = null;

async function exclusive<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (busyOperation) throw new DataOperationBusyError(busyOperation);
  busyOperation = label;
  try {
    return await work();
  } finally {
    busyOperation = null;
  }
}

export class DataOperationBusyError extends Error {
  constructor(operation: string) { super(`Another data operation is running: ${operation}`); this.name = "DataOperationBusyError"; }
}

/** Embedded in Electron the app can relaunch itself; standalone servers must be restarted by the operator. */
export function restartMode(): RestartMode {
  return process.versions.electron ? "relaunch" : "manual";
}

function profileDbPath(profileId: string) {
  const dir = profileDataDir(DATA_ROOT, profileId);
  const current = join(dir, "vellum.db");
  const legacy = join(dir, "sillytauri.db");
  return existsSync(current) ? current : existsSync(legacy) ? legacy : null;
}

export async function listDataProfiles(): Promise<{ profiles: DataProfileSummary[]; running: string; selected: string; restartMode: RestartMode }> {
  const registry = readProfileRegistry(DATA_ROOT);
  const profiles = await Promise.all(registry.profiles.map(async (entry) => {
    const dbPath = profileDbPath(entry.id);
    // WAL mode keeps recent writes in "-wal" until a checkpoint, so count both files.
    const databaseBytes = dbPath
      ? ((await stat(dbPath).catch(() => null))?.size ?? 0) + ((await stat(`${dbPath}-wal`).catch(() => null))?.size ?? 0)
      : null;
    return { ...entry, running: entry.id === ACTIVE_PROFILE_ID, selected: entry.id === registry.active, databaseBytes };
  }));
  return { profiles, running: ACTIVE_PROFILE_ID, selected: registry.active, restartMode: restartMode() };
}

export async function createDataProfile(rawName: unknown): Promise<DataProfileEntry> {
  const name = normalizeProfileName(rawName);
  const registry = readProfileRegistry(DATA_ROOT);
  const entry: DataProfileEntry = { id: newProfileId(), name, createdAt: new Date().toISOString() };
  await mkdir(profileDataDir(DATA_ROOT, entry.id), { recursive: true });
  writeProfileRegistry(DATA_ROOT, { ...registry, profiles: [...registry.profiles, entry] });
  return entry;
}

export function renameDataProfile(profileId: string, rawName: unknown): DataProfileEntry {
  const name = normalizeProfileName(rawName);
  const registry = readProfileRegistry(DATA_ROOT);
  const entry = registry.profiles.find((profile) => profile.id === profileId);
  if (!entry) throw new DataProfileNotFoundError();
  const updated = { ...entry, name };
  writeProfileRegistry(DATA_ROOT, { ...registry, profiles: registry.profiles.map((profile) => (profile.id === profileId ? updated : profile)) });
  return updated;
}

export class DataProfileNotFoundError extends Error {
  constructor() { super("Profile not found"); this.name = "DataProfileNotFoundError"; }
}

/** Selects the profile for the next start. The running process keeps its profile until restarted. */
export function selectDataProfile(profileId: string): { selected: string; restartRequired: boolean; restartMode: RestartMode } {
  const registry = readProfileRegistry(DATA_ROOT);
  if (!registry.profiles.some((profile) => profile.id === profileId)) throw new DataProfileNotFoundError();
  writeProfileRegistry(DATA_ROOT, { ...registry, active: profileId });
  return { selected: profileId, restartRequired: profileId !== ACTIVE_PROFILE_ID, restartMode: restartMode() };
}

/** Moves a profile into `.trash/` instead of deleting it, so a mistaken delete stays recoverable. */
export async function deleteDataProfile(profileId: string): Promise<void> {
  if (profileId === DEFAULT_PROFILE_ID) throw new Error("The default profile cannot be deleted");
  if (profileId === ACTIVE_PROFILE_ID) throw new Error("Switch to another profile before deleting this one");
  const registry = readProfileRegistry(DATA_ROOT);
  if (!registry.profiles.some((profile) => profile.id === profileId)) throw new DataProfileNotFoundError();
  if (registry.active === profileId) throw new Error("This profile is selected for the next start; select another profile first");
  const dir = profileDataDir(DATA_ROOT, profileId);
  if (existsSync(dir)) {
    const trash = join(DATA_ROOT, ".trash");
    await mkdir(trash, { recursive: true });
    await rename(dir, join(trash, `${profileId}-${Date.now()}`));
  }
  writeProfileRegistry(DATA_ROOT, { ...registry, profiles: registry.profiles.filter((profile) => profile.id !== profileId) });
}

async function collectProfileFiles(profileId: string, dir: string, prefix = ""): Promise<BackupSourceFile[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: BackupSourceFile[] = [];
  for (const entry of entries) {
    const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!prefix && (DATABASE_FILES.test(entry.name) || (profileId === DEFAULT_PROFILE_ID && ROOT_ONLY_ENTRIES.has(entry.name)))) continue;
    if (entry.name === ".tmp" || entry.name === ".DS_Store") continue;
    const path = join(dir, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) files.push(...await collectProfileFiles(profileId, path, archivePath));
    else if (info.isFile()) files.push({ archivePath, sourcePath: path });
  }
  return files;
}

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-");
}

export function resolveBackupFile(file: unknown): string {
  const name = String(file ?? "");
  if (!BACKUP_FILENAME_PATTERN.test(name) || basename(name) !== name) throw new Error("Invalid backup file name");
  const path = join(BACKUPS_DIR, name);
  if (!existsSync(path)) throw new BackupNotFoundError();
  return path;
}

export class BackupNotFoundError extends Error {
  constructor() { super("Backup not found"); this.name = "BackupNotFoundError"; }
}

/**
 * Writes a consistent snapshot of a profile: an online SQLite backup plus the
 * profile's media/plugins. With a password the archive is encrypted and carries
 * the master key so API keys survive a restore on another machine.
 */
export async function createBackup(params: { profileId?: unknown; password?: unknown }): Promise<BackupSummary> {
  const profileId = params.profileId === undefined ? ACTIVE_PROFILE_ID : String(params.profileId);
  const password = typeof params.password === "string" ? params.password : "";
  if (password && password.length < 8) throw new Error("Backup password must be at least 8 characters");
  if (password.length > 1024) throw new Error("Backup password is too long");
  const registry = readProfileRegistry(DATA_ROOT);
  const profile = registry.profiles.find((entry) => entry.id === profileId);
  if (!profile) throw new DataProfileNotFoundError();
  return exclusive("backup", async () => {
    const workDir = join(BACKUPS_DIR, ".tmp", `${profileId}-${Date.now()}`);
    await mkdir(workDir, { recursive: true });
    try {
      const snapshot = join(workDir, "vellum.db");
      if (profileId === ACTIVE_PROFILE_ID) {
        await db.backup(snapshot);
      } else {
        const sourcePath = profileDbPath(profileId);
        if (!sourcePath) throw new Error("This profile has no database yet");
        const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
        try { await source.backup(snapshot); } finally { source.close(); }
      }
      const files = [{ archivePath: "vellum.db", sourcePath: snapshot }, ...await collectProfileFiles(profileId, profileDataDir(DATA_ROOT, profileId))];
      const masterKey = password ? exportMasterKey() : null;
      const file = `vellium-${profileId}-${backupTimestamp()}-${randomBytes(3).toString("hex")}${BACKUP_EXTENSION}`;
      const metadata = { createdAt: new Date().toISOString(), appVersion: packageMetadata.version, profileName: profile.name, includesMasterKey: Boolean(masterKey) };
      const { bytes } = await writeBackupArchive({
        outputPath: join(BACKUPS_DIR, file),
        metadata,
        files,
        inline: masterKey ? [{ archivePath: MASTER_KEY_ENTRY, data: masterKey }] : [],
        password
      });
      return { file, bytes, ...metadata, encrypted: Boolean(password) };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
}

function summarize(file: string, bytes: number, header: BackupHeader): BackupSummary {
  return {
    file,
    bytes,
    createdAt: header.createdAt,
    profileName: header.profileName,
    appVersion: header.appVersion,
    encrypted: header.encrypted,
    includesMasterKey: header.includesMasterKey
  };
}

export async function listBackups(): Promise<BackupSummary[]> {
  const names = await readdir(BACKUPS_DIR).catch(() => [] as string[]);
  const summaries = await Promise.all(names.filter((name) => BACKUP_FILENAME_PATTERN.test(name)).map(async (name) => {
    const path = join(BACKUPS_DIR, name);
    try {
      const [info, header] = await Promise.all([stat(path), readBackupHeader(path)]);
      return summarize(name, info.size, header);
    } catch {
      return null;
    }
  }));
  return summaries.filter((item): item is BackupSummary => item !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function describeBackup(file: string): Promise<BackupSummary> {
  const path = resolveBackupFile(file);
  const [info, header] = await Promise.all([stat(path), readBackupHeader(path)]);
  return summarize(file, info.size, header);
}

export async function deleteBackup(file: unknown): Promise<void> {
  await rm(resolveBackupFile(file), { force: true });
}

export function uploadedBackupPath(): { file: string; path: string } {
  const file = `uploaded-${backupTimestamp()}-${Math.random().toString(36).slice(2, 8)}${BACKUP_EXTENSION}`;
  return { file, path: join(BACKUPS_DIR, file) };
}

/** Re-encrypts stored API keys from the backup's master key to this installation's key. */
function rekeyRestoredSecrets(dbPath: string, sourceKey: Buffer | null) {
  const restored = new Database(dbPath);
  try {
    const check = restored.pragma("quick_check", { simple: true });
    if (check !== "ok") throw new Error("The restored database failed its integrity check");
    if (!sourceKey) return;
    const providers = restored.prepare("SELECT id, api_key_cipher FROM providers").all() as Array<{ id: string; api_key_cipher: string }>;
    const settingsRow = restored.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
    restored.transaction(() => {
      const update = restored.prepare("UPDATE providers SET api_key_cipher = ? WHERE id = ?");
      for (const row of providers) {
        const next = rekeySecret(row.api_key_cipher, sourceKey);
        if (next !== null && next !== row.api_key_cipher) update.run(next, row.id);
      }
      if (!settingsRow) return;
      const settings = JSON.parse(settingsRow.payload) as Record<string, unknown>;
      for (const key of ENCRYPTED_SETTINGS_SECRET_KEYS) {
        const next = rekeySecret(settings[key], sourceKey);
        if (next !== null) settings[key] = next;
      }
      restored.prepare("UPDATE settings SET payload = ? WHERE id = 1").run(JSON.stringify(settings));
    })();
  } finally {
    restored.close();
  }
}

/** Restores a backup into a new profile; existing profiles are never overwritten. */
export async function restoreBackup(params: { file: unknown; password?: unknown; name?: unknown }): Promise<DataProfileEntry> {
  const path = resolveBackupFile(params.file);
  const password = typeof params.password === "string" ? params.password : "";
  return exclusive("restore", async () => {
    const header = await readBackupHeader(path);
    const name = normalizeProfileName(params.name ?? `${header.profileName} (${new Date(header.createdAt).toLocaleDateString("en-CA")})`);
    const entry: DataProfileEntry = { id: newProfileId(), name, createdAt: new Date().toISOString() };
    const staging = join(DATA_ROOT, PROFILES_DIRNAME, `.staging-${entry.id}`);
    try {
      const { special } = await extractBackupArchive({ inputPath: path, destinationDir: staging, password });
      const dbPath = join(staging, "vellum.db");
      if (!existsSync(dbPath)) throw new Error("The backup does not contain a database");
      const sourceKey = special.get(MASTER_KEY_ENTRY);
      rekeyRestoredSecrets(dbPath, sourceKey && sourceKey.length === 32 ? sourceKey : null);
      const target = profileDataDir(DATA_ROOT, entry.id);
      await rename(staging, target);
      const registry = readProfileRegistry(DATA_ROOT);
      writeProfileRegistry(DATA_ROOT, { ...registry, profiles: [...registry.profiles, entry] });
      return entry;
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  });
}
