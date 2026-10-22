import { t } from '../lib/locale'
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryProps {
  readonly children: ReactNode
  /** 降级 UI 的标题，默认通用文案 */
  readonly title?: string
}

interface ErrorBoundaryState {
  readonly message: string | null
}

/** 把 unknown 的抛出物窄化成可展示的一句话 */
function toMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }
  return '未知错误'
}

/**
 * 渲染期错误边界。
 *
 * 项目规范禁止 console.log / console.warn，因此 componentDidCatch 不打印，
 * 只把错误信息提升到 state 让降级 UI 展示——本地优先的仪表盘里，
 * 用户自己就是最合适的日志阅读者。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { message: null }
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: toMessage(error) }
  }

  override componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    // 刻意留空：错误信息已由 getDerivedStateFromError 交给降级 UI。
    // errorInfo 保留在签名里是为了不破坏 React 的调用契约。
    void error
    void errorInfo
  }

  private handleReset = (): void => {
    this.setState({ message: null })
  }

  override render(): ReactNode {
    const { message } = this.state
    if (message === null) {
      return this.props.children
    }
    return (
      <div
        className="card mx-auto mt-10 max-w-lg px-6 py-10 text-center"
        data-testid="error-boundary"
        role="alert"
      >
        <p className="text-base font-medium text-ink-1">{this.props.title ?? t('页面崩溃了')}</p>
        <p className="mt-2 text-sm text-ink-2">{t(message)}</p>
        <button
          type="button"
          className="focus-ring mt-4 rounded-full border border-border-subtle px-4 py-2 text-sm font-medium text-ink-1"
          onClick={this.handleReset}
        >
          {t('重试')}
        </button>
      </div>
    )
  }
}
