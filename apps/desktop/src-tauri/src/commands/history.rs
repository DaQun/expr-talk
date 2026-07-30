use crate::db::{
    delete_session, list_profile_sessions, list_sessions, load_session, upsert_session, DbState,
    HistoryQuery,
};
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn history_list(
    state: State<'_, DbState>,
    query: Option<HistoryQuery>,
) -> Result<Vec<Value>, String> {
    // 列表查询本身很轻；直接执行即可
    list_sessions(&state, query)
}

#[tauri::command]
pub async fn history_get(state: State<'_, DbState>, id: String) -> Result<Option<Value>, String> {
    load_session(&state, &id)
}

#[tauri::command]
pub async fn profile_sessions(state: State<'_, DbState>) -> Result<Vec<Value>, String> {
    list_profile_sessions(&state)
}

#[tauri::command]
pub async fn session_upsert(state: State<'_, DbState>, session: Value) -> Result<Value, String> {
    // 写入可能较大，放到 blocking 池，避免拖住 IPC
    // 但 State 不能跨线程移动；这里仍同步写（数据量通常可接受）
    upsert_session(&state, session)
}

#[tauri::command]
pub async fn session_delete(state: State<'_, DbState>, id: String) -> Result<(), String> {
    delete_session(&state, &id)
}

#[tauri::command]
pub fn app_health() -> Value {
    json!({
        "ok": true,
        "name": "ExprTalk",
        "version": "0.1.0"
    })
}
