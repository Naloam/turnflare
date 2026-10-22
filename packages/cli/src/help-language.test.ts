import { describe, expect, it } from 'vitest'
import { renderGlobalHelp, renderCommandHelp, findSpec } from './usage.js'
import { localizeHelp } from './help-language.js'

describe('English command help', () => {
  it('covers global help and the complete option inventory', () => {
    const global = localizeHelp(renderGlobalHelp('0.1.0'), 'en')
    expect(global).toContain('Usage:')
    expect(global).not.toMatch(/[\u4e00-\u9fff]/)
    for (const command of [
      'scan',
      'stats',
      'sessions',
      'session',
      'report',
      'models',
      'serve',
    ] as const) {
      expect(localizeHelp(renderCommandHelp(findSpec(command), '0.1.0'), 'en')).not.toMatch(
        /[\u4e00-\u9fff]/,
      )
    }
  })
  it('keeps the original text for Chinese help', () => {
    expect(localizeHelp('用法：', 'zh-CN')).toBe('用法：')
  })
})
