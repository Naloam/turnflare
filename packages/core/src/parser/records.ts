/**
 * @turnflare/core —— 记录流与归一化
 *
 * 所有来自 jsonl 的内容都先按 `unknown` 接收，再经窄化助手函数取字段；
 * 任何畸形输入（截断行、非对象行、字段类型不对）都只降级为该行的一条
 * `ParseError`，绝不让整个文件的解析中断（ARCHITECTURE.md §1.2）。
 */

import type {
  ParseError,
  RawRecord,
  RecordType,
  TokenUsage,
  ToolInvocation,
  Turn,
} from '../types.js'
import type {
  CacheCreationSplit,
  ParseOptions,
  StreamRecordOptions,
  ToolResultInfo,
} from './types.js'
import { streamNumberedLines } from './stream.js'

/**
 * 序列化后取长度；序列化不出东西时按 0 计。
 *
 * 走一层 `stringifyOrUndefined` 是为了让返回类型明确：TS 的 lib.d.ts 把
 * `JSON.stringify(object)` 标成返回 string，但对象带 `toJSON()` 且它返回
 * undefined 时，运行时结果真的是 undefined——直接 `.length` 会抛
 * "Cannot read properties of undefined"。写在调用处会被控制流分析窄化掉，
 * 于是这个检查被报成恒真；经函数声明传递类型则不会。
 */
function stringifyLength(content: object): number {
  const serialized = stringifyOrUndefined(content)
  return serialized === undefined ? 0 : serialized.length
}

/** `JSON.stringify` 的真实返回类型（lib.d.ts 漏掉了 undefined 这一种） */
function stringifyOrUndefined(value: object): string | undefined {
  return JSON.stringify(value)
}

/** `ParseError.rawExcerpt` 的截断长度，与 types.ts 的注释保持一致 */
const RAW_EXCERPT_MAX_CHARS = 200

/** `Turn.textPreview` 默认截断长度 */
const DEFAULT_TEXT_PREVIEW_CHARS = 200

/** 计入正文预览的 block 类型：普通文本与思考过程 */
const TEXT_BLOCK_TYPES: readonly string[] = ['text', 'thinking']

/** `type` 字段的合法取值，其余一律归为 `unknown` */
const KNOWN_RECORD_TYPES: readonly RecordType[] = [
  'user',
  'assistant',
  'system',
  'attachment',
  'api-request',
  'api-request-blob',
  'api-request-shape',
  'file-history-snapshot',
  'mode',
  'permission-mode',
  'last-prompt',
  'atis-latch',
  'summary',
]

type ParseOutcome =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string }

/**
 * 逐行解析 jsonl，产出归一化后的 `RawRecord`。
 *
 * 单行解析失败时调用 `onError` 后继续下一行；不传 `onError` 则静默跳过
 * （调用方仍可通过 `parseSessionFile` 拿到的 `parseErrors` 感知）。
 */
export function* streamSessionRecords(
  filePath: string,
  options?: StreamRecordOptions,
): Generator<RawRecord, void, void> {
  const onError = options?.onError
  // 行号取自流本身的真实行号：自己另数一遍会在文件含空行时整体前移，
  // 而 lineNumber 最终要落库成 turns.line_number 供排序与定位。
  for (const { line, lineNumber } of streamNumberedLines(filePath)) {
    const outcome = parseJsonLine(line)
    if (!outcome.ok) {
      onError?.(createParseError(lineNumber, line, outcome.reason))
      continue
    }
    if (!isRecord(outcome.value)) {
      onError?.(createParseError(lineNumber, line, '记录不是 JSON 对象'))
      continue
    }
    yield {
      lineNumber,
      type: toRecordType(outcome.value['type']),
      timestamp: readString(outcome.value, 'timestamp'),
      payload: outcome.value,
    }
  }
}

/** 读计费速度档位；缺失或非法值按标准档计 */
function readSpeed(usage: Record<string, unknown> | null): 'standard' | 'fast' {
  return readString(usage, 'speed') === 'fast' ? 'fast' : 'standard'
}

/**
 * 把 `message.usage` 归一化为 `TokenUsage`。
 *
 * 字段缺失或不是有限数字时补 0；已经是有限数字则原样透出（不裁剪负值，
 * 以免掩盖上游数据问题）。嵌套的 `output_tokens_details` 与
 * `server_tool_use` 同样按未知数据处理。
 */
export function normalizeUsage(raw: unknown): TokenUsage {
  const usage = isRecord(raw) ? raw : null
  const details = readRecord(usage, 'output_tokens_details')
  const serverToolUse = readRecord(usage, 'server_tool_use')
  return {
    // speed 缺失时按标准档：旧版本记录没有这个字段，而"没有标记"不等于 fast
    speed: readSpeed(usage),
    inputTokens: readCount(usage, 'input_tokens'),
    cacheCreationTokens: readCount(usage, 'cache_creation_input_tokens'),
    cacheReadTokens: readCount(usage, 'cache_read_input_tokens'),
    outputTokens: readCount(usage, 'output_tokens'),
    thinkingTokens: readCount(details, 'thinking_tokens'),
    serverToolUse:
      readCount(serverToolUse, 'web_search_requests') +
      readCount(serverToolUse, 'web_fetch_requests'),
  }
}

/**
 * 拆出缓存写入的 TTL 分布，供成本模块对 1 小时 / 5 分钟缓存分别计价。
 * `cache_creation` 整体缺失时两项均为 0。
 *
 * **已知边界**：这个分项没有办法随 `Turn` 传递（`TokenUsage` 契约里没有它的位置），
 * 而产品链路是 解析 → Turn → aggregate → costOf，所以 `costOfWithSplit` 的 split
 * 参数在真实链路上拿不到值，缓存写一律按 5m 价计。1h 缓存写的单价是 5m 的 1.6 倍
 * （输入价 ×2.0 vs ×1.25），因此存在 1h 缓存写时成本会被低估。
 *
 * 实测 17552 条 assistant 记录，`cache_creation_input_tokens` 总量为 0
 * （Claude Code 走的是另一套缓存机制），所以这个偏差当前不可观测。
 * 没有为此扩充 `TokenUsage` 契约：需要修改共享契约并增加 schema 迁移，
 * 而收益要等遥测数据里真的出现 1h 缓存写才兑现。真出现时按同样的路子补即可。
 */
export function extractCacheCreationSplit(raw: unknown): CacheCreationSplit {
  const cacheCreation = readRecord(isRecord(raw) ? raw : null, 'cache_creation')
  return {
    ephemeral1h: readCount(cacheCreation, 'ephemeral_1h_input_tokens'),
    ephemeral5m: readCount(cacheCreation, 'ephemeral_5m_input_tokens'),
  }
}

/**
 * 从 user 记录的 `message.content` 中提取全部 tool_result。
 *
 * `content` 既可能是字符串也可能是 block 数组（ARCHITECTURE.md §1.2 坑 3），
 * 统一折算为字符数；`is_error` 缺失时视为 false。
 */
export function extractToolResults(record: RawRecord): readonly ToolResultInfo[] {
  const results: ToolResultInfo[] = []
  for (const block of readMessageBlocks(record)) {
    if (!isRecord(block) || block['type'] !== 'tool_result') {
      continue
    }
    const toolUseId = readString(block, 'tool_use_id')
    if (toolUseId === null) {
      continue
    }
    results.push({
      toolUseId,
      isError: block['is_error'] === true,
      resultBytes: measureResultBytes(block['content']),
    })
  }
  return results
}

/**
 * 从 assistant 记录的 `message.content` 中提取全部 tool_use。
 *
 * `isError` 与 `resultBytes` 需要配对的 tool_result 才能确定，而配对结果
 * 往往出现在后续的 user 记录里；单记录视角下只在本记录内配对，
 * 跨记录配对由 `extractTurns` 完成（无配对时 `isError` 为 false、`resultBytes` 为 0）。
 */
export function extractTools(record: RawRecord): readonly ToolInvocation[] {
  return buildToolInvocations(record, collectResultsFromRecord(record))
}

/**
 * 把 user / assistant 记录归一化为 `Turn`。
 *
 * 跨记录配对：先扫一遍全部记录收集 tool_result，再生成 assistant 的
 * tool 调用列表，这样 `Turn.tools` 才带得上真实的错误标记与结果体积。
 * `role` 不是 user/assistant（或没有 message）的记录直接跳过。
 */
export function extractTurns(
  records: readonly RawRecord[],
  options?: ParseOptions,
): readonly Turn[] {
  const maxPreviewChars = options?.maxTextPreviewChars ?? DEFAULT_TEXT_PREVIEW_CHARS
  const resultsById = collectToolResultsById(records)
  const turns: Turn[] = []
  for (const record of records) {
    const turn = toTurn(record, resultsById, maxPreviewChars)
    if (turn !== null) {
      turns.push(turn)
    }
  }
  return turns
}

function buildToolInvocations(
  record: RawRecord,
  resultsById: ReadonlyMap<string, ToolResultInfo>,
): readonly ToolInvocation[] {
  const invocations: ToolInvocation[] = []
  for (const block of readMessageBlocks(record)) {
    if (!isRecord(block) || block['type'] !== 'tool_use') {
      continue
    }
    const toolName = readString(block, 'name')
    const toolUseId = readString(block, 'id')
    if (toolName === null || toolUseId === null) {
      continue
    }
    const paired = resultsById.get(toolUseId)
    invocations.push({
      toolName,
      toolUseId,
      isError: paired?.isError ?? false,
      resultBytes: paired?.resultBytes ?? 0,
    })
  }
  return invocations
}

function toTurn(
  record: RawRecord,
  resultsById: ReadonlyMap<string, ToolResultInfo>,
  maxPreviewChars: number,
): Turn | null {
  if (record.type !== 'user' && record.type !== 'assistant') {
    return null
  }
  const payload = isRecord(record.payload) ? record.payload : null
  const message = readRecord(payload, 'message')
  const role = readString(message, 'role')
  if (role !== 'user' && role !== 'assistant') {
    return null
  }
  return {
    uuid: readString(payload, 'uuid') ?? '',
    parentUuid: readString(payload, 'parentUuid'),
    role,
    timestamp: record.timestamp ?? '',
    model: readString(message, 'model'),
    usage: hasKey(message, 'usage') ? normalizeUsage(message?.['usage']) : null,
    tools: role === 'assistant' ? buildToolInvocations(record, resultsById) : [],
    textPreview: buildTextPreview(message, maxPreviewChars),
    isSidechain: payload?.['isSidechain'] === true,
    lineNumber: record.lineNumber,
  }
}

function collectResultsFromRecord(record: RawRecord): ReadonlyMap<string, ToolResultInfo> {
  const byId = new Map<string, ToolResultInfo>()
  for (const result of extractToolResults(record)) {
    if (!byId.has(result.toolUseId)) {
      byId.set(result.toolUseId, result)
    }
  }
  return byId
}

function collectToolResultsById(
  records: readonly RawRecord[],
): ReadonlyMap<string, ToolResultInfo> {
  const byId = new Map<string, ToolResultInfo>()
  for (const record of records) {
    for (const result of extractToolResults(record)) {
      // 重复 uuid 的消息可能带来重复的 tool_result，保留首次出现的那条
      if (!byId.has(result.toolUseId)) {
        byId.set(result.toolUseId, result)
      }
    }
  }
  return byId
}

function buildTextPreview(message: Record<string, unknown> | null, maxChars: number): string {
  const content = message?.['content']
  const texts = typeof content === 'string' ? [content] : collectBlockTexts(content)
  return texts.join('\n').slice(0, maxChars)
}

function collectBlockTexts(content: unknown): readonly string[] {
  if (!Array.isArray(content)) {
    return []
  }
  const texts: string[] = []
  for (const block of content) {
    if (!isRecord(block)) {
      continue
    }
    const blockType = block['type']
    if (typeof blockType !== 'string' || !TEXT_BLOCK_TYPES.includes(blockType)) {
      continue
    }
    const text = block[blockType]
    if (typeof text === 'string') {
      texts.push(text)
    }
  }
  return texts
}

/**
 * 估算 tool_result 内容的体积（字符数）。
 *
 * 字符串直接取长度（再包一层 JSON.stringify 会把引号也算进去，与"内容体积"
 * 的直觉不符）；数组 / 对象取 `JSON.stringify` 长度；标量与 null 取 0 或字面量长度。
 *
 * `JSON.stringify` 对**深度嵌套**的对象会抛 RangeError（调用栈溢出）——jsonl 里
 * 真出现过几千层嵌套的 content。体积只是展示用的统计数字，为它让整场会话解析
 * 失败太不值，所以序列化失败时按 0 计。
 *
 * 按 0 而不是塞一个哨兵值：这个数字会累加进 ToolStats.totalResultBytes，
 * 一个负数会让总和失去意义；而"序列化不出来"本身是极端情况，宁可少算
 * 也不要把脏值传导到汇总层。
 */
function measureResultBytes(content: unknown): number {
  if (typeof content === 'string') {
    return content.length
  }
  if (content === null || content === undefined) {
    return 0
  }
  if (typeof content === 'number' || typeof content === 'boolean') {
    return String(content).length
  }
  try {
    return stringifyLength(content)
  } catch {
    return 0
  }
}

function readMessageBlocks(record: RawRecord): readonly unknown[] {
  const payload = isRecord(record.payload) ? record.payload : null
  const message = readRecord(payload, 'message')
  return readArray(message, 'content') ?? []
}

function parseJsonLine(line: string): ParseOutcome {
  try {
    return { ok: true, value: JSON.parse(line) }
  } catch (error: unknown) {
    return { ok: false, reason: error instanceof Error ? error.message : '未知解析错误' }
  }
}

function createParseError(lineNumber: number, raw: string, reason: string): ParseError {
  return {
    lineNumber,
    message: `第 ${lineNumber} 行解析失败：${reason}`,
    rawExcerpt: raw.slice(0, RAW_EXCERPT_MAX_CHARS),
  }
}

function toRecordType(value: unknown): RecordType {
  if (typeof value !== 'string') {
    return 'unknown'
  }
  return KNOWN_RECORD_TYPES.find((known) => known === value) ?? 'unknown'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasKey(source: Record<string, unknown> | null, key: string): boolean {
  return source !== null && key in source
}

function readRecord(
  source: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  const value = source?.[key]
  return isRecord(value) ? value : null
}

function readArray(source: Record<string, unknown> | null, key: string): readonly unknown[] | null {
  const value = source?.[key]
  return Array.isArray(value) ? value : null
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' ? value : null
}

function readCount(source: Record<string, unknown> | null, key: string): number {
  const value = source?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
