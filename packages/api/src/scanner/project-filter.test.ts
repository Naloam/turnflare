/** Project-scoped scans must include nested subagent files. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { openDatabase } from '../db/index.js'
import { createRepository } from '../db/repository.js'
import { Scanner } from './index.js'
import type Database from 'better-sqlite3'

const SLUG = '-Users-che1sy-Projects-repro'
const SESSION_ID = '11111111-2222-3333-4444-555555555555'

interface AssistantOptions {
  readonly uuid: string
  readonly parentUuid: string | null
  readonly isSidechain: boolean
  readonly inputTokens: number
  readonly outputTokens: number
}

function userLine(uuid: string, parentUuid: string | null, isSidechain: boolean): string {
  return JSON.stringify({
    type: 'user',
    uuid,
    parentUuid,
    timestamp: '2026-10-19T08:00:00.000Z',
    sessionId: SESSION_ID,
    cwd: '/Users/che1sy/Projects/repro',
    gitBranch: 'main',
    version: '2.0.30',
    isSidechain,
    message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
  })
}

function assistantLine(options: AssistantOptions): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: options.uuid,
    parentUuid: options.parentUuid,
    timestamp: '2026-10-19T08:01:00.000Z',
    sessionId: SESSION_ID,
    cwd: '/Users/che1sy/Projects/repro',
    gitBranch: 'main',
    version: '2.0.30',
    isSidechain: options.isSidechain,
    message: {
      role: 'assistant',
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: options.inputTokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: options.outputTokens,
      },
      content: [{ type: 'text', text: 'done' }],
    },
  })
}

/** 建一个只装这两个文件的临时根目录 */
function seedRoot(): string {
  const rootDir = mkdtempSync(join(tmpdir(), 'repro-projfilter-'))
  const projectDir = join(rootDir, SLUG)
  const subagentDir = join(projectDir, 'sess', 'subagents')
  mkdirSync(subagentDir, { recursive: true })

  writeFileSync(
    join(projectDir, 'sess.jsonl'),
    `${userLine('u-main', null, false)}\n${assistantLine({
      uuid: 'a-main',
      parentUuid: 'u-main',
      isSidechain: false,
      inputTokens: 10,
      outputTokens: 5,
    })}\n`,
    'utf8',
  )

  writeFileSync(
    join(subagentDir, 'agent-1.jsonl'),
    `${userLine('u-side', null, true)}\n${assistantLine({
      uuid: 'a-side',
      parentUuid: 'u-side',
      isSidechain: true,
      inputTokens: 1000,
      outputTokens: 500,
    })}\n`,
    'utf8',
  )

  return rootDir
}

interface RunResult {
  readonly totalFiles: number
  readonly scannedFiles: number
  readonly skippedEmpty: number
  readonly failedFiles: number
  readonly sidechainTurnCount: number
  readonly sidechainRequestCount: number
  readonly sidechainInputTokens: number
  readonly sidechainTotalCost: number
  readonly mainTurnCount: number
  readonly mainInputTokens: number
}

async function runScan(
  rootDir: string,
  projectSlugs: readonly string[] | undefined,
): Promise<RunResult> {
  const opened = openDatabase(':memory:')
  const db: Database.Database = opened.db
  const repo = createRepository(db)
  const scanner = new Scanner({ repo, config: loadConfig({ TURNFLARE_SCAN_CONCURRENCY: '4' }) })
  try {
    const outcome = await scanner.scan({ rootDir, ...(projectSlugs ? { projectSlugs } : {}) })
    const overview = repo.getOverview()
    return {
      totalFiles: outcome.totalFiles,
      scannedFiles: outcome.scannedFiles,
      skippedEmpty: outcome.skippedEmpty,
      failedFiles: outcome.failedFiles,
      sidechainTurnCount: overview.sidechain.turnCount,
      sidechainRequestCount: overview.sidechain.requestCount,
      sidechainInputTokens: overview.sidechain.usage.inputTokens,
      sidechainTotalCost: overview.sidechain.cost.totalCost,
      mainTurnCount: overview.turnCount,
      mainInputTokens: overview.usage.inputTokens,
    }
  } finally {
    db.close()
  }
}

describe('project-scoped subagent scanning', () => {
  it('keeps the same subagent usage as a full scan', async () => {
    const rootDir = seedRoot()
    try {
      const filtered = await runScan(rootDir, [SLUG])
      const unfiltered = await runScan(rootDir, undefined)

      expect(filtered.totalFiles).toBe(2)
      expect(filtered.sidechainTurnCount).toBe(2)
      expect(filtered).toEqual(unfiltered)
      // 而不带过滤时 totalFiles=2，侧链汇总有值
      expect(unfiltered.totalFiles).toBe(2)
      // 2 轮 = 侧链 user 消息 + 侧链 assistant（与 repository-sidechain.test.ts 同口径）
      expect(unfiltered.sidechainTurnCount).toBe(2)
      expect(unfiltered.sidechainRequestCount).toBe(1)
      expect(unfiltered.sidechainInputTokens).toBe(1000)
      expect(unfiltered.sidechainTotalCost).toBeCloseTo(0.014, 12)
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  }, 120000)
})
