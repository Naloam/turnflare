# Turnflare 竞品研究与定位

调研日期：**2026-10-22**。功能依据各项目当日的 README，star 数取自 GitHub REST API，
只是当日快照，不能据此推断用户留存或增长原因。未对竞品做安装性能实测。

## 结论

建议把 Turnflare 的定位集中为：**本地 Claude Code 会话检查器，解释 token 在会话、工具和 subagent 中的去向。**

“更多图表”“本地处理”“token 统计”已有成熟竞品覆盖。更有希望形成识别度的组合是：
能直接演示的会话详情、长会话里可用的 subagent 筛选，以及口径清楚的导出报告。
这是基于产品能力的判断，尚未经过用户访谈验证。

## 对照

| 项目                                                                                      | 当日 star | 主要工作流与入口                                                                    | Turnflare 相比的机会                           | Turnflare 当前不足                             |
| ----------------------------------------------------------------------------------------- | --------: | ----------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| [ccusage](https://github.com/ccusage/ccusage)                                             |    19,123 | `npx ccusage@latest`；多种 coding agent 的日/周/月/会话报表、状态栏、配置和离线定价 | 把历史会话浏览、turn、工具和侧链检查做得更直观 | 数据源覆盖、安装便利性、文档与生态积累差距明显 |
| [Claude Code Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) |     8,755 | Python 安装；终端实时监控、额度提醒和预测                                           | 专注事后排查与可浏览的报告                     | 没有实时订阅额度与耗尽提醒，日常驻留场景较弱   |
| [claude-dashboard](https://github.com/uppinote20/claude-dashboard)                        |       582 | Claude Code 插件；状态栏中的上下文、用量、成本和活动信息                            | 提供独立的历史分析界面                         | 用户需要离开编码界面查看，配置和启动步骤也更多 |

来源：
[ccusage README](https://github.com/ccusage/ccusage/blob/main/README.md)、
[Usage Monitor README](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/blob/main/README.md)、
[claude-dashboard README](https://github.com/uppinote20/claude-dashboard/blob/main/README.md)。
Star 快照来源：
[ccusage API](https://api.github.com/repos/ccusage/ccusage)、
[Usage Monitor API](https://api.github.com/repos/Maciek-roboblog/Claude-Code-Usage-Monitor)、
[claude-dashboard API](https://api.github.com/repos/uppinote20/claude-dashboard)。

## 已有优势与需要谨慎的地方

当前代码已有流式 JSONL 解析、截断容错、消息去重、增量 SQLite 索引、同会话多文件合并、
主对话/侧链分别汇总和四种导出格式。这些适合支撑“解释一场会话”的工作流。

这些能力并不证明独家优势。竞品同样支持缓存 token、本地日志和成本分析，不能把“隐私”或
“价格最准确”写成未经验证的排他性宣传。Turnflare 的成本也不是发票：未知模型、阶梯价和
聚合后丢失的细节都会影响结果。

主要短板包括：只支持 Claude Code、缺少实际用户反馈、没有 npm registry 分发，也尚未实现订阅额度监控。
本轮已补齐 GitHub 安装包、双语仪表盘、实时更新和详情分页，仓库为 Naloam/turnflare。

## 本轮已落实

- 三份手工复制的类型改为 `@turnflare/contracts` 单一声明；校验覆盖声明身份而非只比字段名。
- 后端增加公开入口，CLI 不再导入 `dist` 内部文件。
- 一个地址提供构建后的仪表盘和 API；`pnpm start` 串起构建、扫描和启动。
- `pnpm demo` 用固定示例与内存数据库提供可体验的完整界面，不读取真实历史。
- 长会话的链条筛选先于详情截断执行，避免主对话超过 500 条后看不到 subagent。
- 项目归属统一由核心发现模块解析，按项目扫描也保留嵌套 subagent。
- 性能基准默认使用固定的大文件示例，修复缺少个人日志时 CI 失败和 JSON 输出混入文字的问题。
- E2E 使用固定示例，验证实际构建产物，取消依赖个人历史和现成开发服务。
- 英文首页、中文说明、许可证、贡献入口和问题模板补齐。

## 接下来怎么判断投入是否值得

先让 5–10 位目标用户用自己的会话完成两个任务：“定位最贵会话”和“解释其中的 subagent 活动”。
记录是否能独立完成、卡在哪里、是否会再次打开。这里的数量是建议的访谈规模，不是已有用户。

安装包、英文界面与详情翻页已完成。确认有人持续使用会话检查后，再按请求补 Codex
等数据源。大规模补 provider 会增加解析维护与定价核对成本，不能用功能数量替代需求证据。

传播材料建议围绕一个可复现故事：一场会话里，主对话与 subagent 各用了多少 token，
如何通过筛选找到对应 turn。用示例截图和短录屏展示，提供明确的运行入口。
GitHub 仓库采用 Naloam/turnflare，配套 topics、项目简介和 release。公开托管演示与社区投稿仍待后续安排。

不购买 star，不自动给陌生项目发推广消息。目标是让合适的开发者发现并能用起来；
star 是结果指标，不能承诺数量。

## 功能借鉴与实现来源

本轮借鉴 ccusage 的低门槛安装与机器可读输出、Usage Monitor 的持续更新体验，
以及状态栏工具的轻量操作方式。实现沿用本项目的解析与存储模块，没有复制这些项目的源代码。
后续若引入代码，会核对对应版本的许可证并保留版权与署名。依赖继续通过包管理器分发各自的许可证。

新增功能包括可安装的 GitHub Release、英中文界面和命令帮助、每链分页、默认每 10 秒增量扫描、
可暂停的页面自动刷新。没有把本地估算伪装成官方订阅额度或实际账单。


## v0.2.1 功能对齐（2026-10-22）

本轮核对了以下主分支 README、相关实现和 MIT LICENSE，采用功能思路，未复制源码或新增运行时依赖。

| 参考 | 已借鉴并交付 | 仍有差距 |
| --- | --- | --- |
| [ccusage](https://github.com/ccusage/ccusage/blob/main/apps/ccusage/README.md) | 日期筛选、日/周/月报 | 自定义时区、多 provider、statusline |
| [claude-view](https://github.com/tombelieber/claude-view/blob/main/README.md) | 活动热图、工具排行、界面导出 | 全文检索、subagent 树 |
| [claude-code-sessions](https://github.com/kmizzi/claude-code-sessions/blob/master/README.md) | 模型筛选、元信息/预览搜索、周期明细 | FTS5 全文和可选语义检索 |
| [claude-dashboard](https://github.com/uppinote20/claude-dashboard/blob/main/README.md) | 本机预算和 80%/95%/超额提示 | 固定日/月预算与编码界面的常驻入口 |
| [Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/blob/main/README.md) | 明确区分成本估算与官方额度 | 官方 statusline rate_limits 接入、来源和失效状态、预测 |

本版统一的是分析页的 turn 时间、项目、模型与链范围，四种导出和所有分析图表遵循同一范围。
旧总览仍保留主对话与侧链并列的语义。工具只展示次数、错误和结果字符数，不猜测单工具成本。
搜索仅覆盖当前持有的 200 字预览和元信息，没有把预览检索宣传成全文检索。

预算是用户为当前筛选设置的 API 等价成本预算，不是 Claude 订阅额度；日期按 UTC，周一为每周起点。
与竞品相比，下载即可启动的 Windows/macOS 应用和链范围一致的导出是目前的便利性优势；
数据源广度、官方额度、全文检索、签名公证和社区积累仍是短板。功能研究未包含竞品安装或性能实测。
