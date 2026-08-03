mod schema;
mod sessions;
mod settings;

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub use sessions::{
    count_sessions, delete_all_sessions, delete_session, list_export_sessions,
    list_profile_sessions, list_sessions, load_session, reconcile_interrupted_sessions,
    upsert_session, HistoryQuery,
};
pub use settings::{load_settings_json, save_settings_json};

pub struct DbState {
    pub conn: Mutex<Connection>,
}

pub fn open_db(app: &AppHandle) -> Result<DbState, String> {
    let path = db_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(&path).map_err(|e| format!("打开 SQLite 失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .map_err(|e| e.to_string())?;
    schema::migrate(&conn)?;
    Ok(DbState {
        conn: Mutex::new(conn),
    })
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    Ok(base.join("expr-talk.sqlite"))
}
