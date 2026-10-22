import { describe, expect, it } from 'vitest'
import { CHAIN_FILTERS, countByChain, filterTurnsByChain, readChainFilter } from './ChainFilterBar'
import { makeTurn, makeSessionDetail } from '../test/fixtures'

/** 造一条指定链条的 turn */
function turn(uuid: string, isSidechain: boolean) {
  return makeTurn({ uuid, isSidechain })
}

describe('readChainFilter', () => {
  it('识别三个合法值', () => {
    expect(readChainFilter('all')).toBe('all')
    expect(readChainFilter('main')).toBe('main')
    expect(readChainFilter('side')).toBe('side')
  })

  it.each([undefined, '', 'ALL', 'mainchain', 'side ', '0', 'true'])(
    '非法值 %j 回退 all',
    (raw) => {
      expect(readChainFilter(raw)).toBe('all')
    },
  )
})

describe('filterTurnsByChain', () => {
  const turns = [turn('a', false), turn('b', true), turn('c', false), turn('d', true)]

  it('all 原样返回', () => {
    expect(filterTurnsByChain(turns, 'all')).toHaveLength(4)
  })

  it('main 只留主链', () => {
    expect(filterTurnsByChain(turns, 'main').map((t) => t.uuid)).toEqual(['a', 'c'])
  })

  it('side 只留侧链', () => {
    expect(filterTurnsByChain(turns, 'side').map((t) => t.uuid)).toEqual(['b', 'd'])
  })

  it('空数组三种口径都返回空', () => {
    for (const filter of CHAIN_FILTERS) {
      expect(filterTurnsByChain([], filter)).toEqual([])
    }
  })

  it('全是侧链时 main 为空', () => {
    expect(filterTurnsByChain([turn('x', true)], 'main')).toEqual([])
  })
})

describe('countByChain', () => {
  it('按服务端计数直接映射', () => {
    // 传入的是服务端的 chainCounts，不是 turns 数组——见 countByChain 的注释
    const stats = countByChain({ total: 3, main: 2, side: 1 })

    expect(stats.mainCount).toBe(2)
    expect(stats.sideCount).toBe(1)
    expect(stats.mainCount + stats.sideCount).toBe(3)
  })

  it('没有侧链时 sideCount 为 0', () => {
    expect(countByChain({ total: 1, main: 1, side: 0 }).sideCount).toBe(0)
  })

  it('全零计数返回全零', () => {
    expect(countByChain({ total: 0, main: 0, side: 0 })).toEqual({
      mainCount: 0,
      sideCount: 0,
    })
  })

  it('截断场景：服务端计数不受 500 条上限影响', () => {
    // 主链 3000 条 + 侧链 27000 条，详情只返回 500 条主链。
    // 若数 turns 数组会得到 side=0，筛选器整条藏起来——服务端计数不会
    const stats = countByChain({ total: 30000, main: 3000, side: 27000 })

    expect(stats.sideCount).toBe(27000)
    expect(stats.mainCount).toBe(3000)
  })
})

describe('真实形状的会话详情', () => {
  it('makeSessionDetail 造出的详情能被筛选', () => {
    // Arrange：默认夹具是主链；手工加一条侧链
    const detail = makeSessionDetail({
      turns: [...makeSessionDetail().turns, makeTurn({ uuid: 'side-1', isSidechain: true })],
    })

    // Act / Assert
    expect(filterTurnsByChain(detail.turns, 'side').map((t) => t.uuid)).toEqual(['side-1'])
    expect(filterTurnsByChain(detail.turns, 'main')).not.toContainEqual(
      expect.objectContaining({ uuid: 'side-1' }),
    )
  })
})
