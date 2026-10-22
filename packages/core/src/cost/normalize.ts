/**
 * 模型 ID 归一化（docs/PRICING.md §4）
 *
 * `message.model` 在 jsonl 里会带上部署形态的噪音：Bedrock 的 `anthropic.` /
 * `us.anthropic.` 前缀、Vertex 的 `_v1:0` 后缀、以及 Anthropic 的 `-YYYYMMDD`
 * 日期快照后缀。价目表以裸模型 ID 为键，所以查表前必须先剥离这些噪音。
 *
 * 纯函数：不认识的值原样返回，任何输入都不抛错。
 */

/** Vertex AI 的版本后缀 */
const VERTEX_VERSION_SUFFIX = '_v1:0'

/** Bedrock 区域前缀：`anthropic.` 与 `us.anthropic.` 两种形态 */
const BEDROCK_PREFIX_PATTERN = /^(?:us\.)?anthropic\./

/** 日期快照后缀 `-YYYYMMDD`；必须锚定结尾，否则会误伤 `claude-3-5-haiku` 这类 ID */
const DATE_SNAPSHOT_PATTERN = /-\d{8}$/

/**
 * 把原始模型 ID 归一化为价目表键名。
 *
 * @param raw - jsonl 中的 `message.model` 原值
 * @returns 归一化后的模型 ID；无法识别时原样返回，非字符串或空串时返回空串
 */
export function normalizeModelId(raw: string): string {
  // jsonl 是外部数据，运行时的 `raw` 可能是任意类型；类型签名只描述正常路径，
  // 因此这里保留运行时兜底，保证「绝不为空/非字符串时抛错」。
  if (typeof raw !== 'string') {
    return ''
  }

  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return ''
  }

  const withoutVersion = trimmed.endsWith(VERTEX_VERSION_SUFFIX)
    ? trimmed.slice(0, -VERTEX_VERSION_SUFFIX.length)
    : trimmed

  // 顺序固定：先剥部署形态（前缀/后缀），再剥日期快照，
  // 这样 `us.anthropic.claude-opus-5-5-20261001_v1:0` 也能收敛到 `claude-opus-5-5`。
  return withoutVersion.replace(BEDROCK_PREFIX_PATTERN, '').replace(DATE_SNAPSHOT_PATTERN, '')
}
