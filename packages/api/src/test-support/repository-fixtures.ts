/**
 * 仓储测试共用夹具：真 SQLite 连接 + 领域对象建造器。
 *
 * 为什么单独一个文件：`repository.test.ts` 与 `repository-sidechain.test.ts`
 * 要用**同一批**建造器造同一批 turn。抄两份的话，"默认 usage 是多少"会在两个文件
 * 里各自演化，侧链测试断言的数字就不再和主链测试同源——而那正是这个特性最容易
 * 出错的地方（侧链与主链必须来自同一种子的不同分支）。
 *
 * 这里只放"怎么造数据"，不放断言；每个测试文件自己决定要验证什么。
 */

import type Database from 'better-sqlite3'
import type { ParseError, Session, TokenUsage, ToolInvocation, Turn } from '@turnflare/core'
import { openDatabase } from '../db/index.js'
import { createRepository } from '../db/repository.js'
import type { FileStamp, SessionRepository } from '../db/repository.js'

/** 默认用量：100 输入 / 10 输出，opus 标准档，算得清也看得懂 */
export const BASE_USAGE: TokenUsage = {
  speed: 'standard',
  inputTokens: 100,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 10,
  thinkingTokens: 0,
  serverToolUse: 0,
}

export const WRITE_TOOL: ToolInvocation = {
  toolName: 'Write',
  toolUseId: 'tool-1',
  isError: false,
  resultBytes: 128,
}

export interface TurnOverrides {
  readonly uuid?: string
  readonly role?: 'user' | 'assistant'
  readonly model?: string | null
  readonly timestamp?: string
  readonly usage?: TokenUsage | null
  readonly tools?: readonly ToolInvocation[]
  readonly isSidechain?: boolean
  readonly lineNumber?: number
}

export function makeTurn(overrides: TurnOverrides = {}): Turn {
  return {
    uuid: overrides.uuid ?? 'turn-1',
    parentUuid: null,
    role: overrides.role ?? 'assistant',
    timestamp: overrides.timestamp ?? '2026-10-19T08:00:00.000Z',
    model: overrides.model === undefined ? 'claude-opus-5-5' : overrides.model,
    usage: overrides.usage === undefined ? BASE_USAGE : overrides.usage,
    tools: overrides.tools ?? [],
    textPreview: '预览文本',
    isSidechain: overrides.isSidechain ?? false,
    lineNumber: overrides.lineNumber ?? 1,
  }
}

export interface SessionOverrides {
  readonly sessionId?: string
  readonly projectSlug?: string
  readonly filePath?: string
  readonly startedAt?: string | null
  readonly endedAt?: string | null
  readonly turns?: readonly Turn[]
  readonly parseErrors?: readonly ParseError[]
}

/** 造一场会话；models 由 turns 推导，和 core 的解析结果保持一致 */
export function makeSession(overrides: SessionOverrides = {}): Session {
  const turns = overrides.turns ?? [makeTurn()]
  const models: string[] = []
  for (const turn of turns) {
    if (turn.model !== null && !models.includes(turn.model)) {
      models.push(turn.model)
    }
  }
  return {
    meta: {
      sessionId: overrides.sessionId ?? 'sess-1',
      filePath: overrides.filePath ?? '/tmp/sess-1.jsonl',
      projectSlug: overrides.projectSlug ?? '-Users-che1sy-Projects-foo',
      cwd: '/Users/che1sy/Projects/foo',
      gitBranch: 'main',
      cliVersion: '2.0.30',
      startedAt: overrides.startedAt ?? turns[0]?.timestamp ?? null,
      endedAt: overrides.endedAt ?? turns.at(-1)?.timestamp ?? null,
      models,
    },
    turns,
    records: [],
    parseErrors: overrides.parseErrors ?? [],
  }
}

export function makeStamp(filePath: string, mtimeMs = 1000, sizeBytes = 2048): FileStamp {
  return { filePath, mtimeMs, sizeBytes }
}

/** 本文件打开过的连接；测试文件在 afterAll 里统一关掉 */
const openedDatabases: Database.Database[] = []

export interface OpenedRepo {
  readonly repo: SessionRepository
  readonly db: Database.Database
}

/** 开一个内存库仓储；连 db 一起返回，便于用原始 SQL 当独立真源 */
export function openRepoWithDb(): OpenedRepo {
  const { db } = openDatabase(':memory:')
  openedDatabases.push(db)
  return { repo: createRepository(db), db }
}

export function openRepo(): SessionRepository {
  return openRepoWithDb().repo
}

/** 关掉本测试文件打开过的所有连接；每个测试文件的 afterAll 调一次 */
export function closeOpenedDatabases(): void {
  for (const db of openedDatabases) {
    db.close()
  }
}
