import { vi } from 'vitest'

/**
 * fetch 测试替身。
 *
 * 不依赖 Node 的 undici Response：useApi 只用到 ok / status / json() 三个成员，
 * 用普通对象就能完整模拟，也免去在 jsdom 里构造流式 body 的麻烦。
 */

/** 最小 Response 形状，与 useApi 实际用到的成员对齐 */
export interface FakeResponse {
  readonly ok: boolean
  readonly status: number
  readonly json: () => Promise<unknown>
}

export function jsonResponse(body: unknown, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }
}

export function httpResponse(status: number, body: unknown = { success: false }): FakeResponse {
  return jsonResponse(body, status)
}

/** 记录到的每一次 fetch 调用 */
export interface FetchCall {
  readonly url: string
  readonly init: RequestInit | undefined
}

/**
 * 按 URL 决定返回什么的回调。
 *
 * 允许返回 Promise：很多用例需要"发得出请求但迟迟不返回"，用来观察取消时机。
 * 返回 undefined 表示"这个 URL 不该被请求"。
 */
export type FetchRouter = (
  url: string,
  init: RequestInit | undefined,
) => FakeResponse | Promise<FakeResponse> | undefined

export interface FetchStub {
  readonly calls: FetchCall[]
  /** 取某个 URL 的最后一次调用，找不到时抛错（测试里 silent miss 比 fail 更糟） */
  lastCallFor: (urlFragment: string) => FetchCall
}

/**
 * 用 vi.stubGlobal 装上 fetch 假实现。
 *
 * 调用方需要在测试结束时调用 vi.unstubAllGlobals()——vitest 的 unstubAllGlobals
 * 在 setup 里没配自动恢复，统一由各测试文件的 afterEach 负责。
 */
export function stubFetch(router: FetchRouter): FetchStub {
  const calls: FetchCall[] = []

  const fetchMock = (url: string, init?: RequestInit): Promise<FakeResponse> => {
    const call: FetchCall = { url, init }
    calls.push(call)
    const response = router(url, init)
    if (response === undefined) {
      return Promise.reject(new Error(`未预期的 fetch：${url}`))
    }
    return Promise.resolve(response)
  }
  vi.stubGlobal('fetch', vi.fn(fetchMock))

  return {
    calls,
    lastCallFor: (urlFragment: string): FetchCall => {
      const found = [...calls].reverse().find((call) => call.url.includes(urlFragment))
      if (found === undefined) {
        throw new Error(`没有找到包含 "${urlFragment}" 的 fetch 调用`)
      }
      return found
    },
  }
}
