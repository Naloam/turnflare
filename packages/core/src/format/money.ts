/**
 * 金额格式化。输入为美元，输出统一带 $ 前缀。
 */

const NOT_AVAILABLE = '-'
const THOUSAND = 1_000
const MILLION = 1_000_000

/** 小于该阈值的金额展示 4 位小数，否则 2 位 */
const SMALL_AMOUNT_THRESHOLD = 0.01

/** 千分位分组（仅整数部分） */
function groupThousands(digits: string): string {
  const parts: string[] = []
  for (let end = digits.length; end > 0; end -= 3) {
    const start = Math.max(0, end - 3)
    parts.unshift(digits.slice(start, end))
  }
  return parts.join(',')
}

/**
 * 标准格式：1.2345 -> "$1.23"，0.004 -> "$0.0040"，1234.5 -> "$1,234.50"。
 * 非有限值返回 "-"。
 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) {
    return NOT_AVAILABLE
  }

  const absolute = Math.abs(usd)
  const sign = usd < 0 ? '-' : ''
  const isSmall = absolute > 0 && absolute < SMALL_AMOUNT_THRESHOLD
  const fractionDigits = isSmall ? 4 : 2
  const fixed = absolute.toFixed(fractionDigits)
  const [integerPart = '0', fractionPart = ''] = fixed.split('.')

  const grouped = groupThousands(integerPart)
  const withFraction = fractionPart.length > 0 ? `${grouped}.${fractionPart}` : grouped
  return `${sign}$${withFraction}`
}

/**
 * 紧凑格式：1234.5 -> "$1.2K"，0.5 -> "$0.50"。
 * 非有限值返回 "-"。
 */
export function formatCostCompact(usd: number): string {
  if (!Number.isFinite(usd)) {
    return NOT_AVAILABLE
  }

  const absolute = Math.abs(usd)
  const sign = usd < 0 ? '-' : ''

  if (absolute < THOUSAND) {
    return formatCost(usd)
  }
  if (absolute < MILLION) {
    return `${sign}$${(absolute / THOUSAND).toFixed(1)}K`
  }
  return `${sign}$${(absolute / MILLION).toFixed(1)}M`
}
