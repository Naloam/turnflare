-- Turnflare SQLite Schema · 迁移 002（turns 增加计费档位）
--
-- 背景：core 的 TokenUsage 契约补上了 speed 字段（fast 档单价约为标准档 2 倍），
-- 落库必须一起带上，否则从库里读出来的历史数据无法还原真实成本。
--
-- 存量行按 'standard' 补：迁移前落库的数据本来就没有档位信息，
-- 而"没有标记"按标准档计是对的（旧版本记录没有这个字段）。

ALTER TABLE turns ADD COLUMN speed TEXT NOT NULL DEFAULT 'standard';

-- 读路径按 speed 分组时要用；顺带建索引避免全表扫
CREATE INDEX IF NOT EXISTS idx_turns_speed ON turns (speed);

-- 注意：本次迁移之前扫进去的 fast 档 turn 仍是标准档（那时还没有这一列）。
-- 那些数据要重新扫一次才会按 fast 价重算——`turnflare scan` 对未变化的文件
-- 会跳过，所以要么删掉 ~/.turnflare/turnflare.db 全量重扫，要么等对应会话
-- 文件再次变化后自然重扫。新接入的数据不受影响。
