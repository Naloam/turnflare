import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { Layout } from './Layout'
import { nthElement } from '../test/dom'

function renderLayout(path: string) {
  const navigate = vi.fn()
  const utils = render(
    <Layout path={path} navigate={navigate}>
      <p>页面内容</p>
    </Layout>,
  )
  return { navigate, ...utils }
}

describe('Layout', () => {
  test('渲染侧边导航、顶栏与内容区', () => {
    renderLayout('/overview')

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '主导航（紧凑）' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByText('页面内容')).toBeInTheDocument()
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
  })

  test('高亮当前路由', () => {
    renderLayout('/projects')

    const active = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-current') === 'page')
    expect(active).toHaveLength(2) // 竖排 + 横排各一份
    expect(active.every((button) => button.textContent === '项目')).toBe(true)
  })

  test('详情页点亮"会话"', () => {
    renderLayout('/sessions/:id')

    const active = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-current') === 'page')
    expect(active).toHaveLength(2)
    expect(active.every((button) => button.textContent === '会话')).toBe(true)
  })

  test('点击导航调用 navigate', async () => {
    const { navigate } = renderLayout('/overview')

    await userEvent.click(nthElement(screen.getAllByRole('button', { name: '总览' }), 0))
    expect(navigate).toHaveBeenCalledWith('/overview')
  })

  test('内容区在小屏可横向滚动（main 带 overflow-auto）', () => {
    renderLayout('/overview')
    const main = screen.getByRole('main')
    expect(main.className).toContain('overflow-auto')
  })
})
