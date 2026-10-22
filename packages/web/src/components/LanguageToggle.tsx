import { getLocale, setLocale, useLocale } from '../lib/locale'

export function LanguageToggle() {
  useLocale()
  const english = getLocale() === 'en'
  return (
    <button
      type="button"
      className="focus-ring rounded-full border border-border-subtle px-3 py-1.5 text-xs text-ink-2"
      data-testid="language-toggle"
      aria-label={english ? 'Switch to Chinese' : 'Switch to English'}
      onClick={() => setLocale(english ? 'zh-CN' : 'en')}
    >
      {english ? '中文' : 'English'}
    </button>
  )
}
