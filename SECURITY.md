# Security and privacy

The desktop application uses a private `turnflare://app/` protocol and does not
open a network listening port. Its renderer is sandboxed with Node integration
disabled; a small, sender-checked bridge provides native folder selection.
Indexes and the selected history path stay in the per-user Turnflare application
data directory. Initial desktop builds are not developer-signed/notarized; see
the [release signing status](docs/releases/0.2.1.md).

Turnflare processes local conversation logs. The optional command-line server binds to
`127.0.0.1` and has no authentication. Keep it on your own machine; changing
`HOST` to a network interface makes session previews and local paths accessible
to that network. CORS is not authentication.

The application does not upload sessions, collect telemetry or request an API key.
The database contains message previews and project paths. Reports can contain
project identifiers; review them before sharing. Dependency installation may
need network access. The application itself uses bundled pricing data.

`pnpm demo`, browser tests and the default smoke test use generated example
sessions. The demo uses an in-memory database and rejects write requests.
The smoke test reads real sessions only when an explicit `--root` is provided.

For a vulnerability involving session disclosure or local file access, use the
repository's private vulnerability reporting feature when available. Do not put
real conversation logs, credentials or personal paths in a public issue.
