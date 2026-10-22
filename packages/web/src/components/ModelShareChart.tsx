import { t, useLocale } from '../lib/locale'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { ModelStats } from '../types/api'
import { toModelShares } from '../lib/chartData'
import { formatCost, formatPercent } from '../lib/format'
import { CHART_HEIGHT, chartSeriesColor, PIE_OUTER_RADIUS_RATIO } from '../lib/chartTheme'

interface ModelShareChartProps {
  readonly models: readonly ModelStats[]
}

/**
 * 模型占比饼图。
 *
 * 图例不用 Recharts 的 <Legend />：它的文字颜色是库内写死的，
 * 深浅色切换时会有一半元素留在旧主题里。自绘图例才能全部走设计 token。
 */
export function ModelShareChart({ models }: ModelShareChartProps) {
  useLocale()

  const shares = toModelShares(models)

  if (shares.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-3" data-testid="model-share-empty">
        {t('暂无模型数据')}
      </p>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 md:flex-row">
      <div className="w-full md:w-1/2" style={{ height: CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <PieChart>
            <Pie
              data={shares}
              dataKey="value"
              nameKey="name"
              innerRadius="45%"
              outerRadius={`${PIE_OUTER_RADIUS_RATIO * 100}%`}
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {shares.map((share, index) => (
                <Cell key={share.model} fill={chartSeriesColor(index)} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-surface-1)',
                borderColor: 'var(--color-border-subtle)',
                color: 'var(--color-ink-1)',
                borderRadius: '0.5rem',
              }}
              formatter={(value) => formatCost(Number(value))}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="w-full space-y-2 md:w-1/2" data-testid="model-share-legend">
        {shares.map((share, index) => (
          <li key={share.model} className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: chartSeriesColor(index) }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-ink-2" title={share.model}>
              {share.name}
            </span>
            <span className="tabular-nums text-ink-1">{formatCost(share.value)}</span>
            <span className="w-14 text-right tabular-nums text-ink-3">
              {formatPercent(share.share)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
