use anyhow::Result;
use chrono::Utc;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::path::Path;

use crate::models::AppSettings;

pub fn open(db_path: &Path) -> Result<Connection> {
    Ok(Connection::open(db_path)?)
}

pub fn init_db(db_path: &Path) -> Result<()> {
    let conn = open(db_path)?;
    conn.execute_batch(
        r#"
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
            full_local_only INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
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
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            card_json TEXT NOT NULL,
            created_at TEXT NOT NULL
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
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS writer_chapters (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            title TEXT NOT NULL,
            position INTEGER NOT NULL,
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
        "#,
    )?;

    if conn
        .query_row("SELECT COUNT(*) FROM settings", [], |row| row.get::<_, i64>(0))?
        == 0
    {
        let default = serde_json::to_string(&AppSettings::default())?;
        conn.execute("INSERT INTO settings (id, payload) VALUES (1, ?1)", params![default])?;
    }

    Ok(())
}

pub fn read_settings(conn: &Connection) -> Result<AppSettings> {
    let payload: String = conn.query_row("SELECT payload FROM settings WHERE id = 1", [], |row| row.get(0))?;
    Ok(serde_json::from_str(&payload)?)
}

pub fn write_settings(conn: &Connection, settings: &AppSettings) -> Result<()> {
    let payload = serde_json::to_string(settings)?;
    conn.execute("UPDATE settings SET payload = ?1 WHERE id = 1", params![payload])?;
    Ok(())
}

pub fn now() -> String {
    Utc::now().to_rfc3339()
}

pub fn hash_secret(secret: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn rough_token_count(text: &str) -> i64 {
    ((text.chars().count() as f32) / 3.7).ceil() as i64
}

pub fn mask_api_key(raw: &str) -> String {
    if raw.len() <= 8 {
        return "********".to_string();
    }
    format!("{}***{}", &raw[..4], &raw[raw.len() - 4..])
}
