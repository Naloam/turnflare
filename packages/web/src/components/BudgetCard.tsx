import { useState } from 'react'
import { formatCost, formatPercent } from '../lib/format'
import { t, useLocale } from '../lib/locale'
import { CONTROL_CLASS } from './UsageFilters'

const KEY = 'turnflare-range-budget'
function readBudget(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

/** A personal budget for the selected cohort, never an official plan limit. */
export function BudgetCard({ cost }: { readonly cost: number }) {
  useLocale()
  const [value, setValue] = useState(readBudget)
  const amount = Number(value)
  const valid = Number.isFinite(amount) && amount > 0
  const ratio = valid ? cost / amount : 0
  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="grid gap-1 text-sm text-ink-2">
        {t('所选范围预算（USD）')}
        <input
          className={CONTROL_CLASS}
          type="number"
          min="0.01"
          step="0.01"
          placeholder="100"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            try {
              localStorage.setItem(KEY, e.target.value)
            } catch {
              /* Optional storage. */
            }
          }}
        />
      </label>
      <div className="min-w-48 flex-1">
        <p className="mb-2 text-sm text-ink-1">
          {valid
            ? `${formatCost(cost)} / ${formatCost(amount)} · ${formatPercent(ratio)}`
            : t('设置预算后显示进度')}
        </p>
        <progress
          className="h-2 w-full accent-accent"
          max={100}
          value={Math.min(100, ratio * 100)}
          aria-label={t('预算使用进度')}
        />
        {valid && ratio >= 0.8 ? (
          <p role="status" className="mt-2 text-sm text-warning">
            {t(
              ratio >= 1
                ? '已超出自设预算'
                : ratio >= 0.95
                  ? '即将达到自设预算'
                  : '已使用 80% 预算',
            )}
          </p>
        ) : null}
      </div>
      <p className="w-full text-xs text-ink-3">
        {t('预算保存在本机，按当前筛选范围计算 API 等价成本；不是订阅账单或官方额度。')}
      </p>
    </div>
  )
}
