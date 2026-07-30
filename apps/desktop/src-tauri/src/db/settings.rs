use super::DbState;
use rusqlite::params;
use tauri::State;

const SETTINGS_KEY: &str = "app";

pub fn load_settings_json(state: &State<'_, DbState>) -> Result<Option<String>, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "db lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare("SELECT value_json FROM settings WHERE key = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(params![SETTINGS_KEY])
        .map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let v: String = row.get(0).map_err(|e| e.to_string())?;
        Ok(Some(v))
    } else {
        Ok(None)
    }
}

pub fn save_settings_json(state: &State<'_, DbState>, value_json: &str) -> Result<(), String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "db lock poisoned".to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".into());
    conn.execute(
        r#"
INSERT INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)
ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
"#,
        params![SETTINGS_KEY, value_json, now],
    )
    .map_err(|e| format!("save settings: {e}"))?;
    Ok(())
}
