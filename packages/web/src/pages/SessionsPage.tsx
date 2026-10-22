import { t, useLocale } from '../lib/locale'
import { useEffect, useState } from 'react'
import type { OverviewPayload, SessionListItem } from '../types/api'
import { useApi, useTrigger } from '../hooks/useApi'
import { useHashRoute } from '../router/useHashRoute'
import { ApiView } from '../components/ApiView'
import { EmptyState } from '../components/EmptyState'
import { Pagination } from '../components/Pagination'
import { SessionFilters } from '../components/SessionFilters'
import { SessionsTable } from '../components/SessionsTable'
import {
  buildSessionsQuery,
  SESSIONS_PAGE_SIZE,
  type SessionOrder,
  type SessionSortKey,
} from '../lib/sessionsQuery'

const SESSIONS_EMPTY = (
  <EmptyState
    title="没有会话数据"
    description="请先运行 turnflare scan 解析 ~/.claude/projects 下的会话记录。"
  />
)

/** 把 unknown 的失败窄化成一句可展示的中文 */
function toScanError(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : '扫描失败，请重试'
}

/** 会话列表：筛选 + 排序 + 分页 + 行点击进详情。 */
export function SessionsPage() {
  useLocale()

  const { params, navigate } = useHashRoute()
  const overview = useApi<OverviewPayload>('/stats/overview')
  const { run, running } = useTrigger()
  const [scanNote, setScanNote] = useState<string | null>(null)

  // 空白也视作"没有筛选"：`#/sessions?project=` 会解析出空串，只挡 null/undefined
  // 的话它会一路传到 buildSessionsQuery，发出 `project=` 后被 API 的 zod
  // （.trim().min(1)）拒绝成 400。顺手 trim 是为了和服务端自己的过滤口径一致。
  const trimmedProject = (params.project ?? '').trim()
  const project = trimmedProject.length > 0 ? trimmedProject : null
  const [sort, setSort] = useState<SessionSortKey>('cost')
  const [order, setOrder] = useState<SessionOrder>('desc')
  const [page, setPage] = useState<number>(1)

  const search = params.search ?? ''
  const model = params.model ?? ''
  const [draftSearch, setDraftSearch] = useState(search)
  useEffect(() => setDraftSearch(search), [search])
  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams()
    if (project) next.set('project', project)
    if (model) next.set('model', model)
    if (search) next.set('search', search)
    if (value.trim()) next.set(key, value.trim())
    else next.delete(key)
    navigate(next.size > 0 ? `/sessions?${next.toString()}` : '/sessions')
  }
  const query = buildSessionsQuery({ page, project, sort, order, search, model })
  const sessions = useApi<readonly SessionListItem[]>(`/sessions${query}`)

  // 切换项目筛选时回到第一页，否则会停在一个不属于新筛选结果的页码上
  useEffect(() => {
    setPage(1)
  }, [project, search, model])

  // 服务端对越界页码返回空数组，此时回退一页而不是把用户留在空白表格里
  useEffect(() => {
    const isOutOfRange =
      page > 1 && !sessions.loading && sessions.error === null && sessions.data?.length === 0
    if (isOutOfRange) {
      setPage((current) => Math.max(1, current - 1))
    }
  }, [page, sessions.loading, sessions.error, sessions.data])

  const handleScan = async (): Promise<void> => {
    setScanNote(null)
    try {
      await run('/scan', { method: 'POST' })
      sessions.reload()
      overview.reload()
      setScanNote('扫描任务已提交')
    } catch (error: unknown) {
      setScanNote(toScanError(error))
    }
  }

  const projects =
    overview.data === null ? [] : overview.data.byProject.map((item) => item.projectSlug)
  const sessionList = sessions.data ?? []
  const canGoNext = sessionList.length >= SESSIONS_PAGE_SIZE

  return (
    <div className="space-y-4">
      <form
        className="card flex flex-wrap items-end gap-3 p-3"
        onSubmit={(event) => {
          event.preventDefault()
          updateFilter('search', draftSearch)
        }}
      >
        <label className="grid min-w-64 flex-1 gap-1 text-xs text-ink-2">
          {t('索引预览搜索')}
          <input
            className="focus-ring rounded-lg border border-border-subtle bg-surface-1 px-3 py-2 text-sm text-ink-1"
            type="search"
            maxLength={200}
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
            placeholder={t('会话 ID、项目、路径、分支或消息预览')}
          />
        </label>
        <label className="grid gap-1 text-xs text-ink-2">
          {t('模型')}
          <select
            className="focus-ring rounded-lg border border-border-subtle bg-surface-1 px-3 py-2 text-sm text-ink-1"
            value={model}
            onChange={(e) => updateFilter('model', e.target.value)}
          >
            <option value="">{t('全部')}</option>
            {overview.data?.byModel.map((m) => (
              <option key={m.model}>{m.model}</option>
            ))}
          </select>
        </label>
        <button className="focus-ring rounded-lg border border-border-subtle px-3 py-2 text-sm">
          {t('搜索')}
        </button>
        {search || model ? (
          <button
            type="button"
            className="focus-ring px-2 py-2 text-sm text-ink-2"
            onClick={() =>
              navigate(project ? `/sessions?project=${encodeURIComponent(project)}` : '/sessions')
            }
          >
            {t('清除搜索')}
          </button>
        ) : null}
        <p className="w-full text-xs text-ink-3">{t('检索每条消息前 200 字及会话元信息')}</p>
      </form>
      <div className="flex flex-wrap items-center gap-3">
        <SessionFilters
          projects={projects}
          project={project}
          sort={sort}
          order={order}
          onProjectChange={(next) => {
            updateFilter('project', next ?? '')
          }}
          onSortChange={setSort}
          onOrderToggle={() => {
            setOrder(order === 'desc' ? 'asc' : 'desc')
          }}
          // SessionFilters.onScan 的签名是 () => void；handleScan 返回 Promise，
          // 直接传会触发 no-misused-promises（未处理的拒绝）。包一层显式吞掉。
          onScan={() => {
            void handleScan()
          }}
          scanning={running}
        />
      </div>

      {overview.error === null ? null : (
        <p className="text-xs text-danger" data-testid="project-list-error">
          {t('项目筛选列表加载失败，仅展示「全部」')}
        </p>
      )}
      {scanNote === null ? null : (
        <p className="text-xs text-ink-2" data-testid="scan-note">
          {t(scanNote)}
        </p>
      )}

      <ApiView state={sessions} empty={SESSIONS_EMPTY}>
        {(list) =>
          list.length === 0 ? (
            <>{SESSIONS_EMPTY}</>
          ) : (
            <div className="space-y-4">
              <SessionsTable
                sessions={list}
                onSelect={(sessionId) => {
                  navigate(`/sessions/${encodeURIComponent(sessionId)}`)
                }}
              />
              <Pagination
                page={page}
                canGoPrev={page > 1}
                canGoNext={canGoNext}
                onPrev={() => {
                  setPage((current) => Math.max(1, current - 1))
                }}
                onNext={() => {
                  setPage((current) => current + 1)
                }}
              />
            </div>
          )
        }
      </ApiView>
    </div>
  )
}
