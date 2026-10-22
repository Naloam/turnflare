import { describe, expect, it } from 'vitest'
import {
  asRecord,
  emptyCostBreakdown,
  emptyTokenUsage,
  foldCosts,
  foldModelStats,
  foldUsage,
  groupRowsBy,
  parseModels,
  readBooleanField,
  readCount,
  readIntegerField,
  readIntegerFrom,
  readNonEmptyText,
  readTextField,
  readTextFieldFrom,
  readTextWithFallback,
  sumRequestCount,
  toCostBreakdown,
  toFileStamp,
  toModelStats,
  toProjectStats,
  toSessionListItem,
  toTimeBucket,
  toTokenUsage,
  toToolInvocation,
  toToolStats,
  toTurn,
} from './mapper.js'

describe('readTextField / readTextWithFallback / readNonEmptyText', () => {
  it('returns null when the value is not a string', () => {
    // Arrange
    const values: readonly unknown[] = [null, undefined, 42, true, {}, []]

    // Act
    const results = values.map((value) => readTextField(value))

    // Assert
    expect(results).toEqual([null, null, null, null, null, null])
  })

  it('substitutes the fallback only when the value is missing', () => {
    // Arrange / Act / Assert
    expect(readTextWithFallback('claude-opus-5-5', 'fallback')).toBe('claude-opus-5-5')
    expect(readTextWithFallback(null, 'fallback')).toBe('fallback')
    expect(readTextWithFallback('', 'fallback')).toBe('')
  })

  it('treats an empty string as absent', () => {
    // Arrange / Act / Assert
    expect(readNonEmptyText('')).toBeNull()
    expect(readNonEmptyText('turn-1')).toBe('turn-1')
  })
})

describe('readIntegerField', () => {
  it('reads finite numbers and converts bigint', () => {
    // Arrange / Act / Assert
    expect(readIntegerField(7)).toBe(7)
    expect(readIntegerField(0)).toBe(0)
    expect(readIntegerField(9n)).toBe(9)
  })

  it('returns 0 for NaN, Infinity and non-numbers', () => {
    // Arrange
    const values: readonly unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, '12', null, {}]

    // Act
    const results = values.map((value) => readIntegerField(value))

    // Assert
    expect(results).toEqual([0, 0, 0, 0, 0])
  })
})

describe('readBooleanField', () => {
  it('maps SQLite 0/1 to booleans', () => {
    // Arrange / Act / Assert
    expect(readBooleanField(0)).toBe(false)
    expect(readBooleanField(1)).toBe(true)
    expect(readBooleanField(2)).toBe(true)
    expect(readBooleanField(true)).toBe(true)
    expect(readBooleanField(null)).toBe(false)
  })
})

describe('parseModels', () => {
  it('parses a JSON array of model ids', () => {
    // Arrange / Act
    const models = parseModels('["claude-opus-5-5","claude-haiku-4-5"]')

    // Assert
    expect(models).toEqual(['claude-opus-5-5', 'claude-haiku-4-5'])
  })

  it('degrades to an empty array when the JSON is malformed', () => {
    // Arrange / Act / Assert
    expect(parseModels('{"not":"an array"}')).toEqual([])
    expect(parseModels('[1,2')).toEqual([])
  })

  it('drops non-string entries and non-string input', () => {
    // Arrange / Act / Assert
    expect(parseModels('["ok",5,null]')).toEqual(['ok'])
    expect(parseModels(null)).toEqual([])
    expect(parseModels('')).toEqual([])
  })
})

describe('asRecord', () => {
  it('accepts plain objects and rejects everything else', () => {
    // Arrange / Act / Assert
    expect(asRecord({ a: 1 })).toEqual({ a: 1 })
    expect(asRecord(null)).toBeNull()
    expect(asRecord([])).toBeNull()
    expect(asRecord('text')).toBeNull()
  })
})

describe('toTokenUsage', () => {
  it('maps every token column', () => {
    // Arrange
    const row = {
      input_tokens: 100,
      cache_creation_tokens: 10,
      cache_read_tokens: 20,
      output_tokens: 30,
      thinking_tokens: 5,
      server_tool_use: 2,
    }

    // Act
    const usage = toTokenUsage(row)

    // Assert
    expect(usage).toEqual({
      speed: 'standard',
      inputTokens: 100,
      cacheCreationTokens: 10,
      cacheReadTokens: 20,
      outputTokens: 30,
      thinkingTokens: 5,
      serverToolUse: 2,
    })
  })

  it('fills missing columns with zero', () => {
    // Arrange / Act
    const usage = toTokenUsage({ input_tokens: 4 })

    // Assert
    expect(usage).toEqual({
      speed: 'standard',
      inputTokens: 4,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      serverToolUse: 0,
    })
  })

  it('carries the fast tier through instead of silently downgrading it', () => {
    // Arrange：fast 档单价约为标准档 2 倍，读的时候丢档等于成本低估一半
    const row = { input_tokens: 100, speed: 'fast' }

    // Act
    const usage = toTokenUsage(row)

    // Assert
    expect(usage.speed).toBe('fast')
  })

  it('falls back to the standard tier for missing or unknown speed values', () => {
    // Arrange / Act / Assert
    expect(toTokenUsage({ input_tokens: 1 }).speed).toBe('standard')
    expect(toTokenUsage({ input_tokens: 1, speed: 'turbo' }).speed).toBe('standard')
    expect(toTokenUsage({ input_tokens: 1, speed: null }).speed).toBe('standard')
  })

  it('returns an all-zero usage for rows that are not objects', () => {
    // Arrange / Act / Assert
    expect(toTokenUsage(null)).toEqual(emptyTokenUsage())
    expect(toTokenUsage('nope')).toEqual(emptyTokenUsage())
  })
})

describe('toCostBreakdown', () => {
  it('prices a known model from its token columns', () => {
    // Arrange
    const row = { model: 'claude-opus-5-5', input_tokens: 1_000_000, output_tokens: 1_000_000 }

    // Act
    const cost = toCostBreakdown(row)

    // Assert
    expect(cost.totalCost).toBeGreaterThan(0)
    expect(cost.unpricedModel).toBe(false)
    expect(cost.currency).toBe('USD')
  })

  it('reports an unpriced model instead of guessing a price', () => {
    // Arrange
    const row = { model: 'claude-not-in-the-table-9-9', input_tokens: 1_000_000 }

    // Act
    const cost = toCostBreakdown(row)

    // Assert
    expect(cost.totalCost).toBe(0)
    expect(cost.unpricedModel).toBe(true)
  })

  it('treats a missing model column as an unknown model', () => {
    // Arrange / Act
    const cost = toCostBreakdown({ input_tokens: 10 })

    // Assert：查不到价目时 core 会同时打上 unpricedModel 与 isEstimated
    expect(cost.totalCost).toBe(0)
    expect(cost.unpricedModel).toBe(true)
    expect(cost.isEstimated).toBe(true)
    expect(cost.currency).toBe('USD')
  })

  it('returns an all-zero cost for rows that are not objects', () => {
    // Arrange / Act / Assert
    expect(toCostBreakdown(null)).toEqual(emptyCostBreakdown())
  })
})

describe('foldUsage / foldCosts / sumRequestCount', () => {
  it('sums token, cost and request columns across rows', () => {
    // Arrange
    const rows = [
      { model: 'claude-opus-5-5', input_tokens: 10, request_count: 1 },
      { model: 'claude-opus-5-5', input_tokens: 5, request_count: 2 },
    ]

    // Act
    const usage = foldUsage(rows)
    const cost = foldCosts(rows)
    const requests = sumRequestCount(rows)

    // Assert
    expect(usage.inputTokens).toBe(15)
    expect(cost.totalCost).toBeGreaterThan(0)
    expect(requests).toBe(3)
  })

  it('returns zeros for an empty row list', () => {
    // Arrange / Act / Assert
    expect(foldUsage([])).toEqual(emptyTokenUsage())
    expect(foldCosts([])).toEqual(emptyCostBreakdown())
    expect(sumRequestCount([])).toBe(0)
  })
})

describe('groupRowsBy', () => {
  it('groups rows by the key column and drops empty keys', () => {
    // Arrange
    const rows = [
      { session_id: 'a', input_tokens: 1 },
      { session_id: 'b', input_tokens: 2 },
      { session_id: 'a', input_tokens: 3 },
      { session_id: '', input_tokens: 4 },
      { input_tokens: 5 },
    ]

    // Act
    const grouped = groupRowsBy(rows, 'session_id')

    // Assert
    expect([...grouped.keys()]).toEqual(['a', 'b'])
    expect(grouped.get('a')).toHaveLength(2)
    expect(foldUsage(grouped.get('a') ?? []).inputTokens).toBe(4)
  })
})

describe('toTurn', () => {
  it('marks assistant rows as billable and user rows as not', () => {
    // Arrange
    const assistantRow = {
      uuid: 'a1',
      role: 'assistant',
      input_tokens: 12,
      timestamp: '2026-10-19T08:00:00.000Z',
    }
    const userRow = { uuid: 'u1', role: 'user', input_tokens: 0 }

    // Act
    const assistant = toTurn(assistantRow, [])
    const user = toTurn(userRow, [])

    // Assert
    expect(assistant?.usage?.inputTokens).toBe(12)
    expect(user?.usage).toBeNull()
  })

  it('attaches the tools supplied by the caller', () => {
    // Arrange
    const row = { uuid: 'a1', role: 'assistant', input_tokens: 1 }
    const tools = [{ toolName: 'Write', toolUseId: 't1', isError: false, resultBytes: 12 }]

    // Act
    const turn = toTurn(row, tools)

    // Assert
    expect(turn?.tools).toEqual(tools)
  })

  it('returns null when the row is not an object', () => {
    // Arrange / Act / Assert
    expect(toTurn(null, [])).toBeNull()
    expect(toTurn([], [])).toBeNull()
  })
})

describe('toToolInvocation', () => {
  it('maps tool columns including the error flag', () => {
    // Arrange
    const row = { tool_name: 'Bash', tool_use_id: 't1', is_error: 1, result_bytes: 42 }

    // Act
    const tool = toToolInvocation(row)

    // Assert
    expect(tool).toEqual({ toolName: 'Bash', toolUseId: 't1', isError: true, resultBytes: 42 })
  })
})

describe('toSessionListItem', () => {
  it('maps session columns and uses the cost supplied by the caller', () => {
    // Arrange
    const row = {
      session_id: 'sess-1',
      project_slug: '-Users-che1sy-Projects-foo',
      cwd: '/Users/che1sy/Projects/foo',
      git_branch: 'main',
      started_at: '2026-10-19T08:00:00.000Z',
      ended_at: '2026-10-19T09:00:00.000Z',
      models: '["claude-opus-5-5"]',
      turn_count: 3,
      input_tokens: 100,
    }
    const cost = { ...emptyCostBreakdown(), totalCost: 1.5 }

    // Act
    const item = toSessionListItem(row, cost)

    // Assert
    expect(item).toEqual({
      sessionId: 'sess-1',
      projectSlug: '-Users-che1sy-Projects-foo',
      cwd: '/Users/che1sy/Projects/foo',
      gitBranch: 'main',
      startedAt: '2026-10-19T08:00:00.000Z',
      endedAt: '2026-10-19T09:00:00.000Z',
      models: ['claude-opus-5-5'],
      turnCount: 3,
      usage: { ...emptyTokenUsage(), inputTokens: 100 },
      cost,
    })
  })

  it('returns null for rows that are not objects', () => {
    // Arrange / Act / Assert
    expect(toSessionListItem(null, emptyCostBreakdown())).toBeNull()
  })
})

describe('grouped statistics rows', () => {
  it('maps a per-model row to ModelStats', () => {
    // Arrange
    const row = { model: 'claude-opus-5-5', request_count: 2, input_tokens: 10 }

    // Act
    const stats = toModelStats(row)

    // Assert
    expect(stats.model).toBe('claude-opus-5-5')
    expect(stats.requestCount).toBe(2)
    expect(stats.usage.inputTokens).toBe(10)
    expect(stats.cost.totalCost).toBeGreaterThan(0)
  })

  it('counts distinct sessions when folding project rows', () => {
    // Arrange
    const rows = [
      { session_id: 's1', model: 'claude-opus-5-5', input_tokens: 10 },
      { session_id: 's1', model: 'claude-haiku-4-5', input_tokens: 5 },
      { session_id: 's2', model: 'claude-opus-5-5', input_tokens: 7 },
    ]

    // Act
    const stats = toProjectStats('-Users-che1sy-Projects-foo', rows)

    // Assert
    expect(stats.projectSlug).toBe('-Users-che1sy-Projects-foo')
    expect(stats.sessionCount).toBe(2)
    expect(stats.usage.inputTokens).toBe(22)
  })

  it('folds per-tier rows back into one ModelStats per model', () => {
    // Arrange：SQL 按 (model, speed) 分组才能分开计价，折回来必须还是一个模型一条
    const rows = [
      { model: 'claude-opus-5-5', speed: 'fast', request_count: 1, input_tokens: 1_000_000 },
      { model: 'claude-opus-5-5', speed: 'standard', request_count: 2, input_tokens: 1_000_000 },
      { model: 'claude-haiku-4-5', speed: 'standard', request_count: 1, input_tokens: 5 },
    ]

    // Act
    const stats = foldModelStats(rows)

    // Assert
    expect(stats.map((entry) => entry.model)).toEqual(['claude-opus-5-5', 'claude-haiku-4-5'])
    expect(stats[0]?.requestCount).toBe(3)
    expect(stats[0]?.usage.inputTokens).toBe(2_000_000)
    // 逐档计价后再相加：opus-5-5 fast 输入价 $8/M × 1M + 标准 $4/M × 1M
    expect(stats[0]?.cost.totalCost).toBeCloseTo(8 + 4, 10)
  })

  it('prices a mixed-tier bucket by tier instead of by the first row', () => {
    // Arrange：先加 token 再统一计价会把 fast 用量按标准价算掉
    const rows = [
      { request_count: 1, model: 'claude-opus-5-5', speed: 'fast', input_tokens: 1_000_000 },
      { request_count: 1, model: 'claude-opus-5-5', speed: 'standard', input_tokens: 1_000_000 },
    ]

    // Act
    const bucket = toTimeBucket('2026-10-19T08:00:00Z', rows)

    // Assert
    expect(bucket.requestCount).toBe(2)
    expect(bucket.usage.inputTokens).toBe(2_000_000)
    expect(bucket.cost.totalCost).toBeCloseTo(8 + 4, 10)
  })

  it('folds per-bucket rows into a single TimeBucket', () => {
    // Arrange
    const rows = [
      { request_count: 1, input_tokens: 10, model: 'claude-opus-5-5' },
      { request_count: 2, input_tokens: 5, model: 'claude-opus-5-5' },
    ]

    // Act
    const bucket = toTimeBucket('2026-10-19T08:00:00Z', rows)

    // Assert
    expect(bucket.bucket).toBe('2026-10-19T08:00:00Z')
    expect(bucket.requestCount).toBe(3)
    expect(bucket.usage.inputTokens).toBe(15)
  })

  it('maps a tool aggregation row to ToolStats', () => {
    // Arrange
    const row = { tool_name: 'Write', call_count: 4, error_count: 1, total_result_bytes: 99 }

    // Act
    const stats = toToolStats(row)

    // Assert
    expect(stats).toEqual({
      toolName: 'Write',
      callCount: 4,
      errorCount: 1,
      totalResultBytes: 99,
    })
  })
})

describe('toFileStamp', () => {
  it('maps the incremental scan key columns', () => {
    // Arrange
    const row = { file_path: '/tmp/a.jsonl', file_mtime_ms: 123.5, file_size_bytes: 2048 }

    // Act
    const stamp = toFileStamp(row)

    // Assert
    expect(stamp).toEqual({ filePath: '/tmp/a.jsonl', mtimeMs: 123.5, sizeBytes: 2048 })
  })

  it('returns null when the row has no file path', () => {
    // Arrange / Act / Assert
    expect(toFileStamp({ file_mtime_ms: 1 })).toBeNull()
    expect(toFileStamp(null)).toBeNull()
  })
})

describe('single value readers', () => {
  it('reads COUNT(*) rows and MIN/MAX rows', () => {
    // Arrange / Act / Assert
    expect(readCount({ total: 7 })).toBe(7)
    expect(readCount({})).toBe(0)
    expect(readIntegerFrom({ parse_error_count: 2 }, 'parse_error_count')).toBe(2)
    expect(readTextFieldFrom({ last_scan_at: '2026-10-19T08:00:00.000Z' }, 'last_scan_at')).toBe(
      '2026-10-19T08:00:00.000Z',
    )
    expect(readTextFieldFrom({ last_scan_at: null }, 'last_scan_at')).toBeNull()
  })
})
