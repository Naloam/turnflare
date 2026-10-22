import { t, useLocale } from '../lib/locale'
import type { SessionOrder, SessionSortKey } from '../lib/sessionsQuery'
import { SESSION_SORT_OPTIONS } from '../lib/sessionsQuery'

export interface SessionFiltersProps {
  readonly projects: readonly string[]
  readonly project: string | null
  readonly sort: SessionSortKey
  readonly order: SessionOrder
  readonly onProjectChange: (project: string | null) => void
  readonly onSortChange: (sort: SessionSortKey) => void
  readonly onOrderToggle: () => void
  readonly onScan: () => void
  readonly scanning: boolean
}

const SELECT_CLASS =
  'focus-ring rounded-full border border-border-subtle bg-surface-1 px-3 py-1.5 text-sm text-ink-1'

/** 会话列表顶部工具栏：项目筛选 + 排序切换 + 触发扫描。 */
export function SessionFilters({
  projects,
  project,
  sort,
  order,
  onProjectChange,
  onSortChange,
  onOrderToggle,
  onScan,
  scanning,
}: SessionFiltersProps) {
  useLocale()

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="session-filters">
      <label className="flex items-center gap-2 text-sm text-ink-2">
        {t('项目')}
        <select
          className={SELECT_CLASS}
          value={project ?? ''}
          onChange={(event) => {
            const next = event.target.value
            onProjectChange(next.length === 0 ? null : next)
          }}
        >
          <option value="">{t('全部')}</option>
          {projects.map((slug) => (
            <option key={slug} value={slug}>
              {slug}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm text-ink-2">
        {t('排序')}
        <select
          className={SELECT_CLASS}
          value={sort}
          onChange={(event) => {
            const next = SESSION_SORT_OPTIONS.find((option) => option.value === event.target.value)
            if (next !== undefined) {
              onSortChange(next.value)
            }
          }}
        >
          {SESSION_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="focus-ring rounded-full border border-border-subtle px-3 py-1.5 text-sm text-ink-1"
        onClick={onOrderToggle}
      >
        {order === 'desc' ? t('降序') : t('升序')}
      </button>

      <button
        type="button"
        className="focus-ring ml-auto rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-surface-0 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={onScan}
        disabled={scanning}
      >
        {scanning ? t('扫描中…') : t('触发扫描')}
      </button>
    </div>
  )
}
