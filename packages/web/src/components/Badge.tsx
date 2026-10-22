import type { ReactNode } from 'react'

/** 徽标语气：与 index.css 的语义色一一对应 */
export type BadgeTone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger'

interface BadgeProps {
  readonly tone?: BadgeTone
  readonly children: ReactNode
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  accent: 'bg-accent-soft text-accent',
  positive: 'bg-accent-soft text-positive',
  warning: 'bg-accent-soft text-warning',
  danger: 'bg-accent-soft text-danger',
}

/** 角色 / 状态徽标。小字号 + 圆角，用于表格单元格和时间线条目。 */
export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
      data-testid="badge"
    >
      {children}
    </span>
  )
}
