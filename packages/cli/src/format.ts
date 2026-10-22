/**
 * 展示层格式化助手。
 *
 * 数值与金额一律委托 core 的格式化函数（`formatTokens` / `formatCost` /
 * `formatPercent`），CLI 不自己实现第二套口径——两套口径迟早对不上。
 * 本文件只做"领域对象 → 表格单元格"这一层。
 */
import {
  formatCost,
  formatDateTime,
  formatPercent,
  formatTokens,
  formatWithThousandsSeparator,
  relativeTime,
  usageTotal,
} from '@turnflare/core'
import { SESSION_ID_DISPLAY_LENGTH } from './options.js'

export { formatCost, formatPercent, formatTokens, formatWithThousandsSeparator, usageTotal }

/** 缺失值的占位符 */
export const UNKNOWN = '-'

/** 本地时区偏移分钟数；core 约定正数表示东八区 */
export function localTimezoneOffsetMinutes(now: Date = new Date()): number {
  return -now.getTimezoneOffset()
}

/** 列表里会话 ID 的展示长度（完整 ID 有 36 字符，表格里放不下） */
export function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, SESSION_ID_DISPLAY_LENGTH)
}

/** 时间戳展示；缺失时给占位符而不是空单元格 */
export function displayTimestamp(iso: string | null, timezoneOffsetMinutes: number): string {
  return iso === null || iso === '' ? UNKNOWN : formatDateTime(iso, timezoneOffsetMinutes)
}

/** 相对时间；缺失时给占位符 */
export function displayRelativeTime(iso: string | null, now?: Date): string {
  return iso === null || iso === '' ? UNKNOWN : relativeTime(iso, now)
}

/** 模型列表：一场会话可能混用多个模型，表格里合并成一格 */
export function displayModels(models: readonly string[]): string {
  return models.length === 0 ? UNKNOWN : models.join(', ')
}

/** 监听地址；host 可能是 0.0.0.0，原样展示比猜一个 localhost 更诚实 */
export function formatListenUrl(host: string, port: number): string {
  return `http://${host}:${String(port)}`
}

/** 长文本按字符数截断并加省略号 */
export function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`
}

/**
 * 剥掉 ANSI / OSC 转义序列。
 *
 * 会话 jsonl 的正文里可能带着这些控制字符（模型输出、工具结果原样落盘）。
 * 它们被写进终端后会当成指令执行——轻则颜色错乱，重则 OSC 能改窗口标题、
 * 触发响铃，甚至在某些终端里改写剪贴板。折叠空白管不到它们：\s 不含 ESC。
 *
 * 用正则字面量配 \u 转义，而不是字面 ESC 字符：后者在编辑器和 diff 里完全
 * 不可见，被人"顺手整理"之后正则静默失效，而测试若没覆盖就又发现不了。
 *
 * 三类序列：
 *   CSI  ESC [ … 终结字节（颜色、光标移动）
 *   OSC  ESC ] … BEL 或 ST（窗口标题、超链接）
 *   其余两字符 ESC 序列（如 ESC ( B 的字符集切换）
 */
const ANSI_PATTERN = new RegExp(
  [
    '\\u001b\\[[0-9;?]*[ -/]*[@-~]', // CSI：颜色、光标移动
    '\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)', // OSC：窗口标题、超链接，到 BEL 或 ST 为止
    '\\u001b[ -/]+[0-~]', // nF：ESC ( B 这类带中间字节的序列
    '\\u001b[0-~]', // Fp/Fe/Fs：ESC 后直接跟一个终结字节
  ].join('|'),
  'g',
)

/**
 * C0 控制字符。保留 \t 与换行——那两种交给 collapseWhitespace 处理。
 *
 * no-control-regex 在这里是误报：匹配控制字符本身就是这个正则的目的，
 * 而且全用 \u 转义书写，源码里看不到字面控制字符。
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0007]/g

/** 把不可信文本净化成可安全写进终端的形式：去转义序列、去控制字符、压空白 */
export function sanitizeForTerminal(text: string): string {
  return collapseWhitespace(text.replace(ANSI_PATTERN, '').replace(CONTROL_CHARS_PATTERN, ''))
}

/** 把换行与连续空白压成单空格：表格单元格里放不下多行文本 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 全角字符的 Unicode 区间（中日韩表意文字、假名、全角标点等）。
 *
 * 终端里一个全角字符占两列，`String.length` 却只算一列；直接用 padEnd 对齐
 * 中英混排的标签会歪掉。这里按显示宽度补空格。
 */
const WIDE_CHAR_PATTERN = new RegExp(
  '[' +
    '\\u1100-\\u115f' +
    '\\u2e80-\\u303e' +
    '\\u3041-\\u33ff' +
    '\\u3400-\\u4dbf' +
    '\\u4e00-\\u9fff' +
    '\\uac00-\\ud7a3' +
    '\\uf900-\\ufaff' +
    '\\ufe30-\\ufe6f' +
    '\\uff00-\\uff60' +
    '\\uffe0-\\uffe6' +
    ']',
)

/** 文本在终端里的显示宽度（全角字符算 2 列） */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    width += WIDE_CHAR_PATTERN.test(char) ? 2 : 1
  }
  return width
}

/** 按显示宽度右补空格 */
export function padDisplayEnd(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)))
}
