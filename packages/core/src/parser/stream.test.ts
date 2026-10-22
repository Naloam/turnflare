import { closeSync, mkdtempSync, readSync, rmSync, writeFileSync } from 'node:fs'
import type * as NodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { streamLines } from './stream'

/** 与源文件中的读取块大小保持一致，用于构造跨块边界的多字节字符 */
const CHUNK_BYTES = 1024 * 1024

// 只替换读取 / 关闭两个原语，其余文件操作走真实实现；
// 这样才能验证"读失败抛中文错误、关失败不掩盖数据"这两条兜底路径。
// importOriginal 的返回类型标成 unknown，用命名空间类型别名给它一个形状——
// 直接写 `typeof import('node:fs')` 会被 consistent-type-imports 拦下。
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return { ...actual, readSync: vi.fn(actual.readSync), closeSync: vi.fn(actual.closeSync) }
})

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'turnflare-stream-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function writeTempFile(name: string, content: string): string {
  const filePath = join(tempDir, name)
  writeFileSync(filePath, content, 'utf8')
  return filePath
}

/** 捕获回调抛出的错误；没抛或抛的不是 Error 都算测试失败 */
function captureError(run: () => void): Error {
  try {
    run()
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error
    }
    throw new Error('抛出的不是 Error 实例', { cause: error })
  }
  throw new Error('预期抛出错误，但实际没有抛出')
}

/** 取出 `Error.cause`，同样要求是 Error 实例 */
function causeOf(error: Error): Error {
  const cause: unknown = error.cause
  if (cause instanceof Error) {
    return cause
  }
  throw new Error('cause 不是 Error 实例')
}

describe('streamLines', () => {
  it('yields every line of a multi-line file in order', () => {
    // Arrange
    const filePath = writeTempFile('basic.jsonl', '{"a":1}\n{"a":2}\n{"a":3}\n')

    // Act
    const lines = [...streamLines(filePath)]

    // Assert
    expect(lines).toEqual(['{"a":1}', '{"a":2}', '{"a":3}'])
  })

  it('yields the last line when the file has no trailing newline', () => {
    // Arrange
    const filePath = writeTempFile('no-eol.jsonl', '{"a":1}\n{"a":2}')

    // Act
    const lines = [...streamLines(filePath)]

    // Assert
    expect(lines).toEqual(['{"a":1}', '{"a":2}'])
  })

  it('skips empty and whitespace-only lines', () => {
    // Arrange
    const filePath = writeTempFile('blank.jsonl', '{"a":1}\n\n   \n\t\n{"a":2}\n')

    // Act
    const lines = [...streamLines(filePath)]

    // Assert
    expect(lines).toEqual(['{"a":1}', '{"a":2}'])
  })

  it('yields nothing for an empty file', () => {
    // Arrange
    const filePath = writeTempFile('empty.jsonl', '')

    // Act
    const lines = [...streamLines(filePath)]

    // Assert
    expect(lines).toEqual([])
  })

  it('strips carriage returns from CRLF line endings', () => {
    // Arrange
    const filePath = writeTempFile('crlf.jsonl', '{"a":1}\r\n{"a":2}\r\n')

    // Act
    const lines = [...streamLines(filePath)]

    // Assert
    expect(lines).toEqual(['{"a":1}', '{"a":2}'])
  })

  it('yields a single line of several megabytes without truncation', () => {
    // Arrange：数 MB 单行对应 ARCHITECTURE.md §1.2 坑 1（system prompt + 全量规则）
    const bigText = 'x'.repeat(3 * 1024 * 1024)
    const filePath = writeTempFile('big-line.jsonl', `${bigText}\n${bigText}\n`)

    // Act
    const lines = [...streamLines(filePath)]

    // Assert
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(bigText)
    expect(lines[1]).toBe(bigText)
  })

  it('keeps multi-byte characters intact across chunk boundaries', () => {
    // Arrange：让一个 4 字节 emoji 横跨 1MB 读取边界，验证 StringDecoder 的缓冲
    const head = 'a'.repeat(CHUNK_BYTES - 2)
    const expected = `${head}😀${'b'.repeat(64)}`
    const filePath = writeTempFile('utf8.jsonl', `${expected}\nsecond\n`)

    // Act
    const lines = [...streamLines(filePath)]

    // Assert
    expect(lines[0]).toBe(expected)
    expect(lines[0]).not.toContain('�')
    expect(lines[1]).toBe('second')
  })

  it('throws a Chinese error when the file does not exist', () => {
    // Arrange
    const missingPath = join(tempDir, 'missing.jsonl')

    // Act & Assert：错误必须在调用时抛出，而不是等到第一次迭代
    expect(() => streamLines(missingPath)).toThrow(`无法读取会话文件：${missingPath}`)
  })

  it('throws a Chinese error when the path is a directory', () => {
    // Arrange：mkdtempSync 会在前缀后追加随机串，返回值才是真实目录
    const nested = mkdtempSync(join(tempDir, 'nested'))

    // Act：目录能 stat 成功但不是普通文件，必须走同一条中文错误出口
    const error = captureError(() => streamLines(nested))

    // Assert
    expect(error.message).toBe(`无法读取会话文件：${nested}`)
    expect(causeOf(error).message).toBe('目标不是普通文件')
  })

  it('closes the file handle when iteration is abandoned early', () => {
    // Arrange：提前 break 会触发生成器的 finally，句柄必须被释放，
    // 否则同一进程反复扫描大量会话会耗尽文件描述符。
    const filePath = writeTempFile('early.jsonl', 'a\nb\nc\n')

    // Act
    for (const line of streamLines(filePath)) {
      expect(line).toBe('a')
      break
    }

    // Assert：句柄已关闭，因此可以立即删除文件而不占用描述符
    expect(() => rmSync(filePath)).not.toThrow()
  })

  it('wraps read failures in a Chinese error', () => {
    // Arrange
    const filePath = writeTempFile('io-error.jsonl', 'a\nb\n')
    vi.mocked(readSync).mockImplementationOnce(() => {
      throw new Error('EIO: i/o error')
    })

    // Act & Assert
    expect(() => [...streamLines(filePath)]).toThrow(`无法读取会话文件：${filePath}`)
  })

  it('does not let a close failure mask already yielded lines', () => {
    // Arrange
    const filePath = writeTempFile('close-error.jsonl', 'a\n')
    vi.mocked(closeSync).mockImplementationOnce(() => {
      throw new Error('EBADF: bad file descriptor')
    })

    // Act
    const lines = [...streamLines(filePath)]

    // Assert
    expect(lines).toEqual(['a'])
  })
})
