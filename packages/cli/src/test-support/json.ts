/**
 * 测试替身：JSON 输出的解析与读取。
 *
 * `JSON.parse` 的返回类型是 `any`，让它在每个测试文件里四处扩散会污染类型。
 * 这里收敛成一处：先按 `unknown` 接住，确认是对象后才交给断言；字段一律经过
 * 带类型的读取助手，于是"输出少了这个字段"会得到一句清楚的失败信息，
 * 而不是 `Cannot read properties of undefined`。
 *
 * 与 `src/api-types.ts` 一样，这个目录会被 tsconfig 一并编译进 dist，
 * 运行时没有任何生产路径引用它。
 */

/** 解析 JSON 并确认是对象；不是对象就说明命令输出格式坏了 */
export function parseJsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`输出不是 JSON 对象：${text.slice(0, 120)}`)
  }
  // 走到这里已经确认是普通对象；转成字典只是为了给调用方一个可读的键类型
  return parsed as Record<string, unknown>
}

function requireField(payload: Record<string, unknown>, key: string): unknown {
  if (!(key in payload)) {
    throw new Error(`输出缺少字段：${key}（实际字段：${Object.keys(payload).join(', ')}）`)
  }
  return payload[key]
}

/** 读字符串字段 */
export function readStringField(payload: Record<string, unknown>, key: string): string {
  const value = requireField(payload, key)
  if (typeof value !== 'string') {
    throw new Error(`字段 ${key} 不是字符串：${String(value)}`)
  }
  return value
}

/** 读数字字段 */
export function readNumberField(payload: Record<string, unknown>, key: string): number {
  const value = requireField(payload, key)
  if (typeof value !== 'number') {
    throw new Error(`字段 ${key} 不是数字：${String(value)}`)
  }
  return value
}

/** 读数组字段 */
export function readArrayField(payload: Record<string, unknown>, key: string): readonly unknown[] {
  const value = requireField(payload, key)
  if (!Array.isArray(value)) {
    throw new Error(`字段 ${key} 不是数组：${String(value)}`)
  }
  return value
}

/** 读对象数组字段；元素不是对象就说明输出结构坏了 */
export function readRecordArray(
  payload: Record<string, unknown>,
  key: string,
): readonly Record<string, unknown>[] {
  const value = requireField(payload, key)
  if (!Array.isArray(value)) {
    throw new Error(`字段 ${key} 不是数组：${String(value)}`)
  }
  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`字段 ${key} 里有不是对象的元素：${String(entry)}`)
    }
    return entry as Record<string, unknown>
  })
}

/** 读嵌套对象字段 */
export function readObjectField(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = requireField(payload, key)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`字段 ${key} 不是对象：${String(value)}`)
  }
  return value as Record<string, unknown>
}
