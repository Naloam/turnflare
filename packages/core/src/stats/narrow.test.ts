import { describe, expect, it } from 'vitest'
import {
  isArrayValue,
  isPlainObject,
  isPresent,
  readFiniteNumber,
  readNonEmptyString,
  readPositiveNumber,
  readString,
} from './narrow'

describe('isPlainObject', () => {
  it('accepts plain objects', () => {
    expect(isPlainObject({ a: 1 })).toBe(true)
  })

  it('rejects null because typeof null is object', () => {
    expect(isPlainObject(null)).toBe(false)
  })

  it('rejects arrays even though they are objects', () => {
    expect(isPlainObject([])).toBe(false)
  })

  it('rejects scalars', () => {
    expect(isPlainObject('text')).toBe(false)
    expect(isPlainObject(42)).toBe(false)
    expect(isPlainObject(undefined)).toBe(false)
  })
})

describe('isArrayValue', () => {
  it('accepts arrays', () => {
    expect(isArrayValue([1, 2])).toBe(true)
  })

  it('rejects non-arrays', () => {
    expect(isArrayValue({ 0: 1 })).toBe(false)
    expect(isArrayValue('abc')).toBe(false)
    expect(isArrayValue(null)).toBe(false)
  })
})

describe('isPresent', () => {
  it('rejects null and undefined', () => {
    expect(isPresent(null)).toBe(false)
    expect(isPresent(undefined)).toBe(false)
  })

  it('accepts falsy but present values', () => {
    expect(isPresent(0)).toBe(true)
    expect(isPresent('')).toBe(true)
    expect(isPresent(false)).toBe(true)
  })
})

describe('readString', () => {
  it('passes strings through', () => {
    expect(readString('claude-opus-5-5')).toBe('claude-opus-5-5')
  })

  it('falls back to empty string for non-strings', () => {
    expect(readString(42)).toBe('')
    expect(readString(null)).toBe('')
    expect(readString(undefined)).toBe('')
    expect(readString({ toString: () => 'x' })).toBe('')
  })
})

describe('readNonEmptyString', () => {
  it('returns the string when it is not empty', () => {
    expect(readNonEmptyString('uuid-1')).toBe('uuid-1')
  })

  it('returns null for empty strings and non-strings', () => {
    expect(readNonEmptyString('')).toBeNull()
    expect(readNonEmptyString(0)).toBeNull()
    expect(readNonEmptyString(null)).toBeNull()
  })
})

describe('readPositiveNumber', () => {
  it('passes finite positive numbers through', () => {
    expect(readPositiveNumber(40198)).toBe(40198)
    expect(readPositiveNumber(0.5)).toBe(0.5)
  })

  it('falls back to zero for dirty values', () => {
    expect(readPositiveNumber(Number.NaN)).toBe(0)
    expect(readPositiveNumber(Number.POSITIVE_INFINITY)).toBe(0)
    expect(readPositiveNumber(-1)).toBe(0)
    expect(readPositiveNumber('100')).toBe(0)
    expect(readPositiveNumber(null)).toBe(0)
    expect(readPositiveNumber(undefined)).toBe(0)
  })
})

describe('readFiniteNumber', () => {
  it('passes finite numbers through including zero and negatives', () => {
    expect(readFiniteNumber(0)).toBe(0)
    expect(readFiniteNumber(-480)).toBe(-480)
  })

  it('returns null for non-finite numbers and non-numbers', () => {
    expect(readFiniteNumber(Number.NaN)).toBeNull()
    expect(readFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull()
    expect(readFiniteNumber('480')).toBeNull()
    expect(readFiniteNumber(undefined)).toBeNull()
  })
})
