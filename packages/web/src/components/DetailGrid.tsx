import { t, useLocale } from '../lib/locale'
interface DetailItem {
  readonly label: string
  readonly value: string
}

interface DetailGridProps {
  readonly items: readonly DetailItem[]
}

/** 键值对网格，用于会话详情的元信息头。响应式：1/2/3 列。 */
export function DetailGrid({ items }: DetailGridProps) {
  useLocale()
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={t(item.label)} className="min-w-0">
          <dt className="text-xs text-ink-3">{t(item.label)}</dt>
          <dd className="mt-0.5 truncate text-sm text-ink-1" title={item.value}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
