# Desktop development and distribution

The Electron shell reuses `@turnflare/api` through Fastify injection. A privileged, standard `turnflare://app/` protocol serves the built dashboard and API responses in-process. It never starts an HTTP listener. The stable application origin preserves language and theme across launches.

`packages/desktop` owns app lifecycle, source switching, isolated indexes, the native folder picker and a narrow preload bridge. Runtime parsing, indexing and reports stay in the API/core packages. Shared bridge types live in `packages/contracts/src/desktop.ts`.

## Build locally

Use Node 24 and pnpm 10 on the target operating system:

```bash
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm desktop:pack
pnpm test:desktop
```

Outputs go into `release/desktop`. Native dependencies are installed into a separate staging application and rebuilt for Electron, so the workspace's Node SQLite installation stays intact. The staging application uses pinned runtime dependency versions. Native modules are unpacked from ASAR.

The workflow `.github/workflows/desktop.yml` builds on native Windows, Apple Silicon and Intel runners. It tests the packaged app, the Windows installation and the app copied from the Mac DMG, then assembles a **draft** GitHub release with checksums and a CLI archive. Run it manually from GitHub Actions or push a version tag. A published release is never overwritten automatically. Signing/notarization are currently unavailable; see the release notes.

## Data and lifecycle

Default logs: `<home>/.claude/projects`. Native folder selection is persisted in Electron's per-user application data directory (`Turnflare/settings.json`). Hashed folder paths choose separate SQLite indexes under `Turnflare/indexes`; switching roots cannot mix their totals. Demo data is temporary and all demo POST requests are rejected. Quit waits for active indexing and closes SQLite.

Packaged smoke tests set `TURNFLARE_DESKTOP_USER_DATA` and `TURNFLARE_DESKTOP_DATA_ROOT` to disposable synthetic directories. These overrides keep tests away from developer history. No external listening port, API token or background service is needed.

## Renderer isolation

The renderer uses sandboxing, context isolation and disabled Node integration. IPC checks the requesting main frame and exact application host. The bridge exposes only state, native folder choice and local/example mode switches. Arbitrary filesystem paths and raw IPC are not exposed. Navigation, new windows, external network requests and device permissions are denied. The only external action is a fixed GitHub Help menu link opened in the system browser. The application protocol sets a restrictive CSP.
