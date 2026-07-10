# Tasks: Terminal Session Integrity

**Feature**: `008-terminal-session-integrity` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Dependency-ordered, TDD-first. `[P]` = parallelisable with its siblings (different files, no shared state).
Every code task is Red-Green-Refactor: write/adjust the failing test first, then the minimal code, then
refactor under green. Test tiers: **U** unit, **I** integration, **Ct** contract, **E2E** Playwright-Electron.

## Phase A — Contract seam (`ipc-contract`)

- **T001 [A][Ct]** Write a contract test asserting `TerminalAttachParams` and `TerminalResizeParams` accept
  an optional `viewId: string`, and that `TERMINAL_DETACH_METHOD === 'terminal.detach'` with
  `TerminalDetachParams { panelId: string; viewId: string }` exported from `@throng/ipc-contract`. (Red)
- **T002 [A]** Add `viewId?: string` to `TerminalAttachParams` and `TerminalResizeParams`; add
  `TERMINAL_DETACH_METHOD` and `TerminalDetachParams` in `packages/ipc-contract/src/terminal.ts`. (Green)

## Phase B — Daemon: identity, grid, lifetime (`daemon`)

- **T010 [B][U]** Rewrite `terminal-reattach-identity.test.ts` to the clarified behaviour: a still-running
  session is **reused, never reaped**, both when the launch is unchanged (mirror) **and** when
  `[file,args,runAsAdmin]` differs (re-type); the PTY is never killed; `cwd` is not part of the reuse key
  (a differing `cwd` alone still reuses). (Red)
- **T011 [B][U]** `terminal-grid.test.ts` (new): attach three views of one panel with different sizes →
  `grid = min(cols) × min(rows)`; enlarging the smallest view grows the grid exactly once; a same-grid
  resize (or a focus change modelled as no dimension change) sends **zero** PTY resizes; clamp to ≥1×1 when
  a view is smaller. Assert exact PTY-resize call count via `FakePtyHost`. (Red)
- **T012 [B][U]** `terminal-detach.test.ts` (new): `detach(panelId, viewId)` removes the view and recomputes
  the grid (grows to the remaining view); detaching the **last** view of a **rootless** (sub-workspace-owned)
  session terminates it (PTY killed); detaching the last **sub-workspace** view of a **project-owned**
  (non-rootless) session leaves it running. (Red)
- **T013 [B]** Implement in `terminal-service.ts` (Green): `launchKeyOf` drops `cwd`; `attach` always reuses
  a running session (delete the `reapForReplace`-on-running path); `Session` gains `views: Map<viewId,
  {cols,rows}>`; add `recomputeGrid()` computing `clamp(min)` and calling `host.resize` only when the grid
  changes; `attach`/`resize` record the view and recompute; add a `detach` RPC handler that removes the view,
  recomputes, and terminates only when the last view of a rootless session goes. Register
  `TERMINAL_DETACH_METHOD`.
- **T014 [B][I]** `terminal-grid.integration.test.ts` (new, via `terminal-harness`): open two events sockets,
  attach the same panel from two views with different `cols/rows` → the real PTY is sized to the smaller
  grid; detach the smaller → it grows; a second attach for the same panel with a **different `cwd`** reuses
  the running session and never kills the PTY (child-pid survival). (Green — real OS PTY.)
- **T015 [B]** Refactor: extract the clamp minimum to a named constant; ensure `killForProject`/`shutdown`/
  `handleExit` still dispose cleanly with the new view map (no orphaned ConPTY — Principle III hygiene).

## Phase C — Client plumbing + attach budget (`core`, `ui/main`)

- **T020 [C][U]** Extend the core app-settings test: `IUiSettings` exposes `attachTimeoutMs` with a default
  ≫ `pingTimeoutMs`, overridable by `THRONG_ATTACH_TIMEOUT_MS`. (Red)
- **T021 [C]** Add `attachTimeoutMs` + `DEFAULT_ATTACH_TIMEOUT_MS` to `core/config/settings.ts`; wire it in
  `ui/main/composition-root.ts` (env/default) and `ui/main/main.ts`. (Green)
- **T022 [C]** `DaemonClient.call(method, params, timeoutMs?)` — accept a per-call timeout override,
  defaulting to `pingTimeoutMs` (back-compatible). (Green)
- **T023 [C]** `terminal-ipc.ts`: forward `viewId` on `throng:terminal:attach`/`throng:terminal:resize`; add
  a `throng:terminal:detach` handler (`terminal.detach`); use `attachTimeoutMs` for the attach RPC. Extend
  the preload `terminal.*` bridge (`detach`; `viewId` on attach/resize). (Green)
- **T024 [C]** Window-close detach backstop: UI main tracks each window's attached `(panelId, viewId)` pairs
  (reported from the renderer on attach) and sends `terminal.detach` for each when the window closes
  (FR-008a). (Green)

## Phase D — Renderer UX + E2E (`ui/renderer`)

- **T030 [D]** `use-terminal.ts`: generate a stable `viewId` per mount; pass it on attach/resize; call
  `terminal.detach(panelId, viewId)` in cleanup; report `(panelId, viewId)` to UI main for the backstop.
- **T031 [D]** `use-terminal.ts`: size xterm to the **daemon-reported grid** and paint the surplus in the
  terminal background — no clip/stretch/duplicate (FR-011). Stop each view driving the PTY size directly;
  it reports its measured `cols/rows` via `resize(viewId,…)` and renders the grid the daemon returns.
- **T032 [D]** `terminal-panel.tsx`: on attach-timeout render a **non-fatal "still starting"** state (do not
  revert to the type form, do not surface a hard error, do not kill), carrying a **themeable-icon** retry
  affordance (glyph + colours from theme tokens, hover title) that re-attaches (idempotent via reuse). (v3.12.0)
- **T033 [D]** Hold a **loading state** in a sub-workspace view until the origin project's root is resolved,
  so a cold start never attaches at the wrong `cwd` (FR-001).
- **T040 [D][E2E]** `terminal-mirror-survival.e2e.ts`: start a long-running program in a project terminal,
  drag its tab into a new sub-workspace → program still alive, output streams to both views, neither window
  reports a connection error. (SC-001, SC-004)
- **T041 [D][E2E]** `terminal-dual-size.e2e.ts`: one session shown in two different-sized windows → both
  legible, grid at the smaller size, no oscillation on focus/resize of the other. (SC-002, SC-003)
- **T042 [D][E2E]** `terminal-slow-start.e2e.ts`: a shell that takes several seconds → "still starting"
  state shown, retry attaches, no timeout error. (SC-006)

## Phase E — Reconcile & close

- **T050** Run the full suite green: `npm run test:unit`, `npm run test:integration`, `npm run test:contract`,
  `npm run test:e2e`. Paste observed output (Principle V; verification-before-completion).
- **T051** Documentation currency (constitution v3.10.0): update `README.md` / `ROADMAP.md` if user-facing
  behaviour wording changed (the "still starting" retry). Reconcile the ROADMAP ledger.
- **T052** Commit to `008-terminal-session-integrity` with a clear message. Do **not** push.

## Dependencies

- A (T001–T002) precedes B, C (the `viewId`/`detach` shapes are shared).
- B (T010–T015) is the root-cause fix; C plumbs it to the client; D surfaces it and adds E2E.
- Within B: T010–T012 (tests, Red) precede T013 (code, Green) precede T014–T015.
- E (T050–T052) is last: full green, docs, commit.
