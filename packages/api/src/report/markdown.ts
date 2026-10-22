/**
 * @turnflare/api —— Markdown 报表。
 *
 * 面向"贴进 issue / 周报"的场景：纯文本、GitHub 可直接渲染。
 * 数字一律走 core 的格式化函数（formatCost / formatPercent / ...），
 * 与 CLI、Web 展示层保持同一套口径。
 */

import { formatCost, formatPercent, formatWithThousandsSeparator } from '@turnflare/core'
import type { ModelStats, ProjectStats, ToolStats } from '../types.js'
import type { ReportPayload, RenderedReport } from './index.js'

const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8'

const REPORT_TITLE = 'Turnflare 用量报表'

/** 工具表只列调用最多的前 10 个，避免长尾把报表撑爆 */
const TOP_TOOL_LIMIT = 10

const EMPTY_PLACEHOLDER = '暂无数据'

const DASH_PLACEHOLDER = '—'

const TABLE_SEPARATOR_CELL = '---'

function toRow(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`
}

function toSeparator(columnCount: number): string {
  return toRow(Array.from({ length: columnCount }, () => TABLE_SEPARATOR_CELL))
}

/** 空表的占位行：第一列说明原因，其余用破折号对齐 */
function toEmptyRow(columnCount: number): string {
  return toRow(
    Array.from({ length: columnCount }, (_, index) =>
      index === 0 ? EMPTY_PLACEHOLDER : DASH_PLACEHOLDER,
    ),
  )
}

/** 竖线会撑破表格结构、换行会截断一行，入库前先转义 */
function toCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function toTokenCell(value: number): string {
  return formatWithThousandsSeparator(value)
}

function renderOverviewTable(overview: ReportPayload['overview']): string {
  const rows: readonly (readonly string[])[] = [
    ['总会话数', toTokenCell(overview.sessionCount)],
    ['对话轮次', toTokenCell(overview.turnCount)],
    ['输入 Token', toTokenCell(overview.usage.inputTokens)],
    ['缓存写入 Token', toTokenCell(overview.usage.cacheCreationTokens)],
    ['缓存读取 Token', toTokenCell(overview.usage.cacheReadTokens)],
    ['输出 Token', toTokenCell(overview.usage.outputTokens)],
    ['思考 Token', toTokenCell(overview.usage.thinkingTokens)],
    ['总成本', formatCost(overview.cost.totalCost)],
    ['缓存命中率', formatPercent(overview.cacheHitRate)],
    ['工具错误率', formatPercent(overview.errorRate)],
    ['首次活动', overview.firstActivityAt ?? DASH_PLACEHOLDER],
    ['最近活动', overview.lastActivityAt ?? DASH_PLACEHOLDER],
  ]
  return ['## 总览', '', toRow(['指标', '数值']), toSeparator(2), ...rows.map(toRow)].join('\n')
}

function renderModelTable(models: readonly ModelStats[]): string {
  const columnCount = 6
  const body =
    models.length === 0
      ? [toEmptyRow(columnCount)]
      : models.map((stat) =>
          toRow([
            toCell(stat.model),
            toTokenCell(stat.requestCount),
            toTokenCell(stat.usage.inputTokens),
            toTokenCell(stat.usage.cacheReadTokens),
            toTokenCell(stat.usage.outputTokens),
            formatCost(stat.cost.totalCost),
          ]),
        )
  return [
    '## 模型分布',
    '',
    toRow(['模型', '请求数', '输入 Token', '缓存读取 Token', '输出 Token', '总成本']),
    toSeparator(columnCount),
    ...body,
  ].join('\n')
}

function renderProjectTable(projects: readonly ProjectStats[]): string {
  const columnCount = 4
  const body =
    projects.length === 0
      ? [toEmptyRow(columnCount)]
      : projects.map((stat) =>
          toRow([
            toCell(stat.projectSlug),
            toTokenCell(stat.sessionCount),
            toTokenCell(stat.usage.inputTokens + stat.usage.outputTokens),
            formatCost(stat.cost.totalCost),
          ]),
        )
  return [
    '## 项目分布',
    '',
    toRow(['项目', '会话数', '输入 + 输出 Token', '总成本']),
    toSeparator(columnCount),
    ...body,
  ].join('\n')
}

function renderToolTable(tools: readonly ToolStats[]): string {
  const columnCount = 4
  // 仓储已按 callCount 降序，这里再排一次：报表不该依赖上游的排序承诺
  const ranked = [...tools].toSorted((left, right) => right.callCount - left.callCount)
  const visible = ranked.slice(0, TOP_TOOL_LIMIT)
  const body =
    visible.length === 0
      ? [toEmptyRow(columnCount)]
      : visible.map((stat) =>
          toRow([
            toCell(stat.toolName),
            toTokenCell(stat.callCount),
            toTokenCell(stat.errorCount),
            toTokenCell(stat.totalResultBytes),
          ]),
        )
  return [
    `## Top 工具（按调用次数，最多 ${TOP_TOOL_LIMIT} 个）`,
    '',
    toRow(['工具', '调用次数', '错误次数', '结果字节数']),
    toSeparator(columnCount),
    ...body,
  ].join('\n')
}

/** 渲染中文 Markdown 报表 */
export function renderMarkdownReport(payload: ReportPayload): RenderedReport {
  const lines: readonly string[] = [
    `# ${REPORT_TITLE}`,
    '',
    `- 生成时间：${toCell(payload.generatedAt)}`,
    ...(payload.filters === undefined
      ? []
      : [`- Filters (UTC, until exclusive): ${toCell(JSON.stringify(payload.filters))}`]),
    `- 会话数：${toTokenCell(payload.overview.sessionCount)}`,
    `- 总成本：${formatCost(payload.overview.cost.totalCost)}`,
    '',
    renderOverviewTable(payload.overview),
    '',
    renderModelTable(payload.models),
    '',
    renderProjectTable(payload.projects),
    '',
    renderToolTable(payload.tools),
    '',
  ]
  return { contentType: MARKDOWN_CONTENT_TYPE, body: lines.join('\n') }
}
