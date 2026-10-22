# 开发指南

## 环境要求

| 工具 | 版本    | 说明                                                  |
| ---- | ------- | ----------------------------------------------------- |
| Node | ≥ 22.0 | better-sqlite3 的最低运行时要求；推荐 Node 22 或 24 |
| pnpm | 10.x    | 唯一的包管理器（workspace 协议 `workspace:*`）        |

```bash
pnpm install
pnpm build                            # 按 contracts → core → api/cli 顺序构建
```

---

## 常用命令

```bash
pnpm typecheck                              # 全包类型检查
pnpm test                                   # 全包单元测试
pnpm lint                                   # ESLint
pnpm contracts                              # 单一声明与包接口校验
pnpm --filter @turnflare/core test:coverage # core 覆盖率（阈值 85%）
pnpm --filter @turnflare/api test:coverage  # api 覆盖率（阈值 80%）
pnpm --filter @turnflare/web test:coverage  # web 覆盖率（阈值 80%）

pnpm api          # API dev server（tsx watch，8787）
pnpm web          # Web dev server（vite，5173，代理 /api）
pnpm cli stats # CLI

node tools/demo.mjs                        # 全管线演示 + 11 条断言
node tools/check-contracts.mjs             # 契约漂移检测
```

---

## 架构要点

### 模块依赖

`cli → api → core` 是 Node.js 运行时依赖；web 通过 HTTP 取数。
所有包共享 `@turnflare/contracts` 的类型声明，web 仅使用 `import type`。
core 的解析与计算仍不依赖第三方运行时代码。

### 类型与包接口

领域契约在 `packages/contracts/src/domain.ts`，HTTP 契约在 `http.ts`。
core/api/web 原来的类型文件保留为导出入口，不能另写同名声明。
`pnpm contracts` 检查声明身份，包含类型、可选性和嵌套字段，而非只比字段名。
每个消费方继续由 strict typecheck 验证。

CLI 从 `@turnflare/api` 公开入口导入，禁止 `@turnflare/api/dist/...`。
改契约后运行 `pnpm check`，先重建声明再检查所有消费方。
原先维护三份契约的决定已由 [ADR 0001](adr/0001-shared-contracts-and-public-entry.md) 替代。

### 演示与启动

`pnpm demo` 使用固定示例与内存数据库，不读取个人历史。
`pnpm start` 扫描本地日志，并在 8787 提供完整仪表盘与 API。
开发热更新继续使用 `pnpm api`、`pnpm web` 两个终端。

### 成本计算接缝

`core` 的 `aggregate()` 接受可选的 `costCalculator` 注入：

```typescript
aggregate(sessions, { costCalculator: (usage, model) => costOf({ usage, model }) })
```

不传时成本全 0 且 `unpricedModel: true`——**静默报 0 会让使用者以为
这些 token 不要钱**，比明确说"算不出来"更糟。

---

## 关键设计决策

### 1. 流式解析，不一次性读文件

会话 jsonl 单行可达数 MB，整个文件可达 16MB。`streamLines` 用 1MB 定长块 +
`StringDecoder` 手工缓冲拼行，因此：

- 单行数 MB 也能流式产出
- 跨块的多字节 UTF-8 不会被截成替换字符
- 末行无换行符也产出

### 2. 截断行不中断解析

会话正在写入时读取会出现半行 JSON。解析器把 `JSON.parse` 失败记入
`parseErrors` 并继续，绝不让整个文件解析失败。

### 3. 非会话文件必须过滤

`~/.claude/projects` 下混有插件遥测文件（如 `vercel-plugin/skill-injections.jsonl`），
它们没有 `type`/`sessionId`/`message` 字段。`Scanner` 用
`isScannableSession()` 过滤：`sessionId` 非空 **且** `turns.length > 0`，
计入 `skippedEmpty` 而非 `failedFiles`。

计数器配平有测试守着：`totalFiles === scanned + skipped + skippedEmpty + failed`。

### 3b. 一个会话对应多个文件，必须合并而非替换

这是实测发现的**最严重的一个数据缺陷**，值得单独记一笔：

Claude Code 的 subagent 记录（`subagents/agent-*.jsonl`、`wf_<run-id>/agent-*.jsonl`）
**复用父会话的 sessionId**。真实数据里 49 个可扫文件只对应 18 个唯一 sessionId，
其中当前会话被 13 个文件共享，另一个被 20 个文件共享。

最初的实现用"先删后插"替换 turns，结果是**最后被扫到的 subagent 文件冲掉了
主会话的全部 turn**——当前会话入库后只剩 1 条 turn，而它实际有 1096 条。

修法：

- `mergeSessionTurns()` 用 `ON CONFLICT (uuid) DO NOTHING` 累加，靠 uuid 主键去重
- `recalculateSession()` 从 turns 表全量重算 turn_count / token / 成本
- 时间范围与模型集合走**并集**（取较早/较晚、取并集），不是后者覆盖前者
- `sessions.turn_count` 的 upsert 用 `MAX(turn_count, excluded.turn_count)` 保证不倒退

两个容易踩的坑：

1. **不能用 `INSERT OR IGNORE`**：它的"忽略"覆盖所有约束，包括 role 的 CHECK——
   一条畸形 turn 会被悄悄吞掉，落库少一行却没人知道。必须用
   `ON CONFLICT (uuid) DO NOTHING`，只对 uuid 冲突生效。
2. **`ON CONFLICT` 的列必须有唯一索引**：`turns.uuid` 是主键，满足；
   若改用非唯一列会直接报错。

修完后的效果（同一份真实数据）：当前会话 1 → 1096 turns，
总输出 token 1.5M → 2.29M，时间线多出当天的桶。

### 4. 合成模型哨兵要剔除

Claude Code 会插入 `<synthetic>` 标记的记录（上下文压缩摘要等），它们不对应
任何一次计费调用。`isSyntheticModel()` 在收集 `meta.models` 和聚合
`byModel` 时都过滤掉，否则模型分布里会多出一个不存在的"模型"。

### 5. 缓存写按 TTL 分轨计价

`usage.cache_creation.ephemeral_5m_input_tokens` 按输入价 × 1.25，
`ephemeral_1h_input_tokens` 按输入价 × 2.0。两者之和与总量不符时以总量为准，
差额按 5m 价补足并标记 `isEstimated`。

### 6. 未知模型绝不猜价格

`priceFor()` 对价目表里没有的模型返回 `pricing: null`，`costOf` 随之返回
全 0 + `unpricedModel: true`。**错误的成本比没有成本更糟。**

### 6c. 计费档位（speed）必须随用量一起走

`usage.speed` 区分标准档与 fast 档，fast 的输入/输出单价约为标准档 2 倍。
实测一笔 100 万输入 token 的 opus-5-5 请求：标准价 $4.02、fast 价 $8.04。

这个字段在两条链路上都丢过一次，修的时候两条都要看：

1. **写入链**：`normalizeUsage` 原先不读 `usage.speed`，解析出的 `TokenUsage`
   没有档位，`costOf` 只能按标准价计。
2. **读取链**（更隐蔽）：`turns` 表加了 `speed` 列之后，按模型汇总的 SQL
   （`SQL_SELECT_SESSION_MODEL_USAGE` / `SQL_SELECT_MODEL_STATS` /
   `SQL_SELECT_PROJECT_STATS` / 时间线）仍按 `(…, model)` 分组，`speed` 没进
   SELECT 也没进 GROUP BY，于是六条读取路径全把 fast 按标准价报——
   「低估一半」只是从写入端挪到了读取端。

修法：共享 `TokenUsage` 契约加 `speed`，`turns` 表加列（迁移 002），
按模型汇总的 SQL 把 `speed` 加进 SELECT 与 GROUP BY，mapper 用
`foldModelStats` 把 `(model, speed)` 行折回"一个模型一条"。

`costOf` 的档位优先级是**显式入参 > usage 自带**：aggregate 的 costCalculator
签名是 `(usage, model)`，拿不到单条记录的档位，只能让它随用量走；而直接调用的
方显式传了 speed 时也必须被尊重。

存量数据注意：迁移 002 之前扫进去的 fast turn 仍是标准档，需要重扫才会按
fast 价重算（`turnflare scan` 对未变化的文件会跳过）。

Web 侧在 `TurnTimeline` 里给 fast turn 加徽标——fast 贵一倍，用户该一眼看到。
会话级不加：`detail.usage` 是聚合值，一场会话可能混用两种档位。

### 6b. 本地时间必须走 Intl，不能套固定偏移

展示层最初用 `formatDateTime(iso, localTimezoneOffsetMinutes())` 把时间戳渲染成
本地时间。`localTimezoneOffsetMinutes()` 只能给出**当前时刻**的偏移，把它套到
几个月前的时间戳上，遇到夏令时切换就偏差一小时：7 月的 EDT 是 -240，11 月的 EST
是 -300，拿冬季偏移渲染夏季时刻，墙钟就错了。

修法：`web/src/lib/format.ts` 新增 `formatLocalDateTime(iso)`，走
`Intl.DateTimeFormat`（`timeZone` 缺省取系统时区，且对每个瞬间各自判断 DST）。
`formatDateTime(iso, offset)` 保留给"调用方明确指定偏移"的场景（例如强制按 UTC 展示）。

回归测试在 `web/src/lib/format.dst.test.ts`，守两条不变量：
渲染结果不随"现在"漂移，且与平台 Intl 对系统时区的计算结果一致。
另有一条测试固化"固定偏移方案在 DST 边界上确实会错"的判断依据，
免得将来有人再把那条路加回来。

> core 的 `formatDateTime(iso, timezoneOffsetMinutes)` 保持接收显式偏移不变——
> 它是库函数，偏移由调用方决定；问题只出在 web 用"此刻的偏移"去渲染任意时刻。

`getFileStamps()` 返回已入库文件的戳，相同则跳过。`since` 用文件 mtime 做
前置过滤（一条记录的写入时刻不可能晚于文件 mtime，判断精确且省掉整棵子树的解析）。

---

## 测试策略

| 层级 | 工具                            | 位置                    | 覆盖                                 |
| ---- | ------------------------------- | ----------------------- | ------------------------------------ |
| 单元 | vitest                          | `src/**/*.test.ts`      | 纯函数、mapper、格式化               |
| 集成 | vitest + `:memory:` SQLite      | `src/**/*.test.ts`      | repository 真迁移、路由 `app.inject` |
| 组件 | vitest + @testing-library/react | `web/src/**/*.test.tsx` | 页面三态、交互                       |
| E2E  | Playwright                      | `web/e2e/*.spec.ts`     | 关键流程 + API 契约                  |

E2E 启动构建后的单地址应用，默认端口 18787，可用 `TURNFLARE_E2E_PORT` 覆盖。
数据来自 `tools/sample-data.mjs`，包含多个项目、主对话、侧链和无价目模型。
不读取 `~/.claude/projects`，不复用个人服务，测试不因缺少个人数据而跳过。
`tools/demo.mjs` 与性能基准默认也用示例；需要验证真实文件时显式传 `--root DIR`。

---

## 已知边界

- `claude-haiku-5-5` 的 100K 输入阶梯价无法从聚合数据还原，统一按 ≤100K 档
- `step-5-preview` 等非 Anthropic 官方模型无价目，成本计 0 并明确标注
- `sessions.turn_count` 与 `getOverview().turnCount` **是同一个口径**：都只数
  `is_sidechain = 0` 的主链 turn。前者由 `SQL_SELECT_SESSION_AGGREGATE` 从 turns 表
  重算，后者由 `SQL_COUNT_TURNS` 直接数，两条语句挂的是同一条 `SQL_MAIN_CHAIN_TURNS`。
  实测扫过的库：18 个会话逐一比对 `SELECT turn_count FROM sessions` 与
  `SELECT COUNT(*) FROM turns WHERE session_id = ? AND is_sidechain = 0`，
  18/18 相等（合计都是 4628）；侧链另有 28767 条在总览的 sidechain 字段单独汇总
- per-turn 成本不在 `Turn` 契约里；会话级总成本在 `SessionDetail` 头部

---

## 提交规范

Conventional Commits，中文描述：

```
feat: 增加模型价目表与 fast mode 计价
fix: 修复 <synthetic> 哨兵污染模型分布
test: 补充分页边界用例
```

提交前必须：`pnpm typecheck && pnpm test && pnpm contracts`。

## 发布包

`pnpm release:pack` 生成 `release/turnflare-0.1.0.tgz`。`pnpm verify:package` 在工作区外安装它，
验证 CLI、静态资源、只读示例和新增文件的后台增量索引。仅打包本项目的工作区代码，第三方运行时依赖
按锁定版本交给 npm 安装。`pnpm start` 的后台扫描周期默认 10000ms，可用 `TURNFLARE_WATCH_INTERVAL_MS` 覆盖，0 表示关闭。
