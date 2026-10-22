import { t, useLocale } from '../lib/locale'
import { isNavItemActive, NAV_ITEMS } from '../lib/navItems'

interface NavLinksProps {
  readonly activePath: string
  readonly navigate: (to: string) => void
  /** 竖排用于侧边栏，横排用于小屏顶栏 */
  readonly orientation?: 'vertical' | 'horizontal'
}

/** 导航链接列表。高亮当前路由，键盘可用（原生 button + focus-ring）。 */
export function NavLinks({ activePath, navigate, orientation = 'vertical' }: NavLinksProps) {
  useLocale()
  const containerClass =
    orientation === 'vertical' ? 'flex flex-col gap-1' : 'flex items-center gap-1'
  const itemClass =
    orientation === 'vertical'
      ? 'w-full rounded-lg px-3 py-2 text-left text-sm font-medium'
      : 'rounded-full px-3 py-1.5 text-sm font-medium'

  return (
    <ul className={containerClass} data-testid={`nav-${orientation}`}>
      {NAV_ITEMS.map((item) => {
        const isActive = isNavItemActive(item.to, activePath)
        return (
          <li key={item.to}>
            <button
              type="button"
              className={`focus-ring ${itemClass} ${
                isActive ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:text-ink-1'
              }`}
              onClick={() => navigate(item.to)}
              aria-current={isActive ? 'page' : undefined}
            >
              {t(item.label)}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
