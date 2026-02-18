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
        let db_path = base_dir.join("sillytauri.db");
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
