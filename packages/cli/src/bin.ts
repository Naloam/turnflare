#!/usr/bin/env node
/**
 * `turnflare` 入口。
 *
 * 只做四件事：解析 argv、构造真实 context（process.stdout / stderr / env / cwd）、
 * 分发、按结果退出。所有逻辑都在可测试的 `runCli` 里，这里因此短到能一眼看完。
 */
import { runCli } from './cli.js'
import { createDefaultDeps } from './deps.js'
import type { CliContext } from './context.js'

// 管道下游提前退出（`turnflare session <id> | head -1`、`| less` 里按 q）时，
// Node 会在 stdout 上抛 EPIPE。没人听着还要继续写是没有意义的，
// 但也不该甩一大串 "Unhandled 'error' event" 堆栈给用户——那是我们的Bug，
// 不是用户的。安静退出去就好。
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') {
      process.exit(0)
    }
    throw error
  })
}

const context: CliContext = {
  args: process.argv.slice(2),
  stdout: (text) => {
    process.stdout.write(text)
  },
  stderr: (text) => {
    process.stderr.write(text)
  },
  env: {
    ...process.env,
    TURNFLARE_LANG:
      process.env.TURNFLARE_LANG ?? (process.env.LANG?.startsWith('zh') ? 'zh-CN' : 'en'),
  },
  cwd: process.cwd(),
}

const result = await runCli(context, createDefaultDeps())

// 用 exitCode 而不是 process.exit()：后者在 stdout 还是管道时强制退出，
// 会把还没刷出去的缓冲一起丢掉——`turnflare stats --json | jq` 会拿到
// 截断的 JSON。设置 exitCode 后让进程自然结束，Node 会自己排空流。
// 前提是所有命令都不能留下未决的 handle（定时器、打开的 db、监听中的服务），
// 否则进程不会退。db 由各命令自行 close，serve 命令监听 SIGINT 后自行退出。
process.exitCode = result.exitCode
