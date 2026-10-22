import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RefreshControls, REFRESH_EVENT } from './RefreshControls'

afterEach(() => {
  vi.useRealTimers()
  localStorage.removeItem('turnflare-auto-refresh')
})

it('refreshes manually, polls when enabled and stops after opting out', async () => {
  vi.useFakeTimers()
  const listener = vi.fn()
  window.addEventListener(REFRESH_EVENT, listener)
  const { unmount } = render(<RefreshControls />)
  try {
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(listener).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTime(10000))
    expect(listener).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('checkbox'))
    await act(() => vi.advanceTimersByTime(10000))
    expect(listener).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('turnflare-auto-refresh')).toBe('off')
  } finally {
    unmount()
    window.removeEventListener(REFRESH_EVENT, listener)
  }
})
