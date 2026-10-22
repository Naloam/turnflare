import type { ModelStats, ProjectStats, TimeBucket, TokenUsage, Turn } from '../types/api'
import { formatDate, UNAVAILABLE_TEXT } from './format'

/**
 * 图表数据转换。
 *
 * 全部是纯函数：入参只读、返回新数组、无副作用。
 * Recharts 只认普通对象数组，而 API 契约返回的是 readonly 结构体数组，
 * 因此在组件和图表之间加这一层适配，顺便把「按成本降序」「模型名去日期后缀」
 * 这类展示逻辑收敛到可单测的地方。
 */

/** 成本趋势面积图的一个点 */
export interface TrendPoint {
  readonly date: string
  readonly cost: number
}

/**
 * 模型占比饼图的一个扇区。
 *
 * `model` 是完整模型 ID，`name` 只是压短后的展示名。两者都要留着：
 * 只存短名会让 `claude-sonnet-4-5-20250929` 和 `claude-sonnet-4-5` 塌成同一个
 * 字符串，而它同时被用作 React key 和图例 title——key 重复 React 会告警，
 * 图例也会分不清到底是谁。
 */
export interface ModelShare {
  readonly model: string
  readonly name: string
  readonly value: number
  readonly share: number
}

/** token 瀑布图的一条堆叠柱（对应一条 assistant turn） */
export interface WaterfallPoint {
  readonly label: string
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly outputTokens: number
}

/** 项目成本对比图的一个条 */
export interface ProjectCostPoint {
  readonly project: string
  readonly cost: number
  readonly tokens: number
  readonly sessions: number
}

/** 模型名末尾的 8 位日期戳，如 claude-sonnet-4-5-20250929 */
const MODEL_DATE_STAMP = /^\d{8}$/

/** 把模型名压短：claude-sonnet-4-5-20250929 -> claude-sonnet-4-5 */
export function shortModelName(model: string): string {
  const segments = model.split('-')
  const last = segments.at(-1) ?? ''
  if (segments.length > 1 && MODEL_DATE_STAMP.test(last)) {
    return segments.slice(0, -1).join('-')
  }
  return model
}

/**
 * 一次请求消耗的 token 总量。
 *
 * thinkingTokens 是 outputTokens 的子集、serverToolUse 是请求次数，
 * 两者都不能再相加，否则会重复计数。
 */
export function totalTokens(usage: TokenUsage): number {
  const parts = [
    usage.inputTokens,
    usage.cacheCreationTokens,
    usage.cacheReadTokens,
    usage.outputTokens,
  ]
  return parts.reduce((sum, part) => sum + Math.max(0, part), 0)
}

/** byDay 桶 -> 面积图数据。非法桶键原样保留，避免图表出现空洞时丢上下文。 */
export function toTrendPoints(buckets: readonly TimeBucket[]): readonly TrendPoint[] {
  return buckets.map((bucket) => ({
    date: toDayLabel(bucket.bucket),
    cost: Math.max(0, bucket.cost.totalCost),
  }))
}

/** byModel -> 饼图数据，按成本降序；总成本为 0 时占比统一记 0。 */
export function toModelShares(models: readonly ModelStats[]): readonly ModelShare[] {
  const sorted = [...models].toSorted((left, right) => right.cost.totalCost - left.cost.totalCost)
  const total = sorted.reduce((sum, model) => sum + Math.max(0, model.cost.totalCost), 0)
  return sorted.map((stat) => {
    const value = Math.max(0, stat.cost.totalCost)
    return {
      model: stat.model,
      name: shortModelName(stat.model),
      value,
      share: total > 0 ? value / total : 0,
    }
  })
}

/** assistant turns -> 瀑布图数据；没有 usage 的 turn 无法计入，直接跳过。 */
export function toWaterfallPoints(turns: readonly Turn[]): readonly WaterfallPoint[] {
  const points: WaterfallPoint[] = []
  for (const turn of turns) {
    if (turn.role !== 'assistant' || turn.usage === null) {
      continue
    }
    points.push({
      label: `#${points.length + 1}`,
      inputTokens: Math.max(0, turn.usage.inputTokens),
      cacheReadTokens: Math.max(0, turn.usage.cacheReadTokens),
      outputTokens: Math.max(0, turn.usage.outputTokens),
    })
  }
  return points
}

/** byProject -> 横向柱状图数据，按成本降序。 */
export function toProjectCosts(projects: readonly ProjectStats[]): readonly ProjectCostPoint[] {
  const sorted = [...projects].toSorted((left, right) => right.cost.totalCost - left.cost.totalCost)
  return sorted.map((project) => ({
    project: project.projectSlug,
    cost: Math.max(0, project.cost.totalCost),
    tokens: totalTokens(project.usage),
    sessions: project.sessionCount,
  }))
}

/** 桶键 -> 轴标签：2026-10-19T00:00:00Z -> "10-19"；无法解析时原样返回。 */
function toDayLabel(bucket: string): string {
  const formatted = formatDate(bucket, 0)
  return formatted === UNAVAILABLE_TEXT ? bucket : formatted.slice(5)
}
