/**
 * 表格与 Markdown 渲染。
 *
 * 人类可读格式走 `cli-table3`，Markdown 走一张手写的管道表——两者共用同一份
 * `TableSpec`，于是"表格内容"只有一处定义，"排版"才是可替换的。
 */
import Table from 'cli-table3'

export type ColumnAlign = 'left' | 'center' | 'right'

/** 一份待渲染的表格：表头 + 数据行（单元格必须是最终字符串） */
export interface TableSpec {
  readonly head: readonly string[]
  readonly rows: readonly (readonly string[])[]
  readonly aligns?: readonly ColumnAlign[]
}

/**
 * 关掉数据行之间的横线。
 *
 * 默认样式每两行画一条分隔线，十几行的价目表会被割成碎片；只保留外框与表头
 * 下方的线，可读性最好。`style.head/border` 置空则是为了去掉 ANSI 灰字——
 * 颜色由本 CLI 的调色板统一决定，表格库不该自己上色。
 */
const COMPACT_CHARS = {
  mid: '',
  'mid-mid': '',
  'left-mid': '',
  'right-mid': '',
} as const

/** 渲染 cli-table3 终端表格 */
export function renderTable(spec: TableSpec): string {
  const table = new Table({
    head: [...spec.head],
    style: { head: [], border: [] },
    chars: COMPACT_CHARS,
    colAligns: [...(spec.aligns ?? [])],
  })
  for (const row of spec.rows) {
    table.push([...row])
  }
  return table.toString()
}

/** 渲染 GitHub 风格 Markdown 表格 */
export function renderMarkdownTable(spec: TableSpec): string {
  const header = `| ${spec.head.join(' | ')} |`
  const divider = `| ${spec.head.map(() => '---').join(' | ')} |`
  const body = spec.rows.map((row) => `| ${row.join(' | ')} |`)
  return [header, divider, ...body].join('\n')
}

/**
 * 有数据就画表，没数据就给一句人话。
 *
 * 空表格对读者没有任何信息量，还会让人以为"工具坏了"；每个命令都需要这个
 * 分支，所以收敛成一个函数。
 */
export function renderRows(
  head: readonly string[],
  rows: readonly (readonly string[])[],
  hint: string,
  aligns?: readonly ColumnAlign[],
): string {
  if (rows.length === 0) {
    return hint
  }
  return renderTable({ head, rows, ...(aligns === undefined ? {} : { aligns }) })
}
