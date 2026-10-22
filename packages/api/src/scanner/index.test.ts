import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { openDatabase } from '../db/index.js'
import { createRepository } from '../db/repository.js'
import { Scanner } from './index.js'
import type Database from 'better-sqlite3'

const ALPHA = '-Users-che1sy-Projects-alpha'
const BETA = '-Users-che1sy-Projects-beta'

/** 一条最小可识别的 user 记录：够 core 解析出 sessionId 与一条 turn */
function userLine(sessionId: string, text: string, uuidSuffix = 'u1'): string {
  return JSON.stringify({
    type: 'user',
    uuid: `${sessionId}-${uuidSuffix}`,
    parentUuid: null,
    timestamp: '2026-10-19T08:00:00.000Z',
    sessionId,
    cwd: '/Users/che1sy/Projects/alpha',
    gitBranch: 'main',
    version: '2.0.30',
    message: { role: 'user', content: [{ type: 'text', text }] },
  })
}

/** 一条带 token 用量的 assistant 记录 */
function assistantLine(sessionId: string, inputTokens: number, uuidSuffix = 'a1'): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: `${sessionId}-${uuidSuffix}`,
    parentUuid: `${sessionId}-u1`,
    timestamp: '2026-10-19T08:01:00.000Z',
    isSidechain: false,
    message: {
      role: 'assistant',
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: inputTokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 10,
      },
      content: [{ type: 'text', text: 'done' }],
    },
  })
}

function sessionContent(sessionId: string, inputTokens = 100): readonly string[] {
  return [userLine(sessionId, '帮我看看'), assistantLine(sessionId, inputTokens)]
}

let rootDir: string
let db: Database.Database

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'turnflare-scanner-'))
  const opened = openDatabase(':memory:')
  db = opened.db
})

afterEach(() => {
  db.close()
  rmSync(rootDir, { recursive: true, force: true })
})

/** 在 `<rootDir>/<projectSlug>/<fileName>` 写一个会话文件，返回完整路径 */
function writeSession(projectSlug: string, fileName: string, lines: readonly string[]): string {
  const directory = join(rootDir, projectSlug)
  mkdirSync(directory, { recursive: true })
  const filePath = join(directory, fileName)
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8')
  return filePath
}

function backdate(filePath: string, iso: string): void {
  const when = new Date(Date.parse(iso))
  utimesSync(filePath, when, when)
}

/** 建一个跑在临时目录上的 Scanner；scanConcurrency 可调，便于验证并发度约束 */
function makeScanner(scanConcurrency = 4): { scanner: Scanner; progress: string[] } {
  const progress: string[] = []
  const repo = createRepository(db)
  const scanner = new Scanner({
    repo,
    config: loadConfig({ TURNFLARE_SCAN_CONCURRENCY: String(scanConcurrency) }),
    onProgress: (done, total, filePath) => {
      progress.push(`${String(done)}/${String(total)} ${filePath}`)
    },
  })
  return { scanner, progress }
}

describe('Scanner.scan', () => {
  it('scans every discovered file into the database', async () => {
    // Arrange
    writeSession(ALPHA, 'a.jsonl', sessionContent('sess-a'))
    writeSession(BETA, 'b.jsonl', sessionContent('sess-b', 500))
    const { scanner } = makeScanner()

    // Act
    const outcome = await scanner.scan({ rootDir })

    // Assert
    expect(outcome.totalFiles).toBe(2)
    expect(outcome.scannedFiles).toBe(2)
    expect(outcome.skippedFiles).toBe(0)
    expect(outcome.failedFiles).toBe(0)
    expect(outcome.failures).toEqual([])
    expect(createRepository(db).countSessions()).toBe(2)
    expect(createRepository(db).getOverview().usage.inputTokens).toBe(600)
  })

  it('skips files whose stamp has not changed since the last scan', async () => {
    // Arrange
    writeSession(ALPHA, 'a.jsonl', sessionContent('sess-a'))
    const { scanner } = makeScanner()
    await scanner.scan({ rootDir })

    // Act
    const second = await scanner.scan({ rootDir })

    // Assert
    expect(second.totalFiles).toBe(1)
    expect(second.scannedFiles).toBe(0)
    expect(second.skippedFiles).toBe(1)
  })

  it('rescans everything when force is set', async () => {
    // Arrange
    writeSession(ALPHA, 'a.jsonl', sessionContent('sess-a'))
    const { scanner } = makeScanner()
    await scanner.scan({ rootDir })

    // Act
    const forced = await scanner.scan({ rootDir, force: true })

    // Assert
    expect(forced.scannedFiles).toBe(1)
    expect(forced.skippedFiles).toBe(0)
  })

  it('picks up turns appended to a file since the last scan', async () => {
    // Arrange：jsonl 是只追加的日志，会话变长的表现就是多出几行
    const filePath = writeSession(ALPHA, 'a.jsonl', sessionContent('sess-a'))
    const { scanner } = makeScanner()
    await scanner.scan({ rootDir })
    expect(createRepository(db).getOverview().turnCount).toBe(2)

    // Act：追加一轮新的对话
    writeSession(ALPHA, 'a.jsonl', [
      ...sessionContent('sess-a'),
      userLine('sess-a', '继续', 'u2'),
      assistantLine('sess-a', 9999, 'a2'),
    ])
    const second = await scanner.scan({ rootDir })

    // Assert：新 turn 进来了，旧 turn 还在
    expect(second.scannedFiles).toBe(1)
    expect(createRepository(db).getOverview().turnCount).toBe(4)
    expect(createRepository(db).getOverview().usage.inputTokens).toBe(100 + 9999)
    expect(filePath).toContain(ALPHA)
  })

  it('keeps the stored value when a turn uuid is rewritten with different usage', async () => {
    // Arrange：合并语义按 uuid 去重，同一条消息重复出现时保留首次入库的值。
    // jsonl 里同 uuid 的内容理应一致；真出现分歧时，"先看到的赢"比
    // "后扫的文件覆盖一切"更可预期——后者正是 subagent 文件冲掉主会话的原因。
    writeSession(ALPHA, 'a.jsonl', sessionContent('sess-a'))
    const { scanner } = makeScanner()
    await scanner.scan({ rootDir })

    // Act：用同一批 uuid 但不同的用量改写文件
    writeSession(ALPHA, 'a.jsonl', sessionContent('sess-a', 9999))
    const second = await scanner.scan({ rootDir })

    // Assert
    expect(second.scannedFiles).toBe(1)
    expect(createRepository(db).getOverview().usage.inputTokens).toBe(100)
  })

  it('rescans a file that only changed size, not mtime', async () => {
    // Arrange：等长改写会被 mtime 漏掉，所以指纹里必须带 sizeBytes
    const filePath = writeSession(ALPHA, 'a.jsonl', sessionContent('sess-a'))
    const { scanner } = makeScanner()
    await scanner.scan({ rootDir })
    const frozen = new Date('2026-10-19T08:00:00.000Z')

    // Act：追加内容（size 必然变）后把 mtime 拨回原值
    writeSession(ALPHA, 'a.jsonl', [
      ...sessionContent('sess-a'),
      userLine('sess-a', '继续', 'u2'),
      assistantLine('sess-a', 4321, 'a2'),
    ])
    utimesSync(filePath, frozen, frozen)
    const second = await scanner.scan({ rootDir })

    // Assert：size 变化足以触发重扫
    expect(second.scannedFiles).toBe(1)
    expect(createRepository(db).getOverview().turnCount).toBe(4)
  })

  it('keeps scanning after one file fails to parse', async () => {
    // Arrange：一个读不了的文件 + 两个正常文件
    writeSession(ALPHA, 'good-1.jsonl', sessionContent('sess-1'))
    const locked = writeSession(ALPHA, 'locked.jsonl', ['{ broken'])
    chmodSync(locked, 0o000)
    writeSession(BETA, 'good-2.jsonl', sessionContent('sess-2'))
    const { scanner } = makeScanner()

    // Act
    const outcome = await scanner.scan({ rootDir })

    // Assert
    expect(outcome.totalFiles).toBe(3)
    expect(outcome.scannedFiles).toBe(2)
    expect(outcome.failedFiles).toBe(1)
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0]?.filePath).toBe(locked)
    expect(createRepository(db).countSessions()).toBe(2)

    chmodSync(locked, 0o644)
  })

  it('records a discovery failure without dropping the files it did find', async () => {
    // Arrange
    writeSession(ALPHA, 'a.jsonl', sessionContent('sess-a'))
    const { scanner } = makeScanner()

    // Act：根目录本身不存在时，scanProjects 只报错不抛
    const outcome = await scanner.scan({ rootDir: join(rootDir, 'missing') })

    // Assert
    expect(outcome.totalFiles).toBe(0)
    expect(outcome.failedFiles).toBe(1)
    expect(outcome.failures[0]?.filePath).toBe(join(rootDir, 'missing'))
  })

  it('only scans files under the requested project slugs', async () => {
    // Arrange
    writeSession(ALPHA, 'a.jsonl', sessionContent('sess-a'))
    writeSession(BETA, 'b.jsonl', sessionContent('sess-b'))
    const { scanner } = makeScanner()

    // Act
    const outcome = await scanner.scan({ rootDir, projectSlugs: [BETA] })

    // Assert
    expect(outcome.totalFiles).toBe(1)
    expect(outcome.scannedFiles).toBe(1)
    expect(createRepository(db).getSession('sess-b')).not.toBeNull()
    expect(createRepository(db).getSession('sess-a')).toBeNull()
  })

  it('only scans files that could have been written after the since bound', async () => {
    // Arrange
    const stale = writeSession(ALPHA, 'old.jsonl', sessionContent('sess-old'))
    backdate(stale, '2026-10-01T00:00:00.000Z')
    writeSession(ALPHA, 'new.jsonl', sessionContent('sess-new'))
    const { scanner } = makeScanner()

    // Act
    const outcome = await scanner.scan({ rootDir, since: '2026-10-10T00:00:00.000Z' })

    // Assert
    expect(outcome.totalFiles).toBe(1)
    expect(outcome.scannedFiles).toBe(1)
    expect(createRepository(db).countSessions()).toBe(1)
  })

  it('rejects an unparseable since bound before doing any work', async () => {
    // Arrange
    writeSession(ALPHA, 'a.jsonl', sessionContent('sess-a'))
    const { scanner } = makeScanner()

    // Act & Assert
    await expect(scanner.scan({ rootDir, since: '上周' })).rejects.toThrow(/since/)
    expect(createRepository(db).countSessions()).toBe(0)
  })

  it('counts non-session jsonl files as skipped-empty instead of persisting them', async () => {
    // Arrange：插件遥测文件没有 type/sessionId/message，core 会降级成空会话
    writeSession(ALPHA, 'real.jsonl', sessionContent('sess-a'))
    writeSession(ALPHA, 'skill-injections.jsonl', [
      JSON.stringify({ timestamp: '2026-10-19T08:00:00.000Z', event: 'skill-injection' }),
    ])
    const { scanner } = makeScanner()

    // Act
    const outcome = await scanner.scan({ rootDir })

    // Assert
    expect(outcome.totalFiles).toBe(2)
    expect(outcome.scannedFiles).toBe(1)
    expect(outcome.skippedEmpty).toBe(1)
    expect(outcome.failedFiles).toBe(0)
    expect(createRepository(db).countSessions()).toBe(1)
  })

  it('partitions every candidate file into exactly one bucket', async () => {
    // Arrange
    writeSession(ALPHA, 'good.jsonl', sessionContent('sess-good'))
    writeSession(ALPHA, 'empty.jsonl', [])
    const locked = writeSession(BETA, 'locked.jsonl', ['{ broken'])
    chmodSync(locked, 0o000)
    const { scanner } = makeScanner()
    await scanner.scan({ rootDir })
    chmodSync(locked, 0o644)

    // Act
    const second = await scanner.scan({ rootDir })

    // Assert
    const accounted =
      second.scannedFiles + second.skippedFiles + second.skippedEmpty + second.failedFiles
    expect(accounted).toBe(second.totalFiles)
  })

  it('reports progress once per file', async () => {
    // Arrange
    writeSession(ALPHA, 'a.jsonl', sessionContent('sess-a'))
    writeSession(BETA, 'b.jsonl', sessionContent('sess-b'))
    const { scanner, progress } = makeScanner()

    // Act
    await scanner.scan({ rootDir })

    // Assert
    expect(progress).toHaveLength(2)
    expect(progress.every((entry) => entry.startsWith('1/2') || entry.startsWith('2/2'))).toBe(true)
  })

  it('still scans everything when concurrency is one', async () => {
    // Arrange
    writeSession(ALPHA, 'a.jsonl', sessionContent('sess-a'))
    writeSession(ALPHA, 'b.jsonl', sessionContent('sess-b'))
    writeSession(BETA, 'c.jsonl', sessionContent('sess-c'))
    const { scanner } = makeScanner(1)

    // Act
    const outcome = await scanner.scan({ rootDir })

    // Assert
    expect(outcome.scannedFiles).toBe(3)
    expect(createRepository(db).countSessions()).toBe(3)
  })

  it('returns an empty outcome for an empty root', async () => {
    // Arrange
    const { scanner } = makeScanner()

    // Act
    const outcome = await scanner.scan({ rootDir })

    // Assert
    expect(outcome).toEqual({
      totalFiles: 0,
      scannedFiles: 0,
      skippedFiles: 0,
      skippedEmpty: 0,
      failedFiles: 0,
      failures: [],
    })
  })
})

describe('Scanner.scanOneFile', () => {
  it('reports a change the first time and no change the second', async () => {
    // Arrange
    const filePath = writeSession(ALPHA, 'a.jsonl', sessionContent('sess-a'))
    const { scanner } = makeScanner()

    // Act & Assert
    expect(await scanner.scanOneFile(filePath)).toBe(true)
    expect(await scanner.scanOneFile(filePath)).toBe(false)
  })

  it('throws a readable error for a file that cannot be read', async () => {
    // Arrange
    const { scanner } = makeScanner()

    // Act & Assert
    await expect(scanner.scanOneFile(join(rootDir, 'missing.jsonl'))).rejects.toThrow(
      /读取文件信息失败/,
    )
  })
})
