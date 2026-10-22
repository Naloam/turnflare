#!/usr/bin/env node
/** Installed command entry; launch options use environment variables. */
const command = process.argv[2]
const language = process.env.TURNFLARE_LANG ?? process.env.LANG ?? 'en'
const chinese = language.startsWith('zh')
if (command === 'demo' || command === 'start') {
  const args = process.argv.slice(3)
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(`Usage: turnflare ${command}`)
    console.log(
      command === 'demo'
        ? chinese
          ? '只读示例数据，不读取真实会话。PORT 可指定端口。'
          : 'Read-only synthetic demo. Never reads your history. Set PORT to change the port.'
        : chinese
          ? '索引本地会话并启动仪表盘。使用 PORT、TURNFLARE_DATA_ROOT、TURNFLARE_DB 和 TURNFLARE_WATCH_INTERVAL_MS 配置。'
          : 'Index local sessions and serve the dashboard. Configure with PORT, TURNFLARE_DATA_ROOT, TURNFLARE_DB and TURNFLARE_WATCH_INTERVAL_MS.',
    )
  } else if (args.length > 0) {
    console.error(`Unknown arguments. Run turnflare ${command} --help.`)
    process.exitCode = 2
  } else {
    process.argv.splice(2, 1)
    await import(command === 'demo' ? './demo.mjs' : './start.mjs')
  }
} else {
  await import('./cli.mjs')
  if (command === undefined || command === '--help' || command === '-h') {
    console.log(
      chinese
        ? '\n仪表盘：\n  turnflare demo    查看隔离示例\n  turnflare start   索引本地会话并启动仪表盘'
        : '\nDashboard:\n  turnflare demo    Explore isolated example sessions\n  turnflare start   Index local history and serve the dashboard',
    )
  }
}
