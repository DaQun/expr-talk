use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub mode: String,
    pub topic: String,
    pub goal: String,
    pub parent_session_id: Option<String>,
    pub round: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingSessionDto {
    pub id: String,
    pub mode: String,
    pub topic: String,
    pub goal: String,
    pub status: String,
    pub started_at: String,
    pub live_transcript: Vec<Value>,
    pub parent_session_id: Option<String>,
    pub round: Option<u32>,
}

fn now_iso() -> String {
    // 无 chrono 依赖时用简单占位；后续可换 chrono / time
    format!("{}", js_sys_now_fallback())
}

fn js_sys_now_fallback() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("unix-ms-{ms}")
}

#[tauri::command]
pub fn session_create(input: CreateSessionInput) -> TrainingSessionDto {
    let id = format!("ses_{}", &uuid_like());
    TrainingSessionDto {
        id,
        mode: input.mode,
        topic: input.topic,
        goal: input.goal,
        status: "created".into(),
        started_at: now_iso(),
        live_transcript: vec![],
        parent_session_id: input.parent_session_id,
        round: input.round,
    }
}

#[tauri::command]
pub fn session_start_recording(id: String) -> Result<(), String> {
    if id.is_empty() {
        return Err("empty session id".into());
    }
    // 真实实现：打开麦克风流 / 启动 ASR session
    Ok(())
}

#[tauri::command]
pub fn session_stop_recording(
    id: String,
    final_transcript: Option<String>,
) -> Result<Value, String> {
    if id.is_empty() {
        return Err("empty session id".into());
    }
    Ok(json!({
        "id": id,
        "status": "analyzing",
        "finalTranscript": final_transcript.unwrap_or_default(),
        "liveTranscript": [],
        "endedAt": now_iso(),
    }))
}

#[tauri::command]
pub fn session_analyze(id: String) -> Result<Value, String> {
    if id.is_empty() {
        return Err("empty session id".into());
    }
    // 分析应优先在 TS core 完成；Rust 侧后续做重计算/本地模型
    Ok(json!({
        "schemaVersion": 1,
        "summary": "Rust session_analyze 占位：请使用前端 core 规则报告路径。",
        "scores": { "clarity": 0 },
        "topIssues": [],
        "sentenceFeedback": [],
        "rewriteExamples": [],
        "nextPractice": {
            "targetIssue": "too_many_fillers",
            "instruction": "占位",
            "retryPrompt": "占位",
            "successCriteria": []
        }
    }))
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{ms:x}")
}
