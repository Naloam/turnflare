/**
 * @turnflare/api —— 数据层 SQL 集中地。
 *
 * 三条硬规矩，改动本文件时不可破：
 *   1. 本文件之外不允许出现任何 SQL 字符串；
 *   2. 所有取值一律走 `?` 占位符，绝不把外部数据拼进 SQL；
 *   3. 动态部分（过滤条件、排序、分桶）只允许由本文件的白名单常量组装，
 *      调用方没有任何可以把字符串送进 SQL 的入口。
 */

import type { SessionsQuery, TimelineQuery } from '../types.js'

// ─── 写入 ────────────────────────────────────────────────────────────────────

/** upsert 的列清单：占位符数量与列数由同一份清单推导，永远不会对不齐 */
const SESSION_UPSERT_COLUMNS = [
  'session_id',
  'project_slug',
  'file_path',
  'cwd',
  'git_branch',
  'cli_version',
  'started_at',
  'ended_at',
  'models',
  'turn_count',
  'input_tokens',
  'cache_creation_tokens',
  'cache_read_tokens',
  'output_tokens',
  'thinking_tokens',
  'server_tool_use',
  'total_cost_usd',
  'unpriced_model',
  'parse_error_count',
  'file_mtime_ms',
  'file_size_bytes',
  'scanned_at',
] as const

const SESSION_UPSERT_ASSIGNMENTS = SESSION_UPSERT_COLUMNS.filter(
  (column) => column !== 'session_id',
)
  .map((column) => {
    // turn_count 取较大值而不是直接覆盖：一个 sessionId 对应多个文件，
    // 单个文件只带来其中一部分 turn。直接覆盖会让"后扫到的文件"把前面
    // 已经累计的计数抹掉。权威值最终由 mergeTurns 里的重算给出，
    // 这里只是保证单独调用 upsertSession 时计数不会倒退。
    if (column === 'turn_count') {
      return 'turn_count = MAX(turn_count, excluded.turn_count)'
    }
    return `${column} = excluded.${column}`
  })
  .join(',\n  ')

/**
 * 主链过滤条件。
 *
 * 全库统一口径：汇总、时间线、计数都只算 is_sidechain = 0 的主链 turn，
 * 与 core 的 aggregate 默认行为（includeSidechain: false）一致。
 * 侧链 turn 照常落库（会话详情看得到），另由 SQL_SIDECHAIN_TURNS 单独汇总一份
 * 上报；但它不进本文件任何一条主链统计——主链口径不因为多了侧链汇总而改变。
 * 定义必须早于第一个使用它的模板字符串——那些字符串在模块加载时就求值。
 */
export const SQL_MAIN_CHAIN_TURNS = 'is_sidechain = 0'

/**
 * 侧链过滤条件。
 *
 * 与 SQL_MAIN_CHAIN_TURNS 成对出现，但用途相反：它**不**改变上面那条主链口径，
 * 只是把 subagent 活动单独汇总一份暴露出来（见 types.ts 的 SidechainSummary）。
 * 侧链数字是主链之外的补充信息，两者永远并列，不互相污染。
 */
export const SQL_SIDECHAIN_TURNS = 'is_sidechain = 1'

/**
 * 幂等写入会话行。
 *
 * 同一个 sessionId 重复扫描必须走 UPDATE 而不是报唯一约束错误——增量扫描的
 * 前提就是"文件变了就再写一次"。
 */
export const SQL_UPSERT_SESSION = `
  INSERT INTO sessions (${SESSION_UPSERT_COLUMNS.join(', ')})
  VALUES (${SESSION_UPSERT_COLUMNS.map(() => '?').join(', ')})
  ON CONFLICT (session_id) DO UPDATE SET
  ${SESSION_UPSERT_ASSIGNMENTS}
`

/** 先删后插的第一半：删掉旧 turns，tool_invocations 由 ON DELETE CASCADE 带走 */
export const SQL_DELETE_SESSION_TURNS = 'DELETE FROM turns WHERE session_id = ?'

/**
 * 插入一条 turn；uuid 已存在时静默跳过，其他约束违规照常报错。
 *
 * 必须是 upsert 形式而不是 `INSERT OR IGNORE`：后者的"忽略"覆盖**所有**约束，
 * 包括 role 的 CHECK——一条畸形 turn 会被悄悄吞掉，落库数据少了一行却没人知道。
 * `ON CONFLICT (uuid) DO NOTHING` 只对 uuid 主键冲突生效，别的问题仍然炸出来。
 *
 * 为什么需要去重：Claude Code 的 subagent 记录
 * （subagents/agent-*.jsonl 与 wf_<run-id>/agent-*.jsonl）复用父会话的 sessionId，
 * 一个会话往往对应十几个文件；compaction 还会让同一条消息在同一个文件里重复。
 */
export const SQL_INSERT_TURN = `
  INSERT INTO turns (
    uuid, session_id, line_number, role, timestamp, model, parent_uuid,
    is_sidechain, text_preview, input_tokens, cache_creation_tokens,
    cache_read_tokens, output_tokens, thinking_tokens, total_cost_usd, speed
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (uuid) DO NOTHING
`

/**
 * 从 turns 表重算一个会话的汇总。
 *
 * 多文件共享 sessionId 时，汇总必须是"合并后"的结果，不能是最后一个文件的：
 * turn 数、token 总量、活动时间范围都要跨文件累加。
 *
 * 只统计主链（is_sidechain = 0）：这与 core 的 aggregate 默认口径一致
 * （includeSidechain 默认 false），也让 sessions 行与 getOverview()、
 * 时间线用同一个口径——三处数字必须对得上，否则用户会看到两个 turnCount。
 * 侧链 turn 仍然落库（会话详情可以看），只是不进汇总。
 */
export const SQL_SELECT_SESSION_AGGREGATE = `
  SELECT
    COUNT(*) AS turn_count,
    COALESCE(SUM(input_tokens), 0) AS input_tokens,
    COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
    COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
    COALESCE(SUM(output_tokens), 0) AS output_tokens,
    COALESCE(SUM(thinking_tokens), 0) AS thinking_tokens,
    COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd,
    MIN(timestamp) AS started_at,
    MAX(timestamp) AS ended_at
  FROM turns
  WHERE session_id = ? AND ${SQL_MAIN_CHAIN_TURNS}
`

/**
 * 一场会话的全量链条计数。
 *
 * 必须走独立 COUNT 而不是数返回的 turns：详情有 500 条上限且主链优先，
 * 主链超 500 条时侧链被完全挤出——数返回结果会得到"没有 subagent"的错误结论，
 * 前端筛选器随之整条藏起来，用户再也不知道侧链存在。
 */
export const SQL_SELECT_SESSION_CHAIN_COUNTS = `
  SELECT
    COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN is_sidechain = 0 THEN 1 ELSE 0 END), 0) AS main,
    COALESCE(SUM(CASE WHEN is_sidechain = 1 THEN 1 ELSE 0 END), 0) AS side
  FROM turns
  WHERE session_id = ?
`

/** 该会话出现过的模型（去重、排除 NULL），用于合并 meta.models */
export const SQL_SELECT_SESSION_MODELS = `
  SELECT DISTINCT model FROM turns
  WHERE session_id = ? AND model IS NOT NULL
  ORDER BY model
`

/**
 * 把重算结果写回 sessions 行。
 *
 * turn_count 与 token 一律来自 turns 表（权威），不信任入参。
 * started_at / ended_at / models 由调用方在 JS 里合并好后传进来——
 * 时间要跨多个文件取"较早/较晚"，用 SQL 的 min/max 表达会把哨兵值逻辑
 * 散进字符串里，读起来比一行 JS 难得多。
 */
export const SQL_UPDATE_SESSION_AGGREGATE = `
  UPDATE sessions SET
    turn_count = ?,
    input_tokens = ?,
    cache_creation_tokens = ?,
    cache_read_tokens = ?,
    output_tokens = ?,
    thinking_tokens = ?,
    total_cost_usd = ?,
    started_at = ?,
    ended_at = ?,
    models = ?
  WHERE session_id = ?
`

/** 合并前读一行：只为拿到已攒下的 models 与时间范围 */
export const SQL_SELECT_SESSION_MODELS_FOR_MERGE = `
  SELECT models, started_at, ended_at FROM sessions WHERE session_id = ? LIMIT 1
`

export const SQL_INSERT_TOOL_INVOCATION = `
  INSERT INTO tool_invocations (turn_uuid, tool_name, tool_use_id, is_error, result_bytes)
  VALUES (?, ?, ?, ?, ?)
`

// ─── 读取：会话 ───────────────────────────────────────────────────────────────

export const SQL_SELECT_SESSION_BY_ID = 'SELECT * FROM sessions WHERE session_id = ? LIMIT 1'

/** 单会话详情最多带回 500 条 turn，超出部分由调用方决定是否分页（ARCHITECTURE.md §3.2） */
export const MAX_TURNS_PER_SESSION = 500

/**
 * Chain filtering happens before LIMIT so subagents remain reachable in long sessions.
 * The all view keeps main-chain turns first; each selected chain retains line order.
 * Counts and session totals remain independent of this detail window.
 */
export const SQL_SELECT_SESSION_TURNS = `SELECT * FROM turns WHERE session_id = ? AND (? = 'all' OR is_sidechain = ?)
   ORDER BY is_sidechain ASC, line_number ASC LIMIT ? OFFSET ?`

/** 会话详情里的工具调用；用子查询取该会话的 turn 集合，避免在 SQL 里拼 id 列表 */
export const SQL_SELECT_SESSION_TOOLS = `
  SELECT turn_uuid, tool_name, tool_use_id, is_error, result_bytes
  FROM tool_invocations
  WHERE turn_uuid IN (SELECT uuid FROM turns WHERE session_id = ?)
`

/** 分组统计只认有模型信息的 turn：模型为 NULL 的是 user 消息，本来就不计费 */
export const SQL_PRICED_TURNS = 'model IS NOT NULL'

// ─── 读取：列表过滤与排序 ─────────────────────────────────────────────────────

/** 恒真条件：让 WHERE 子句永远有内容，调用方不必处理"没有过滤条件"的特例 */
const SQL_ALWAYS_TRUE = '1 = 1'

const SQL_FILTER_PROJECT = 'project_slug = ?'

const SQL_FILTER_MODEL = `EXISTS (
  SELECT 1 FROM turns
  WHERE turns.session_id = sessions.session_id
    AND turns.model = ?
)`

/**
 * sort 白名单 → 列名。
 *
 * 用 switch 而不是对象查表，是为了让"新增一个 sort 取值"在编译期就暴露：
漏写一个 case 直接报错，不会静默退化到某个默认列。
 */
function resolveSortColumn(sort: SessionsQuery['sort']): string {
  switch (sort) {
    case 'cost':
      return 'total_cost_usd'
    case 'tokens':
      // 计费总量口径与 core 的 usageTotal 一致：思考 token 已含在 output 里，不重复计
      return '(input_tokens + cache_creation_tokens + cache_read_tokens + output_tokens)'
    case 'recent':
      // started_at 可空；空串兜底保证 NULL 行的排序位置稳定可预期
      return "COALESCE(started_at, '')"
    case 'turns':
      return 'turn_count'
    default:
      throw new Error(`不支持的排序字段：${String(sort)}`)
  }
}

/** 文档默认值：调用方漏传时按这里的来，不要让 SQL 层见到 undefined */
const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const DEFAULT_SORT: NonNullable<SessionsQuery['sort']> = 'cost'
const DEFAULT_ORDER: NonNullable<SessionsQuery['order']> = 'desc'

export interface NormalizedSessionsQuery {
  readonly search?: string
  readonly page: number
  readonly limit: number
  readonly sort: NonNullable<SessionsQuery['sort']>
  readonly order: NonNullable<SessionsQuery['order']>
  readonly project?: string
  readonly model?: string
}

/**
 * 归一化会话查询。
 *
 * HTTP 层有 zod 兜底，但 repository 是公开 API：JS 调用方、CLI、测试都可能
 * 漏传字段。TS 的可选标记只在编译期有效，运行时不补默认值就会让
 * `resolveSortColumn(undefined)` 抛错——那时错误信息指向的是 SQL 内部，
 * 而不是"你没传 sort"。所以在这里一次性补齐，非法值仍然抛错。
 */
export function normalizeSessionsQuery(query: SessionsQuery): NormalizedSessionsQuery {
  const page = query.page ?? DEFAULT_PAGE
  const rawLimit = query.limit ?? DEFAULT_LIMIT
  return {
    page: page >= 1 ? Math.trunc(page) : DEFAULT_PAGE,
    limit: rawLimit >= 1 ? Math.min(Math.trunc(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT,
    sort: query.sort ?? DEFAULT_SORT,
    order: query.order ?? DEFAULT_ORDER,
    ...(query.project === undefined ? {} : { project: query.project }),
    ...(query.model === undefined ? {} : { model: query.model }),
    ...(query.search === undefined ? {} : { search: query.search }),
  }
}

function resolveOrderDirection(order: SessionsQuery['order']): string {
  switch (order) {
    case 'asc':
      return 'ASC'
    case 'desc':
      return 'DESC'
    default:
      throw new Error(`不支持的排序方向：${String(order)}`)
  }
}

export interface SessionsFilter {
  /** 以 WHERE 开头的过滤子句，可直接拼在 FROM sessions 之后 */
  readonly sql: string
  readonly params: readonly unknown[]
}

/** 由 SessionsQuery 组装 WHERE 子句；条件本身全部来自上面的常量 */
export function buildSessionsFilter(query: SessionsQuery): SessionsFilter {
  const fragments: string[] = [SQL_ALWAYS_TRUE]
  const params: unknown[] = []

  if (query.project !== undefined) {
    fragments.push(SQL_FILTER_PROJECT)
    params.push(query.project)
  }
  if (query.model !== undefined) {
    fragments.push(SQL_FILTER_MODEL)
    params.push(query.model)
  }

  if (query.search !== undefined && query.search.trim().length > 0) {
    const value = query.search.trim()
    fragments.push(`(instr(lower(sessions.session_id), lower(?)) > 0
      OR instr(lower(sessions.project_slug), lower(?)) > 0
      OR instr(lower(COALESCE(sessions.cwd, '')), lower(?)) > 0
      OR instr(lower(COALESCE(sessions.git_branch, '')), lower(?)) > 0
      OR EXISTS (SELECT 1 FROM turns search_turn WHERE search_turn.session_id = sessions.session_id
        AND instr(lower(search_turn.text_preview), lower(?)) > 0))`)
    params.push(value, value, value, value, value)
  }

  return { sql: `WHERE ${fragments.join('\n  AND ')}`, params }
}

/**
 * 组装 ORDER BY 子句；排序字段与方向都经过白名单映射。
 *
 * 末尾必须挂一个确定的次级排序键（session_id）：主键大量并列时——本地数据里
 * 成本几乎全是 $0.00——SQLite 对并列行的返回顺序取决于查询计划，翻页时
 * 同一行可能出现在两页，或者一页都排不上。加一个唯一键做 tie-break 后，
 * 分页结果才稳定可复现。
 */
export function buildSessionsOrder(query: SessionsQuery): string {
  const column = resolveSortColumn(query.sort)
  const direction = resolveOrderDirection(query.order)
  return `ORDER BY ${column} ${direction}, session_id ASC`
}

export const SQL_SELECT_SESSION_COLUMNS = `
  SELECT session_id, project_slug, cwd, git_branch, started_at, ended_at, models,
         turn_count, input_tokens, cache_creation_tokens, cache_read_tokens,
         output_tokens, thinking_tokens, server_tool_use, total_cost_usd,
         unpriced_model, parse_error_count
  FROM sessions
`

export const SQL_COUNT_SESSIONS = 'SELECT COUNT(*) AS total FROM sessions'

/**
 * 列表页需要的三条语句与它们共享的过滤参数。
 *
 * 过滤条件只组装一次、三条语句复用：列表按什么条件取行，总数与成本就必须按
 * 同样的条件算，否则前端会出现"列表 3 条、total 写 10"这种对不上的分页。
 */
export interface SessionsStatements {
  readonly page: string
  readonly count: string
  readonly modelUsage: string
  readonly params: readonly unknown[]
}

export function buildSessionsStatements(query: SessionsQuery): SessionsStatements {
  const filter = buildSessionsFilter(query)
  const order = buildSessionsOrder(query)
  return {
    page: `${SQL_SELECT_SESSION_COLUMNS}\n${filter.sql}\n${order}\nLIMIT ? OFFSET ?`,
    count: `${SQL_COUNT_SESSIONS}\n${filter.sql}`,
    modelUsage: SQL_SELECT_SESSION_MODEL_USAGE.replace('__FILTER__', filter.sql),
    params: filter.params,
  }
}

// ─── 读取：成本重算 ───────────────────────────────────────────────────────────

/**
 * 每会话 × 每模型 × 每档位的 token 汇总。
 *
 * schema 只在 sessions / turns 上存了成本**总额**，没有存四个分项；而一次会话
 * 往往混用多个模型，总额无法反推分项。所以分项在读取时重算：先按模型汇总
 * token，再各自过一遍 core 的价目表，最后 sumCosts 合并。
 *
 * 分组必须带上 speed：fast 档的输入/输出单价约为标准档 2 倍，把两个档位的
 * token 加在一起再计价，等于把所有 fast 请求按标准价算——正是这个字段要修
 * 的 bug。代价是每个 (session, model) 会多出几行，由 mapper 折叠回一份。
 *
 * 用子查询而不是 JOIN 承接过滤条件，是为了让列表页与成本查询复用同一段
 * WHERE 文本——过滤逻辑只有一份，不会出现"列表按 A 过滤、成本按 B 过滤"。
 *
 * 必须带 SQL_MAIN_CHAIN_TURNS：会话级 cost 要与同一个 SessionListItem 上的
 * turnCount / usage 同口径（两者都来自 sessions 行，是主链汇总）。少了这个过滤，
 * 一场主链 100 token + 侧链 100 万 token 的会话会显示「1 轮 / 100 token / $6.00」——
 * 三个数字互相矛盾，而且和总览的主链成本、sidechain 字段三方对不上。
 */
export const SQL_SELECT_SESSION_MODEL_USAGE = `
  SELECT session_id, model, speed,
         COUNT(*) AS request_count,
         SUM(input_tokens) AS input_tokens,
         SUM(cache_creation_tokens) AS cache_creation_tokens,
         SUM(cache_read_tokens) AS cache_read_tokens,
         SUM(output_tokens) AS output_tokens,
         SUM(thinking_tokens) AS thinking_tokens
  FROM turns
  WHERE ${SQL_PRICED_TURNS}
    AND ${SQL_MAIN_CHAIN_TURNS}
    AND session_id IN (SELECT session_id FROM sessions __FILTER__)
  GROUP BY session_id, model, speed
`

/** 单会话版本：详情页只需要一场会话的按模型汇总，不必套子查询 */
export const SQL_SELECT_ONE_SESSION_MODEL_USAGE = `
  SELECT session_id, model, speed,
         COUNT(*) AS request_count,
         SUM(input_tokens) AS input_tokens,
         SUM(cache_creation_tokens) AS cache_creation_tokens,
         SUM(cache_read_tokens) AS cache_read_tokens,
         SUM(output_tokens) AS output_tokens,
         SUM(thinking_tokens) AS thinking_tokens
  FROM turns
  WHERE ${SQL_PRICED_TURNS}
    AND ${SQL_MAIN_CHAIN_TURNS}
    AND session_id = ?
  GROUP BY session_id, model, speed
`

// ─── 读取：总览 ───────────────────────────────────────────────────────────────

/** 总览的用量口径取 sessions 行：只有它存了 server_tool_use；会话数走 COUNT(*) */
export const SQL_SELECT_USAGE_SUM = `
  SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(thinking_tokens), 0) AS thinking_tokens,
         COALESCE(SUM(server_tool_use), 0) AS server_tool_use
  FROM sessions
`

export const SQL_COUNT_TURNS = `SELECT COUNT(*) AS total FROM turns WHERE ${SQL_MAIN_CHAIN_TURNS}`

/**
 * 侧链 turn 总数（含 user 消息）。
 *
 * 口径与 SQL_COUNT_TURNS 对称：那边数主链、这边数侧链，两条加起来才是落库的
 * 全部 turn。刻意**不**在这里加 `model IS NOT NULL`：否则"侧链发生了多少轮"和
 * "侧链发起过多少次计费请求"会被混成一个数字，而这两个数本来就要分开报
 * （后者由 SQL_SELECT_SIDECHAIN_MODEL_USAGE 的 request_count 给出）。
 */
export const SQL_COUNT_SIDECHAIN_TURNS = `SELECT COUNT(*) AS total FROM turns WHERE ${SQL_SIDECHAIN_TURNS}`

/**
 * 活动区间，**只算主链**。
 *
 * 与同一个 AggregatedStats 里的 turnCount / usage / cost / byModel 同口径。
 * 少了主链过滤，区间会被 subagent 的活动撑大——用户看到"最早活动"是自己根本没参与的
 * 时间点。
 */
export const SQL_SELECT_ACTIVITY_RANGE = `
  SELECT MIN(timestamp) AS first_activity_at, MAX(timestamp) AS last_activity_at
  FROM turns
  WHERE timestamp IS NOT NULL AND ${SQL_MAIN_CHAIN_TURNS}
`

// ─── 读取：分组统计 ───────────────────────────────────────────────────────────

/**
 * token 汇总列。
 *
 * `turns` 与 `sessions` 有同名的 token 列，所以凡是 JOIN 了两张表的语句都必须
 * 带表前缀，否则 SQLite 报 ambiguous column。用函数生成而不是抄两份，是为了
 * 让"要汇总哪些列"只有一个来源。
 */
const TOKEN_COLUMNS = [
  'input_tokens',
  'cache_creation_tokens',
  'cache_read_tokens',
  'output_tokens',
  'thinking_tokens',
] as const

function sumTokens(prefix: string): string {
  return TOKEN_COLUMNS.map((column) => `SUM(${prefix}${column}) AS ${column}`).join(',\n         ')
}

const SUM_TURN_TOKENS = sumTokens('turns.')

/**
 * 模型分布。
 *
 * 按 (model, speed) 分组而不是只按 model：成本要按档位分别计价，加在一起算
 * 会把 fast 请求按标准价计。多出来的行由 mapper 的 foldModelStats 折回
 * "一个模型一条"，排序也在那里按折叠后的总成本重做。
 */
export const SQL_SELECT_MODEL_STATS = `
  SELECT model, speed, COUNT(*) AS request_count,${SUM_TURN_TOKENS}
  FROM turns
  WHERE ${SQL_MAIN_CHAIN_TURNS}
    AND ${SQL_PRICED_TURNS}
  GROUP BY model, speed
  ORDER BY SUM(total_cost_usd) DESC, model ASC
`

/**
 * 侧链的按模型汇总，只服务总览里的 SidechainSummary。
 *
 * 与 SQL_SELECT_MODEL_STATS 同一形状、同一个分组键，只是把过滤条件换成侧链：
 * 分项成本必须按 (model, speed) 分组后才能逐行计价，加在一起算会把 fast 档
 * 按标准价计。折叠（foldUsage / foldCosts / sumRequestCount）也复用 mapper，
 * 不另写一套转换。
 *
 * 不带 ORDER BY：这里要的是求和，顺序无关；省掉一次排序也少一处需要维护的约定。
 */
export const SQL_SELECT_SIDECHAIN_MODEL_USAGE = `
  SELECT model, speed, COUNT(*) AS request_count,${SUM_TURN_TOKENS}
  FROM turns
  WHERE ${SQL_SIDECHAIN_TURNS}
    AND ${SQL_PRICED_TURNS}
  GROUP BY model, speed
`

/**
 * 按项目 × 模型 × 会话汇总。
 *
 * 带上 session_id 分组是因为 ProjectStats.sessionCount 要数"这个项目下有哪几场
 * 会话"，而一场会话可能横跨多个模型——只在 (project, model) 粒度上分组就没法
 * 还原会话集合了。request_count 在项目维度用不到，跟着一起分组不影响求和。
 * speed 同样进分组键：成本按档位分别计价，见 SQL_SELECT_MODEL_STATS 的说明。
 */
export const SQL_SELECT_PROJECT_STATS = `
  SELECT sessions.project_slug AS project_slug,
         turns.session_id AS session_id,
         turns.model AS model,
         turns.speed AS speed,
         COUNT(*) AS request_count,${SUM_TURN_TOKENS}
  FROM turns
  JOIN sessions ON sessions.session_id = turns.session_id
  WHERE turns.${SQL_MAIN_CHAIN_TURNS}
    AND turns.${SQL_PRICED_TURNS}
  GROUP BY sessions.project_slug, turns.session_id, turns.model, turns.speed
  ORDER BY project_slug ASC
`

/**
 * 工具调用统计，**只算主链**。
 *
 * tool_invocations 自己没有 is_sidechain 列，要通过 turn_uuid join turns 才过滤得掉。
 * 少了这个 join，subagent 的调用会混进"主对话口径"的总览——而侧链 turn 数实测能到
 * 主链的 11.7 倍，工具榜会被 subagent 完全占据，用户看不到自己用了哪些工具。
 */
export const SQL_SELECT_TOOL_STATS = `
  SELECT ti.tool_name AS tool_name,
         COUNT(*) AS call_count,
         SUM(ti.is_error) AS error_count,
         COALESCE(SUM(ti.result_bytes), 0) AS total_result_bytes
  FROM tool_invocations AS ti
  JOIN turns AS t ON t.uuid = ti.turn_uuid
  WHERE ${SQL_MAIN_CHAIN_TURNS}
  GROUP BY ti.tool_name
  ORDER BY call_count DESC, ti.tool_name ASC
`

// ─── 读取：时间线 ─────────────────────────────────────────────────────────────

/**
 * 时间线过滤条件。
 *
 * 时间字段直接比较 ISO 串：schema 约定时间一律存 UTC ISO-8601，定宽格式下
 * 字典序即时间序，不需要在 SQL 里做任何日期运算。
 *
 * 返回的 `sql` 是**追加在已有 WHERE 之后**的 AND 片段（没有条件时是空串），
 * 因为时间线语句自己已经有一组固定的 WHERE 条件了。
 */
const SQL_TIMELINE_SINCE = 'turns.timestamp >= ?'
const SQL_TIMELINE_UNTIL = 'turns.timestamp < ?'
const SQL_TIMELINE_PROJECT = 'sessions.project_slug = ?'

export interface TimelineFilter {
  readonly sql: string
  readonly params: readonly unknown[]
}

export function buildTimelineFilter(query: TimelineQuery): TimelineFilter {
  const fragments: string[] = []
  const params: unknown[] = []

  if (query.since !== undefined) {
    fragments.push(SQL_TIMELINE_SINCE)
    params.push(query.since)
  }
  if (query.until !== undefined) {
    fragments.push(SQL_TIMELINE_UNTIL)
    params.push(query.until)
  }
  if (query.project !== undefined) {
    fragments.push(SQL_TIMELINE_PROJECT)
    params.push(query.project)
  }

  const sql = fragments.map((fragment) => `AND ${fragment}`).join('\n      ')
  return { sql: sql.length > 0 ? `\n      ${sql}` : '', params }
}

/**
 * 分桶表达式。
 *
 * 桶键格式与 core 的 bucketByHour / bucketByDay 完全一致（`YYYY-MM-DDTHH:00:00Z`
 * 与 `YYYY-MM-DD`），这样 API 时间线与 core 直接算出来的曲线可以直接对比。
 * 代价是分桶按 UTC 进行：schema 明确"不在 DB 层做时区转换"，本地时区由展示层负责。
 */
function resolveBucketExpression(granularity: TimelineQuery['granularity']): string {
  switch (granularity) {
    case 'hour':
      return "substr(turns.timestamp, 1, 13) || ':00:00Z'"
    case 'day':
      return 'substr(turns.timestamp, 1, 10)'
    default:
      throw new Error(`不支持的时间粒度：${String(granularity)}`)
  }
}

/** 桶键长度下界：短于该长度的 timestamp 拼不出完整桶键 */
function resolveBucketMinLength(granularity: TimelineQuery['granularity']): number {
  switch (granularity) {
    case 'hour':
      return 13
    case 'day':
      return 10
    default:
      throw new Error(`不支持的时间粒度：${String(granularity)}`)
  }
}

/** 时间线按桶 × 模型汇总；模型维度保留下来，成本才能按模型分别计价 */
export interface TimelineStatement {
  readonly sql: string
  readonly params: readonly unknown[]
}

export function buildTimelineStatement(query: TimelineQuery): TimelineStatement {
  const bucket = resolveBucketExpression(query.granularity)
  const minLength = resolveBucketMinLength(query.granularity)
  const filter = buildTimelineFilter(query)
  return {
    sql: `
    SELECT ${bucket} AS bucket,
           turns.model AS model,
           turns.speed AS speed,
           COUNT(*) AS request_count,${SUM_TURN_TOKENS}
    FROM turns
    JOIN sessions ON sessions.session_id = turns.session_id
    WHERE turns.${SQL_MAIN_CHAIN_TURNS}
      AND turns.${SQL_PRICED_TURNS}
      AND turns.timestamp IS NOT NULL
      AND length(turns.timestamp) >= ${minLength}${filter.sql}
    GROUP BY bucket, model, speed
    ORDER BY bucket ASC
  `,
    params: filter.params,
  }
}

// ─── 读取：增量扫描 ───────────────────────────────────────────────────────────

/**
 * 增量扫描的指纹，按**文件**取，不是按会话。
 *
 * 曾经直接读 sessions 行，但 sessions 以 session_id 为主键，而 subagent 文件
 * 复用父会话的 sessionId——同一会话的十几个文件会互相覆盖指纹，
 * 先扫的文件之后无论怎么改都被判"未变化"。独立成表后一个文件一行，互不干扰。
 */
export const SQL_SELECT_FILE_STAMPS =
  'SELECT file_path, file_mtime_ms, file_size_bytes FROM scanned_files'

/** 写入/更新单文件指纹（按 file_path 幂等） */
export const SQL_UPSERT_FILE_STAMP = `
  INSERT INTO scanned_files (file_path, project_slug, session_id, file_mtime_ms, file_size_bytes, scanned_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (file_path) DO UPDATE SET
    project_slug = excluded.project_slug,
    session_id = excluded.session_id,
    file_mtime_ms = excluded.file_mtime_ms,
    file_size_bytes = excluded.file_size_bytes,
    scanned_at = excluded.scanned_at
`

/** 清空全部指纹 */
export const SQL_DELETE_FILE_STAMPS = 'DELETE FROM scanned_files'

export const SQL_SELECT_LAST_SCAN_AT = 'SELECT MAX(scanned_at) AS last_scan_at FROM sessions'

// ─── 清空 ────────────────────────────────────────────────────────────────────

/**
 * 顺序有意义：先删被外键引用的父表，级联会带走 turns / tool_invocations。
 *
 * scan_jobs 没有外键引用它，放后面纯粹是习惯；真正不能颠倒的是 sessions 必须
 * 第一个删。曾经这里还有一条 `DELETE FROM daily_rollup`，那张表从未被写入过
 * （迁移 003 已删掉），那条 DELETE 永远是空操作。
 */
export const SQL_CLEAR_ALL = [
  'DELETE FROM tool_invocations',
  'DELETE FROM turns',
  'DELETE FROM sessions',
  'DELETE FROM scanned_files',
  'DELETE FROM scan_jobs',
] as const
