use rusqlite::Connection;

/// 当前 schema 版本。新增迁移时：追加一个 `migrate_vN` 函数、把 CURRENT_VERSION +1，
/// 并在下面的派发处登记。历史版本函数一旦发布不要改动。
const CURRENT_VERSION: u32 = 1;

pub fn migrate(conn: &Connection) -> Result<(), String> {
    let version: u32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| format!("read user_version: {e}"))?;

    if version < 1 {
        migrate_v1(conn)?;
    }
    // 后续迁移在此追加：if version < 2 { migrate_v2(conn)?; }

    conn.pragma_update(None, "user_version", CURRENT_VERSION)
        .map_err(|e| format!("set user_version: {e}"))?;
    Ok(())
}

/// v1：初始建表 + 历史增量列。
/// 必须保持幂等：旧库没有 user_version（视为 0），每次升级后只跑一次。
fn migrate_v1(conn: &Connection) -> Result<(), String> {
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
    .map_err(|e| format!("migrate v1: {e}"))?;

    // 历史增量列：SQLite 的 ALTER TABLE 无 IF NOT EXISTS，已存在时忽略错误即可。
    // 注意：debate_json / input_source 已在 CREATE TABLE 内，仅用于为更早期建表的旧库补列。
    for sql in [
        "ALTER TABLE sessions ADD COLUMN comparison_json TEXT",
        "ALTER TABLE sessions ADD COLUMN filler_count INTEGER",
        "ALTER TABLE sessions ADD COLUMN comparison_improved INTEGER",
        "ALTER TABLE sessions ADD COLUMN target_issue TEXT",
        "ALTER TABLE sessions ADD COLUMN failure_reason TEXT",
        "ALTER TABLE sessions ADD COLUMN debate_json TEXT",
        "ALTER TABLE sessions ADD COLUMN input_source TEXT",
    ] {
        let _ = conn.execute(sql, []);
    }

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
    use super::{migrate, CURRENT_VERSION};
    use rusqlite::Connection;

    fn session_columns(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("PRAGMA table_info(sessions)").unwrap();
        stmt.query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    #[test]
    fn migration_adds_session_lifecycle_columns() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        let names = session_columns(&conn);

        assert!(names.iter().any(|name| name == "target_issue"));
        assert!(names.iter().any(|name| name == "failure_reason"));
        assert!(names.iter().any(|name| name == "debate_json"));
        assert!(names.iter().any(|name| name == "input_source"));
    }

    #[test]
    fn migration_sets_user_version_and_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        // 二次执行（模拟重复启动）不应报错
        migrate(&conn).unwrap();

        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_VERSION);
    }
}
