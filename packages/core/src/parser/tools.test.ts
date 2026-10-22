import { describe, expect, it } from 'vitest'
import type { RawRecord } from '../types.js'
import { extractToolResults, extractTools } from './records.js'

/** 直接构造一条记录：payload 故意声明为 unknown，与真实数据的不可信程度一致 */
function makeRecord(
  type: RawRecord['type'],
  payload: unknown,
  lineNumber = 1,
  timestamp: string | null = '2026-10-19T08:25:26.923Z',
): RawRecord {
  return { lineNumber, type, timestamp, payload }
}

describe('extractToolResults', () => {
  it('measures string content by character length', () => {
    // Arrange
    const record = makeRecord('user', {
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'abcd' }],
      },
    })

    // Act
    const results = extractToolResults(record)

    // Assert
    expect(results).toEqual([{ toolUseId: 't1', isError: false, resultBytes: 4 }])
  })

  it('measures array content by serialized length', () => {
    // Arrange
    const content = [{ type: 'text', text: 'hello' }]
    const record = makeRecord('user', {
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content }] },
    })

    // Act
    const results = extractToolResults(record)

    // Assert
    expect(results[0]?.resultBytes).toBe(JSON.stringify(content).length)
  })

  it('defaults isError to false when is_error is missing', () => {
    // Arrange
    const record = makeRecord('user', {
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] },
    })

    // Act
    const results = extractToolResults(record)

    // Assert
    expect(results[0]?.isError).toBe(false)
  })

  it('reads isError from is_error', () => {
    // Arrange
    const record = makeRecord('user', {
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }],
      },
    })

    // Act
    const results = extractToolResults(record)

    // Assert
    expect(results[0]?.isError).toBe(true)
  })

  it('skips tool_result blocks without a tool_use_id', () => {
    // Arrange
    const record = makeRecord('user', {
      message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] },
    })

    // Act
    const results = extractToolResults(record)

    // Assert
    expect(results).toEqual([])
  })

  it('ignores non tool_result blocks', () => {
    // Arrange
    const record = makeRecord('user', {
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', name: 'Bash', id: 't1' },
        ],
      },
    })

    // Act
    const results = extractToolResults(record)

    // Assert
    expect(results).toEqual([])
  })

  it('measures zero bytes for null content', () => {
    // Arrange
    const record = makeRecord('user', {
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: null }],
      },
    })

    // Act
    const results = extractToolResults(record)

    // Assert
    expect(results[0]?.resultBytes).toBe(0)
  })

  it('returns an empty array when message content is not an array', () => {
    // Arrange
    const record = makeRecord('user', { message: { role: 'user', content: 'plain text' } })

    // Act
    const results = extractToolResults(record)

    // Assert
    expect(results).toEqual([])
  })

  it('measures scalar tool_result content by its literal length', () => {
    // Arrange
    const record = makeRecord('user', {
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 42 }],
      },
    })

    // Act
    const results = extractToolResults(record)

    // Assert
    expect(results[0]?.resultBytes).toBe(2)
  })

  it('measures zero bytes for tool_result content that cannot be serialized', () => {
    // Arrange：jsonl 是外部数据，人工编辑过的文件可能混入不可序列化的值
    const record = makeRecord('user', {
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: Symbol('opaque') }],
      },
    })

    // Act
    const results = extractToolResults(record)

    // Assert
    expect(results[0]?.resultBytes).toBe(0)
  })

  it('returns an empty array for a record whose payload is not an object', () => {
    // Arrange
    const record = makeRecord('user', 'not an object')

    // Act
    const results = extractToolResults(record)

    // Assert
    expect(results).toEqual([])
  })

  it('returns an empty array for a record without a message', () => {
    // Arrange
    const record = makeRecord('user', { type: 'user' })

    // Act
    const results = extractToolResults(record)

    // Assert
    expect(results).toEqual([])
  })
})

describe('extractTools', () => {
  it('extracts tool_use blocks with their name and id', () => {
    // Arrange
    const record = makeRecord('assistant', {
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'thinking' },
          { type: 'tool_use', name: 'Read', id: 'toolu_1', input: { file_path: '/a' } },
          { type: 'tool_use', name: 'Bash', id: 'toolu_2', input: { command: 'ls' } },
        ],
      },
    })

    // Act
    const tools = extractTools(record)

    // Assert
    expect(tools).toEqual([
      { toolName: 'Read', toolUseId: 'toolu_1', isError: false, resultBytes: 0 },
      { toolName: 'Bash', toolUseId: 'toolu_2', isError: false, resultBytes: 0 },
    ])
  })

  it('pairs isError and resultBytes from a tool_result in the same record', () => {
    // Arrange
    const record = makeRecord('assistant', {
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'Bash', id: 'toolu_1' },
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok', is_error: true },
        ],
      },
    })

    // Act
    const tools = extractTools(record)

    // Assert
    expect(tools[0]).toEqual({
      toolName: 'Bash',
      toolUseId: 'toolu_1',
      isError: true,
      resultBytes: 2,
    })
  })

  it('skips tool_use blocks missing a name or an id', () => {
    // Arrange
    const record = makeRecord('assistant', {
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_1' },
          { type: 'tool_use', name: 'Bash' },
        ],
      },
    })

    // Act
    const tools = extractTools(record)

    // Assert
    expect(tools).toEqual([])
  })

  it('returns an empty array for a record without tool_use blocks', () => {
    // Arrange
    const record = makeRecord('user', {
      message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    })

    // Act
    const tools = extractTools(record)

    // Assert
    expect(tools).toEqual([])
  })

  it('returns an empty array when the record payload is not an object', () => {
    // Arrange
    const record = makeRecord('assistant', 'not an object')

    // Act
    const tools = extractTools(record)

    // Assert
    expect(tools).toEqual([])
  })
})
