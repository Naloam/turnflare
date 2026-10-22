-- Turnflare SQLite Schema · 迁移 001（初始结构）
--
-- 约定：
--   1. 所有迁移文件只增不改；修改结构必须新增 002_*.sql
--   2. 时间一律存 ISO-8601 UTC 字符串（TEXT），不在 DB 层做时区转换
--   3. 成本存 REAL（美元），保留全精度，舍入只发生在展示层
--   4. token 数存 INTEGER；SQLite 的 INTEGER 是 64 位，足够
--   5. 布尔用 INTEGER 0/1
--   6. JSON 数组（如 models）存 TEXT，由应用层保证是合法 JSON

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT    NOT NULL
);

-- ─── 会话 ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  session_id            TEXT    PRIMARY KEY,
  project_slug          TEXT    NOT NULL,
  file_path             TEXT    NOT NULL,
  cwd                   TEXT,
  git_branch            TEXT,
  cli_version           TEXT,
  started_at            TEXT,
  ended_at              TEXT,
  models                TEXT    NOT NULL DEFAULT '[]',
  turn_count            INTEGER NOT NULL DEFAULT 0,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  thinking_tokens       INTEGER NOT NULL DEFAULT 0,
  server_tool_use       INTEGER NOT NULL DEFAULT 0,
  total_cost_usd        REAL    NOT NULL DEFAULT 0,
  unpriced_model        INTEGER NOT NULL DEFAULT 0,
  parse_error_count     INTEGER NOT NULL DEFAULT 0,
  file_mtime_ms         INTEGER NOT NULL,
  file_size_bytes       INTEGER NOT NULL,
  scanned_at            TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions (project_slug);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions (started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_cost    ON sessions (total_cost_usd);
CREATE INDEX IF NOT EXISTS idx_sessions_scan_key ON sessions (file_path, file_mtime_ms, file_size_bytes);

-- ─── 轮次 ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS turns (
  uuid                   TEXT    PRIMARY KEY,
  session_id             TEXT    NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,
  line_number            INTEGER NOT NULL,
  role                   TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  timestamp              TEXT,
  model                  TEXT,
  parent_uuid            TEXT,
  is_sidechain           INTEGER NOT NULL DEFAULT 0,
  text_preview           TEXT,
  input_tokens           INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
  output_tokens          INTEGER NOT NULL DEFAULT 0,
  thinking_tokens        INTEGER NOT NULL DEFAULT 0,
  total_cost_usd         REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_turns_session  ON turns (session_id);
CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns (timestamp);
CREATE INDEX IF NOT EXISTS idx_turns_model    ON turns (model);
CREATE INDEX IF NOT EXISTS idx_turns_role      ON turns (role);

-- ─── 工具调用 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tool_invocations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_uuid    TEXT    NOT NULL REFERENCES turns (uuid) ON DELETE CASCADE,
  tool_name    TEXT    NOT NULL,
  tool_use_id  TEXT    NOT NULL,
  is_error     INTEGER NOT NULL DEFAULT 0,
  result_bytes INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tool_turn  ON tool_invocations (turn_uuid);
CREATE INDEX IF NOT EXISTS idx_tool_name  ON tool_invocations (tool_name);

-- ─── 每日汇总（预聚合，加速 timeline 天粒度查询）─────────────────────────────
CREATE TABLE IF NOT EXISTS daily_rollup (
  day                  TEXT    NOT NULL,
  project_slug         TEXT    NOT NULL,
  model                TEXT    NOT NULL,
  request_count        INTEGER NOT NULL DEFAULT 0,
  input_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens        INTEGER NOT NULL DEFAULT 0,
  thinking_tokens      INTEGER NOT NULL DEFAULT 0,
  total_cost_usd       REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (day, project_slug, model)
);

CREATE INDEX IF NOT EXISTS idx_rollup_day ON daily_rollup (day);

-- ─── 扫描任务 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_jobs (
  job_id          TEXT    PRIMARY KEY,
  status          TEXT    NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  total_files     INTEGER NOT NULL DEFAULT 0,
  processed_files INTEGER NOT NULL DEFAULT 0,
  root_dir        TEXT    NOT NULL,
  started_at      TEXT    NOT NULL,
  finished_at     TEXT,
  error           TEXT
);
