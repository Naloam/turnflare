import { t, useLocale } from '../lib/locale'
import type { ReactNode } from 'react'

interface SectionCardProps {
  readonly title: string
  readonly description?: string
  /** 右上角操作区，如"查看全部" */
  readonly action?: ReactNode
  readonly children: ReactNode
}

/** 带标题的内容分区卡片，图表与表格都套一层，保证间距与标题层级一致。 */
export function SectionCard({ title, description, action, children }: SectionCardProps) {
  useLocale()
  return (
    <section className="card p-4 md:p-5" data-testid="section-card">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink-1">{t(title)}</h2>
          {description === undefined ? null : (
            <p className="mt-0.5 text-xs text-ink-3">{t(description)}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
