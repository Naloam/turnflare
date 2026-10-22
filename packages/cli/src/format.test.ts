import { describe, expect, it } from 'vitest'
import {
  collapseWhitespace,
  displayModels,
  displayRelativeTime,
  displayTimestamp,
  displayWidth,
  localTimezoneOffsetMinutes,
  padDisplayEnd,
  shortSessionId,
  truncate,
  sanitizeForTerminal,
} from './format.js'
import { renderMarkdownTable, renderRows, renderTable } from './render/table.js'

describe('format：展示助手', () => {
  it('短 ID 只保留前 8 位', () => {
    expect(shortSessionId('1a2b3c4d-5e6f-7890-abcd-ef1234567890')).toBe('1a2b3c4d')
  })

  it('短于 8 位的 ID 原样返回', () => {
    expect(shortSessionId('abc')).toBe('abc')
  })

  it('时间戳按给定偏移格式化', () => {
    expect(displayTimestamp('2026-10-19T08:25:26.923Z', 480)).toBe('2026-10-19 16:25')
    expect(displayTimestamp('2026-10-19T08:25:26.923Z', 0)).toBe('2026-10-19 08:25')
  })

  it('缺失时间戳给占位符', () => {
    expect(displayTimestamp(null, 0)).toBe('-')
    expect(displayTimestamp('', 0)).toBe('-')
  })

  it('相对时间用 core 的中文口径', () => {
    const now = new Date('2026-10-19T09:25:26.923Z')
    expect(displayRelativeTime('2026-10-19T08:25:26.923Z', now)).toBe('1 小时前')
    expect(displayRelativeTime(null, now)).toBe('-')
  })

  it('模型列表逗号拼接，空列表给占位符', () => {
    expect(displayModels(['a', 'b'])).toBe('a, b')
    expect(displayModels([])).toBe('-')
  })

  it('截断加省略号', () => {
    expect(truncate('一二三四五', 3)).toBe('一二三…')
    expect(truncate('一二三', 3)).toBe('一二三')
  })

  it('连续空白压成单空格', () => {
    expect(collapseWhitespace('  a\n\n b\t c ')).toBe('a b c')
  })

  it('全角字符按两列计算宽度', () => {
    expect(displayWidth('abc')).toBe(3)
    expect(displayWidth('项目')).toBe(4)
    expect(displayWidth('a项')).toBe(3)
  })

  it('按显示宽度补空格，中英混排也能对齐', () => {
    expect(padDisplayEnd('项目', 4)).toBe('项目')
    expect(padDisplayEnd('ab', 4)).toBe('ab  ')
    expect(padDisplayEnd('abc', 2)).toBe('abc')
  })

  it('本地时区偏移取"东为正"', () => {
    // UTC 环境下 getTimezoneOffset() 为 0，结果应为 0
    expect(localTimezoneOffsetMinutes(new Date())).toBe(-new Date().getTimezoneOffset())
  })
})

describe('render/table：表格渲染', () => {
  const spec = {
    head: ['名称', '数量'],
    rows: [
      ['Read', '2'],
      ['Grep', '1'],
    ],
  }

  it('渲染出带外框的终端表格', () => {
    const text = renderTable(spec)
    expect(text).toContain('│ Read │')
    expect(text).toContain('┌')
    expect(text).toContain('└')
  })

  it('数据行之间不画分隔线', () => {
    const text = renderTable(spec)
    expect(text).not.toContain('├')
  })

  it('空表格给一句人话而不是空框图', () => {
    expect(renderRows(['名称'], [], '暂无数据')).toBe('暂无数据')
  })

  it('有数据时渲染表格', () => {
    expect(renderRows(['名称'], [['Read']], '暂无数据')).toContain('Read')
  })

  it('渲染 GitHub 风格 Markdown 表', () => {
    const text = renderMarkdownTable(spec)
    expect(text.split('\n')).toEqual([
      '| 名称 | 数量 |',
      '| --- | --- |',
      '| Read | 2 |',
      '| Grep | 1 |',
    ])
  })
})

describe('sanitizeForTerminal', () => {
  it.each([
    { name: 'CSI 颜色序列', input: '\u001b[31m红色\u001b[0m', expected: '红色' },
    { name: 'OSC 窗口标题', input: '\u001b]0;恶意标题\u0007正文', expected: '正文' },
    {
      name: 'OSC 超链接',
      input: '\u001b]8;;http://evil\u001b\\点我\u001b]8;;\u001b\\',
      expected: '点我',
    },
    { name: '两字符 ESC 序列', input: '\u001b(B正常', expected: '正常' },
    { name: 'BEL 响铃', input: '叮\u0007咚', expected: '叮咚' },
    { name: '退格与删除', input: 'a\u0008b\u007fc', expected: 'abc' },
    { name: '普通文本原样通过', input: '普通 文本', expected: '普通 文本' },
  ])('$name 被剥掉', ({ input, expected }) => {
    expect(sanitizeForTerminal(input)).toBe(expected)
  })

  it('剥完之后不含任何 ESC 与控制字符', () => {
    const dirty = '\u001b[1m粗\u001b[0m\u001b]0;t\u0007\u0008\u007f'
    const clean = sanitizeForTerminal(dirty)
    for (const char of clean) {
      const code = char.codePointAt(0) ?? 0
      expect(code).toBeGreaterThan(0x1f)
      expect(code).not.toBe(0x7f)
    }
  })

  it('空串与非字符串安全降级', () => {
    expect(sanitizeForTerminal('')).toBe('')
  })
})
