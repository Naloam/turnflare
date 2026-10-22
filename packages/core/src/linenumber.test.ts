import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { parseSessionFile } from './parser/session.js'
import { streamNumberedLines } from './parser/stream.js'

/**
 * lineNumber 必须等于记录在文件里的真实行号。
 *
 * 曾经的缺陷：streamSessionRecords 自己数"产出了多少行"，而 streamLines 会
 * 跳过空行。文件里一旦出现空行（写入中断、手工编辑），后续所有记录的行号
 * 就整体前移，落库成 turns.line_number 之后排序和定位全错。
 */

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'turnflare-linenumber-'))
  mkdirSync(root, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(name: string, content: string): string {
  const filePath = join(root, name)
  writeFileSync(filePath, content, 'utf8')
  return filePath
}

describe('streamNumberedLines', () => {
  test('空行也占行号', () => {
    const filePath = write('blank.jsonl', '第一行\n\n第三行\n')
    expect([...streamNumberedLines(filePath)]).toEqual([
      { line: '第一行', lineNumber: 1 },
      { line: '第三行', lineNumber: 3 },
    ])
  })

  test('连续多个空行不会让行号塌在一起', () => {
    const filePath = write('blanks.jsonl', '\n\n\n内容\n\n')
    expect([...streamNumberedLines(filePath)]).toEqual([{ line: '内容', lineNumber: 4 }])
  })

  test('首行空行时后续行号仍然准确', () => {
    const filePath = write('leading.jsonl', '\n\n\n真内容\n')
    expect([...streamNumberedLines(filePath)]).toEqual([{ line: '真内容', lineNumber: 4 }])
  })

  test('末行无换行符时行号照算', () => {
    const filePath = write('no-eol.jsonl', 'a\nb')
    expect([...streamNumberedLines(filePath)]).toEqual([
      { line: 'a', lineNumber: 1 },
      { line: 'b', lineNumber: 2 },
    ])
  })
})

describe('parseSessionFile 的 lineNumber', () => {
  test('空行之后的记录行号与文件实际位置一致', () => {
    const userLine = JSON.stringify({
      type: 'user',
      uuid: 'u1',
      sessionId: 's1',
      timestamp: '2026-10-19T08:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'a' }] },
    })
    const assistantLine = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      sessionId: 's1',
      timestamp: '2026-10-19T08:01:00.000Z',
      isSidechain: false,
      message: {
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: 'b' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens_details: { thinking_tokens: 0 },
          server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
        },
      },
    })
    const filePath = write('session.jsonl', ['', userLine, '', assistantLine].join('\n') + '\n')

    const session = parseSessionFile(filePath)
    const byUuid = new Map(session.turns.map((turn) => [turn.uuid, turn.lineNumber]))

    // 文件里 u1 在第 2 行、a1 在第 4 行——空行各占一行
    expect(byUuid.get('u1')).toBe(2)
    expect(byUuid.get('a1')).toBe(4)
  })

  test('解析错误的 lineNumber 同样指向真实行', () => {
    const good = JSON.stringify({ type: 'user', uuid: 'u', sessionId: 's' })
    const filePath = write('broken.jsonl', `\n{ 坏行\n${good}\n`)
    const session = parseSessionFile(filePath)

    expect(session.parseErrors).toHaveLength(1)
    expect(session.parseErrors[0]?.lineNumber).toBe(2)
  })

  test('records 的 lineNumber 也保持一致', () => {
    const one = JSON.stringify({ type: 'user', uuid: 'u1', sessionId: 's1' })
    const two = JSON.stringify({ type: 'user', uuid: 'u2', sessionId: 's1' })
    // 第 1 行空、第 2 行 one、第 3 行空、第 4 行 two
    const filePath = write('records.jsonl', `\n${one}\n\n${two}\n`)
    const session = parseSessionFile(filePath)

    expect(session.records.map((record) => record.lineNumber)).toEqual([2, 4])
  })
})
