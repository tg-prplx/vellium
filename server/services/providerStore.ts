import { db } from "../db.js";
import { decryptSecret } from "./secretVault.js";

/**
 * The only reader of full provider rows. `api_key_cipher` is encrypted at rest
 * and returned here as plaintext for request building; never read
 * `SELECT * FROM providers` directly elsewhere.
 */
function withDecryptedKey<T>(row: T | undefined): T | undefined {
  if (!row) return row;
  const record = row as T & { api_key_cipher?: unknown };
  return { ...record, api_key_cipher: decryptSecret(record.api_key_cipher) };
}

export function getProviderRow<T = Record<string, unknown>>(providerId: string | null | undefined): T | undefined {
  if (!providerId) return undefined;
  return withDecryptedKey(db.prepare("SELECT * FROM providers WHERE id = ?").get(providerId) as T | undefined);
}

export function listProviderRows<T = Record<string, unknown>>(): T[] {
  return (db.prepare("SELECT * FROM providers ORDER BY name ASC").all() as T[]).map((row) => withDecryptedKey(row) as T);
}
