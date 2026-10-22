import { t, useLocale } from '../lib/locale'
interface LoadingProps {
  /** 展示给读屏软件的说明文字 */
  readonly label?: string
  /** 骨架行数 */
  readonly rows?: number
}

const DEFAULT_ROWS = 3
const SKELETON_ROW_KEYS: readonly string[] = ['row-a', 'row-b', 'row-c', 'row-d']

/** 加载态骨架屏。行高用 animate-pulse 表达"正在到达"，不暗示具体进度。 */
export function Loading({ label = '正在加载数据', rows = DEFAULT_ROWS }: LoadingProps) {
  useLocale()
  const keys = SKELETON_ROW_KEYS.slice(0, Math.max(1, Math.min(rows, SKELETON_ROW_KEYS.length)))
  return (
    <div className="space-y-3" data-testid="loading" role="status" aria-live="polite">
      <span className="sr-only">{t(label)}</span>
      {keys.map((key) => (
        <div key={key} className="h-4 animate-pulse rounded-full bg-surface-2" />
      ))}
    </div>
  )
}
