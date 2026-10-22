/** Localize help at the rendering seam; command specifications remain canonical. */
const EN: Readonly<Record<string, string>> = {
  '<命令>': '<command>',
  '[选项]': '[options]',
  'Claude Code 会话分析与成本统计': 'Claude Code session and cost explorer',
  '用法：': 'Usage:',
  '命令：': 'Commands:',
  '全局选项：': 'Global options:',
  '选项：': 'Options:',
  '参数：': 'Arguments:',
  '扫描 Claude Code 会话记录并写入数据库': 'Index local Claude Code sessions',
  '终端统计报表（总览 / 模型分布 / 工具调用）': 'Usage summary, models and tools',
  会话列表: 'List sessions',
  单会话详情: 'Inspect a session',
  '导出报表（html / markdown / csv / json）': 'Export HTML, Markdown, CSV or JSON',
  模型价目表: 'Show bundled model prices',
  '启动 API 服务': 'Serve the dashboard and API',
  '输出机器可读的 JSON': 'Output machine-readable JSON',
  显示帮助: 'Show help',
  显示版本号: 'Show version',
  '会话根目录（默认 ~/.claude/projects）': 'Session root (default ~/.claude/projects)',
  '只扫描指定项目，可重复': 'Only scan this project; repeatable',
  只扫描该时间之后修改的文件: 'Only scan files modified since this date',
  '忽略增量指纹，重新解析所有文件': 'Reparse files even when unchanged',
  '只统计最近 N 天（默认全量）': 'Recent window in days (default all history)',
  '输出格式：': 'Output format: ',
  '展示条数（默认 20，上限 200）': 'Number of sessions (default 20, maximum 200)',
  只显示指定项目: 'Filter by project',
  '排序键：': 'Sort key: ',
  '写入文件而不是打印到 stdout': 'Write to a file',
  '监听端口（默认 8787）': 'Listen port (default 8787)',
  '会话 ID，支持前缀匹配': 'Session ID or unambiguous prefix',
  '数据库路径默认为 ~/.turnflare/turnflare.db，可用 TURNFLARE_DB 环境变量覆盖。':
    'Local index: ~/.turnflare/turnflare.db. Override with TURNFLARE_DB.',
  ' 查看单个命令的详细用法。': ' for command-specific help.',
  ' 查看全部命令': ' to see all commands',
  ' 查看详细选项': ' for available options',
  '运行 ': 'Run ',
  '错误：': 'Error: ',
}

export function localizeHelp(text: string, language: string | undefined): string {
  if (language !== 'en') return text
  return Object.entries(EN)
    .sort(([a], [b]) => b.length - a.length)
    .reduce((result, [source, translated]) => result.replaceAll(source, translated), text)
}
