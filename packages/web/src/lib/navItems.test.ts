import { describe, expect, test } from 'vitest'
import { isNavItemActive, NAV_ITEMS } from './navItems'

describe('NAV_ITEMS', () => {
  test('四个入口，顺序固定', () => {
    expect(NAV_ITEMS.map((item) => item.to)).toEqual([
      '/overview',
      '/analytics',
      '/sessions',
      '/projects',
    ])
  })
})

describe('isNavItemActive', () => {
  test('完全相等时高亮', () => {
    expect(isNavItemActive('/overview', '/overview')).toBe(true)
    expect(isNavItemActive('/projects', '/projects')).toBe(true)
  })

  test('子路径也高亮父级（详情页点亮"会话"）', () => {
    expect(isNavItemActive('/sessions', '/sessions/:id')).toBe(true)
  })

  test('不同路由不高亮', () => {
    expect(isNavItemActive('/overview', '/sessions')).toBe(false)
    expect(isNavItemActive('/projects', '/sessions/:id')).toBe(false)
  })

  test('不会把 /sessions-archive 误判成 /sessions', () => {
    expect(isNavItemActive('/sessions', '/sessions-archive')).toBe(false)
  })
})
