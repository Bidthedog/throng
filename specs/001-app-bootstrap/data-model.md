# Phase 1 Data Model: Application Bootstrap

This iteration defines **no domain entities and no domain tables** (FR-003, FR-011, Out of Scope).
The "data model" here is therefore limited to the small set of structural/config types and the
persistence baseline that the skeleton needs to prove it is wired. Real entities (Project, Terminal,
Edit, Layout, Preset) arrive in later features.

## Persistence baseline

| Item | Value |
|------|-------|
| Engine | SQLite via better-sqlite3, single local file |
| File location | From `IPersistenceSettings.databasePath` (per-user data dir; injected) |
| Schema version mechanism | SQLite `PRAGMA user_version` |
| Target baseline version | `1` |
| Tables created at baseline | **None** (no domain tables). An optional `_meta(key TEXT PRIMARY KEY, value TEXT)` marker row MAY record the baseline stamp; nothing domain-bearing. |

**Migration runner rules** (FR-011, FR-012, SC-005):

1. Open/create the database file at the configured path.
2. Read `PRAGMA user_version`.
3. If `< 1`, apply the baseline migration (no domain tables) and set `user_version = 1`.
4. If `== 1` (already baselined), make **no changes** (idempotent no-op).
5. Surface open/initialisation failures explicitly rather than swallowing them (spec Edge Case).

State transition (version):

```text
(absent DB) --create--> user_version=0 --baseline--> user_version=1 --(reopen)--> user_version=1 (no-op)
```

## Configuration types (typed settings — Principle X / [Gap C])

Defined as interfaces in `core/config`; concrete values bound per process in its composition root.
These are configuration contracts, not persisted domain data.

| Interface | Fields (bootstrap) | Default | Consumed by |
|-----------|--------------------|---------|-------------|
| `IPersistenceSettings` | `databasePath: string` | per-user app-data path | persistence, daemon |
| `IDaemonSettings` | `pipeName: string`; `startupTimeoutMs: number` | `\\.\pipe\throng.daemon`; `5000` | daemon |
| `IUiSettings` | `pipeName: string`; `window: { width: number; height: number }`; `pingTimeoutMs: number` | matching pipe name; `1280×800`; `2000` | ui (main) |

All fields are overridable via environment without code changes; defaults are documented in
`quickstart.md`.

## IPC message shapes (health.ping)

Defined in `ipc-contract`; shared by daemon (server) and ui (client). Full wire contract in
[contracts/ipc-health-ping.md](./contracts/ipc-health-ping.md).

| Type | Shape |
|------|-------|
| `HealthPingRequest` | JSON-RPC 2.0 request, `method: "health.ping"`, `params: {}` |
| `HealthPongResult` | `{ status: "ok"; daemonStartedAt: string /* ISO-8601 */; pid: number }` |
| `DaemonUnavailable` | Client-side outcome when no pipe/timeout: `{ available: false; reason: string }` (FR-010) |

## OS abstraction shape (Principle II)

Defined in `core/abstractions`; the only contract exercised in bootstrap. Full contract in
[contracts/os-platform-probe.md](./contracts/os-platform-probe.md).

| Type | Shape | Concrete impl |
|------|-------|---------------|
| `IPlatformInfo` | `osName(): "windows" \| "macos" \| "linux"`; `pathSeparator(): string` | `WindowsPlatformInfo` (in `platform-windows`) |

## Explicitly out of scope (no model yet)

Project, Terminal, Shell, Edit/ChangeReview list, Layout (Panel/Pane), Preset, Agent — all deferred
to later features. The skeleton only proves the persistence path and migration mechanism exist so
these tables can be added later via the established runner rather than retrofitted.
