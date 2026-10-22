import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { getLocale, setLocale, translate, useT } from './locale'

afterEach(() => setLocale('zh-CN'))

describe('language preference', () => {
  it('translates labels and safely interpolates values', () => {
    expect(translate('en', '总成本')).toBe('Estimated cost')
    expect(translate('en', '第 {page} 页', { page: 2 })).toBe('Page 2')
    expect(translate('zh-CN', '第 {page} 页', { page: 2 })).toBe('第 2 页')
    expect(translate('en', 'custom project')).toBe('custom project')
  })

  it('updates mounted views, persists the choice and sets document language', () => {
    function Example() {
      const t = useT()
      return <p>{t('总成本')}</p>
    }
    render(<Example />)
    act(() => setLocale('en'))
    expect(screen.getByText('Estimated cost')).toBeInTheDocument()
    expect(getLocale()).toBe('en')
    expect(localStorage.getItem('turnflare-language')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    act(() => setLocale('zh-CN'))
    expect(screen.getByText('总成本')).toBeInTheDocument()
  })
})
