import { describe, expect, test } from 'vitest'
import { buildSessionsQuery, SESSIONS_PAGE_SIZE } from './sessionsQuery'

describe('buildSessionsQuery', () => {
  test('默认参数全部带上', () => {
    expect(buildSessionsQuery({ page: 1, project: null, sort: 'cost', order: 'desc' })).toBe(
      `?limit=${SESSIONS_PAGE_SIZE}&page=1&sort=cost&order=desc`,
    )
  })

  test('指定项目时附加 project 参数', () => {
    const query = buildSessionsQuery({
      page: 2,
      project: 'demo',
      sort: 'tokens',
      order: 'asc',
    })
    expect(query).toContain('page=2')
    expect(query).toContain('sort=tokens')
    expect(query).toContain('order=asc')
    expect(query).toContain('project=demo')
  })

  test('项目名里的特殊字符被正确编码', () => {
    const query = buildSessionsQuery({
      page: 1,
      project: 'a b/c&d',
      sort: 'recent',
      order: 'desc',
    })
    expect(query).toContain('project=a+b%2Fc%26d')
    // 整个查询串里除了第一个 ? 不能再有裸 & 之外的歧义来源
    expect(query.split('&').length).toBe(5)
  })

  test('limit 可被覆盖', () => {
    const query = buildSessionsQuery({
      page: 1,
      project: null,
      sort: 'turns',
      order: 'asc',
      limit: 50,
    })
    expect(query).toContain('limit=50')
  })
})
