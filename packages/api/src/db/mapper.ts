/**
 * @turnflare/api —— SQL 行 ↔ 领域对象。
 *
 * 本文件只有纯函数：不碰连接、不抛业务异常、不依赖调用顺序。所有入参一律按
 * `unknown` 接收再逐字段窄化——驱动返回的行本质上就是不可信数据（NULL、类型
 * 不符、脏 JSON 都可能出现），缺字段时给安全默认值，绝不让一个坏行把整张表
 * 的查询带崩。
 *
 * 成本为什么在这里重算：schema 只持久化了成本**总额**（`total_cost_usd`），
 * 而一次会话/一个桶往往混用多个模型，总额反推不出四个分项。因此分项在读取时
 * 按模型重算——先按模型汇总 token，再各自过一遍 core 的价目表。
 */

import { costOf, sumCosts } from '@turnflare/core'
import type {
  CostBreakdown,
  ModelStats,
  ProjectStats,
  SessionListItem,
  TimeBucket,
  TokenUsage,
  ToolInvocation,
  ToolStats,
  Turn,
} from '../types.js'
// FileStamp 从 repository-deps 而不是 repository 导入：repository.ts 是装配层，
// 它自己也要 import 本文件，从那里取类型会形成 mapper → repository → mapper 的
// 类型级循环（emitted .d.ts 里互相引用）。deps 层是这些值类型的家。
import type { FileStamp } from './repository-deps.js'

/** 造一份全新的全 0 用量；每次调用都返回新对象，调用方之间不会共享引用 */
export function emptyTokenUsage(): TokenUsage {
  return {
    speed: 'standard',
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    serverToolUse: 0,
  }
}

/** 造一份全新的全 0 成本 */
export function emptyCostBreakdown(): CostBreakdown {
  return {
    inputCost: 0,
    outputCost: 0,
    cacheWriteCost: 0,
    cacheReadCost: 0,
    totalCost: 0,
    currency: 'USD',
    unpricedModel: false,
    isEstimated: false,
  }
}

/**
 * 值是不是「可以按 key 读字段」的普通对象。
 *
 * 写成类型谓词而不是在 asRecord 里直接断言：`typeof` + 排除 null / 数组之后
 * TS 自己就能窄化，不需要 `as` 把编译器嘴堵上。
 */
function isFieldBag(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把驱动返回的一行收敛成可读字段的字典；不是对象时返回 null */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return isFieldBag(value) ? value : null
}

/** 读文本列：非字符串（含 NULL）一律按"没有值"处理 */
export function readTextField(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** 读"必须有值"的文本列；缺失时退回调用方给的兜底值 */
export function readTextWithFallback(value: unknown, fallback: string): string {
  const text = readTextField(value)
  return text === null ? fallback : text
}

/** 读"空串等于没有"的文本列（uuid 这类键） */
export function readNonEmptyText(value: unknown): string | null {
  const text = readTextField(value)
  return text !== null && text.length > 0 ? text : null
}

/**
 * 读整数列。
 *
 * bigint 也要接住：SQLite 的 INTEGER 在个别驱动配置下会以 bigint 返回，
 * 直接判 `typeof === 'number'` 会把合法值误读成 0。
 */
export function readIntegerField(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }
  return 0
}

/** 读布尔列；schema 约定布尔用 INTEGER 0/1 存储 */
export function readBooleanField(value: unknown): boolean {
  if (typeof value === 'number') {
    return value !== 0
  }
  return value === true
}

/**
 * 解析 models 列（JSON 数组文本）。
 *
 * 解析失败或结构不对时退化为空数组：models 只是展示用的附属信息，
 * 不该因为它把整页会话列表拖垮。真正需要"哪里坏了"的现场在服务端日志里，
 * 由写入方负责。
 */
export function parseModels(raw: unknown): readonly string[] {
  if (typeof raw !== 'string') {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) {
    return []
  }
  const items: readonly unknown[] = parsed
  return items.filter((item): item is string => typeof item === 'string')
}

/** 读计费档位；缺列或非法值按标准档计 */
function readSpeedField(value: unknown): 'standard' | 'fast' {
  return value === 'fast' ? 'fast' : 'standard'
}

/** token 列 → TokenUsage；缺列补 0（server_tool_use 只有 sessions 表有） */
export function toTokenUsage(row: unknown): TokenUsage {
  const fields = asRecord(row)
  if (fields === null) {
    return emptyTokenUsage()
  }
  return {
    // 档位只在 turns 表有；读 sessions 行时该列不存在，按标准档兜底
    speed: readSpeedField(fields.speed),
    inputTokens: readIntegerField(fields.input_tokens),
    cacheCreationTokens: readIntegerField(fields.cache_creation_tokens),
    cacheReadTokens: readIntegerField(fields.cache_read_tokens),
    outputTokens: readIntegerField(fields.output_tokens),
    thinkingTokens: readIntegerField(fields.thinking_tokens),
    serverToolUse: readIntegerField(fields.server_tool_use),
  }
}

/**
 * 一行「按模型汇总的 token」→ 成本明细。
 *
 * 入参行必须带 `model` 列：模型为 NULL 的行（user 消息）不参与任何成本统计，
 * SQL 层已经用 `model IS NOT NULL` 挡掉了。缺 model 时按空串走价目表，
 * 结果是全 0 且 `unpricedModel` 为 true——绝不拿别的模型的价格猜。
 */
export function toCostBreakdown(row: unknown): CostBreakdown {
  const fields = asRecord(row)
  if (fields === null) {
    return emptyCostBreakdown()
  }
  const model = readTextWithFallback(fields.model, '')
  return costOf({ usage: toTokenUsage(row), model })
}

/** 多行成本明细求和；空数组返回全 0 */
export function foldCosts(rows: readonly unknown[]): CostBreakdown {
  return sumCosts(rows.map((row) => toCostBreakdown(row)))
}

/**
 * 多行 token 汇总求和。
 *
 * 档位不参与求和：汇总之后它不再代表任何一次请求，成本是在 turn 级逐条算清
 * 再相加的。保留首行的值只为让字段有确定来源。
 */
export function foldUsage(rows: readonly unknown[]): TokenUsage {
  return rows.reduce<TokenUsage>((total, row, index) => {
    const usage = toTokenUsage(row)
    if (index === 0) {
      return usage
    }
    return {
      speed: total.speed,
      inputTokens: total.inputTokens + usage.inputTokens,
      cacheCreationTokens: total.cacheCreationTokens + usage.cacheCreationTokens,
      cacheReadTokens: total.cacheReadTokens + usage.cacheReadTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      thinkingTokens: total.thinkingTokens + usage.thinkingTokens,
      serverToolUse: total.serverToolUse + usage.serverToolUse,
    }
  }, emptyTokenUsage())
}

/** 多行的 request_count 求和 */
export function sumRequestCount(rows: readonly unknown[]): number {
  return rows.reduce<number>(
    (total, row) => total + readIntegerField(asRecord(row)?.request_count),
    0,
  )
}

/**
 * 按某个文本字段把行分组。
 *
 * 分组的键（session_id / project_slug / bucket）都是 SQL 里已经算好的列，
 * 这里只做归拢；键为空的行直接丢弃，因为它们对不上任何领域对象。
 */
export function groupRowsBy(rows: readonly unknown[], keyField: string): Map<string, unknown[]> {
  const grouped = new Map<string, unknown[]>()
  for (const row of rows) {
    const key = readNonEmptyText(asRecord(row)?.[keyField])
    if (key === null) {
      continue
    }
    const existing = grouped.get(key)
    if (existing === undefined) {
      grouped.set(key, [row])
    } else {
      grouped.set(key, [...existing, row])
    }
  }
  return grouped
}

/** tool_invocations 行 → ToolInvocation */
export function toToolInvocation(row: unknown): ToolInvocation | null {
  const fields = asRecord(row)
  if (fields === null) {
    return null
  }
  return {
    toolName: readTextWithFallback(fields.tool_name, ''),
    toolUseId: readTextWithFallback(fields.tool_use_id, ''),
    isError: readBooleanField(fields.is_error),
    resultBytes: readIntegerField(fields.result_bytes),
  }
}

/**
 * turns 行 → Turn。
 *
 * `usage` 是否为空按 role 判断：schema 没有"这条 turn 是否计费"的标记位，
 * 而 jsonl 里只有 assistant 消息带 usage，user 消息的 usage 恒为 null。
 * tools 由调用方从 tool_invocations 表取好后传入——一张表存不下数组。
 */
export function toTurn(row: unknown, tools: readonly ToolInvocation[]): Turn | null {
  const fields = asRecord(row)
  if (fields === null) {
    return null
  }
  const role = readTextWithFallback(fields.role, 'user')
  const isAssistant = role === 'assistant'
  return {
    uuid: readTextWithFallback(fields.uuid, ''),
    parentUuid: readTextField(fields.parent_uuid),
    role: isAssistant ? 'assistant' : 'user',
    timestamp: readTextWithFallback(fields.timestamp, ''),
    model: readTextField(fields.model),
    usage: isAssistant ? toTokenUsage(row) : null,
    tools,
    textPreview: readTextWithFallback(fields.text_preview, ''),
    isSidechain: readBooleanField(fields.is_sidechain),
    lineNumber: readIntegerField(fields.line_number),
  }
}

/**
 * sessions 行 → 会话列表项。
 *
 * 成本由调用方折叠好再传进来：一行 sessions 只有混合模型的总额，
 * 分项必须回到 turns 表按模型重算后才能填。
 */
export function toSessionListItem(row: unknown, cost: CostBreakdown): SessionListItem | null {
  const fields = asRecord(row)
  if (fields === null) {
    return null
  }
  return {
    sessionId: readTextWithFallback(fields.session_id, ''),
    projectSlug: readTextWithFallback(fields.project_slug, ''),
    cwd: readTextField(fields.cwd),
    gitBranch: readTextField(fields.git_branch),
    startedAt: readTextField(fields.started_at),
    endedAt: readTextField(fields.ended_at),
    models: parseModels(fields.models),
    turnCount: readIntegerField(fields.turn_count),
    usage: toTokenUsage(row),
    cost,
  }
}

/** 按模型汇总的行 → ModelStats */
export function toModelStats(row: unknown): ModelStats {
  const fields = asRecord(row) ?? {}
  return {
    model: readTextWithFallback(fields.model, ''),
    requestCount: readIntegerField(fields.request_count),
    usage: toTokenUsage(row),
    cost: toCostBreakdown(row),
  }
}

/**
 * 「模型 × 档位」汇总行 → 一个模型一条 ModelStats。
 *
 * 为什么必须折叠：SQL 按 (model, speed) 分组才能让 fast 档按 fast 价计价
 * （见 queries.ts 的 SQL_SELECT_MODEL_STATS），而 ModelStats 的契约是一个模型
 * 一条。token 与请求数跨档位相加，成本则逐行算清后再 sumCosts 合并——
 * 先把 token 加起来统一计价，fast 的用量就又被按标准价算掉了。
 */
export function foldModelStats(rows: readonly unknown[]): readonly ModelStats[] {
  return [...groupRowsBy(rows, 'model')].map(([model, modelRows]) => ({
    model,
    requestCount: sumRequestCount(modelRows),
    usage: foldUsage(modelRows),
    cost: foldCosts(modelRows),
  }))
}

/** 按项目 × 模型汇总的行 → ProjectStats；成本已由调用方折叠成单个明细 */
export function toProjectStats(projectSlug: string, rows: readonly unknown[]): ProjectStats {
  const sessionIds = new Set(
    rows
      .map((row) => readNonEmptyText(asRecord(row)?.session_id))
      .filter((sessionId): sessionId is string => sessionId !== null),
  )
  return {
    projectSlug,
    sessionCount: sessionIds.size,
    usage: foldUsage(rows),
    cost: foldCosts(rows),
  }
}

/** 按桶 × 模型汇总的行 → TimeBucket */
export function toTimeBucket(bucket: string, rows: readonly unknown[]): TimeBucket {
  return {
    bucket,
    usage: foldUsage(rows),
    cost: foldCosts(rows),
    requestCount: sumRequestCount(rows),
  }
}

/** tool_invocations 汇总行 → ToolStats */
export function toToolStats(row: unknown): ToolStats {
  const fields = asRecord(row) ?? {}
  return {
    toolName: readTextWithFallback(fields.tool_name, ''),
    callCount: readIntegerField(fields.call_count),
    errorCount: readIntegerField(fields.error_count),
    totalResultBytes: readIntegerField(fields.total_result_bytes),
  }
}

/** 增量扫描用的文件指纹行 → FileStamp */
export function toFileStamp(row: unknown): FileStamp | null {
  const fields = asRecord(row)
  if (fields === null) {
    return null
  }
  const filePath = readNonEmptyText(fields.file_path)
  if (filePath === null) {
    return null
  }
  return {
    filePath,
    mtimeMs: readIntegerField(fields.file_mtime_ms),
    sizeBytes: readIntegerField(fields.file_size_bytes),
  }
}

/** COUNT(*) 行 → 数字 */
export function readCount(row: unknown): number {
  return readIntegerField(asRecord(row)?.total)
}

/** 读任意整数列；字段缺失按 0 计 */
export function readIntegerFrom(row: unknown, field: string): number {
  return readIntegerField(asRecord(row)?.[field])
}

/**
 * 读任意浮点列（成本列是 REAL）；字段缺失或非有限数按 0 计。
 *
 * 成本走这条路而不是 readIntegerFrom：SQLite 的 SUM 对 REAL 列返回浮点数，
 * 按整数读会把 $0.016 这种量级的成本抹成 0。
 */
export function readNumberFrom(row: unknown, field: string): number {
  const value = asRecord(row)?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 单值聚合行（MIN/MAX）→ 字符串或 null */
export function readTextFieldFrom(row: unknown, field: string): string | null {
  return readTextField(asRecord(row)?.[field])
}
