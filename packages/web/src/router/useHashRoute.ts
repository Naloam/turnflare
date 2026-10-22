import { useCallback, useEffect, useState } from 'react'

/**
 * 极简 hash 路由。
 *
 * 为什么自己写：项目禁止新增依赖（不能 pnpm add react-router），
 * 而仪表盘只有四个页面、参数只有一个会话 id 和一个项目筛选，
 * 一个 hash 监听器足够，引入完整路由库属于过度设计。
 *
 * 约定：
 * - 路径形如 `#/overview`、`#/sessions`、`#/sessions/:id`、`#/projects`
 * - 查询串挂在 hash 里：`#/sessions?project=demo`
 * - 空 hash 或无法识别的路径一律重定向到 `#/overview`
 */

/** 当前路由状态 */
export interface HashRoute {
  /** 已识别的路径模板，如 `/sessions/:id` */
  readonly path: string
  /** 路径参数与查询参数合并后的字典 */
  readonly params: Record<string, string>
  /** 导航到目标路径，自动补 `#` 与前导 `/` */
  readonly navigate: (to: string) => void
}

interface ResolvedRoute {
  readonly path: string
  readonly params: Record<string, string>
  readonly matched: boolean
}

/** 支持的路由表，顺序即匹配优先级 */
const ROUTE_PATTERNS: readonly string[] = ['/overview', '/sessions', '/sessions/:id', '/projects']

/** 无法识别时的落点 */
const FALLBACK_PATH = '/overview'

function splitPath(pathname: string): string[] {
  return pathname.split('/').filter((segment) => segment.length > 0)
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    // 非法百分号编码时退回原值：路由不应因为一个坏查询串整体失效
    return segment
  }
}

/** 把 `a=1&b=2` 解析成查询参数字典 */
function parseQuery(search: string): Record<string, string> {
  const params: Record<string, string> = {}
  if (search.length === 0) {
    return params
  }
  for (const pair of search.split('&')) {
    if (pair.length === 0) {
      continue
    }
    const separatorIndex = pair.indexOf('=')
    const rawKey = separatorIndex === -1 ? pair : pair.slice(0, separatorIndex)
    const rawValue = separatorIndex === -1 ? '' : pair.slice(separatorIndex + 1)
    const key = decodeSegment(rawKey)
    if (key.length > 0) {
      params[key] = decodeSegment(rawValue)
    }
  }
  return params
}

/** 按路由表匹配 pathname，收集 `:param` 段 */
function matchPattern(pathname: string): { path: string; params: Record<string, string> } | null {
  const segments = splitPath(pathname)
  for (const pattern of ROUTE_PATTERNS) {
    const patternSegments = splitPath(pattern)
    if (patternSegments.length !== segments.length) {
      continue
    }

    const params: Record<string, string> = {}
    let isMatch = true
    for (let index = 0; index < patternSegments.length; index += 1) {
      const expected = patternSegments[index] ?? ''
      const actual = segments[index] ?? ''
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeSegment(actual)
        continue
      }
      if (expected !== actual) {
        isMatch = false
        break
      }
    }
    if (isMatch) {
      return { path: pattern, params }
    }
  }
  return null
}

function resolveHash(rawHash: string): ResolvedRoute {
  const withoutHash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
  const queryIndex = withoutHash.indexOf('?')
  const pathname = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex)
  const search = queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1)

  const match = matchPattern(pathname)
  if (match === null) {
    return { path: FALLBACK_PATH, params: {}, matched: false }
  }
  // path 参数排在后面：`#/sessions/:id?project=x` 里 id 属于路径，
  // 查询串只该补充额外的过滤条件。反过来 spread 会让一个同名的查询参数
  // 把路径参数盖掉，于是详情页拿着 project 的值去查会话。
  return { path: match.path, params: { ...parseQuery(search), ...match.params }, matched: true }
}

/** 读取当前 hash（不含 `#`） */
function readHash(): string {
  return window.location.hash
}

/**
 * 监听 hashchange，返回当前路径、参数与导航函数。
 *
 * 组件卸载时移除监听；识别失败时通过 effect 把地址栏纠正回 `/overview`，
 * 保证刷新后仍落在有效页面上。
 */
export function useHashRoute(): HashRoute {
  const [rawHash, setRawHash] = useState<string>(readHash)

  useEffect(() => {
    const handleHashChange = (): void => {
      setRawHash(readHash())
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

  const resolved = resolveHash(rawHash)

  const navigate = useCallback((to: string): void => {
    const withSlash = to.startsWith('/') ? to : `/${to}`
    window.location.hash = `#${withSlash}`
  }, [])

  useEffect(() => {
    if (!resolved.matched) {
      navigate(FALLBACK_PATH)
    }
  }, [resolved.matched, navigate])

  return { path: resolved.path, params: resolved.params, navigate }
}
