import { describe, expect, it } from 'vitest'
import { COMMAND_SPECS } from './command-specs.js'
import { COMMAND_NAMES } from './options.js'
import {
  findSpec,
  renderCommandHelp,
  renderGlobalHelp,
  renderUsageError,
  renderVersion,
} from './usage.js'

const VERSION = '9.9.9'

describe('usage：帮助文本', () => {
  it('全局帮助列出全部命令', () => {
    const text = renderGlobalHelp(VERSION)
    for (const name of COMMAND_NAMES) {
      expect(text).toContain(name)
    }
    expect(text).toContain('--json')
    expect(text).toContain(VERSION)
    expect(text).toContain('TURNFLARE_DB')
  })

  it('单命令帮助包含用法与该命令的每个选项', () => {
    const text = renderCommandHelp(findSpec('scan'), VERSION)
    expect(text).toContain('turnflare scan')
    expect(text).toContain('--root DIR')
    expect(text).toContain('--project SLUG')
    expect(text).toContain('--force')
    expect(text).toContain(VERSION)
  })

  it('session 的帮助包含位置参数说明', () => {
    const text = renderCommandHelp(findSpec('session'), VERSION)
    expect(text).toContain('<id>')
    expect(text).toContain('前缀匹配')
  })

  it('版本行是"名字 + 版本"', () => {
    expect(renderVersion(VERSION)).toBe(`turnflare ${VERSION}`)
  })

  it('用法错误给出用法行与求助入口', () => {
    const text = renderUsageError('stats', '--days 必须是正整数：x')
    expect(text).toContain('错误：--days 必须是正整数：x')
    expect(text).toContain('turnflare stats [--days N]')
    expect(text).toContain('turnflare stats --help')
  })

  it('没有命令的用法错误指向全局用法', () => {
    const text = renderUsageError(undefined, '未知命令：x')
    expect(text).toContain('turnflare <命令> [选项]')
    expect(text).toContain('turnflare --help')
  })

  it('命令声明表与名称枚举保持同步', () => {
    expect(COMMAND_SPECS.map((spec) => spec.name)).toEqual([...COMMAND_NAMES])
  })

  it('每个命令都有用法行与非空摘要', () => {
    for (const spec of COMMAND_SPECS) {
      expect(spec.usage.startsWith('turnflare ')).toBe(true)
      expect(spec.summary.length).toBeGreaterThan(0)
    }
  })
})
