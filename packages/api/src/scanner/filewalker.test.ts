import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseSince, walkSessionFiles } from './filewalker.js'

let rootDir: string

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'turnflare-walker-'))
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

/** 在 `<rootDir>/<projectSlug>/` 下写一个会话文件，返回完整路径 */
function writeSessionFile(projectSlug: string, fileName: string, content = '{}\n'): string {
  const directory = join(rootDir, projectSlug)
  mkdirSync(directory, { recursive: true })
  const filePath = join(directory, fileName)
  writeFileSync(filePath, content, 'utf8')
  return filePath
}

/** 把文件 mtime 设成过去某个时刻，用来验证 since 前置过滤 */
function backdate(filePath: string, iso: string): void {
  const ms = Date.parse(iso)
  const when = new Date(ms)
  utimesSync(filePath, when, when)
}

/** 遍历到底，收成数组 */
async function collect(options: {
  rootDir: string
  projectSlugs?: readonly string[]
  sinceMs?: number
}): Promise<{ kind: string; filePath?: string; projectSlug?: string; message?: string }[]> {
  const items: { kind: string; filePath?: string; projectSlug?: string; message?: string }[] = []
  for await (const item of walkSessionFiles(options)) {
    items.push(
      item.kind === 'file'
        ? { kind: item.kind, filePath: item.file.filePath, projectSlug: item.file.projectSlug }
        : { kind: item.kind, filePath: item.filePath, message: item.message },
    )
  }
  return items
}

describe('parseSince', () => {
  it('returns null when no bound is given', () => {
    // Arrange & Act & Assert
    expect(parseSince(undefined)).toBeNull()
    expect(parseSince('')).toBeNull()
    expect(parseSince('   ')).toBeNull()
  })

  it('parses a full ISO timestamp', () => {
    // Arrange & Act & Assert
    expect(parseSince('2026-10-19T08:00:00.000Z')).toBe(Date.parse('2026-10-19T08:00:00.000Z'))
  })

  it('parses a bare date as the start of that UTC day', () => {
    // Arrange & Act & Assert
    expect(parseSince('2026-10-19')).toBe(Date.parse('2026-10-19T00:00:00.000Z'))
  })

  it('fails fast on an unparseable bound instead of silently scanning everything', () => {
    // Arrange & Act & Assert
    expect(() => parseSince('昨天')).toThrow(/since/)
  })
})

describe('walkSessionFiles', async () => {
  it('yields every jsonl file with its project slug', async () => {
    // Arrange
    const first = writeSessionFile('-Users-x-Alpha', 'a.jsonl')
    const second = writeSessionFile('-Users-x-Beta', 'b.jsonl')
    writeFileSync(join(rootDir, 'notes.txt'), 'ignore me', 'utf8')

    // Act
    const items = await collect({ rootDir })

    // Assert
    expect(items).toHaveLength(2)
    expect(items.map((item) => item.filePath)).toEqual([first, second])
    expect(items.map((item) => item.projectSlug)).toEqual(['-Users-x-Alpha', '-Users-x-Beta'])
  })

  it('keeps only the requested project slugs', async () => {
    // Arrange
    writeSessionFile('-Users-x-Alpha', 'a.jsonl')
    const wanted = writeSessionFile('-Users-x-Beta', 'b.jsonl')

    // Act
    const items = await collect({ rootDir, projectSlugs: ['-Users-x-Beta'] })

    // Assert
    expect(items.map((item) => item.filePath)).toEqual([wanted])
  })

  it('yields nothing when the requested project does not exist', async () => {
    // Arrange
    writeSessionFile('-Users-x-Alpha', 'a.jsonl')

    // Act & Assert
    expect(await collect({ rootDir, projectSlugs: ['-Users-x-Nope'] })).toEqual([])
  })

  it('drops files whose mtime predates the since bound', async () => {
    // Arrange
    const old = writeSessionFile('-Users-x-Alpha', 'old.jsonl')
    backdate(old, '2026-10-01T00:00:00.000Z')
    const recent = writeSessionFile('-Users-x-Alpha', 'new.jsonl')

    // Act
    const items = await collect({ rootDir, sinceMs: Date.parse('2026-10-10T00:00:00.000Z') })

    // Assert
    expect(items.map((item) => item.filePath)).toEqual([recent])
  })

  it('keeps a file whose mtime sits exactly on the since bound', async () => {
    // Arrange
    const boundary = '2026-10-10T00:00:00.000Z'
    const file = writeSessionFile('-Users-x-Alpha', 'edge.jsonl')
    backdate(file, boundary)

    // Act
    const items = await collect({ rootDir, sinceMs: Date.parse(boundary) })

    // Assert
    expect(items.map((item) => item.filePath)).toEqual([file])
  })

  it('reports an unreadable path as an error item instead of throwing', async () => {
    // Arrange：断链的软链会被 scanProjects 记成一条非致命错误
    writeSessionFile('-Users-x-Alpha', 'a.jsonl')
    symlinkSync(join(rootDir, 'gone.jsonl'), join(rootDir, '-Users-x-Alpha', 'broken.jsonl'))

    // Act
    const items = await collect({ rootDir })

    // Assert
    const error = items.find((item) => item.kind === 'error')
    expect(error?.filePath).toBe(join(rootDir, '-Users-x-Alpha', 'broken.jsonl'))
    expect(error?.message).toContain('无法读取文件信息')
    expect(items.filter((item) => item.kind === 'file')).toHaveLength(1)
  })

  it('yields nothing for an empty root', async () => {
    // Arrange & Act & Assert
    expect(await collect({ rootDir })).toEqual([])
  })
})
