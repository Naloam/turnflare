# Turnflare API 文档

> 基础地址：`http://127.0.0.1:8787`（可用 `PORT` 覆盖）
> 所有路径以 `/api` 开头。响应为 JSON，`Content-Type: application/json`。

## 响应包络

每个端点都返回统一包络：

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": { "total": 0, "page": 1, "limit": 50, "generatedAt": "2026-10-19T08:00:00.000Z" }
}
```

| 字段      | 类型           | 说明                              |
| --------- | -------------- | --------------------------------- |
| `success` | boolean        | 请求是否成功                      |
| `data`    | object \| null | 载荷；失败时为 `null`             |
| `error`   | string \| null | 中文可读错误信息；成功时为 `null` |
| `meta`    | object         | 分页元信息；仅在列表类端点出现    |

错误响应示例：

```json
{
  "success": false,
  "data": null,
  "error": "参数 sort 必须是 cost/tokens/recent/turns 之一"
}
```

> 服务端会把完整错误上下文写进日志，但**不会**把绝对路径或堆栈返回给客户端。

---

## GET /api/health

健康检查。用于探活与确认数据根目录。

```json
{
  "success": true,
  "data": {
    "name": "turnflare",
    "version": "0.1.0",
    "dataRoot": "/Users/you/.claude/projects",
    "sessionCount": 53,
    "lastScanAt": "2026-10-19T08:00:00.000Z"
  },
  "error": null
}
```

---

## GET /api/sessions

会话列表。

### 查询参数

| 参数      | 类型          | 默认   | 说明                                      |
| --------- | ------------- | ------ | ----------------------------------------- |
| `page`    | integer ≥ 1   | `1`    | 页码                                      |
| `limit`   | integer 1–200 | `50`   | 每页条数                                  |
| `project` | string        | —      | 按项目 slug 过滤                          |
| `model`   | string        | —      | 按模型过滤（精确匹配）                    |
| `sort`    | enum          | `cost` | `cost` \| `tokens` \| `recent` \| `turns` |
| `order`   | enum          | `desc` | `asc` \| `desc`                           |

### 响应 `data`

```json
[
  {
    "sessionId": "431c03a5-20d9-4e74-b2c6-fa3346cfdb07",
    "projectSlug": "-Users-you-Projects-foo",
    "cwd": "/Users/you/Projects/foo",
    "gitBranch": "main",
    "startedAt": "2026-10-18T09:12:33.100Z",
    "endedAt": "2026-10-18T11:40:02.880Z",
    "models": ["claude-opus-5-5"],
    "turnCount": 214,
    "usage": {
      "speed": "standard",
      "inputTokens": 128400,
      "cacheCreationTokens": 96000,
      "cacheReadTokens": 2400000,
      "outputTokens": 48200,
      "thinkingTokens": 12000,
      "serverToolUse": 0
    },
    "cost": {
      "inputCost": 0.5136,
      "outputCost": 0.964,
      "cacheWriteCost": 0.48,
      "cacheReadCost": 0.48,
      "totalCost": 2.4376,
      "currency": "USD",
      "unpricedModel": false,
      "isEstimated": false
    }
  }
]
```

---

## GET /api/sessions/:id

单会话详情。支持 `?chain=all|main|side&page=1`，默认 `all` 和第 1 页；非法值返回 400。

筛选在数据库截断之前执行。每页最多返回 500 条，默认主对话优先，链内按原始行号升序。
`chainCounts` 始终返回整场会话的 total/main/side 数量，不受筛选或截断影响。
会话头部的 usage/cost 保持主对话口径，不随详情链条筛选变化。

```json
{
  "success": true,
  "data": {
    "sessionId": "431c03a5-20d9-4e74-b2c6-fa3346cfdb07",
    "projectSlug": "-Users-you-Projects-foo",
    "turns": [
      {
        "uuid": "8de0411c-9260-4508-8a13-532f07dfc7ce",
        "parentUuid": null,
        "role": "user",
        "timestamp": "2026-10-18T09:12:33.100Z",
        "model": null,
        "usage": null,
        "tools": [],
        "textPreview": "帮我把这个模块重构成不可变风格",
        "isSidechain": false,
        "lineNumber": 3
      },
      {
        "uuid": "9f0a1b2c-3d4e-5f60-7a8b-9c0d1e2f3a4b",
        "parentUuid": "8de0411c-9260-4508-8a13-532f07dfc7ce",
        "role": "assistant",
        "timestamp": "2026-10-18T09:12:41.550Z",
        "model": "claude-opus-5-5",
        "usage": {
          "speed": "standard",
          "inputTokens": 40198,
          "cacheCreationTokens": 0,
          "cacheReadTokens": 0,
          "outputTokens": 1183,
          "thinkingTokens": 0,
          "serverToolUse": 0
        },
        "tools": [
          { "toolName": "Read", "toolUseId": "toolu_01A", "isError": false, "resultBytes": 5420 }
        ],
        "textPreview": "我先看一下现有实现……",
        "isSidechain": false,
        "lineNumber": 4
      }
    ],
    "usage": {},
    "cost": {},
    "parseErrorCount": 0
  },
  "error": null
}
```

`id` 支持前缀匹配：传前 8 位即可定位唯一会话。找不到时返回 `404`。

---

## GET /api/stats/overview

聚合总览。`data` 即 `AggregatedStats`：

```json
{
  "sessionCount": 53,
  "turnCount": 8421,
  "usage": {},
  "cost": {},
  "byModel": [{ "model": "claude-opus-5-5", "requestCount": 3201, "usage": {}, "cost": {} }],
  "byProject": [
    { "projectSlug": "-Users-you-Projects-foo", "sessionCount": 12, "usage": {}, "cost": {} }
  ],
  "byHour": [{ "bucket": "2026-10-18T09:00:00Z", "usage": {}, "cost": {}, "requestCount": 47 }],
  "byDay": [{ "bucket": "2026-10-18", "usage": {}, "cost": {}, "requestCount": 612 }],
  "toolUsage": [
    { "toolName": "Bash", "callCount": 812, "errorCount": 14, "totalResultBytes": 1284000 }
  ],
  "cacheHitRate": 0.948,
  "errorRate": 0.021,
  "firstActivityAt": "2026-09-01T02:11:00.000Z",
  "lastActivityAt": "2026-10-19T10:08:04.883Z"
}
```

排序保证：`byModel` / `byProject` 按成本降序，同成本按名称升序，输出稳定可复现。

---

## GET /api/stats/models

按模型分布。`data` 为 `ModelStats[]`。

## GET /api/stats/timeline

时间线。

| 参数          | 类型       | 默认  | 说明             |
| ------------- | ---------- | ----- | ---------------- |
| `granularity` | enum       | `day` | `hour` \| `day`  |
| `since`       | ISO 字符串 | —     | 起始时间（含）   |
| `until`       | ISO 字符串 | —     | 结束时间（不含） |
| `project`     | string     | —     | 按项目过滤       |

```json
{ "success": true, "data": { "granularity": "day", "buckets": [] }, "error": null }
```

## GET /api/stats/tools

工具调用统计。`data` 为 `ToolStats[]`，按 `callCount` 降序。

## GET /api/stats/projects

按项目分布。`data` 为 `ProjectStats[]`，按成本降序。

---

## POST /api/scan

触发一次扫描。立即返回任务句柄，实际扫描异步执行。

### 请求体（全部可选）

```json
{
  "rootDir": "/Users/you/.claude/projects",
  "projectSlugs": ["-Users-you-Projects-foo"],
  "since": "2026-10-01T00:00:00.000Z",
  "force": false
}
```

### 响应

```json
{
  "success": true,
  "data": {
    "jobId": "3f9a1c2e-7b4d-4e5f-8a9b-0c1d2e3f4a5b",
    "status": "queued",
    "totalFiles": 0,
    "processedFiles": 0,
    "startedAt": "2026-10-19T08:00:00.000Z",
    "finishedAt": null,
    "error": null
  },
  "error": null
}
```

同一时刻只允许一个扫描任务；重复提交返回 `409`。

---

## GET /api/scan/:jobId

查询扫描进度。`status` 为 `queued` / `running` / `done` / `failed`。

```json
{
  "success": true,
  "data": {
    "jobId": "3f9a1c2e-7b4d-4e5f-8a9b-0c1d2e3f4a5b",
    "status": "done",
    "totalFiles": 76,
    "processedFiles": 76,
    "startedAt": "2026-10-19T08:00:00.000Z",
    "finishedAt": "2026-10-19T08:00:04.210Z",
    "error": null
  },
  "error": null
}
```

---

## GET /api/report

导出报告。

| 参数     | 类型 | 说明                                    |
| -------- | ---- | --------------------------------------- |
| `format` | enum | `json` \| `markdown` \| `csv` \| `html` |

- `json`：包络 JSON
- `markdown`：中文 Markdown 报表
- `csv`：UTF-8 **with BOM**（`﻿`），便于 Excel 直接识别中文
- `html`：自包含单文件（内联 CSS + SVG 图表），无外部请求

未知格式返回 `400`。

---

## 错误码

| HTTP | 场景                             |
| ---- | -------------------------------- |
| 400  | 查询参数或请求体验证失败（zod）  |
| 404  | 会话不存在                       |
| 409  | 已有扫描任务在进行中             |
| 500  | 未预期错误（详情仅进服务端日志） |

## 环境变量

| 变量                         | 默认                            | 说明                         |
| ---------------------------- | ------------------------------- | ---------------------------- |
| `PORT`                       | `8787`                          | 监听端口                     |
| `HOST`                       | `127.0.0.1`                     | 监听地址                     |
| `TURNFLARE_DATA_ROOT`        | `~/.claude/projects`            | 会话数据根目录               |
| `TURNFLARE_DB`               | `~/.turnflare/turnflare.db`     | SQLite 路径，`:memory:` 可用 |
| `TURNFLARE_CORS_ORIGINS`     | `localhost:5173,127.0.0.1:5173` | 允许的跨域源，逗号分隔       |
| `TURNFLARE_MAX_FILE_BYTES`   | `52428800`                      | 单文件大小上限（50MB）       |
| `TURNFLARE_SCAN_CONCURRENCY` | `4`                             | 扫描并发度                   |
| `LOG_LEVEL`                  | `info`                          | 日志级别                     |
