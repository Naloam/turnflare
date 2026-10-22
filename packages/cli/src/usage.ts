/**
 * 帮助文本。
 *
 * 全部由 `COMMAND_SPECS` 生成：新增一个选项只需要改声明表，帮助自动跟上，
 * 不存在"文档说支持、实现忘了"这种漂移。
 */
import { COMMAND_SPECS, GLOBAL_OPTIONS } from './command-specs.js'
import type { CommandSpec } from './command-specs.js'
import { COMMAND_NAMES } from './options.js'
import type { CommandName } from './options.js'

export const CLI_NAME = 'turnflare'

const INDENT = '  '

/** 命令名列宽：`  scan    扫描 Claude Code 会话记录并写入数据库` */
const COMMAND_COLUMN_WIDTH = 12

/** 标签列宽：选项行 `  --root DIR   会话根目录` 与位置参数行共用 */
const LABEL_COLUMN_WIDTH = 26

/** 选项行：`  --root DIR   会话根目录` */
function renderOption(spec: {
  readonly name: string
  readonly valueName?: string
  readonly description: string
}): string {
  const placeholder = spec.valueName === undefined ? '' : ` ${spec.valueName}`
  const label = `${INDENT}--${spec.name}${placeholder}`
  return `${label.padEnd(LABEL_COLUMN_WIDTH)}${spec.description}`
}

function renderGlobalOptions(): string {
  return ['全局选项：', ...GLOBAL_OPTIONS.map((option) => renderOption(option))].join('\n')
}

/** 全局帮助：用法 + 命令一览 + 全局选项 */
export function renderGlobalHelp(version: string): string {
  const commands = COMMAND_NAMES.map((name) => {
    const spec = findSpec(name)
    return `${INDENT}${spec.name.padEnd(COMMAND_COLUMN_WIDTH)}${spec.summary}`
  })
  return [
    `${CLI_NAME} ${version} —— Claude Code 会话分析与成本统计`,
    '',
    '用法：',
    `${INDENT}${CLI_NAME} <命令> [选项]`,
    '',
    '命令：',
    ...commands,
    '',
    renderGlobalOptions(),
    '',
    '数据库路径默认为 ~/.turnflare/turnflare.db，可用 TURNFLARE_DB 环境变量覆盖。',
    `运行 \`${CLI_NAME} <命令> --help\` 查看单个命令的详细用法。`,
  ].join('\n')
}

/** 单命令帮助：用法 + 该命令选项 + 位置参数 + 全局选项 */
export function renderCommandHelp(spec: CommandSpec, version: string): string {
  const lines: string[] = [
    `${spec.name} —— ${spec.summary}`,
    '',
    '用法：',
    `${INDENT}${spec.usage}`,
  ]

  if (spec.argument !== undefined) {
    lines.push(
      '',
      '参数：',
      `${INDENT}<${spec.argument.name}>`.padEnd(LABEL_COLUMN_WIDTH) + spec.argument.description,
    )
  }

  // 没有自有选项的命令（models）不画空的"选项："标题
  if (spec.options.length > 0) {
    lines.push('', '选项：')
    for (const option of spec.options) {
      lines.push(renderOption(option))
    }
  }

  lines.push('', renderGlobalOptions(), '', `${CLI_NAME} ${version}`)
  return lines.join('\n')
}

/** 按命令名取声明；找不到时说明命令表与名称枚举不同步，属于编程错误 */
export function findSpec(name: CommandName): CommandSpec {
  const spec = COMMAND_SPECS.find((candidate) => candidate.name === name)
  if (spec === undefined) {
    throw new Error(`命令未注册：${name}`)
  }
  return spec
}

/** 版本行 */
export function renderVersion(version: string): string {
  return `${CLI_NAME} ${version}`
}

/**
 * 用法错误块。
 *
 * 只给用法行 + 一句"去看帮助"，不把完整帮助整个倒出来：参数写错的人需要的是
 * "正确写法是什么"，不是三十行文档。
 */
export function renderUsageError(command: CommandName | undefined, message: string): string {
  const hint =
    command === undefined
      ? `运行 \`${CLI_NAME} --help\` 查看全部命令`
      : `运行 \`${CLI_NAME} ${command} --help\` 查看详细选项`
  const usage = command === undefined ? `${CLI_NAME} <命令> [选项]` : findSpec(command).usage
  return [`错误：${message}`, '', `用法：${usage}`, '', hint].join('\n')
}
