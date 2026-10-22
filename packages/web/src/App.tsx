import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import { EmptyState } from './components/EmptyState'
import { OverviewPage } from './pages/OverviewPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { SessionDetailPage } from './pages/SessionDetailPage'
import { SessionsPage } from './pages/SessionsPage'
import { useHashRoute } from './router/useHashRoute'

export interface RouteViewProps {
  readonly path: string
  readonly params: Record<string, string>
}

/**
 * 按路由表分发页面。
 *
 * default 分支在正常流程里走不到（useHashRoute 会把无法识别的 hash 重定向掉），
 * 但保留兜底：将来往 ROUTE_PATTERNS 加路由却忘了在这里配页面时，
 * 用户看到的是引导文案而不是白屏。
 */
export function RouteView({ path, params }: RouteViewProps) {
  switch (path) {
    case '/overview':
      return <OverviewPage />
    case '/sessions':
      return <SessionsPage />
    case '/sessions/:id':
      // key 绑定 id：切换会话时强制重挂载，避免上一条会话的 state 残留
      return <SessionDetailPage key={params.id ?? 'unknown'} sessionId={params.id ?? ''} />
    case '/projects':
      return <ProjectsPage />
    default:
      return (
        <EmptyState
          title="页面不存在"
          description="这个地址没有对应的页面，可以从左侧导航重新进入。"
        />
      )
  }
}

/** 应用根组件：错误边界 + 外壳 + 路由分发。 */
export function App() {
  const route = useHashRoute()

  return (
    <ErrorBoundary>
      <Layout path={route.path} navigate={route.navigate}>
        <RouteView path={route.path} params={route.params} />
      </Layout>
    </ErrorBoundary>
  )
}
