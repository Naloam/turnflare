# 模型定价与成本计算规则（唯一真源）

> 数据来源：Anthropic 官方定价表（缓存日期 2026-10-06）+ Claude Code 会话 jsonl 实测 usage 字段。
> 成本引擎 `packages/core/src/cost/` 必须严格按本文件实现。价格单位为 **美元 / 百万 token（$/MTok）**。

## 1. 模型价目表

| Model ID            | 输入  | 输出  | 缓存写(5m) | 缓存写(1h) | 缓存读 | Fast 输入 | Fast 输出 |
| ------------------- | ----- | ----- | ---------- | ---------- | ------ | --------- | --------- |
| `claude-fable-5-1`  | 10.00 | 50.00 | 12.50      | 20.00      | 0.25   | —         | —         |
| `claude-fable-5`    | 10.00 | 50.00 | 12.50      | 20.00      | 0.25   | —         | —         |
| `claude-mythos-5-1` | 10.00 | 50.00 | 12.50      | 20.00      | 0.25   | —         | —         |
| `claude-opus-5-5`   | 4.00  | 20.00 | 5.00       | 8.00       | 0.20   | 8.00      | 40.00     |
| `claude-opus-5`     | 5.00  | 25.00 | 6.25       | 10.00      | 0.25   | 10.00     | 50.00     |
| `claude-opus-4-8`   | 5.00  | 25.00 | 6.25       | 10.00      | 0.25   | 10.00     | 50.00     |
| `claude-opus-4-7`   | 5.00  | 25.00 | 6.25       | 10.00      | 0.25   | —         | —         |
| `claude-opus-4-6`   | 5.00  | 25.00 | 6.25       | 10.00      | 0.25   | —         | —         |
| `claude-sonnet-5-5` | 2.00  | 10.00 | 2.50       | 4.00       | 0.20   | —         | —         |
| `claude-sonnet-5`   | 2.00  | 10.00 | 2.50       | 4.00       | 0.20   | —         | —         |
| `claude-sonnet-4-6` | 3.00  | 15.00 | 3.75       | 6.00       | 0.30   | —         | —         |
| `claude-haiku-5-5`  | 0.10  | 0.50  | 0.125      | 0.20       | 0.01   | —         | —         |
| `claude-haiku-4-5`  | 1.00  | 5.00  | 1.25       | 2.00       | 0.10   | —         | —         |

规则推导（用于校验，勿手抄数字）：

- 缓存写 5m = 输入价 × **1.25**
- 缓存写 1h = 输入价 × **2.0**
- 缓存读 = 输入价 × **0.1**，以下模型为官方特价：`claude-opus-5-5` / `claude-sonnet-5-5` = **0.20**；
  `claude-fable-5-1` / `claude-fable-5` / `claude-mythos-5-1` = **0.25**；`claude-haiku-5-5` = **0.01**
- Fast mode（`usage.speed === "fast"`）仅 Opus 5 / Opus 4.8 / Opus 5.5 支持，价格约 2×，见上表

## 2. 成本计算公式

```
totalCost =
    inputTokens           × inputPrice
  + cacheCreationTokens   × cacheWritePrice      (拆分见下)
  + cacheReadTokens       × cacheReadPrice
  + outputTokens          × outputPrice
```

### 2.1 缓存写拆分（关键）

jsonl 的 `usage` 同时提供总量与 TTL 分项：

```json
"cache_creation_input_tokens": 12000,
"cache_creation": {
  "ephemeral_1h_input_tokens": 8000,
  "ephemeral_5m_input_tokens": 4000
}
```

计算规则：

1. 若 `ephemeral_1h_input_tokens > 0`，该部分按 **1h 价**（输入价 × 2.0）计。
2. 若 `ephemeral_5m_input_tokens > 0`，该部分按 **5m 价**（输入价 × 1.25）计。
3. 若两者均为 0 但 `cache_creation_input_tokens > 0`（旧版本记录无分项），
   全部按 **5m 价**计（保守，不低估）。
4. 若分项之和 ≠ 总量，以**总量**为准，差额按 5m 价补足，并在结果中标记 `hasUnsplitCacheWrite: true`。

### 2.2 Fast mode

`usage.speed === "fast"` 时，输入/输出单价切换到上表 Fast 列。若该模型无 Fast 价，
按标准价计算并标记 `isEstimated: true`。

### 2.3 Haiku 5.5 阶梯价

`claude-haiku-5-5` 官方为 ≤100K 输入 $0.10/$0.50，>100K 输入 $0.50/$2.50。
聚合统计**无法还原单次请求是否越界**，因此统一按 **≤100K 档**计算，
并在 `ModelStats` / 报告 UI 上标注"未计阶梯溢价"。

### 2.4 未知模型

`priceFor(model)` 对未登记模型返回：

```typescript
{ pricing: null, isEstimated: true }
```

调用方（`costOf`）在 `pricing` 为 null 时：

- 成本计 **0**，不得猜测；
- `CostBreakdown` 附带 `unpricedModel: true`，由 UI / CLI 明确提示"该模型无价目数据"。
- **绝不静默按某个模型价格估算**——错误的成本比没有成本更糟。

### 2.5 精度与舍入

- 中间计算用 `number`（双精度足够，token 量级 < 1e12）。
- 仅在最末展示层舍入：成本保留 **4 位小数**存储，展示保留 **2 位**。
- 单次 `costOf` 不得修改入参（不可变）。

## 3. TokenUsage → 成本 的完整实现约定

```typescript
export interface CostInput {
  readonly usage: TokenUsage
  readonly model: string
  readonly speed?: 'standard' | 'fast'
}

export interface CostBreakdown {
  readonly inputCost: number
  readonly outputCost: number
  readonly cacheWriteCost: number
  readonly cacheReadCost: number
  readonly totalCost: number
  readonly currency: 'USD'
  /** 是否存在无法定价的模型 */
  readonly unpricedModel: boolean
  /** 是否使用了估算（fast 价缺失、缓存写未拆分等） */
  readonly isEstimated: boolean
}
```

## 4. 已知模型别名归一化

`message.model` 字段可能带后缀或变体，`priceFor` 必须先归一化：

| 原始值示例                          | 归一化后                                            |
| ----------------------------------- | --------------------------------------------------- |
| `claude-opus-5-5-20261001`          | `claude-opus-5-5`（剥离 `-YYYYMMDD` 日期后缀）      |
| `claude-sonnet-4-5-20250929`        | `claude-sonnet-4-5`                                 |
| `anthropic.claude-opus-5-5`         | `claude-opus-5-5`（剥离 Bedrock `anthropic.` 前缀） |
| `us.anthropic.claude-opus-5-5_v1:0` | `claude-opus-5-5`                                   |
| `step-5-preview`                    | **保持原样** → 无价目，`unpricedModel: true`        |

归一化必须是纯函数，且对无法识别的值**原样返回**，不得抛错。
