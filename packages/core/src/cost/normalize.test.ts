import { describe, expect, it } from 'vitest'
import { normalizeModelId } from './normalize'

describe('normalizeModelId', () => {
  it('strips the -YYYYMMDD date snapshot suffix', () => {
    expect(normalizeModelId('claude-opus-5-5-20261001')).toBe('claude-opus-5-5')
  })

  it('strips the date snapshot suffix from a non-priced model id', () => {
    expect(normalizeModelId('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5')
  })

  it('strips the Bedrock anthropic. prefix', () => {
    expect(normalizeModelId('anthropic.claude-opus-5-5')).toBe('claude-opus-5-5')
  })

  it('strips the Bedrock us.anthropic. prefix', () => {
    expect(normalizeModelId('us.anthropic.claude-opus-5-5')).toBe('claude-opus-5-5')
  })

  it('strips the Vertex _v1:0 suffix', () => {
    expect(normalizeModelId('claude-opus-5-5_v1:0')).toBe('claude-opus-5-5')
  })

  it('strips prefix, vertex suffix and date suffix together', () => {
    expect(normalizeModelId('us.anthropic.claude-opus-5-5-20261001_v1:0')).toBe('claude-opus-5-5')
  })

  it('returns an empty string for an empty model id', () => {
    expect(normalizeModelId('')).toBe('')
  })

  it('returns an empty string for a whitespace-only model id', () => {
    expect(normalizeModelId('   ')).toBe('')
  })

  it('returns unknown model ids unchanged', () => {
    expect(normalizeModelId('step-5-preview')).toBe('step-5-preview')
  })

  it('keeps model ids that merely end with digits', () => {
    expect(normalizeModelId('claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(normalizeModelId('gpt-4o-2024-11-20')).toBe('gpt-4o-2024-11-20')
    expect(normalizeModelId('claude-3-5-haiku-2024102')).toBe('claude-3-5-haiku-2024102')
  })

  it('strips a date snapshot suffix that follows a stripped prefix', () => {
    expect(normalizeModelId('anthropic.claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
  })

  it('returns an empty string when the raw value is not a string', () => {
    // Arrange: jsonl 反序列化出来的脏值，运行时是 number 而类型签名只描述正常路径
    const notAString = JSON.parse('42')

    // Act
    const result = normalizeModelId(notAString)

    // Assert
    expect(result).toBe('')
  })

  it('is idempotent for already normalized ids', () => {
    const once = normalizeModelId('us.anthropic.claude-opus-5-5-20261001_v1:0')

    expect(normalizeModelId(once)).toBe(once)
  })
})
