import { t, useLocale } from '../lib/locale'
interface PaginationProps {
  /** 当前页码，从 1 开始 */
  readonly page: number
  readonly canGoPrev: boolean
  readonly canGoNext: boolean
  readonly onPrev: () => void
  readonly onNext: () => void
}

/** 分页条：上一页 / 下一页 + 当前页码。总数由调用方按返回条数推断。 */
export function Pagination({ page, canGoPrev, canGoNext, onPrev, onNext }: PaginationProps) {
  useLocale()

  return (
    <nav
      className="flex items-center justify-between gap-3"
      data-testid="pagination"
      aria-label={t('分页')}
    >
      <button
        type="button"
        className="focus-ring rounded-full border border-border-subtle px-3 py-1.5 text-sm text-ink-1 disabled:cursor-not-allowed disabled:text-ink-3"
        onClick={onPrev}
        disabled={!canGoPrev}
      >
        {t('上一页')}
      </button>
      <span className="text-sm tabular-nums text-ink-2">{t('第 {page} 页', { page })}</span>
      <button
        type="button"
        className="focus-ring rounded-full border border-border-subtle px-3 py-1.5 text-sm text-ink-1 disabled:cursor-not-allowed disabled:text-ink-3"
        onClick={onNext}
        disabled={!canGoNext}
      >
        {t('下一页')}
      </button>
    </nav>
  )
}
