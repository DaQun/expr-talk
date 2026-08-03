use super::DbState;
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    pub mode: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub search: Option<String>,
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    format_unix_iso(secs)
}

/// 将前端 TrainingSession JSON 原样 upsert
pub fn upsert_session(state: &DbState, session: Value) -> Result<Value, String> {
    let id = session
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("session.id required")?
        .to_string();
    let mode = session
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("meeting")
        .to_string();
    let topic = session
        .get("topic")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let goal = match session.get("goal") {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    };
    let status = session
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("created")
        .to_string();
    let started_at = session
        .get("startedAt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let ended_at = session
        .get("endedAt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let duration_sec = session.get("durationSec").and_then(|v| v.as_i64());
    let input_source = session
        .get("inputSource")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let audio_path = session
        .get("audioFile")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let live_transcript = session
        .get("liveTranscript")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let final_transcript = session
        .get("finalTranscript")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let metrics_json = session.get("metrics").cloned();
    let report_json = session.get("report").cloned();
    let debate_json = session.get("debate").cloned();
    let comparison_json = session.get("comparison").cloned();
    let comparison_improved = session
        .get("comparison")
        .and_then(|c| c.get("improved"))
        .and_then(|v| v.as_bool())
        .map(|b| if b { 1i64 } else { 0i64 });
    let parent_session_id = session
        .get("parentSessionId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let round = session.get("round").and_then(|v| v.as_i64());
    let target_issue = session
        .get("targetIssue")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let failure_reason = session
        .get("failureReason")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let filler_count = session
        .get("metrics")
        .and_then(|m| m.get("fillerCount"))
        .and_then(|v| v.as_i64());

    let updated_at = now_iso();
    let conn = state
        .conn
        .lock()
        .map_err(|_| "db lock poisoned".to_string())?;

    let created_at: String = conn
        .query_row(
            "SELECT created_at FROM sessions WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| updated_at.clone());

    conn.execute(
        r#"
INSERT INTO sessions (
  id, mode, topic, goal, status, started_at, ended_at, duration_sec, input_source, audio_path,
  live_transcript, final_transcript, metrics_json, report_json, debate_json, comparison_json,
  parent_session_id, round, filler_count, comparison_improved, created_at, updated_at,
  target_issue, failure_reason
) VALUES (
  ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24
)
ON CONFLICT(id) DO UPDATE SET
  mode=excluded.mode,
  topic=excluded.topic,
  goal=excluded.goal,
  status=excluded.status,
  started_at=excluded.started_at,
  ended_at=excluded.ended_at,
  duration_sec=excluded.duration_sec,
  input_source=excluded.input_source,
  audio_path=excluded.audio_path,
  live_transcript=excluded.live_transcript,
  final_transcript=excluded.final_transcript,
  metrics_json=excluded.metrics_json,
  report_json=excluded.report_json,
  debate_json=excluded.debate_json,
  comparison_json=excluded.comparison_json,
  parent_session_id=excluded.parent_session_id,
  round=excluded.round,
  filler_count=excluded.filler_count,
  comparison_improved=excluded.comparison_improved,
  target_issue=excluded.target_issue,
  failure_reason=excluded.failure_reason,
  updated_at=excluded.updated_at
"#,
        params![
            id,
            mode,
            topic,
            goal,
            status,
            started_at,
            ended_at,
            duration_sec,
            input_source,
            audio_path,
            live_transcript.to_string(),
            final_transcript,
            metrics_json.map(|v| v.to_string()),
            report_json.map(|v| v.to_string()),
            debate_json.map(|v| v.to_string()),
            comparison_json.map(|v| v.to_string()),
            parent_session_id,
            round,
            filler_count,
            comparison_improved,
            created_at,
            updated_at,
            target_issue,
            failure_reason,
        ],
    )
    .map_err(|e| format!("upsert session: {e}"))?;

    // load_session 会再次获取同一把 Mutex；必须先释放连接锁，避免自锁。
    drop(conn);
    load_session(state, &id)?.ok_or_else(|| "upsert succeeded but load failed".into())
}

pub fn load_session(state: &DbState, id: &str) -> Result<Option<Value>, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "db lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            r#"
SELECT id, mode, topic, goal, status, started_at, ended_at, duration_sec, input_source, audio_path,
       live_transcript, final_transcript, metrics_json, report_json, debate_json,
       parent_session_id, round, comparison_json, target_issue, failure_reason
FROM sessions WHERE id = ?1
"#,
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt.query(params![id]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(Some(row_to_session_full(row)?))
    } else {
        Ok(None)
    }
}

/// 列表专用：只读摘要列，禁止读 transcript / report / 完整 metrics
pub fn list_sessions(state: &DbState, query: Option<HistoryQuery>) -> Result<Vec<Value>, String> {
    let q = query.unwrap_or(HistoryQuery {
        mode: None,
        limit: Some(30),
        offset: Some(0),
        search: None,
    });
    let limit = q.limit.unwrap_or(30).min(50);
    let offset = q.offset.unwrap_or(0);

    let conn = state
        .conn
        .lock()
        .map_err(|_| "db lock poisoned".to_string())?;
    let mut sql = String::from(
        r#"
SELECT id, mode, ifnull(topic,''), status, started_at, duration_sec,
       parent_session_id, round, filler_count, comparison_improved
FROM sessions WHERE 1=1
"#,
    );
    let mut binds: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(mode) = &q.mode {
        sql.push_str(" AND mode = ?");
        binds.push(Box::new(mode.clone()));
    }
    if let Some(search) = &q.search {
        sql.push_str(" AND topic LIKE ?");
        let pat = format!("%{search}%");
        binds.push(Box::new(pat));
    }
    sql.push_str(" ORDER BY rowid DESC LIMIT ? OFFSET ?");
    binds.push(Box::new(limit));
    binds.push(Box::new(offset));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
    let mut rows = stmt
        .query(params_ref.as_slice())
        .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(limit as usize);
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        out.push(row_to_session_summary(row)?);
    }
    Ok(out)
}

/// 画像聚合专用：只返回指标、报告和复练结果，不读取逐字稿或录音路径。
pub fn list_profile_sessions(state: &DbState) -> Result<Vec<Value>, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "db lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            r#"
SELECT id, mode, status, started_at, duration_sec, metrics_json, report_json,
       parent_session_id, round, comparison_json, target_issue
FROM sessions
ORDER BY started_at ASC
"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let metrics_json: Option<String> = row.get(5)?;
            let report_json: Option<String> = row.get(6)?;
            let comparison_json: Option<String> = row.get(9)?;
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "mode": row.get::<_, String>(1)?,
                "topic": "",
                "goal": "",
                "status": row.get::<_, String>(2)?,
                "startedAt": row.get::<_, String>(3)?,
                "durationSec": row.get::<_, Option<i64>>(4)?,
                "liveTranscript": [],
                "metrics": metrics_json.and_then(|raw| serde_json::from_str::<Value>(&raw).ok()),
                "report": report_json.and_then(|raw| serde_json::from_str::<Value>(&raw).ok()),
                "parentSessionId": row.get::<_, Option<String>>(7)?,
                "round": row.get::<_, Option<i64>>(8)?,
                "comparison": comparison_json.and_then(|raw| serde_json::from_str::<Value>(&raw).ok()),
                "targetIssue": row.get::<_, Option<String>>(10)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn row_to_session_summary(row: &rusqlite::Row<'_>) -> Result<Value, String> {
    let id: String = row.get(0).map_err(|e| e.to_string())?;
    let mode: String = row.get(1).map_err(|e| e.to_string())?;
    let topic: String = row.get(2).map_err(|e| e.to_string())?;
    let status: String = row.get(3).map_err(|e| e.to_string())?;
    let started_at: String = row.get(4).map_err(|e| e.to_string())?;
    let duration_sec: Option<i64> = row.get(5).map_err(|e| e.to_string())?;
    let parent_session_id: Option<String> = row.get(6).map_err(|e| e.to_string())?;
    let round: Option<i64> = row.get(7).map_err(|e| e.to_string())?;
    let filler_count: Option<i64> = row.get(8).map_err(|e| e.to_string())?;
    let comparison_improved: Option<i64> = row.get(9).map_err(|e| e.to_string())?;

    // 极简 comparison，避免解析大 JSON
    let comparison = comparison_improved.map(|v| {
        json!({
            "improved": v == 1,
            "parentSessionId": parent_session_id,
            "round": round.unwrap_or(2),
            "fillerDelta": 0,
            "densityDelta": 0,
            "notes": [],
            "successCriteriaMet": [],
            "before": { "fillerCount": 0, "hedgeCount": 0, "vagueWordCount": 0, "densityScore": 0 },
            "after": { "fillerCount": 0, "hedgeCount": 0, "vagueWordCount": 0, "densityScore": 0 },
            "deltas": {
                "fillerDelta": 0,
                "hedgeDelta": 0,
                "vagueDelta": 0,
                "densityDelta": 0
            }
        })
    });

    let metrics = filler_count.map(|n| {
        json!({
            "schemaVersion": 1,
            "fillerCount": n,
            "hedgeCount": 0,
            "vagueWordCount": 0,
            "repetitionRate": 0,
            "avgSentenceLength": 0,
            "densityScore": 0,
            "totalChars": 0,
            "totalWords": 0
        })
    });

    Ok(json!({
        "id": id,
        "mode": mode,
        "topic": topic,
        "goal": "",
        "status": status,
        "startedAt": started_at,
        "durationSec": duration_sec,
        "liveTranscript": [],
        "metrics": metrics,
        "parentSessionId": parent_session_id,
        "round": round,
        "comparison": comparison,
    }))
}

fn row_to_session_full(row: &rusqlite::Row<'_>) -> Result<Value, String> {
    let id: String = row.get(0).map_err(|e| e.to_string())?;
    let mode: String = row.get(1).map_err(|e| e.to_string())?;
    let topic: Option<String> = row.get(2).map_err(|e| e.to_string())?;
    let goal: Option<String> = row.get(3).map_err(|e| e.to_string())?;
    let status: String = row.get(4).map_err(|e| e.to_string())?;
    let started_at: String = row.get(5).map_err(|e| e.to_string())?;
    let ended_at: Option<String> = row.get(6).map_err(|e| e.to_string())?;
    let duration_sec: Option<i64> = row.get(7).map_err(|e| e.to_string())?;
    let input_source: Option<String> = row.get(8).map_err(|e| e.to_string())?;
    let audio_path: Option<String> = row.get(9).map_err(|e| e.to_string())?;
    let live_transcript: Option<String> = row.get(10).map_err(|e| e.to_string())?;
    let final_transcript: Option<String> = row.get(11).map_err(|e| e.to_string())?;
    let metrics_json: Option<String> = row.get(12).map_err(|e| e.to_string())?;
    let report_json: Option<String> = row.get(13).map_err(|e| e.to_string())?;
    let debate_json: Option<String> = row.get(14).map_err(|e| e.to_string())?;
    let parent_session_id: Option<String> = row.get(15).map_err(|e| e.to_string())?;
    let round: Option<i64> = row.get(16).map_err(|e| e.to_string())?;
    let comparison_json: Option<String> = row.get(17).map_err(|e| e.to_string())?;
    let target_issue: Option<String> = row.get(18).map_err(|e| e.to_string())?;
    let failure_reason: Option<String> = row.get(19).map_err(|e| e.to_string())?;

    let live: Value = live_transcript
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| json!([]));
    let metrics: Option<Value> = metrics_json.and_then(|s| serde_json::from_str(&s).ok());
    let report: Option<Value> = report_json.and_then(|s| serde_json::from_str(&s).ok());
    let comparison: Option<Value> = comparison_json.and_then(|s| serde_json::from_str(&s).ok());
    let debate: Option<Value> = debate_json.and_then(|s| serde_json::from_str(&s).ok());

    Ok(json!({
        "id": id,
        "mode": mode,
        "topic": topic.unwrap_or_default(),
        "goal": goal.unwrap_or_default(),
        "status": status,
        "startedAt": started_at,
        "endedAt": ended_at,
        "durationSec": duration_sec,
        "inputSource": input_source,
        "audioFile": audio_path,
        "liveTranscript": live,
        "finalTranscript": final_transcript,
        "metrics": metrics,
        "report": report,
        "comparison": comparison,
        "debate": debate,
        "parentSessionId": parent_session_id,
        "round": round,
        "targetIssue": target_issue,
        "failureReason": failure_reason,
    }))
}

pub fn delete_session(state: &DbState, id: &str) -> Result<(), String> {
    let mut conn = state
        .conn
        .lock()
        .map_err(|_| "db lock poisoned".to_string())?;
    let tx = conn.transaction().map_err(|e| format!("delete session: {e}"))?;
    {
        let mut stmt = tx
            .prepare("SELECT id, comparison_json FROM sessions WHERE parent_session_id = ?1")
            .map_err(|e| e.to_string())?;
        let children = stmt
            .query_map(params![id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        for (child_id, comparison_json) in children {
            let comparison = comparison_json.map(|raw| {
                let mut value = serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| json!({}));
                if let Some(object) = value.as_object_mut() {
                    object.insert("parentAvailable".into(), Value::Bool(false));
                }
                value.to_string()
            });
            tx.execute(
                "UPDATE sessions SET parent_session_id = NULL, comparison_json = ?1 WHERE id = ?2",
                params![comparison, child_id],
            )
            .map_err(|e| format!("detach retry child: {e}"))?;
        }
    }
    tx.execute("DELETE FROM sessions WHERE id = ?1", params![id])
        .map_err(|e| format!("delete session: {e}"))?;
    tx.commit().map_err(|e| format!("commit delete session: {e}"))?;
    Ok(())
}

pub fn delete_all_sessions(state: &DbState) -> Result<(), String> {
    let mut conn = state
        .conn
        .lock()
        .map_err(|_| "db lock poisoned".to_string())?;
    let tx = conn.transaction().map_err(|e| format!("clear sessions: {e}"))?;
    tx.execute("DELETE FROM sessions", [])
        .map_err(|e| format!("clear sessions: {e}"))?;
    tx.commit().map_err(|e| format!("commit clear sessions: {e}"))
}

pub fn list_export_sessions(state: &DbState) -> Result<Vec<Value>, String> {
    let ids = {
        let conn = state
            .conn
            .lock()
            .map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare("SELECT id FROM sessions ORDER BY started_at ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    ids.iter()
        .filter_map(|id| match load_session(state, id) {
            Ok(Some(value)) => Some(Ok(value)),
            Ok(None) => None,
            Err(error) => Some(Err(error)),
        })
        .collect()
}

pub fn count_sessions(state: &DbState) -> Result<u64, String> {
    let conn = state.conn.lock().map_err(|_| "db lock poisoned".to_string())?;
    conn.query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .map_err(|e| format!("count sessions: {e}"))
}

/// 进程重启后不可能仍有录音器或运行中的分析任务；保留素材并标记为可恢复中断。
pub fn reconcile_interrupted_sessions(state: &DbState) -> Result<usize, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "db lock poisoned".to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        r#"
UPDATE sessions
SET status = 'failed',
    ended_at = COALESCE(ended_at, ?1),
    failure_reason = CASE status
      WHEN 'recording' THEN '应用在录音期间退出，本轮已中断；已有录音和字幕已保留，可从复盘页恢复。'
      WHEN 'transcribing' THEN '应用在转写期间退出；已有录音已保留，可重新转写。'
      ELSE '应用在生成复盘期间退出；已有逐字稿已保留，可重新评审。'
    END,
    updated_at = ?1
WHERE status IN ('recording', 'transcribing', 'analyzing', 'retrying')
"#,
        params![now],
    )
    .map_err(|e| format!("reconcile interrupted sessions: {e}"))
}

fn format_unix_iso(secs: i64) -> String {
    let days = secs.div_euclid(86400);
    let tod = secs.rem_euclid(86400);
    let h = tod / 3600;
    let m = (tod % 3600) / 60;
    let s = tod % 60;
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mth = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if mth <= 2 { y + 1 } else { y };
    format!("{year:04}-{mth:02}-{d:02}T{h:02}:{m:02}:{s:02}.000Z")
}

#[cfg(test)]
mod tests {
    use super::{delete_session, load_session, reconcile_interrupted_sessions, upsert_session};
    use crate::db::{schema, DbState};
    use rusqlite::Connection;
    use serde_json::json;
    use std::sync::Mutex;

    #[test]
    fn upsert_releases_lock_before_loading_saved_session() {
        let conn = Connection::open_in_memory().unwrap();
        schema::migrate(&conn).unwrap();
        let state = DbState {
            conn: Mutex::new(conn),
        };
        let session = json!({
            "id": "ses_test",
            "mode": "free",
            "topic": "test topic",
            "goal": "clarity",
            "status": "failed",
            "startedAt": "2026-07-28T00:00:00.000Z",
            "inputSource": "paste",
            "liveTranscript": [],
            "round": 2,
            "targetIssue": "too_many_fillers",
            "failureReason": "test failure",
            "debate": {
                "phase": "cross_examination",
                "currentRound": 1,
                "turns": [],
                "pendingQuestion": "证据是什么？"
            }
        });

        let saved = upsert_session(&state, session).unwrap();
        assert_eq!(saved["id"], "ses_test");
        assert_eq!(saved["targetIssue"], "too_many_fillers");
        assert_eq!(saved["failureReason"], "test failure");
        assert_eq!(saved["inputSource"], "paste");
        assert_eq!(saved["debate"]["pendingQuestion"], "证据是什么？");

        let loaded = load_session(&state, "ses_test").unwrap().unwrap();
        assert_eq!(loaded["status"], "failed");
        assert_eq!(loaded["debate"]["currentRound"], 1);
    }

    #[test]
    fn restart_marks_transient_sessions_failed_without_dropping_material() {
        let conn = Connection::open_in_memory().unwrap();
        schema::migrate(&conn).unwrap();
        let state = DbState { conn: Mutex::new(conn) };
        upsert_session(&state, json!({
            "id": "ses_interrupted",
            "mode": "free",
            "topic": "test",
            "goal": "clarity",
            "status": "recording",
            "startedAt": "2026-07-28T00:00:00.000Z",
            "audioFile": "/tmp/test.wav",
            "liveTranscript": [{"id":"seg1","text":"保留字幕","isFinal":true}]
        })).unwrap();

        assert_eq!(reconcile_interrupted_sessions(&state).unwrap(), 1);
        let loaded = load_session(&state, "ses_interrupted").unwrap().unwrap();
        assert_eq!(loaded["status"], "failed");
        assert_eq!(loaded["audioFile"], "/tmp/test.wav");
        assert_eq!(loaded["liveTranscript"][0]["text"], "保留字幕");
        assert!(loaded["failureReason"].as_str().unwrap().contains("已中断"));
    }

    #[test]
    fn deleting_parent_keeps_child_comparison_snapshot() {
        let conn = Connection::open_in_memory().unwrap();
        schema::migrate(&conn).unwrap();
        let state = DbState { conn: Mutex::new(conn) };
        let base = |id: &str| json!({
            "id": id,
            "mode": "free",
            "topic": "test",
            "goal": "clarity",
            "status": "reviewed",
            "startedAt": "2026-07-28T00:00:00.000Z",
            "liveTranscript": []
        });
        upsert_session(&state, base("parent")).unwrap();
        let mut child = base("child");
        child["parentSessionId"] = json!("parent");
        child["comparison"] = json!({
            "parentSessionId":"parent", "round":2, "before":{}, "after":{}, "deltas":{},
            "fillerDelta":0, "densityDelta":0, "improved":true, "successCriteriaMet":[], "notes":[]
        });
        upsert_session(&state, child).unwrap();

        delete_session(&state, "parent").unwrap();
        let loaded = load_session(&state, "child").unwrap().unwrap();
        assert!(loaded["parentSessionId"].is_null());
        assert_eq!(loaded["comparison"]["parentAvailable"], false);
    }
}
