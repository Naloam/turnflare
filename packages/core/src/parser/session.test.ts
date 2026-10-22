import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MAX_FILE_BYTES, parseSessionFile } from './session'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'turnflare-session-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

/** 在 `<tempDir>/<projectSlug>/` 下写一个会话文件，返回完整路径 */
function writeSession(projectSlug: string, fileName: string, lines: readonly string[]): string {
  const directory = join(tempDir, projectSlug)
  mkdirSync(directory, { recursive: true })
  const filePath = join(directory, fileName)
  writeFileSync(filePath, lines.map((line) => `${line}\n`).join(''), 'utf8')
  return filePath
}

function userLine(uuid: string, text: string): string {
  return JSON.stringify({
    type: 'user',
    uuid,
    parentUuid: null,
    timestamp: '2026-10-19T08:25:26.923Z',
    sessionId: 'sess-1',
    cwd: '/Users/che1sy/Projects/foo',
    gitBranch: 'main',
    version: '2.0.30',
    message: { role: 'user', content: [{ type: 'text', text }] },
  })
}

function assistantLine(uuid: string, model: string, usage: unknown): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    parentUuid: 'u1',
    timestamp: '2026-10-19T09:00:00.000Z',
    isSidechain: false,
    message: {
      role: 'assistant',
      model,
      usage,
      content: [{ type: 'text', text: 'done' }],
    },
  })
}

const FULL_USAGE = {
  input_tokens: 100,
  cache_creation_input_tokens: 10,
  cache_read_input_tokens: 20,
  output_tokens: 30,
  output_tokens_details: { thinking_tokens: 5 },
  server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
}

describe('parseSessionFile', () => {
  it('parses a session file into meta, turns and records', () => {
    // Arrange
    const filePath = writeSession('-Users-che1sy-Projects-foo', 'sess-1.jsonl', [
      userLine('u1', 'hello'),
      assistantLine('a1', 'claude-opus-5-5', FULL_USAGE),
      assistantLine('a2', 'claude-opus-5-5', FULL_USAGE),
    ])

    // Act
    const session = parseSessionFile(filePath)

    // Assert
    expect(session.meta).toEqual({
      sessionId: 'sess-1',
      filePath,
      projectSlug: '-Users-che1sy-Projects-foo',
      cwd: '/Users/che1sy/Projects/foo',
      gitBranch: 'main',
      cliVersion: '2.0.30',
      startedAt: '2026-10-19T08:25:26.923Z',
      endedAt: '2026-10-19T09:00:00.000Z',
      models: ['claude-opus-5-5'],
    })
    expect(session.turns).toHaveLength(3)
    expect(session.records).toHaveLength(3)
    expect(session.parseErrors).toEqual([])
  })

  it('collects every model in first-seen order', () => {
    // Arrange
    const filePath = writeSession('slug', 'models.jsonl', [
      userLine('u1', 'hi'),
      assistantLine('a1', 'claude-opus-5-5', FULL_USAGE),
      assistantLine('a2', 'claude-haiku-4-5', FULL_USAGE),
      assistantLine('a3', 'claude-opus-5-5', FULL_USAGE),
    ])

    // Act
    const session = parseSessionFile(filePath)

    // Assert
    expect(session.meta.models).toEqual(['claude-opus-5-5', 'claude-haiku-4-5'])
  })

  it('records parse errors for truncated lines without losing the rest', () => {
    // Arrange：ARCHITECTURE.md §1.2 坑 2 —— 会话正在写入时会出现半行 JSON
    const filePath = writeSession('slug', 'truncated.jsonl', [
      userLine('u1', 'hello'),
      '{"type":"assistant","uuid":"a1","mess',
      assistantLine('a2', 'claude-opus-5-5', FULL_USAGE),
    ])

    // Act
    const session = parseSessionFile(filePath)

    // Assert
    expect(session.parseErrors).toHaveLength(1)
    expect(session.parseErrors[0]?.lineNumber).toBe(2)
    expect(session.turns).toHaveLength(2)
    expect(session.meta.startedAt).toBe('2026-10-19T08:25:26.923Z')
  })

  it('returns an empty session with one parse error when the file is too large', () => {
    // Arrange
    const filePath = writeSession('slug', 'big.jsonl', [userLine('u1', 'hello')])

    // Act
    const session = parseSessionFile(filePath, { maxFileBytes: 8 })

    // Assert
    expect(session.records).toEqual([])
    expect(session.turns).toEqual([])
    expect(session.parseErrors).toHaveLength(1)
    expect(session.parseErrors[0]?.message).toContain('超过上限')
    expect(session.meta.sessionId).toBe('')
  })

  it('parses files below the default 50MB limit', () => {
    // Arrange
    const padding = 'p'.repeat(1024 * 1024)
    const filePath = writeSession('slug', 'default-limit.jsonl', [userLine('u1', padding)])

    // Act
    const session = parseSessionFile(filePath)

    // Assert
    expect(DEFAULT_MAX_FILE_BYTES).toBe(50 * 1024 * 1024)
    expect(session.parseErrors).toEqual([])
    expect(session.turns).toHaveLength(1)
  })

  it('throws a Chinese error when the file does not exist', () => {
    // Arrange
    const missingPath = join(tempDir, 'slug', 'missing.jsonl')

    // Act & Assert
    expect(() => parseSessionFile(missingPath)).toThrow(`无法读取会话文件：${missingPath}`)
  })

  it('applies maxTextPreviewChars to turn previews', () => {
    // Arrange
    const filePath = writeSession('slug', 'preview.jsonl', [userLine('u1', 'abcdefghij')])

    // Act
    const session = parseSessionFile(filePath, { maxTextPreviewChars: 3 })

    // Assert
    expect(session.turns[0]?.textPreview).toBe('abc')
  })

  it('falls back to message.session_id when the top-level field is missing', () => {
    // Arrange
    const filePath = writeSession('slug', 'message-session-id.jsonl', [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-10-19T08:25:26.923Z',
        message: { role: 'user', session_id: 'sess-from-message', content: 'hi' },
      }),
    ])

    // Act
    const session = parseSessionFile(filePath)

    // Assert
    expect(session.meta.sessionId).toBe('sess-from-message')
  })

  it('returns an empty session for an empty file', () => {
    // Arrange
    const filePath = writeSession('slug', 'empty.jsonl', [])

    // Act
    const session = parseSessionFile(filePath)

    // Assert
    expect(session.records).toEqual([])
    expect(session.turns).toEqual([])
    expect(session.parseErrors).toEqual([])
    expect(session.meta.startedAt).toBeNull()
    expect(session.meta.endedAt).toBeNull()
    expect(session.meta.models).toEqual([])
  })

  it('passes timestamps through without any timezone conversion', () => {
    // Arrange
    const filePath = writeSession('slug', 'tz.jsonl', [userLine('u1', 'hi')])

    // Act
    const session = parseSessionFile(filePath)

    // Assert
    expect(session.turns[0]?.timestamp).toBe('2026-10-19T08:25:26.923Z')
    expect(session.meta.startedAt).toBe('2026-10-19T08:25:26.923Z')
  })

  it('flags sidechain turns from the isSidechain field', () => {
    // Arrange
    const filePath = writeSession('slug', 'sidechain.jsonl', [
      userLine('u1', 'hi'),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-10-19T09:00:00.000Z',
        isSidechain: true,
        message: { role: 'assistant', model: 'claude-opus-5-5', content: [] },
      }),
    ])

    // Act
    const session = parseSessionFile(filePath)

    // Assert
    expect(session.turns[0]?.isSidechain).toBe(false)
    expect(session.turns[1]?.isSidechain).toBe(true)
  })

  it('keeps duplicated uuids because deduplication belongs to the stats module', () => {
    // Arrange：compaction 会让同一消息出现在多条记录里（ARCHITECTURE.md §1.2 坑 5）
    const filePath = writeSession('slug', 'dup-uuid.jsonl', [
      userLine('u1', 'hi'),
      userLine('u1', 'hi'),
    ])

    // Act
    const session = parseSessionFile(filePath)

    // Assert
    expect(session.records).toHaveLength(2)
    expect(session.turns.map((turn) => turn.uuid)).toEqual(['u1', 'u1'])
  })

  it('skips records that are neither user nor assistant when building turns', () => {
    // Arrange
    const filePath = writeSession('slug', 'mixed.jsonl', [
      userLine('u1', 'hi'),
      JSON.stringify({ type: 'api-request', params: { model: 'claude-opus-5-5' } }),
      JSON.stringify({ type: 'file-history-snapshot', snapshot: {} }),
      JSON.stringify({ type: 'summary', summary: 'compacted' }),
    ])

    // Act
    const session = parseSessionFile(filePath)

    // Assert
    expect(session.records).toHaveLength(4)
    expect(session.turns).toHaveLength(1)
  })

  it('pairs tool calls with their results across records', () => {
    // Arrange
    const filePath = writeSession('slug', 'tools.jsonl', [
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-10-19T08:25:26.923Z',
        message: {
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'tool_use', name: 'Read', id: 'toolu_1', input: { file_path: '/a' } }],
        },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-10-19T08:25:27.000Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: 'file contents',
              is_error: true,
            },
          ],
        },
      }),
    ])

    // Act
    const session = parseSessionFile(filePath)

    // Assert
    expect(session.turns[0]?.tools).toEqual([
      { toolName: 'Read', toolUseId: 'toolu_1', isError: true, resultBytes: 13 },
    ])
  })

  it('degrades gracefully for jsonl files that are not session transcripts', () => {
    // Arrange：`~/.claude/projects` 下混有插件遥测文件（如 vercel-plugin/skill-injections.jsonl），
    // 每行都是合法 JSON 但没有 type / sessionId / message。实测这类文件有 25/71 个，
    // 解析结果必须是"空会话 + 零错误"，而不是崩溃或伪造数据。
    const filePath = writeSession('vercel-plugin', 'skill-injections.jsonl', [
      JSON.stringify({
        timestamp: '2026-10-19T08:25:26.923Z',
        event: 'skill-injection',
        toolName: 'Read',
        matchedSkills: ['nextjs'],
      }),
    ])

    // Act
    const session = parseSessionFile(filePath)

    // Assert
    expect(session.records).toHaveLength(1)
    expect(session.turns).toEqual([])
    expect(session.parseErrors).toEqual([])
    expect(session.meta.sessionId).toBe('')
    expect(session.meta.models).toEqual([])
    expect(session.meta.startedAt).toBe('2026-10-19T08:25:26.923Z')
  })

  it('normalizes usage of assistant turns', () => {
    // Arrange
    const filePath = writeSession('slug', 'usage.jsonl', [
      assistantLine('a1', 'claude-opus-5-5', FULL_USAGE),
    ])

    // Act
    const session = parseSessionFile(filePath)

    // Assert
    expect(session.turns[0]?.usage).toEqual({
      speed: 'standard',
      inputTokens: 100,
      cacheCreationTokens: 10,
      cacheReadTokens: 20,
      outputTokens: 30,
      thinkingTokens: 5,
      serverToolUse: 1,
    })
  })
})
