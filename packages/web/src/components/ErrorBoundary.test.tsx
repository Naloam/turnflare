import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

/** 渲染期必炸的组件，用来验证错误边界真的能接住 */
function Boom(): React.ReactNode {
  throw new Error('渲染炸了')
}

function ToggleBoom(): React.ReactNode {
  const [shouldThrow, setShouldThrow] = useState(false)
  if (shouldThrow) {
    throw new Error('点了之后才炸')
  }
  return (
    <button type="button" onClick={() => setShouldThrow(true)}>
      引爆
    </button>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  test('正常渲染子内容', () => {
    render(
      <ErrorBoundary>
        <p>正常内容</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('正常内容')).toBeInTheDocument()
    expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument()
  })

  test('捕获渲染错误并展示中文降级 UI', () => {
    // React 会把捕获到的错误打到 console.error，这是库自身行为；
    // 这里静默掉只是为了让测试输出干净，不代表生产代码里可以 console.log。
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByTestId('error-boundary')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('页面崩溃了')).toBeInTheDocument()
    expect(screen.getByText('渲染炸了')).toBeInTheDocument()
    errorSpy.mockRestore()
  })

  test('自定义标题生效', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary title="图表渲染失败">
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText('图表渲染失败')).toBeInTheDocument()
    errorSpy.mockRestore()
  })

  test('抛出非 Error 值时也有兜底文案', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function ThrowString(): React.ReactNode {
      throw 'plain string'
    }

    render(
      <ErrorBoundary>
        <ThrowString />
      </ErrorBoundary>,
    )

    expect(screen.getByText('未知错误')).toBeInTheDocument()
    errorSpy.mockRestore()
  })

  test('点击重试后重新挂载子内容', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <ToggleBoom />
      </ErrorBoundary>,
    )

    await userEvent.click(screen.getByRole('button', { name: '引爆' }))
    expect(screen.getByTestId('error-boundary')).toBeInTheDocument()

    // 重试会卸载出错子树并按初始 state 重新挂载，因此按钮回来了（而不是再炸一次）
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '引爆' })).toBeInTheDocument()
    errorSpy.mockRestore()
  })
})
