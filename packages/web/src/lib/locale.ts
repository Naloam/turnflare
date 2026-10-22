import { useSyncExternalStore } from 'react'

export type Locale = 'en' | 'zh-CN'
const STORAGE_KEY = 'turnflare-language'
const listeners = new Set<() => void>()

const EN: Readonly<Record<string, string>> = {
  本地记录: 'Local history',
  示例模式: 'Example mode',
  '使用生成的示例，不读取你的历史': 'Synthetic examples; your history stays untouched',
  选择日志目录: 'Choose history folder',
  '正在打开…': 'Opening…',
  返回本地记录: 'Back to local history',
  体验示例: 'Try examples',
  '部分文件无法读取，请检查目录权限': 'Some files could not be read. Check folder permissions.',
  '无法打开数据，请重试或选择其他目录': 'Unable to open data. Retry or choose another folder.',
  '未找到会话记录。选择顶部的日志目录，或先体验示例数据。': 'No sessions found. Choose your history folder above, or try the examples.',
  总览: 'Overview',
  会话: 'Sessions',
  项目: 'Project',
  '总 Token': 'Total tokens',
  总成本: 'Estimated cost',
  会话数: 'Sessions',
  缓存命中率: 'Cache hit rate',
  含估算价目: 'Includes pricing estimates',
  内置价目: 'Bundled API pricing',
  '缓存读取 / 总输入': 'Cache reads / total input',
  成本趋势: 'Cost over time',
  '主对话每天的 API 等价成本估算': 'Daily API-equivalent estimates for the main conversation',
  模型占比: 'Model share',
  主对话各模型的成本占比: 'Main conversation cost by model',
  '部分模型无价目数据，成本未计入': 'Some models have no pricing data; their costs are excluded',
  'subagent 活动：': 'Subagent activity:',
  '估算 · 未计入主对话统计': 'estimated · separate from main totals',
  '{0} 个 turn': '{0} turns',
  '{0} 个项目': '{0} projects',
  还没有统计数据: 'No usage yet',
  '先运行一次 turnflare scan 解析本地会话记录，再回来查看总览。':
    'Run turnflare scan to index your local sessions, then refresh this page.',
  没有会话数据: 'No sessions yet',
  '请先运行 turnflare scan 解析 ~/.claude/projects 下的会话记录。':
    'Run turnflare scan to read sessions from ~/.claude/projects.',
  还没有项目数据: 'No projects yet',
  '先运行一次 turnflare scan，项目维度才会出现统计数据。':
    'Run turnflare scan to index your projects.',
  项目成本对比: 'Project cost comparison',
  '比较各项目主对话的 API 等价成本': 'Compare API-equivalent estimates for main conversations',
  项目明细: 'Project details',
  占比: 'Share',
  模型: 'Model',
  开始时间: 'Started',
  'Turn 数': 'Turns',
  成本: 'Cost',
  操作: 'Actions',
  详情: 'Details',
  排序: 'Sort',
  全部: 'All',
  按成本: 'By cost',
  '按 Token': 'By tokens',
  按时间: 'Most recent',
  '按 Turn 数': 'By turns',
  降序: 'Descending',
  升序: 'Ascending',
  '扫描中…': 'Scanning…',
  触发扫描: 'Scan sessions',
  '扫描失败，请重试': 'Scan failed. Please try again.',
  '扫描已完成，数据已刷新': 'Scan complete. Data refreshed.',
  '项目筛选列表加载失败，仅展示「全部」': 'Project filters are unavailable. Showing all projects.',
  会话不存在: 'Session not found',
  '该会话可能已被清理，或链接中的 ID 有误。':
    'The session may have been removed, or the link contains an invalid ID.',
  会话详情为空: 'No session detail',
  '服务端没有返回该会话的 turn 记录。': 'No turns were returned for this session.',
  '← 返回会话列表': '← Back to sessions',
  工作目录: 'Working directory',
  'Git 分支': 'Git branch',
  起止时间: 'Time range',
  最后活动: 'Last activity',
  'Token 总量': 'Total tokens',
  解析错误: 'Parse errors',
  无: 'None',
  '{0} 行无法解析': '{0} lines could not be parsed',
  '{start} 起': 'Since {start}',
  'Token 瀑布图': 'Token breakdown',
  '每条 assistant turn 的输入 / 缓存读取 / 输出':
    'Input, cache reads and output per assistant turn',
  'Turn 时间线（{0}）': 'Turn timeline ({0})',
  工具调用明细: 'Tool calls',
  主对话: 'Main conversation',
  '仅 subagent': 'Subagents only',
  按对话链条筛选: 'Filter conversation chain',
  其中: 'Including ',
  '条来自 subagent，不计入上方统计': ' subagent turns, separate from main totals',
  用户: 'User',
  助手: 'Assistant',
  'fast 档': 'Fast mode',
  侧链: 'Subagent',
  工具: 'Tool',
  状态: 'Status',
  结果体积: 'Result size',
  失败: 'Failed',
  成功: 'Succeeded',
  该会话没有工具调用: 'No tool calls in this view',
  暂无模型数据: 'No model data',
  输入: 'Input',
  缓存读取: 'Cache read',
  输出: 'Output',
  '暂无 assistant token 数据': 'No assistant token data',
  分页: 'Pagination',
  上一页: 'Previous',
  下一页: 'Next',
  '第 {page} 页': 'Page {page}',
  主导航: 'Main navigation',
  '主导航（紧凑）': 'Compact navigation',
  深色: 'Dark',
  浅色: 'Light',
  正在加载数据: 'Loading data',
  '{label}加载中': 'Loading {label}',
  '{0}加载中': 'Loading {0}',
  出错了: 'Something went wrong',
  重试: 'Retry',
  未知错误: 'Unknown error',
  页面崩溃了: 'This page could not be displayed',
  页面不存在: 'Page not found',
  '这个地址没有对应的页面，可以从左侧导航重新进入。':
    'Choose a page from the navigation to continue.',
  '请求失败：服务端未返回错误信息': 'The request failed without an error message',
  '网络请求失败：无法连接到 API 服务': 'Unable to connect to the local server',
  '响应解析失败：服务端返回了非 JSON 内容': 'The server returned an unreadable response',
  '请求失败（HTTP {status}）': 'Request failed (HTTP {status})',
  刚刚: 'Just now',
  '{n} 分钟后': 'In {n} min',
  '{n} 分钟前': '{n} min ago',
  '{n} 小时后': 'In {n} hr',
  '{n} 小时前': '{n} hr ago',
  明天: 'Tomorrow',
  昨天: 'Yesterday',
  '{n} 天后': 'In {n} days',
  '{n} 天前': '{n} days ago',
  自动刷新: 'Auto refresh',
  刷新: 'Refresh',
  扫描任务已提交: 'Scan queued',
  '当前显示 {shown} / {total} 条': 'Showing {shown} of {total} turns',
}

function readLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'zh-CN') return saved
  } catch {
    /* Storage is optional. */
  }
  return navigator.language.startsWith('zh') ? 'zh-CN' : 'en'
}
let locale = readLocale()
document.documentElement.lang = locale

export function getLocale(): Locale {
  return locale
}
export function setLocale(next: Locale): void {
  locale = next
  document.documentElement.lang = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* Storage is optional. */
  }
  for (const listener of listeners) listener()
}
export function useLocale(): Locale {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, getLocale)
}
export function translate(
  language: Locale,
  message: string,
  values: Readonly<Record<string, string | number>> = {},
): string {
  const template = language === 'en' ? (EN[message] ?? message) : message
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match))
}
export function t(message: string, values?: Readonly<Record<string, string | number>>): string {
  return translate(locale, message, values)
}
export function useT(): typeof t {
  useLocale()
  return t
}
