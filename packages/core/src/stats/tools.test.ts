import { describe, expect, it } from 'vitest'
import { aggregateTools, toolErrorRate } from './tools'
import type { ToolInvocation, ToolStats, Turn } from '../types'

function createTool(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    toolName: 'Bash',
    toolUseId: 'tool-1',
    isError: false,
    resultBytes: 0,
    ...overrides,
  }
}

function createTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    uuid: 'uuid-1',
    parentUuid: null,
    role: 'assistant',
    timestamp: '2026-10-19T08:25:26.923Z',
    model: 'claude-opus-5-5',
    usage: null,
    tools: [],
    textPreview: '',
    isSidechain: false,
    lineNumber: 1,
    ...overrides,
  }
}

/** 见 usage.test.ts：把"运行时不遵守契约"的值塞进强类型签名 */
function withRuntimeValue<T>(value: unknown): T {
  return value as T
}

describe('aggregateTools', () => {
  it('groups calls by tool name across turns', () => {
    // Arrange
    const turns = [
      createTurn({
        uuid: 'a',
        tools: [createTool({ toolName: 'Bash' }), createTool({ toolName: 'Read' })],
      }),
      createTurn({ uuid: 'b', tools: [createTool({ toolName: 'Bash' })] }),
    ]

    // Act
    const stats = aggregateTools(turns)

    // Assert
    expect(stats).toEqual([
      { toolName: 'Bash', callCount: 2, errorCount: 0, totalResultBytes: 0 },
      { toolName: 'Read', callCount: 1, errorCount: 0, totalResultBytes: 0 },
    ])
  })

  it('counts errors and result bytes per tool', () => {
    // Arrange
    const turns = [
      createTurn({
        uuid: 'a',
        tools: [
          createTool({ toolName: 'Bash', isError: true, resultBytes: 120 }),
          createTool({ toolName: 'Bash', resultBytes: 80 }),
        ],
      }),
    ]

    // Act
    const stats = aggregateTools(turns)

    // Assert
    expect(stats).toEqual([
      { toolName: 'Bash', callCount: 2, errorCount: 1, totalResultBytes: 200 },
    ])
  })

  it('sorts by call count descending', () => {
    // Arrange
    const turns = [
      createTurn({
        uuid: 'a',
        tools: [
          createTool({ toolName: 'Read' }),
          createTool({ toolName: 'Bash' }),
          createTool({ toolName: 'Bash' }),
          createTool({ toolName: 'Edit' }),
        ],
      }),
    ]

    // Act
    const stats = aggregateTools(turns)

    // Assert
    expect(stats.map((entry) => entry.toolName)).toEqual(['Bash', 'Edit', 'Read'])
  })

  it('breaks call count ties by tool name so the order is reproducible', () => {
    // Arrange
    const turns = [
      createTurn({
        uuid: 'a',
        tools: [
          createTool({ toolName: 'Write' }),
          createTool({ toolName: 'Bash' }),
          createTool({ toolName: 'Edit' }),
        ],
      }),
    ]

    // Act
    const first = aggregateTools(turns)
    const second = aggregateTools([...turns].reverse())

    // Assert
    expect(first.map((entry) => entry.toolName)).toEqual(['Bash', 'Edit', 'Write'])
    expect(second.map((entry) => entry.toolName)).toEqual(['Bash', 'Edit', 'Write'])
  })

  it('returns an empty array when there is nothing to count', () => {
    // Act / Assert
    expect(aggregateTools([])).toEqual([])
    expect(aggregateTools([createTurn({ tools: [] })])).toEqual([])
  })

  it('skips tool calls that carry no name', () => {
    // Arrange：没有名字的调用无法归属，硬塞空串分组只会污染排序
    const turns = [
      createTurn({
        uuid: 'a',
        tools: [createTool({ toolName: '' }), createTool({ toolName: 'Bash' })],
      }),
    ]

    // Act
    const stats = aggregateTools(turns)

    // Assert
    expect(stats).toEqual([{ toolName: 'Bash', callCount: 1, errorCount: 0, totalResultBytes: 0 }])
  })

  it('treats a non-boolean error flag as a successful call', () => {
    // Arrange
    const dirty = withRuntimeValue<ToolInvocation>({ ...createTool(), isError: 'true' })

    // Act
    const stats = aggregateTools([createTurn({ tools: [dirty] })])

    // Assert
    expect(stats[0]?.errorCount).toBe(0)
  })

  it('ignores dirty result sizes instead of producing NaN', () => {
    // Arrange
    const dirty = withRuntimeValue<ToolInvocation>({ ...createTool(), resultBytes: '1200' })

    // Act
    const stats = aggregateTools([createTurn({ tools: [dirty] })])

    // Assert
    expect(stats[0]?.totalResultBytes).toBe(0)
  })

  it('skips malformed tool entries and turns whose tools is not an array', () => {
    // Arrange
    const malformedEntry = withRuntimeValue<ToolInvocation>(null)
    const malformedTools = withRuntimeValue<Turn>({ ...createTurn(), tools: 'Bash' })

    // Act
    const stats = aggregateTools([
      createTurn({ tools: [createTool(), malformedEntry] }),
      malformedTools,
    ])

    // Assert
    expect(stats).toEqual([{ toolName: 'Bash', callCount: 1, errorCount: 0, totalResultBytes: 0 }])
  })

  it('does not mutate the input array', () => {
    // Arrange
    const turns = [createTurn({ tools: [createTool()] }), createTurn({ tools: [createTool()] })]

    // Act
    aggregateTools(turns)

    // Assert
    expect(turns).toHaveLength(2)
  })
})

describe('toolErrorRate', () => {
  it('divides failed calls by total calls', () => {
    // Arrange
    const stats: readonly ToolStats[] = [
      { toolName: 'Bash', callCount: 3, errorCount: 1, totalResultBytes: 0 },
      { toolName: 'Read', callCount: 1, errorCount: 0, totalResultBytes: 0 },
    ]

    // Act
    const rate = toolErrorRate(stats)

    // Assert
    expect(rate).toBeCloseTo(0.25, 10)
  })

  it('returns zero when nothing was ever called', () => {
    // Act / Assert
    expect(toolErrorRate([])).toBe(0)
    expect(
      toolErrorRate([{ toolName: 'Bash', callCount: 0, errorCount: 0, totalResultBytes: 0 }]),
    ).toBe(0)
  })

  it('ignores dirty counters', () => {
    // Arrange
    const stats = withRuntimeValue<readonly ToolStats[]>([
      { toolName: 'Bash', callCount: 'many', errorCount: Number.NaN, totalResultBytes: 0 },
    ])

    // Act
    const rate = toolErrorRate(stats)

    // Assert
    expect(rate).toBe(0)
  })

  it('skips entries that are not objects', () => {
    // Arrange
    const stats = withRuntimeValue<readonly ToolStats[]>([
      null,
      { toolName: 'Bash', callCount: 4, errorCount: 1, totalResultBytes: 0 },
    ])

    // Act
    const rate = toolErrorRate(stats)

    // Assert
    expect(rate).toBeCloseTo(0.25, 10)
  })

  it('stays within the zero to one range when the counters disagree', () => {
    // Arrange：出错数大于调用数的脏数据
    const stats = withRuntimeValue<readonly ToolStats[]>([
      { toolName: 'Bash', callCount: 1, errorCount: 9, totalResultBytes: 0 },
    ])

    // Act
    const rate = toolErrorRate(stats)

    // Assert
    expect(rate).toBe(1)
  })
})
