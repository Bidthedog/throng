# Implementation Plan: Terminal Output Pipeline — Cost Follows What Is Visible

**Branch**: `feature/S061-I481-terminal-output-pipeline` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/061-terminal-output-pipeline/spec.md`

## Summary

Output cost stops scaling with every running terminal. The daemon publishes a terminal's output only while a view is
attached; main sends it only to windows with that view; a window routes it through one listener. Deliveries carry a
position so replay and live output join with no gap or duplicate. The daemon batches per terminal, keeping chunk
boundaries so clear detection is unchanged. Each terminal keeps its latest 10,000 lines, which a returning view
replays in slices. #162 is reproduced at forced fractional scale factors before it is fixed. A GPU renderer is
evaluated last. Details and rejected alternatives: [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 6 (strict), Node and Chromium via Electron 44

**Primary Dependencies**: `@xterm/xterm` 6, `@xterm/addon-fit` 0.11, `node-pty` 1.1, Inversify. No new dependency unless
the GPU evaluation passes SC-006.

**Storage**: None. All new state is in memory ([data-model.md](data-model.md)).

**Testing**: Vitest (unit, component, integration, contract) through `td`; Playwright for two E2E specs; a separate
measurement script outside the lanes.

**Target Platform**: Windows and Linux. No per-OS code is added.

**Project Type**: Desktop app (Electron main and renderer, detached daemon).

**Performance Goals**: SC-001 – SC-006 and SC-010.

**Constraints**: Principle XII: no replay or batch may block the window. Daemon CPU per chunk must not grow with what
is kept, because it hosts every terminal.

**Scale/Scope**: 17 projects, 34 terminal panels, 23 live shells (the maintainer's measured day).

## Constitution Check

*GATE: passed before Phase 0, re-checked after Phase 1.*

| Principle | Status | Note |
|---|---|---|
| I Project isolation | Pass | Routing is per panel; no state crosses projects. |
| II Platform-abstracted core | Pass | New domain code is in `core`, with no OS calls. |
| III Detached terminals, no orphans | Pass | Sessions are unaffected by routing. Batch timers are cleared with the session (FR-070). |
| IV Terminal keyboard | Pass | No bindings. |
| V Test-first | Pass | Each slice starts red at its lowest layer; #162 is replicated before any fix. |
| VI Simple UX | Pass | No new surface. |
| VII Change review | N/A | |
| VIII SOLID, DRY, YAGNI | Pass | One batching hop. No gap-recovery path without a known trigger (R4). |
| IX DI | Pass | `TerminalEvents` stays injected; new main class is passed in like `DaemonEvents`' collaborators. |
| X Externalised configuration | Pass | No setting; the limits are fixed by the user's decision. |
| XI Dockable workspace | Pass | Panel lifecycle unchanged. |
| XII Responsive UI | Pass | Replay sliced (R6). Measured by FR-060 on a large input. |
| XIII Failure leaves a trace | Pass | Gaps are logged (FR-013). |
| Configuration-editor completeness | N/A | No setting. |
| Documentation currency | Pass | `docs/architecture.md` (output path), `docs/testing.md` (measurement script). |

## Delivery Order

Each step lands green and independently, so FR-061 can measure it.

1. **Measurement** (FR-060): harness and baseline, before any production change.
2. **Positions** (FR-010 – FR-014, FR-024 groundwork): contract fields, gate rewrite. No behaviour change on screen.
3. **Retention and replay** (FR-015 – FR-017): `RetainedOutput`, panel scrollback, sliced replay. Existing tests pinning
   64 KB change here: `terminal-service-wiring.test.ts`, `terminal-hygiene.integration.test.ts`.
4. **Routing in main and window** (FR-001, FR-004 – FR-008).
5. **Daemon gate and reconnect** (FR-001a, FR-002, FR-003, FR-005a). After 4, because routes supply the subscribe list.
6. **Batching** (FR-020 – FR-025).
7. **#162 replication, then fix** (FR-040 – FR-045). The reproducing spec lands before any fix.
8. **GPU evaluation** (FR-050, FR-051).
9. **Docs and final measurements**.

## Project Structure

### Documentation (this feature)

```text
specs/061-terminal-output-pipeline/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/terminal-output.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
packages/core/src/terminal/
├── retained-output.ts           # new; replaces scrollback-tail.ts in the daemon
└── output-constants.ts          # new
packages/ipc-contract/src/terminal.ts          # contract changes
packages/daemon/src/
├── terminal-events.ts           # per-panel batching, flush ordering
├── terminal-service.ts          # retained, position, outputViews, replayEnd
└── ipc-server.ts                # terminal.subscribe carries views
packages/ui/src/main/
├── terminal-output-routes.ts    # new
├── daemon-events.ts             # routes output; sends views on subscribe
└── terminal-ipc.ts              # route before the attach RPC
packages/ui/src/preload/preload.cts
packages/ui/src/renderer/terminal/
├── output-router.ts             # new; one listener per window
├── output-gate.ts               # position-aware
├── replay-slices.ts             # new
├── capacity.ts                  # new, if #162's cause is confirmed
└── use-terminal.ts
packages/ui/tests/measure/       # new; outside the E2E lanes
```

**Structure Decision**: Existing packages, one new file per new responsibility. `use-terminal.ts` gains only the wiring.

## Complexity Tracking

No violations.
