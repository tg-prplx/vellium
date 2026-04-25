import type Database from "better-sqlite3";

const MIGRATIONS = [
  "ALTER TABLE characters ADD COLUMN avatar_path TEXT",
  "ALTER TABLE characters ADD COLUMN tags TEXT DEFAULT '[]'",
  "ALTER TABLE characters ADD COLUMN greeting TEXT DEFAULT ''",
  "ALTER TABLE characters ADD COLUMN system_prompt TEXT DEFAULT ''",
  "ALTER TABLE characters ADD COLUMN description TEXT DEFAULT ''",
  "ALTER TABLE characters ADD COLUMN personality TEXT DEFAULT ''",
  "ALTER TABLE characters ADD COLUMN scenario TEXT DEFAULT ''",
  "ALTER TABLE characters ADD COLUMN mes_example TEXT DEFAULT ''",
  "ALTER TABLE characters ADD COLUMN creator_notes TEXT DEFAULT ''",
  "ALTER TABLE chats ADD COLUMN character_id TEXT",
  "ALTER TABLE chats ADD COLUMN sampler_config TEXT",
  "ALTER TABLE chats ADD COLUMN context_summary TEXT DEFAULT ''",
  "ALTER TABLE messages ADD COLUMN attachments TEXT DEFAULT '[]'",
  "ALTER TABLE chats ADD COLUMN character_ids TEXT DEFAULT '[]'",
  "ALTER TABLE chats ADD COLUMN auto_conversation INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE messages ADD COLUMN character_name TEXT DEFAULT ''",
  "ALTER TABLE chats ADD COLUMN active_preset TEXT DEFAULT ''",
  "ALTER TABLE messages ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE chats ADD COLUMN author_note TEXT DEFAULT ''",
  "ALTER TABLE chats ADD COLUMN lorebook_id TEXT",
  "ALTER TABLE chats ADD COLUMN lorebook_ids TEXT DEFAULT '[]'",
  "ALTER TABLE characters ADD COLUMN lorebook_id TEXT",
  "ALTER TABLE messages ADD COLUMN rag_sources TEXT DEFAULT '[]'",
  "ALTER TABLE messages ADD COLUMN generation_started_at TEXT",
  "ALTER TABLE messages ADD COLUMN generation_completed_at TEXT",
  "ALTER TABLE messages ADD COLUMN generation_duration_ms INTEGER",
  "ALTER TABLE writer_projects ADD COLUMN character_ids TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE writer_projects ADD COLUMN notes_json TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE writer_chapters ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE providers ADD COLUMN provider_type TEXT NOT NULL DEFAULT 'openai'",
  "ALTER TABLE providers ADD COLUMN adapter_id TEXT",
  "ALTER TABLE providers ADD COLUMN manual_models TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE agent_threads ADD COLUMN mode TEXT NOT NULL DEFAULT 'build'",
  "ALTER TABLE agent_threads ADD COLUMN hero_character_id TEXT",
  "ALTER TABLE agent_threads ADD COLUMN workspace_root TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE agent_threads ADD COLUMN memory_summary TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE agent_threads ADD COLUMN memory_updated_at TEXT",
  "ALTER TABLE agent_threads ADD COLUMN developer_prompt TEXT NOT NULL DEFAULT ''"
];

export function applyMigrations(db: Database.Database) {
  for (const sql of MIGRATIONS) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists.
    }
  }
}
