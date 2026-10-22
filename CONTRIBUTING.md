# Contributing to Turnflare

Bug reports, parser fixtures, documentation improvements and pull requests are welcome.
Start with [the roadmap](docs/ROADMAP.md) or an existing issue. Describe a larger change
in an issue before implementing it so we can agree on scope.

## Run locally

Use Node.js 22+ (22 or 24 recommended) and pnpm 10.

```bash
pnpm install --frozen-lockfile
pnpm demo
```

The demo runs on `http://127.0.0.1:8787` with synthetic sessions and an in-memory
database. It does not read your Claude history. Stop it with Ctrl+C.

## Make a change

- Shared domain and HTTP types live in `packages/contracts/src`.
- Parsing and cost calculation live in `packages/core/src`.
- SQLite, scanning, reports and HTTP live in `packages/api/src`.
- The dashboard lives in `packages/web/src`; commands live in `packages/cli/src`.
- Import `@turnflare/api` through its public entry, never its `dist` or `src` internals.
- Browser imports from workspace packages must use `import type`.

For fixes, add a small regression test that exercises the public behavior.
Parser fixtures should be synthetic or stripped of prompts, credentials and personal paths.

```bash
pnpm check
pnpm --filter @turnflare/web exec playwright install chromium
pnpm test:e2e
```

Use a Conventional Commit title such as `fix: load subagent turns before applying the detail limit`.
In a pull request, describe the user-visible result and how you verified it.
English and Chinese contributions are both welcome.
