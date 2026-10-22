import { t, useLocale } from '../lib/locale'
import { isoDay } from '../lib/analytics'
import type { SessionChain } from '../types/api'

export interface UsageSelection {
  readonly start: string
  readonly end: string
  readonly project: string
  readonly model: string
  readonly chain: SessionChain
}
export const DEFAULT_SELECTION: UsageSelection = {
  start: '',
  end: '',
  project: '',
  model: '',
  chain: 'main',
}
export const CONTROL_CLASS =
  'focus-ring rounded-lg border border-border-subtle bg-surface-1 px-3 py-2 text-sm text-ink-1'

export function UsageFilters({
  value,
  projects,
  models,
  onChange,
}: {
  readonly value: UsageSelection
  readonly projects: readonly string[]
  readonly models: readonly string[]
  readonly onChange: (value: UsageSelection) => void
}) {
  useLocale()
  const update = (patch: Partial<UsageSelection>) => onChange({ ...value, ...patch })
  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap gap-2">
        {[
          [0, '全部时间'],
          [1, '今天'],
          [7, '近 7 天'],
          [30, '近 30 天'],
          [90, '近 90 天'],
        ].map(([n, label]) => (
          <button
            key={n}
            className={CONTROL_CLASS}
            onClick={() => {
              const now = new Date()
              const days = Number(n)
              update({
                start: days === 0 ? '' : isoDay(new Date(now.getTime() - (days - 1) * 86400000)),
                end: days === 0 ? '' : isoDay(now),
              })
            }}
          >
            {t(String(label))}
          </button>
        ))}
        <button
          className={CONTROL_CLASS}
          onClick={() => {
            const now = new Date()
            update({ start: `${isoDay(now).slice(0, 7)}-01`, end: isoDay(now) })
          }}
        >
          {t('本月')}
        </button>
        <button className={CONTROL_CLASS} onClick={() => onChange(DEFAULT_SELECTION)}>
          {t('重置筛选')}
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-ink-2">
          {t('开始日期（UTC）')}
          <input
            className={CONTROL_CLASS}
            type="date"
            value={value.start}
            onChange={(e) => update({ start: e.target.value })}
          />
        </label>
        <label className="grid gap-1 text-xs text-ink-2">
          {t('结束日期（含当天）')}
          <input
            className={CONTROL_CLASS}
            type="date"
            value={value.end}
            onChange={(e) => update({ end: e.target.value })}
          />
        </label>
        <label className="grid gap-1 text-xs text-ink-2">
          {t('项目')}
          <select
            className={CONTROL_CLASS}
            value={value.project}
            onChange={(e) => update({ project: e.target.value })}
          >
            <option value="">{t('全部')}</option>
            {projects.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-ink-2">
          {t('模型')}
          <select
            className={CONTROL_CLASS}
            value={value.model}
            onChange={(e) => update({ model: e.target.value })}
          >
            <option value="">{t('全部')}</option>
            {models.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-ink-2">
          {t('统计范围')}
          <select
            className={CONTROL_CLASS}
            value={value.chain}
            onChange={(e) => {
              const chain = e.target.value
              if (chain === 'main' || chain === 'side' || chain === 'all') update({ chain })
            }}
          >
            <option value="main">{t('主对话')}</option>
            <option value="all">{t('主对话 + subagent')}</option>
            <option value="side">{t('仅 subagent')}</option>
          </select>
        </label>
      </div>
    </div>
  )
}
