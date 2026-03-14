import type Database from "better-sqlite3";

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    recovery_hash TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key_cipher TEXT NOT NULL,
    proxy_url TEXT,
    full_local_only INTEGER NOT NULL DEFAULT 0,
    provider_type TEXT NOT NULL DEFAULT 'openai',
    adapter_id TEXT
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    lorebook_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_message_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    parent_id TEXT,
    deleted INTEGER NOT NULL DEFAULT 0,
    generation_started_at TEXT,
    generation_completed_at TEXT,
    generation_duration_ms INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    card_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lorebooks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    entries_json TEXT NOT NULL DEFAULT '[]',
    source_character_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rp_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rp_scene_state (
    chat_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rp_memory_entries (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS writer_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    character_ids TEXT NOT NULL DEFAULT '[]',
    notes_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS writer_chapters (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    position INTEGER NOT NULL,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS writer_scenes (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    goals TEXT NOT NULL,
    conflicts TEXT NOT NULL,
    outcomes TEXT NOT NULL,
    character_id TEXT,
    chat_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS writer_beats (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS writer_consistency_reports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS writer_exports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    export_type TEXT NOT NULL,
    output_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS writer_chapter_summaries (
    chapter_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    summary TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS writer_project_summaries (
    project_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    summary TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS writer_summary_lenses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    scope TEXT NOT NULL,
    target_id TEXT,
    prompt TEXT NOT NULL,
    output TEXT NOT NULL DEFAULT '',
    source_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prompt_blocks (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    ordering INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_personas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    personality TEXT NOT NULL DEFAULT '',
    scenario TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rag_collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT 'global',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rag_documents (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'manual',
    source_id TEXT,
    content_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'indexed_lexical',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (collection_id) REFERENCES rag_collections(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rag_chunks (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (collection_id) REFERENCES rag_collections(id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES rag_documents(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rag_vectors (
    chunk_id TEXT NOT NULL,
    model_key TEXT NOT NULL,
    dim INTEGER NOT NULL,
    vector_blob BLOB NOT NULL,
    norm REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (chunk_id, model_key),
    FOREIGN KEY (chunk_id) REFERENCES rag_chunks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chat_rag_bindings (
    chat_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    collection_ids TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS writer_rag_bindings (
    project_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    collection_ids TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES writer_projects(id) ON DELETE CASCADE
  );
`;

export function applySchema(db: Database.Database) {
  db.exec(SCHEMA_SQL);
}

export function applySchemaIndexes(db: Database.Database) {
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_rag_documents_collection ON rag_documents(collection_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_rag_chunks_collection ON rag_chunks(collection_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_rag_chunks_document ON rag_chunks(document_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_rag_vectors_model ON rag_vectors(model_key)");
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunk_fts USING fts5(chunk_id UNINDEXED, content, tokenize='unicode61')");
  } catch {
    // Keep startup resilient if a platform SQLite build lacks FTS5.
  }
}
