import { describe, expect, it } from 'vitest'
import type { RawRecord } from '../types.js'
import { extractTurns } from './records.js'

/** 直接构造一条记录：payload 故意声明为 unknown，与真实数据的不可信程度一致 */
function makeRecord(
  type: RawRecord['type'],
  payload: unknown,
  lineNumber = 1,
  timestamp: string | null = '2026-10-19T08:25:26.923Z',
): RawRecord {
  return { lineNumber, type, timestamp, payload }
}

describe('extractTurns', () => {
  const assistantPayload = {
    type: 'assistant',
    uuid: 'a1',
    parentUuid: 'u1',
    timestamp: '2026-10-19T08:25:27.000Z',
    message: {
      role: 'assistant',
      model: 'claude-opus-5-5',
      usage: { input_tokens: 10, output_tokens: 4 },
      content: [{ type: 'text', text: 'hello world' }],
    },
  }

  it('converts user and assistant records carrying a message', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('user', {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      }),
      makeRecord('assistant', assistantPayload, 2, '2026-10-19T08:25:27.000Z'),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns).toHaveLength(2)
    expect(turns[0]?.role).toBe('user')
    expect(turns[1]).toEqual({
      uuid: 'a1',
      parentUuid: 'u1',
      role: 'assistant',
      timestamp: '2026-10-19T08:25:27.000Z',
      model: 'claude-opus-5-5',
      usage: {
        speed: 'standard',
        inputTokens: 10,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 4,
        thinkingTokens: 0,
        serverToolUse: 0,
      },
      tools: [],
      textPreview: 'hello world',
      isSidechain: false,
      lineNumber: 2,
    })
  })

  it('skips records whose role is neither user nor assistant', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('user', { message: { role: 'system', content: 'x' } }),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns).toEqual([])
  })

  it('skips records without a message object', () => {
    // Arrange
    const records: readonly RawRecord[] = [makeRecord('user', { type: 'user', uuid: 'u1' })]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns).toEqual([])
  })

  it('skips records whose payload is not an object', () => {
    // Arrange
    const records: readonly RawRecord[] = [makeRecord('user', 'not an object')]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns).toEqual([])
  })

  it('skips records whose type is not user or assistant', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('summary', { type: 'summary', summary: 'compacted' }),
      makeRecord('api-request', { type: 'api-request', params: { model: 'x' } }),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns).toEqual([])
  })

  it('builds textPreview from text blocks joined by newline', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('assistant', {
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'first' },
            { type: 'tool_use', name: 'Bash', id: 't1' },
            { type: 'text', text: 'second' },
          ],
        },
      }),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.textPreview).toBe('first\nsecond')
  })

  it('builds textPreview from thinking blocks', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('assistant', {
        message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'let me think' }] },
      }),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.textPreview).toBe('let me think')
  })

  it('builds textPreview from a plain string content', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('user', { message: { role: 'user', content: 'plain question' } }),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.textPreview).toBe('plain question')
  })

  it('truncates textPreview using maxTextPreviewChars', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('user', { message: { role: 'user', content: 'abcdefghij' } }),
    ]

    // Act
    const turns = extractTurns(records, { maxTextPreviewChars: 4 })

    // Assert
    expect(turns[0]?.textPreview).toBe('abcd')
  })

  it('defaults textPreview to 200 characters when no option is given', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('user', { message: { role: 'user', content: 'x'.repeat(500) } }),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.textPreview).toHaveLength(200)
  })

  it('reads isSidechain from the top-level field and defaults to false', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('assistant', { ...assistantPayload, isSidechain: true }),
      makeRecord('assistant', assistantPayload, 2),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.isSidechain).toBe(true)
    expect(turns[1]?.isSidechain).toBe(false)
  })

  it('uses an empty timestamp when the record has none', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('user', { message: { role: 'user', content: 'hi' } }, 1, null),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.timestamp).toBe('')
  })

  it('keeps an empty uuid and parentUuid when they are missing', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('user', { message: { role: 'user', content: 'hi' } }),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.uuid).toBe('')
    expect(turns[0]?.parentUuid).toBeNull()
  })

  it('pairs tool_use with tool_result from a later record', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('assistant', {
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Read', id: 'toolu_1' }],
        },
      }),
      makeRecord(
        'user',
        {
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file body', is_error: true },
            ],
          },
        },
        2,
      ),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.tools).toEqual([
      { toolName: 'Read', toolUseId: 'toolu_1', isError: true, resultBytes: 9 },
    ])
  })

  it('leaves usage null when the message has no usage field', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('assistant', { message: { role: 'assistant', content: [] } }),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.usage).toBeNull()
  })

  it('leaves model null for records without a model', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('user', { message: { role: 'user', content: 'hi' } }),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.model).toBeNull()
  })

  it('returns an empty preview when message content is a plain object', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('user', { message: { role: 'user', content: { type: 'text', text: 'x' } } }),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.textPreview).toBe('')
  })

  it('returns an empty preview when the message has no content', () => {
    // Arrange
    const records: readonly RawRecord[] = [makeRecord('user', { message: { role: 'user' } })]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.textPreview).toBe('')
  })

  it('ignores non-object blocks and blocks whose type is not a string', () => {
    // Arrange：jsonl 是外部数据，block 数组里混进标量 / 缺字段都不算异常
    const records: readonly RawRecord[] = [
      makeRecord('assistant', {
        message: {
          role: 'assistant',
          content: ['plain string', 42, null, { type: 7, text: 'x' }, { text: 'no type' }],
        },
      }),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.textPreview).toBe('')
  })

  it('keeps the first tool_result when a tool_use_id appears twice', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('assistant', {
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Read', id: 'toolu_1' }],
        },
      }),
      makeRecord(
        'user',
        {
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'first' }],
          },
        },
        2,
      ),
      makeRecord(
        'user',
        {
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'second' }],
          },
        },
        3,
      ),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.tools[0]?.resultBytes).toBe(5)
  })

  it('does not attach tools to user turns', () => {
    // Arrange
    const records: readonly RawRecord[] = [
      makeRecord('user', {
        message: {
          role: 'user',
          content: [{ type: 'tool_use', name: 'Read', id: 'toolu_1' }],
        },
      }),
    ]

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns[0]?.tools).toEqual([])
  })

  it('does not mutate the input records', () => {
    // Arrange
    const records: readonly RawRecord[] = Object.freeze([
      makeRecord('assistant', assistantPayload),
      makeRecord('user', { message: { role: 'user', content: 'hi' } }, 2),
    ])

    // Act
    const turns = extractTurns(records)

    // Assert
    expect(turns).toHaveLength(2)
    expect(records).toHaveLength(2)
    expect(records[0]?.type).toBe('assistant')
  })

  it('returns an empty array for empty input', () => {
    // Act
    const turns = extractTurns([])

    // Assert
    expect(turns).toEqual([])
  })
})
