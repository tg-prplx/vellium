import Database from "better-sqlite3";
import { DEFAULT_SETTINGS } from "./db/defaultSettings.js";
import { applyMigrations } from "./db/migrations.js";
import { ensureDataDirs, resolveDbPath, DATA_DIR, AVATARS_DIR, UPLOADS_DIR, PLUGINS_DIR } from "./db/paths.js";
import { applySchema, applySchemaIndexes } from "./db/schema.js";
import { hashSecret, isLocalhostUrl, maskApiKey, newId, now, roughTokenCount } from "./db/utils.js";

ensureDataDirs();

const db = new Database(resolveDbPath());
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

applySchema(db);
applySchemaIndexes(db);
applyMigrations(db);

reconcileKoboldProviderLocalMode();
backfillMessageSortOrder();
ensureDefaultSettingsRow();

function reconcileKoboldProviderLocalMode() {
  try {
    const rows = db.prepare(
      "SELECT id, base_url, full_local_only FROM providers WHERE provider_type = 'koboldcpp'"
    ).all() as Array<{ id: string; base_url: string; full_local_only: number }>;
    const update = db.prepare("UPDATE providers SET full_local_only = 0 WHERE id = ?");
    for (const row of rows) {
      if (row.full_local_only && !isLocalhostUrl(String(row.base_url || ""))) {
        update.run(row.id);
      }
    }
  } catch {
    // Ignore if providers table is unavailable during first boot.
  }
}

function backfillMessageSortOrder() {
  try {
    const needsBackfill = db.prepare(
      "SELECT COUNT(*) as cnt FROM messages WHERE sort_order = 0"
    ).get() as { cnt: number };
    if (needsBackfill.cnt > 0) {
      db.exec(`
        UPDATE messages SET sort_order = (
          SELECT COUNT(*) FROM messages AS m2
          WHERE m2.chat_id = messages.chat_id
            AND m2.branch_id = messages.branch_id
            AND (m2.created_at < messages.created_at OR (m2.created_at = messages.created_at AND m2.id < messages.id))
        ) + 1
        WHERE sort_order = 0
      `);
    }
  } catch {
    // Ignore if table structure differs.
  }
}

function ensureDefaultSettingsRow() {
  const existingSettings = db.prepare("SELECT payload FROM settings WHERE id = 1").get() as { payload: string } | undefined;
  if (!existingSettings) {
    db.prepare("INSERT INTO settings (id, payload) VALUES (1, ?)").run(JSON.stringify(DEFAULT_SETTINGS));
    return;
  }

  try {
    const parsed = JSON.parse(existingSettings.payload) as Record<string, unknown>;
    if (typeof parsed.onboardingCompleted !== "boolean") {
      parsed.onboardingCompleted = true;
      db.prepare("UPDATE settings SET payload = ? WHERE id = 1").run(JSON.stringify(parsed));
    }
  } catch {
    db.prepare("UPDATE settings SET payload = ? WHERE id = 1").run(JSON.stringify(DEFAULT_SETTINGS));
  }
}

export function nextSortOrder(chatId: string, branchId: string): number {
  const row = db.prepare(
    "SELECT MAX(sort_order) as mx FROM messages WHERE chat_id = ? AND branch_id = ?"
  ).get(chatId, branchId) as { mx: number | null };
  return (row?.mx ?? 0) + 1;
}

export {
  db,
  DATA_DIR,
  AVATARS_DIR,
  UPLOADS_DIR,
  PLUGINS_DIR,
  DEFAULT_SETTINGS,
  newId,
  now,
  hashSecret,
  roughTokenCount,
  maskApiKey,
  isLocalhostUrl
};
