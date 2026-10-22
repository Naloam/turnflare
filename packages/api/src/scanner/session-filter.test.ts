import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Session } from '@turnflare/core'
import { openDatabase } from '../db/index.js'
import { createRepository } from '../db/repository.js'
import { loadConfig } from '../config.js'
import { Scanner } from './index.js'
import { isScannableSession } from './session-filter.js'

const SESSION_ID = 'sess-1'

function makeSession(sessionId: string, turnCount: number): Session {
  const turns = Array.from({ length: turnCount }, (_, index) => ({
    uuid: `turn-${index + 1}`,
    parentUuid: null,
    role: 'assistant' as const,
    timestamp: '2026-10-19T08:00:00.000Z',
    model: 'claude-opus-5-5',
    usage: {
      // 与下面的 role 同样需要 as const：字面量一旦被推宽成 string，
      // 就再也赋不回 TokenUsage.speed 的 'standard' | 'fast' 联合类型
      speed: 'standard' as const,
      inputTokens: 10,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 1,
      thinkingTokens: 0,
      serverToolUse: 0,
    },
    tools: [],
    textPreview: '预览',
    isSidechain: false,
    lineNumber: index + 1,
  }))

  return {
    meta: {
      sessionId,
      filePath: `/tmp/${sessionId}.jsonl`,
      projectSlug: '-Users-che1sy-Projects-foo',
      cwd: null,
      gitBranch: null,
      cliVersion: null,
      startedAt: '2026-10-19T08:00:00.000Z',
      endedAt: '2026-10-19T08:00:00.000Z',
      models: ['claude-opus-5-5'],
    },
    turns,
    records: [],
    parseErrors: [],
  }
}

describe('isScannableSession', () => {
  it('accepts a session that has both an id and at least one turn', () => {
    // Arrange
    const session = makeSession(SESSION_ID, 2)

    // Act / Assert
    expect(isScannableSession(session)).toBe(true)
  })

  it('rejects the empty session that telemetry files degrade into', () => {
    // Arrange：插件遥测文件没有 type / sessionId / message，解析结果是空会话
    const telemetry = makeSession('', 0)

    // Act / Assert
    expect(isScannableSession(telemetry)).toBe(false)
  })

  it('requires both conditions, not either one', () => {
    // Arrange
    const withoutTurns = makeSession(SESSION_ID, 0)
    const withoutSessionId = makeSession('', 3)

    // Act / Assert
    expect(isScannableSession(withoutTurns)).toBe(false)
    expect(isScannableSession(withoutSessionId)).toBe(false)
  })

  it('treats a whitespace-only session id as absent', () => {
    // Arrange
    const session = makeSession('   ', 1)

    // Act / Assert
    expect(isScannableSession(session)).toBe(false)
  })
})

describe('嵌套 subagent 文件的项目归属', () => {
  /**
   * 曾经的 CRITICAL：core 用 basename(dirname(filePath)) 取 slug，对
   * `<root>/<项目slug>/<sessionId>/subagents/agent-x.jsonl` 会得到 `subagents`
   * 或 `wf_<runId>`。而 sessions 以 session_id 为主键、元数据列后者覆盖前者，
   * 于是最后扫到的 subagent 文件把真实项目 slug 盖掉——`/api/stats/projects`
   * 返回一堆幽灵 wf_* 项目，真实项目一次不出现，按项目筛选整个失效。
   */
  it('subagent 文件不覆盖父会话的项目归属', async () => {
    // Arrange：主文件 + 两个共享 sessionId 的 subagent 文件
    const root = mkdtempSync(join(tmpdir(), 'turnflare-slug-'))
    const projectDir = join(root, '-Users-demo-Projects-real')
    const sessionDir = join(projectDir, 'sess-1')
    const subDir = join(sessionDir, 'subagents')
    mkdirSync(subDir, { recursive: true })

    const line = (uuid: string) =>
      JSON.stringify({
        type: 'assistant',
        uuid,
        sessionId: 'sess-1',
        timestamp: '2026-10-19T08:00:00.000Z',
        isSidechain: uuid.startsWith('sub'),
        cwd: '/Users/demo/Projects/real',
        gitBranch: 'main',
        message: {
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: 'x' }],
          usage: {
            input_tokens: 100,
            output_tokens: 10,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens_details: { thinking_tokens: 0 },
            server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
            speed: 'standard',
          },
        },
      })

    writeFileSync(join(sessionDir, 'sess-1.jsonl'), `${line('main-1')}\n`, 'utf8')
    writeFileSync(join(subDir, 'agent-a.jsonl'), `${line('sub-a')}\n`, 'utf8')
    writeFileSync(join(subDir, 'agent-b.jsonl'), `${line('sub-b')}\n`, 'utf8')

    const { db } = openDatabase(':memory:')
    const repo = createRepository(db)
    const config = loadConfig({ TURNFLARE_DB: ':memory:' })
    await new Scanner({ repo, config }).scan({ rootDir: root })

    // Act
    const projects = repo.getProjectStats().map((p) => p.projectSlug)

    // Assert：只有真实项目 slug，没有 subagents / wf_* 幽灵项目
    expect(projects).toEqual(['-Users-demo-Projects-real'])
    // 按真实项目筛选能查到会话
    expect(repo.listSessions({ project: '-Users-demo-Projects-real' }).total).toBe(1)

    db.close()
    rmSync(root, { recursive: true, force: true })
  })
})
