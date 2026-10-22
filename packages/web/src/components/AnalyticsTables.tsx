import { useState } from 'react'
import type { AnalyticsPayload } from '../types/api'
import { periodRows, type Period } from '../lib/analytics'
import { formatCost, formatPercent, formatTokens, formatTokensDetailed } from '../lib/format'
import { t, useLocale } from '../lib/locale'
import { SectionCard } from './SectionCard'
import { CONTROL_CLASS } from './UsageFilters'

const TABLE_CLASS =
  'w-full text-left text-sm [&_th]:pb-3 [&_th]:font-medium [&_th]:text-ink-3 [&_td]:border-t [&_td]:border-border-subtle [&_td]:py-2 [&_td]:pr-4'

export function AnalyticsTables({ data }: { readonly data: AnalyticsPayload }) {
  useLocale()
  const [period, setPeriod] = useState<Period>('day')
  const [limit, setLimit] = useState(20)
  const rows = periodRows(data.days, period)
  return (
    <>
      <SectionCard
        title="周期明细"
        description="UTC 日期；每周从周一开始"
        action={
          <select
            aria-label={t('统计周期')}
            className={CONTROL_CLASS}
            value={period}
            onChange={(e) => {
              const value = e.target.value
              if (value === 'day' || value === 'week' || value === 'month') {
                setPeriod(value)
                setLimit(20)
              }
            }}
          >
            <option value="day">{t('按日')}</option>
            <option value="week">{t('按周')}</option>
            <option value="month">{t('按月')}</option>
          </select>
        }
      >
        <div className="overflow-x-auto">
          <table className={TABLE_CLASS}>
            <thead>
              <tr>
                {['周期', '请求', '总 Token', '估算成本'].map((label) => (
                  <th key={label}>{t(label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((row) => (
                <tr key={row.period}>
                  <td>{row.period}</td>
                  <td>{formatTokensDetailed(row.requests)}</td>
                  <td>{formatTokens(row.tokens)}</td>
                  <td>{formatCost(row.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > limit ? (
          <button className={`${CONTROL_CLASS} mt-3`} onClick={() => setLimit(limit + 50)}>
            {t('显示更多')}
          </button>
        ) : null}
      </SectionCard>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="模型明细" description="所有数字均遵循当前筛选">
          <div className="overflow-x-auto">
            <table className={TABLE_CLASS}>
              <thead>
                <tr>
                  {['模型', '请求', '缓存命中率', '估算成本'].map((label) => (
                    <th key={label}>{t(label)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.models.map((model) => {
                  const input =
                    model.usage.inputTokens +
                    model.usage.cacheCreationTokens +
                    model.usage.cacheReadTokens
                  return (
                    <tr key={model.model}>
                      <td className="break-all">{model.model}</td>
                      <td>{formatTokensDetailed(model.requestCount)}</td>
                      <td>
                        {formatPercent(input === 0 ? 0 : model.usage.cacheReadTokens / input)}
                      </td>
                      <td>
                        {formatCost(model.cost.totalCost)}
                        {model.cost.unpricedModel ? ' *' : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
        <SectionCard title="工具排行" description="调用次数、错误和结果大小；不推算每个工具的成本">
          <div className="overflow-x-auto">
            <table className={TABLE_CLASS}>
              <thead>
                <tr>
                  {['工具', '调用次数', '错误率', '结果字符数'].map((label) => (
                    <th key={label}>{t(label)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.tools.map((tool) => (
                  <tr key={tool.toolName}>
                    <td className="break-all">{tool.toolName}</td>
                    <td>{formatTokensDetailed(tool.callCount)}</td>
                    <td>
                      {formatPercent(tool.callCount === 0 ? 0 : tool.errorCount / tool.callCount)}
                    </td>
                    <td>{formatTokensDetailed(tool.totalResultBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.tools.length === 0 ? (
            <p className="text-sm text-ink-3">{t('该范围没有工具调用')}</p>
          ) : null}
        </SectionCard>
      </div>
    </>
  )
}
