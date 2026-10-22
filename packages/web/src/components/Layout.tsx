import { t, useLocale } from '../lib/locale'
import type { ReactNode } from 'react'
import { NavLinks } from './NavLinks'
import { ThemeToggle } from './ThemeToggle'
import { LanguageToggle } from './LanguageToggle'
import { RefreshControls } from './RefreshControls'

interface LayoutProps {
  /** 当前路径模板，用于导航高亮 */
  readonly path: string
  readonly navigate: (to: string) => void
  readonly children: ReactNode
}

/** 品牌标识：一个圆点 + 产品名，避免引入图片资源 */
function Brand() {
  useLocale()

  return (
    <div className="flex items-center gap-2">
      <img src="/mark.svg" width="24" height="24" alt="" aria-hidden="true" />
      <span className="text-sm font-semibold tracking-tight text-ink-1">Turnflare</span>
    </div>
  )
}

/** 应用外壳：侧边导航（≥md）+ 顶栏（小屏横排导航 + 主题切换）+ 内容区。 */
export function Layout({ path, navigate, children }: LayoutProps) {
  useLocale()

  return (
    <div className="flex h-full bg-surface-0">
      <aside className="hidden w-56 shrink-0 border-r border-border-subtle bg-surface-1 md:flex md:flex-col">
        <div className="flex h-14 items-center border-b border-border-subtle px-5">
          <Brand />
        </div>
        <nav className="p-3" aria-label={t('主导航')}>
          <NavLinks activePath={path} navigate={navigate} orientation="vertical" />
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-surface-1 px-4">
          <div className="flex items-center gap-3">
            <span className="md:hidden">
              <Brand />
            </span>
            {/* 与侧边栏导航分开命名：两个同名 landmark 会让读屏用户听到重复的"主导航" */}
            <nav className="md:hidden" aria-label={t('主导航（紧凑）')}>
              <NavLinks activePath={path} navigate={navigate} orientation="horizontal" />
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <RefreshControls />
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
