import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ThemeToggle } from './ThemeToggle'

const STORAGE_KEY = 'turnflare-theme'

function setMatches(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

function documentHasDarkClass(): boolean {
  return document.documentElement.classList.contains('dark')
}

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('ThemeToggle', () => {
  test('没有存储偏好时跟随系统深色', async () => {
    setMatches(true)
    render(<ThemeToggle />)

    await waitFor(() => {
      expect(documentHasDarkClass()).toBe(true)
    })
    expect(screen.getByTestId('theme-toggle')).toHaveTextContent('深色')
  })

  test('没有存储偏好时跟随系统浅色，并纠正 index.html 的静态 dark', async () => {
    setMatches(false)
    // index.html 里 <html class="dark"> 是静态默认值，挂载后必须被真实偏好纠正
    document.documentElement.classList.add('dark')

    render(<ThemeToggle />)

    await waitFor(() => {
      expect(documentHasDarkClass()).toBe(false)
    })
    expect(screen.getByTestId('theme-toggle')).toHaveTextContent('浅色')
  })

  test('localStorage 优先于系统偏好', async () => {
    setMatches(false)
    window.localStorage.setItem(STORAGE_KEY, 'dark')

    render(<ThemeToggle />)

    await waitFor(() => {
      expect(documentHasDarkClass()).toBe(true)
    })
  })

  test('点击切换深浅色并写回 localStorage', async () => {
    setMatches(false)
    render(<ThemeToggle />)
    await waitFor(() => {
      expect(documentHasDarkClass()).toBe(false)
    })

    await userEvent.click(screen.getByTestId('theme-toggle'))

    expect(documentHasDarkClass()).toBe(true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark')
    expect(screen.getByTestId('theme-toggle')).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByTestId('theme-toggle'))

    expect(documentHasDarkClass()).toBe(false)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light')
  })

  test('localStorage 完全不可用时切换仍然生效（只是不持久化）', async () => {
    setMatches(false)
    // 隐私模式 / 禁用 Cookie 时 localStorage 会抛 SecurityError，两条路径都要兜住
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
    })

    render(<ThemeToggle />)
    await waitFor(() => {
      expect(documentHasDarkClass()).toBe(false)
    })

    await userEvent.click(screen.getByTestId('theme-toggle'))

    expect(documentHasDarkClass()).toBe(true)
    expect(screen.getByTestId('theme-toggle')).toHaveTextContent('深色')
  })
})
