import { t, useLocale } from '../lib/locale'
import type { OverviewPayload } from '../types/api'
import { useApi } from '../hooks/useApi'
import { ApiView } from '../components/ApiView'
import { EmptyState } from '../components/EmptyState'
import { KpiCard } from '../components/KpiCard'
import { SectionCard } from '../components/SectionCard'
import { CostTrendChart } from '../components/CostTrendChart'
import { ModelShareChart } from '../components/ModelShareChart'
import { formatCost, formatPercent, formatTokens, formatTokensDetailed } from '../lib/format'
import { totalTokens } from '../lib/chartData'

const EMPTY_STATE = (
  <EmptyState
    title="还没有统计数据"
    description="先运行一次 turnflare scan 解析本地会话记录，再回来查看总览。"
  />
)

/** 总览 Dashboard：KPI 卡片 + 成本趋势 + 模型占比。 */
export function OverviewPage() {
  useLocale()

  const state = useApi<OverviewPayload>('/stats/overview')

  return (
    <ApiView state={state} empty={EMPTY_STATE}>
      {(data) =>
        data.sessionCount === 0 ? (
          EMPTY_STATE
        ) : (
          <div className="space-y-4 md:space-y-6">
            {data.cost.unpricedModel ? (
              <div
                className="card flex items-center gap-3 border-warning/50 px-4 py-3"
                role="status"
                data-testid="unpriced-warning"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
                <p className="text-sm text-ink-1">{t('部分模型无价目数据，成本未计入')}</p>
              </div>
            ) : null}

            {/*
            侧链提示条：样式刻意与 unpriced-warning 保持一致（同一条 warning 色系的
            提示带），因为两者说的是同一类事——"上面那些数字没覆盖全部用量"。
            没有侧链活动时整条不渲染：空提示条只会变成视觉噪音。
          */}
            {data.sidechain.turnCount > 0 ? (
              <div
                className="card flex items-center gap-3 border-warning/50 px-4 py-3"
                role="status"
                data-testid="sidechain-notice"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
                <p className="text-sm text-ink-1">
                  {t('subagent 活动：')}{' '}
                  {t('{0} 个 turn', { '0': formatTokensDetailed(data.sidechain.turnCount) })} ·{' '}
                  {formatTokens(totalTokens(data.sidechain.usage))} tokens ·{' '}
                  {formatCost(data.sidechain.cost.totalCost)} {t('估算 · 未计入主对话统计')}
                </p>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="总 Token"
                value={formatTokens(totalTokens(data.usage))}
                hint={t('{0} 个 turn', { '0': formatTokensDetailed(data.turnCount) })}
                loading={state.loading}
              />
              <KpiCard
                label="总成本"
                value={formatCost(data.cost.totalCost)}
                hint={data.cost.isEstimated ? t('含估算价目') : t('内置价目')}
                loading={state.loading}
              />
              <KpiCard
                label="会话数"
                value={formatTokensDetailed(data.sessionCount)}
                hint={t('{0} 个项目', { '0': formatTokensDetailed(data.byProject.length) })}
                loading={state.loading}
              />
              <KpiCard
                label="缓存命中率"
                value={formatPercent(data.cacheHitRate)}
                hint="缓存读取 / 总输入"
                loading={state.loading}
              />
            </div>

            <SectionCard title="成本趋势" description="主对话每天的 API 等价成本估算">
              <CostTrendChart buckets={data.byDay} />
            </SectionCard>

            <SectionCard title="模型占比" description="主对话各模型的成本占比">
              <ModelShareChart models={data.byModel} />
            </SectionCard>
          </div>
        )
      }
    </ApiView>
  )
}
