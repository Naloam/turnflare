import { t, useLocale } from '../lib/locale'
import { Loading } from './Loading'

interface KpiCardProps {
  readonly label: string
  /** 已格式化好的展示值；调用方负责走 lib/format，卡片不做数字猜测 */
  readonly value: string
  /** 副标题，如"近 7 天" */
  readonly hint?: string
  readonly loading?: boolean
  readonly error?: string | null
}

/** KPI 卡片：标签 + 主数值 + 可选副标题，自带加载骨架与错误态。 */
export function KpiCard({ label, value, hint, loading = false, error = null }: KpiCardProps) {
  useLocale()

  return (
    <article className="card p-4" data-testid="kpi-card">
      <p className="text-sm text-ink-2">{t(label)}</p>
      {loading ? (
        <div className="mt-2">
          <Loading label={t('{0}加载中', { '0': label })} rows={1} />
        </div>
      ) : null}
      {!loading && error !== null ? (
        <p className="mt-1 text-lg font-semibold text-danger">{t(error)}</p>
      ) : null}
      {!loading && error === null ? (
        <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-1">{value}</p>
      ) : null}
      {hint === undefined ? null : <p className="mt-1 text-xs text-ink-3">{t(hint)}</p>}
    </article>
  )
}
