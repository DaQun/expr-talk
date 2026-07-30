use crate::db::{load_settings_json, save_settings_json, DbState};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn settings_get(state: State<'_, DbState>) -> Result<Option<Value>, String> {
    match load_settings_json(&state)? {
        Some(s) => {
            let v: Value = serde_json::from_str(&s).map_err(|e| e.to_string())?;
            Ok(Some(v))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn settings_save(state: State<'_, DbState>, settings: Value) -> Result<(), String> {
    let s = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    save_settings_json(&state, &s)
}
