/**
 * argv 解析（纯函数）。
 *
 * 为什么不用 commander：commander 把"解析"和"退出进程"绑在一起
 * （内部走 `process.exit`），而本 CLI 要求参数错误也走 `CommandResult`
 * 才能被测试。这里自己解析，返回值只有四种：调用 / 帮助 / 版本 / 用法错误。
 *
 * 全局选项（`--json` / `--help` / `--version`）允许出现在任何位置，
 * 因为用户不会记住"全局选项必须写在命令前面"。
 */
import {
  DEFAULT_SESSION_LIMIT,
  MAX_SESSION_LIMIT,
  REPORT_FORMATS,
  SORT_KEYS,
  STATS_FORMATS,
} from './options.js'
import type { CommandName, Invocation, ReportFormatName, SortKey, StatsFormat } from './options.js'
import { findCommandSpec } from './command-specs.js'
import type { CommandSpec } from './command-specs.js'

/**
 * 端口上界。
 *
 * 与 api 包 `readPort` 的取值范围一致（1..MAX_PORT），但**严格程度不同**，
 * 同一组输入的实测判定（cli / api）：
 *   - `0` / `-1` / `80.5` / `abc` / `65536`：两边都拒绝；
 *   - `1` / `65535`：两边都接受；
 *   - `" 80"`：cli 拒绝，api 接受为 80；
 *   - `"0x50"`：cli 拒绝，api 接受为 80；
 *   - `"1e3"`：cli 拒绝，api 接受为 1000；
 *   - `""`：cli 报"需要一个参数"，api 回退默认端口 8787。
 *
 * CLI 更严是刻意的：命令行上的端口由人手敲，十六进制、科学计数法与前后空白
 * 更可能是笔误而不是意图，现在就报错好过静默按另一个端口监听。所以这里不去
 * 迁就 api 的口径——错的是"口径一致"这句话，不是校验本身。
 */
const MAX_PORT = 65535

/** 解析结果：只有这四种可能，调用方必须逐一处理 */
export type ParseResult =
  | { readonly kind: 'invocation'; readonly invocation: Invocation }
  | { readonly kind: 'help'; readonly command: CommandName | undefined }
  | { readonly kind: 'version' }
  | {
      readonly kind: 'usage-error'
      readonly message: string
      readonly command: CommandName | undefined
    }

/** 已收集的原始选项值 */
interface RawValues {
  readonly flags: ReadonlySet<string>
  readonly values: ReadonlyMap<string, string>
  readonly lists: ReadonlyMap<string, readonly string[]>
}

/** 收集阶段的两种结局：拿到值，或者提前撞见帮助/版本/错误 */
type CollectResult =
  | {
      readonly kind: 'collected'
      readonly values: RawValues
      readonly positionals: readonly string[]
    }
  | ParseResult

/** 枚举选项的两种结局 */
type EnumResult<T extends string> =
  | { readonly ok: true; readonly value: T | undefined }
  | { readonly ok: false; readonly error: ParseResult }

/** 把 `--name=value` 拆开；没有 `=` 时内联值为 undefined */
function splitToken(token: string): { readonly name: string; readonly inline: string | undefined } {
  const body = token.startsWith('--') ? token.slice(2) : token.slice(1)
  const separator = body.indexOf('=')
  if (separator === -1) {
    return { name: body, inline: undefined }
  }
  return { name: body.slice(0, separator), inline: body.slice(separator + 1) }
}

function usageError(message: string, command: CommandName | undefined): ParseResult {
  return { kind: 'usage-error', message, command }
}

/** 逐 token 收集选项与位置参数；任何不认识的东西都变成用法错误 */
function collectTokens(spec: CommandSpec, tokens: readonly string[]): CollectResult {
  const flags = new Set<string>()
  const values = new Map<string, string>()
  const lists = new Map<string, readonly string[]>()
  const positionals: string[] = []

  let index = 0
  while (index < tokens.length) {
    const token = tokens[index] ?? ''

    // `--` 之后一律当位置参数：文件名可能以 `-` 开头
    if (token === '--') {
      positionals.push(...tokens.slice(index + 1))
      break
    }

    if (token === '-' || !token.startsWith('-')) {
      positionals.push(token)
      index += 1
      continue
    }

    const { name, inline } = splitToken(token)
    if (name === 'help' || name === 'h') {
      return { kind: 'help', command: spec.name }
    }
    if (name === 'version' || name === 'V') {
      return { kind: 'version' }
    }
    if (name === 'json') {
      flags.add('json')
      index += 1
      continue
    }

    const option = spec.options.find((candidate) => candidate.name === name)
    if (option === undefined) {
      return usageError(`未知选项：${token}`, spec.name)
    }

    if (option.kind === 'flag') {
      if (inline !== undefined) {
        return usageError(`选项 --${name} 不接受参数`, spec.name)
      }
      flags.add(name)
      index += 1
      continue
    }

    const raw = inline ?? tokens[index + 1]
    if (raw === undefined || raw === '') {
      return usageError(`选项 --${name} 需要一个参数`, spec.name)
    }
    if (option.repeatable === true) {
      const previous = lists.get(name) ?? []
      lists.set(name, [...previous, raw])
    } else {
      values.set(name, raw)
    }
    index += inline === undefined ? 2 : 1
  }

  return { kind: 'collected', values: { flags, values, lists }, positionals }
}

/** 正整数；非法返回 null，由调用方转成用法错误 */
function parsePositiveInteger(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null
  }
  const parsed = Number(raw)
  return parsed > 0 ? parsed : null
}

function parsePort(raw: string): number | null {
  const parsed = parsePositiveInteger(raw)
  return parsed !== null && parsed <= MAX_PORT ? parsed : null
}

/** 枚举选项：未传返回 undefined，非法返回一条用法错误 */
function readEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  name: string,
  command: CommandName,
): EnumResult<T> {
  if (raw === undefined) {
    return { ok: true, value: undefined }
  }
  const match = allowed.find((candidate) => candidate === raw)
  if (match === undefined) {
    return {
      ok: false,
      error: usageError(`${name} 只支持 ${allowed.join(' / ')}，当前值：${raw}`, command),
    }
  }
  return { ok: true, value: match }
}

/** 把收集到的原始值装配成具体命令的选项对象 */
function buildInvocation(
  spec: CommandSpec,
  values: RawValues,
  positionals: readonly string[],
  json: boolean,
): ParseResult {
  const valueOf = (name: string): string | undefined => values.values.get(name)
  const listOf = (name: string): readonly string[] => values.lists.get(name) ?? []

  // 位置参数个数是命令声明的一部分：models / serve 一个都不收，
  // session 只收一个。多给一个就报错，避免"以为在过滤、其实被忽略"。
  const maxPositionals = spec.argument === undefined ? 0 : 1
  if (positionals.length > maxPositionals) {
    return usageError(`多余的位置参数：${positionals[maxPositionals] ?? ''}`, spec.name)
  }

  switch (spec.name) {
    case 'scan': {
      const since = valueOf('since')
      if (since !== undefined && Number.isNaN(Date.parse(since))) {
        return usageError(`--since 不是合法的时间字符串：${since}`, spec.name)
      }
      return {
        kind: 'invocation',
        invocation: {
          command: 'scan',
          options: {
            json,
            root: valueOf('root'),
            projects: listOf('project'),
            since,
            force: values.flags.has('force'),
          },
        },
      }
    }
    case 'stats': {
      const rawDays = valueOf('days')
      let days: number | undefined
      if (rawDays !== undefined) {
        const parsed = parsePositiveInteger(rawDays)
        if (parsed === null) {
          return usageError(`--days 必须是正整数：${rawDays}`, spec.name)
        }
        days = parsed
      }
      const format = readEnum<StatsFormat>(valueOf('format'), STATS_FORMATS, '--format', spec.name)
      if (!format.ok) {
        return format.error
      }
      return {
        kind: 'invocation',
        invocation: {
          command: 'stats',
          options: { json, days, format: format.value ?? 'table' },
        },
      }
    }
    case 'sessions': {
      const rawLimit = valueOf('limit')
      let limit = DEFAULT_SESSION_LIMIT
      if (rawLimit !== undefined) {
        const parsed = parsePositiveInteger(rawLimit)
        if (parsed === null) {
          return usageError(`--limit 必须是正整数：${rawLimit}`, spec.name)
        }
        // 仓储会把超限值静默夹到 MAX_SESSION_LIMIT，所以在这里先拒绝：
        // fail fast 让用户知道上限，而不是给他一个短了一截的列表。
        if (parsed > MAX_SESSION_LIMIT) {
          return usageError(`--limit 不能超过 ${String(MAX_SESSION_LIMIT)}：${rawLimit}`, spec.name)
        }
        limit = parsed
      }
      const sort = readEnum<SortKey>(valueOf('sort'), SORT_KEYS, '--sort', spec.name)
      if (!sort.ok) {
        return sort.error
      }
      return {
        kind: 'invocation',
        invocation: {
          command: 'sessions',
          options: { json, limit, project: valueOf('project'), sort: sort.value ?? 'cost' },
        },
      }
    }
    case 'session': {
      const id = positionals[0]
      if (id === undefined || id === '') {
        return usageError('缺少参数：<id>', spec.name)
      }
      return {
        kind: 'invocation',
        invocation: { command: 'session', options: { json, id } },
      }
    }
    case 'report': {
      const format = readEnum<ReportFormatName>(
        valueOf('format'),
        REPORT_FORMATS,
        '--format',
        spec.name,
      )
      if (!format.ok) {
        return format.error
      }
      return {
        kind: 'invocation',
        invocation: {
          command: 'report',
          options: { json, format: format.value ?? 'html', out: valueOf('out') },
        },
      }
    }
    case 'models': {
      return { kind: 'invocation', invocation: { command: 'models', options: { json } } }
    }
    case 'serve': {
      const rawPort = valueOf('port')
      let port: number | undefined
      if (rawPort !== undefined) {
        const parsed = parsePort(rawPort)
        if (parsed === null) {
          return usageError(`--port 必须是 1-${String(MAX_PORT)} 的整数：${rawPort}`, spec.name)
        }
        port = parsed
      }
      return { kind: 'invocation', invocation: { command: 'serve', options: { json, port } } }
    }
  }
}

/** 全局开关：允许出现在命令之前 */
const LEADING_GLOBALS = new Set(['--json', '--help', '-h', '--version', '-V'])

/**
 * 解析完整 argv（不含 node 与脚本路径）。
 *
 * 全局开关（`--json` / `--help` / `--version`）写在命令前后都认：
 * 用户不会记住"全局选项必须放在命令后面"。
 *
 * 空参数视为用法错误：没有任何命令时打印全局用法比静默成功更有用，
 * 而"什么都没做却返回 0"会让脚本误以为成功。
 */
export function parseInvocation(args: readonly string[]): ParseResult {
  let index = 0
  while (index < args.length && LEADING_GLOBALS.has(args[index] ?? '')) {
    index += 1
  }

  // 前导的 --help / --version 必须立即生效，不能"跳过之后继续解析命令"。
  // 否则 `turnflare --help scan` 会把 --help 吞掉、真的去执行 scan——
  // 而调用方要的就是帮助，执行副作用（扫描、写库）比不给帮助糟得多。
  // 帮助优先于版本：两个同时给时，问问题的人想先看到帮助。
  if (args.slice(0, index).includes('--help') || args.slice(0, index).includes('-h')) {
    return { kind: 'help', command: undefined }
  }
  if (args.slice(0, index).includes('--version') || args.slice(0, index).includes('-V')) {
    return { kind: 'version' }
  }

  const first = args[index]
  if (first === undefined) {
    // 走到这里说明 args 整个都是前导全局开关，而 --help / --version 在上面
    // 已经返回过了（那时 index 等于 args.length，切片覆盖全部参数）。
    // 剩下的可能只有 --json 与空参数，统一按"缺少命令"处理。
    return usageError('缺少命令', undefined)
  }

  const spec = findCommandSpec(first)
  if (spec === undefined) {
    const prefix = first.startsWith('-') ? '未知选项' : '未知命令'
    return usageError(`${prefix}：${first}`, undefined)
  }

  const collected = collectTokens(spec, args.slice(index + 1))
  if (collected.kind !== 'collected') {
    return collected
  }
  // 命令前的 --json 与命令后的 --json 等价
  const json = collected.values.flags.has('json') || args.slice(0, index).includes('--json')
  return buildInvocation(spec, collected.values, collected.positionals, json)
}
