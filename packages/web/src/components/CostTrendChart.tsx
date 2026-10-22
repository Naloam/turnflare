import { t, useLocale } from '../lib/locale'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TimeBucket } from '../types/api'
import { toTrendPoints } from '../lib/chartData'
import { formatCost } from '../lib/format'
import {
  CHART_AXIS_COLOR,
  CHART_AXIS_FONT_SIZE,
  CHART_GRID_COLOR,
  CHART_GRID_DASHARRAY,
  CHART_HEIGHT,
  CHART_MARGIN,
  chartSeriesColor,
  CHART_Y_AXIS_WIDTH,
} from '../lib/chartTheme'

interface CostTrendChartProps {
  readonly buckets: readonly TimeBucket[]
}

/** 成本趋势面积图。X 轴日期、Y 轴成本，数据来自 overview.byDay。 */
export function CostTrendChart({ buckets }: CostTrendChartProps) {
  useLocale()

  const points = toTrendPoints(buckets)
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <AreaChart data={points} margin={CHART_MARGIN}>
        <CartesianGrid
          stroke={CHART_GRID_COLOR}
          strokeDasharray={CHART_GRID_DASHARRAY}
          vertical={false}
        />
        <XAxis
          dataKey="date"
          stroke={CHART_AXIS_COLOR}
          fontSize={CHART_AXIS_FONT_SIZE}
          tickLine={false}
        />
        <YAxis
          stroke={CHART_AXIS_COLOR}
          fontSize={CHART_AXIS_FONT_SIZE}
          tickLine={false}
          width={CHART_Y_AXIS_WIDTH}
          tickFormatter={(value) => formatCost(Number(value))}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--color-surface-1)',
            borderColor: 'var(--color-border-subtle)',
            color: 'var(--color-ink-1)',
            borderRadius: '0.5rem',
          }}
          formatter={(value) => formatCost(Number(value))}
        />
        <Area
          type="monotone"
          dataKey="cost"
          name={t('成本')}
          stroke={chartSeriesColor(0)}
          fill={chartSeriesColor(0)}
          fillOpacity={0.18}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
