/**
 * 分发层：解析 argv → 处理帮助/版本/用法错误 → 调用命令。
 *
 * 这一层是唯一决定"退出码"与"错误写到哪"的地方：
 *   - 帮助、版本 → stdout，exit 0；
 *   - 用法错误 → stderr（含用法提示），exit 2；
 *   - 命令失败 → stderr 一句人话，exit 1；命令自己写的细节也在 stderr。
 * stdout 因此永远只承载"结果"与 `--json` 载荷，可以被安全地管道给 jq。
 */
import { parseInvocation } from './argv.js'
import { localizeHelp } from './help-language.js'
import { SUCCESS, failure } from './context.js'
import type { CliContext, CommandResult } from './context.js'
import type { Invocation } from './options.js'
import { createModelsCommand } from './commands/models.js'
import { createScanCommand } from './commands/scan.js'
import { createSessionCommand } from './commands/session.js'
import { createSessionsCommand } from './commands/sessions.js'
import { createServeCommand } from './commands/serve.js'
import { createStatsCommand } from './commands/stats.js'
import { createReportCommand } from './commands/report.js'
import type { CliDeps } from './deps.js'
import {
  findSpec,
  renderCommandHelp,
  renderGlobalHelp,
  renderUsageError,
  renderVersion,
} from './usage.js'

/** 配置读不出来时的版本兜底；只在 PORT 等配置写错时才会出现 */
const FALLBACK_VERSION = '0.1.0'

function readVersion(ctx: CliContext, deps: CliDeps): string {
  try {
    return deps.loadConfig(ctx.env).version
  } catch {
    return FALLBACK_VERSION
  }
}

/** 按命令名分发；`Invocation` 是可判别联合，options 自动窄化 */
async function dispatch(
  invocation: Invocation,
  deps: CliDeps,
  ctx: CliContext,
): Promise<CommandResult> {
  switch (invocation.command) {
    case 'scan':
      return await createScanCommand(deps).run(ctx, invocation.options)
    case 'stats':
      return await createStatsCommand(deps).run(ctx, invocation.options)
    case 'sessions':
      return await createSessionsCommand(deps).run(ctx, invocation.options)
    case 'session':
      return await createSessionCommand(deps).run(ctx, invocation.options)
    case 'report':
      return await createReportCommand(deps).run(ctx, invocation.options)
    case 'models':
      return await createModelsCommand().run(ctx, invocation.options)
    case 'serve':
      return await createServeCommand(deps).run(ctx, invocation.options)
  }
}

/** 命令失败时补一行"错误：..."；细节由命令自己提前写进 stderr */
function reportFailure(ctx: CliContext, result: CommandResult): CommandResult {
  if (result.exitCode !== 0 && result.message !== undefined) {
    ctx.stderr(`错误：${result.message}\n`)
  }
  return result
}

/** 跑一次完整的 CLI 调用；绝不自己调 process.exit */
export async function runCli(ctx: CliContext, deps: CliDeps): Promise<CommandResult> {
  const parsed = parseInvocation(ctx.args)

  switch (parsed.kind) {
    case 'help': {
      const version = readVersion(ctx, deps)
      const text =
        parsed.command === undefined
          ? renderGlobalHelp(version)
          : renderCommandHelp(findSpec(parsed.command), version)
      ctx.stdout(`${localizeHelp(text, ctx.env.TURNFLARE_LANG)}\n`)
      return SUCCESS
    }
    case 'version': {
      ctx.stdout(`${renderVersion(readVersion(ctx, deps))}\n`)
      return SUCCESS
    }
    case 'usage-error': {
      ctx.stderr(`${renderUsageError(parsed.command, parsed.message)}\n`)
      return failure(2, parsed.message)
    }
    case 'invocation': {
      const result = await dispatch(parsed.invocation, deps, ctx)
      return reportFailure(ctx, result)
    }
  }
}
