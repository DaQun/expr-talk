-- ShowTalk initial schema (architecture §6)

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  topic TEXT,
  goal TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_sec INTEGER,
  audio_path TEXT,
  live_transcript TEXT,
  final_transcript TEXT,
  metrics_json TEXT,
  report_json TEXT,
  parent_session_id TEXT,
  round INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_mode ON sessions(mode);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);

CREATE TABLE IF NOT EXISTS utterances (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  start_ms INTEGER,
  end_ms INTEGER,
  text TEXT NOT NULL,
  segment_ids_json TEXT,
  metrics_json TEXT,
  feedback_json TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_utterances_session ON utterances(session_id);

CREATE TABLE IF NOT EXISTS practice_attempts (
  id TEXT PRIMARY KEY,
  parent_session_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  target_issue TEXT,
  transcript TEXT,
  metrics_json TEXT,
  comparison_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS user_profile (
  id TEXT PRIMARY KEY,
  recurring_issues_json TEXT,
  baseline_scores_json TEXT,
  progress_trends_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
