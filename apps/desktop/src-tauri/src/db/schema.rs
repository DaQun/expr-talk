use rusqlite::Connection;

pub fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  topic TEXT,
  goal TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_sec INTEGER,
  input_source TEXT,
  audio_path TEXT,
  live_transcript TEXT,
  final_transcript TEXT,
  metrics_json TEXT,
  report_json TEXT,
  debate_json TEXT,
  parent_session_id TEXT,
  round INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_mode ON sessions(mode);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"#,
    )
    .map_err(|e| format!("migrate: {e}"))?;

    // 列表摘要列（存在则忽略错误）
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN comparison_json TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN filler_count INTEGER", []);
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN comparison_improved INTEGER",
        [],
    );
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN target_issue TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN failure_reason TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN debate_json TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN input_source TEXT", []);

    // 从已有 metrics_json 回填 filler_count（只处理空值）
    let _ = conn.execute_batch(
        r#"
UPDATE sessions
SET filler_count = CAST(json_extract(metrics_json, '$.fillerCount') AS INTEGER)
WHERE filler_count IS NULL
  AND metrics_json IS NOT NULL
  AND json_valid(metrics_json);
"#,
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::migrate;
    use rusqlite::Connection;

    #[test]
    fn migration_adds_session_lifecycle_columns() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        let mut stmt = conn.prepare("PRAGMA table_info(sessions)").unwrap();
        let names = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert!(names.iter().any(|name| name == "target_issue"));
        assert!(names.iter().any(|name| name == "failure_reason"));
        assert!(names.iter().any(|name| name == "debate_json"));
        assert!(names.iter().any(|name| name == "input_source"));
    }
}
