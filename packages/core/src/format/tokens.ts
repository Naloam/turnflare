/**
 * token 数量的紧凑与精确格式化。
 *
 * 全部为纯函数：不修改入参、无副作用、可 tree-shake。
 */

const THOUSAND = 1_000
const MILLION = 1_000_000
const BILLION = 1_000_000_000

const NOT_AVAILABLE = '-'

/** 保留一位小数，但整数值不带小数点（40 -> "40"，40.25 -> "40.3"） */
function formatOneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function groupThousands(digits: string): string {
  const parts: string[] = []
  for (let end = digits.length; end > 0; end -= 3) {
    const start = Math.max(0, end - 3)
    parts.unshift(digits.slice(start, end))
  }
  return parts.join(',')
}

/**
 * 紧凑格式：40198 -> "40.2K"，1500000 -> "1.5M"，999 -> "999"。
 * 非有限值返回 "-"。
 */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count)) {
    return NOT_AVAILABLE
  }

  const absolute = Math.abs(count)
  const sign = count < 0 ? '-' : ''

  if (absolute < THOUSAND) {
    return sign + String(Math.trunc(absolute))
  }
  if (absolute < MILLION) {
    return sign + formatOneDecimal(absolute / THOUSAND) + 'K'
  }
  if (absolute < BILLION) {
    return sign + formatOneDecimal(absolute / MILLION) + 'M'
  }
  return sign + formatOneDecimal(absolute / BILLION) + 'B'
}

/** 精确格式：40198 -> "40,198"。非有限值返回 "-"。 */
export function formatTokensDetailed(count: number): string {
  if (!Number.isFinite(count)) {
    return NOT_AVAILABLE
  }
  const truncated = Math.trunc(count)
  const sign = truncated < 0 ? '-' : ''
  return sign + groupThousands(String(Math.abs(truncated)))
}
