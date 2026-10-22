/** 侧边导航的一项 */
export interface NavItem {
  readonly to: string
  readonly label: string
}

/** 导航表：顺序即展示顺序 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/overview', label: '总览' },
  { to: '/sessions', label: '会话' },
  { to: '/projects', label: '项目' },
]

/**
 * 判断导航项是否高亮。
 *
 * `/sessions/:id` 详情页也要点亮"会话"——用户在详情页时侧边栏不该全灭，
 * 所以用前缀匹配而不是全等。
 */
export function isNavItemActive(itemTo: string, currentPath: string): boolean {
  return currentPath === itemTo || currentPath.startsWith(`${itemTo}/`)
}
