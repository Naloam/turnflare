/**
 * @turnflare/core —— 总聚合
 *
 * 把若干 Session 收敛成一份 AggregatedStats：先按 uuid 去重、再按侧链与时间窗
 * 过滤，然后分别做总量 / 模型 / 项目 / 时间 / 工具五个维度的汇总。
 *
 * 全程不可变：用量与成本的累加一律经过 `addUsage` / `addCost` 生成新对象，
 * 任何中间结果都不会被后续步骤改写。
 */

import type {
  AggregatedStats,
  CostBreakdown,
  ModelStats,
  ProjectStats,
  Session,
  SidechainSummary,
  TokenUsage,
  Turn,
} from '../types.js'
import type { AggregateOptions, CostCalculator } from './types.js'
import { isSyntheticModel } from '../synthetic.js'
import { bucketByDay, bucketByHour, parseTimestamp } from './bucket.js'
import { dedupeTurns } from './dedupe.js'
import { aggregateTools, toolErrorRate } from './tools.js'
import { addCost, addUsage, calculateCost, cacheHitRate, emptyUsage, zeroCost } from './usage.js'
import { isArrayValue, isPlainObject, isPresent, readFiniteNumber, readString } from './narrow.js'

/** 解析后的聚合选项：所有可选字段都有了确定值，下游不再判空 */
interface ResolvedOptions {
  readonly timezoneOffsetMinutes: number
  readonly includeSidechain: boolean
  readonly sinceMs: number | null
  readonly untilMs: number | null
  readonly costCalculator: CostCalculator | null
}

/** 一个参与统计的会话：身份键 + 项目 slug + 原始 turns */
interface SessionEntry {
  readonly key: string
  readonly projectSlug: string
  readonly turns: readonly Turn[]
}

/** 分组累加器（模型 / 项目共用） */
interface GroupAccumulator {
  readonly usage: TokenUsage
  readonly cost: CostBreakdown
  readonly requestCount: number
}

/** 项目分组额外要数会话数 */
interface ProjectAccumulator extends GroupAccumulator {
  readonly sessionKeys: readonly string[]
}

const EMPTY_GROUP: GroupAccumulator = Object.freeze({
  usage: emptyUsage(),
  cost: zeroCost(),
  requestCount: 0,
})

const EMPTY_PROJECT: ProjectAccumulator = Object.freeze({
  ...EMPTY_GROUP,
  sessionKeys: [],
})

/**
 * 聚合多个会话的统计信息。
 *
 * @param sessions - 会话数组；空数组返回全零结构的合法结果，不抛错
 * @param options - 时区 / 侧链 / 时间窗 / 成本计算器
 * @param costCalculator - 成本计算器；与 `options.costCalculator` 等价，
 *        同时传入时以位置参数为准（便于已持有 options 的调用方直接透传）
 * @returns 聚合结果
 */
export function aggregate(
  sessions: readonly Session[],
  options?: AggregateOptions,
  costCalculator?: CostCalculator,
): AggregatedStats {
  const settings = resolveOptions(options, costCalculator)
  const entries = collectSessions(sessions)
  const turns = selectTurns(entries, settings)
  const selected = new Set(turns)
  const owners = mapTurnOwners(entries)
  const usage = sumUsage(turns)
  const tools = aggregateTools(turns)

  return {
    sessionCount: countContributingSessions(entries, selected, owners),
    turnCount: turns.length,
    usage,
    cost: sumCost(turns, settings.costCalculator),
    byModel: buildModelStats(turns, settings.costCalculator),
    byProject: buildProjectStats(entries, selected, owners, settings.costCalculator),
    byHour: bucketByHour(turns, settings.timezoneOffsetMinutes, settings.costCalculator),
    byDay: bucketByDay(turns, settings.timezoneOffsetMinutes, settings.costCalculator),
    toolUsage: tools,
    cacheHitRate: cacheHitRate(usage),
    errorRate: toolErrorRate(tools),
    firstActivityAt: findActivityAt(turns, true),
    lastActivityAt: findActivityAt(turns, false),
    sidechain: summarizeSidechain(entries, settings),
  }
}

/**
 * 侧链（subagent）活动的汇总。
 *
 * 为什么单独算一份：侧链 turn 数实测可达主链的 5.4 倍、输出 token 1.7 倍，而
 * 默认口径把它们全部排除。不暴露就等于把大部分真实用量藏起来——用户看到的
 * "总成本"其实只是主对话那部分。
 *
 * 它**不参与**上面的主链汇总：主链数字对应"我和 Claude 对话了多少轮"，改口径
 * 会让用户在同一份结果里看到两个互相矛盾的心智模型。
 *
 * 过滤条件复用 selectTurns（去重、合成哨兵、时间窗），只把侧链开关打开后再挑出
 * 侧链那部分：过滤逻辑抄第二遍，迟早和主口径漂移。
 */
function summarizeSidechain(
  entries: readonly SessionEntry[],
  settings: ResolvedOptions,
): SidechainSummary {
  const turns = selectTurns(entries, { ...settings, includeSidechain: true }).filter(
    (turn) => turn.isSidechain === true,
  )
  return {
    turnCount: turns.length,
    usage: sumUsage(turns),
    cost: sumCost(turns, settings.costCalculator),
    // 只数真正产生计费的 turn，与 byModel 的 requestCount 同口径
    requestCount: turns.filter((turn) => isPresent(turn.usage)).length,
  }
}

/**
 * 记录每条 turn 归属于哪场会话。
 *
 * 去重是全局按 uuid 做的，而"这条 turn 属于哪个项目"要按会话看；如果两条
 * 会话引用同一个 turn 对象（调用方重新包装过 meta），不记录归属就会把同一笔
 * 用量在两个项目里各算一次。首次出现的那场会话是权威归属。
 */
function mapTurnOwners(entries: readonly SessionEntry[]): ReadonlyMap<Turn, string> {
  const owners = new Map<Turn, string>()
  for (const entry of entries) {
    for (const turn of entry.turns) {
      if (!owners.has(turn)) {
        owners.set(turn, entry.key)
      }
    }
  }
  return owners
}

/** 数一数有多少场会话真的贡献了入选 turn */
function countContributingSessions(
  entries: readonly SessionEntry[],
  selected: ReadonlySet<Turn>,
  owners: ReadonlyMap<Turn, string>,
): number {
  let count = 0
  for (const entry of entries) {
    const owns = entry.turns.some((turn) => selected.has(turn) && owners.get(turn) === entry.key)
    if (owns) {
      count += 1
    }
  }
  return count
}

function resolveOptions(
  options: AggregateOptions | undefined,
  positionalCalculator: CostCalculator | undefined,
): ResolvedOptions {
  return {
    timezoneOffsetMinutes: readFiniteNumber(options?.timezoneOffsetMinutes) ?? 0,
    includeSidechain: options?.includeSidechain === true,
    sinceMs: parseBoundary(options?.since, 'since'),
    untilMs: parseBoundary(options?.until, 'until'),
    costCalculator: positionalCalculator ?? options?.costCalculator ?? null,
  }
}

/**
 * 解析时间边界。
 *
 * 调用方传错时立刻抛中文错误：静默忽略一个非法时间窗会让"没数据"和
 * "过滤条件写错了"表现得一模一样，排查成本极高。
 */
function parseBoundary(value: string | undefined, name: 'since' | 'until'): number | null {
  if (value === undefined) {
    return null
  }
  const ms = parseTimestamp(value)
  if (ms === null) {
    throw new Error(`聚合选项 ${name} 不是合法的 ISO 时间字符串：${value}`)
  }
  return ms
}

/** 收集有效会话并按身份去重（同一文件被扫两次只算一个会话） */
function collectSessions(sessions: readonly Session[]): readonly SessionEntry[] {
  const entries: SessionEntry[] = []
  const seenKeys = new Set<string>()
  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index]
    if (session === undefined || !isPlainObject(session) || !isArrayValue(session.turns)) {
      continue
    }
    const key = sessionKey(session, index)
    if (seenKeys.has(key)) {
      continue
    }
    seenKeys.add(key)
    entries.push({ key, projectSlug: projectSlugOf(session), turns: session.turns })
  }
  return entries
}

/** 会话身份：filePath 优先，退化到 sessionId，再退化到输入序号 */
function sessionKey(session: Session, index: number): string {
  const meta = isPlainObject(session.meta) ? session.meta : null
  const filePath = meta === null ? '' : readString(meta.filePath)
  if (filePath.length > 0) {
    return `file:${filePath}`
  }
  const sessionId = meta === null ? '' : readString(meta.sessionId)
  if (sessionId.length > 0) {
    return `id:${sessionId}`
  }
  return `index:${index}`
}

function projectSlugOf(session: Session): string {
  const meta = isPlainObject(session.meta) ? session.meta : null
  return meta === null ? '' : readString(meta.projectSlug)
}

/** 去重 + 过滤，得到最终参与统计的 turn 列表 */
function selectTurns(entries: readonly SessionEntry[], settings: ResolvedOptions): readonly Turn[] {
  // flatMap / filter 都返回新数组，入参的 turns 数组不会被碰到
  const deduped = dedupeTurns(entries.flatMap((entry) => entry.turns))
  return deduped.filter((turn) => isTurnIncluded(turn, settings))
}

function isTurnIncluded(turn: Turn, settings: ResolvedOptions): boolean {
  if (!isPlainObject(turn)) {
    return false
  }
  // 合成哨兵记录不对应任何一次计费调用，整体排除，避免模型分布里出现不存在的模型
  if (isSyntheticModel(modelOf(turn))) {
    return false
  }
  if (settings.includeSidechain === false && turn.isSidechain === true) {
    return false
  }
  const timestampMs = parseTimestamp(turn.timestamp)
  const hasWindow = settings.sinceMs !== null || settings.untilMs !== null
  if (hasWindow && timestampMs === null) {
    // 没有可解析时间戳就无法证明它落在窗口内，保守排除
    return false
  }
  if (timestampMs === null) {
    return true
  }
  if (settings.sinceMs !== null && timestampMs < settings.sinceMs) {
    return false
  }
  return settings.untilMs === null || timestampMs < settings.untilMs
}

/** 全部用量之和；没有 usage 的 turn 不参与（它们本来就没计费） */
function sumUsage(turns: readonly Turn[]): TokenUsage {
  let total = emptyUsage()
  for (const turn of turns) {
    if (isPresent(turn.usage)) {
      total = addUsage(total, turn.usage)
    }
  }
  return total
}

function sumCost(turns: readonly Turn[], calculator: CostCalculator | null): CostBreakdown {
  let total = zeroCost()
  for (const turn of turns) {
    total = addCost(total, turnCost(turn, calculator))
  }
  return total
}

function turnCost(turn: Turn, calculator: CostCalculator | null): CostBreakdown {
  if (!isPresent(turn.usage)) {
    return zeroCost()
  }
  return calculateCost(turn.usage, modelOf(turn), calculator)
}

function modelOf(turn: Turn): string {
  return readString(turn.model)
}

function buildModelStats(
  turns: readonly Turn[],
  calculator: CostCalculator | null,
): readonly ModelStats[] {
  const groups = new Map<string, GroupAccumulator>()
  for (const turn of turns) {
    // requestCount 只数有 usage 的 turn：没有 usage 的调用不产生计费，也不算一次请求
    if (!isPresent(turn.usage)) {
      continue
    }
    const model = modelOf(turn)
    const previous = groups.get(model) ?? EMPTY_GROUP
    groups.set(model, {
      usage: addUsage(previous.usage, turn.usage),
      cost: addCost(previous.cost, turnCost(turn, calculator)),
      requestCount: previous.requestCount + 1,
    })
  }
  return [...groups.entries()].sort(compareByCostThenName).map(([model, group]) => ({
    model,
    requestCount: group.requestCount,
    usage: group.usage,
    cost: group.cost,
  }))
}

function buildProjectStats(
  entries: readonly SessionEntry[],
  selected: ReadonlySet<Turn>,
  owners: ReadonlyMap<Turn, string>,
  calculator: CostCalculator | null,
): readonly ProjectStats[] {
  const groups = new Map<string, ProjectAccumulator>()
  for (const entry of entries) {
    // 一场会话只要拥有一条入选 turn 就算参与；会话键按 entry 去重，不会重复计数
    const turns = entry.turns.filter((turn) => selected.has(turn) && owners.get(turn) === entry.key)
    if (turns.length === 0) {
      continue
    }
    const previous = groups.get(entry.projectSlug) ?? EMPTY_PROJECT
    const totals = turns.reduce<GroupAccumulator>(
      (accumulator, turn) => ({
        usage: addUsage(accumulator.usage, turn.usage ?? emptyUsage()),
        cost: addCost(accumulator.cost, turnCost(turn, calculator)),
        requestCount: accumulator.requestCount + 1,
      }),
      previous,
    )
    groups.set(entry.projectSlug, {
      ...totals,
      sessionKeys: [...previous.sessionKeys, entry.key],
    })
  }
  return [...groups.entries()].sort(compareByCostThenName).map(([projectSlug, group]) => ({
    projectSlug,
    sessionCount: group.sessionKeys.length,
    usage: group.usage,
    cost: group.cost,
  }))
}

/**
 * 最早 / 最晚一次活动的原始时间戳。
 *
 * 返回记录里的原始字符串而不是重新格式化的 ISO：调用方看到的就是 jsonl 里的
 * 那个时刻，不会因为一次往返丢精度。没有可解析时间戳时返回 null。
 */
function findActivityAt(turns: readonly Turn[], isFirst: boolean): string | null {
  let bestMs: number | null = null
  let bestTimestamp: string | null = null
  for (const turn of turns) {
    const ms = parseTimestamp(turn.timestamp)
    if (ms === null) {
      continue
    }
    const isBetter = bestMs === null || (isFirst ? ms < bestMs : ms > bestMs)
    if (isBetter) {
      bestMs = ms
      bestTimestamp = turn.timestamp
    }
  }
  return bestTimestamp
}

/** 成本降序；成本相同时按名称升序，保证同样输入永远得到同样顺序 */
function compareByCostThenName<T extends GroupAccumulator>(
  left: readonly [string, T],
  right: readonly [string, T],
): number {
  const byCost = right[1].cost.totalCost - left[1].cost.totalCost
  if (byCost !== 0) {
    return byCost
  }
  const leftName = left[0]
  const rightName = right[0]
  if (leftName < rightName) {
    return -1
  }
  return leftName > rightName ? 1 : 0
}
