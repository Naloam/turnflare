import { useState } from 'react'
import type { AnalyticsOptions, AnalyticsPayload, UsageQuery } from '../types/api'
import { useApi } from '../hooks/useApi'
import { t, useLocale } from '../lib/locale'
import { dateBounds, isoDay, usageSearch } from '../lib/analytics'
import { totalTokens } from '../lib/chartData'
import { formatCost, formatPercent, formatTokens, formatTokensDetailed } from '../lib/format'
import { ApiView } from '../components/ApiView'
import { SectionCard } from '../components/SectionCard'
import { KpiCard } from '../components/KpiCard'
import { CostTrendChart } from '../components/CostTrendChart'
import { ModelShareChart } from '../components/ModelShareChart'
import { UsageFilters, DEFAULT_SELECTION } from '../components/UsageFilters'
import { ActivityHeatmap } from '../components/ActivityHeatmap'
import { AnalyticsTables } from '../components/AnalyticsTables'
import { BudgetCard } from '../components/BudgetCard'
import { ReportExport } from '../components/ReportExport'

export function AnalyticsPage() {
  useLocale()
  const [selection, setSelection] = useState(DEFAULT_SELECTION)
  // Unfiltered options include projects/models that occur only in subagents.
  const options = useApi<AnalyticsOptions>('/stats/analytics/options')
  const bounds = dateBounds(selection.start, selection.end)
  const filters: UsageQuery = {
    ...bounds,
    chain: selection.chain,
    ...(selection.project ? { project: selection.project } : {}),
    ...(selection.model ? { model: selection.model } : {}),
  }
  const query = usageSearch(filters)
  const state = useApi<AnalyticsPayload>(`/stats/analytics?${query}`)
  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">{t('按时间、项目、模型和对话链分析用量')}</p>
        <ReportExport
          filters={filters}
          disabled={bounds === null || state.loading || state.error !== null}
        />
      </div>
      <UsageFilters
        value={selection}
        projects={options.data?.projects ?? []}
        models={options.data?.models ?? []}
        onChange={setSelection}
      />
      {options.error !== null ? (
        <p className="text-xs text-danger">{t('筛选选项加载失败，请刷新重试')}</p>
      ) : null}
      {bounds === null ? (
        <p role="alert" className="text-danger">
          {t('请填写有效的日期范围')}
        </p>
      ) : (
        <ApiView state={state} empty={null}>
          {(data) => (
            <>
              {data.cost.unpricedModel ? (
                <p className="card border-warning/50 p-3 text-sm text-warning">
                  {t('部分模型无价目数据，成本未计入')}
                </p>
              ) : null}
              {data.requestCount > data.days.reduce((n, day) => n + day.requestCount, 0) ? (
                <p className="card p-3 text-sm text-warning">
                  {t('部分请求缺少有效时间戳，已计入总量但未显示在时间图表中')}
                </p>
              ) : null}
              {data.turnCount === 0 ? (
                <p role="status" className="card p-4 text-sm text-ink-2">
                  {t('当前筛选没有活动，请调整筛选条件')}
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label="总 Token"
                  value={formatTokens(totalTokens(data.usage))}
                  hint={t('{0} 次请求', { '0': formatTokensDetailed(data.requestCount) })}
                />
                <KpiCard
                  label="估算成本"
                  value={formatCost(data.cost.totalCost)}
                  hint="API 等价成本（USD）"
                />
                <KpiCard
                  label="会话数"
                  value={formatTokensDetailed(data.sessionCount)}
                  hint={t('{0} 个项目', { '0': data.projects.length })}
                />
                <KpiCard
                  label="缓存命中率"
                  value={formatPercent(data.cacheHitRate)}
                  hint="缓存读取 / 总输入"
                />
              </div>

              <SectionCard title="活动热图" description="最近 52 周的请求次数（UTC）">
                <ActivityHeatmap
                  days={data.days}
                  end={selection.end || isoDay(new Date())}
                  onSelect={(date) => setSelection({ ...selection, start: date, end: date })}
                />
              </SectionCard>
              <div className="grid gap-4 xl:grid-cols-2">
                <SectionCard title="成本趋势" description="所有数字均遵循当前筛选">
                  <CostTrendChart buckets={data.days} />
                </SectionCard>
                <SectionCard title="模型占比" description="所有数字均遵循当前筛选">
                  <ModelShareChart models={data.models} />
                </SectionCard>
              </div>
              <SectionCard title="自设预算">
                <BudgetCard cost={data.cost.totalCost} />
              </SectionCard>
              <AnalyticsTables data={data} />
            </>
          )}
        </ApiView>
      )}
    </div>
  )
}
