import { t, useLocale } from '../lib/locale'
import type { SessionListItem } from '../types/api'
import { formatCost, formatLocalDateTime, formatTokens, UNAVAILABLE_TEXT } from '../lib/format'
import { totalTokens } from '../lib/chartData'

interface SessionsTableProps {
  readonly sessions: readonly SessionListItem[]
  readonly onSelect: (sessionId: string) => void
}

/** 把 models 数组合成一句话；空数组时给占位符而不是空白 */
function formatModels(models: readonly string[]): string {
  return models.length === 0 ? UNAVAILABLE_TEXT : models.join(' / ')
}

function formatStartedAt(startedAt: string | null): string {
  return startedAt === null ? UNAVAILABLE_TEXT : formatLocalDateTime(startedAt)
}

/** 会话列表表格。小屏可横向滚动，行点击与行内按钮都能进入详情。 */
export function SessionsTable({ sessions, onSelect }: SessionsTableProps) {
  useLocale()

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-sm" data-testid="sessions-table">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-ink-3">
            <th scope="col" className="px-4 py-3 font-medium">
              {t('项目')}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {t('模型')}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {t('开始时间')}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              {t('Turn 数')}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Token
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              {t('成本')}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              <span className="sr-only">{t('操作')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr
              key={session.sessionId}
              className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-2"
              onClick={() => onSelect(session.sessionId)}
              data-testid="session-row"
            >
              <td className="px-4 py-3">
                <span className="font-medium text-ink-1">{session.projectSlug}</span>
                <span className="block text-xs text-ink-3">{session.sessionId.slice(0, 8)}</span>
              </td>
              <td className="px-4 py-3 text-ink-2">{formatModels(session.models)}</td>
              <td className="px-4 py-3 tabular-nums text-ink-2">
                {formatStartedAt(session.startedAt)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-ink-2">{session.turnCount}</td>
              <td className="px-4 py-3 text-right tabular-nums text-ink-2">
                {formatTokens(totalTokens(session.usage))}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-ink-1">
                {formatCost(session.cost.totalCost)}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  className="focus-ring rounded-full px-2 py-1 text-xs font-medium text-accent"
                  onClick={(event) => {
                    // 阻止冒泡，否则外层行的 onClick 会触发两次导航
                    event.stopPropagation()
                    onSelect(session.sessionId)
                  }}
                >
                  {t('详情')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
