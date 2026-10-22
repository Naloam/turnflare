# 新功能规格：subagent（侧链）活动可见化

> 状态：**已完成**（2026-10-20）· 含第二部分的链条筛选

## 1. 问题

侧链（subagent）活动在当前产品里**几乎完全不可见**，而它占了真实用量的大头。

实测当前机器的真实数据（`turnflare scan` 后查 SQLite）：

| 口径                       | turn 数    | 输出 token    |
| -------------------------- | ---------- | ------------- |
| 主链（`is_sidechain = 0`） | 4,542      | 2,679,659     |
| 侧链（`is_sidechain = 1`） | **24,378** | **4,591,948** |

侧链 turn 数是主链的 **5.4 倍**，输出 token 是主链的 **1.7 倍**。

而所有统计口径都排除侧链：

- `getOverview()` 的 `turnCount` / `usage` / `byModel` / `byProject` / `byHour` / `byDay` / `toolUsage`
- `getModelStats()` / `getProjectStats()` / `getTimeline()` / `getToolStats()`
- `sessions` 行的 token 汇总列

所以 `turnflare stats` 报出的"总 Token / 总成本"只覆盖了真实活动的约 **37%**，
而用户无从得知还有 63% 在 subagent 里。

**另一处不一致**：`getSession()` 的 SQL（`SELECT * FROM turns WHERE session_id = ?`）
没有侧链过滤，所以会话详情**包含**侧链 turn；而 `sessions.turn_count` 也算全部落库
turn。于是同一场会话在详情页显示的 turn 数，和统计里的 turnCount 口径不同——
用户会看到两个矛盾的数字。

## 2. 设计决策

**不改变现有主链口径**，而是把侧链汇总显式暴露出来。理由：

- 主链数字对应"我和 Claude 对话了多少轮"，是用户最直观的心智模型，改了会让人困惑
- 但"总成本"必须说清自己覆盖了什么范围，否则就是误导
- 渐进暴露比一次性改口径更容易验证

## 3. 契约变更（共享声明）

在 `packages/contracts/src/domain.ts` 维护声明，core/api/web 导出同一份类型（`pnpm contracts` 校验声明身份）：

```typescript
/**
 * subagent（侧链）活动的汇总。
 *
 * 为什么需要这个字段：侧链 turn 数实测可达主链的 5.4 倍、输出 token 1.7 倍，
 * 而默认统计口径排除它们。不暴露就等于把大部分真实用量藏起来——
 * 用户看到的"总成本"其实只是主对话那部分。
 */
export interface SidechainSummary {
  readonly turnCount: number
  readonly usage: TokenUsage
  readonly cost: CostBreakdown
  readonly requestCount: number
}
```

`OverviewPayload` / `AggregatedStats` 增加：

```typescript
readonly sidechain: SidechainSummary
```

## 4. 各端实现要点

### api

- 仓储新增读路径：按 `is_sidechain = 1` 汇总 turn 数、token、成本、请求数
  （请求数 = `model IS NOT NULL AND is_sidechain = 1` 的 turn 数，与主链口径一致）
- `getOverview()` 返回的 `AggregatedStats` 带上 `sidechain`
- **不要**改现有主链字段的语义
- 复用 `mapper.ts` 的 `toTokenUsage` / `toCostBreakdown`，不要手写第二份

### cli

`turnflare stats` 的人类表格与 markdown 输出，在总览表之后加一行/一段：

```
subagent 活动  24,378 turn · 459.2M token · $0.00 · 1,986 次计费请求
```

并在有侧链数据时给一句说明：上方总览为主对话口径，不含 subagent 活动。
`--json` 输出里 `overview.sidechain` 自然带上。

### web

总览页加一个提示条（复用 `unpriced-warning` 的样式模式），有侧链数据时显示：

> subagent 活动：24,378 turn · 459.2M token · 未计入上方总览

## 5. 验收

1. `pnpm typecheck` / `pnpm test` / `pnpm contracts` / `pnpm lint` 全绿
2. `turnflare scan && turnflare stats` 能看到 subagent 行，且数字与
   `sqlite3 <db> "SELECT COUNT(*), SUM(output_tokens) FROM turns WHERE is_sidechain = 1"` 一致
3. 新增测试：仓储层侧链汇总的正确性、CLI 输出包含该行、web 提示条渲染
4. 覆盖率不低于当前水平（core 98.9% / api 98.1% / web 99.8% / cli 98.3%）
5. `node tools/demo.mjs` 的 11 条断言仍全过

## 6. 明确不做

- 不提供 `--include-sidechain` 开关改变主口径（YAGNI，真有需求再加）
- 不改 `getSession()` 的 SQL（它已含侧链，与 `sessions.turn_count` 一致，是对的）
- 不给侧链单独的时间线/模型分布（先让总量可见，明细靠会话详情）

---

# 第二部分：会话详情的侧链筛选（依赖第一部分完成）

## 问题

`getSession()` 返回**全部** turn（含侧链），而侧链 turn 数实测是主链的 5.4 倍。
于是打开一场 subagent 密集的会话，时间线会被几千条 subagent turn 埋掉，
主对话反而找不到。

现有 UI 已经给侧链 turn 打了「侧链」徽标（`TurnTimeline.tsx:49`），
但没有筛选手段——徽标只能告诉你"这条是侧链"，不能帮你把它们收起来。

## 设计

`SessionDetailPage` 加一个三段筛选器：`全部 / 主对话 / 仅 subagent`，
默认「全部」（与当前行为一致，不破坏既有预期）。

- 用现有组件（`Badge` 或一组按钮），不新建组件除非必要
- 筛选状态放 URL hash 查询参数（`#/sessions/:id?chain=main`），
  这样刷新与分享都能保留视图——与 `useHashRoute` 已有的 query 能力一致
- token 瀑布图（`TokenWaterfall`）跟随筛选：瀑布图是"这场会话的 token 去哪了"，
  只画一半会让人误判总量
- 筛选后为空时显示 `EmptyState`，不要留一片空白

## 验收

1. 三种筛选各自渲染正确的 turn 集合
2. `?chain=main` / `?chain=side` / `?chain=all` 三个取值都有效，非法值回退 `all`
3. 瀑布图跟随筛选
4. 测试覆盖三种筛选 + 非法值回退 + 空结果
5. `SessionDetailPage.tsx` 仍 < 200 行（超出就把筛选器拆成独立组件）

---

# 第三部分：会话级口径（已实测澄清，无需修改）

## 曾经的误判

主线程早先实测一场会话 `turn_count = 2498` 而 `output_tokens = 959,262`
（等于主链输出），据此判断「同一行两个字段口径不一致，turn_count 含侧链」。

**这个判断是错的。** 后来用 SQL 复核：

```
session 431c03a5-…:  turn_count = 2510
turns WHERE is_sidechain=0 → 2510      ← 相等
turns WHERE is_sidechain=1 → 27106     ← 已落库，但不计入
```

`turn_count` 与 `getOverview().turnCount` **口径相同，都是主链**，
`SUM(turn_count)` 与 `COUNT(*) WHERE is_sidechain=0` 在 18 场会话上完全相等。

早先看到的 2498 是 `upsertSession` 按 `selectStorableTurns().length`（全量）
写入的**中间值**；紧接着 `mergeTurns` 末尾的 `recalculateSession` 会用
`SQL_SELECT_SESSION_AGGREGATE`（带 `SQL_MAIN_CHAIN_TURNS` 过滤）覆盖成主链值。
两条路径写同一个字段，但最终值由后者决定。

## 真正存在的差异（刻意的，已文档化）

| 视图                                        | 口径     | 原因                                                                                                                              |
| ------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 会话列表 / 统计（`turnCount`、token、成本） | 主链     | 「我和 Claude 对话了多少轮」是用户的心智模型                                                                                      |
| 会话详情（`getSession` 的 turns）           | **全量** | `SQL_SELECT_SESSION_TURNS` 刻意不带侧链过滤——它必须与 `sessions.turn_count` 的**分母**（全部落库 turn）一致，否则详情页会显示不完 |

代价：详情页的 turn 列表比统计里的 turnCount 长（且受 500 条上限截断）。
这是可接受的：徽标已经标出哪些是侧链，第二部分的三段筛选器让用户能只看主对话。

## 结论

不需要改 `SQL_SELECT_SESSION_AGGREGATE`。若照早先的误判去掉 `is_sidechain = 0`，
反而会**破坏**主链口径的一致性，让统计与 `SQL_COUNT_TURNS` 对不上。
