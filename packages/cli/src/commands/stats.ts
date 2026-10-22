/**
 * `turnflare stats` —— 终端统计报表。
 *
 * 数据全部来自仓储的聚合查询（`getOverview` / `getToolStats`），CLI 不自己再
 * 聚合一遍：聚合口径（只算主链、按 uuid 去重、剔合成模型）只有一份，放在 api
 * 包里，Web 仪表盘与 CLI 因此永远对得上。
 *
 * `--days N` 的边界：仓储只提供"时间线"这一种可按时间过滤的取数入口，
 * 模型分布与工具统计没有窗口版本。所以窗口内数字单独一行展示，两张分布表
 * 明确标注"全量口径"——把全局数字塞进窗口标题下会误导用户。
 */
import { addUsage, emptyUsage, sumCosts, usageTotal } from '@turnflare/core'
import type { TokenUsage } from '@turnflare/core'
import type {
  AggregatedStats,
  ModelStats,
  SessionRepository,
  SidechainSummary,
  TimeBucket,
  ToolStats,
} from '../api-types.js'
import { SUCCESS } from '../context.js'
import type { CliContext, Command, CommandResult } from '../context.js'
import type { StatsOptions } from '../options.js'
import type { StorageDeps } from '../storage.js'
import { closeStorage, openStorageFromEnv } from '../storage.js'
import { runtimeFailure, storageFailure, UNPRICED_WARNING } from './shared.js'
import { renderMarkdownTable, renderRows } from '../render/table.js'
import { createPalette, shouldUseColor } from '../color.js'
import type { Palette } from '../color.js'
import {
  UNKNOWN,
  displayTimestamp,
  formatCost,
  formatPercent,
  formatTokens,
  formatWithThousandsSeparator,
} from '../format.js'

export type StatsDeps = StorageDeps

/** 一天的毫秒数 */
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Top 工具表只展示前 N 名 */
const TOP_TOOL_LIMIT = 10

const OVERVIEW_HEAD: readonly string[] = ['指标', '数值']

const MODEL_HEAD: readonly string[] = ['模型', '请求数', '输入', '输出', '成本', '占比']

const MODEL_ALIGNS = ['left', 'right', 'right', 'right', 'right', 'right'] as const

const TOOL_HEAD: readonly string[] = ['工具', '调用次数', '出错', '结果体积']

const TOOL_ALIGNS = ['left', 'right', 'right', 'right'] as const

const EMPTY_HINT = '数据库中暂无会话数据。请先运行 `turnflare scan` 扫描会话记录。'

/**
 * 侧链口径说明。
 *
 * 为什么必须写出来：总览表的口径是主对话（仓储只汇总 is_sidechain = 0 的 turn），
 * 而侧链 turn 数实测能到主链的 5.4 倍。不说明的话，用户会把"总成本"理解成全部
 * 用量——那会把六成以上的真实活动藏起来。
 */
const SIDECHAIN_NOTE = '上方总览为主对话口径，不含 subagent 活动'

/** 统计窗口内的总量 */
interface WindowTotals {
  readonly days: number
  readonly since: string
  readonly until: string
  readonly tokens: number
  readonly cost: number
  readonly requests: number
}

function buildRange(days: number, now: Date): { readonly since: string; readonly until: string } {
  return {
    since: new Date(now.getTime() - days * MS_PER_DAY).toISOString(),
    until: now.toISOString(),
  }
}

/** 时间线只有"有活动的桶"，累加即为窗口总量 */
function foldBuckets(
  buckets: readonly TimeBucket[],
): Omit<WindowTotals, 'days' | 'since' | 'until'> {
  const usage = buckets.reduce<TokenUsage>(
    (total, bucket) => addUsage(total, bucket.usage),
    emptyUsage(),
  )
  return {
    tokens: usageTotal(usage),
    cost: sumCosts(buckets.map((bucket) => bucket.cost)).totalCost,
    requests: buckets.reduce((total, bucket) => total + bucket.requestCount, 0),
  }
}

function readWindow(
  repo: SessionRepository,
  days: number | undefined,
  now: Date,
): WindowTotals | null {
  if (days === undefined) {
    return null
  }
  const range = buildRange(days, now)
  const buckets = repo.getTimeline({ granularity: 'day', since: range.since, until: range.until })
  return { days, since: range.since, until: range.until, ...foldBuckets(buckets) }
}

function formatActivityRange(stats: AggregatedStats): string {
  const offset = -new Date().getTimezoneOffset()
  const from = displayTimestamp(stats.firstActivityAt, offset)
  const to = displayTimestamp(stats.lastActivityAt, offset)
  return from === UNKNOWN || to === UNKNOWN ? UNKNOWN : `${from} ~ ${to}`
}

function overviewRows(stats: AggregatedStats): readonly (readonly string[])[] {
  const rows = [
    ['会话数', formatWithThousandsSeparator(stats.sessionCount)],
    ['轮次', formatWithThousandsSeparator(stats.turnCount)],
    ['总 Token', formatTokens(usageTotal(stats.usage))],
    ['总成本', formatCost(stats.cost.totalCost)],
    ['缓存命中率', formatPercent(stats.cacheHitRate)],
    ['工具出错率', formatPercent(stats.errorRate)],
    ['活动区间', formatActivityRange(stats)],
  ]
  // 没有侧链活动时不加这一行：空行只会变成噪音，还会让人以为侧链统计坏了
  return hasSidechainActivity(stats) ? [...rows, sidechainRow(stats.sidechain)] : rows
}

/**
 * 有侧链活动才展示侧链行与口径说明。
 *
 * 判据用 turnCount 而不是 requestCount：侧链里可能有没带模型信息的 turn
 * （不计费但确实发生了），它们同样属于被总览排除的活动。
 */
function hasSidechainActivity(stats: AggregatedStats): boolean {
  return stats.sidechain.turnCount > 0
}

/**
 * 侧链活动行：并列在总览表里，而不是并进"轮次 / 总 Token"。
 *
 * 为什么不改主链口径：总览的数字对应"我和 Claude 对话了多少轮"，是用户最直观的
 * 心智模型；把侧链加进去会让它失真。但完全不显示又等于把大部分真实用量藏起来，
 * 所以并列一行 + 一句说明，让"总成本覆盖了什么范围"变得可判断。
 */
function sidechainRow(sidechain: SidechainSummary): readonly string[] {
  const detail =
    `${formatWithThousandsSeparator(sidechain.turnCount)} turn · ` +
    `${formatTokens(usageTotal(sidechain.usage))} token · ` +
    `${formatCost(sidechain.cost.totalCost)} · ` +
    `${formatWithThousandsSeparator(sidechain.requestCount)} 次计费请求`
  return ['subagent 活动', detail]
}

/** 输入列把三种输入 token 合并：直连 + 缓存写 + 缓存读 */
function inputTokensOf(model: ModelStats): number {
  return model.usage.inputTokens + model.usage.cacheCreationTokens + model.usage.cacheReadTokens
}

function modelRows(stats: AggregatedStats): readonly (readonly string[])[] {
  const total = stats.cost.totalCost
  return stats.byModel.map((model) => [
    model.model,
    formatWithThousandsSeparator(model.requestCount),
    formatTokens(inputTokensOf(model)),
    formatTokens(model.usage.outputTokens),
    formatCost(model.cost.totalCost),
    total > 0 ? formatPercent(model.cost.totalCost / total) : UNKNOWN,
  ])
}

function toolRows(tools: readonly ToolStats[]): readonly (readonly string[])[] {
  return tools
    .slice(0, TOP_TOOL_LIMIT)
    .map((tool) => [
      tool.toolName,
      formatWithThousandsSeparator(tool.callCount),
      formatWithThousandsSeparator(tool.errorCount),
      formatWithThousandsSeparator(tool.totalResultBytes),
    ])
}

function renderHuman(
  ctx: CliContext,
  stats: AggregatedStats,
  tools: readonly ToolStats[],
  window: WindowTotals | null,
  palette: Palette,
): void {
  ctx.stdout(`${palette.bold('Turnflare 统计')}\n\n`)
  ctx.stdout(`${renderRows(OVERVIEW_HEAD, overviewRows(stats), EMPTY_HINT)}\n`)

  // 口径说明紧贴总览表：它解释的正是上面那几行的覆盖范围
  if (hasSidechainActivity(stats)) {
    ctx.stdout(`\n${palette.cyan(SIDECHAIN_NOTE)}\n`)
  }

  if (window !== null) {
    const line = `最近 ${String(window.days)} 天：${formatTokens(window.tokens)} · ${formatCost(window.cost)} · ${String(window.requests)} 次计费请求`
    ctx.stdout(`\n${palette.cyan(line)}\n`)
  }

  // 窗口只覆盖时间线，两张分布表因此标注全量口径
  const scope = window === null ? '' : '（全量口径）'
  ctx.stdout(`\n${palette.bold(`模型分布${scope}`)}\n\n`)
  ctx.stdout(`${renderRows(MODEL_HEAD, modelRows(stats), '暂无模型数据', MODEL_ALIGNS)}\n`)

  ctx.stdout(`\n${palette.bold(`Top 工具${scope}`)}\n\n`)
  ctx.stdout(`${renderRows(TOOL_HEAD, toolRows(tools), '暂无工具调用数据', TOOL_ALIGNS)}\n`)

  if (stats.cost.unpricedModel) {
    ctx.stdout(`\n${palette.yellow(UNPRICED_WARNING)}\n`)
  }
}

/**
 * Markdown 报表。
 *
 * 必须和 renderHuman 呈现同样的窗口信息：`--days N` 对三种输出格式都要生效，
 * 否则同一份数据在 markdown 里少一段，存进文件或贴进 issue 时会被当成
 * "没有窗口过滤"来读。窗口只覆盖时间线，两张分布表因此标注全量口径——
 * 这一点也和人类版保持一致。侧链行与口径说明同理：markdown 是存档/贴 issue 用的，
 * 少一句话就会让人把"总成本"读成全部用量。
 */
function renderMarkdown(
  ctx: CliContext,
  stats: AggregatedStats,
  tools: readonly ToolStats[],
  window: WindowTotals | null,
): void {
  ctx.stdout('# Turnflare 统计\n\n')
  ctx.stdout(`${renderMarkdownTable({ head: OVERVIEW_HEAD, rows: overviewRows(stats) })}\n\n`)

  if (hasSidechainActivity(stats)) {
    ctx.stdout(`> ${SIDECHAIN_NOTE}\n\n`)
  }

  if (window !== null) {
    ctx.stdout(
      `最近 ${String(window.days)} 天：${formatTokens(window.tokens)} · ` +
        `${formatCost(window.cost)} · ${String(window.requests)} 次计费请求\n\n`,
    )
  }

  const scope = window === null ? '' : '（全量口径）'
  ctx.stdout(`## 模型分布${scope}\n\n`)
  ctx.stdout(`${renderMarkdownTable({ head: MODEL_HEAD, rows: modelRows(stats) })}\n\n`)
  ctx.stdout(`## Top 工具${scope}\n\n`)
  ctx.stdout(`${renderMarkdownTable({ head: TOOL_HEAD, rows: toolRows(tools) })}\n`)
  if (stats.cost.unpricedModel) {
    ctx.stdout(`\n> ${UNPRICED_WARNING}\n`)
  }
}

export function createStatsCommand(deps: StatsDeps): Command<StatsOptions> {
  return {
    name: 'stats',
    description: '终端统计报表',
    usage: 'turnflare stats [--days N] [--format table|markdown]',
    run: (ctx: CliContext, options: StatsOptions): CommandResult => {
      const storage = openStorageFromEnv(ctx.env, deps, { requireExisting: true })
      if (storage.kind !== 'ok') {
        return storageFailure(storage)
      }

      try {
        const stats = storage.repo.getOverview()
        const tools = storage.repo.getToolStats()
        const window = readWindow(storage.repo, options.days, new Date())

        if (options.json) {
          ctx.stdout(
            `${JSON.stringify({ generatedAt: new Date().toISOString(), window, overview: stats }, null, 2)}\n`,
          )
          return SUCCESS
        }

        if (stats.sessionCount === 0) {
          ctx.stdout(`${EMPTY_HINT}\n`)
          return SUCCESS
        }

        // markdown 是要存进文件/贴进 issue 的文本，绝不能带 ANSI 颜色；
        // 只有终端表格才按 TTY / NO_COLOR 决定上色。
        if (options.format === 'markdown') {
          renderMarkdown(ctx, stats, tools, window)
          return SUCCESS
        }

        renderHuman(ctx, stats, tools, window, createPalette(shouldUseColor(ctx.env, false)))
        return SUCCESS
      } catch (error: unknown) {
        return runtimeFailure(ctx, error, '读取统计数据失败')
      } finally {
        closeStorage(storage.db)
      }
    },
  }
}
