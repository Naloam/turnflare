import { t, useLocale } from '../lib/locale'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ProjectStats } from '../types/api'
import { toProjectCosts } from '../lib/chartData'
import { formatCost } from '../lib/format'
import {
  CHART_AXIS_COLOR,
  CHART_AXIS_FONT_SIZE,
  CHART_CATEGORY_AXIS_WIDTH,
  CHART_GRID_COLOR,
  CHART_GRID_DASHARRAY,
  CHART_HEIGHT,
  CHART_MARGIN,
  chartSeriesColor,
} from '../lib/chartTheme'

interface ProjectCostChartProps {
  readonly projects: readonly ProjectStats[]
}

/** 项目成本横向柱状图对比。layout="vertical" 让项目名有足够宽度完整显示。 */
export function ProjectCostChart({ projects }: ProjectCostChartProps) {
  useLocale()

  const points = toProjectCosts(projects)
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={points} layout="vertical" margin={CHART_MARGIN}>
        <CartesianGrid
          stroke={CHART_GRID_COLOR}
          strokeDasharray={CHART_GRID_DASHARRAY}
          horizontal={false}
        />
        <XAxis
          type="number"
          stroke={CHART_AXIS_COLOR}
          fontSize={CHART_AXIS_FONT_SIZE}
          tickLine={false}
          tickFormatter={(value) => formatCost(Number(value))}
        />
        <YAxis
          type="category"
          dataKey="project"
          stroke={CHART_AXIS_COLOR}
          fontSize={CHART_AXIS_FONT_SIZE}
          tickLine={false}
          width={CHART_CATEGORY_AXIS_WIDTH}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-surface-2)' }}
          contentStyle={{
            backgroundColor: 'var(--color-surface-1)',
            borderColor: 'var(--color-border-subtle)',
            color: 'var(--color-ink-1)',
            borderRadius: '0.5rem',
          }}
          formatter={(value) => formatCost(Number(value))}
        />
        <Bar
          dataKey="cost"
          name={t('成本')}
          fill={chartSeriesColor(0)}
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
