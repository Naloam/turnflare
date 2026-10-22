import { describe, expect, it } from 'vitest'
import { parseInvocation } from './argv.js'
import { DEFAULT_SERVE_PORT, DEFAULT_SESSION_LIMIT, MAX_SESSION_LIMIT } from './options.js'

/** 便捷断言：必须是 invocation 且命令匹配 */
function expectInvocation(args: readonly string[]) {
  const result = parseInvocation(args)
  if (result.kind !== 'invocation') {
    throw new Error(`期望 invocation，实际 ${result.kind}：${JSON.stringify(result)}`)
  }
  return result.invocation
}

function expectUsageError(args: readonly string[]): string {
  const result = parseInvocation(args)
  if (result.kind !== 'usage-error') {
    throw new Error(`期望 usage-error，实际 ${result.kind}`)
  }
  return result.message
}

describe('parseInvocation：成功路径', () => {
  it('解析 scan 的全部选项', () => {
    const invocation = expectInvocation([
      'scan',
      '--root',
      '/tmp/x',
      '--project',
      'alpha',
      '--project',
      'beta',
      '--since',
      '2026-10-01',
      '--force',
    ])
    expect(invocation).toEqual({
      command: 'scan',
      options: {
        json: false,
        root: '/tmp/x',
        projects: ['alpha', 'beta'],
        since: '2026-10-01',
        force: true,
      },
    })
  })

  it('scan 未给任何选项时全部落在缺省值上', () => {
    const invocation = expectInvocation(['scan'])
    expect(invocation.options).toEqual({
      json: false,
      root: undefined,
      projects: [],
      since: undefined,
      force: false,
    })
  })

  it('stats 默认 table 格式与全量窗口', () => {
    const invocation = expectInvocation(['stats'])
    expect(invocation.options).toEqual({ json: false, days: undefined, format: 'table' })
  })

  it('stats 接受 --days 与 --format', () => {
    const invocation = expectInvocation(['stats', '--days', '7', '--format', 'markdown'])
    expect(invocation.options).toEqual({ json: false, days: 7, format: 'markdown' })
  })

  it('sessions 默认 limit 与排序键', () => {
    const invocation = expectInvocation(['sessions'])
    expect(invocation.options).toEqual({
      json: false,
      limit: DEFAULT_SESSION_LIMIT,
      project: undefined,
      sort: 'cost',
    })
  })

  it('sessions 接受 --limit / --project / --sort', () => {
    const invocation = expectInvocation([
      'sessions',
      '--limit',
      '5',
      '--project',
      'alpha',
      '--sort',
      'turns',
    ])
    expect(invocation.options).toEqual({ json: false, limit: 5, project: 'alpha', sort: 'turns' })
  })

  it('session 取第一个位置参数', () => {
    const invocation = expectInvocation(['session', 'abc123'])
    expect(invocation.options).toEqual({ json: false, id: 'abc123' })
  })

  it('report 默认 html 格式', () => {
    const invocation = expectInvocation(['report'])
    expect(invocation.options).toEqual({ json: false, format: 'html', out: undefined })
  })

  it('report 接受 --format 与 --out', () => {
    const invocation = expectInvocation(['report', '--format', 'csv', '--out', '/tmp/r.csv'])
    expect(invocation.options).toEqual({ json: false, format: 'csv', out: '/tmp/r.csv' })
  })

  it('models 只带全局开关', () => {
    const invocation = expectInvocation(['models'])
    expect(invocation).toEqual({ command: 'models', options: { json: false } })
  })

  it('serve 未给端口时为 undefined，交给 api 配置决定', () => {
    const invocation = expectInvocation(['serve'])
    expect(invocation.options).toEqual({ json: false, port: undefined })
  })

  it('serve 接受 --port', () => {
    const invocation = expectInvocation(['serve', '--port', '9000'])
    expect(invocation.options).toEqual({ json: false, port: 9000 })
    expect(DEFAULT_SERVE_PORT).toBe(8787)
  })

  it('--json 可以写在命令后面', () => {
    const invocation = expectInvocation(['sessions', '--json'])
    expect(invocation.options.json).toBe(true)
  })

  it('--json 也可以写在命令前面', () => {
    const result = parseInvocation(['--json', 'models'])
    expect(result.kind).toBe('invocation')
  })

  it('支持 --name=value 形式', () => {
    const invocation = expectInvocation(['stats', '--days=3'])
    expect(invocation.options).toEqual({ json: false, days: 3, format: 'table' })
  })

  it('-- 之后的内容一律当位置参数', () => {
    const invocation = expectInvocation(['session', '--', '--weird-id'])
    expect(invocation.options).toEqual({ json: false, id: '--weird-id' })
  })
})

describe('parseInvocation：帮助与版本', () => {
  it('--help 给全局帮助', () => {
    expect(parseInvocation(['--help'])).toEqual({ kind: 'help', command: undefined })
  })

  it('-h 给全局帮助', () => {
    expect(parseInvocation(['-h'])).toEqual({ kind: 'help', command: undefined })
  })

  it('命令后的 --help 给该命令的帮助', () => {
    expect(parseInvocation(['scan', '--help'])).toEqual({ kind: 'help', command: 'scan' })
  })

  it('--version 给版本', () => {
    expect(parseInvocation(['--version'])).toEqual({ kind: 'version' })
  })

  it('-V 给版本', () => {
    expect(parseInvocation(['-V'])).toEqual({ kind: 'version' })
  })
})

describe('parseInvocation：参数错误', () => {
  it('空参数报缺少命令', () => {
    expect(expectUsageError([])).toBe('缺少命令')
  })

  it('未知命令报错并指向全局用法', () => {
    const result = parseInvocation(['frobnicate'])
    expect(result.kind).toBe('usage-error')
    if (result.kind === 'usage-error') {
      expect(result.message).toBe('未知命令：frobnicate')
      expect(result.command).toBeUndefined()
    }
  })

  it('未知选项报错', () => {
    expect(expectUsageError(['stats', '--nope'])).toBe('未知选项：--nope')
  })

  it('命令前的未知选项也报错', () => {
    expect(expectUsageError(['--nope', 'stats'])).toBe('未知选项：--nope')
  })

  it('session 缺少 id 报错', () => {
    expect(expectUsageError(['session'])).toBe('缺少参数：<id>')
  })

  it('flag 不接受参数', () => {
    expect(expectUsageError(['scan', '--force=yes'])).toBe('选项 --force 不接受参数')
  })

  it('值选项缺参数报错', () => {
    expect(expectUsageError(['scan', '--root'])).toBe('选项 --root 需要一个参数')
  })

  it('--days 必须是正整数', () => {
    expect(expectUsageError(['stats', '--days', 'abc'])).toBe('--days 必须是正整数：abc')
    expect(expectUsageError(['stats', '--days', '0'])).toBe('--days 必须是正整数：0')
    expect(expectUsageError(['stats', '--days', '-1'])).toBe('--days 必须是正整数：-1')
  })

  it('--limit 必须是正整数', () => {
    expect(expectUsageError(['sessions', '--limit', 'x'])).toBe('--limit 必须是正整数：x')
  })

  it('--limit 超过单页上限时报出上限', () => {
    expect(expectUsageError(['sessions', '--limit', '201'])).toBe('--limit 不能超过 200：201')
    expect(expectUsageError(['sessions', '--limit', '500'])).toBe('--limit 不能超过 200：500')
  })

  it('--limit 正好等于上限时仍然接受', () => {
    const invocation = expectInvocation(['sessions', '--limit', '200'])
    expect(invocation.options).toEqual({
      json: false,
      limit: MAX_SESSION_LIMIT,
      project: undefined,
      sort: 'cost',
    })
  })

  it('--port 必须落在 1-65535', () => {
    expect(expectUsageError(['serve', '--port', '70000'])).toBe(
      '--port 必须是 1-65535 的整数：70000',
    )
    expect(expectUsageError(['serve', '--port', 'abc'])).toBe('--port 必须是 1-65535 的整数：abc')
  })

  it('--format 只接受枚举内的值', () => {
    expect(expectUsageError(['stats', '--format', 'xml'])).toContain('--format 只支持')
    expect(expectUsageError(['report', '--format', 'pdf'])).toContain('--format 只支持')
  })

  it('--sort 只接受枚举内的值', () => {
    expect(expectUsageError(['sessions', '--sort', 'size'])).toContain('--sort 只支持')
  })

  it('--since 必须是合法时间串', () => {
    expect(expectUsageError(['scan', '--since', '昨天'])).toBe('--since 不是合法的时间字符串：昨天')
  })

  it('不接受多余的位置参数', () => {
    expect(expectUsageError(['models', 'extra'])).toBe('多余的位置参数：extra')
    expect(expectUsageError(['session', 'a', 'b'])).toBe('多余的位置参数：b')
  })
})

describe('命令前的全局开关', () => {
  it('--help scan 打印帮助而不是执行扫描', () => {
    const result = parseInvocation(['--help', 'scan'])
    expect(result.kind).toBe('help')
  })

  it('-h scan 同样打印帮助', () => {
    expect(parseInvocation(['-h', 'scan']).kind).toBe('help')
  })

  it('--version models 打印版本而不是价目表', () => {
    expect(parseInvocation(['--version', 'models']).kind).toBe('version')
  })

  it('-V models 同样打印版本', () => {
    expect(parseInvocation(['-V', 'models']).kind).toBe('version')
  })

  it('--json 在命令前仍然作为开关而非帮助', () => {
    const result = parseInvocation(['--json', 'models'])
    expect(result.kind).toBe('invocation')
  })

  it('--json --help 组合时帮助优先', () => {
    expect(parseInvocation(['--json', '--help', 'scan']).kind).toBe('help')
  })

  it('命令后的 --help 仍由命令自己的选项处理', () => {
    // scan --help 不是全局帮助，而是命令级用法；两者都由 help 承载
    const result = parseInvocation(['scan', '--help'])
    expect(result.kind).toBe('help')
  })
})
