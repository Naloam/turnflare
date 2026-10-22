/**
 * @turnflare/core —— 流式行读取
 *
 * 会话 jsonl 单行可达数 MB（ARCHITECTURE.md §1.2），因此这里按固定块读入、
 * 跨块拼行，任何时刻只保留"当前行残片"，绝不一次性载入整个文件。
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

/** 单次读入的字节数：1MB 在系统调用次数与常驻内存之间取平衡 */
/** 一行文本连同它在文件里的真实行号（从 1 开始） */
export interface NumberedLine {
  readonly line: string
  readonly lineNumber: number
}

const CHUNK_BYTES = 1024 * 1024

/** 无法读取文件时对外的统一错误前缀（中文可读） */
const UNREADABLE_FILE_PREFIX = '无法读取会话文件'

/**
 * 逐行产出文件内容。
 *
 * - 单行数 MB 也可正常产出（跨块拼接，不做长度上限）；
 * - 末行没有换行符时同样产出；
 * - 空行与纯空白行不产出（它们不是合法 JSON，产出只会制造无意义的解析错误）；
 * - 跨块的多字节 UTF-8 字符由 `StringDecoder` 缓冲，不会被截成替换字符；
 * - 文件不存在 / 不是普通文件 / 读取失败时抛中文错误。
 *
 * 之所以把"打开文件"放在普通函数体而不是生成器体：生成器是惰性的，
 * 否则调用方要等到第一次迭代才看到错误，`for...of` 之外的用法很容易漏掉。
 *
 * 代价是句柄在 `streamLines()` 调用时就已打开：调用方必须迭代这个生成器
 * （正常跑完、`break`、`throw` 都会触发 `finally` 关句柄），
 * 拿到生成器却完全不迭代会泄漏一个文件描述符。
 */
/**
 * 逐行产出非空行的文本。
 *
 * 刻意保持普通函数而不是生成器函数：`openForRead` 要在调用瞬间就执行，
 * 文件不存在时立刻抛错。改成生成器会把打开动作推迟到第一次迭代，
 * 调用方拿到生成器却不知道它已经坏了。
 */
export function streamLines(filePath: string): Generator<string, void, void> {
  const handle = openForRead(filePath)
  return projectLines(readLines(filePath, handle))
}

/** 只取文本、丢掉行号 */
function* projectLines(
  entries: Generator<NumberedLine, void, void>,
): Generator<string, void, void> {
  for (const entry of entries) {
    yield entry.line
  }
}

/**
 * 逐行读出文件，每行带它在文件里的**真实行号**（从 1 开始）。
 *
 * 为什么需要真实行号而不是"产出行序号"：文件里会出现空行（写入中断、
 * 手工编辑留下），只数产出的行会让后续所有记录的行号整体前移。行号被
 * 落库成 `turns.line_number` 之后还要用来排序和定位，错位就等于给错线索。
 */
export function streamNumberedLines(filePath: string): Generator<NumberedLine, void, void> {
  // 同样是普通函数：打开动作在调用瞬间发生，坏路径立刻抛错
  const handle = openForRead(filePath)
  return readLines(filePath, handle)
}

function* readLines(filePath: string, handle: number): Generator<NumberedLine, void, void> {
  try {
    const decoder = new StringDecoder('utf8')
    const chunk = Buffer.allocUnsafe(CHUNK_BYTES)
    let carry = ''
    let lineNumber = 0
    for (;;) {
      const bytesRead = readChunk(handle, chunk, filePath)
      if (bytesRead === 0) {
        break
      }
      const decoded = carry + decoder.write(chunk.subarray(0, bytesRead))
      const segments = decoded.split('\n')
      // 最后一段可能是不完整行，留给下一个读块拼接
      carry = segments.pop() ?? ''
      for (const segment of segments) {
        lineNumber += 1
        const line = stripCarriageReturn(segment)
        if (line.trim().length > 0) {
          yield { line, lineNumber }
        }
      }
    }
    lineNumber += 1
    const tail = stripCarriageReturn(carry + decoder.end())
    if (tail.trim().length > 0) {
      yield { line: tail, lineNumber }
    }
  } finally {
    closeHandle(handle)
  }
}

function openForRead(filePath: string): number {
  try {
    const stats = statSync(filePath)
    if (!stats.isFile()) {
      throw new Error('目标不是普通文件')
    }
    return openSync(filePath, 'r')
  } catch (error: unknown) {
    throw new Error(`${UNREADABLE_FILE_PREFIX}：${filePath}`, { cause: error })
  }
}

function readChunk(handle: number, chunk: Buffer, filePath: string): number {
  try {
    return readSync(handle, chunk, 0, chunk.length, null)
  } catch (error: unknown) {
    throw new Error(`${UNREADABLE_FILE_PREFIX}：${filePath}`, { cause: error })
  }
}

function closeHandle(handle: number): void {
  try {
    closeSync(handle)
  } catch {
    // 关闭失败没有可恢复动作：真正的数据已读完或已抛出，这里不能掩盖原始错误
  }
}

/** Windows 风格 CRLF 行尾的 `\r` 由这里剥掉，避免进入 JSON.parse */
function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}
