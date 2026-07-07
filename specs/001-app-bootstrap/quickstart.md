# Quickstart: Application Bootstrap

A validation/run guide proving the skeleton works end-to-end. Implementation details live in
`tasks.md` and the code; this file is how a contributor (or reviewer) confirms the bootstrap is
green. Targets **Windows 11** (Node.js 20 LTS installed).

## Prerequisites

- Node.js 20 LTS (`node --version` → v20.x)
- Windows 11 (first supported target)
- A clean checkout of the repository

No Docker is required or used (spec assumption).

## Documented commands (FR-014)

Defined as root npm scripts in the workspaces `package.json`:

| Goal | Command |
|------|---------|
| Install everything | `npm install` |
| Build all components | `npm run build` |
| Run the daemon only | `npm run start:daemon` |
| Stop the daemon | `Ctrl+C` in its terminal (graceful SIGINT/SIGTERM shutdown releases the named pipe) |
| Run the UI only | `npm run start:ui` |
| Run everything together | `npm start` |
| Run all tests (unit + integration + contract + E2E) | `npm test` |
| Unit tests only | `npm run test:unit` |
| Integration tests only | `npm run test:integration` |
| Contract tests only | `npm run test:contract` |
| E2E tests only | `npm run test:e2e` |

## Validation scenarios

Each scenario maps to a Success Criterion in the spec.

### V1 — Clean checkout builds and tests green (SC-002, US2)

```text
npm install
npm run build      # all packages compile
npm test           # unit + integration (incl. contract sub-suite) + E2E all pass (green)
```

Expected: build succeeds for every package; all three test layers pass — the `contract` runner
project executes within the integration layer (FR-015), not as a fourth layer. (See
[contracts/](./contracts/) for the IPC and OS contract tests.)

### V2 — App launches to the landing page (SC-001, SC-006, SC-008, US1)

```text
npm start
```

Expected: within 5 s a single window opens showing the "Hello World" landing page that identifies
the app as **throng** with a placeholder welcome message; the window is movable/resizable/closable
and a default theme is visibly applied; closing it exits the UI cleanly.

### V3 — UI↔daemon ping round-trip (SC-004, US3)

With `npm start` running, the landing page reflects a **successful** `health.ping` round-trip to
the daemon (per [contracts/ipc-health-ping.md](./contracts/ipc-health-ping.md)).

Daemon-down check: run `npm run start:ui` **without** the daemon — the UI reports the daemon as
**unavailable** (it does not hang or crash) within the configured ping timeout (FR-010).

### V4 — Persistence store initialises (SC-005, US4)

Starting the daemon against a **fresh** data directory creates the SQLite file, runs the baseline
migration (`user_version` → 1, no domain tables), and a trivial read/write smoke check succeeds.
Starting again against the existing store is a **no-op** (migration runner detects current version).
Covered by `packages/persistence/tests/integration/`.

### V5 — Every component is tested (SC-003)

`npm test` exercises at least one automated test for **each** of: core, platform-windows
(contract), persistence (integration), daemon (integration), and ui (E2E). The `contract`
runner project is a sub-suite of the **integration** layer (FR-015), not a fourth layer.

### V6 — Structural review (SC-007, SC-010)

A reviewer confirms: zero product features (no project/terminal/agent functionality); `core` imports
no OS or Electron/process APIs; `platform-windows` is the only OS seam; `daemon` and `ui` each have
exactly one composition-root container.

## Configuration (defaults, overridable — Principle X)

| Setting | Default | Override |
|---------|---------|----------|
| Daemon pipe name | `\\.\pipe\throng.daemon` | env var, read in the composition root only |
| Database path | per-user app-data dir | env var |
| Window size | 1280×800 | env var |
| UI ping timeout | 2000 ms | env var |

No configuration value is hardcoded inside business logic; all are injected via typed settings.

## Done = green

The bootstrap is complete when V1–V6 all pass on a clean Windows checkout and a structural review
confirms no product features leaked in.
