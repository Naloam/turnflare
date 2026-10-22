import { t, useLocale } from '../lib/locale'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Turn } from '../types/api'
import { toWaterfallPoints } from '../lib/chartData'
import { formatTokens } from '../lib/format'
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

interface TokenWaterfallProps {
  readonly turns: readonly Turn[]
}

/** 瀑布图的三段：输入、缓存读取、输出 */
const SERIES: readonly {
  dataKey: 'inputTokens' | 'cacheReadTokens' | 'outputTokens'
  name: string
}[] = [
  { dataKey: 'inputTokens', name: '输入' },
  { dataKey: 'cacheReadTokens', name: '缓存读取' },
  { dataKey: 'outputTokens', name: '输出' },
]

/**
 * token 瀑布图：每条 assistant turn 一组堆叠柱。
 *
 * 缓存读取单独一段是重点——它能让人一眼看出哪些 turn 吃到了缓存红利。
 */
export function TokenWaterfall({ turns }: TokenWaterfallProps) {
  useLocale()

  const points = toWaterfallPoints(turns)

  if (points.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-3" data-testid="waterfall-empty">
        {t('暂无 assistant token 数据')}
      </p>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={points} margin={CHART_MARGIN}>
        <CartesianGrid
          stroke={CHART_GRID_COLOR}
          strokeDasharray={CHART_GRID_DASHARRAY}
          vertical={false}
        />
        <XAxis
          dataKey="label"
          stroke={CHART_AXIS_COLOR}
          fontSize={CHART_AXIS_FONT_SIZE}
          tickLine={false}
        />
        <YAxis
          stroke={CHART_AXIS_COLOR}
          fontSize={CHART_AXIS_FONT_SIZE}
          tickLine={false}
          width={CHART_Y_AXIS_WIDTH}
          tickFormatter={(value) => formatTokens(Number(value))}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-surface-2)' }}
          contentStyle={{
            backgroundColor: 'var(--color-surface-1)',
            borderColor: 'var(--color-border-subtle)',
            color: 'var(--color-ink-1)',
            borderRadius: '0.5rem',
          }}
          formatter={(value) => formatTokens(Number(value))}
        />
        {SERIES.map((series, index) => (
          <Bar
            key={series.dataKey}
            dataKey={series.dataKey}
            name={t(series.name)}
            stackId="tokens"
            fill={chartSeriesColor(index)}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
