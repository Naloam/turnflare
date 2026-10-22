import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '@turnflare/api'
import { createRepository } from '@turnflare/api'
import { loadConfig } from '@turnflare/api'
import {
  closeStorage,
  isInMemoryDatabase,
  openStorageFromEnv,
  resolveDatabasePath,
} from './storage.js'

const deps = { openDatabase, createRepository }

describe('storage：路径解析', () => {
  it('TURNFLARE_DB 优先于配置默认值', () => {
    expect(
      resolveDatabasePath({ TURNFLARE_DB: '/tmp/x.db' }, '/home/u/.turnflare/turnflare.db'),
    ).toBe('/tmp/x.db')
  })

  it('没有 TURNFLARE_DB 时用配置给出的路径', () => {
    expect(resolveDatabasePath({}, '/home/u/.turnflare/turnflare.db')).toBe(
      '/home/u/.turnflare/turnflare.db',
    )
  })

  it('TURNFLARE_DB 为空白时视为未设置', () => {
    expect(resolveDatabasePath({ TURNFLARE_DB: '   ' }, '/fallback.db')).toBe('/fallback.db')
  })

  it('识别两种内存库写法', () => {
    expect(isInMemoryDatabase(':memory:')).toBe(true)
    expect(isInMemoryDatabase('file::memory:?cache=shared')).toBe(true)
    expect(isInMemoryDatabase('/tmp/x.db')).toBe(false)
  })
})

describe('storage：打开连接', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'turnflare-cli-storage-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('内存库直接打开，不需要文件存在', () => {
    const result = openStorageFromEnv({ TURNFLARE_DB: ':memory:' }, { ...deps, loadConfig })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.repo.countSessions()).toBe(0)
      closeStorage(result.db)
    }
  })

  it('读类命令遇到不存在的库文件时报 missing', () => {
    const missing = join(dir, 'nope.db')
    const result = openStorageFromEnv(
      { TURNFLARE_DB: missing },
      { ...deps, loadConfig },
      {
        requireExisting: true,
      },
    )
    expect(result).toEqual({ kind: 'missing', dbPath: missing })
  })

  it('写类命令允许新建库文件', () => {
    const target = join(dir, 'fresh.db')
    const result = openStorageFromEnv({ TURNFLARE_DB: target }, { ...deps, loadConfig })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      closeStorage(result.db)
    }
  })

  it('库路径不可用时收敛成中文错误而不是抛异常', () => {
    const result = openStorageFromEnv(
      { TURNFLARE_DB: '/etc/hosts/x.db' },
      {
        ...deps,
        loadConfig,
      },
    )
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.message).toContain('无法打开数据库')
    }
  })

  it('配置非法时报 error', () => {
    const result = openStorageFromEnv(
      { TURNFLARE_DB: ':memory:', PORT: 'abc' },
      {
        ...deps,
        loadConfig,
      },
    )
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.message).toContain('配置无效')
    }
  })

  it('closeStorage 容忍 null 与关闭失败', () => {
    expect(() => {
      closeStorage(null)
    }).not.toThrow()
    const opened = openDatabase(':memory:')
    closeStorage(opened.db)
    // 关过一次再关：better-sqlite3 会抛，但 closeStorage 自己吞掉
    expect(() => {
      closeStorage(opened.db)
    }).not.toThrow()
  })
})
