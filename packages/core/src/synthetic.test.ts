import { describe, expect, test } from 'vitest'
import { filterSyntheticModels, isSyntheticModel, SYNTHETIC_MODEL_MARKERS } from './synthetic.js'

describe('isSyntheticModel', () => {
  test.each(['<synthetic>', ' <synthetic>', '<synthetic> ', '<SYNTHETIC>', '  <Synthetic>  '])(
    '识别哨兵值的各种写法：%j',
    (value) => {
      expect(isSyntheticModel(value)).toBe(true)
    },
  )

  test.each(['claude-opus-5-5', 'step-5-preview', '', 'synthetic', '<synthetic', 'x<synthetic>'])(
    '真实模型与近似值不算合成：%j',
    (value) => {
      expect(isSyntheticModel(value)).toBe(false)
    },
  )

  test.each<unknown>([null, undefined, 42, {}, []])('非字符串输入返回 false：%j', (value) => {
    expect(isSyntheticModel(value as string | null | undefined)).toBe(false)
  })
})

describe('filterSyntheticModels', () => {
  test('剔除哨兵值并保留顺序', () => {
    const input = ['claude-opus-5-5', '<synthetic>', 'step-5-preview', '<SYNTHETIC>']
    expect(filterSyntheticModels(input)).toEqual(['claude-opus-5-5', 'step-5-preview'])
  })

  test('不修改入参', () => {
    const input = ['<synthetic>', 'claude-opus-5-5']
    const frozen = Object.freeze([...input])
    expect(() => filterSyntheticModels(frozen)).not.toThrow()
    expect(input).toEqual(['<synthetic>', 'claude-opus-5-5'])
  })

  test('空数组返回空数组', () => {
    expect(filterSyntheticModels([])).toEqual([])
  })
})

describe('SYNTHETIC_MODEL_MARKERS', () => {
  test('哨兵值表非空', () => {
    expect(SYNTHETIC_MODEL_MARKERS.length).toBeGreaterThan(0)
  })
})
