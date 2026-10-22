import { useEffect, useState } from 'react'
import type { DesktopState } from '@turnflare/contracts'
import { desktopBridge } from '../lib/desktop'
import { useT } from '../lib/locale'

/** Native capabilities are optional; the same dashboard still works in an ordinary browser. */
export function DesktopControls() {
  const t = useT()
  const bridge = desktopBridge()
  const [state, setState] = useState<DesktopState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!bridge) return
    void bridge
      .getState()
      .then(setState)
      .catch(() => setError(true))
  }, [bridge])
  if (!bridge) return null
  const run = (action: () => Promise<void>): void => {
    setBusy(true)
    setError(false)
    void action()
      .catch(() => setError(true))
      .finally(() => setBusy(false))
  }
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface-1 px-4 py-3 text-xs"
      data-testid="desktop-controls"
    >
      <span className="font-medium text-accent">
        {t(state?.mode === 'demo' ? '示例模式' : '本地记录')}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink-3" title={state?.dataRoot}>
        {state?.mode === 'demo' ? t('使用生成的示例，不读取你的历史') : state?.dataRoot}
      </span>
      <button
        className="focus-ring rounded-full border border-border-subtle px-3 py-1.5 text-ink-1"
        type="button"
        disabled={busy}
        onClick={() => run(() => bridge.chooseFolder())}
      >
        {t(busy ? '正在打开…' : '选择日志目录')}
      </button>
      <button
        className="focus-ring rounded-full border border-border-subtle px-3 py-1.5 text-ink-2"
        type="button"
        disabled={busy}
        onClick={() => run(() => (state?.mode === 'demo' ? bridge.showLocal() : bridge.showDemo()))}
      >
        {t(state?.mode === 'demo' ? '返回本地记录' : '体验示例')}
      </button>
      {state && state.failedFiles > 0 ? (
        <span className="text-warning">{t('部分文件无法读取，请检查目录权限')}</span>
      ) : null}
      {error ? (
        <span role="alert" className="text-danger">
          {t('无法打开数据，请重试或选择其他目录')}
        </span>
      ) : null}
    </div>
  )
}
