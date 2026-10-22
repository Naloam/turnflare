/**
 * 合成（synthetic）模型标记的识别。
 *
 * Claude Code 会在会话里插入并非真实模型调用产生的记录（上下文压缩摘要、
 * 系统提醒、占位消息等），它们的 `message.model` 是 `<synthetic>` 之类的
 * 哨兵值而非真实模型 ID。这些记录如果混进模型分布统计，会造出一个
 * 不存在的"模型"并让饼图失真。
 *
 * 策略：合成记录的 turn 完全排除出统计（模型分布、成本、用量），
 * 因为它们不对应任何一次计费的 API 调用。放在顶层而不是某个模块内，
 * 是为了让 parser（收集 meta.models）与 stats（分组统计）共用同一份判据。
 */

/** 已知的合成模型哨兵值 */
export const SYNTHETIC_MODEL_MARKERS: readonly string[] = ['<synthetic>']

/** 该模型名是否为合成标记（大小写不敏感，前后空白忽略） */
export function isSyntheticModel(model: string | null | undefined): boolean {
  if (typeof model !== 'string') {
    return false
  }
  const normalized = model.trim().toLowerCase()
  return SYNTHETIC_MODEL_MARKERS.includes(normalized)
}

/** 从模型名集合中剔除合成标记，返回新数组（不修改入参） */
export function filterSyntheticModels(models: readonly string[]): readonly string[] {
  return models.filter((model) => !isSyntheticModel(model))
}
