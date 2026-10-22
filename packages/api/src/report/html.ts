/**
 * @turnflare/api —— HTML 报表。
 *
 * 硬约束：**自包含单文件**。图表是手写 SVG、样式是内联 `<style>`，
 * 不引用任何外部 CSS / 字体 / 脚本——报告要能当附件发出去、断网打开。
 *
 * 安全约束：所有来自数据的字符串（模型名、项目 slug、工具名、时间戳）
 * 进 HTML 前必须过 `escapeHtml`。这些值来自解析用户自己的 jsonl，
 * 内容完全不可控，直接插值就是一个存储型 XSS。
 */

import {
  formatCost,
  formatPercent,
  formatTokens,
  formatWithThousandsSeparator,
  usageTotal,
} from '@turnflare/core'
import type { AggregatedStats, ModelStats, ProjectStats, TimeBucket, ToolStats } from '../types.js'
import type { ReportPayload, RenderedReport } from './index.js'

const HTML_CONTENT_TYPE = 'text/html; charset=utf-8'

const PAGE_TITLE = 'Turnflare 用量报表'

const TOP_TOOL_LIMIT = 10

const EMPTY_PLACEHOLDER = '暂无数据'

// ─── 图表几何（像素） ────────────────────────────────────────────────────────

const CHART_WIDTH = 720
const CHART_HEIGHT = 260
const CHART_PADDING_TOP = 28
const CHART_PADDING_BOTTOM = 44
const CHART_PADDING_LEFT = 60
const CHART_PADDING_RIGHT = 16

/** 相邻柱子的间距，从柱槽宽度里扣 */
const BAR_GAP = 8

/** 有成本的日期至少画出这么高，否则肉眼看不见 */
const MIN_BAR_HEIGHT = 2

/** 柱子宽于该值时才在柱顶标数值，避免文字互相叠住 */
const MIN_LABEL_BAR_WIDTH = 26

/** 横轴最多标几个日期，多出来的按间隔抽稀 */
const MAX_X_LABELS = 8

/**
 * HTML 转义。
 *
 * 五个字符全覆盖：`&` 必须第一个替换，否则后面的 `&amp;` 会被二次转义。
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

interface BarGeometry {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly label: string
  readonly value: number
}

interface ChartModel {
  readonly bars: readonly BarGeometry[]
  readonly showValueLabels: boolean
  readonly baselineY: number
  /** 横轴标签抽稀间隔 */
  readonly labelInterval: number
}

/** 把时间桶摊成柱面几何；成本全为 0 时所有柱子高度为 0（画一条基线） */
function toChartModel(buckets: readonly TimeBucket[]): ChartModel {
  const plotWidth = CHART_WIDTH - CHART_PADDING_LEFT - CHART_PADDING_RIGHT
  const plotHeight = CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM
  const maxCost = buckets.reduce((max, bucket) => Math.max(max, bucket.cost.totalCost), 0)
  const slot = plotWidth / buckets.length
  const barWidth = Math.max(1, Math.floor(slot - BAR_GAP))
  const baselineY = CHART_PADDING_TOP + plotHeight

  const bars = buckets.map((bucket, index) => {
    const ratio = maxCost > 0 ? bucket.cost.totalCost / maxCost : 0
    const scaledHeight = Math.round(ratio * plotHeight)
    const height = bucket.cost.totalCost > 0 ? Math.max(MIN_BAR_HEIGHT, scaledHeight) : 0
    return {
      x: CHART_PADDING_LEFT + Math.floor(index * slot) + Math.floor((slot - barWidth) / 2),
      y: baselineY - height,
      width: barWidth,
      height,
      label: bucket.bucket,
      value: bucket.cost.totalCost,
    }
  })

  return {
    bars,
    showValueLabels: barWidth >= MIN_LABEL_BAR_WIDTH,
    baselineY,
    labelInterval: Math.max(1, Math.ceil(buckets.length / MAX_X_LABELS)),
  }
}

/** 日桶形如 `2026-10-19`，横轴只显示月日，否则八个字挤不下 */
function toDayLabel(bucket: string): string {
  return bucket.length >= 10 ? bucket.slice(5, 10) : bucket
}

function renderChart(buckets: readonly TimeBucket[]): string {
  if (buckets.length === 0) {
    return `<p class="empty">${EMPTY_PLACEHOLDER}</p>`
  }
  const model = toChartModel(buckets)
  const axisRight = CHART_WIDTH - CHART_PADDING_RIGHT

  const bars = model.bars
    .map((bar) => {
      // <title> 是 SVG 原生的悬浮提示，不需要 JS
      const tip = `${bar.label}：${formatCost(bar.value)}`
      const valueLabel = model.showValueLabels
        ? `<text class="bar-value" x="${bar.x + bar.width / 2}" y="${bar.y - 6}" text-anchor="middle">${escapeHtml(formatCost(bar.value))}</text>`
        : ''
      return `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" rx="2"><title>${escapeHtml(tip)}</title></rect>${valueLabel}`
    })
    .join('')

  const axisLabels = model.bars
    .map((bar, index) =>
      index % model.labelInterval === 0
        ? `<text class="bar-label" x="${bar.x + bar.width / 2}" y="${model.baselineY + 20}" text-anchor="middle">${escapeHtml(toDayLabel(bar.label))}</text>`
        : '',
    )
    .join('')

  const baseline = `<line class="axis" x1="${CHART_PADDING_LEFT}" y1="${model.baselineY}" x2="${axisRight}" y2="${model.baselineY}" />`

  return `<svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" role="img" aria-label="每日成本柱状图">${baseline}${bars}${axisLabels}</svg>`
}

/** 表格；rows 里的单元格由调用方负责转义，表头是静态中文 */
function toTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>`
  const body =
    rows.length === 0
      ? `<tbody><tr><td colspan="${headers.length}">${EMPTY_PLACEHOLDER}</td></tr></tbody>`
      : `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>`
  return `<table>${head}${body}</table>`
}

function toKpis(overview: AggregatedStats): string {
  const kpis: readonly (readonly [string, string])[] = [
    ['总会话数', formatWithThousandsSeparator(overview.sessionCount)],
    ['对话轮次', formatWithThousandsSeparator(overview.turnCount)],
    ['总 Token', formatTokens(usageTotal(overview.usage))],
    ['总成本', formatCost(overview.cost.totalCost)],
    ['缓存命中率', formatPercent(overview.cacheHitRate)],
    ['工具错误率', formatPercent(overview.errorRate)],
  ]
  const cards = kpis
    .map(
      ([label, value]) =>
        `<div class="kpi"><span class="kpi-label">${escapeHtml(label)}</span><strong class="kpi-value">${escapeHtml(value)}</strong></div>`,
    )
    .join('')
  return `<section class="kpis">${cards}</section>`
}

function toModelRows(models: readonly ModelStats[]): readonly (readonly string[])[] {
  return models.map((stat) => [
    escapeHtml(stat.model),
    formatWithThousandsSeparator(stat.requestCount),
    formatWithThousandsSeparator(stat.usage.inputTokens),
    formatWithThousandsSeparator(stat.usage.outputTokens),
    formatCost(stat.cost.totalCost),
  ])
}

function toProjectRows(projects: readonly ProjectStats[]): readonly (readonly string[])[] {
  return projects.map((stat) => [
    escapeHtml(stat.projectSlug),
    formatWithThousandsSeparator(stat.sessionCount),
    formatWithThousandsSeparator(stat.usage.inputTokens + stat.usage.outputTokens),
    formatCost(stat.cost.totalCost),
  ])
}

function toToolRows(tools: readonly ToolStats[]): readonly (readonly string[])[] {
  const ranked = [...tools].toSorted((left, right) => right.callCount - left.callCount)
  return ranked
    .slice(0, TOP_TOOL_LIMIT)
    .map((stat) => [
      escapeHtml(stat.toolName),
      formatWithThousandsSeparator(stat.callCount),
      formatWithThousandsSeparator(stat.errorCount),
      formatWithThousandsSeparator(stat.totalResultBytes),
    ])
}

const INLINE_STYLES = [
  ':root { color-scheme: light dark; }',
  'body { font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif; margin: 24px; line-height: 1.5; }',
  'h1 { font-size: 22px; margin: 0 0 4px; }',
  'h2 { font-size: 16px; margin: 28px 0 12px; }',
  '.generated { color: #666; font-size: 13px; margin: 0 0 20px; }',
  '.kpis { display: flex; flex-wrap: wrap; gap: 12px; }',
  '.kpi { border: 1px solid #d0d0d0; border-radius: 8px; padding: 10px 14px; min-width: 132px; }',
  '.kpi-label { display: block; font-size: 12px; color: #666; }',
  '.kpi-value { display: block; font-size: 18px; margin-top: 2px; }',
  'table { border-collapse: collapse; width: 100%; font-size: 13px; }',
  'th, td { border: 1px solid #d0d0d0; padding: 6px 10px; text-align: left; }',
  'th { background: #f2f2f2; }',
  '.axis { stroke: #999; stroke-width: 1; }',
  'rect { fill: #4c7ef3; }',
  '.bar-value, .bar-label { fill: #555; font-size: 11px; }',
  '.empty { color: #888; }',
  '@media (prefers-color-scheme: dark) { .kpi, th, td { border-color: #444; } th { background: #2a2a2a; } .bar-value, .bar-label { fill: #bbb; } }',
].join('\n')

/** 渲染自包含 HTML 报表 */
export function renderHtmlReport(payload: ReportPayload): RenderedReport {
  const sections: readonly string[] = [
    `<h1>${PAGE_TITLE}</h1>`,
    `<p class="generated">生成时间：${escapeHtml(payload.generatedAt)}</p>`,
    toKpis(payload.overview),
    '<h2>每日成本趋势</h2>',
    renderChart(payload.timeline),
    '<h2>模型分布</h2>',
    toTable(['模型', '请求数', '输入 Token', '输出 Token', '总成本'], toModelRows(payload.models)),
    '<h2>项目分布</h2>',
    toTable(['项目', '会话数', '输入 + 输出 Token', '总成本'], toProjectRows(payload.projects)),
    `<h2>Top 工具（按调用次数，最多 ${TOP_TOOL_LIMIT} 个）</h2>`,
    toTable(['工具', '调用次数', '错误次数', '结果字节数'], toToolRows(payload.tools)),
  ]
  const body = sections.join('\n')
  return {
    contentType: HTML_CONTENT_TYPE,
    body: `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${PAGE_TITLE}</title>
<style>
${INLINE_STYLES}
</style>
</head>
<body>
${body}
</body>
</html>
`,
  }
}
