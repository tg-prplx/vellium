#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod domain;
mod models;
mod state;
mod storage;

use anyhow::Result;
#[cfg(not(test))]
use state::AppState;
#[cfg(not(test))]
use tauri::Manager;

fn main() {
    if let Err(err) = run() {
        eprintln!("failed to launch app: {err:#}");
    }
}

#[cfg(not(test))]
fn run() -> Result<()> {
    tauri::Builder::default()
        .setup(|app| {
            let base_dir = app.path().app_data_dir()?;
            let state = AppState::new(base_dir)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::account_create,
            commands::account_unlock,
            commands::account_rotate_recovery_key,
            commands::settings_get,
            commands::settings_update,
            commands::settings_reset_defaults,
            commands::provider_upsert,
            commands::provider_list,
            commands::provider_fetch_models,
            commands::provider_set_active,
            commands::provider_test_connection,
            commands::chat_create,
            commands::chat_list,
            commands::chat_get_timeline,
            commands::chat_send,
            commands::chat_edit_message,
            commands::chat_delete_message,
            commands::chat_regenerate,
            commands::chat_fork_branch,
            commands::chat_compress_context,
            commands::rp_set_scene_state,
            commands::rp_update_author_note,
            commands::rp_apply_style_preset,
            commands::character_import_v2,
            commands::character_export_v2,
            commands::character_validate_v2,
            commands::character_upsert,
            commands::writer_project_create,
            commands::writer_project_list,
            commands::writer_project_open,
            commands::writer_chapter_create,
            commands::writer_chapter_reorder,
            commands::writer_chapter_generate_draft,
            commands::writer_scene_expand,
            commands::writer_scene_rewrite,
            commands::writer_scene_summarize,
            commands::writer_consistency_run_check,
            commands::writer_export_markdown,
            commands::writer_export_docx
        ])
        .run(tauri::generate_context!())?;
    Ok(())
}

#[cfg(test)]
fn run() -> Result<()> {
    Ok(())
}
