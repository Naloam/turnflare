/**
 * @turnflare/contracts —— 共享领域类型（唯一真源）
 *
 * 所有包共享此处定义；本模块没有运行时实现或 Node.js 依赖。
 * 修改本文件属于破坏性变更，必须同步更新所有消费方。
 */

/** 单次模型调用的 token 用量，字段与 Anthropic `usage` 对象一一对应 */
export interface TokenUsage {
  /**
   * 计费速度档位，对应 jsonl 的 `usage.speed`。
   *
   * 必须随用量一起携带：fast 档的输入/输出单价约为标准档 2 倍，丢掉这个字段
   * 就等于把所有 fast 请求按标准价计——实测一笔 100 万输入 token 的请求，
   * 标准价 $4.02、fast 价 $8.04，低估一半。
   */
  readonly speed: 'standard' | 'fast'
  /** 未命中缓存的输入 token */
  readonly inputTokens: number
  /** 写入缓存的输入 token（cache_creation_input_tokens） */
  readonly cacheCreationTokens: number
  /** 命中缓存的输入 token（cache_read_input_tokens） */
  readonly cacheReadTokens: number
  /** 输出 token 总数 */
  readonly outputTokens: number
  /** 其中用于思考的 token */
  readonly thinkingTokens: number
  /** 服务端工具调用次数（web_search / web_fetch） */
  readonly serverToolUse: number
}

/** jsonl 中出现的记录类型（`type` 字段） */
export type RecordType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'attachment'
  | 'api-request'
  | 'api-request-blob'
  | 'api-request-shape'
  | 'file-history-snapshot'
  | 'mode'
  | 'permission-mode'
  | 'last-prompt'
  | 'atis-latch'
  | 'summary'
  | 'unknown'

/** 一次工具调用（从 assistant content block 中提取） */
export interface ToolInvocation {
  readonly toolName: string
  readonly toolUseId: string
  readonly isError: boolean
  /** 工具结果体积（字符数），用于判断"重"工具 */
  readonly resultBytes: number
}

/** 一轮对话（一条 user 或 assistant 记录归一化后的形态） */
export interface Turn {
  readonly uuid: string
  readonly parentUuid: string | null
  readonly role: 'user' | 'assistant'
  readonly timestamp: string
  readonly model: string | null
  readonly usage: TokenUsage | null
  readonly tools: readonly ToolInvocation[]
  /** 正文前 200 字符，用于列表展示 */
  readonly textPreview: string
  /** 是否为 subagent 侧链 */
  readonly isSidechain: boolean
  /** 本条记录的原始 jsonl 行号（从 1 开始） */
  readonly lineNumber: number
}

/** 解析时遇到的错误 */
export interface ParseError {
  readonly lineNumber: number
  readonly message: string
  /** 截断到 200 字符的原始内容 */
  readonly rawExcerpt: string
}

/** 一条原始记录的轻量封装 */
export interface RawRecord {
  readonly lineNumber: number
  readonly type: RecordType
  readonly timestamp: string | null
  readonly payload: unknown
}

/** 会话元信息 */
export interface SessionMeta {
  readonly sessionId: string
  readonly filePath: string
  /** 项目目录 slug，如 `-Users-che1sy-Projects-foo` */
  readonly projectSlug: string
  readonly cwd: string | null
  readonly gitBranch: string | null
  readonly cliVersion: string | null
  readonly startedAt: string | null
  readonly endedAt: string | null
  /** 会话中出现的模型集合 */
  readonly models: readonly string[]
}

/** 一个完整解析后的会话 */
export interface Session {
  readonly meta: SessionMeta
  readonly turns: readonly Turn[]
  readonly records: readonly RawRecord[]
  readonly parseErrors: readonly ParseError[]
}

/** 成本明细（美元） */
export interface CostBreakdown {
  readonly inputCost: number
  readonly outputCost: number
  readonly cacheWriteCost: number
  readonly cacheReadCost: number
  readonly totalCost: number
  readonly currency: 'USD'
  /** 该模型无价目数据：成本计 0，绝不按其他模型价格猜测 */
  readonly unpricedModel: boolean
  /** 是否使用了估算（fast 价缺失、缓存写未拆分、分项与总量不符等） */
  readonly isEstimated: boolean
}

/** 模型单价（美元 / 百万 token） */
export interface ModelPricing {
  readonly input: number
  readonly output: number
  readonly cacheWrite: number
  readonly cacheRead: number
}

/** 单个模型的聚合统计 */
export interface ModelStats {
  readonly model: string
  readonly requestCount: number
  readonly usage: TokenUsage
  readonly cost: CostBreakdown
}

/** 时间桶统计（按小时 / 天） */
export interface TimeBucket {
  /** ISO 时间串，粒度由调用方决定 */
  readonly bucket: string
  readonly usage: TokenUsage
  readonly cost: CostBreakdown
  readonly requestCount: number
}

/**
 * subagent（侧链）活动的汇总。
 *
 * 为什么需要这个字段：侧链 turn 数实测可达主链的 5.4 倍、输出 token 1.7 倍，
 * 而默认统计口径（`includeSidechain: false`）排除它们。不暴露就等于把大部分
 * 真实用量藏起来——用户看到的"总成本"其实只是主对话那部分。
 *
 * 注意它是**并列**的一份汇总，不是把侧链并进上面的主链字段：主链数字对应
 * "我和 Claude 对话了多少轮"，那是用户最直观的心智模型，改了反而让人困惑。
 * 渐进暴露比一次性改口径更容易验证。
 */
export interface SidechainSummary {
  readonly turnCount: number
  readonly usage: TokenUsage
  readonly cost: CostBreakdown
  readonly requestCount: number
}

/** 全局聚合结果 */
export interface AggregatedStats {
  readonly sessionCount: number
  readonly turnCount: number
  readonly usage: TokenUsage
  readonly cost: CostBreakdown
  readonly byModel: readonly ModelStats[]
  readonly byProject: readonly ProjectStats[]
  readonly byHour: readonly TimeBucket[]
  readonly byDay: readonly TimeBucket[]
  readonly toolUsage: readonly ToolStats[]
  readonly cacheHitRate: number
  readonly errorRate: number
  readonly firstActivityAt: string | null
  readonly lastActivityAt: string | null
  /** 侧链汇总；上方所有字段仍保持"只算主链"的口径，两者互不影响 */
  readonly sidechain: SidechainSummary
}

export interface ProjectStats {
  readonly projectSlug: string
  readonly sessionCount: number
  readonly usage: TokenUsage
  readonly cost: CostBreakdown
}

export interface ToolStats {
  readonly toolName: string
  readonly callCount: number
  readonly errorCount: number
  readonly totalResultBytes: number
}

/** 扫描配置 */
export interface ScanOptions {
  /** Claude Code 项目根目录，默认 `~/.claude/projects` */
  readonly rootDir?: string
  /** 只扫描指定项目 slug */
  readonly projectSlugs?: readonly string[]
  /** 只保留该时间之后的会话 */
  readonly since?: string
  /** 单文件最大字节数，超过则跳过，默认 50MB */
  readonly maxFileBytes?: number
  /** 进度回调 */
  readonly onProgress?: (done: number, total: number, filePath: string) => void
}

/** 报告导出格式 */
export type ReportFormat = 'json' | 'markdown' | 'csv' | 'html'
