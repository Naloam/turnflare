import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveProjectSlug, scanProjects } from './discover'

let tempDir: string
let originalHome: string | undefined

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'turnflare-discover-'))
  originalHome = process.env['HOME']
})

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env['HOME']
  } else {
    process.env['HOME'] = originalHome
  }
  rmSync(tempDir, { recursive: true, force: true })
})

function writeJsonl(relativePath: string, content = '{"type":"user"}\n'): string {
  const filePath = join(tempDir, relativePath)
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
  return filePath
}

describe('scanProjects', () => {
  it('resolves nested projects and falls back to the parent for flat or outside files', () => {
    expect(
      resolveProjectSlug(join(tempDir, 'project', 'session', 'subagents', 'a.jsonl'), tempDir),
    ).toBe('project')
    expect(resolveProjectSlug(join(tempDir, 'flat.jsonl'), tempDir)).toBe(basename(tempDir))
    expect(resolveProjectSlug(join(tempDir, '..', 'outside', 'a.jsonl'), tempDir)).toBe('outside')
  })
  it('keeps nested subagent files assigned to their root project', async () => {
    // Arrange
    const first = writeJsonl('proj-a/session-1.jsonl')
    const nested = writeJsonl('proj-b/subagents/session-2.jsonl')

    // Act
    const files = await scanProjects(tempDir)

    // Assert
    expect([...files]).toEqual([
      {
        filePath: first,
        projectSlug: 'proj-a',
        sizeBytes: statSync(first).size,
        mtimeMs: statSync(first).mtimeMs,
      },
      {
        filePath: nested,
        projectSlug: 'proj-b',
        sizeBytes: statSync(nested).size,
        mtimeMs: statSync(nested).mtimeMs,
      },
    ])
    expect(files.errors).toEqual([])
  })

  it('returns results sorted by filePath for deterministic scans', async () => {
    // Arrange
    writeJsonl('c/3.jsonl')
    writeJsonl('a/1.jsonl')
    writeJsonl('b/2.jsonl')

    // Act
    const files = await scanProjects(tempDir)

    // Assert
    expect(files.map((file) => file.projectSlug)).toEqual(['a', 'b', 'c'])
  })

  it('ignores files that are not jsonl', async () => {
    // Arrange
    const kept = writeJsonl('proj/keep.jsonl')
    writeJsonl('proj/notes.txt', 'ignore me')
    writeJsonl('proj/data.json', '{}')

    // Act
    const files = await scanProjects(tempDir)

    // Assert
    expect(files).toHaveLength(1)
    expect(files[0]?.filePath).toBe(kept)
  })

  it('reports sizeBytes and mtimeMs taken from stat', async () => {
    // Arrange
    const filePath = writeJsonl('proj/sized.jsonl', 'x'.repeat(2048))
    const fixedTime = new Date('2026-01-02T03:04:05.000Z')
    utimesSync(filePath, fixedTime, fixedTime)

    // Act
    const files = await scanProjects(tempDir)

    // Assert
    expect(files[0]?.sizeBytes).toBe(2048)
    expect(files[0]?.mtimeMs).toBe(fixedTime.getTime())
  })

  it('collects an error and returns nothing when the root does not exist', async () => {
    // Arrange
    const missingRoot = join(tempDir, 'nope')

    // Act
    const files = await scanProjects(missingRoot)

    // Assert
    expect([...files]).toEqual([])
    expect(files.errors).toHaveLength(1)
    expect(files.errors[0]?.filePath).toBe(missingRoot)
    expect(files.errors[0]?.message).toContain('无法读取目录')
  })

  it('skips broken symlinks and records them as errors', async () => {
    // Arrange
    const kept = writeJsonl('proj/keep.jsonl')
    const dangling = join(tempDir, 'proj', 'dangling.jsonl')
    symlinkSync(join(tempDir, 'gone.jsonl'), dangling)

    // Act
    const files = await scanProjects(tempDir)

    // Assert
    expect(files).toHaveLength(1)
    expect(files[0]?.filePath).toBe(kept)
    expect(files.errors).toHaveLength(1)
    expect(files.errors[0]?.filePath).toBe(dangling)
  })

  it('returns an empty list when the root contains no jsonl files', async () => {
    // Arrange
    writeJsonl('proj/readme.md', 'nothing here')

    // Act
    const files = await scanProjects(tempDir)

    // Assert
    expect([...files]).toEqual([])
    expect(files.errors).toEqual([])
  })

  it('defaults the root to ~/.claude/projects', async () => {
    // Arrange
    process.env['HOME'] = tempDir
    const expected = writeJsonl('.claude/projects/-Users-che1sy-Projects-foo/session.jsonl')

    // Act
    const files = await scanProjects()

    // Assert
    expect(files).toHaveLength(1)
    expect(files[0]?.filePath).toBe(expected)
    expect(files[0]?.projectSlug).toBe('-Users-che1sy-Projects-foo')
  })
})
