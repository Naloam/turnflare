import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { SessionsTable } from './SessionsTable'
import { SessionFilters, type SessionFiltersProps } from './SessionFilters'
import { nthElement, selectValue } from '../test/dom'
import { ToolCallList } from './ToolCallList'
import { TurnTimeline } from './TurnTimeline'
import { makeCost, makeSessionListItem, makeTool, makeTurn, makeUsage } from '../test/fixtures'

const SESSIONS = [
  makeSessionListItem({
    sessionId: 'session-a',
    projectSlug: 'alpha',
    startedAt: '2026-10-19T08:00:00.000Z',
    turnCount: 12,
    usage: makeUsage({
      inputTokens: 1000,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    }),
    cost: makeCost({ totalCost: 1.5 }),
  }),
  makeSessionListItem({
    sessionId: 'session-b',
    projectSlug: 'beta',
    startedAt: '2026-10-18T08:00:00.000Z',
    turnCount: 3,
    models: [],
    usage: makeUsage({
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 500,
    }),
    cost: makeCost({ totalCost: 0.25 }),
  }),
]

describe('SessionsTable', () => {
  test('渲染全部列与两行数据', () => {
    render(<SessionsTable sessions={SESSIONS} onSelect={vi.fn()} />)

    const headers = screen
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
      .join(' ')
    expect(headers).toContain('项目')
    expect(headers).toContain('模型')
    expect(headers).toContain('开始时间')
    expect(headers).toContain('Turn 数')
    expect(headers).toContain('Token')
    expect(headers).toContain('成本')

    expect(screen.getAllByTestId('session-row')).toHaveLength(2)
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
  })

  test('token 汇总四类用量，成本格式化', () => {
    render(<SessionsTable sessions={SESSIONS} onSelect={vi.fn()} />)

    expect(screen.getByText('$1.50')).toBeInTheDocument()
    expect(screen.getByText('$0.25')).toBeInTheDocument()
    expect(screen.getByText('1K')).toBeInTheDocument()
    expect(screen.getByText('500')).toBeInTheDocument()
  })

  test('模型为空时显示占位符', () => {
    render(<SessionsTable sessions={SESSIONS} onSelect={vi.fn()} />)
    expect(screen.getAllByText('-').length).toBeGreaterThan(0)
  })

  test('开始时间为空时也显示占位符', () => {
    render(
      <SessionsTable
        sessions={[makeSessionListItem({ sessionId: 's', startedAt: null })]}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  test('点击行导航到详情', async () => {
    const onSelect = vi.fn()
    render(<SessionsTable sessions={SESSIONS} onSelect={onSelect} />)

    await userEvent.click(nthElement(screen.getAllByTestId('session-row'), 0))
    expect(onSelect).toHaveBeenCalledWith('session-a')
  })

  test('点击行内"详情"按钮只触发一次（阻止冒泡）', async () => {
    const onSelect = vi.fn()
    render(<SessionsTable sessions={SESSIONS} onSelect={onSelect} />)

    await userEvent.click(nthElement(screen.getAllByRole('button', { name: '详情' }), 1))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('session-b')
  })
})

describe('SessionFilters', () => {
  /** 工厂而不是常量：每个用例都能只覆盖自己关心的字段，且返回值受 SessionFiltersProps 约束 */
  function makeProps(overrides: Partial<SessionFiltersProps> = {}): SessionFiltersProps {
    return {
      projects: ['alpha', 'beta'],
      project: null,
      sort: 'cost',
      order: 'desc',
      onProjectChange: vi.fn(),
      onSortChange: vi.fn(),
      onOrderToggle: vi.fn(),
      onScan: vi.fn(),
      scanning: false,
      ...overrides,
    }
  }

  test('渲染项目下拉、排序选项与扫描按钮', () => {
    render(<SessionFilters {...makeProps()} />)

    expect(screen.getByRole('combobox', { name: '项目' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '排序' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '触发扫描' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '降序' })).toBeInTheDocument()
  })

  test('当前项目被选中', () => {
    render(<SessionFilters {...makeProps()} project="beta" />)
    const select = screen.getByRole('combobox', { name: '项目' })
    expect(selectValue(select)).toBe('beta')
  })

  test('选择"全部"时回传 null', async () => {
    const onProjectChange = vi.fn()
    render(<SessionFilters {...makeProps()} project="alpha" onProjectChange={onProjectChange} />)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '项目' }), '')
    expect(onProjectChange).toHaveBeenCalledWith(null)
  })

  test('选择具体项目时回传 slug', async () => {
    const onProjectChange = vi.fn()
    render(<SessionFilters {...makeProps()} onProjectChange={onProjectChange} />)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '项目' }), 'beta')
    expect(onProjectChange).toHaveBeenCalledWith('beta')
  })

  test('切换排序字段', async () => {
    const onSortChange = vi.fn()
    render(<SessionFilters {...makeProps()} onSortChange={onSortChange} />)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '排序' }), 'tokens')
    expect(onSortChange).toHaveBeenCalledWith('tokens')
  })

  test('方向按钮在升序时显示"升序"', () => {
    render(<SessionFilters {...makeProps()} order="asc" />)
    expect(screen.getByRole('button', { name: '升序' })).toBeInTheDocument()
  })

  test('扫描中时按钮禁用并显示进度文案', () => {
    render(<SessionFilters {...makeProps()} scanning />)
    expect(screen.getByRole('button', { name: '扫描中…' })).toBeDisabled()
  })
})

describe('TurnTimeline', () => {
  test('渲染角色徽标、模型与 token', () => {
    render(<TurnTimeline turns={[makeTurn()]} />)

    expect(screen.getByText('助手')).toBeInTheDocument()
    expect(screen.getByText('claude-sonnet-4-5-20250929')).toBeInTheDocument()
    expect(screen.getByText(/token/)).toBeInTheDocument()
  })

  test('没有 usage 的 turn 显示占位符', () => {
    render(<TurnTimeline turns={[makeTurn({ role: 'user', usage: null })]} />)
    expect(screen.getByText('用户')).toBeInTheDocument()
    expect(screen.getByText('- token')).toBeInTheDocument()
  })

  test('侧链 turn 带徽标', () => {
    render(<TurnTimeline turns={[makeTurn({ isSidechain: true })]} />)
    expect(screen.getByText('侧链')).toBeInTheDocument()
  })

  test('fast 档 turn 带 fast 档徽标', () => {
    const turns = [makeTurn({ usage: makeUsage({ speed: 'fast' }) })]

    render(<TurnTimeline turns={turns} />)

    const badge = screen.getByText('fast 档')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('text-warning')
  })

  test('标准档 turn 不显示 fast 档徽标', () => {
    const turns = [makeTurn({ usage: makeUsage({ speed: 'standard' }) })]

    render(<TurnTimeline turns={turns} />)

    expect(screen.queryByText('fast 档')).not.toBeInTheDocument()
  })

  test('没有 usage 的 turn 不显示 fast 档徽标', () => {
    const turns = [makeTurn({ role: 'user', usage: null })]

    render(<TurnTimeline turns={turns} />)

    expect(screen.queryByText('fast 档')).not.toBeInTheDocument()
  })

  test('没有模型的 turn 不渲染模型节点', () => {
    render(<TurnTimeline turns={[makeTurn({ model: null })]} />)
    expect(screen.queryByText('claude-sonnet-4-5-20250929')).not.toBeInTheDocument()
  })

  test('没有文本预览的 turn 不渲染段落', () => {
    render(<TurnTimeline turns={[makeTurn({ textPreview: '' })]} />)
    expect(screen.queryByText('一段文本预览')).not.toBeInTheDocument()
  })

  test('工具标签区分成败（时间线里只显示工具名，成败靠语气色）', () => {
    render(
      <TurnTimeline
        turns={[
          makeTurn({
            tools: [
              makeTool({ toolName: 'Bash', isError: false }),
              makeTool({ toolUseId: 't2', toolName: 'Edit', isError: true }),
            ],
          }),
        ]}
      />,
    )
    const badges = screen
      .getAllByTestId('badge')
      .filter((badge) => ['Bash', 'Edit'].includes(badge.textContent))
    expect(badges).toHaveLength(2)
    expect(badges[0]?.className).toContain('text-positive')
    expect(badges[1]?.className).toContain('text-danger')
  })
})

describe('ToolCallList', () => {
  test('摊平所有 turn 的工具调用并格式化体积', () => {
    render(
      <ToolCallList
        turns={[
          makeTurn({ tools: [makeTool({ toolName: 'Read', resultBytes: 2048 })] }),
          makeTurn({
            uuid: 't-2',
            tools: [
              makeTool({
                toolUseId: 'x',
                toolName: 'Bash',
                isError: true,
                resultBytes: 1048576,
              }),
            ],
          }),
        ]}
      />,
    )

    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    expect(screen.getByText('1.0 MB')).toBeInTheDocument()
  })

  test('没有工具调用时显示空提示', () => {
    render(<ToolCallList turns={[makeTurn()]} />)
    expect(screen.getByTestId('tool-list-empty')).toBeInTheDocument()
  })
})
