/**
 * 扫描进度上报。
 *
 * 进度条是纯装饰：真实进度由 Scanner 的 `onProgress` 回调驱动，渲染交给
 * 可替换的 `ProgressReporter`。测试注入静音实现，于是"有没有进度条"
 * 永远不会成为断言的不稳定因素。
 *
 * 真实实现的输出流是 **stderr**：stdout 只承载结果与 `--json` 载荷，
 * 这样 `turnflare scan --json | jq` 不会被进度条污染。
 */
import { Presets, SingleBar } from 'cli-progress'

export interface ProgressReporter {
  /** 每处理完一个文件调用一次；`total` 由 Scanner 的回调给出 */
  advance(done: number, total: number): void
  /** 扫描结束（无论成败）调用一次 */
  stop(): void
}

const BAR_FORMAT = '扫描进度 [{bar}] {percentage}% | {value}/{total} 个文件'

/** 静音实现：测试与 `--json` 模式用它 */
export function createSilentProgress(): ProgressReporter {
  return {
    advance: () => undefined,
    stop: () => undefined,
  }
}

/** 记录型实现：把每次上报收进数组，供测试断言进度确实在走 */
export function createRecordingProgress(): {
  readonly reporter: ProgressReporter
  readonly events: readonly string[]
} {
  const events: string[] = []
  return {
    reporter: {
      advance: (done, total) => {
        events.push(`${String(done)}/${String(total)}`)
      },
      stop: () => {
        events.push('stop')
      },
    },
    events,
  }
}

/** cli-progress 实现；写入调用方给定的流（生产环境传 process.stderr） */
export function createCliProgress(stream: NodeJS.WritableStream): ProgressReporter {
  let bar: SingleBar | null = null
  return {
    advance: (done, total) => {
      // 总数只有第一个文件回来时才知道，所以条形图延迟到这一刻创建，
      // 且只 start 一次——重复 start 会把进度重置回 0。
      if (bar === null) {
        bar = new SingleBar(
          { format: BAR_FORMAT, hideCursor: true, stream },
          Presets.shades_classic,
        )
        bar.start(total, 0)
      }
      bar.update(done)
    },
    stop: () => {
      bar?.stop()
      bar = null
    },
  }
}
