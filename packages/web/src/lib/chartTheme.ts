/**
 * 图表视觉常量。
 *
 * 硬性要求：颜色必须来自 index.css 里的设计 token（CSS 变量），
 * 禁止写死 oklch(...) / #hex —— 否则深浅色切换时图表会有一半元素留在旧主题里。
 * SVG 的 fill / stroke 属性可以直接吃 CSS 变量，且变量在 `.dark` 下被重新定义，
 * 因此同一份配置在两种主题下都正确。
 */

/** 分类色板：饼图扇区、堆叠柱系列按序取用 */
export const CHART_SERIES_COLORS: readonly string[] = [
  'var(--color-accent)',
  'var(--color-positive)',
  'var(--color-warning)',
  'var(--color-danger)',
  'var(--color-ink-3)',
  'var(--color-ink-2)',
]

/**
 * 按索引取系列色，超出色板长度时循环取用。
 *
 * 单独包一层而不是直接 `CHART_SERIES_COLORS[i]`：noUncheckedIndexedAccess 会让下标访问
 * 变成 `string | undefined`，而 Recharts 的 stroke/fill 在 exactOptionalPropertyTypes 下
 * 不接受 undefined，必须在这里给出确定值。
 */
export function chartSeriesColor(index: number): string {
  return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length] ?? 'var(--color-ink-3)'
}

/** 坐标轴文字与刻度线 */
export const CHART_AXIS_COLOR = 'var(--color-ink-3)'

/** 网格线 */
export const CHART_GRID_COLOR = 'var(--color-border-subtle)'

/** 图表统一高度，避免不同卡片高度跳动 */
export const CHART_HEIGHT = 260

/** 图表内边距：左侧留给 Y 轴刻度，右侧留一点给末端数据点 */
export const CHART_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 }

/** 坐标轴字号 */
export const CHART_AXIS_FONT_SIZE = 12

/** Y 轴宽度，需容纳 "$1.2K" 这类刻度文案 */
export const CHART_Y_AXIS_WIDTH = 56

/** 分类 Y 轴宽度，需容纳完整项目 slug */
export const CHART_CATEGORY_AXIS_WIDTH = 140

/** 网格虚线样式 */
export const CHART_GRID_DASHARRAY = '3 3'

/** 饼图外径占容器高度的比例 */
export const PIE_OUTER_RADIUS_RATIO = 0.78
