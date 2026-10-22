/**
 * 测试替身：收集写入内容的假流。
 *
 * cli-progress 按 `stream.isTTY` 决定走哪条渲染路径，测试必须让它以为自己是
 * 终端，否则什么都不会写。整个 CLI 里只有这一个"伪造外部对象"的地方，
 * 集中在这是为了让 `as` 断言只有一处、且带上理由。
 */
export interface CollectingStream {
  readonly stream: NodeJS.WritableStream
  readonly chunks: readonly string[]
  readonly text: () => string
}

/** 造一个 isTTY 为真的可写流，把所有写入收进数组 */
export function createCollectingStream(): CollectingStream {
  const chunks: string[] = []
  const stream = {
    write: (chunk: string) => {
      chunks.push(chunk)
      return true
    },
    on: () => stream,
    once: () => stream,
    removeListener: () => stream,
    end: () => undefined,
    isTTY: true,
    columns: 80,
  }
  return {
    // cli-progress 只用到 write / on / isTTY / columns 四个成员，
    // 完整的 Writable 对测试没有意义，所以按最小形状伪造。
    stream: stream as unknown as NodeJS.WritableStream,
    chunks,
    text: () => chunks.join(''),
  }
}
