/**
 * 命令声明表：选项、用法行、位置参数。
 *
 * 这一份声明同时服务三处——argv 解析、帮助文本、参数校验——所以"支持什么选项"
 * 永远只有一处真源，不存在"文档说支持、实现忘了"的漂移。
 */
import {
  DEFAULT_SERVE_PORT,
  DEFAULT_SESSION_LIMIT,
  MAX_SESSION_LIMIT,
  REPORT_FORMATS,
  SORT_KEYS,
  STATS_FORMATS,
} from './options.js'
import type { CommandName } from './options.js'

/** 单个选项的声明；帮助文本由它生成，定义与文档因此不会漂移 */
interface OptionSpec {
  /** 长名（不含 `--`） */
  readonly name: string
  readonly kind: 'flag' | 'value'
  /** 值占位名，例如 `DIR` */
  readonly valueName?: string
  readonly description: string
  /** 可重复（例如 `--project`） */
  readonly repeatable?: boolean
}

/** 位置参数的声明 */
interface ArgumentSpec {
  readonly name: string
  readonly description: string
  readonly required: boolean
}

/** 一个命令的完整声明 */
export interface CommandSpec {
  readonly name: CommandName
  readonly summary: string
  /** 用法行，例如 `turnflare scan [--root DIR]` */
  readonly usage: string
  readonly options: readonly OptionSpec[]
  readonly argument?: ArgumentSpec
}

/** 全局选项：所有命令都能用 */
export const GLOBAL_OPTIONS: readonly OptionSpec[] = [
  { name: 'json', kind: 'flag', description: '输出机器可读的 JSON' },
  { name: 'help', kind: 'flag', description: '显示帮助' },
  { name: 'version', kind: 'flag', description: '显示版本号' },
]

const SCAN_OPTIONS: readonly OptionSpec[] = [
  {
    name: 'root',
    kind: 'value',
    valueName: 'DIR',
    description: '会话根目录（默认 ~/.claude/projects）',
  },
  {
    name: 'project',
    kind: 'value',
    valueName: 'SLUG',
    description: '只扫描指定项目，可重复',
    repeatable: true,
  },
  { name: 'since', kind: 'value', valueName: 'DATE', description: '只扫描该时间之后修改的文件' },
  { name: 'force', kind: 'flag', description: '忽略增量指纹，重新解析所有文件' },
]

const STATS_OPTIONS: readonly OptionSpec[] = [
  { name: 'days', kind: 'value', valueName: 'N', description: '只统计最近 N 天（默认全量）' },
  {
    name: 'format',
    kind: 'value',
    valueName: 'FMT',
    description: `输出格式：${STATS_FORMATS.join(' | ')}`,
  },
]

const SESSIONS_OPTIONS: readonly OptionSpec[] = [
  {
    name: 'limit',
    kind: 'value',
    valueName: 'N',
    description: `展示条数（默认 ${String(DEFAULT_SESSION_LIMIT)}，上限 ${String(MAX_SESSION_LIMIT)}）`,
  },
  { name: 'project', kind: 'value', valueName: 'SLUG', description: '只显示指定项目' },
  {
    name: 'sort',
    kind: 'value',
    valueName: 'KEY',
    description: `排序键：${SORT_KEYS.join(' | ')}`,
  },
]

const REPORT_OPTIONS: readonly OptionSpec[] = [
  {
    name: 'format',
    kind: 'value',
    valueName: 'FMT',
    description: `输出格式：${REPORT_FORMATS.join(' | ')}`,
  },
  { name: 'out', kind: 'value', valueName: 'FILE', description: '写入文件而不是打印到 stdout' },
]

const SERVE_OPTIONS: readonly OptionSpec[] = [
  {
    name: 'port',
    kind: 'value',
    valueName: 'N',
    description: `监听端口（默认 ${String(DEFAULT_SERVE_PORT)}）`,
  },
]

/** 命令声明表：帮助文本与解析规则同源 */
export const COMMAND_SPECS: readonly CommandSpec[] = [
  {
    name: 'scan',
    summary: '扫描 Claude Code 会话记录并写入数据库',
    usage: 'turnflare scan [--root DIR] [--project SLUG] [--since DATE] [--force]',
    options: SCAN_OPTIONS,
  },
  {
    name: 'stats',
    summary: '终端统计报表（总览 / 模型分布 / 工具调用）',
    usage: 'turnflare stats [--days N] [--format table|markdown]',
    options: STATS_OPTIONS,
  },
  {
    name: 'sessions',
    summary: '会话列表',
    usage: 'turnflare sessions [--limit N] [--project SLUG] [--sort KEY]',
    options: SESSIONS_OPTIONS,
  },
  {
    name: 'session',
    summary: '单会话详情',
    usage: 'turnflare session <id>',
    options: [],
    argument: { name: 'id', description: '会话 ID，支持前缀匹配', required: true },
  },
  {
    name: 'report',
    summary: '导出报表（html / markdown / csv / json）',
    usage: 'turnflare report [--format FMT] [--out FILE]',
    options: REPORT_OPTIONS,
  },
  {
    name: 'models',
    summary: '模型价目表',
    usage: 'turnflare models',
    options: [],
  },
  {
    name: 'serve',
    summary: '启动 API 服务',
    usage: 'turnflare serve [--port N]',
    options: SERVE_OPTIONS,
  },
]

/** 按命令名取声明；找不到返回 undefined，由调用方决定怎么报错 */
export function findCommandSpec(name: string): CommandSpec | undefined {
  return COMMAND_SPECS.find((spec) => spec.name === name)
}
