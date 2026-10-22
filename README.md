# Turnflare 🔥

[![CI](https://github.com/Naloam/turnflare/actions/workflows/ci.yml/badge.svg)](https://github.com/Naloam/turnflare/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Naloam/turnflare)](https://github.com/Naloam/turnflare/releases)
[![MIT License](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)

**See where your Claude Code tokens go — from projects to individual turns and subagents.**

[简体中文](README.zh-CN.md) · [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Roadmap](docs/ROADMAP.md) · [Contributing](CONTRIBUTING.md)

Turnflare turns local Claude Code session logs into an interactive dashboard,
terminal reports and exportable analysis. Compare projects, investigate expensive
sessions, inspect tool calls, and separate main conversations from subagent activity.

**Local data. No API key. No telemetry.** Session analysis runs on your machine
with bundled pricing. CLI installation needs access to the package registry.

![Turnflare overview using synthetic example sessions](screenshots/demo-overview.png)

## Desktop app — no setup

**[Download for Windows or macOS](https://github.com/Naloam/turnflare/releases/tag/v0.2.1)**

| Platform | Download |
| --- | --- |
| Windows x64 | [Installer](https://github.com/Naloam/turnflare/releases/download/v0.2.1/Turnflare-0.2.1-windows-x64-setup.exe) · [Portable, no installation](https://github.com/Naloam/turnflare/releases/download/v0.2.1/Turnflare-0.2.1-windows-x64-portable.exe) |
| Mac, Apple Silicon | [DMG](https://github.com/Naloam/turnflare/releases/download/v0.2.1/Turnflare-0.2.1-mac-arm64.dmg) |
| Mac, Intel | [DMG](https://github.com/Naloam/turnflare/releases/download/v0.2.1/Turnflare-0.2.1-mac-x64.dmg) |

Open the app. Your history is detected automatically; **Choose history folder** selects a custom location. **Try examples** opens an isolated demo. No Node.js or terminal needed. Windows 10/11 x64 or macOS 13+ required.

Initial builds are unsigned/unnotarized and can show a system confirmation on first launch. See [installation and signing status](docs/releases/0.2.1.md).

## Try it

Requires **Node.js 22+** (22 or 24 recommended). Install the release directly from GitHub:

```bash
npm install --global https://github.com/Naloam/turnflare/releases/download/v0.2.1/turnflare-0.2.1.tgz
turnflare demo
```

Open **http://127.0.0.1:8787**. The demo includes nine synthetic sessions across three
projects. It uses an in-memory database, rejects write requests, and never reads
your Claude history. Ctrl+C stops it. The dashboard follows your browser language;
English and Chinese are available from the header. Language and theme preferences persist.

### Analyze your own sessions

```bash
turnflare start
```

This indexes `~/.claude/projects` and serves the dashboard and API at the same
address. It stores its index in `~/.turnflare/turnflare.db`. Incremental scanning and
dashboard refresh run every ten seconds, so new activity appears without restarting.
You can disable indexing with `TURNFLARE_WATCH_INTERVAL_MS=0`, or pause UI refresh in the header.

Set `TURNFLARE_DATA_ROOT` for a custom session location and `TURNFLARE_DB` for a custom
index. The server listens on the loopback interface and has no authentication.
See [security and privacy](SECURITY.md) before changing its network binding.

### From source

```bash
git clone https://github.com/Naloam/turnflare.git
cd turnflare
pnpm install --frozen-lockfile
pnpm demo       # synthetic data
pnpm start      # your sessions, with live indexing
```

Source development requires pnpm 10. There is no npm registry release yet;
`npx turnflare` is not an installation path. The GitHub release includes compiled
code, the dashboard and migrations; it does not require pnpm, TypeScript or a source build.
SQLite is a native dependency: if no prebuilt binary exists for your platform,
installation needs a C++ build toolchain.

## New in v0.2.1

Open **Analytics** for date presets or a custom UTC range, project/model filters, and
main/subagent/combined scope. Heatmaps, daily/weekly/monthly tables, model and tool
activity, and personal budgets share the selected data. Export that view as HTML,
CSV, Markdown or JSON; the desktop app uses a native Save dialog.

**Sessions** now searches IDs, paths, branches and indexed message previews (first
200 characters per message). Costs and budgets are API-equivalent estimates, not
subscription charges or official remaining quota.

![Turnflare analytics using synthetic example sessions](screenshots/demo-analytics.png)

## What can I investigate?

| Question                            | Turnflare shows                                              |
| ----------------------------------- | ------------------------------------------------------------ |
| Which project uses the most tokens? | Project comparison, model mix and daily/hourly trends        |
| What happened inside this session?  | Turn timeline, token breakdown, text previews and tool calls |
| How much work came from subagents?  | Separate activity totals and main/subagent filters           |
| Why is a cost missing?              | Explicit unpriced-model and estimated-cost indicators        |
| Can I use the results elsewhere?    | JSON, Markdown, CSV and self-contained HTML reports          |

The parser handles large JSONL lines, partial writes and repeated message IDs.
Incremental scans skip unchanged files and merge files belonging to the same session.
Chain filtering runs **before** the 500-turn detail limit, so subagents remain
accessible even in long main conversations. Each page shows at most 500 turns; previous/next controls let you browse the full chain.

![Main conversation and subagent filters in session detail](screenshots/demo-session.png)

## CLI

Use `turnflare --help` after installation. From source, use the repository command:

```bash
pnpm cli scan
pnpm cli stats --days 30
pnpm cli sessions --limit 20 --sort cost
pnpm cli session <session-id>
pnpm cli report --format html --out report.html
pnpm cli stats --json
pnpm cli models
pnpm cli serve --port 9000
# English help (normally selected from your locale)
TURNFLARE_LANG=en pnpm cli --help
```

For pipelines that require clean JSON, invoke the built entry directly:

```bash
node packages/cli/dist/bin.js stats --json > usage.json
```

## How it compares

[ccusage](https://github.com/ccusage/ccusage) offers quick terminal reports across
many coding agents. [Claude Code Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor)
focuses on live usage, rate limits and forecasts.
[claude-dashboard](https://github.com/uppinote20/claude-dashboard) puts usage and
context information directly in Claude Code's status line.

Turnflare focuses on **browsing session history, inspecting turns and subagents,
and exporting local analysis**. It currently supports Claude Code only, has no
subscription-limit monitor, and does not have an npm registry release yet. Choose the workflow that
fits your needs. [Research and trade-offs →](docs/COMPETITIVE_ANALYSIS.md)

## Cost semantics

Amounts are **API-equivalent estimates from local logs**, not subscription charges
or an invoice. Cache usage and speed affect calculations; unknown models contribute
zero cost and are explicitly marked as unpriced. Some pricing tiers cannot be
reconstructed from stored aggregates. See [pricing rules and limitations](docs/PRICING.md).

Overview costs, model/project charts and session totals describe the **main
conversation**. Subagent totals are reported separately; the overview is not a
combined bill for all agent activity.

## Architecture and development

```text
contracts  Shared type declarations; no runtime implementation
core       Streaming parser, usage aggregation and cost calculations
api        SQLite index, scanner, reports, HTTP and built dashboard hosting
cli        Commands using the public API package interface
web        React dashboard; workspace dependencies are type-only
```

```bash
pnpm check       # build, types, contract identity, lint and tests
pnpm --filter @turnflare/web exec playwright install chromium
pnpm test:e2e    # production dashboard, isolated synthetic data
pnpm bench       # parser benchmark
```

For development with hot reload, run `pnpm api` and `pnpm web` in separate terminals
after `pnpm build`. See the [development guide](docs/DEVELOPMENT.md).

Bug reports and contributions in English or Chinese are welcome. If Turnflare
helps you understand your agent usage, a star helps others discover it.

[MIT](LICENSE) · Not affiliated with Anthropic.
