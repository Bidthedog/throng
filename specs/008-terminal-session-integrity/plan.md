# Implementation Plan: Terminal Session Integrity

**Branch**: `008-terminal-session-integrity` | **Date**: 2026-07-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-terminal-session-integrity/spec.md`

## Summary

Two defects in terminal panels, both rooted in the **daemon**:

1. **A running program is killed when its tab is dragged into a new sub-workspace.** The daemon's session
   reuse is keyed by a `launchKey` that *includes the working directory*. A mirror into a sub-workspace
   window resolves a different `cwd`, so the launch looks different and the still-running session is
   **reaped** (`reapForReplace`) to cold-start a "replacement". The running agent/build/SSH dies and the
   sub-workspace reports a connection timeout (the attach reused the health-check budget and gave up).
2. **The same terminal garbles in two different-sized windows.** Each view fits xterm to its own pixels and
   sends its own `terminal.resize`; the daemon applies the **last** one to the single shared PTY
   (last-writer-wins). The larger view then renders a grid ConPTY sized for the smaller one — corruption.

**Headline decision — the fix lives in the daemon and the IPC contract; the renderer is plumbed, not
re-architected.** The daemon is the only component that observes every window, so it is the correct owner of
(a) session-reuse identity and (b) the character grid. The fix is:

- **Launch key drops `cwd`** → `launchKey = [file, args, runAsAdmin]`, and **a running session is never
  reaped** — both halves, so neither a mirror's differing root nor a genuine re-type can destroy a running
  program (FR-002, FR-007).
- **View identity + grid minimum move into the daemon.** `attach`/`resize` carry a `viewId`; a new
  `terminal.detach(panelId, viewId)` removes a view. The daemon tracks each view's `{cols, rows}`, computes
  `grid = max(1, min(cols)) × max(1, min(rows))` across all attached views, and issues **one** PTY resize,
  only when the computed grid actually changes (FR-009, FR-010, FR-012, FR-013).
- **Attach gets its own budget.** A new injected `attachTimeoutMs` (≫ `pingTimeoutMs`) is used for the
  `terminal.attach` RPC; `pingTimeoutMs` stays for `health.ping`. A timeout renders a non-fatal
  **"still starting"** state with a **themeable-icon** retry (constitution v3.12.0), never reverting the
  panel to the type form and never killing the session (FR-004, FR-005).
- **Detach is backstopped by window-close.** The renderer sends `detach` on view unmount; UI main also
  sends `detach` for every view a closing window held, so a crashed renderer can never strand the grid at a
  departed view's dimensions (FR-008a).
- **A larger-than-grid view pads, it does not stretch.** The renderer renders xterm at the daemon-reported
  grid and fills the surplus with the terminal background — no clip/stretch/duplicate (FR-011).

**Ownership resolves in the window before the first attach** (FR-001): a sub-workspace window holds a loading
state until it has resolved the origin project's root, so a cold start can never attach at the wrong `cwd`;
the panel-keyed session reuse is the independent safety net for a mirror.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 20 LTS (ESM); React 18 (renderer).

**Primary Dependencies**: Electron (UI shell; UI-main owns the daemon client, window lifecycle, terminal
IPC); the headless plain-Node **daemon** (owns PTY sessions via `IPtyHost`/node-pty/ConPTY); `@xterm/xterm`
+ `@xterm/addon-fit` (renderer terminal view); InversifyJS + reflect-metadata (per-boundary DI); Vitest
(unit / integration / contract); Playwright-Electron (E2E). **better-sqlite3 / persistence and the editor
stack are untouched.**

**Storage**: **No schema change.** Terminal sessions are in-memory in the daemon (keyed by `panelId`); this
feature changes that record's identity and view-tracking, not any persisted table. `user_version` is
unchanged. The two new configuration values (`attachTimeoutMs`, and the reuse of view identity) are injected
settings, not stored state.

**Testing**: Vitest **unit** (daemon `TerminalService`: grid = min across N views with a `FakePtyHost`
asserting exactly-one PTY resize on change and none on focus/no-op; clamp to ≥1×1; `launchKey` excludes
`cwd`; a running session is reused, never reaped, on same **and** differing launch; detach recomputes the
grid; last-view-of-rootless terminates while last-sub-workspace-view-of-a-project session survives; core
`attachTimeoutMs` settings default + env override). Vitest **integration** (daemon `terminal-harness`: a
real two-view attach with different sizes drives the PTY to the smaller grid; detach of the smaller view
grows it; a mirror attach with a different `cwd` reuses the running session and never kills the PTY — the
process-survival assertion). Vitest **contract** (`terminal.attach`/`terminal.resize` accept `viewId`;
`terminal.detach` round-trips; the RPC shapes match `@throng/ipc-contract`). **Playwright-Electron E2E**
(multi-window: drag a tab hosting a live long-running program into a new sub-workspace → program survives,
both views stream, neither window errors; one session in two different-sized windows renders legibly with the
grid at the smaller size; a slow-starting shell shows "still starting" then attaches on retry). RGR
mandatory; generated temp files self-clean (constitution v3.9.0).

**Target Platform**: Windows 11 desktop (first supported). PTY spawning and the per-terminal ConPTY host sit
behind the existing `IPtyHost` abstraction (Principle II); no new OS seam is introduced.

**Project Type**: Desktop application (Electron UI client + headless plain-Node daemon), npm-workspaces
monorepo (extends 001–007). **This feature touches `ipc-contract`, `daemon`, `core` (settings), and `ui`
(main + renderer) only; `persistence` and `platform-windows` are not modified.**

**Performance Goals**: Establishing a terminal succeeds even when the shell takes several seconds to
initialise (SC-006) — the attach budget is sized for a shell, not a ping. Resizing is silent unless the
computed grid changes; focus changes and no-op reflows send **zero** resize messages to the session (SC-003).

**Constraints**: No Docker; npm scripts only. `@throng/core` stays OS/DOM-free — the only core change is an
injected settings field (`attachTimeoutMs`). The grid-minimum and reuse logic live in the **daemon** boundary
(one composition root); the renderer stays sandboxed and reaches terminals only through the preload
`terminal.*` bridge → UI main → daemon RPC. Configuration (both timeouts) is injected, never hardcoded
(Principle X). The retry affordance is a **themeable icon** with a hover title, its glyph and colours from
theme tokens (constitution v3.12.0).

**Scale/Scope**: Single user, single machine, local-only. A panel may have a handful of views (main window
+ one or more sub-workspaces). Packages touched: `ipc-contract` (`viewId` on attach/resize; `terminal.detach`
method + params), `daemon` (`TerminalService` view-tracking + grid min + reuse/never-reap + detach lifecycle;
its tests), `core` (`IUiSettings.attachTimeoutMs` + default), `ui` main (`DaemonClient` per-call timeout;
`terminal-ipc` viewId/detach plumbing + attach budget; window-close detach backstop), `ui` renderer
(`use-terminal` viewId + detach-on-unmount + grid-driven sizing/padding; `terminal-panel` still-starting
retry with a themeable icon). **No daemon SQLite/persistence change; no `platform-windows` change.**

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against all eleven principles of constitution **v3.12.0** (adds the **Themeable icon controls**
rule — the retry affordance honours it; Principle V **every user-facing UI change ships passing E2E** —
honoured; Documentation-currency merge gate — README/ROADMAP reconciled at close).

| # | Principle | Verdict | How this plan satisfies it |
|---|-----------|---------|----------------------------|
| I | Project-First Context Isolation | ✅ PASS | Ownership (project vs sub-workspace) determines the session's `cwd` and lifetime; FR-001 makes ownership resolve **before** the first attach so a terminal never connects at the wrong root. A project-owned mirror's session survives its sub-workspace views closing; a sub-workspace-owned session ends with its last view. |
| II | Platform-Abstracted Core | ✅ PASS | No new OS seam. PTY spawning/resizing stays behind the existing `IPtyHost`; the grid-minimum + reuse logic is pure orchestration in the daemon, unit-tested with a `FakePtyHost`. Core stays OS/DOM-free (only an injected settings field added). |
| III | Detached/Persistent Terminals | ✅ PASS (central) | This feature **strengthens** III: a running program is never killed by a window move, re-render, or identity change (FR-007); the three permitted termination causes are exactly panel-destroy, last-view-of-a-sub-workspace-panel, and explicit kill. Resource hygiene is preserved — a terminated session still reaps its ConPTY host. |
| IV | Native Terminal Support & Auto-Detection | ✅ PASS | Flavour resolution and `cwd` defaults are unchanged; the fix is to session identity/lifetime, not shell detection. |
| V | Test-First Quality Discipline | ✅ PASS | Unit (daemon grid/reuse/detach; core settings) + integration (real two-view PTY sizing; mirror survival) + contract (`viewId`/`detach` RPC shapes) + **E2E for the UI changes, observed green** (drag-survival; dual-size render; slow-start retry). The launch-key regression is reproduced by updating the existing `terminal-reattach-identity` unit test to the new behaviour first (Red), then the code (Green). |
| VI | Simple, Modern, Discoverable UX | ✅ PASS | A "still starting" state with a discoverable retry replaces a silent timeout/revert; both views of a mirror stay legible. No new workflow; the docking model is untouched. |
| VII | Change Review & Approval | ✅ PASS (N/A) | The edit list is not touched. |
| VIII | SOLID/DRY/YAGNI | ✅ PASS | The daemon **already** owns the session registry — this puts view identity and the grid where the knowledge already lives (SRP), rather than duplicating a minimum across renderers. `reapForReplace` on a running session is **deleted**, not guarded (YAGNI/simpler). `viewId` reuses the existing `panelId`-keyed plumbing. No speculative generality. |
| IX | DI & Composition Root | ✅ PASS | Still three roots (daemon, UI main, UI renderer). `attachTimeoutMs` is constructor-injected via `IUiSettings` in the UI-main root; no new container, no ambient state. |
| X | Externalised Configuration | ✅ PASS | Both timeouts are injected settings with documented defaults and env overrides (`THRONG_PING_TIMEOUT_MS`, `THRONG_ATTACH_TIMEOUT_MS`); the grid clamp minimum is a named constant. No magic values in logic. |
| XI | Dockable Workspace: Panes, Tabs & Panels | ✅ PASS | A mirrored panel legitimately has views in several windows; this feature makes that model **correct** without changing how panels are dragged, cloned, or laid out. |

**Themeable icon controls (v3.12.0):** the FR-005 retry affordance is an **action control** → a themeable
icon with a hover title, glyph + colours from theme tokens (not inline SVG, not a text button). It is not a
dialog decision button, so the text-label exception does not apply.

**Architecture constraints**: daemon owns terminals (unchanged) ✅; renderer sandbox preserved (terminals via
the `terminal.*` bridge) ✅; single composition root per boundary ✅; Electron+TS baseline, reuse-not-fork
(node-pty/xterm.js) ✅; no SQLite migration ✅.

**Gate result: PASS — no violations.** Deliberate, compliant decisions recorded under
[Complexity Tracking](#complexity-tracking).

## Phased Delivery

Each phase is an independently shippable, **independently verified** increment. Build order is
**A → B → C → D** (contract seam first, then the daemon logic it enables, then the client plumbing, then the
renderer UX + E2E).

| Phase | Delivers (verify point) | Touches | E2E gate |
|------|--------------------------|---------|----------|
| **A — Contract seam** | `viewId` on `TerminalAttachParams`/`TerminalResizeParams` (optional for back-compat: absent ⇒ a single implicit view); `TERMINAL_DETACH_METHOD` + `TerminalDetachParams`. | `ipc-contract` | Contract test: attach/resize accept `viewId`; `terminal.detach` round-trips. |
| **B — Daemon: identity + grid + lifetime** | `launchKey` drops `cwd`; running sessions reused never reaped; per-view `{cols,rows}` map; `grid = clamp(min)`; one PTY resize only on change; `detach` recomputes + terminates only the last view of a rootless (sub-workspace-owned) session. | `daemon/terminal-service` + its unit/integration tests | Integration: two different-size views drive the smaller grid; a mirror with a different `cwd` reuses the live PTY (survival). |
| **C — Client plumbing + attach budget** | `attachTimeoutMs` (core settings + env); `DaemonClient.call` per-call timeout; `terminal-ipc` forwards `viewId`, adds `throng:terminal:detach`, uses the attach budget; UI-main window-close detach backstop. | `core/config/settings`, `ui/main` (`daemon-client`, `terminal-ipc`, window lifecycle) | Unit: settings default/override. Integration: attach uses the larger budget; a slow shell does not time out. |
| **D — Renderer UX + E2E** | `use-terminal` generates a `viewId`, sends `detach` on unmount, carries `viewId` on resize, and sizes xterm to the daemon grid with background padding; `terminal-panel` renders the non-fatal "still starting" state with a **themeable-icon** retry; a mirror holds a loading state until ownership resolves. | `ui/renderer` (`use-terminal`, `terminal-panel`, terminal CSS) | E2E: drag-a-running-program-into-a-sub-workspace survival; dual-size legible render; slow-start "still starting" → retry attaches. |

## Project Structure

### Documentation (this feature)

```text
specs/008-terminal-session-integrity/
├── plan.md              # This file
├── spec.md              # Feature spec (clarified 2026-07-10)
├── tasks.md             # Phase 2 output (/speckit-tasks)
└── checklists/
    └── requirements.md  # Spec-quality checklist (16/16)
```

### Source Code (repository root)

Extends the existing monorepo. **New** files marked `(new)`; **extended** marked `(ext)`. Phase tags
`[A]…[D]` show when each lands.

```text
packages/
├── ipc-contract/
│   └── src/terminal.ts                     # (ext)[A] viewId on Attach/Resize params; TERMINAL_DETACH_METHOD + TerminalDetachParams
├── daemon/
│   ├── src/terminal-service.ts             # (ext)[B] launchKeyOf(no cwd); reuse-never-reap; per-view {cols,rows}; grid=clamp(min); resize-on-change; detach() lifecycle
│   └── tests/
│       ├── unit/terminal-grid.test.ts      # (new)[B] min across N views, clamp ≥1, resize-only-on-change, no resize on focus/no-op
│       ├── unit/terminal-detach.test.ts    # (new)[B] detach recomputes grid; last-view-of-rootless terminates; project mirror survives
│       ├── unit/terminal-reattach-identity.test.ts # (ext)[B] REWRITTEN: running session reused (never reaped) on same AND differing launch; cwd not in key
│       └── integration/terminal-grid.integration.test.ts # (new)[B] real two-view PTY sizing + mirror survival via terminal-harness
├── core/
│   ├── src/config/settings.ts              # (ext)[C] IUiSettings.attachTimeoutMs + DEFAULT_ATTACH_TIMEOUT_MS
│   └── tests/unit/app-settings.*.test.ts   # (ext)[C] attachTimeoutMs default + env override
└── ui/
    ├── src/
    │   ├── main/
    │   │   ├── daemon-client.ts             # (ext)[C] call(method, params, timeoutMs?) — per-call timeout override
    │   │   ├── terminal-ipc.ts              # (ext)[C] forward viewId; throng:terminal:detach; attach uses attachTimeoutMs
    │   │   ├── composition-root.ts          # (ext)[C] attachTimeoutMs from env/default
    │   │   ├── main.ts                       # (ext)[C] pass attachTimeoutMs into settings
    │   │   └── window-manager.ts             # (ext)[C] on window close, detach every view the window held (backstop, FR-008a)
    │   ├── preload/preload.cts              # (ext)[C] terminal.detach; viewId on attach/resize
    │   └── renderer/
    │       ├── terminal/use-terminal.ts     # (ext)[D] per-mount viewId; detach on unmount; viewId on resize; size to daemon grid + background padding
    │       ├── terminal/terminal-panel.tsx  # (ext)[D] non-fatal "still starting" state + themeable-icon retry; loading-until-ownership
    │       └── terminal/terminal.css        # (ext)[D] still-starting + padding styling from theme tokens
    └── tests/e2e/
        ├── terminal-mirror-survival.e2e.ts  # (new)[D] drag a running program into a sub-workspace → survives, both stream, no error
        ├── terminal-dual-size.e2e.ts        # (new)[D] one session in two different-sized windows renders legibly at the smaller grid
        └── terminal-slow-start.e2e.ts       # (new)[D] slow shell → "still starting" → retry attaches
```

**Structure Decision**: Extend the 001–007 monorepo. **The knowledge moves to where it belongs**: the daemon
— already the single owner of the `panelId`-keyed session registry and the only component that sees every
window — becomes the owner of view identity and the character grid, so the minimum is computed once and is
unit-testable with no windows open. The IPC contract gains a `viewId` (back-compatible: absent ⇒ one implicit
view) and a `terminal.detach` method. The renderer is **plumbed** (viewId, detach-on-unmount, grid-driven
sizing, still-starting retry), not re-architected. Configuration (both timeouts) is injected. No persistence,
`platform-windows`, or SQLite surface changes.

## Complexity Tracking

> No Constitution Check violations. Rows below are deliberate, compliant decisions recorded for reviewer
> scrutiny (Dev Workflow gate).

| Decision | Why needed | Alternative rejected because |
|----------|------------|------------------------------|
| **Grid minimum + view identity live in the daemon** | The daemon is the only component that observes every window; computing `min` there means one authoritative grid, one PTY resize, and a unit test that needs no windows (FR-009). | **Each renderer negotiates the shared size** — rejected: that *is* the last-writer-wins bug; renderers cannot see each other's dimensions without a central authority. |
| **Drop `cwd` from the launch key AND never reap a running session** (both) | Either alone leaves the data loss reachable: dropping `cwd` stops a mirror looking like a re-type; never-reaping stops a *genuine* re-type from killing a running program. | **Only drop `cwd`** — rejected: a real re-type would still reap a running program. **Only never-reap** — rejected: a mirror would still reap when the reap path is reachable. Belt and braces (clarification 2026-07-10). |
| **`viewId` optional on the contract (absent ⇒ one implicit view)** | Keeps every existing attach/resize call site and integration test valid while new code passes real ids; a single-view panel needs no id to get the right grid. | **Make `viewId` required** — rejected (YAGNI/churn): forces a synchronous rewrite of every call site and harness for no behavioural gain; the daemon treats absence as the single implicit view. |
| **Separate `attachTimeoutMs` ≫ `pingTimeoutMs`** | A shell can take seconds to start; reusing the ~800ms health-check budget for attach is exactly why the sub-workspace reported a connection timeout. | **Raise `pingTimeoutMs`** — rejected: that slows genuine health-check failure detection (Principle X: the two concerns have different budgets). |
| **Timeout = non-fatal "still starting" + themeable-icon retry, not an error/revert** | Clarification 2026-07-10: the session is still running; the view must offer a reattaching retry, never kill or revert. The control is an action → a themeable icon (v3.12.0). | **Revert to the type form / show a hard error** — rejected: destroys the running session's on-screen anchor and misrepresents a still-starting shell as a failure. |
| **Window-close detach backstop in UI main** | A crashed or force-closed renderer never sends its own `detach`; without a backstop the grid stays pinned to a departed view's size (FR-008a). | **Trust the renderer's unmount detach only** — rejected: a crash strands the view and re-corrupts the grid. |

> **ROADMAP ledger:** this feature is a correctness fix to the shipped terminal/sub-workspace model
> (Principle III / XI); it does not add a roadmap capability. README/ROADMAP are reconciled at close only if
> user-facing behaviour wording changes (the "still starting" retry is the one user-visible addition).
