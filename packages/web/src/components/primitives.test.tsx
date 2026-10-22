import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { Badge, type BadgeTone } from './Badge'
import { StatBar } from './StatBar'

describe('EmptyState', () => {
  test('展示标题与描述', () => {
    render(<EmptyState title="没有会话数据" description="请先运行 turnflare scan" />)

    expect(screen.getByText('没有会话数据')).toBeInTheDocument()
    expect(screen.getByText('请先运行 turnflare scan')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  test('提供 action 时才渲染按钮，点击后回调', async () => {
    const onAction = vi.fn()
    render(<EmptyState title="空" actionLabel="去扫描" onAction={onAction} />)

    const button = screen.getByRole('button', { name: '去扫描' })
    await userEvent.click(button)
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  test('只有 actionLabel 没有 onAction 时不渲染按钮', () => {
    render(<EmptyState title="空" actionLabel="去扫描" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('ErrorState', () => {
  test('展示中文错误信息', () => {
    render(<ErrorState message="网络请求失败：无法连接到 API 服务" />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('网络请求失败：无法连接到 API 服务')).toBeInTheDocument()
  })

  test('提供 onRetry 时点击重试', async () => {
    const onRetry = vi.fn()
    render(<ErrorState message="炸了" onRetry={onRetry} />)

    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('Badge', () => {
  test.each<BadgeTone>(['neutral', 'accent', 'positive', 'warning', 'danger'])(
    '%s 语气都能渲染',
    (tone) => {
      render(<Badge tone={tone}>标签</Badge>)
      expect(screen.getByTestId('badge')).toHaveTextContent('标签')
    },
  )

  test('默认语气是 neutral', () => {
    render(<Badge>默认</Badge>)
    expect(screen.getByTestId('badge')).toBeInTheDocument()
  })
})

describe('StatBar', () => {
  test('按占比设置宽度', () => {
    render(<StatBar ratio={0.25} />)
    expect(screen.getByTestId('stat-bar-fill')).toHaveStyle({ width: '25%' })
    expect(screen.getByText('25.0%')).toBeInTheDocument()
  })

  test('超出 [0,1] 的比值被夹紧', () => {
    const { unmount } = render(<StatBar ratio={5} />)
    expect(screen.getByTestId('stat-bar-fill')).toHaveStyle({ width: '100%' })
    unmount()

    render(<StatBar ratio={-2} />)
    expect(screen.getByTestId('stat-bar-fill')).toHaveStyle({ width: '0%' })
  })

  test('NaN 按 0 处理而不是渲染出 NaN%', () => {
    render(<StatBar ratio={Number.NaN} />)
    expect(screen.getByText('0.0%')).toBeInTheDocument()
  })

  test('showPercent=false 时不显示百分比', () => {
    render(<StatBar ratio={0.5} showPercent={false} />)
    expect(screen.queryByText('50.0%')).not.toBeInTheDocument()
  })
})
