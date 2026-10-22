import type { ReactNode } from 'react'
import type { ApiState } from '../hooks/useApi'
import { ErrorState } from './ErrorState'
import { Loading } from './Loading'

interface ApiViewProps<T> {
  readonly state: ApiState<T>
  /** 数据就绪后的渲染函数 */
  readonly children: (data: T) => ReactNode
  /** 请求成功但没有数据时的占位内容 */
  readonly empty: ReactNode
}

/**
 * 三态容器：把「加载骨架 / 错误态 / 空态 / 数据」的分支收敛到一处。
 *
 * 优先级经过斟酌：错误优先于空态（有错误时不该假装"只是没数据"），
 * 空态优先于数据（null 数据不进 children，杜绝渲染 undefined）。
 * 请求进行中若已有上一份数据，继续展示旧数据，避免筛选/翻页时界面闪空。
 */
export function ApiView<T>({ state, children, empty }: ApiViewProps<T>) {
  if (state.error !== null) {
    return <ErrorState message={state.error} onRetry={state.reload} />
  }
  if (state.data === null) {
    return state.loading ? <Loading /> : <>{empty}</>
  }
  return <>{children(state.data)}</>
}
