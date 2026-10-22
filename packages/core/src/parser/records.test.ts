import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ParseError, RawRecord } from '../types.js'
import { extractCacheCreationSplit, normalizeUsage, streamSessionRecords } from './records.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'turnflare-records-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function writeJsonl(name: string, lines: readonly string[]): string {
  const filePath = join(tempDir, name)
  writeFileSync(filePath, lines.map((line) => `${line}\n`).join(''), 'utf8')
  return filePath
}

function collect(filePath: string, onError: (error: ParseError) => void): RawRecord[] {
  return [...streamSessionRecords(filePath, { onError })]
}

describe('streamSessionRecords', () => {
  it('yields normalized records for valid jsonl lines', () => {
    // Arrange
    const filePath = writeJsonl('valid.jsonl', [
      '{"type":"user","timestamp":"2026-10-19T08:25:26.923Z","uuid":"u1"}',
      '{"type":"assistant","timestamp":"2026-10-19T08:25:27.000Z","uuid":"a1"}',
    ])

    // Act
    const records = collect(filePath, () => undefined)

    // Assert
    expect(records).toHaveLength(2)
    expect(records[0]).toEqual({
      lineNumber: 1,
      type: 'user',
      timestamp: '2026-10-19T08:25:26.923Z',
      payload: { type: 'user', timestamp: '2026-10-19T08:25:26.923Z', uuid: 'u1' },
    })
    expect(records[1]?.type).toBe('assistant')
  })

  it('maps an unrecognized type to unknown', () => {
    // Arrange
    const filePath = writeJsonl('unknown-type.jsonl', ['{"type":"future-record-kind"}'])

    // Act
    const records = collect(filePath, () => undefined)

    // Assert
    expect(records[0]?.type).toBe('unknown')
  })

  it('maps a missing or non-string type to unknown', () => {
    // Arrange
    const filePath = writeJsonl('bad-type.jsonl', ['{"uuid":"u1"}', '{"type":42}'])

    // Act
    const records = collect(filePath, () => undefined)

    // Assert
    expect(records.map((record) => record.type)).toEqual(['unknown', 'unknown'])
  })

  it('reports malformed JSON through onError and keeps streaming', () => {
    // Arrange：第二行是 ARCHITECTURE.md §1.2 坑 2 的截断行
    const filePath = writeJsonl('truncated.jsonl', [
      '{"type":"user","uuid":"u1"}',
      '{"type":"assistant","uuid":"a1","mess',
      '{"type":"user","uuid":"u2"}',
    ])
    const errors: ParseError[] = []

    // Act
    const records = collect(filePath, (error) => errors.push(error))

    // Assert
    expect(records).toHaveLength(2)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.lineNumber).toBe(2)
    expect(errors[0]?.message).toContain('第 2 行解析失败')
    expect(errors[0]?.rawExcerpt).toBe('{"type":"assistant","uuid":"a1","mess')
  })

  it('reports non-object lines through onError and skips them', () => {
    // Arrange
    const filePath = writeJsonl('non-object.jsonl', [
      '"just a string"',
      '[1,2,3]',
      '42',
      'null',
      '{"type":"user","uuid":"u1"}',
    ])
    const errors: ParseError[] = []

    // Act
    const records = collect(filePath, (error) => errors.push(error))

    // Assert
    expect(records).toHaveLength(1)
    expect(errors).toHaveLength(4)
    expect(errors.every((error) => error.message.includes('记录不是 JSON 对象'))).toBe(true)
  })

  it('silently skips malformed lines when onError is not provided', () => {
    // Arrange
    const filePath = writeJsonl('silent.jsonl', ['not json', '{"type":"user","uuid":"u1"}'])

    // Act
    const records = [...streamSessionRecords(filePath)]

    // Assert
    expect(records).toHaveLength(1)
    expect(records[0]?.type).toBe('user')
  })

  it('sets timestamp to null when the field is missing', () => {
    // Arrange
    const filePath = writeJsonl('no-timestamp.jsonl', ['{"type":"summary"}'])

    // Act
    const records = collect(filePath, () => undefined)

    // Assert
    expect(records[0]?.timestamp).toBeNull()
  })

  it('numbers lines from one and counts skipped lines', () => {
    // Arrange
    const filePath = writeJsonl('line-numbers.jsonl', [
      '{"type":"user","uuid":"u1"}',
      'broken',
      '{"type":"user","uuid":"u2"}',
    ])

    // Act
    const records = collect(filePath, () => undefined)

    // Assert
    expect(records.map((record) => record.lineNumber)).toEqual([1, 3])
  })

  it('truncates rawExcerpt to 200 characters', () => {
    // Arrange
    const longLine = `{"type":"user","pad":"${'y'.repeat(500)}"}`
    const filePath = writeJsonl('long-excerpt.jsonl', [longLine.slice(0, -1)])
    const errors: ParseError[] = []

    // Act
    collect(filePath, (error) => errors.push(error))

    // Assert
    expect(errors[0]?.rawExcerpt).toHaveLength(200)
  })

  it('parses a line of several megabytes', () => {
    // Arrange
    const huge = 'z'.repeat(2 * 1024 * 1024)
    const filePath = writeJsonl('huge-line.jsonl', [`{"type":"user","pad":"${huge}"}`])

    // Act
    const records = collect(filePath, () => undefined)

    // Assert
    expect(records).toHaveLength(1)
    expect(records[0]?.type).toBe('user')
  })

  it('throws a Chinese error when the file does not exist', () => {
    // Arrange
    const missingPath = join(tempDir, 'missing.jsonl')

    // Act & Assert
    expect(() => [...streamSessionRecords(missingPath)]).toThrow(`无法读取会话文件：${missingPath}`)
  })
})

describe('normalizeUsage', () => {
  it('maps every supported field from a complete usage object', () => {
    // Arrange
    const raw = {
      input_tokens: 40198,
      cache_creation_input_tokens: 1200,
      cache_read_input_tokens: 800,
      output_tokens: 1183,
      output_tokens_details: { thinking_tokens: 256 },
      server_tool_use: { web_search_requests: 2, web_fetch_requests: 3 },
    }

    // Act
    const usage = normalizeUsage(raw)

    // Assert
    expect(usage).toEqual({
      speed: 'standard',
      inputTokens: 40198,
      cacheCreationTokens: 1200,
      cacheReadTokens: 800,
      outputTokens: 1183,
      thinkingTokens: 256,
      serverToolUse: 5,
    })
  })

  it('fills zeros when fields are missing', () => {
    // Act
    const usage = normalizeUsage({ input_tokens: 10 })

    // Assert
    expect(usage).toEqual({
      speed: 'standard',
      inputTokens: 10,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      serverToolUse: 0,
    })
  })

  it('coerces non-number fields to zero', () => {
    // Arrange
    const raw = {
      input_tokens: '40198',
      cache_creation_input_tokens: null,
      output_tokens: { value: 5 },
    }

    // Act
    const usage = normalizeUsage(raw)

    // Assert
    expect(usage.inputTokens).toBe(0)
    expect(usage.cacheCreationTokens).toBe(0)
    expect(usage.outputTokens).toBe(0)
  })

  it('returns zeros for nullish and primitive inputs', () => {
    // Act & Assert
    expect(normalizeUsage(null)).toEqual({
      speed: 'standard',
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      serverToolUse: 0,
    })
    expect(normalizeUsage(undefined).outputTokens).toBe(0)
    expect(normalizeUsage('usage').outputTokens).toBe(0)
    expect(normalizeUsage(7).outputTokens).toBe(0)
  })

  it('returns zeros when the input is an array', () => {
    // Arrange：数组也是 object，必须显式排除
    const raw = [{ input_tokens: 5 }, { output_tokens: 9 }]

    // Act
    const usage = normalizeUsage(raw)

    // Assert
    expect(usage.inputTokens).toBe(0)
    expect(usage.outputTokens).toBe(0)
  })

  it('returns zeros when nested objects are not objects', () => {
    // Arrange
    const raw = {
      input_tokens: 1,
      output_tokens_details: 'thinking',
      server_tool_use: [1, 2],
    }

    // Act
    const usage = normalizeUsage(raw)

    // Assert
    expect(usage.thinkingTokens).toBe(0)
    expect(usage.serverToolUse).toBe(0)
  })

  it('treats NaN and Infinity as zero', () => {
    // Arrange
    const raw = { input_tokens: Number.NaN, output_tokens: Number.POSITIVE_INFINITY }

    // Act
    const usage = normalizeUsage(raw)

    // Assert
    expect(usage.inputTokens).toBe(0)
    expect(usage.outputTokens).toBe(0)
  })

  it('does not mutate the input object', () => {
    // Arrange
    const raw = Object.freeze({ input_tokens: 5, server_tool_use: Object.freeze({}) })

    // Act
    const usage = normalizeUsage(raw)

    // Assert
    expect(usage.inputTokens).toBe(5)
    expect(Object.keys(raw)).toEqual(['input_tokens', 'server_tool_use'])
  })
})

describe('extractCacheCreationSplit', () => {
  it('reads both TTL buckets', () => {
    // Arrange
    const raw = {
      cache_creation: { ephemeral_1h_input_tokens: 700, ephemeral_5m_input_tokens: 300 },
    }

    // Act
    const split = extractCacheCreationSplit(raw)

    // Assert
    expect(split).toEqual({ ephemeral1h: 700, ephemeral5m: 300 })
  })

  it('returns zeros when cache_creation is missing or malformed', () => {
    // Act & Assert
    expect(extractCacheCreationSplit({ input_tokens: 1 })).toEqual({
      ephemeral1h: 0,
      ephemeral5m: 0,
    })
    expect(extractCacheCreationSplit({ cache_creation: 'nope' })).toEqual({
      ephemeral1h: 0,
      ephemeral5m: 0,
    })
    expect(extractCacheCreationSplit(null)).toEqual({ ephemeral1h: 0, ephemeral5m: 0 })
  })
})
