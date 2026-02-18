use anyhow::Result;
use std::path::{Path, PathBuf};

use crate::storage;

#[derive(Clone)]
pub struct AppState {
    base_dir: PathBuf,
    db_path: PathBuf,
}

impl AppState {
    pub fn new(base_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&base_dir)?;
        let vellum_db_path = base_dir.join("vellum.db");
        let legacy_db_path = base_dir.join("sillytauri.db");
        let db_path = if vellum_db_path.exists() {
            vellum_db_path
        } else if legacy_db_path.exists() {
            legacy_db_path
        } else {
            vellum_db_path
        };
        storage::init_db(&db_path)?;
        Ok(Self { base_dir, db_path })
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }
}
