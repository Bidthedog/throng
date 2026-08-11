---
name: throng-daemon-persistence
description: Use for the detached daemon process, the named-pipe RPC between it and the Electron main process, the @throng/ipc-contract message shapes, and everything SQLite — schema, migrations, repositories, the schema-drift guard. Triggers include adding or changing an RPC method, "no such column", a migration that needs writing or re-running, daemon startup/shutdown/supervision/respawn, a foreign or elevated daemon instance, pipe-name or BUILD_ID mismatches, and persisted state that survives (or fails to survive) a restart.
---

# throng — daemon, IPC contract and persistence

throng runs a **detached daemon** so terminals outlive the UI process (Principle III). You own that
process, the wire between it and Electron main, and the SQLite store behind it.

## The three pieces

- `packages/daemon/src` — the daemon itself: `main.ts`, `composition-root.ts`, `ipc-server.ts`,
  `rpc-router.ts`, per-domain services (`terminal-service`, `project-service`, `workspace-service`,
  `document-service`, `subworkspace-service`, `panel-name-service`, `fileop-undo-service`,
  `health-service`), the PTY agent host (`pty-agent-*`), `terminal-lock-manager`, `reap-orphans`.
- `packages/ipc-contract/src` — the shared message shapes. Changing a method means changing this
  package, both sides, and the contract tests. It is the only thing preventing a silent skew between
  a daemon build and a UI build.
- `packages/persistence/src` — `database.ts`, `migration-runner.ts`, `schema-guard.ts`, the
  `*-repository.ts` implementations of `core`'s ports, and `migrations/v2…v8`.

The UI side of the wire lives in `packages/ui/src/main/daemon-client.ts`,
`daemon-lifecycle.ts`, `daemon-supervisor.ts`, `daemon-events.ts` — read those before changing the
handshake.

## Migrations — the two rules that matter

1. **Idempotent, always** (constitution, Technology & Architecture Constraints). A migration must be
   safe to re-run and safe against an already-migrated store, converging on the same state without
   erroring or duplicating data.
2. **Every `ALTER TABLE … ADD COLUMN` must be registered in `schema-guard.ts`** and applied through
   `addColumnsFor`. The runner only applies migrations above SQLite's `user_version`; the guard is
   what heals a database left half-migrated by an intermediate build. An unregistered additive column
   produces a store that reports "up to date" and throws `no such column: …` on every write.

Add a migration as `migrations/vN-<name>.ts` exporting `applyMigrationVN` and `MIGRATION_VN_VERSION`,
append it to the `MIGRATIONS` chain in `migration-runner.ts`, register any added columns in the guard,
and add a fixture under `packages/ui/tests/integration/fixtures/` proving an old store upgrades and a
re-run is a no-op.

## Environment the daemon reads

`THRONG_PIPE_NAME`, `THRONG_DATABASE_PATH`, `THRONG_CONFIG_ROOT`, `THRONG_LOCK_DIR`, `THRONG_LOG_DIR`
/ `THRONG_LOG_LEVEL` / `THRONG_LOG_MAX_KB` / `THRONG_LOG_KEEP`, `THRONG_STARTUP_TIMEOUT_MS`,
`THRONG_PING_TIMEOUT_MS`, `THRONG_SHUTDOWN_DRAIN_TIMEOUT_MS`, `THRONG_NO_ORPHAN_REAP`. Tests set these
to isolate a run; production defaults come from the user profile. Never hardcode a pipe name or a
database path in a test — take it from the harness.

## Where the layers are tested

- Integration (`packages/ui/tests/integration/`) — `daemon-lifecycle`, `daemon-supervisor`,
  `daemon-unavailable`, `daemon-elevated-respawn`, `daemon-foreign-instance`, `document-state`,
  `document-authority`. These spawn real processes and run **single-fork, serially** by design
  (`vitest.config.ts`, `osSerial`); do not "fix" a race there by adding parallelism.
- Contract (`packages/ui/tests/contract/`) — the interface-satisfaction layer.
- The daemon build stamps a `BUILD_ID`; the daemon-spawning layers need `npm run build` first, which
  is why CI builds before running unit/integration/contract.

## Failure behaviour

A dead or unreachable daemon is a **presented failure**, not a crash: see `core/src/failure/` and
`daemon-death-notice.e2e.ts`. Anything you add that can fail across the wire needs a cause the UI can
show, not a swallowed rejection.

## Not yours

PTY/ConPTY process mechanics and elevation → `throng-terminal-pty`. Renderer state clients under
`packages/ui/src/renderer/state/` → `throng-renderer-ui`. Editor document authority semantics →
`throng-editor-documents` (the persistence of document state is yours; the ordering/authority rules
are theirs).
