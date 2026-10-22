import { t, useLocale } from '../lib/locale'
interface ErrorStateProps {
  readonly message: string
  readonly onRetry?: () => void
}

/** 错误态：中文可读原因 + 可重试。服务端细节只在服务端日志里，不泄漏到界面。 */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  useLocale()

  return (
    <div
      className="card flex flex-col items-center gap-3 px-6 py-12 text-center"
      data-testid="error-state"
      role="alert"
    >
      <p className="text-base font-medium text-ink-1">{t('出错了')}</p>
      <p className="max-w-md text-sm text-ink-2">{t(message)}</p>
      {onRetry === undefined ? null : (
        <button
          type="button"
          className="focus-ring mt-1 rounded-full border border-border-subtle px-4 py-2 text-sm font-medium text-ink-1"
          onClick={onRetry}
        >
          {t('重试')}
        </button>
      )}
    </div>
  )
}
