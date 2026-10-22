/**
 * @turnflare/api —— CSV 报表。
 *
 * 两个细节是给 Excel 用的，缺一个中文就花屏：
 *   1. 文件头带 UTF-8 BOM——Excel 靠它识别编码；
 *   2. 行尾用 CRLF——Excel 对裸 LF 的支持不稳定。
 * 数字保持原始精度（不加千分位、不四舍五入），这样拉进表格还能继续算。
 */

import type { AggregatedStats, ModelStats, ProjectStats, ToolStats } from '../types.js'
import type { ReportPayload, RenderedReport } from './index.js'

const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8'

/** Excel 没有 BOM 就把 UTF-8 当本地编码读，中文全是乱码 */
const UTF8_BOM = '\uFEFF'

/** RFC 4180 规定的行尾 */
const CSV_LINE_END = '\r\n'

const TOP_TOOL_LIMIT = 10

const EMPTY_PLACEHOLDER = '暂无数据'

type CsvCell = string | number

/**
 * 转义单个字段。
 *
 * 含逗号、引号、换行，或首尾有空白的字段必须加双引号包住；
 * 字段内的双引号还要翻倍，否则会提前结束引号区间。
 */
/**
 * 以 = + - @ 开头的字段会被 Excel / LibreOffice 当公式求值。
 * 项目 slug、模型名、工具名都来自会话数据，理论上可以被构造出这类内容，
 * 所以导出前统一加一个前置单引号——那是电子表格里"这是文本不是公式"的标准写法。
 */
const FORMULA_PREFIXES = ['=', '+', '-', '@'] as const

function neutralizeFormula(value: string): string {
  const startsWithFormula = FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix))
  return startsWithFormula ? `'${value}` : value
}

/**
 * 转义单个字段。
 *
 * 含逗号、引号、换行，或首尾有空白的字段必须加双引号包住；
 * 字段内的双引号还要翻倍，否则会提前结束引号区间。
 */
function escapeField(value: string): string {
  const safe = neutralizeFormula(value)
  const needsQuotes = /[",\r\n]/.test(safe) || safe.trim() !== safe
  const escaped = safe.replaceAll('"', '""')
  return needsQuotes ? `"${escaped}"` : escaped
}

function toRow(cells: readonly CsvCell[]): string {
  return cells.map((cell) => escapeField(typeof cell === 'number' ? String(cell) : cell)).join(',')
}

/** 一个分节：标题行 + 表头 + 数据行 + 空行分隔 */
function toSection(
  title: string,
  header: readonly string[],
  rows: readonly CsvCell[][],
): readonly string[] {
  const body = rows.length === 0 ? [[EMPTY_PLACEHOLDER]] : rows
  return [toRow([title]), toRow(header), ...body.map(toRow), '']
}

function toOverviewRows(overview: AggregatedStats, generatedAt: string): readonly CsvCell[][] {
  return [
    ['生成时间', generatedAt],
    ['总会话数', overview.sessionCount],
    ['对话轮次', overview.turnCount],
    ['输入 Token', overview.usage.inputTokens],
    ['缓存写入 Token', overview.usage.cacheCreationTokens],
    ['缓存读取 Token', overview.usage.cacheReadTokens],
    ['输出 Token', overview.usage.outputTokens],
    ['思考 Token', overview.usage.thinkingTokens],
    ['总成本（美元）', overview.cost.totalCost],
    ['缓存命中率', overview.cacheHitRate],
    ['工具错误率', overview.errorRate],
    ['首次活动', overview.firstActivityAt ?? ''],
    ['最近活动', overview.lastActivityAt ?? ''],
  ]
}

function toModelRows(models: readonly ModelStats[]): readonly CsvCell[][] {
  return models.map((stat) => [
    stat.model,
    stat.requestCount,
    stat.usage.inputTokens,
    stat.usage.cacheCreationTokens,
    stat.usage.cacheReadTokens,
    stat.usage.outputTokens,
    stat.usage.thinkingTokens,
    stat.cost.totalCost,
  ])
}

function toProjectRows(projects: readonly ProjectStats[]): readonly CsvCell[][] {
  return projects.map((stat) => [
    stat.projectSlug,
    stat.sessionCount,
    stat.usage.inputTokens,
    stat.usage.outputTokens,
    stat.cost.totalCost,
  ])
}

function toToolRows(tools: readonly ToolStats[]): readonly CsvCell[][] {
  const ranked = [...tools].toSorted((left, right) => right.callCount - left.callCount)
  return ranked
    .slice(0, TOP_TOOL_LIMIT)
    .map((stat) => [stat.toolName, stat.callCount, stat.errorCount, stat.totalResultBytes])
}

/** 渲染 CSV 报表（带 BOM） */
export function renderCsvReport(payload: ReportPayload): RenderedReport {
  const sections: readonly string[] = [
    ...toSection('总览', ['指标', '数值'], toOverviewRows(payload.overview, payload.generatedAt)),
    ...toSection(
      '模型分布',
      [
        '模型',
        '请求数',
        '输入 Token',
        '缓存写入 Token',
        '缓存读取 Token',
        '输出 Token',
        '思考 Token',
        '总成本（美元）',
      ],
      toModelRows(payload.models),
    ),
    ...toSection(
      '项目分布',
      ['项目', '会话数', '输入 Token', '输出 Token', '总成本（美元）'],
      toProjectRows(payload.projects),
    ),
    ...toSection(
      `Top 工具（按调用次数，最多 ${TOP_TOOL_LIMIT} 个）`,
      ['工具', '调用次数', '错误次数', '结果字节数'],
      toToolRows(payload.tools),
    ),
  ]
  return {
    contentType: CSV_CONTENT_TYPE,
    body: `${UTF8_BOM}${sections.join(CSV_LINE_END)}${CSV_LINE_END}`,
  }
}
