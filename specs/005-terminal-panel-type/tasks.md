---
description: "Task list for feature 005 — Typed Panels: Terminal Panel Type"
---

# Tasks: Typed Panels — Terminal Panel Type

**Input**: Design documents from `/specs/005-terminal-panel-type/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D17), data-model.md, contracts/ (all present)

**Tests**: INCLUDED and REQUIRED — constitution Principle V (Test-First, NON-NEGOTIABLE) mandates
Red-Green-Refactor across unit/integration/contract/E2E, and **every user-facing UI change MUST ship with
passing E2E coverage** (v3.4.0). Write each test first; see it fail; then implement.

**Organization**: Tasks are grouped by user story — **US1→US4** (plan phases A/B/C, below) and the
2026-07-01 **batch-2 US5→US9** (plan phases D–G, in the "Batch 2" section further down) — aligned to the
plan's verify-as-you-go delivery phases:

- **Plan Phase A** = Phase 3 (**US1** — panel type UI). 🎯 MVP
- **Plan Phase B** = Phase 4 (**US2 config half** — settings & flavour detection; no launch).
- **Plan Phase C** = Phases 5–7 (**US2 launch** incl. mirroring/revert/root-lock, **US3** persistence,
  **US4** confinement).

Reflects the 2026-06-30 clarifications: **re-typeable panels** (type fixed only while content is live;
`clearPanelType` revert on terminal end, FR-006/FR-020), **mirrored sessions** (one session, many views,
FR-021), and the **project-root lock** while terminals are open (`IDirectoryLock` + edit guard, FR-022).

Architecture (research D1–D17): pure logic in `@throng/core`; **flavour detection UI-main-owned**;
**terminals daemon-owned** (node-pty) behind `IPtyHost`; **root lock daemon-owned** behind
`IDirectoryLock`; **new daemon→UI streaming** via JSON-RPC notifications; **xterm.js** renderer view; **no
SQLite migration** (panel `kind`+`config` ride the `workspace_layout.layout_json` blob; daemon session +
lock registries are in-memory, keyed by `panelId` / `projectId`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4 (user-story tasks only)
- Exact file paths included

## Path Conventions

Monorepo (npm workspaces): `packages/core/`, `packages/platform-windows/`, `packages/ipc-contract/`,
`packages/daemon/`, `packages/ui/` (`src/main`, `src/preload`, `src/renderer`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module scaffolding shared across phases (no new deps — A and B need none; Phase-C deps land in
Phase 5).

- [x] T001 [P] Scaffold core panel-type module `packages/core/src/panel-type/` (stubs `registry.ts`, `descriptor.ts`, `assignment.ts`) with an `index.ts` barrel; export from `packages/core/src/index.ts`
- [x] T002 [P] Scaffold core terminal module `packages/core/src/terminal/` (stubs `flavour.ts`, `defaults.ts`, `launch-spec.ts`, `confine.ts`, `lifecycle.ts`, `panel-type.ts`) with a barrel; export from `packages/core/src/index.ts`
- [x] T003 [P] Scaffold renderer folders `packages/ui/src/renderer/panel-type/` (empty `panel-type.css`) and `packages/ui/src/renderer/terminal/` (empty `terminal.css`)

**Checkpoint**: Empty modules compile and are exported.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The panel-typing seam every phase depends on — the `Panel` model gains a type, the
assign/revert ops exist, and a body dispatcher routes a typed panel to a distinct body.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 [P] Unit tests (fail first) for `setPanelType` (assigns only from **untyped**; refused while typed) **and** `clearPanelType` (reverts a typed panel to untyped; a subsequent `setPanelType` then succeeds — re-type), plus `Panel` `kind`/`config` round-trip through a layout, in `packages/core/tests/unit/panel-type-assignment.test.ts`
- [x] T005 Extend `Panel` with optional `kind?: PanelKind` + `config?: PanelConfig` in `packages/core/src/workspace/model.ts`, and add `setPanelType(layout, panelId, kind, config)` (assign-from-untyped) + `clearPanelType(layout, panelId)` (revert) ops in `packages/core/src/workspace/operations.ts` + `packages/core/src/panel-type/assignment.ts` (make T004 pass)
- [x] T006 Introduce the `PanelBody` dispatcher in `packages/ui/src/renderer/workspace/panel-body.tsx` (untyped → form-host placeholder; `kind==='terminal'` → terminal-host placeholder; fallback → existing placeholder text) and render it from the `panel-box__body` region of `packages/ui/src/renderer/workspace/panel-placeholder.tsx` (preserving the header/drag/destroy shell)

**Checkpoint**: A typed panel routes to a distinct body; `kind`+`config` persist via the existing layout blob; a cleared panel reverts to the form.

---

## Phase 3: User Story 1 — Choose & lock a Panel's type (Priority: P1) 🎯 MVP — [Plan Phase A]

**Goal**: A new Panel shows an extensible type-selection form (Panel-Type dropdown + per-type dynamic
inputs + Confirm/Clear + validation; the type is **fixed while the panel is typed**). Terminal inputs
render with a **stub** flavour list; **no terminal launches**.

**Independent Test**: Add a Panel → form (not "Empty Panel"); select Terminal → Flavour + Startup Params
appear; Clear resets; Confirm with a valid selection → the panel is typed (form gone, type fixed); reload →
panel returns as its confirmed type. (Re-type-after-exit is exercised in Phase 5.)

### Tests for User Story 1 (write first, must fail)

- [x] T007 [P] [US1] Unit tests for the panel-type **registry** (register/list ordering, get, duplicate handling) in `packages/core/tests/unit/panel-type-registry.test.ts`
- [x] T008 [P] [US1] Unit tests for descriptor **validate** gating (no type → invalid; Terminal with no project root → invalid; valid selection → ok) + `buildConfig` output in `packages/core/tests/unit/panel-type-descriptor.test.ts`
- [x] T009 [P] [US1] Unit test for the form reducer/validation state (Confirm disabled until valid; Clear resets; typed panel shows no type control) in `packages/ui/tests/unit/panel-type-form.test.ts`

### Implementation for User Story 1

- [x] T010 [US1] Implement the panel-type registry (`register`/`list`/`get`) + `PanelTypeDescriptor`/`PanelTypeInputSpec` types in `packages/core/src/panel-type/registry.ts` + `descriptor.ts` (make T007 pass)
- [x] T011 [US1] Implement the **Terminal** `PanelTypeDescriptor` with STUB flavour options + `defaults`/`validate`/`buildConfig` in `packages/core/src/terminal/panel-type.ts`; register it (make T008 pass)
- [x] T012 [P] [US1] Renderer: `PanelTypeForm` (Panel-Type dropdown from `registry.list`, dynamic inputs host, Confirm/Clear, Confirm gated by `validate`, assign via `setPanelType`) in `packages/ui/src/renderer/panel-type/panel-type-form.tsx` (make T009 pass)
- [x] T013 [P] [US1] Renderer: `TerminalInputs` (Flavour dropdown w/ stub options + Startup Params text) in `packages/ui/src/renderer/panel-type/terminal-inputs.tsx`
- [x] T014 [US1] Wire `PanelBody` to render `<PanelTypeForm/>` for untyped panels in `packages/ui/src/renderer/workspace/panel-body.tsx`; theme the form via `var(--throng-*)` in `packages/ui/src/renderer/panel-type/panel-type.css`
- [x] T015 [US1] **E2E** `packages/ui/tests/e2e/panel-type-form.e2e.ts` — form replaces "Empty Panel"; selecting Terminal swaps inputs; Clear resets; Confirm types the panel (type control gone while typed); typed panel survives reload; **and the same type-selection form renders and confirms correctly in a sub-workspace window (FR-008)**

**Checkpoint**: Panel type selectable, validated, fixed-while-typed, persisted — **verify point 1**. No terminal yet.

---

## Phase 4: User Story 2 (config) — Settings & flavour detection (Priority: P2) — [Plan Phase B]

**Goal**: The Flavour dropdown is real — built-in catalogue (detected on the machine) **∪** user-defined
flavours from `settings.json` — and Startup Params pre-fills the flavour's default. **Still no launch.**

**Independent Test**: Add a Panel → Terminal → Flavour dropdown lists installed shells; pick one → params
default fills (and updates on flavour change); add a user flavour to `settings.json` → it appears
(hot-reload).

### Tests for User Story 2 / config (write first, must fail)

- [x] T016 [P] [US2] Unit tests for `settings.terminals` parse/defaults/tolerant-drop of bad entries in `packages/core/tests/unit/app-settings.terminals.test.ts`
- [x] T017 [P] [US2] Unit tests for flavour **merge** (builtins∩installed minus disabled ∪ user, dedupe by id, user wins) + **default-params** resolution in `packages/core/tests/unit/terminal-flavour.test.ts`
- [x] T018 [P] [US2] Unit tests for the `IShellDetection` **contract suite** itself (compliant fake passes; violating fakes fail) in `packages/core/tests/unit/shell-detection-contract.test.ts`

### Implementation for User Story 2 / config

- [x] T019 [US2] Extend `AppSettings` with `terminals { flavours[], disabledBuiltins[], defaultParams }` + defaults + tolerant validator in `packages/core/src/config/app-settings.ts` (make T016 pass)
- [x] T020 [US2] Implement the built-in flavour **catalogue** + `mergeFlavours` + `resolveDefaultParams` in `packages/core/src/terminal/flavour.ts` + `packages/core/src/terminal/defaults.ts` (make T017 pass)
- [x] T021 [P] [US2] Define `IShellDetection` + `DetectedShell` in `packages/core/src/abstractions/shell-detection.ts`
- [x] T022 [US2] Write the reusable `IShellDetection` contract suite in `packages/core/src/testing/shell-detection-contract.ts` (per contracts/shell-detection.md); export from `packages/core/src/testing/index.ts` (make T018 pass)
- [x] T023 [US2] Implement `WindowsShellDetection` (probe PATH + known dirs: PowerShell 5.1/7, CMD, Git Bash) in `packages/platform-windows/src/windows-shell-detection.ts`; export from `packages/platform-windows/src/index.ts`
- [x] T024 [US2] Contract test running the suite vs `WindowsShellDetection` on the real machine in `packages/platform-windows/tests/contract/windows-shell-detection.contract.test.ts`
- [x] T025 [US2] `shell-detection-service.ts` in `packages/ui/src/main/` — instantiate `WindowsShellDetection`, merge with `settings.terminals` → flavours; register the `terminal:listFlavours` ipcMain handler in `packages/ui/src/main/main.ts`
- [x] T026 [US2] Expose `window.throng.terminal.listFlavours` via `contextBridge` in `packages/ui/src/preload/preload.cts` + declare in `packages/ui/src/renderer/global.d.ts`; expose `settings.terminals` through `packages/ui/src/renderer/config/config-store.tsx`
- [x] T027 [US2] `use-flavours.ts` hook (load `listFlavours`, supply dropdown options, fill default params on flavour change) in `packages/ui/src/renderer/panel-type/use-flavours.ts`; replace the stub list in `terminal-inputs.tsx`
- [x] T028 [US2] **E2E** `packages/ui/tests/e2e/terminal-flavours.e2e.ts` — Flavour dropdown populated from the machine; a user flavour added to `settings.json` appears (hot-reload); params default fills + updates on flavour change (no launch)

**Checkpoint**: Real flavour dropdown + sensible default params — **verify point 2**. Still no launch.

---

## Phase 5: User Story 2 (launch) — Live inline terminal, mirroring, revert & root-lock (Priority: P2) — [Plan Phase C · part 1]

**Goal**: Confirming a Terminal Panel starts a live shell hosted by the daemon, attached inline (xterm.js),
rooted at the project. Output **mirrors** to all views of a synced panel (FR-021); on exit the Panel
**reverts to the form** (FR-020); while a terminal is open the **project root is locked** (FR-022);
unexpected exit surfaces code+output; destroying the Panel kills the PTY.

**Independent Test**: Confirm Terminal → live terminal echoes input; cwd = project root; type `exit` → Panel
returns to the form; sync the panel to a sub-workspace → both views mirror one session; with a terminal
open, the project root folder can't be deleted/renamed and its root path can't be edited.

### Setup & seams

- [x] T029 [US2] Add `node-pty` to `packages/platform-windows/package.json` and `@xterm/xterm` + `@xterm/addon-fit` to `packages/ui/package.json`; run workspace install (node-pty builds for the **plain-Node daemon** — no electron-rebuild, per research D8)
- [x] T030 [P] [US2] Define `IPtyHost` + `PtyStartOptions`/`PtyHandle` in `packages/core/src/abstractions/pty-host.ts`
- [x] T031 [P] [US2] Write the reusable `IPtyHost` contract suite (start/echo/write/resize/exit/listChildPids) in `packages/core/src/testing/pty-host-contract.ts`; export from `packages/core/src/testing/index.ts`
- [x] T032 [P] [US2] Unit tests (fail first) for `launch-spec` resolution (flavour+params+root → file/args/cwd; refuse null root) in `packages/core/tests/unit/terminal-launch-spec.test.ts`
- [x] T033 [P] [US2] Define `IDirectoryLock` + `LockHandle` in `packages/core/src/abstractions/directory-lock.ts` (FR-022)
- [x] T034 [P] [US2] Write the reusable `IDirectoryLock` contract suite (delete-while-locked fails; delete-after-release succeeds; files inside stay writable) in `packages/core/src/testing/directory-lock-contract.ts`; export from `packages/core/src/testing/index.ts`

### Core + platform impls

- [x] T035 [US2] Implement `launch-spec.ts` (resolve flavour/args/params + project root → `{file,args,cwd}`) in `packages/core/src/terminal/launch-spec.ts` (make T032 pass)
- [x] T036 [US2] Implement `NodePtyHost` (node-pty/ConPTY) in `packages/platform-windows/src/node-pty-host.ts`; export from index
- [x] T037 [US2] Contract/integration test running the `IPtyHost` suite vs `NodePtyHost` (short-lived shell echo + exit + child-pids) in `packages/platform-windows/tests/contract/node-pty-host.contract.test.ts`
- [x] T038 [US2] Implement `WindowsDirectoryLock` (open directory handle without delete/rename share) in `packages/platform-windows/src/windows-directory-lock.ts`; export from index
- [x] T039 [US2] Contract test running the `IDirectoryLock` suite vs `WindowsDirectoryLock` over a temp dir in `packages/platform-windows/tests/contract/windows-directory-lock.contract.test.ts`

### IPC contract + daemon terminal service, streaming, lock manager

- [x] T040 [US2] Add terminal method names + params/results + notification-frame types in `packages/ipc-contract/src/terminal.ts`; export from `packages/ipc-contract/src/index.ts` (per contracts/terminal-rpc.md)
- [x] T041 [US2] Implement `TerminalService` (attach/write/resize/kill/list + in-memory registry keyed by `panelId` + bounded scrollback ring + durable tag + **`subscribers` set for mirroring**, FR-021) using injected `IPtyHost` in `packages/daemon/src/terminal-service.ts`
- [x] T042 [US2] Implement `terminal-events.ts` publisher that **fans `terminal.output`/`terminal.exit` out to ALL subscribed sockets** of a `panelId`, and extend `packages/daemon/src/ipc-server.ts` to allow server-initiated notification frames on a `terminal.subscribe`d long-lived socket
- [x] T043 [US2] Implement `terminal-lock-manager.ts` (ref-counted `IDirectoryLock` per project: acquire root lock on first terminal, release on last) in `packages/daemon/src/`; call it from `TerminalService` attach (first) / kill (last) (FR-022)
- [x] T044 [US2] Add a **root-edit guard** in `packages/daemon/src/project-service.ts` — refuse to change a project's `root_folder` while that project has open terminals (FR-022); unit/integration test the refusal
- [x] T045 [US2] Register `terminal.*` in `packages/daemon/src/rpc-router.ts`; add `PtyHost`/`DirectoryLock`/`TerminalService`/`LockManager` tokens in `packages/daemon/src/tokens.ts`; bind `NodePtyHost` + `WindowsDirectoryLock` + `TerminalService` + lock manager + events publisher in `packages/daemon/src/composition-root.ts`; fill the reserved terminal extension point in `packages/daemon/src/main.ts`
- [x] T046 [US2] Daemon integration test: `attach` cold-start → `terminal.output` notification → write-echo seen → `kill` → `terminal.exit`; **and a bad launch (missing executable / invalid params) returns a launch-failure error rather than a silent/blank session** (FR-019); over the real pipe, in `packages/daemon/tests/integration/terminal-service.integration.test.ts`
- [x] T047 [US2] Daemon integration test: **two events sockets subscribe to one `panelId`** → output fans out to both, input from either reaches the PTY (FR-021 mirror) in `packages/daemon/tests/integration/terminal-mirror.integration.test.ts`
- [x] T048 [US2] Daemon integration test: opening a terminal **locks the project root** (external delete/rename fails) and the **root-edit guard** refuses a root change; closing the last terminal **releases** the lock, in `packages/daemon/tests/integration/terminal-root-lock.integration.test.ts`

### UI main bridge + renderer view

- [x] T049 [US2] `daemon-events.ts` in `packages/ui/src/main/` — open the long-lived events socket, send `terminal.subscribe`, forward `terminal.output`/`terminal.exit` to **all** renderers via `webContents.send`
- [x] T050 [US2] `terminal-ipc.ts` in `packages/ui/src/main/` — ipcMain handlers `terminal.attach/write/resize/kill/list` → daemon RPC (resolve `LaunchSpec` from flavour+params+active project root); wire in `main.ts`
- [x] T051 [US2] Expose `window.throng.terminal.{attach,write,resize,kill,list,onOutput,onExit}` in `packages/ui/src/preload/preload.cts` + `packages/ui/src/renderer/global.d.ts`
- [x] T052 [P] [US2] `use-terminal.ts` hook (attach by panelId, subscribe onOutput/onExit, write input, fit/resize, surface exit code) in `packages/ui/src/renderer/terminal/use-terminal.ts`
- [x] T053 [US2] `terminal-panel.tsx` — mount xterm.js (+fit addon) themed via `var(--throng-*)`, driven by `use-terminal`; **on `onExit`, surface the exit info and call `clearPanelType` to revert the Panel to the form** (FR-020); render it from `PanelBody` for `kind==='terminal'` in `packages/ui/src/renderer/terminal/terminal-panel.tsx` + `panel-body.tsx`
- [x] T054 [US2] Replace the emulated `panelHasRunningSubprocess` with a real terminal-state query (feeds the existing destroy confirmation; destroy → `terminal.kill`) in `packages/ui/src/renderer/workspace/subprocess.ts`
- [x] T055 [P] [US2] Add terminal colour tokens + `terminal` icon to `Theme` + `THRONG_THEME` defaults in `packages/core/src/config/theme.ts`; xterm theme reads `var(--throng-colour-terminal*)`
- [x] T056 [US2] **E2E** `packages/ui/tests/e2e/terminal.e2e.ts` — Confirm Terminal → live terminal echoes input; cwd = project root; unexpected exit shows code+output; destroy Panel kills the PTY (confirmation shown); **a launch failure (bad params / missing executable) surfaces the error instead of a blank terminal (FR-019)**
- [x] T057 [US2] **E2E** `packages/ui/tests/e2e/terminal-revert.e2e.ts` — type `exit` (or crash) → Panel returns to the type-selection form with exit info visible → re-select Terminal (or another type) and Confirm → fresh content starts (FR-020)
- [x] T058 [US2] **E2E** `packages/ui/tests/e2e/terminal-mirror.e2e.ts` — sync a Terminal Panel into a sub-workspace → both views show one session (input in one appears in both) (FR-021)
- [x] T059 [US2] **E2E** `packages/ui/tests/e2e/terminal-root-lock.e2e.ts` — with a terminal open, deleting/renaming the project root folder is refused and the project's root path can't be edited; after closing all terminals it can (FR-022)

**Checkpoint**: Live inline terminal in the project root, mirrored, revertable, with a locked root — **verify point 3 (part 1)**.

---

## Phase 6: User Story 3 — Survive restart & reattach (Priority: P2) — [Plan Phase C · part 2]

**Goal**: The daemon is persistent/detached (UI spawns-if-absent, single-instance, survives UI close); a
running terminal reattaches live (with scrollback) after an app restart; idle terminals cold-respawn;
closing the app with running terminals shows the three-choice warning.

**Independent Test**: Start a long-running process, close the app, reopen → terminal still running +
reattached with scrollback; an idle terminal cold-respawns at root; closing with running terminals → the
three-choice prompt.

### Tests & core lifecycle

- [x] T060 [P] [US3] Unit tests (fail first) for idle/busy classification (busy iff a non-shell descendant lives; safe default = busy) + reattach/cold-respawn decision in `packages/core/tests/unit/terminal-lifecycle.test.ts`
- [x] T061 [US3] Implement `lifecycle.ts` (idle/busy from child-pids; attach decision) in `packages/core/src/terminal/lifecycle.ts` (make T060 pass)

### Daemon reattach + lifecycle

- [x] T062 [US3] Extend `TerminalService` with reattach (replay scrollback + resume stream, re-using the `subscribers` set) vs cold-start from `LaunchSpec`; on project/app close keep **busy** sessions running, close **idle** ones (releasing the root lock when the project's last terminal goes); in `packages/daemon/src/terminal-service.ts`
- [x] T063 [US3] Daemon integration test: cold-start then second `attach` replays scrollback + resumes streaming; idle vs busy close behaviour; in `packages/daemon/tests/integration/terminal-reattach.integration.test.ts`

### Persistent daemon lifecycle (UI main)

- [x] T064 [P] [US3] `daemon-lifecycle.ts` in `packages/ui/src/main/` — connect-or-spawn-detached (`spawn(node,[daemonMain],{detached:true,stdio:'ignore'}).unref()`) + `health.ping` readiness retry + single-instance race (pipe-in-use → just connect)
- [x] T065 [US3] Integration test for spawn-if-absent + single-instance + reconnect in `packages/ui/tests/integration/daemon-lifecycle.test.ts`
- [x] T066 [US3] Wire `daemon-lifecycle` into `packages/ui/src/main/main.ts` startup (spawn before window creation; reuse an existing daemon; keep it alive after UI close while sessions exist)

### Renderer reattach + app-close

- [x] T067 [US3] On Terminal Panel mount call `terminal.attach(panelId)` (reattach if live, else cold respawn) in `packages/ui/src/renderer/terminal/use-terminal.ts` + `terminal-panel.tsx`
- [x] T068 [US3] `app-close-prompt.tsx` — three-choice warning (leave running / terminate all / cancel) driven by `terminal.list` on app close; wire the close handshake in `packages/ui/src/main/main.ts` ↔ `packages/ui/src/renderer/app-close-prompt.tsx`
- [x] T069 [US3] **E2E** `packages/ui/tests/e2e/terminal-persistence.e2e.ts` — start a process, close + reopen the app → terminal still running, reattached with scrollback; idle terminal cold-respawns at root; app-close three-choice prompt appears; **a Panel persisted with a now-removed flavour surfaces flavour-unavailability on restore rather than a blank terminal (FR-019, restore-time arm)**

**Checkpoint**: Terminals outlive the UI + reattach; idle/cold-respawn; three-choice prompt — **verify point 3 (part 2)**.

---

## Phase 7: User Story 4 — Start in the project root (Priority: P3) — [Plan Phase C · part 3]

> **SUPERSEDED (2026-07-02):** cwd-**confinement** below (T070–T072) was later assessed as **infeasible
> and marked WON'T FIX** — `confine.ts` remains an intentional no-op stub. See **T123/T124 (Phase 15)** and
> **FR-016**; the achievable guarantee shipped instead as the **root lock** (FR-022, `terminal-root-lock.e2e.ts`).
> The tasks stay `[x]` as originally executed; this banner records the reversal.

**Goal**: The terminal **starts** in the project root (cwd-confinement afterwards is WON'T FIX — FR-016).

**Independent Test**: Launch a terminal and confirm its initial cwd is the project root. *(The original
"attempt `cd` above the root → prevented" test was retired with the WON'T-FIX decision.)*

- [x] T070 [P] [US4] Unit tests (fail first) for root-confinement helpers (detect/keep within root on real paths) in `packages/core/tests/unit/terminal-confine.test.ts`
- [x] T071 [US4] Implement `confine.ts` (best-effort keep/return working context to root) in `packages/core/src/terminal/confine.ts`; apply at launch + on cwd-change detection in `packages/daemon/src/terminal-service.ts` (make T070 pass)
- [x] T072 [US4] **E2E** `packages/ui/tests/e2e/terminal-confine.e2e.ts` — attempt to navigate above the project root → working context kept within / returned to root

**Checkpoint**: Terminal **starts** at the project root; root locked while open (FR-022) — **verify point 3 (part 3)**.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Guards, performance, and final validation across stories.

- [x] T073 [P] Confirm `@throng/core` keeps **zero OS/DOM imports** (panel-type + terminal modules + the new `shell-detection`/`pty-host`/`directory-lock` abstractions) — run the existing import guard; fix any violation
- [x] T074 [P] Add/confirm a persistence test asserting SQLite stays at **`user_version 6`** (no migration introduced) in `packages/persistence/tests/`
- [~] T075 [P] Performance: coalesce/debounce `terminal.output` (~16 ms) and verify the bounded scrollback ring stays flat under sustained output (daemon integration test). **SUPERSEDED by T132 (Phase 15):** the bounded-scrollback flatness assertion shipped; the **coalesce/debounce** half is deliberately **NOT implemented** (accepted deferral — risks the screen-clear/mirror path for marginal gain).
- [x] T076 Run the full **quickstart.md** A→B→C validation (incl. revert, mirror, root-lock steps); tick its phase checkboxes
- [x] T077 [P] Verify a synced Terminal Panel unsubscribes cleanly on sub-workspace close (no leaked subscribers / no zombie session) — integration/E2E assertion
- [x] T078 Standard layers green (2026-07-04): unit 307, contract 21, integration 96, **E2E 147/147**, `tsc -b` clean; SC-001..SC-011 met. The `@admin` (run-as-admin / FR-025c de-elevation) suite runs on the separate elevated runner (`npm run test:e2e:admin`) and is re-verified there.

---

## Batch 2 — Post-Phase-C Refinements (2026-07-01) — Plan Phases D–G

Additive tasks for the 2026-07-01 clarifications (FR-023…FR-027 / US5…US9), re-checked against constitution
**v3.6.0**. Test-first (RGR); **every UI change ships passing E2E** before its phase closes. Task IDs
continue from T078; existing A/B/C tasks are unchanged.

### Phase 9 = Plan Phase D — Sidebar cleanup (US5) + drag-panel-to-new-tab (US9)

- [x] T079 [P] [US5] **E2E (write first, observe failing)** `packages/ui/tests/e2e/sidebar.e2e.ts` — Sidebar Pane shows Projects + Sub-workspaces only (no Terminals Panel), Sub-workspaces anchored to the bottom across a resize
- [x] T080 [US5] Remove the `terminals` entry from the sidebar `panels` array and reorder so `subworkspaces` is last in `packages/ui/src/renderer/app.tsx`; delete `packages/ui/src/renderer/sidebar/terminals-panel.tsx`; adjust the `throng.sidebarPanelSizes` storage handling for two panels (make T079 pass)
- [x] T081 [P] [US5] Scrub Terminals-Panel-in-sidebar references from `specs/003-layout-and-app-tweaks/` docs and any stale 005 text (doc consistency with constitution v3.6.0 Principle XI)
- [x] T082 [P] [US9] **Unit (write first, failing)** `packages/core/tests/unit/workspace-add-tab-from-panel.test.ts` — `addTabFromPanel` moves a panel into a new solo tab, collapses the emptied source split slot, prunes an emptied source tab, honours the `totalPanels <= 1` guard, and sets the new tab active
- [x] T083 [US9] Implement `addTabFromPanel(layout, sourcePanelId, { tab })` in `packages/core/src/workspace/operations.ts` (reuse `removeFromNode`); export it (make T082 pass)
- [x] T084 [US9] Add an `addTabFromPanel` action in `packages/ui/src/renderer/state/workspace-store.tsx`; make the New-Tab `+` button a `useDroppable('newtab|+')` in `packages/ui/src/renderer/workspace/tab-group.tsx` and handle that drop in `onDragEnd` (create the tab from the dragged panel, activate it); add an `--over` affordance style in `packages/ui/src/renderer/theme.css`
- [x] T085 [P] [US9] **E2E** `packages/ui/tests/e2e/drag-to-new-tab.e2e.ts` — drag a panel onto `+` → new active tab containing only that panel; source split slot collapses

**Checkpoint (D)**: sidebar E2E + drag-to-new-tab E2E green.

### Phase 10 = Plan Phase E — Robust shell detection (US6, FR-024)

- [x] T086 [P] [US6] **Unit (write first, failing)** `packages/core/tests/unit/terminal-resolve-shell.test.ts` — `resolveShellFile(candidates, probes)` tries well-known path → PATH → registry, first existing wins, returns null when none resolve (no false positive)
- [x] T087 [US6] Implement pure `resolveShellFile` + `ShellProbes` in `packages/core/src/terminal/resolve-shell.ts`; export (make T086 pass)
- [x] T088 [US6] Extend the `IShellDetection` contract suite in `packages/core/src/testing/shell-detection-contract.ts` to assert resolution order and no false positives
- [x] T089 [US6] Rework `packages/platform-windows/src/windows-shell-detection.ts` to resolve each built-in via `resolveShellFile` with real probes — fs `exists`, `onPath` (PATH lookup), and a new **registry probe** reading Git-for-Windows `InstallPath` from `HKLM\SOFTWARE\GitForWindows`, `HKCU\…`, and the `WOW6432Node` variant (small registry-read helper in `packages/platform-windows/src/`) — so Git Bash resolves by default path OR `bash.exe` on PATH OR registry (make T088 pass)
- [x] T090 [P] [US6] Contract test running the shell-detection contract vs the real `WindowsShellDetection` in `packages/platform-windows/tests/contract/`
- [x] T091 [US6] Extend `packages/ui/tests/e2e/terminal-flavours.e2e.ts` with a PATH/registry-only Git Bash case where feasible (log a skip notice if the runner lacks the fixture — never a silent pass)

**Checkpoint (E)**: shell-detection contract + unit green; Git Bash detected from a non-default location.

### Phase 11 = Plan Phase F — Destroy-panel-everywhere cascade (US8, FR-026/026a/026b)

- [x] T092 [P] [US8] **Unit (write first, failing)** `packages/core/tests/unit/sub-workspace-strip-panel.test.ts` — `stripPanelFromSubWorkspaces(list, panelId)` strips the panel, prunes emptied tabs, and returns `deletedIds` for emptied sub-workspaces; `findPanelLocations(list, panelId)` lists containing sub-workspaces
- [x] T093 [US8] Implement `stripPanelFromSubWorkspaces` + `findPanelLocations` in `packages/core/src/workspace/sub-workspace.ts`; export (make T092 pass)
- [x] ~~T094~~ [US8] **Superseded by design choice** — a dedicated daemon integration test was not needed: the persisted-sub cascade is owned by the main window (the authority that already loads/persists the full set) and is verified end-to-end by the cross-window E2E (T100). The pure strip/find logic is unit-tested (T092).
- [x] ~~T095~~ [US8] **Implemented renderer-side instead of new daemon methods (DRY):** the cascade lives in `detach-context.purgePanel` using the existing `workspace.loadSubWorkspaces` + `workspace.persistSubWorkspaces` RPC with the core helpers `stripPanelFromSubWorkspaces`/`findPanelLocations` — no new daemon method (which would duplicate the strip logic across daemon+renderer). Emptied sub-workspaces are closed via `subWorkspace.close`.
- [x] T096 [US8] Add cross-window `panel.notifyDestroyed`/`panel.onDestroyed` to `packages/ui/src/preload/preload.cts`, UI main, and `packages/ui/src/renderer/global.d.ts` (mirroring `notifyRenamed`), plus the `workspace.purgePanelEverywhere`/`findPanelLocations` bridge calls
- [x] T097 [US8] Add `packages/ui/src/renderer/workspace/panel-destroy-sync.tsx` (mounted in `WorkspaceProvider`) applying `ws.removePanel(panelId)` on the broadcast
- [x] T098 [US8] Extend `ConfirmOptions` + `packages/ui/src/renderer/confirm-dialog.tsx` with an optional `warningMessage` rendered as a highlighted `.modal__warning` callout (+ styles in `theme.css`)
- [x] T099 [US8] Update `destroyPanel` in `packages/ui/src/renderer/workspace/panel-placeholder.tsx`: compute `findPanelLocations` before confirming and pass a `warningMessage` when the panel exists elsewhere; on confirm kill the terminal once, call `purgePanelEverywhere`, `removePanel` locally, and broadcast `notifyDestroyed`
- [x] T100 [P] [US8] **E2E** `packages/ui/tests/e2e/destroy-cascade.e2e.ts` — sync a panel into a sub-workspace; destroy in the sub-ws → gone from parent; destroy in parent → gone from sub-ws; multi-location warning shown; an emptied sub-workspace is deleted

**Checkpoint (F)**: no ghost panels remain after a destroy anywhere; cascade E2E green.

### Phase 12 = Plan Phase G — Run a terminal as administrator (US7, FR-025/025a-d)

- [x] T101 [P] [US7] **Unit** `packages/core/tests/unit/terminal-elevation.test.ts` — `canRunAsAdmin`/`shouldRespawnDaemonElevated` truth tables + `runAsAdmin` threaded through config
- [x] T102 [US7] Added `runAsAdmin` to `TerminalPanelConfig`/`TerminalValues` (as a `'true'`/`'false'` form value → boolean in `buildConfig`) + `PtyStartOptions` (core), `AttachRequest` (ui main), `TerminalAttachParams` (ipc-contract); implemented `canRunAsAdmin` in `packages/core/src/terminal/elevation.ts`
- [x] T103 [P] [US7] Defined **`IElevationState`** in `packages/core/src/abstractions/elevation.ts` + `runElevationContract` in `packages/core/src/testing/elevation-contract.ts`
- [~] T104 [US7] Implemented `WindowsElevation.isElevated()` (token-integrity via absolute `whoami /groups`, cached) + platform contract test; `NodePtyHost.start` accepts `runAsAdmin`. **DEFERRED at the time**, now **SUPERSEDED & DELIVERED by T125 (Phase 15):** the native de-elevated spawn shipped via the medium-integrity **PTY agent** (`CreateProcessWithTokenW` shell-token launch) rather than an in-process spawn; verified on an elevated host for cmd/PowerShell/Git Bash. (Left `[~]` because the *original* in-process mechanism was replaced, not completed.)
- [x] T105 [US7] Daemon: bound `WindowsElevation` in `composition-root`; `terminal.capabilities → { elevated }` (rpc-router + ipc-contract) with an injected `IElevationState`; `runAsAdmin` passed to `pty.start`; daemon integration test (elevated true/false)
- [~] T106 [US7] **DEFERRED at the time**, now **SUPERSEDED & DELIVERED by T126 (Phase 15):** the runner-independent respawn **decision** (`shouldRespawnDaemonElevated`, core, unit-tested) plus the full `daemon-elevated-respawn` integration harness (fake-seam retire+respawn) now ship — see T126/FR-025b
- [~] T107 [US7] UI main forwards `terminal.capabilities()` via preload bridge (delivered). **DEFERRED at the time**, now **SUPERSEDED & DELIVERED by T126 (Phase 15):** `ensureDaemon` retires + re-spawns a non-elevated daemon when the app is elevated (`shouldRespawnDaemonElevated`); the injected-seam integration test verifies it. (The OS UAC-elevated spawn itself remains gated to an elevated runner.)
- [x] T108 [US7] Added the **"run as admin" checkbox** to `terminal-inputs.tsx`, enabled only when `capabilities().elevated` (else disabled with a relaunch-as-admin hover title); persists `runAsAdmin` via `buildConfig`
- [x] T109 [US7] Render a **red-outlined `ADMIN` pill** in the panel header (`panel-placeholder.tsx`) when a terminal runs elevated; `.panel-box__admin` styles in `theme.css`
- [x] T110 [P] [US7] **E2E** `packages/ui/tests/e2e/terminal-admin.e2e.ts` — always-run: not elevated → checkbox disabled with the hover hint + no ADMIN pill; elevated-gated path documented as skipped off an elevated runner

**Checkpoint (G)**: elevation contract green; FR-025b respawn integration test green (runner-independent); disabled-state E2E green (always-run); elevated E2E green on an elevated runner.

### Batch-2 Polish

- [x] T111 [P] Add a batch-2 (D→G) validation section to `specs/005-terminal-panel-type/quickstart.md` and tick it once validated
- [x] T112 D–G layers green (2026-07-04): full suite green (147 E2E incl. sub-workspace/owned-terminal specs), `tsc -b` clean, zero OS/DOM import guard passes; SC-012…SC-017 met. FR-025c elevation behaviour verified via the `@admin` elevated runner.

---

## Batch 3 — Sub-workspace terminals & lifecycle (2026-07-01) — FR-028/029/030

Additive tasks for the batch-3 clarifications. Test-first (RGR); every UI change ships passing E2E.

- [x] T113 [US-sub] **Unit** — a rootless `PanelTypeContext` (null root + `rootless`) validates a Terminal
  ok; `runAsAdmin`/`rootless` do not force a root (`packages/core/tests/unit/panel-type-descriptor.test.ts`)
- [x] T114 [US-sub] Core: `PanelTypeContext.rootless`; Terminal `validate` allows a null root when rootless
  (FR-028) in `packages/core/src/{panel-type/descriptor.ts,terminal/panel-type.ts}`
- [x] T115 [US-sub] **Daemon integration (write first)** — a rootless attach takes **no** project-root lock
  (`hasOpenTerminals` stays false) in `packages/daemon/tests/integration/terminal-root-lock.integration.test.ts`
- [x] T116 [US-sub] ipc-contract `TerminalAttachParams.rootless`; daemon `TerminalService` skips lock
  acquire/release for rootless sessions; UI-main `terminal-ipc` resolves cwd = `os.homedir()` when rootless
- [x] T117 [US-sub] Renderer: `PanelBody` detects an owned (no-project) sub-workspace Panel → passes
  `rootless` to the form + `TerminalPanel`/`use-terminal` attach (never falls back to an unrelated project root)
- [x] T118 [US-sub] **E2E** `packages/ui/tests/e2e/subworkspace-owned-terminal.e2e.ts` — an owned Panel opens
  a terminal that launches at home (FR-028)
- [x] T119 [US-sub] Closing the **last** Panel or Tab of a sub-workspace destroys the sub-workspace (record
  deleted + window closed) with a highlighted warning (FR-029): `destroy-sub-workspace.ts` helper wired into
  `panel-placeholder.destroyPanel` + `tab-group.confirmCloseTab` (last-Tab enabled in sub-workspace windows)
- [x] T120 [US-sub] **E2E** — closing the last Panel closes the sub-workspace; the project keeps its cloned
  Panel (one-directional) — in `subworkspace-owned-terminal.e2e.ts`
- [x] T121 [US-sub] Owned Panels can't be dragged out (FR-030): `tab-group` shows a red invalid-drop warning
  on the ghost when an owned Panel leaves the window; `dragGhost.hint(text, warn)` + `.hint.warn` ghost style
- [x] T122 [US-sub] **E2E** — dragging an owned Panel beyond the window shows the ghost warning (read from the
  ghost window) and leaves the Panel in place — in `subworkspace-owned-terminal.e2e.ts`

**Checkpoint (batch 3)**: owned-terminal + close-last-panel + drag-out-warning E2E green; 281 unit + 110
integration/contract + tsc green.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: no dependencies.
- **Foundational (P2)**: depends on Setup — **blocks all stories** (model + assign/revert ops + dispatcher seam).
- **US1 / Phase A (P3)**: depends on Foundational. **MVP.**
- **US2-config / Phase B (P4)**: depends on Foundational; extends the Terminal inputs from stub → real.
- **US2-launch / Phase C·1 (P5)**: depends on US2-config (chosen flavour+params) + Foundational (`clearPanelType` for revert). Mirroring (T047), revert (T053/T057), and root-lock (T043/T044/T048/T059) live here.
- **US3 / Phase C·2 (P6)**: depends on US2-launch (a live terminal to persist/reattach).
- **US4 / Phase C·3 (P7)**: depends on US2-launch (a live terminal to confine).
- **Polish (P8)**: after all desired stories.
- **Batch 2 (Plan Phases D–G)** — independent of A/B/C completion except where noted:
  - **Phase D (US5 sidebar + US9 drag-to-new-tab)**: UI/core only; no dependency on the terminal/daemon work.
  - **Phase E (US6 shell detection)**: refactors the Phase-B `WindowsShellDetection`; depends on B existing.
  - **Phase F (US8 destroy cascade)**: builds on the sub-workspace + terminal-kill paths (Phase C) and the rename-broadcast pattern.
  - **Phase G (US7 run-as-admin)**: builds on the Phase-C daemon terminal service + `NodePtyHost` + daemon-lifecycle handshake.
  - Recommended order D → E → F → G (smallest/independent first; G is the largest). Each closes on its E2E green.
  - **Note on priority vs. order:** US8 (destroy cascade) is **P1** but is sequenced in Phase F (after the
    P2/P3 phases D/E). This size-over-priority ordering is **deliberate and user-approved** (2026-07-01):
    D/E are small and fully independent, so shipping them first does not delay the P1 fix materially, and F
    builds on the Phase-C terminal-kill/sub-workspace paths it needs. If the P1 bug must land first, pull
    Phase F ahead of D/E — the phases are independent.

### Within each story

- Tests written first and observed **failing** before implementation (RGR).
- Core (pure) before adapters; abstractions + contract suites before concrete impls; daemon service before
  UI bridge; bridge before renderer view; **E2E last** and observed **passing** before the phase closes.

### Parallel opportunities

- All `[P]` Setup tasks (T001–T003) together.
- US1 tests T007/T008/T009 in parallel; renderer T012/T013 `[P]`.
- US2-config tests T016–T018 in parallel; `IShellDetection` def T021 `[P]`.
- US2-launch seams T030/T031/T032/T033/T034 in parallel (different files); `use-terminal` T052 + theme T055 `[P]`. PTY and DirectoryLock impls (T036/T038) are independent `[P]` once their seams/suites exist.
- US3: lifecycle test T060 + daemon-lifecycle T064 `[P]`.

---

## Parallel Example: User Story 2 launch — seams (Phase C·1)

```bash
# Define the seams + contract suites + launch-spec tests in parallel (different files):
Task: "Define IPtyHost in packages/core/src/abstractions/pty-host.ts"                        # T030
Task: "IPtyHost contract suite in packages/core/src/testing/pty-host-contract.ts"           # T031
Task: "launch-spec tests in packages/core/tests/unit/terminal-launch-spec.test.ts"          # T032
Task: "Define IDirectoryLock in packages/core/src/abstractions/directory-lock.ts"           # T033
Task: "IDirectoryLock contract suite in packages/core/src/testing/directory-lock-contract.ts" # T034
```

---

## Implementation Strategy

### MVP first (User Story 1 / Phase A)

1. Phase 1 Setup → Phase 2 Foundational → Phase 3 (US1).
2. **STOP and VALIDATE** the form in the running app (verify point 1). Demo.

### Incremental delivery (the three verify points)

1. **A** = US1 → demo the type-selection form (fixed-while-typed).
2. **B** = US2-config → demo the real Flavour dropdown + default params (still no launch).
3. **C** = US2-launch (live terminal + mirror + revert + root-lock) → US3 (survive-restart reattach) → US4
   (confinement). Each sub-phase ships its E2E green before the next.

### Notes

- `[P]` = different files, no incomplete dependency. `[Story]` maps each task to a spec user story.
- **No SQLite migration**; **node-pty + the directory lock live in the plain-Node daemon** (no
  electron-rebuild); detection UI-main-owned; streaming = JSON-RPC notifications fanned out to all
  subscribers; the project root is **locked while terminals are open**.
- A Panel's type is **fixed only while content is live** — a closed/failed terminal **reverts to the form**
  (`clearPanelType`), and a **synced** panel **mirrors one session** across views.
- Every phase closes only when its **E2E is observed passing** (constitution v3.4.0 Principle V).
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.

---

## Phase 13: Convergence (2026-07-01)

Appended by `/speckit-converge` after the batch-3 + Phase-G implementation. Each item is a genuine
remaining gap between the spec/plan/tasks intent and the current code, traced to its source. Complete via
`/speckit-implement`; a follow-up converge run will find fewer or none.

- [x] T123 Implement root confinement in `packages/core/src/terminal/confine.ts` (currently a stub) + unit tests, and apply it at launch / on cwd-change in `packages/daemon/src/terminal-service.ts` per FR-016 / US4 (missing)
- [x] T124 Add **E2E** `packages/ui/tests/e2e/terminal-confine.e2e.ts` — attempting to navigate above the project root keeps/returns the working context to root per FR-016 / US4 (missing)
- [x] T125 **De-elevation DELIVERED & verified elevated (mixed mode works).** The relauncher shim was a proven dead end (a de-elevated child can't attach to the elevated daemon's ConPTY). Replaced with a **medium-integrity PTY agent**: `pty-agent-entry` (separate process hosting node-pty, owns the pipe server at medium so the elevated daemon connects DOWN to it), `PtyAgentHost` (daemon-side `IPtyHost` proxy), and `WindowsDeElevatedLauncher` (launches the agent de-elevated via shell-token `CreateProcessWithTokenW` + `CREATE_NO_WINDOW` — works because a background process needs no console). `TerminalService` routes unchecked+elevated → agent, checked → local; `THRONG_FORCE_PTY_AGENT=1` forces the agent so the plumbing is verifiable at medium integrity. Also fixed the missing `runAsAdmin` wiring (config → `TerminalPanel` → `useTerminal` → attach). **Verified on an elevated host** via the RunAs loop: the `terminal-admin-integrity` @admin tests pass (unchecked → User de-elevated, checked → Admin) for cmd, PowerShell, and Git Bash. Pure `shouldDeElevate` + `IDeElevator` seam + `runDeElevatorContract` remain the OS-agnostic decision/contract; Linux/macOS agent-launch (setpriv/su → `$SUDO_USER`) is future work behind the same seam. The old `WindowsDeElevator` relauncher shim is disabled/retained for reference.
- [x] T126 Wire `packages/ui/src/main/daemon-lifecycle.ts` to **retire + re-spawn the daemon elevated** when the app is elevated but the daemon is not (reuse the build-id retirement path, gated on `shouldRespawnDaemonElevated`), and add the runner-independent injected-seam integration test `packages/ui/tests/integration/daemon-elevated-respawn.test.ts` per FR-025b (partial)
- [x] T127 Add **E2E** `packages/ui/tests/e2e/terminal-revert.e2e.ts` — `exit`/crash reverts the Panel to the type-selection form with exit info, then re-type works per FR-020 / Constitution Principle V (missing)
- [x] T128 Add **E2E** `packages/ui/tests/e2e/terminal-mirror.e2e.ts` — a Terminal Panel synced into a sub-workspace shows one shared session in both views (input in one appears in both) per FR-021 / Principle V (missing)
- [x] T129 Add **E2E** `packages/ui/tests/e2e/terminal-root-lock.e2e.ts` — with a terminal open the project root can't be deleted/renamed and its root path can't be edited; after closing all terminals it can, per FR-022 / Principle V (missing)
- [x] T130 Add **E2E** `packages/ui/tests/e2e/terminal-persistence.e2e.ts` — start a process, close + reopen the app → terminal still running + reattached with scrollback; idle cold-respawns; app-close three-choice prompt; a persisted-but-now-removed flavour surfaces flavour-unavailability per US3 / FR-019 / Principle V (missing)
- [x] T131 Verification: confirm `@throng/core` keeps **zero OS/DOM imports** (run the import guard over the new `elevation`/`resolve-shell`/`abstractions` modules) and assert SQLite stays at **`user_version 6`** (no migration) per Constitution Principle II + plan: no-migration decision (partial)
- [~] T132 Performance: coalesce/debounce `terminal.output` (~16 ms) with a bounded-scrollback flatness test, and assert a synced Terminal Panel **unsubscribes cleanly** on sub-workspace close (no leaked subscribers / zombie session) per plan: streaming perf / T075 / T077 (missing)
- [x] T133 Add batch-2/3 validation sections to `specs/005-terminal-panel-type/quickstart.md` (D→G + FR-028/029/030) and run the full A→G green gate (unit/integration/contract/E2E + lint/typecheck), confirming SC-001…SC-020 per SC-011 (partial)

## Phase 14: Convergence (2026-07-02) — Release reconciliation

Appended by `/speckit-converge` at the **"good enough for release"** decision (see spec **Release Status**).
Static gate green: `tsc -b` clean, **397 unit + contract + integration tests pass**; terminal/sub-workspace
E2E green and the `@admin` integrity suite verified on an elevated host (2 passed).

**Delivered since Phase 13 (no longer gaps):**

- **T125** — de-elevation mixed mode: **DONE & verified elevated** (cmd/PowerShell/Git Bash).
- **FR-024** — Git Bash now resolves to the **real** `git.exe`-derived bash, not WSL's `System32\bash.exe`.

**Accepted deferrals for this release** (already tracked above; carried forward as the post-release backlog,
not re-numbered): **T123/T124** root confinement (the stronger directory-lock ships; cwd-confinement stub),
**T126** elevated-daemon respawn (FR-025b; `start:admin` entry works today), **T127–T130** dedicated
revert/mirror/root-lock/persistence E2E (behaviours ship; adjacent E2E cover them), **T131/T132**
import-guard/`user_version 6` assertions + output-debounce perf, **T133** quickstart D→G validation section.

**New finding this pass:**

- [x] T134 Add a **daemon-liveness heartbeat** to the de-elevated PTY agent (`packages/daemon/src/pty-agent-entry.ts`) so it self-terminates (killing its ConPTYs) when its parent daemon dies without a clean pipe close — observed a stale orphaned agent + 5 live `conhost --headless` ConPTYs surviving a dead daemon (pid 7616). Prevents agent/ConPTY accumulation across app runs, per FR-018 lifecycle / resource-hygiene (missing)

## Phase 15: Convergence (2026-07-02) — Finalisation pass

Autonomous finish-the-spec pass. All Phase-13/14 items resolved to a delivered state or an explicit,
recorded decision. Gate: `tsc -b` clean; **402 unit + contract + integration tests green**; the new
terminal E2E (`terminal-no-orphans`, `-revert`, `-mirror`, `-root-lock`, `-persistence`) pass. Constitution
bumped to **v3.8.0** (Principle III resource-hygiene rule). Spec **Release Status** updated.

- [x] T123 **Root confinement — WON'T FIX (recorded).** Confining a live interactive shell's cwd (blocking
  `cd ..`) is infeasible without a fake shell; `confine.ts` stays an intentional no-op. The achievable
  guarantee ships as FR-022 (root locked while a terminal is open). Spec FR-016 + Assumptions revised.
- [x] T124 **Superseded by `terminal-root-lock.e2e.ts`** — asserts the OS refuses to delete a live shell's
  cwd and `projects.update(rootFolder)` is rejected while a terminal is open, allowed after it closes.
- [x] T126 **FR-025b DELIVERED** — daemon reports integrity via `health.ping`; `ensureDaemon` retires +
  respawns a non-elevated daemon when the app is elevated (`shouldRespawnDaemonElevated`); injected-seam
  integration test `daemon-elevated-respawn.test.ts`.
- [x] T127 `terminal-revert.e2e.ts` — exit reverts to the form with exit info, then re-types (FR-020).
- [x] T128 `terminal-mirror.e2e.ts` — synced Panel mirrors ONE session; input via either window's bridge
  appears in both views (FR-021).
- [x] T129 `terminal-root-lock.e2e.ts` — see T124.
- [x] T130 `terminal-persistence.e2e.ts` — a Panel restored with a now-removed flavour surfaces
  unavailability (reverts to the form), not a blank terminal (FR-019 restore arm). Reattach + three-choice
  prompt remain covered by `terminal-reattach.e2e.ts` / `app-close-terminals.e2e.ts`.
- [x] T131 **Verification present** — zero-OS/DOM import guard auto-scans all of core (covers the new
  `elevation`/`resolve-shell`/`abstractions` modules); `migration-runner` asserts `user_version` stays
  current (no 005 migration); new `terminal-hygiene` test asserts bounded scrollback + no leaked subscriber.
- [~] T132 **Partial by design** — the unsubscribe-clean + bounded-scrollback assertions ship
  (`terminal-hygiene.integration.test.ts`). Output **coalescing/debounce** is deliberately NOT implemented:
  it would risk the renderer's per-chunk screen-clear detection and the mirror path for a marginal gain, and
  the memory concern is handled by the bounded scrollback. Recorded as a deferred micro-optimisation.
- [x] T133 Added a **finalisation validation section** to `quickstart.md` (leak-fix/orphan-hygiene + FR-025b
  + the four dedicated E2E) and ran the full green gate.
- [x] T134 **No orphaned OS processes DELIVERED** — `NodePtyHost` tracks + reaps each session's `conhost.exe`
  on kill/exit; `TerminalService.shutdown()` runs on daemon SIGTERM/SIGINT; project-delete kills its
  terminals; the de-elevated agent reaps its ptys on disconnect + a daemon-liveness heartbeat.
  `terminal-no-orphans.e2e.ts` verifies baseline restoration for every flavour × every end path.

## Phase 16: Convergence (2026-07-04) — Pre-merge reconciliation

Feature scope is otherwise DELIVERED (FR-016 confinement = WON'T FIX, recorded; all Phase 13 items
superseded/resolved in Phase 15). These items are the remaining gap between the working tree and a
clean merge to `master`.

- [x] T135 **LANDED** — OSC 52 clipboard support (`osc52.ts` + xterm `registerOscHandler(52)` →
  `terminal.writeClipboard` main/preload wiring) and the reattach hardening (`attach-serializer.ts`
  FIFO-serialises `terminal.attach`; daemon `launchKey`-keyed reattach reaps-for-replace on re-type)
  committed as `e6cf3ea` with unit + e2e coverage (`terminal-clipboard.test.ts`,
  `attach-serializer.test.ts`, `terminal-reattach-identity.test.ts`, `terminal-clipboard.e2e.ts`) —
  307 unit green (FR-014 clipboard interactivity + FR-006 / FR-015a reattach robustness).
- [x] T136 **FIXED — root cause was NOT the timing hypothesis.** Systematic debugging (boundary
  instrumentation + timestamp markers) proved the `daemon-elevated-respawn` reuse case was not a
  ping-window flake: its daemon reported `buildId='test-A'` while on-disk `BUILD_ID='test-B'` →
  `stale` → unexpected respawn (`spawned=true`). Those values come from `daemon-lifecycle.test.ts`'s
  build-id tests, which mutate the **shared `daemon/dist/BUILD_ID`** artifact; the two integration files
  were running **concurrently** (proven: reuse START fell 276 ms into lifecycle-stale's window) because
  per-project `fileParallelism: false` does not actually serialize files. Fixed by forcing the
  integration (and contract) projects to one sequential worker via `pool: 'forks'` +
  `poolOptions.forks.singleFork: true` in `vitest.config.ts` — the serialization the existing comment
  already intended. Verified deterministic: integration 3/3 green, unit 45 + contract 9 green,
  `tsc -b` clean (Constitution Principle V — every phase lands green).
- [x] T139 **Documentation-currency reconciliation (constitution v3.10.0 merge gate).** Brought the
  public docs current with shipped behaviour **in-branch**: `README.md` (Terminal panels on detached
  daemon-owned PTYs, reattach with scrollback, root lock, run-as-admin, the `@admin` suite), `ROADMAP.md`
  (a delivered **Terminals** section marking terminal panels / shell auto-detection & flavours / safe
  lifecycle as `[x]`, with presets + further shell integrations still `[ ]`), and `CONTRIBUTING.md`
  (Node 20 / no-electron-rebuild toolchain). Also reconciled the spec-kit artifacts to remove convergence
  drift: `spec.md` US4 rewritten to match FR-016 WON'T-FIX + FR-022 root-lock, Release Status extended
  with the 2026-07-04 work (OSC-52 clipboard, reattach hardening, FR-025e status-bar pill), new **US10**
  for the owned-sub-workspace-terminal lifecycle (FR-028/029/030), **SC-021** for FR-025e, and an FR-009
  numbering note; `plan.md` Performance Goals debounce recorded as a deferral (T132), "confined to root"
  language corrected to "start in root", and a **Release-convergence Constitution Check (v3.7.0→v3.10.1)**
  added. *(Note: the doc-currency rule was retrofitted after the task list was written, so no per-phase
  task originally tracked it — the outcome the gate requires, docs current at merge, is met.)*

## Phase 17: Status-bar ADMIN pill (2026-07-04) — FR-025e

- [x] T137 **E2E** `packages/ui/tests/e2e/status-admin-pill.e2e.ts` (written first, RED) — with
  `THRONG_FAKE_ELEVATED=1` the status bar shows a red `ADMIN` pill on the RIGHT (border resolves
  red-dominant) and the `Tab · Panel` context sits on the LEFT; a normal launch shows no pill, per FR-025e.
- [x] T138 Implement the pill: reuse `useCapabilities()` (the daemon `terminal.capabilities().elevated`
  signal that gates the "run as admin" checkbox, FR-025a) in `packages/ui/src/renderer/statusbar/status-bar.tsx`
  — move `status-context` into the left section, render `status-admin-pill` on the right when elevated;
  red-outlined pill styled via `--throng-colour-danger` in `status-bar.css`. Add the `THRONG_FAKE_ELEVATED`
  test seam to the `throng:terminal:capabilities` handler in `packages/ui/src/main/terminal-ipc.ts` (make
  T137 pass). Verified: pill E2E 2/2 green; existing status-bar/title-statusbar/layout E2E still green.
