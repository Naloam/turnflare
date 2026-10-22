import { describe, expect, it } from 'vitest'
import { dedupeRecords, dedupeTurns } from './dedupe'
import type { RawRecord, Turn } from '../types'

function createTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    uuid: 'uuid-1',
    parentUuid: null,
    role: 'assistant',
    timestamp: '2026-10-19T08:00:00.000Z',
    model: 'claude-opus-5-5',
    usage: null,
    tools: [],
    textPreview: '',
    isSidechain: false,
    lineNumber: 1,
    ...overrides,
  }
}

function createRecord(overrides: Partial<RawRecord> = {}): RawRecord {
  return {
    lineNumber: 1,
    type: 'assistant',
    timestamp: '2026-10-19T08:00:00.000Z',
    payload: { uuid: 'uuid-1' },
    ...overrides,
  }
}

/** 见 usage.test.ts：把"运行时不遵守契约"的值塞进强类型签名 */
function withRuntimeValue<T>(value: unknown): T {
  return value as T
}

describe('dedupeTurns', () => {
  it('keeps the first occurrence of a repeated uuid', () => {
    // Arrange
    const first = createTurn({ uuid: 'dup', textPreview: 'first' })
    const second = createTurn({ uuid: 'dup', textPreview: 'second' })

    // Act
    const result = dedupeTurns([first, second])

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(first)
  })

  it('preserves the original order', () => {
    // Arrange
    const turns = [
      createTurn({ uuid: 'a' }),
      createTurn({ uuid: 'b' }),
      createTurn({ uuid: 'c' }),
      createTurn({ uuid: 'a' }),
    ]

    // Act
    const result = dedupeTurns(turns)

    // Assert
    expect(result.map((turn) => turn.uuid)).toEqual(['a', 'b', 'c'])
  })

  it('keeps every turn that has no uuid', () => {
    // Arrange：没有 uuid 就无法判断是否重复，误并班会静默吞掉真实数据
    const turns = [
      createTurn({ uuid: '' }),
      createTurn({ uuid: '' }),
      withRuntimeValue<Turn>({ ...createTurn(), uuid: undefined }),
    ]

    // Act
    const result = dedupeTurns(turns)

    // Assert
    expect(result).toHaveLength(3)
  })

  it('returns a new array without mutating the input', () => {
    // Arrange
    const turns = [createTurn({ uuid: 'a' }), createTurn({ uuid: 'a' })]

    // Act
    const result = dedupeTurns(turns)

    // Assert
    expect(result).not.toBe(turns)
    expect(turns).toHaveLength(2)
  })

  it('returns an empty array for empty input', () => {
    // Act / Assert
    expect(dedupeTurns([])).toEqual([])
  })

  it('keeps malformed entries because they carry no uuid to compare', () => {
    // Arrange
    const malformed = withRuntimeValue<Turn>(null)

    // Act
    const result = dedupeTurns([createTurn({ uuid: 'a' }), malformed])

    // Assert
    expect(result).toHaveLength(2)
    expect(result[1]).toBe(malformed)
  })
})

describe('dedupeRecords', () => {
  it('keeps the first record for a repeated payload uuid', () => {
    // Arrange
    const first = createRecord({ lineNumber: 1 })
    const second = createRecord({ lineNumber: 2 })

    // Act
    const result = dedupeRecords([first, second])

    // Assert
    expect(result).toEqual([first])
  })

  it('keeps records whose payload is not an object', () => {
    // Arrange：截断行 / 标量行没有 uuid 可依
    const truncated = createRecord({ payload: '{"uuid": "x"' })
    const scalar = createRecord({ payload: 42 })
    const nullPayload = createRecord({ payload: null })
    const arrayPayload = createRecord({ payload: [] })

    // Act
    const result = dedupeRecords([truncated, scalar, nullPayload, arrayPayload])

    // Assert
    expect(result).toHaveLength(4)
  })

  it('keeps records whose payload has no usable uuid', () => {
    // Arrange
    const missing = createRecord({ payload: { type: 'user' } })
    const empty = createRecord({ payload: { uuid: '' } })
    const wrongType = createRecord({ payload: { uuid: 7 } })

    // Act
    const result = dedupeRecords([missing, empty, wrongType])

    // Assert
    expect(result).toHaveLength(3)
  })

  it('does not mutate the input array', () => {
    // Arrange
    const records = [createRecord(), createRecord()]

    // Act
    dedupeRecords(records)

    // Assert
    expect(records).toHaveLength(2)
  })

  it('keeps records that are not objects', () => {
    // Arrange
    const malformed = withRuntimeValue<RawRecord>(null)

    // Act
    const result = dedupeRecords([malformed, createRecord()])

    // Assert
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(malformed)
  })

  it('returns an empty array for empty input', () => {
    // Act / Assert
    expect(dedupeRecords([])).toEqual([])
  })
})
