/**
 * 数字与百分比格式化。
 */

const NOT_AVAILABLE = '-'
const THOUSAND = 1_000
const MILLION = 1_000_000
const BILLION = 1_000_000_000

/** 有效数字位数：足够抹掉二进制浮点的表示噪声，又不影响正常数值 */
const PRECISION_DIGITS = 15

/**
 * 百分比：0.8765 -> "87.7%"（默认 1 位），1 -> "100%"。
 * 非有限值返回 "-"。
 */
export function formatPercent(ratio: number, fractionDigits = 1): string {
  if (!Number.isFinite(ratio)) {
    return NOT_AVAILABLE
  }

  // 必须先清洗浮点噪声再舍入：0.8765 * 100 在二进制下实际是 87.64999999999999，
  // 直接 toFixed(1) 会得到 "87.6%"，而数学上的四舍五入结果应为 "87.7%"。
  // toPrecision(15) 把这些表示噪声压掉，且不会误伤正常量级的数值。
  const percent = Number((ratio * 100).toPrecision(PRECISION_DIGITS))
  return `${percent.toFixed(fractionDigits)}%`
}

/** 紧凑数字：12345 -> "12.3K" */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return NOT_AVAILABLE
  }

  const absolute = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (absolute < THOUSAND) {
    return sign + String(Math.trunc(absolute))
  }
  if (absolute < MILLION) {
    return `${sign}${(absolute / THOUSAND).toFixed(1)}K`
  }
  if (absolute < BILLION) {
    return `${sign}${(absolute / MILLION).toFixed(1)}M`
  }
  return `${sign}${(absolute / BILLION).toFixed(1)}B`
}

/** 千分位：40198 -> "40,198" */
export function formatWithThousandsSeparator(value: number): string {
  if (!Number.isFinite(value)) {
    return NOT_AVAILABLE
  }
  const truncated = Math.trunc(value)
  const sign = truncated < 0 ? '-' : ''
  const digits = String(Math.abs(truncated))
  const parts: string[] = []
  for (let end = digits.length; end > 0; end -= 3) {
    const start = Math.max(0, end - 3)
    parts.unshift(digits.slice(start, end))
  }
  return sign + parts.join(',')
}

/** 字节数：1536 -> "1.5 KB"，1048576 -> "1.0 MB" */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return NOT_AVAILABLE
  }
  const KB = 1024
  const MB = KB * 1024
  const GB = MB * 1024

  if (bytes < KB) {
    return `${Math.trunc(bytes)} B`
  }
  if (bytes < MB) {
    return `${(bytes / KB).toFixed(1)} KB`
  }
  if (bytes < GB) {
    return `${(bytes / MB).toFixed(1)} MB`
  }
  return `${(bytes / GB).toFixed(1)} GB`
}
