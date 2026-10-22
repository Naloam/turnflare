import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { NavLinks } from './NavLinks'
import { Pagination } from './Pagination'
import { DetailGrid } from './DetailGrid'
import { SectionCard } from './SectionCard'
import { ApiView } from './ApiView'
import type { ApiState } from '../hooks/useApi'

describe('NavLinks', () => {
  test('当前路由高亮并标注 aria-current', () => {
    render(<NavLinks activePath="/sessions" navigate={vi.fn()} />)

    const items = screen.getAllByRole('button')
    const active = items.filter((item) => item.getAttribute('aria-current') === 'page')
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveTextContent('会话')
  })

  test('详情页点亮父级"会话"', () => {
    render(<NavLinks activePath="/sessions/:id" navigate={vi.fn()} />)

    const active = screen
      .getAllByRole('button')
      .filter((item) => item.getAttribute('aria-current') === 'page')
    expect(active[0]).toHaveTextContent('会话')
  })

  test('没有匹配项时全部不高亮', () => {
    render(<NavLinks activePath="/nowhere" navigate={vi.fn()} />)
    const active = screen
      .getAllByRole('button')
      .filter((item) => item.getAttribute('aria-current') === 'page')
    expect(active).toHaveLength(0)
  })

  test('点击调用 navigate 并带上目标路径', async () => {
    const navigate = vi.fn()
    render(<NavLinks activePath="/overview" navigate={navigate} />)

    await userEvent.click(screen.getByRole('button', { name: '项目' }))
    expect(navigate).toHaveBeenCalledWith('/projects')
  })

  test('横排模式使用另一套 testid', () => {
    render(<NavLinks activePath="/overview" navigate={vi.fn()} orientation="horizontal" />)
    expect(screen.getByTestId('nav-horizontal')).toBeInTheDocument()
  })
})

describe('Pagination', () => {
  test('展示当前页码', () => {
    render(<Pagination page={3} canGoPrev canGoNext onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByText('第 3 页')).toBeInTheDocument()
  })

  test('第一页禁用上一页', () => {
    render(<Pagination page={1} canGoPrev={false} canGoNext onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled()
  })

  test('最后一页禁用下一页', () => {
    render(<Pagination page={2} canGoPrev canGoNext={false} onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  })

  test('点击翻页回调', async () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(<Pagination page={2} canGoPrev canGoNext onPrev={onPrev} onNext={onNext} />)

    await userEvent.click(screen.getByRole('button', { name: '上一页' }))
    await userEvent.click(screen.getByRole('button', { name: '下一页' }))

    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})

describe('DetailGrid', () => {
  test('每项渲染成 dt/dd 对', () => {
    render(
      <DetailGrid
        items={[
          { label: '项目', value: 'demo' },
          { label: 'Git 分支', value: 'main' },
        ]}
      />,
    )

    expect(screen.getByText('项目')).toBeInTheDocument()
    expect(screen.getByText('demo')).toBeInTheDocument()
    expect(screen.getByText('main')).toBeInTheDocument()
  })
})

describe('SectionCard', () => {
  test('渲染标题与内容', () => {
    render(
      <SectionCard title="成本趋势" description="按天聚合">
        <p>图表</p>
      </SectionCard>,
    )

    expect(screen.getByRole('heading', { name: '成本趋势' })).toBeInTheDocument()
    expect(screen.getByText('按天聚合')).toBeInTheDocument()
    expect(screen.getByText('图表')).toBeInTheDocument()
  })
})

describe('ApiView', () => {
  const loaded: ApiState<string> = {
    data: '数据',
    loading: false,
    error: null,
    status: null,
    reload: vi.fn(),
  }

  test('有数据时渲染 children', () => {
    render(
      <ApiView state={loaded} empty={<p>空</p>}>
        {(data) => <p>拿到 {data}</p>}
      </ApiView>,
    )
    expect(screen.getByText('拿到 数据')).toBeInTheDocument()
  })

  test('错误优先于空态', () => {
    render(
      <ApiView
        state={{
          data: null,
          loading: false,
          error: '请求失败（HTTP 500）',
          status: null,
          reload: vi.fn(),
        }}
        empty={<p>空</p>}
      >
        {() => <p>不该出现</p>}
      </ApiView>,
    )
    expect(screen.getByTestId('error-state')).toBeInTheDocument()
    expect(screen.queryByText('空')).not.toBeInTheDocument()
  })

  test('无数据且加载中显示骨架', () => {
    render(
      <ApiView
        state={{ data: null, loading: true, error: null, status: null, reload: vi.fn() }}
        empty={<p>空</p>}
      >
        {() => <p>不该出现</p>}
      </ApiView>,
    )
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  test('无数据且不在加载中显示空态', () => {
    render(
      <ApiView
        state={{ data: null, loading: false, error: null, status: null, reload: vi.fn() }}
        empty={<p>空</p>}
      >
        {() => <p>不该出现</p>}
      </ApiView>,
    )
    expect(screen.getByText('空')).toBeInTheDocument()
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
  })

  test('错误态的 retry 调用 reload', async () => {
    const reload = vi.fn()
    render(
      <ApiView
        state={{ data: null, loading: false, error: '炸了', status: null, reload }}
        empty={<p>空</p>}
      >
        {() => <p>不该出现</p>}
      </ApiView>,
    )

    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test('加载中但已有旧数据时继续展示旧数据', () => {
    render(
      <ApiView
        state={{ data: '旧数据', loading: true, error: null, status: null, reload: vi.fn() }}
        empty={<p>空</p>}
      >
        {(data) => <p>{data}</p>}
      </ApiView>,
    )
    expect(screen.getByText('旧数据')).toBeInTheDocument()
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
  })
})
