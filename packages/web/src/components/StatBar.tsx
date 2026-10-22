import { formatPercent } from '../lib/format'

interface StatBarProps {
  /** 占比，0~1；超出范围会被夹紧，NaN 视为 0 */
  readonly ratio: number
  /** 是否在条子右侧显示百分比；占比语义不是"整体中的份额"时应关掉 */
  readonly showPercent?: boolean
}

/** 把占比夹紧到 [0,1]，NaN / 非有限值一律按 0 处理 */
function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return 0
  }
  return Math.min(1, Math.max(0, ratio))
}

/** 细横条占比展示：条 + 可选百分比，用于表格里的"占比"列。 */
export function StatBar({ ratio, showPercent = true }: StatBarProps) {
  const safeRatio = clampRatio(ratio)
  return (
    <div className="flex items-center gap-2" data-testid="stat-bar">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2" role="presentation">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${safeRatio * 100}%` }}
          role="presentation"
          data-testid="stat-bar-fill"
        />
      </div>
      {showPercent ? (
        <span className="text-xs tabular-nums text-ink-2">{formatPercent(safeRatio)}</span>
      ) : null}
    </div>
  )
}
