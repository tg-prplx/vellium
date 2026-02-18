use std::collections::HashMap;
use std::fs;
use anyhow::Context;
use anyhow::anyhow;
use reqwest::Client;
use rusqlite::params;
use tauri::{AppHandle, Emitter, State};
use url::Url;
use uuid::Uuid;

use crate::domain::writer_engine;
use crate::models::{
    AppSettings, BookProject, BranchNode, Chapter, CharacterCardV2, ChatMessage, ChatSendRequest, ChatSession,
    ConsistencyIssue, ProjectBundle, ProviderModel, ProviderProfile, ProviderProfileInput, RpSceneState, Scene,
    ValidationResult,
};
use crate::state::AppState;
use crate::storage;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn is_localhost_url(raw: &str) -> bool {
    if let Ok(url) = Url::parse(raw) {
        if let Some(host) = url.host_str() {
            return matches!(host, "localhost" | "127.0.0.1" | "::1");
        }
    }
    false
}

#[derive(serde::Deserialize)]
struct ModelsResponse {
    data: Vec<ModelItem>,
}

#[derive(serde::Deserialize)]
struct ModelItem {
    id: String,
}

#[derive(serde::Deserialize)]
struct ChatCompletionsChunk {
    choices: Vec<ChunkChoice>,
}

#[derive(serde::Deserialize)]
struct ChunkChoice {
    delta: Option<ChunkDelta>,
    message: Option<ChunkMessage>,
}

#[derive(serde::Deserialize)]
struct ChunkDelta {
    content: Option<String>,
}

#[derive(serde::Deserialize)]
struct ChunkMessage {
    content: Option<String>,
}

fn fetch_provider_row(
    conn: &rusqlite::Connection,
    provider_id: &str,
) -> Result<(String, String, Option<String>, bool), String> {
    conn.query_row(
        "SELECT base_url, api_key_cipher, proxy_url, full_local_only FROM providers WHERE id = ?1",
        params![provider_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)? == 1,
            ))
        },
    )
    .map_err(err)
}

#[tauri::command]
pub fn account_create(state: State<AppState>, password: String, recovery_key: Option<String>) -> Result<String, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let account_id = Uuid::new_v4().to_string();
    let password_hash = storage::hash_secret(&password);
    let recovery_hash = recovery_key.map(|k| storage::hash_secret(&k));
    conn.execute(
        "INSERT INTO accounts (id, password_hash, recovery_hash, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![account_id, password_hash, recovery_hash, storage::now()],
    )
    .map_err(err)?;
    Ok(account_id)
}

#[tauri::command]
pub fn account_unlock(state: State<AppState>, password: String, recovery_key: Option<String>) -> Result<bool, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let mut stmt = conn
        .prepare("SELECT password_hash, recovery_hash FROM accounts ORDER BY created_at DESC LIMIT 1")
        .map_err(err)?;
    let row = stmt
        .query_row([], |row| {
            let p: String = row.get(0)?;
            let r: Option<String> = row.get(1)?;
            Ok((p, r))
        })
        .map_err(err)?;

    let pass_ok = row.0 == storage::hash_secret(&password);
    let recovery_ok = match (row.1, recovery_key) {
        (Some(expected), Some(got)) => expected == storage::hash_secret(&got),
        _ => false,
    };

    Ok(pass_ok || recovery_ok)
}

#[tauri::command]
pub fn account_rotate_recovery_key(state: State<AppState>, new_recovery_key: String) -> Result<(), String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    conn.execute(
        "UPDATE accounts SET recovery_hash = ?1 WHERE id = (SELECT id FROM accounts ORDER BY created_at DESC LIMIT 1)",
        params![storage::hash_secret(&new_recovery_key)],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn settings_get(state: State<AppState>) -> Result<AppSettings, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    storage::read_settings(&conn).map_err(err)
}

#[tauri::command]
pub fn settings_update(state: State<AppState>, patch: serde_json::Value) -> Result<AppSettings, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let mut settings = storage::read_settings(&conn).map_err(err)?;

    if let Some(theme) = patch.get("theme").and_then(|v| v.as_str()) {
        settings.theme = theme.to_string();
    }
    if let Some(scale) = patch.get("fontScale").and_then(|v| v.as_f64()) {
        settings.font_scale = scale as f32;
    }
    if let Some(density) = patch.get("density").and_then(|v| v.as_str()) {
        settings.density = density.to_string();
    }
    if let Some(mode) = patch.get("censorshipMode").and_then(|v| v.as_str()) {
        settings.censorship_mode = mode.to_string();
    }
    if let Some(full_local) = patch.get("fullLocalMode").and_then(|v| v.as_bool()) {
        settings.full_local_mode = full_local;
    }
    if let Some(lang) = patch.get("responseLanguage").and_then(|v| v.as_str()) {
        settings.response_language = lang.to_string();
    }
    if let Some(active_provider_id) = patch.get("activeProviderId").and_then(|v| v.as_str()) {
        settings.active_provider_id = Some(active_provider_id.to_string());
    }
    if patch.get("activeProviderId").is_some() && patch.get("activeProviderId").unwrap().is_null() {
        settings.active_provider_id = None;
    }
    if let Some(active_model) = patch.get("activeModel").and_then(|v| v.as_str()) {
        settings.active_model = Some(active_model.to_string());
    }
    if patch.get("activeModel").is_some() && patch.get("activeModel").unwrap().is_null() {
        settings.active_model = None;
    }

    storage::write_settings(&conn, &settings).map_err(err)?;
    Ok(settings)
}

#[tauri::command]
pub fn settings_reset_defaults(state: State<AppState>) -> Result<AppSettings, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let defaults = AppSettings::default();
    storage::write_settings(&conn, &defaults).map_err(err)?;
    Ok(defaults)
}

#[tauri::command]
pub fn provider_upsert(state: State<AppState>, profile: ProviderProfileInput) -> Result<ProviderProfile, String> {
    if profile.full_local_only && !is_localhost_url(&profile.base_url) {
        return Err("Full local provider requires localhost base URL".to_string());
    }

    let conn = storage::open(state.db_path()).map_err(err)?;
    conn.execute(
        "INSERT INTO providers (id, name, base_url, api_key_cipher, proxy_url, full_local_only)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, base_url = excluded.base_url,
         api_key_cipher = excluded.api_key_cipher, proxy_url = excluded.proxy_url, full_local_only = excluded.full_local_only",
        params![
            profile.id,
            profile.name,
            profile.base_url,
            profile.api_key,
            profile.proxy_url,
            if profile.full_local_only { 1 } else { 0 }
        ],
    )
    .map_err(err)?;

    Ok(ProviderProfile {
        id: profile.id,
        name: profile.name,
        base_url: profile.base_url,
        api_key_masked: storage::mask_api_key(&profile.api_key),
        proxy_url: profile.proxy_url,
        full_local_only: profile.full_local_only,
    })
}

#[tauri::command]
pub fn provider_test_connection(state: State<AppState>, provider_id: String) -> Result<bool, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let row: (String, i64) = conn
        .query_row(
            "SELECT base_url, full_local_only FROM providers WHERE id = ?1",
            params![provider_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(err)?;

    if row.1 == 1 && !is_localhost_url(&row.0) {
        return Ok(false);
    }

    let settings = storage::read_settings(&conn).map_err(err)?;
    if settings.full_local_mode && !is_localhost_url(&row.0) {
        return Ok(false);
    }

    Ok(true)
}

#[tauri::command]
pub fn provider_list(state: State<AppState>) -> Result<Vec<ProviderProfile>, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let mut stmt = conn
        .prepare("SELECT id, name, base_url, api_key_cipher, proxy_url, full_local_only FROM providers ORDER BY name ASC")
        .map_err(err)?;

    let rows = stmt
        .query_map([], |row| {
            let api_key: String = row.get(3)?;
            Ok(ProviderProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                base_url: row.get(2)?,
                api_key_masked: storage::mask_api_key(&api_key),
                proxy_url: row.get(4)?,
                full_local_only: row.get::<_, i64>(5)? == 1,
            })
        })
        .map_err(err)?;

    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

#[tauri::command]
pub async fn provider_fetch_models(state: State<'_, AppState>, provider_id: String) -> Result<Vec<ProviderModel>, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let settings = storage::read_settings(&conn).map_err(err)?;
    let (base_url, api_key, _proxy, full_local_only) = fetch_provider_row(&conn, &provider_id)?;

    if full_local_only && !is_localhost_url(&base_url) {
        return Err("Provider is local-only but base URL is not localhost".to_string());
    }
    if settings.full_local_mode && !is_localhost_url(&base_url) {
        return Err("Full Local Mode blocks non-localhost provider".to_string());
    }

    let models_url = format!("{}/models", base_url.trim_end_matches('/'));
    let client = Client::new();
    let response = client
        .get(models_url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(err)?
        .error_for_status()
        .map_err(err)?;

    let payload: ModelsResponse = response.json().await.map_err(err)?;
    Ok(payload
        .data
        .into_iter()
        .map(|m| ProviderModel { id: m.id })
        .collect())
}

#[tauri::command]
pub fn provider_set_active(state: State<AppState>, provider_id: String, model_id: String) -> Result<AppSettings, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let _ = fetch_provider_row(&conn, &provider_id)?;
    let mut settings = storage::read_settings(&conn).map_err(err)?;
    settings.active_provider_id = Some(provider_id);
    settings.active_model = Some(model_id);
    storage::write_settings(&conn, &settings).map_err(err)?;
    Ok(settings)
}

#[tauri::command]
pub fn chat_create(state: State<AppState>, title: String) -> Result<ChatSession, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let chat = ChatSession {
        id: Uuid::new_v4().to_string(),
        title,
        created_at: storage::now(),
    };

    let root_branch_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO chats (id, title, created_at) VALUES (?1, ?2, ?3)",
        params![chat.id, chat.title, chat.created_at],
    )
    .map_err(err)?;

    conn.execute(
        "INSERT INTO branches (id, chat_id, name, parent_message_id, created_at) VALUES (?1, ?2, ?3, NULL, ?4)",
        params![root_branch_id, chat.id, "main", storage::now()],
    )
    .map_err(err)?;

    Ok(chat)
}

#[tauri::command]
pub fn chat_list(state: State<AppState>) -> Result<Vec<ChatSession>, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let mut stmt = conn
        .prepare("SELECT id, title, created_at FROM chats ORDER BY created_at DESC")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ChatSession {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(err)?;

    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

fn resolve_branch(conn: &rusqlite::Connection, chat_id: &str, branch_id: Option<String>) -> Result<String, String> {
    if let Some(id) = branch_id {
        return Ok(id);
    }

    conn.query_row(
        "SELECT id FROM branches WHERE chat_id = ?1 ORDER BY created_at ASC LIMIT 1",
        params![chat_id],
        |row| row.get(0),
    )
    .map_err(err)
}

#[tauri::command]
pub fn chat_get_timeline(state: State<AppState>, chat_id: String, branch_id: Option<String>) -> Result<Vec<ChatMessage>, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let branch_id = resolve_branch(&conn, &chat_id, branch_id)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, chat_id, branch_id, role, content, token_count, created_at, parent_id
             FROM messages WHERE chat_id = ?1 AND branch_id = ?2 AND deleted = 0 ORDER BY created_at ASC",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map(params![chat_id, branch_id], |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                branch_id: row.get(2)?,
                role: row.get(3)?,
                content: row.get(4)?,
                token_count: row.get(5)?,
                created_at: row.get(6)?,
                parent_id: row.get(7)?,
            })
        })
        .map_err(err)?;

    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

#[tauri::command]
pub async fn chat_send(
    state: State<'_, AppState>,
    app: AppHandle,
    req: ChatSendRequest,
) -> Result<Vec<ChatMessage>, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let chat_id = req.chat_id;
    let content = req.content;
    let branch_id = resolve_branch(&conn, &chat_id, req.branch_id)?;

    let user_id = Uuid::new_v4().to_string();
    let assistant_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO messages (id, chat_id, branch_id, role, content, token_count, parent_id, deleted, created_at)
         VALUES (?1, ?2, ?3, 'user', ?4, ?5, NULL, 0, ?6)",
        params![
            user_id,
            chat_id.clone(),
            branch_id.clone(),
            content.clone(),
            storage::rough_token_count(&content),
            storage::now()
        ],
    )
    .map_err(err)?;

    let settings = storage::read_settings(&conn).map_err(err)?;
    let provider_id = settings
        .active_provider_id
        .clone()
        .ok_or_else(|| "No active provider selected in settings".to_string())?;
    let model = settings
        .active_model
        .clone()
        .ok_or_else(|| "No active model selected in settings".to_string())?;

    let (base_url, api_key, _proxy, full_local_only) = fetch_provider_row(&conn, &provider_id)?;
    if full_local_only && !is_localhost_url(&base_url) {
        return Err("Selected provider is local-only but base URL is not localhost".to_string());
    }
    if settings.full_local_mode && !is_localhost_url(&base_url) {
        return Err("Full Local Mode blocks non-localhost provider".to_string());
    }

    let timeline = chat_get_timeline(state.clone(), chat_id.clone(), Some(branch_id.clone()))?;
    let mut api_messages = Vec::new();
    api_messages.push(serde_json::json!({
        "role": "system",
        "content": "You are an immersive RP assistant. Keep continuity and character consistency."
    }));
    for m in timeline {
        api_messages.push(serde_json::json!({
            "role": m.role,
            "content": m.content
        }));
    }

    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "stream": true,
        "messages": api_messages,
        "temperature": 0.9
    });

    let client = Client::new();
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(err)?
        .error_for_status()
        .map_err(err)?;

    let mut assistant_text = String::new();
    let mut buffer = String::new();
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;

    while let Some(next) = stream.next().await {
        let chunk = next.map_err(err)?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[pos + 1..].to_string();
            if !line.starts_with("data: ") {
                continue;
            }
            let data = &line[6..];
            if data == "[DONE]" {
                break;
            }
            let parsed: Result<ChatCompletionsChunk, _> = serde_json::from_str(data);
            if let Ok(payload) = parsed {
                for choice in payload.choices {
                    if let Some(delta) = choice.delta.and_then(|d| d.content) {
                        assistant_text.push_str(&delta);
                        app.emit(
                            "chat_stream_delta",
                            serde_json::json!({ "chatId": chat_id.clone(), "branchId": branch_id.clone(), "delta": delta }),
                        )
                        .map_err(err)?;
                    } else if let Some(message) = choice.message.and_then(|m| m.content) {
                        assistant_text.push_str(&message);
                        app.emit(
                            "chat_stream_delta",
                            serde_json::json!({ "chatId": chat_id.clone(), "branchId": branch_id.clone(), "delta": message }),
                        )
                        .map_err(err)?;
                    }
                }
            }
        }
    }

    if assistant_text.trim().is_empty() {
        return Err(anyhow!("Provider returned empty streamed content").to_string());
    }

    conn.execute(
        "INSERT INTO messages (id, chat_id, branch_id, role, content, token_count, parent_id, deleted, created_at)
         VALUES (?1, ?2, ?3, 'assistant', ?4, ?5, ?6, 0, ?7)",
        params![
            assistant_id,
            chat_id.clone(),
            branch_id.clone(),
            assistant_text,
            storage::rough_token_count(&assistant_text),
            user_id,
            storage::now()
        ],
    )
    .map_err(err)?;

    app.emit(
        "chat_stream_done",
        serde_json::json!({ "chatId": chat_id.clone(), "branchId": branch_id.clone(), "messageId": assistant_id }),
    )
    .map_err(err)?;

    chat_get_timeline(state, chat_id, Some(branch_id))
}

#[tauri::command]
pub fn chat_edit_message(state: State<AppState>, message_id: String, content: String) -> Result<(), String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    conn.execute(
        "UPDATE messages SET content = ?1, token_count = ?2 WHERE id = ?3",
        params![content.clone(), storage::rough_token_count(&content), message_id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn chat_delete_message(state: State<AppState>, message_id: String) -> Result<(), String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    conn.execute("UPDATE messages SET deleted = 1 WHERE id = ?1", params![message_id])
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn chat_regenerate(state: State<AppState>, chat_id: String, branch_id: Option<String>) -> Result<Vec<ChatMessage>, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let branch_id = resolve_branch(&conn, &chat_id, branch_id)?;

    let (last_user_id, last_user_content): (String, String) = conn
        .query_row(
            "SELECT id, content FROM messages
             WHERE chat_id = ?1 AND branch_id = ?2 AND role = 'user' AND deleted = 0
             ORDER BY created_at DESC LIMIT 1",
            params![chat_id, branch_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(err)?;

    let regenerated = format!("[Regenerated] {}", last_user_content);
    conn.execute(
        "INSERT INTO messages (id, chat_id, branch_id, role, content, token_count, parent_id, deleted, created_at)
         VALUES (?1, ?2, ?3, 'assistant', ?4, ?5, ?6, 0, ?7)",
        params![
            Uuid::new_v4().to_string(),
            chat_id,
            branch_id,
            regenerated,
            storage::rough_token_count(&regenerated),
            last_user_id,
            storage::now()
        ],
    )
    .map_err(err)?;

    chat_get_timeline(state, chat_id, Some(branch_id))
}

#[tauri::command]
pub fn chat_fork_branch(
    state: State<AppState>,
    chat_id: String,
    parent_message_id: String,
    name: String,
) -> Result<BranchNode, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let branch = BranchNode {
        id: Uuid::new_v4().to_string(),
        chat_id,
        name,
        parent_message_id: Some(parent_message_id),
        created_at: storage::now(),
    };

    conn.execute(
        "INSERT INTO branches (id, chat_id, name, parent_message_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            branch.id,
            branch.chat_id,
            branch.name,
            branch.parent_message_id,
            branch.created_at
        ],
    )
    .map_err(err)?;

    Ok(branch)
}

#[tauri::command]
pub fn chat_compress_context(state: State<AppState>, chat_id: String, branch_id: Option<String>) -> Result<String, String> {
    let messages = chat_get_timeline(state, chat_id, branch_id)?;
    let summary = messages
        .iter()
        .rev()
        .take(8)
        .map(|m| format!("{}: {}", m.role, m.content.lines().next().unwrap_or_default()))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(summary)
}

#[tauri::command]
pub fn rp_set_scene_state(state: State<AppState>, scene_state: RpSceneState) -> Result<(), String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let payload = serde_json::to_string(&scene_state).map_err(err)?;
    conn.execute(
        "INSERT INTO rp_scene_state (chat_id, payload, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(chat_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        params![scene_state.chat_id, payload, storage::now()],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn rp_update_author_note(state: State<AppState>, chat_id: String, author_note: String) -> Result<(), String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    conn.execute(
        "INSERT INTO rp_memory_entries (id, chat_id, role, content, created_at) VALUES (?1, ?2, 'author_note', ?3, ?4)",
        params![Uuid::new_v4().to_string(), chat_id, author_note, storage::now()],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn rp_apply_style_preset(state: State<AppState>, chat_id: String, preset_id: String) -> Result<(), String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let payload = serde_json::json!({ "chatId": chat_id, "presetId": preset_id });
    conn.execute(
        "INSERT INTO rp_presets (id, name, payload, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![Uuid::new_v4().to_string(), "active", payload.to_string(), storage::now()],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn character_validate_v2(raw_json: String) -> Result<ValidationResult, String> {
    let mut errors = Vec::new();
    let parsed: serde_json::Value = match serde_json::from_str(&raw_json) {
        Ok(v) => v,
        Err(e) => {
            return Ok(ValidationResult {
                valid: false,
                errors: vec![format!("Invalid JSON: {e}")],
            })
        }
    };

    if parsed.get("spec").and_then(|v| v.as_str()) != Some("chara_card_v2") {
        errors.push("spec must be chara_card_v2".to_string());
    }
    if parsed.get("data").is_none() {
        errors.push("missing data object".to_string());
    }

    Ok(ValidationResult {
        valid: errors.is_empty(),
        errors,
    })
}

#[tauri::command]
pub fn character_import_v2(state: State<AppState>, raw_json: String) -> Result<CharacterCardV2, String> {
    let validation = character_validate_v2(raw_json.clone())?;
    if !validation.valid {
        return Err(format!("validation errors: {:?}", validation.errors));
    }

    let card: CharacterCardV2 = serde_json::from_str(&raw_json).map_err(err)?;
    let name = card
        .data
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Unnamed")
        .to_string();

    let conn = storage::open(state.db_path()).map_err(err)?;
    conn.execute(
        "INSERT INTO characters (id, name, card_json, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![Uuid::new_v4().to_string(), name, raw_json, storage::now()],
    )
    .map_err(err)?;

    Ok(card)
}

#[tauri::command]
pub fn character_export_v2(state: State<AppState>, character_id: String) -> Result<CharacterCardV2, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let raw: String = conn
        .query_row("SELECT card_json FROM characters WHERE id = ?1", params![character_id], |row| row.get(0))
        .map_err(err)?;

    serde_json::from_str(&raw).map_err(err)
}

#[tauri::command]
pub fn character_upsert(state: State<AppState>, id: Option<String>, raw_json: String) -> Result<String, String> {
    let card: CharacterCardV2 = serde_json::from_str(&raw_json).map_err(err)?;
    let name = card
        .data
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Unnamed")
        .to_string();
    let character_id = id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let conn = storage::open(state.db_path()).map_err(err)?;
    conn.execute(
        "INSERT INTO characters (id, name, card_json, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, card_json = excluded.card_json",
        params![character_id, name, raw_json, storage::now()],
    )
    .map_err(err)?;
    Ok(character_id)
}

#[tauri::command]
pub fn writer_project_create(state: State<AppState>, name: String, description: String) -> Result<BookProject, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let project = BookProject {
        id: Uuid::new_v4().to_string(),
        name,
        description,
        created_at: storage::now(),
    };
    conn.execute(
        "INSERT INTO writer_projects (id, name, description, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![project.id, project.name, project.description, project.created_at],
    )
    .map_err(err)?;
    Ok(project)
}

#[tauri::command]
pub fn writer_project_list(state: State<AppState>) -> Result<Vec<BookProject>, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let mut stmt = conn
        .prepare("SELECT id, name, description, created_at FROM writer_projects ORDER BY created_at DESC")
        .map_err(err)?;

    let rows = stmt
        .query_map([], |row| {
            Ok(BookProject {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(err)?;

    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

#[tauri::command]
pub fn writer_project_open(state: State<AppState>, project_id: String) -> Result<ProjectBundle, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;

    let project = conn
        .query_row(
            "SELECT id, name, description, created_at FROM writer_projects WHERE id = ?1",
            params![project_id],
            |row| {
                Ok(BookProject {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .map_err(err)?;

    let mut chapter_stmt = conn
        .prepare(
            "SELECT id, project_id, title, position, created_at FROM writer_chapters WHERE project_id = ?1 ORDER BY position ASC",
        )
        .map_err(err)?;
    let chapters = chapter_stmt
        .query_map(params![project_id], |row| {
            Ok(Chapter {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                position: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;

    let mut scene_stmt = conn
        .prepare(
            "SELECT s.id, s.chapter_id, s.title, s.content, s.goals, s.conflicts, s.outcomes, s.created_at
             FROM writer_scenes s INNER JOIN writer_chapters c ON s.chapter_id = c.id
             WHERE c.project_id = ?1 ORDER BY s.created_at ASC",
        )
        .map_err(err)?;

    let scenes = scene_stmt
        .query_map(params![project_id], |row| {
            Ok(Scene {
                id: row.get(0)?,
                chapter_id: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                goals: row.get(4)?,
                conflicts: row.get(5)?,
                outcomes: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;

    Ok(ProjectBundle {
        project,
        chapters,
        scenes,
    })
}

#[tauri::command]
pub fn writer_chapter_create(state: State<AppState>, project_id: String, title: String) -> Result<Chapter, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let position = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM writer_chapters WHERE project_id = ?1",
            params![project_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(err)?;

    let chapter = Chapter {
        id: Uuid::new_v4().to_string(),
        project_id,
        title,
        position,
        created_at: storage::now(),
    };

    conn.execute(
        "INSERT INTO writer_chapters (id, project_id, title, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![chapter.id, chapter.project_id, chapter.title, chapter.position, chapter.created_at],
    )
    .map_err(err)?;

    Ok(chapter)
}

#[tauri::command]
pub fn writer_chapter_reorder(state: State<AppState>, project_id: String, ordered_ids: Vec<String>) -> Result<(), String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    for (idx, chapter_id) in ordered_ids.iter().enumerate() {
        conn.execute(
            "UPDATE writer_chapters SET position = ?1 WHERE id = ?2 AND project_id = ?3",
            params![idx as i64 + 1, chapter_id, project_id],
        )
        .map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn writer_chapter_generate_draft(
    state: State<AppState>,
    app: AppHandle,
    chapter_id: String,
    prompt: String,
) -> Result<Scene, String> {
    let scene = Scene {
        id: Uuid::new_v4().to_string(),
        chapter_id,
        title: "Generated Draft".to_string(),
        content: format!("Draft generated from prompt:\n\n{}", prompt),
        goals: "Advance plot".to_string(),
        conflicts: "Internal conflict".to_string(),
        outcomes: "Open ending".to_string(),
        created_at: storage::now(),
    };

    let conn = storage::open(state.db_path()).map_err(err)?;
    conn.execute(
        "INSERT INTO writer_scenes (id, chapter_id, title, content, goals, conflicts, outcomes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            scene.id,
            scene.chapter_id,
            scene.title,
            scene.content,
            scene.goals,
            scene.conflicts,
            scene.outcomes,
            scene.created_at
        ],
    )
    .map_err(err)?;

    app.emit("writer_generation_delta", serde_json::json!({ "chunk": "Draft started..." }))
        .map_err(err)?;
    app.emit("writer_generation_done", serde_json::json!({ "sceneId": scene.id }))
        .map_err(err)?;

    Ok(scene)
}

#[tauri::command]
pub fn writer_scene_expand(state: State<AppState>, app: AppHandle, scene_id: String) -> Result<Scene, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let mut scene: Scene = conn
        .query_row(
            "SELECT id, chapter_id, title, content, goals, conflicts, outcomes, created_at FROM writer_scenes WHERE id = ?1",
            params![scene_id],
            |row| {
                Ok(Scene {
                    id: row.get(0)?,
                    chapter_id: row.get(1)?,
                    title: row.get(2)?,
                    content: row.get(3)?,
                    goals: row.get(4)?,
                    conflicts: row.get(5)?,
                    outcomes: row.get(6)?,
                    created_at: row.get(7)?,
                })
            },
        )
        .map_err(err)?;

    scene.content = format!("{}\n\nExpanded details and sensory beats.", scene.content);
    conn.execute(
        "UPDATE writer_scenes SET content = ?1 WHERE id = ?2",
        params![scene.content, scene.id],
    )
    .map_err(err)?;

    app.emit("writer_generation_delta", serde_json::json!({ "chunk": "Expanded scene" }))
        .map_err(err)?;
    app.emit("writer_generation_done", serde_json::json!({ "sceneId": scene.id }))
        .map_err(err)?;

    Ok(scene)
}

#[tauri::command]
pub fn writer_scene_rewrite(
    state: State<AppState>,
    app: AppHandle,
    scene_id: String,
    style_profile: Option<HashMap<String, String>>,
) -> Result<Scene, String> {
    let tone = style_profile
        .as_ref()
        .and_then(|m| m.get("tone"))
        .cloned()
        .unwrap_or_else(|| "neutral".to_string());
    let conn = storage::open(state.db_path()).map_err(err)?;
    let mut scene: Scene = conn
        .query_row(
            "SELECT id, chapter_id, title, content, goals, conflicts, outcomes, created_at FROM writer_scenes WHERE id = ?1",
            params![scene_id],
            |row| {
                Ok(Scene {
                    id: row.get(0)?,
                    chapter_id: row.get(1)?,
                    title: row.get(2)?,
                    content: row.get(3)?,
                    goals: row.get(4)?,
                    conflicts: row.get(5)?,
                    outcomes: row.get(6)?,
                    created_at: row.get(7)?,
                })
            },
        )
        .map_err(err)?;
    scene.content = format!("[Tone: {}]\n{}", tone, scene.content);
    conn.execute("UPDATE writer_scenes SET content = ?1 WHERE id = ?2", params![scene.content, scene.id])
        .map_err(err)?;
    app.emit("writer_generation_done", serde_json::json!({ "sceneId": scene.id }))
        .map_err(err)?;
    Ok(scene)
}

#[tauri::command]
pub fn writer_scene_summarize(state: State<AppState>, scene_id: String) -> Result<String, String> {
    let conn = storage::open(state.db_path()).map_err(err)?;
    let content: String = conn
        .query_row(
            "SELECT content FROM writer_scenes WHERE id = ?1",
            params![scene_id],
            |row| row.get(0),
        )
        .map_err(err)?;

    Ok(content.lines().take(3).collect::<Vec<_>>().join(" "))
}

#[tauri::command]
pub fn writer_consistency_run_check(
    state: State<AppState>,
    app: AppHandle,
    project_id: String,
) -> Result<Vec<ConsistencyIssue>, String> {
    let bundle = writer_project_open(state.clone(), project_id.clone())?;
    let issues = writer_engine::run_consistency(&project_id, &bundle.scenes);
    let conn = storage::open(state.db_path()).map_err(err)?;

    let payload = serde_json::to_string(&issues).map_err(err)?;
    conn.execute(
        "INSERT INTO writer_consistency_reports (id, project_id, payload, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![Uuid::new_v4().to_string(), project_id, payload, storage::now()],
    )
    .map_err(err)?;

    app.emit("writer_consistency_report_ready", serde_json::json!({ "issues": issues }))
        .map_err(err)?;

    Ok(issues)
}

#[tauri::command]
pub fn writer_export_markdown(state: State<AppState>, project_id: String) -> Result<String, String> {
    let bundle = writer_project_open(state.clone(), project_id.clone())?;
    let output_path = state.base_dir().join(format!("book-{}.md", project_id));
    let mut out = format!("# {}\n\n{}\n\n", bundle.project.name, bundle.project.description);

    for chapter in bundle.chapters {
        out.push_str(&format!("## {}\n\n", chapter.title));
        for scene in bundle.scenes.iter().filter(|s| s.chapter_id == chapter.id) {
            out.push_str(&format!("### {}\n\n{}\n\n", scene.title, scene.content));
        }
    }

    fs::write(&output_path, out)
        .with_context(|| format!("failed to write markdown export at {}", output_path.display()))
        .map_err(err)?;

    let conn = storage::open(state.db_path()).map_err(err)?;
    conn.execute(
        "INSERT INTO writer_exports (id, project_id, export_type, output_path, created_at) VALUES (?1, ?2, 'markdown', ?3, ?4)",
        params![Uuid::new_v4().to_string(), project_id, output_path.display().to_string(), storage::now()],
    )
    .map_err(err)?;

    Ok(output_path.display().to_string())
}

#[tauri::command]
pub fn writer_export_docx(state: State<AppState>, project_id: String) -> Result<String, String> {
    let markdown = writer_export_markdown(state.clone(), project_id.clone())?;
    let docx_path = state.base_dir().join(format!("book-{}.docx", project_id));
    let md = fs::read_to_string(&markdown).map_err(err)?;
    fs::write(&docx_path, md).map_err(err)?;

    let conn = storage::open(state.db_path()).map_err(err)?;
    conn.execute(
        "INSERT INTO writer_exports (id, project_id, export_type, output_path, created_at) VALUES (?1, ?2, 'docx', ?3, ?4)",
        params![Uuid::new_v4().to_string(), project_id, docx_path.display().to_string(), storage::now()],
    )
    .map_err(err)?;

    Ok(docx_path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_mode_gate_allows_only_localhost() {
        assert!(is_localhost_url("http://localhost:11434/v1"));
        assert!(is_localhost_url("http://127.0.0.1:1234"));
        assert!(!is_localhost_url("https://api.openai.com/v1"));
    }

    #[test]
    fn prompt_orchestration_is_stable() {
        let blocks = vec![
            crate::models::PromptBlock {
                id: "2".into(),
                kind: "history".into(),
                enabled: true,
                order: 2,
                content: "H".into(),
            },
            crate::models::PromptBlock {
                id: "1".into(),
                kind: "system".into(),
                enabled: true,
                order: 1,
                content: "S".into(),
            },
        ];

        let composed = crate::domain::rp_engine::compose_prompt(blocks);
        assert_eq!(composed[0].id, "1");
        assert_eq!(composed[1].id, "2");
    }

    #[test]
    fn sample_chara_card_fixture_validates() {
        let fixture = include_str!("../../main_this-is-our-spot-leave-5070bac83080_spec_v2.json");
        let result = character_validate_v2(fixture.to_string()).expect("validation should not fail");
        assert!(result.valid);
    }
}
