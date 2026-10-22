import { t, useLocale } from '../lib/locale'
import { useCallback, useEffect, useState } from 'react'

/** 主题偏好：显式选择，或交给系统 */
export type ThemePreference = 'light' | 'dark'

const STORAGE_KEY = 'turnflare-theme'
const DARK_CLASS = 'dark'
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

/** 读 localStorage；不可用（隐私模式 / 禁用）时返回 null 表示"未显式选择" */
function readStoredPreference(): ThemePreference | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
  }
}

/** 跟随系统偏好；matchMedia 缺失时按浅色处理 */
function systemPreference(): ThemePreference {
  if (typeof window.matchMedia !== 'function') {
    return 'light'
  }
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light'
}

/** 把偏好写到 <html> 上：index.css 的 .dark 变体靠这个类切换整套 token */
function applyPreference(preference: ThemePreference): void {
  document.documentElement.classList.toggle(DARK_CLASS, preference === 'dark')
}

function persistPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // 存不进去（隐私模式）不影响当前会话的切换，只是刷新后回到系统偏好
  }
}

/**
 * 深浅色切换按钮。
 *
 * 初始值优先级：localStorage > prefers-color-scheme。
 * index.html 里 <html class="dark"> 是静态默认值，挂载后会立刻用真实偏好纠正它，
 * 避免"系统是浅色却闪一下深色"的割裂感。
 */
export function ThemeToggle() {
  useLocale()

  const [preference, setPreference] = useState<ThemePreference>(
    () => readStoredPreference() ?? systemPreference(),
  )

  useEffect(() => {
    applyPreference(preference)
  }, [preference])

  const isDark = preference === 'dark'
  const toggle = useCallback((): void => {
    const next: ThemePreference = isDark ? 'light' : 'dark'
    setPreference(next)
    persistPreference(next)
  }, [isDark])

  return (
    <button
      type="button"
      className="focus-ring flex items-center gap-2 rounded-full border border-border-subtle px-3 py-1.5 text-xs font-medium text-ink-2"
      onClick={toggle}
      aria-pressed={isDark}
      data-testid="theme-toggle"
    >
      <span aria-hidden="true">{isDark ? '☾' : '☀'}</span>
      {isDark ? t('深色') : t('浅色')}
    </button>
  )
}
