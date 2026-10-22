import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { KpiCard } from './KpiCard'
import { Loading } from './Loading'

describe('KpiCard', () => {
  test('正常态展示标签与已格式化的值', () => {
    render(<KpiCard label="总成本" value="$12.50" hint="精确价目" />)

    expect(screen.getByText('总成本')).toBeInTheDocument()
    expect(screen.getByText('$12.50')).toBeInTheDocument()
    expect(screen.getByText('精确价目')).toBeInTheDocument()
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
  })

  test('加载态显示骨架且不显示数值', () => {
    render(<KpiCard label="总 Token" value="40.2K" loading />)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
    expect(screen.queryByText('40.2K')).not.toBeInTheDocument()
  })

  test('错误态展示错误文案而不是数值', () => {
    render(<KpiCard label="会话数" value="3" error="请求失败（HTTP 500）" />)

    expect(screen.getByText('请求失败（HTTP 500）')).toBeInTheDocument()
    expect(screen.queryByText('3')).not.toBeInTheDocument()
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
  })

  test('加载态优先于错误态', () => {
    render(<KpiCard label="缓存命中率" value="42.4%" loading error="请求失败" />)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
    expect(screen.queryByText('请求失败')).not.toBeInTheDocument()
  })

  test('没有 hint 时不渲染副标题节点', () => {
    render(<KpiCard label="总 Token" value="1K" />)
    expect(screen.getByTestId('kpi-card').textContent).toBe('总 Token1K')
  })
})

describe('Loading', () => {
  test('默认三行骨架', () => {
    render(<Loading />)
    const skeleton = screen.getByTestId('loading')
    expect(skeleton.querySelectorAll('div')).toHaveLength(3)
  })

  test('行数可配置', () => {
    render(<Loading rows={1} />)
    expect(screen.getByTestId('loading').querySelectorAll('div')).toHaveLength(1)
  })

  test('暴露给读屏软件的状态语义', () => {
    render(<Loading label="正在加载会话" />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('正在加载会话')
  })
})
