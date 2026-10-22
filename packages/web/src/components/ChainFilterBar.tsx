import { t, useLocale } from '../lib/locale'
import { useMemo } from 'react'
import type { ChainCounts, Turn } from '../types/api'

/**
 * 会话详情的链条筛选。
 *
 * 为什么需要：`getSession` 返回**全部** turn（含侧链），而侧链 turn 数实测能到
 * 主链的 5.4 倍。打开一场 subagent 密集的会话，时间线会被几千条 subagent turn
 * 埋掉，主对话反而找不到。
 *
 * 为什么放 URL：筛选是"我在看什么"的一部分，刷新和分享链接都该保留。
 * 放组件 state 的话，用户刷新一次就得重新选。
 */

/** 三种筛选口径。`all` 是默认值，与加这个筛选器之前的行为一致 */
export type ChainFilter = 'all' | 'main' | 'side'

export const CHAIN_FILTERS: readonly ChainFilter[] = ['all', 'main', 'side']

const FILTER_LABELS: Readonly<Record<ChainFilter, string>> = {
  all: '全部',
  main: '主对话',
  side: '仅 subagent',
}

/** 从 URL 查询参数读筛选值；非法值回退 all（容忍手改地址栏） */
export function readChainFilter(raw: string | undefined): ChainFilter {
  if (raw === 'main' || raw === 'side') {
    return raw
  }
  return 'all'
}

/** 按筛选口径过滤 turn */
export function filterTurnsByChain(turns: readonly Turn[], filter: ChainFilter): readonly Turn[] {
  if (filter === 'main') {
    return turns.filter((turn) => !turn.isSidechain)
  }
  if (filter === 'side') {
    return turns.filter((turn) => turn.isSidechain)
  }
  return turns
}

export interface ChainFilterStats {
  readonly mainCount: number
  readonly sideCount: number
}

/**
 * 统计两种链条各有多少条，用于在筛选器上显示占比。
 *
 * **必须用服务端的 chainCounts，不能数 turns 数组**：详情有 500 条上限且主链优先，
 * 主链一旦超过 500 条，侧链会被完全挤出返回结果。数数组会得到"这场会话没有
 * subagent"的错误结论——筛选器随之整条藏起来，用户也就再也不知道它的存在。
 */
export function countByChain(counts: ChainCounts): ChainFilterStats {
  return { mainCount: counts.main, sideCount: counts.side }
}

export interface ChainFilterBarProps {
  /** 服务端返回的全量链条计数，不受 500 条上限影响 */
  readonly chainCounts: ChainCounts
  readonly value: ChainFilter
  readonly onChange: (next: ChainFilter) => void
}

/**
 * 筛选按钮组 + 计数。
 *
 * 侧链为 0 时整条藏起来：绝大多数会话没有 subagent，留一排只有"全部"能点的
 * 按钮纯粹是噪音。
 */
export function ChainFilterBar({ chainCounts, value, onChange }: ChainFilterBarProps) {
  useLocale()

  const stats = useMemo(() => countByChain(chainCounts), [chainCounts])

  if (stats.sideCount === 0) {
    return null
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label={t('按对话链条筛选')}
    >
      {CHAIN_FILTERS.map((filter) => {
        const isActive = filter === value
        const count =
          filter === 'main'
            ? stats.mainCount
            : filter === 'side'
              ? stats.sideCount
              : chainCounts.total
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={isActive}
            data-testid={`chain-filter-${filter}`}
            className={
              isActive
                ? 'focus-ring rounded-full bg-accent-soft px-3 py-1.5 text-sm text-accent'
                : 'focus-ring rounded-full border border-border-subtle px-3 py-1.5 text-sm text-ink-2'
            }
            onClick={() => {
              onChange(filter)
            }}
          >
            {t(FILTER_LABELS[filter])}
            <span className="ml-1 tabular-nums text-xs opacity-70">{count}</span>
          </button>
        )
      })}
      <span className="text-xs text-ink-3">
        {t('其中')}
        {stats.sideCount} {t('条来自 subagent，不计入上方统计')}
      </span>
    </div>
  )
}
