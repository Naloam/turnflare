/**
 * DOM 查询辅助。
 *
 * 存在的原因：noUncheckedIndexedAccess 让 `getAllBy*()[i]` 的类型变成 `HTMLElement | undefined`，
 * 而项目规范禁止用 `as` 强转消掉这个 undefined。与其强转，不如让 helper 在取不到元素时
 * 直接抛错——测试里"静默拿到 undefined"比"明确失败"更难查。
 */

/** 取第 index 个元素，越界时抛出带上下文的错误 */
export function nthElement(elements: readonly HTMLElement[], index: number): HTMLElement {
  const element = elements[index]
  if (element === undefined) {
    throw new Error(`第 ${index} 个元素不存在（共 ${elements.length} 个）`)
  }
  return element
}

/** 读取某个 select 的当前值 */
export function selectValue(element: HTMLElement): string {
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error('目标不是 <select> 元素')
  }
  return element.value
}
