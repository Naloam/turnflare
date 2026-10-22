import { t, useLocale } from '../lib/locale'
import type { SessionDetail } from '../types/api'
import { useApi } from '../hooks/useApi'
import { useHashRoute } from '../router/useHashRoute'
import { ChainFilterBar, filterTurnsByChain, readChainFilter } from '../components/ChainFilterBar'
import { ApiView } from '../components/ApiView'
import { DetailGrid } from '../components/DetailGrid'
import { EmptyState } from '../components/EmptyState'
import { Pagination } from '../components/Pagination'
import { SectionCard } from '../components/SectionCard'
import { ToolCallList } from '../components/ToolCallList'
import { TokenWaterfall } from '../components/TokenWaterfall'
import { TurnTimeline } from '../components/TurnTimeline'
import {
  formatCost,
  formatLocalDateTime,
  formatRelativeTime,
  formatTokensDetailed,
  UNAVAILABLE_TEXT,
} from '../lib/format'
import { totalTokens } from '../lib/chartData'

const NOT_FOUND_STATE = (
  <EmptyState title="会话不存在" description="该会话可能已被清理，或链接中的 ID 有误。" />
)

/** HTTP 404：资源不存在。用于把「查无此会话」与「请求出错」区分开 */
const NOT_FOUND_STATUS = 404

const EMPTY_STATE = (
  <EmptyState title="会话详情为空" description="服务端没有返回该会话的 turn 记录。" />
)

function formatRange(startedAt: string | null, endedAt: string | null): string {
  const start = startedAt === null ? UNAVAILABLE_TEXT : formatLocalDateTime(startedAt)
  if (endedAt === null) {
    return t('{start} 起', { start })
  }
  return `${start} → ${formatLocalDateTime(endedAt)}`
}

interface SessionDetailPageProps {
  /** 路由参数里的会话 id；由 RouteView 从 hash 解析后传入，页面不再自己读 hash */
  readonly sessionId: string
}

/** 会话详情：元信息头 + turn 时间线 + token 瀑布图 + 工具调用明细。 */
export function SessionDetailPage({ sessionId }: SessionDetailPageProps) {
  useLocale()

  const { navigate, params } = useHashRoute()
  // 筛选值来自 URL：刷新与分享链接都能保留当前视图。非法值回退 all。
  const chain = readChainFilter(params.chain)
  const rawPage = Number(params.page ?? 1)
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 1000000 ? rawPage : 1
  const query = chain === 'all' && page === 1 ? '' : `?chain=${chain}&page=${page}`
  const state = useApi<SessionDetail>(`/sessions/${encodeURIComponent(sessionId)}${query}`)

  // 404 要在 ApiView 之前拦掉：它需要的是「资源不存在」而不是「请求出错」。
  // 用状态码判断而不是在 error 文本里找 "404"——后者在服务端改文案时就静默失效。
  if (state.status === NOT_FOUND_STATUS || sessionId.length === 0) {
    return NOT_FOUND_STATE
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        className="focus-ring rounded-full border border-border-subtle px-3 py-1.5 text-sm text-ink-2"
        onClick={() => {
          navigate('/sessions')
        }}
      >
        {t('← 返回会话列表')}
      </button>

      <ApiView state={state} empty={EMPTY_STATE}>
        {(detail) => {
          const visibleTurns = filterTurnsByChain(detail.turns, chain)
          return (
            <div className="space-y-4 md:space-y-6">
              <SectionCard title={detail.sessionId} description={detail.projectSlug}>
                <DetailGrid
                  items={[
                    { label: t('项目'), value: detail.projectSlug },
                    { label: t('工作目录'), value: detail.cwd ?? UNAVAILABLE_TEXT },
                    { label: t('Git 分支'), value: detail.gitBranch ?? UNAVAILABLE_TEXT },
                    { label: t('模型'), value: detail.models.join(' / ') || UNAVAILABLE_TEXT },
                    { label: t('起止时间'), value: formatRange(detail.startedAt, detail.endedAt) },
                    {
                      label: t('最后活动'),
                      value: formatRelativeTime(detail.endedAt ?? detail.startedAt ?? ''),
                    },
                    {
                      label: t('Token 总量'),
                      value: formatTokensDetailed(totalTokens(detail.usage)),
                    },
                    { label: t('总成本'), value: formatCost(detail.cost.totalCost) },
                    {
                      label: t('解析错误'),
                      value:
                        detail.parseErrorCount === 0
                          ? t('无')
                          : t('{0} 行无法解析', { '0': detail.parseErrorCount }),
                    },
                  ]}
                />
              </SectionCard>

              <ChainFilterBar
                chainCounts={detail.chainCounts}
                value={chain}
                onChange={(next) => {
                  navigate(`/sessions/${sessionId}?chain=${next}`)
                }}
              />

              {/* 瀑布图与时间线跟随同一个筛选：瀑布图回答"这场会话的 token 去哪了"，
                只画一半会让人误判总量。工具明细同理——否则筛完看到的时间线和
                工具列表会对不上。 */}
              <SectionCard
                title="Token 瀑布图"
                description="每条 assistant turn 的输入 / 缓存读取 / 输出"
              >
                <TokenWaterfall turns={visibleTurns} />
              </SectionCard>

              <SectionCard title={t('Turn 时间线（{0}）', { '0': visibleTurns.length })}>
                <TurnTimeline turns={visibleTurns} />
              </SectionCard>

              <Pagination
                page={page}
                canGoPrev={page > 1}
                canGoNext={
                  page * 500 <
                  (chain === 'all' ? detail.chainCounts.total : detail.chainCounts[chain])
                }
                onPrev={() =>
                  navigate(`/sessions/${sessionId}?chain=${chain}&page=${Math.max(1, page - 1)}`)
                }
                onNext={() => navigate(`/sessions/${sessionId}?chain=${chain}&page=${page + 1}`)}
              />
              <p className="text-xs text-ink-3">
                {t('当前显示 {shown} / {total} 条', {
                  shown: visibleTurns.length,
                  total: chain === 'all' ? detail.chainCounts.total : detail.chainCounts[chain],
                })}
              </p>
              <SectionCard title="工具调用明细">
                <ToolCallList turns={visibleTurns} />
              </SectionCard>
            </div>
          )
        }}
      </ApiView>
    </div>
  )
}
