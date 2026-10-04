import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { KEYS_DIR } from "../db/paths.js";

/**
 * At-rest encryption for stored API keys (AES-256-GCM).
 *
 * The master key lives outside profile data (`<data root>/keys/master.key`, or
 * `SLV_SECRET_KEY` for headless deployments), so a leaked database file or an
 * unencrypted profile backup does not expose provider credentials. It does not
 * protect against malware running as the same OS user, which can read both.
 */
const PREFIX = "vlt1:";
const AAD = Buffer.from("vellium:secret:v1", "utf8");
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;
let warnedDecryptFailure = false;

export const MASTER_KEY_FILENAME = "master.key";

function masterKeyPath() {
  return join(KEYS_DIR, MASTER_KEY_FILENAME);
}

function parseKey(raw: string, source: string): Buffer {
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== KEY_BYTES) throw new Error(`${source} must be ${KEY_BYTES} bytes encoded as base64`);
  return key;
}

function loadMasterKey(createIfMissing: boolean): Buffer | null {
  if (cachedKey) return cachedKey;
  const fromEnv = String(process.env.SLV_SECRET_KEY || "").trim();
  if (fromEnv) {
    cachedKey = parseKey(fromEnv, "SLV_SECRET_KEY");
    return cachedKey;
  }
  const path = masterKeyPath();
  if (existsSync(path)) {
    // Never regenerate over an existing key file: that would make every stored secret unreadable.
    cachedKey = parseKey(readFileSync(path, "utf8"), path);
    return cachedKey;
  }
  if (!createIfMissing) return null;
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  const key = randomBytes(KEY_BYTES);
  writeFileSync(path, `${key.toString("base64")}\n`, { mode: 0o600, flag: "wx" });
  try { chmodSync(path, 0o600); } catch { /* Windows ignores POSIX modes. */ }
  cachedKey = key;
  return cachedKey;
}

export function isEncryptedSecret(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(plain: unknown): string {
  const value = String(plain ?? "");
  if (!value || isEncryptedSecret(value)) return value;
  const key = loadMasterKey(true) as Buffer;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

function decryptWithKey(value: string, key: Buffer): string {
  const payload = Buffer.from(value.slice(PREFIX.length), "base64");
  if (payload.length < IV_BYTES + TAG_BYTES) throw new Error("ciphertext is truncated");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, IV_BYTES));
  decipher.setAAD(AAD);
  decipher.setAuthTag(payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(payload.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}

/**
 * Re-encrypts a value written under another installation's master key (restored
 * backups). Returns null when it cannot be decrypted with that key.
 */
export function rekeySecret(stored: unknown, sourceKey: Buffer): string | null {
  const value = String(stored ?? "");
  if (!isEncryptedSecret(value)) return encryptSecret(value);
  try {
    return encryptSecret(decryptWithKey(value, sourceKey));
  } catch {
    return null;
  }
}

/** Returns plaintext; legacy unencrypted values pass through, unreadable values become "". */
export function decryptSecret(stored: unknown): string {
  const value = String(stored ?? "");
  if (!isEncryptedSecret(value)) return value;
  try {
    const key = loadMasterKey(false);
    if (!key) throw new Error("master key is missing");
    return decryptWithKey(value, key);
  } catch (error) {
    if (!warnedDecryptFailure) {
      warnedDecryptFailure = true;
      console.warn(`[secrets] A stored API key could not be decrypted and must be re-entered: ${error instanceof Error ? error.message : error}`);
    }
    return "";
  }
}

/** Raw master key bytes for password-protected backups; null when no key exists yet. */
export function exportMasterKey(): Buffer | null {
  return loadMasterKey(false);
}

/** Test hook: forget the cached key so a changed key file or env var is re-read. */
export function resetSecretVaultCache() {
  cachedKey = null;
  warnedDecryptFailure = false;
}
