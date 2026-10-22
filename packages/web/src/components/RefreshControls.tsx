import { useEffect, useState } from 'react'
import { useT } from '../lib/locale'

export const REFRESH_EVENT = 'turnflare:refresh'
export function refreshViews(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT))
}

export function RefreshControls() {
  const t = useT()
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem('turnflare-auto-refresh') !== 'off'
    } catch {
      return true
    }
  })
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshViews()
    }, 10000)
    return () => clearInterval(timer)
  }, [enabled])
  return (
    <div className="flex items-center gap-2 text-xs text-ink-2">
      <button
        className="focus-ring rounded-full border border-border-subtle px-3 py-1.5"
        type="button"
        onClick={refreshViews}
      >
        {t('刷新')}
      </button>
      <label className="hidden items-center gap-1 sm:flex">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked)
            try {
              localStorage.setItem('turnflare-auto-refresh', event.target.checked ? 'on' : 'off')
            } catch {
              /* Storage is optional. */
            }
          }}
        />
        {t('自动刷新')}
      </label>
    </div>
  )
}
