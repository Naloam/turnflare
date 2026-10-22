import { t, useLocale } from '../lib/locale'
import type { Turn } from '../types/api'
import { Badge } from './Badge'
import { StatBar } from './StatBar'
import { formatLocalDateTime, formatTokens, UNAVAILABLE_TEXT } from '../lib/format'
import { totalTokens } from '../lib/chartData'

interface TurnTimelineProps {
  readonly turns: readonly Turn[]
}

/** 角色 -> 徽标语气 */
const ROLE_TONES: Record<Turn['role'], 'accent' | 'neutral'> = {
  user: 'neutral',
  assistant: 'accent',
}

const ROLE_LABELS: Record<Turn['role'], string> = {
  user: '用户',
  assistant: '助手',
}

/** fast 档徽标文案：fast 的输入/输出单价约为标准档 2 倍，值得单独标出来 */
const FAST_SPEED_LABEL = 'fast 档'

function turnTokens(turn: Turn): number {
  return turn.usage === null ? 0 : totalTokens(turn.usage)
}

/**
 * turn 时间线。
 *
 * 说明：契约里的 `Turn` 没有单条成本字段（成本只在会话/模型/项目粒度聚合），
 * 前端也不该为了显示它去复制 core 的价目表。因此这里用 token 数 + 会话内占比
 * 来表达单条 turn 的体量，会话总成本在详情页头部展示。
 */
export function TurnTimeline({ turns }: TurnTimelineProps) {
  useLocale()

  const maxTokens = turns.reduce((max, turn) => Math.max(max, turnTokens(turn)), 0)

  return (
    <ol className="space-y-2" data-testid="turn-timeline">
      {turns.map((turn, index) => (
        <li key={turn.uuid} className="card px-4 py-3" data-testid="turn-item">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ROLE_TONES[turn.role]}>{t(ROLE_LABELS[turn.role])}</Badge>
            <span className="text-xs tabular-nums text-ink-3">
              {formatLocalDateTime(turn.timestamp)}
            </span>
            {turn.model === null ? null : <span className="text-xs text-ink-2">{turn.model}</span>}
            {turn.isSidechain ? <Badge tone="warning">{t('侧链')}</Badge> : null}
            {turn.usage !== null && turn.usage.speed === 'fast' ? (
              <Badge tone="warning">{t(FAST_SPEED_LABEL)}</Badge>
            ) : null}
            <span className="ml-auto text-xs tabular-nums text-ink-2">
              {turn.usage === null ? UNAVAILABLE_TEXT : formatTokens(turnTokens(turn))} token
            </span>
          </div>

          <div className="mt-2 flex items-center gap-3">
            {/* 这里的比例是"相对本会话最大 turn"，不是整体份额，因此不显示百分比 */}
            <StatBar ratio={maxTokens > 0 ? turnTokens(turn) / maxTokens : 0} showPercent={false} />
            <span className="text-xs text-ink-3">#{index + 1}</span>
          </div>

          {turn.textPreview.length === 0 ? null : (
            <p className="mt-2 line-clamp-2 text-sm text-ink-2">{turn.textPreview}</p>
          )}

          {turn.tools.length === 0 ? null : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {turn.tools.map((tool) => (
                <li key={tool.toolUseId}>
                  <Badge tone={tool.isError ? 'danger' : 'positive'}>{tool.toolName}</Badge>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}
