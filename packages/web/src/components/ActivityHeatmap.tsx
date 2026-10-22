import type { TimeBucket } from '../types/api'
import { heatmapDays } from '../lib/analytics'
import { t, useLocale } from '../lib/locale'

export function ActivityHeatmap({
  days,
  end,
  onSelect,
}: {
  readonly days: readonly TimeBucket[]
  readonly end: string
  readonly onSelect: (date: string) => void
}) {
  useLocale()
  const cells = heatmapDays(days, end, 364)
  const max = Math.max(1, ...cells.map((d) => d.requests))
  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <div
          className="grid min-w-[52rem] grid-flow-col grid-rows-7 gap-1"
          role="group"
          aria-label={t('活动热图')}
        >
          {cells.map(({ day, requests }) => (
            <button
              key={day}
              className="focus-ring aspect-square rounded-sm border border-border-subtle"
              style={{
                backgroundColor:
                  requests === 0
                    ? 'var(--color-surface-2)'
                    : `color-mix(in srgb, var(--color-accent) ${Math.round(25 + (75 * requests) / max)}%, var(--color-surface-1))`,
              }}
              title={`${day} · ${requests} ${t('请求')}`}
              aria-label={`${day} · ${requests} ${t('请求')}`}
              onClick={() => onSelect(day)}
            />
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-3">
        {cells[0]?.day} — {end} · {t('颜色越深，请求越多；点击日期查看当天')}
      </p>
    </div>
  )
}
