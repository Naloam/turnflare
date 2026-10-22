import { describe, expect, it } from 'vitest'
import pc from 'picocolors'
import { COLOR_PALETTE, PLAIN_PALETTE, createPalette, shouldUseColor } from './color.js'

describe('color：颜色开关', () => {
  it('--json 模式绝不上色', () => {
    expect(shouldUseColor({ NO_COLOR: '' }, true)).toBe(false)
  })

  it('NO_COLOR 非空时绝不上色', () => {
    expect(shouldUseColor({ NO_COLOR: '1' }, false)).toBe(false)
  })

  it('NO_COLOR 为空串时按 picocolors 的口径走', () => {
    expect(shouldUseColor({ NO_COLOR: '' }, false)).toBe(pc.isColorSupported)
  })

  it('没有 NO_COLOR 时跟随 picocolors 的 TTY 判定', () => {
    expect(shouldUseColor({}, false)).toBe(pc.isColorSupported)
  })

  it('关闭时返回原样输出的调色板', () => {
    const palette = createPalette(false)
    expect(palette.bold('x')).toBe('x')
    expect(palette.red('x')).toBe('x')
    expect(palette).toBe(PLAIN_PALETTE)
  })

  it('开启时返回 picocolors 调色板', () => {
    const palette = createPalette(true)
    expect(palette).toBe(COLOR_PALETTE)
    // picocolors 在非 TTY 下也是原样输出，因此只验证"拿到的是同一批函数"
    expect(palette.bold).toBe(pc.bold)
  })
})
