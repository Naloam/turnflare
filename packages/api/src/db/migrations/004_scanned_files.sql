-- Turnflare SQLite Schema · 迁移 004（文件级扫描指纹）
--
-- 背景：增量扫描的指纹原先存在 sessions 行的 file_path / file_mtime_ms /
-- file_size_bytes 三列上。但 sessions 以 session_id 为主键，而 Claude Code 的
-- subagent 记录（subagents/agent-*.jsonl、wf_<id>/agent-*.jsonl）**复用父会话的
-- sessionId**——一个会话往往对应十几个文件。SQL_UPSERT_SESSION 用 ON CONFLICT
-- 覆盖，于是同一 sessionId 的第 N 个文件会把前 N-1 个的指纹冲掉：
-- 那些文件之后无论怎么改，增量判定都认为"未变化"而跳过，数据不再刷新。
--
-- 修法：指纹独立成表，以 file_path 为主键，一个文件一行，互不覆盖。

CREATE TABLE IF NOT EXISTS scanned_files (
  file_path      TEXT    PRIMARY KEY,
  project_slug   TEXT    NOT NULL,
  session_id     TEXT    NOT NULL,
  file_mtime_ms  INTEGER NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  scanned_at     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scanned_files_session ON scanned_files (session_id);

-- 存量数据：把 sessions 行上的指纹搬过来。同一 sessionId 的多个文件在旧结构里
-- 只留得下最后一个，搬过来的就是那个——不比现在更差，且新扫描会立刻补全。
INSERT OR IGNORE INTO scanned_files (file_path, project_slug, session_id, file_mtime_ms, file_size_bytes, scanned_at)
SELECT file_path, project_slug, session_id, file_mtime_ms, file_size_bytes, scanned_at
FROM sessions
WHERE file_path IS NOT NULL AND file_path <> '';
