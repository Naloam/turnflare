-- Turnflare SQLite Schema · 迁移 003（删掉从未使用的 daily_rollup）
--
-- 背景：001 建的 daily_rollup 自称"预聚合，加速 timeline 天粒度查询"，
-- 但从来没有任何语句写过它或读过它——全仓唯一的引用是 SQL_CLEAR_ALL 里的
-- 一条 DELETE（永远删 0 行）。时间线实际是每次查询时从 turns 现算的
-- （queries.ts 的 buildTimelineStatement），没有走任何预聚合表。
--
-- 为什么删而不是留着：一张没人写的表比没有这张表更糟——它会让读 schema 的人
-- 以为时间线有预聚合路径，进而在错误的假设上做优化。死 schema 也是维护负担。
--
-- 数据安全性：没有任何 INSERT/UPDATE 指向 daily_rollup，所以表里不可能有
-- 业务数据，DROP 不丢任何东西。如果将来真要做天粒度预聚合，按 004 重建即可
-- （届时记得同步补写入路径，否则又会变成一张空表）。

DROP TABLE IF EXISTS daily_rollup;
