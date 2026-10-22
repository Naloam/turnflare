# Roadmap

Updated 2026-10-22. Direction: make local Claude Code session investigation easy to
try, trustworthy and worth returning to. Checked items are delivered; unchecked items are plans.

## Foundation delivered

- [x] Windows installer and portable application; Apple Silicon and Intel Mac DMG/ZIP packages.
- [x] Desktop history detection, native folder selection and isolated example mode; no Node setup.
- [ ] Trusted developer signing and Apple notarization for smoother first launch.

- [x] Canonical type-only contracts shared by all packages.
- [x] Public Node.js entry for the API package.
- [x] One-origin dashboard and API with a source-based start command.
- [x] Synthetic demo, disposable storage and reproducible browser tests.
- [x] Server-side chain filtering before the session detail limit.
- [x] Project-scoped scans preserve nested subagent ownership.
- [x] Reproducible large-file benchmark with clean JSON output.
- [x] English project introduction, Chinese guide and contribution templates.

## Next: distribution and accessibility

- [x] Package the dashboard, migrations and CLI into a versioned installable release.
      Acceptance: a clean machine can launch a demo without building the monorepo;
      the package contains every asset and does not need runtime developer tools.
- [x] Add English UI and CLI help with a persistent dashboard language choice.
      Overview, list, detail and help support both languages. Full textual CLI reports and detailed API diagnostics still use Chinese.
- [x] Add session detail pagination and a visible shown/total count per chain.
      Acceptance: sessions above 500 turns are fully browsable without unbounded responses.
- [x] Add an explicit combined main/subagent usage view while retaining clear cost semantics.
      Acceptance: model, project and time views agree under the selected scope.
- [x] Confirm the GitHub repository identity, then configure topics, project description,
      release artifacts and a synthetic-data preview.

## Analytics delivered in v0.2.1

- [x] Unified date, project, model and chain filters with matching exports.
- [x] 52-week activity heatmap and daily/weekly/monthly usage tables.
- [x] Model details, tool call/error/result-size ranking and a local personal budget for the selected range.
- [x] Session metadata/preview search and a model selector.
- [x] Native report saving on desktop; browser downloads in four formats.

## Upcoming patch releases

Use patch versions for each update: v0.2.2, v0.2.3, and onward.

- [ ] Official statusline input and quota provenance, with stale/unavailable states.
- [ ] Codex provider with its own parsing, pricing and cache semantics.
- [ ] Full transcript search/export beyond the 200-character previews.
- [ ] Parent/child subagent tree and richer live session status.
- [ ] Configurable timezone and dedicated daily/monthly budgets.

## Validate before expanding

- [ ] Observe target users finding an expensive session and inspecting subagents.
- [ ] Collect synthetic examples for parser failures and usage discrepancies.
- [ ] Add a second data source only after a repeated user need is demonstrated.
- [x] Incremental live scanning and opt-out automatic dashboard refresh.
- [ ] Consider a status-line companion if user feedback shows a need.

## Measure

Track first successful launch, task completion during interviews, repeat use,
resolved parser bugs and release reliability. Use GitHub traffic and star changes
as distribution signals after publication. Do not add application telemetry by
default; opt-in research and repository metrics are sufficient to start.
