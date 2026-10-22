import { useCallback, useEffect, useState } from 'react'
import {
  isApiEnvelope,
  MALFORMED_RESPONSE_ERROR,
  NETWORK_ERROR,
  UNKNOWN_API_ERROR,
  httpStatusError,
} from '../lib/apiEnvelope'

/**
 * 一次 API 读取的三态 + 重试能力。
 *
 * 契约已冻结：只有这四个字段。页面据此渲染加载骨架 / 错误态 / 数据，
 * 不允许在加载中渲染 undefined（否则图表和表格会拿到空洞数据）。
 */
export interface ApiState<T> {
  readonly data: T | null
  readonly loading: boolean
  readonly error: string | null
  /**
   * 最后一次响应的 HTTP 状态码；还没发出请求或网络层失败时为 null。
   *
   * 必须有这个字段：页面要区分「资源不存在」（404，该显示空态）和
   * 「请求有问题」（400/500，该显示错误态）。靠 error 文本里有没有 "404"
   * 去猜是脆的——服务端一旦改文案，判断就静默失效。
   */
  readonly status: number | null
  readonly reload: () => void
}

/**
 * 把 deps 数组压成一个稳定字符串。
 *
 * 不能直接把数组丢进 useEffect 的依赖表——每次渲染都是新引用，会无限请求。
 * JSON.stringify 之外留了兜底：BigInt 等不可序列化值时退化成类型签名，
 * 保证最坏情况也只是少触发一次请求，而不是抛异常。
 */
function serializeDeps(deps: readonly unknown[]): string {
  try {
    // 对数组调用 stringify 要么返回 string，要么抛错（例如 deps 里有 BigInt），
    // 不存在"返回 undefined"这一种结果——所以这里不需要 ?? 兜底，
    // 异常由下面的 catch 接住。
    return JSON.stringify(deps)
  } catch {
    // 不可序列化时退化成类型签名：最坏情况只是少触发一次请求，
    // 比让整个页面崩掉好。
    return deps.map((dep) => typeof dep).join(',')
  }
}

/**
 * 读取 `/api${path}` 并把包络拆成三态。
 *
 * - 卸载或 path 变化时用 AbortController 取消在途请求，避免竞态覆盖新数据
 * - `success=false` 时把服务端的 error 字段透出（中文可读）
 * - 请求进行中保留上一份数据，避免筛选/翻页时界面闪空
 *
 * @param path API 路径，不含 `/api` 前缀
 * @param deps 额外依赖，用于 path 不变但入参变化的场景
 */
export function useApi<T>(path: string, deps: readonly unknown[] = []): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [status, setStatus] = useState<number | null>(null)
  const [attempt, setAttempt] = useState<number>(0)

  const reload = useCallback((): void => {
    setAttempt((previous) => previous + 1)
  }, [])

  useEffect(() => {
    const refresh = (): void => setAttempt((previous) => previous + 1)
    window.addEventListener('turnflare:refresh', refresh)
    return () => window.removeEventListener('turnflare:refresh', refresh)
  }, [])

  const depsKey = serializeDeps(deps)

  useEffect(() => {
    const controller = new AbortController()

    setLoading(true)
    setError(null)

    // 用 abort 信号而不是额外的 boolean 表达"这次请求还有没有人在等"：
    // cleanup 里两者总是一同变化，留两个概念只会让人以为它们可能不一致。
    const isStale = (): boolean => controller.signal.aborted

    const load = async (): Promise<void> => {
      try {
        // 网络层单独一个 try：JSON 解析失败和连接失败必须报不同的文案，
        // 否则用户看到"连不上服务"会去查网络，而真正的问题在服务端返回了 HTML 错误页。
        let response: Response
        try {
          response = await fetch(`/api${path}`, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          })
        } catch {
          // AbortError 是取消信号，不是故障：静默降级，不覆盖界面状态
          if (isStale()) {
            return
          }
          setError(NETWORK_ERROR)
          return
        }

        if (isStale()) {
          return
        }
        setStatus(response.status)
        if (!response.ok) {
          // 失败响应也带着包络：服务端的 sendFailure 永远把 success:false 和
          // 中文可读原因写进 body。直接按状态码造文案会丢掉真正有用的一句，
          // 例如"参数 sort 必须是 cost/tokens/recent/turns 之一"。
          // 解析不出来时才退回到状态码兜底。
          let failureMessage: string | null = null
          try {
            const errorBody: unknown = await response.json()
            if (isApiEnvelope<unknown>(errorBody) && typeof errorBody.error === 'string') {
              failureMessage = errorBody.error
            }
          } catch {
            failureMessage = null
          }
          if (isStale()) {
            return
          }
          setError(failureMessage ?? httpStatusError(response.status))
          return
        }

        let payload: unknown
        try {
          payload = await response.json()
        } catch {
          if (isStale()) {
            return
          }
          setError(MALFORMED_RESPONSE_ERROR)
          return
        }

        if (isStale()) {
          return
        }
        if (!isApiEnvelope<T>(payload)) {
          setError(MALFORMED_RESPONSE_ERROR)
          return
        }
        if (!payload.success) {
          setError(payload.error ?? UNKNOWN_API_ERROR)
          return
        }
        setStatus(response.status)
        setData(payload.data)
      } finally {
        if (!isStale()) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [path, depsKey, attempt])

  return { data, loading, error, status, reload }
}

/**
 * 一次性动作（POST /api/scan 等）。
 *
 * 与 useApi 的区别：没有缓存的三态，失败时直接 reject，由调用方决定怎么提示——
 * 扫描失败的文案应该出现在按钮旁边，而不是占据整个页面。
 */
export interface TriggerState {
  readonly run: (path: string, init?: RequestInit) => Promise<unknown>
  readonly running: boolean
}

export function useTrigger(): TriggerState {
  const [running, setRunning] = useState<boolean>(false)

  const run = useCallback(async (path: string, init?: RequestInit): Promise<unknown> => {
    setRunning(true)
    try {
      const response = await fetch(`/api${path}`, {
        ...init,
        // 合并而非覆盖：调用方通过 init.headers 传的 Content-Type 等必须保留，
        // 否则 POST /api/scan 会丢掉 application/json 声明。
        headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
      })
      if (!response.ok) {
        throw new Error(httpStatusError(response.status))
      }
      const payload: unknown = await response.json()
      if (isApiEnvelope<unknown>(payload) && !payload.success) {
        throw new Error(payload.error ?? UNKNOWN_API_ERROR)
      }
      return payload
    } finally {
      setRunning(false)
    }
  }, [])

  return { run, running }
}
