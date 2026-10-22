import { t, useLocale } from '../lib/locale'
import type { Turn } from '../types/api'
import { Badge } from './Badge'
import { formatBytes } from '../lib/format'

interface ToolCallListProps {
  readonly turns: readonly Turn[]
}

/** 把所有 turn 里的工具调用摊平。入参只读，返回新数组。 */
function flattenTools(turns: readonly Turn[]): Turn['tools'] {
  return turns.flatMap((turn) => turn.tools)
}

/** 工具调用明细：工具名、是否报错、结果体积。 */
export function ToolCallList({ turns }: ToolCallListProps) {
  useLocale()

  const tools = flattenTools(turns)

  if (tools.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-3" data-testid="tool-list-empty">
        {t('该会话没有工具调用')}
      </p>
    )
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse text-sm" data-testid="tool-call-table">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-ink-3">
            <th scope="col" className="px-4 py-3 font-medium">
              {t('工具')}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {t('状态')}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              {t('结果体积')}
            </th>
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => (
            <tr key={tool.toolUseId} className="border-b border-border-subtle last:border-0">
              <td className="px-4 py-3 font-medium text-ink-1">{tool.toolName}</td>
              <td className="px-4 py-3">
                <Badge tone={tool.isError ? 'danger' : 'positive'}>
                  {tool.isError ? t('失败') : t('成功')}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-ink-2">
                {formatBytes(tool.resultBytes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
