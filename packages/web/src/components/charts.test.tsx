import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { CostTrendChart } from './CostTrendChart'
import { ModelShareChart } from './ModelShareChart'
import { ProjectCostChart } from './ProjectCostChart'
import { TokenWaterfall } from './TokenWaterfall'
import { chartSeriesColor, CHART_SERIES_COLORS } from '../lib/chartTheme'
import {
  makeCost,
  makeModelStats,
  makeProjectStats,
  makeTimeBucket,
  makeTurn,
  makeUsage,
} from '../test/fixtures'

/**
 * Recharts 的 ResponsiveContainer 在 jsdom 里拿到 0 宽度就不渲染内部 SVG，
 * 因此这里断言的是「组件不炸 + 空态分支 + 图例/占位符」这些由我们控制的输出。
 * 真正画出来的图形由 lib/chartData 的单测保证数据正确。
 */

describe('chartSeriesColor', () => {
  test('按索引取色', () => {
    expect(chartSeriesColor(0)).toBe(CHART_SERIES_COLORS[0])
    expect(chartSeriesColor(2)).toBe(CHART_SERIES_COLORS[2])
  })

  test('超出色板长度时循环取用', () => {
    expect(chartSeriesColor(CHART_SERIES_COLORS.length)).toBe(CHART_SERIES_COLORS[0])
    expect(chartSeriesColor(CHART_SERIES_COLORS.length + 1)).toBe(CHART_SERIES_COLORS[1])
  })

  test('负索引也不会返回 undefined', () => {
    expect(chartSeriesColor(-1)).toBe('var(--color-ink-3)')
  })

  test('所有颜色都来自 CSS 变量而非写死的 oklch/hex', () => {
    for (const color of CHART_SERIES_COLORS) {
      expect(color.startsWith('var(--color-')).toBe(true)
    }
  })
})

describe('CostTrendChart', () => {
  test('有数据时挂上 ResponsiveContainer', () => {
    const { container } = render(
      <CostTrendChart buckets={[makeTimeBucket({ bucket: '2026-10-19T00:00:00Z' })]} />,
    )
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull()
  })

  test('空数据也不炸（Recharts 自己画空图）', () => {
    const { container } = render(<CostTrendChart buckets={[]} />)
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull()
  })
})

describe('ModelShareChart', () => {
  test('渲染自绘图例（含名称、成本、占比）', () => {
    render(
      <ModelShareChart
        models={[
          makeModelStats({ model: 'claude-sonnet-4-5-20250929', cost: makeCost({ totalCost: 3 }) }),
          makeModelStats({ model: 'claude-opus-4-1-20250805', cost: makeCost({ totalCost: 1 }) }),
        ]}
      />,
    )

    const legend = screen.getByTestId('model-share-legend')
    expect(legend).toBeInTheDocument()
    // 模型名去掉日期戳后展示
    expect(screen.getByText('claude-sonnet-4-5')).toBeInTheDocument()
    expect(screen.getByText('claude-opus-4-1')).toBeInTheDocument()
    expect(screen.getByText('$3.00')).toBeInTheDocument()
    expect(screen.getByText('75.0%')).toBeInTheDocument()
  })

  test('没有模型时显示空态', () => {
    render(<ModelShareChart models={[]} />)
    expect(screen.getByTestId('model-share-empty')).toBeInTheDocument()
  })

  test('图例色块使用 token 颜色', () => {
    render(<ModelShareChart models={[makeModelStats()]} />)
    const swatch = screen.getByTestId('model-share-legend').querySelector('span')
    expect(swatch).toHaveStyle({ backgroundColor: 'var(--color-accent)' })
  })
})

describe('ProjectCostChart', () => {
  test('有数据时挂上 ResponsiveContainer', () => {
    const { container } = render(
      <ProjectCostChart projects={[makeProjectStats({ projectSlug: 'demo' })]} />,
    )
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull()
  })

  test('空数据也不炸', () => {
    const { container } = render(<ProjectCostChart projects={[]} />)
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull()
  })
})

describe('TokenWaterfall', () => {
  test('有 assistant turn 时渲染', () => {
    const { container } = render(<TokenWaterfall turns={[makeTurn()]} />)
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull()
  })

  test('没有可用 turn 时显示空态', () => {
    render(<TokenWaterfall turns={[makeTurn({ role: 'user', usage: null })]} />)
    expect(screen.getByTestId('waterfall-empty')).toBeInTheDocument()
  })

  test('assistant 但 usage 为 null 的 turn 也被跳过', () => {
    render(<TokenWaterfall turns={[makeTurn({ role: 'assistant', usage: null })]} />)
    expect(screen.getByTestId('waterfall-empty')).toBeInTheDocument()
  })

  test('usage 全为 0 的 turn 仍算一条（占位而不是消失）', () => {
    const { container } = render(
      <TokenWaterfall
        turns={[
          makeTurn({
            usage: makeUsage({
              inputTokens: 0,
              cacheCreationTokens: 0,
              cacheReadTokens: 0,
              outputTokens: 0,
            }),
          }),
        ]}
      />,
    )
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull()
  })
})
