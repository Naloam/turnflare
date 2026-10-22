import { t, useLocale } from '../lib/locale'
import { desktopBridge } from '../lib/desktop'
interface EmptyStateProps {
  readonly title: string
  readonly description?: string
  readonly actionLabel?: string
  readonly onAction?: () => void
}

/** 空数据态：说清楚"为什么空"和"下一步做什么"，而不是只扔一个图标。 */
export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  useLocale()
  const hasAction = actionLabel !== undefined && onAction !== undefined
  return (
    <div
      className="card flex flex-col items-center gap-3 px-6 py-12 text-center"
      data-testid="empty-state"
    >
      <p className="text-base font-medium text-ink-1">{t(title)}</p>
      {description === undefined ? null : (
        <p className="max-w-md text-sm text-ink-2">
          {t(
            desktopBridge() && description.includes('turnflare scan')
              ? '未找到会话记录。选择顶部的日志目录，或先体验示例数据。'
              : description,
          )}
        </p>
      )}
      {hasAction ? (
        <button
          type="button"
          className="focus-ring mt-1 rounded-full bg-accent px-4 py-2 text-sm font-medium text-surface-0"
          onClick={onAction}
        >
          {t(actionLabel)}
        </button>
      ) : null}
    </div>
  )
}
