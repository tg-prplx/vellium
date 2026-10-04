import type Database from "better-sqlite3";
import { encryptSecret, isEncryptedSecret } from "../services/secretVault.js";

export const ENCRYPTED_SETTINGS_SECRET_KEYS = ["ttsApiKey", "sttApiKey"] as const;

/**
 * Idempotently encrypts API keys that older versions stored as plaintext.
 * Already-encrypted values are left untouched, so repeated boots are no-ops.
 */
export function encryptStoredSecrets(db: Database.Database) {
  const providers = db.prepare("SELECT id, api_key_cipher FROM providers").all() as Array<{ id: string; api_key_cipher: string | null }>;
  const pendingProviders = providers.filter((row) => row.api_key_cipher && !isEncryptedSecret(row.api_key_cipher));
  const settingsRow = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
  let settings: Record<string, unknown> | null = null;
  if (settingsRow) {
    try {
      settings = JSON.parse(settingsRow.payload) as Record<string, unknown>;
    } catch {
      settings = null;
    }
  }
  const pendingSettingsKeys = settings
    ? ENCRYPTED_SETTINGS_SECRET_KEYS.filter((key) => typeof settings?.[key] === "string" && settings[key] && !isEncryptedSecret(settings[key]))
    : [];
  if (pendingProviders.length === 0 && pendingSettingsKeys.length === 0) return;

  const updateProvider = db.prepare("UPDATE providers SET api_key_cipher = ? WHERE id = ?");
  db.transaction(() => {
    for (const row of pendingProviders) updateProvider.run(encryptSecret(row.api_key_cipher), row.id);
    if (settings && pendingSettingsKeys.length > 0) {
      for (const key of pendingSettingsKeys) settings[key] = encryptSecret(settings[key]);
      db.prepare("UPDATE settings SET payload = ? WHERE id = 1").run(JSON.stringify(settings));
    }
  })();
}
