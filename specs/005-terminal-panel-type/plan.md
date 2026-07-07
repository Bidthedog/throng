# Implementation Plan: Typed Panels — Terminal Panel Type

**Branch**: `005-terminal-panel-type` | **Date**: 2026-06-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-terminal-panel-type/spec.md`

## Summary

Give a **Panel** an assignable **type — fixed while it hosts live content, re-typeable once that content
ends** (FR-006/FR-020 clarified) — via an extensible type-selection form
(replacing the inert "Empty Panel" body), and ship the first concrete type — **Terminal** — as a live,
interactive shell hosted by the **persistent, detached daemon** and attached inline in the Panel. This is
the first real delivery of the constitution's terminal mandate (Principle III "Detached, Tagged &
Persistent Terminals", Principle IV "Native Terminal Support & Auto-Detection"); the daemon's reserved
extension point (`daemon/src/main.ts:42` — *"the daemon will own the terminal layer (detached PTYs,
tagging, persistence, reattachment)"*) is finally filled.

Per the user's directive, delivery is **strictly phased so each phase is independently visible and
verified before the next begins**:

- **Phase A — Panel type UI** (no settings, no daemon): the `Panel` gains a `kind` + `config`; a
  `PanelBody` dispatcher swaps the placeholder for a **type-selection form** (Panel-Type dropdown with
  per-type dynamic inputs, **Confirm**/**Clear**, validation, type **fixed while content is live** — not
  permanently immutable, FR-006 clarified — plus a `clearPanelType` op for the later revert, persistence).
  The Terminal type's inputs render but the flavour list is a stub; **no terminal launches yet**.
- **Phase B — Settings & flavour detection** (no daemon): a new `settings.terminals` section (built-in
  flavour catalogue toggles + a **user-defined flavour array** + default-params overrides), an
  **`IShellDetection`** OS seam (Windows impl, UI-main-owned like 004's FS seams) exposed over a new
  `terminal.listFlavours` preload bridge. The form's **Flavour** dropdown now populates for real (union of
  detected built-ins + user-defined) and pre-fills **Startup Params** with the flavour's default. Still
  **no terminal launches**.
- **Phase C — Terminal & backing daemon** (the large slice): the **persistent always-on detached
  daemon** (UI spawns-if-absent, single-instance, auto-reconnect), a **streaming channel** (daemon→UI
  JSON-RPC notifications over a long-lived socket), **node-pty/ConPTY** PTYs owned by the daemon, an
  **xterm.js** view mounted in the Terminal Panel via a `terminal.*` bridge, **reattach by `panelId`**
  from the daemon's in-memory registry (live session + replayed scrollback), **mirrored sessions** (a
  synced panel shows one session in many views — `subscribers` fan-out, FR-021), **revert-to-form on
  terminal end** (FR-020), a **project-root lock** while terminals are open (`IDirectoryLock`, ref-counted
  per project + project-root-edit guard, FR-022), **idle-close / cold-respawn**, the **app-close
  three-choice warning**, **root confinement**, and **unexpected-exit surfacing**.

**Technical approach** — preserve the 001/002/003/004 constitutional boundaries:

- **Pure decisions live in `@throng/core`** (`panel-type/` + `terminal/`): the panel-type **registry**
  (open for extension), per-type **input schema + validation**, the **Terminal flavour model**, **launch-
  spec resolution** (flavour + params + project-root cwd → executable/args/cwd), and **root-confinement
  rules**. Zero OS/DOM imports (guarded, as in 004).
- **Flavour detection is an OS seam** — new **`IShellDetection`** in `@throng/core/abstractions`, Windows
  impl **`WindowsShellDetection`** in `@throng/platform-windows` (alongside `WindowsPlatformInfo`),
  verified by a reusable **contract suite** (`@throng/core/testing`). In Phase B it is **instantiated in
  UI main** (mirroring 004's inline `NodeFileSystem`/`ElectronShellIntegration`) and exposed via the
  preload bridge — so **Phase B touches no daemon code**.
- **Terminals are daemon-owned** (Principle III). New seam **`IPtyHost`** (start/write/resize/kill +
  output/exit events) in core; Windows/Node impl wraps **`node-pty`** in the daemon. Because the **daemon
  runs as plain Node** (`node packages/daemon/dist/main.js`), node-pty builds against the host Node 20 ABI
  at install time — **no electron-rebuild** — exactly like the existing `better-sqlite3`.
- **A Panel's type is fixed only while it hosts live content** (FR-006 clarified): a Terminal Panel whose
  process ends **reverts to the type-selection form** (FR-020) via a pure `clearPanelType` op — the panel
  is never permanently locked. A **synced** Terminal Panel (same `panelId`) shows **one** session in many
  views (FR-021) by adding each view's events socket to the session's `subscribers`.
- **The project root is locked while terminals are open** (FR-022): a new OS seam **`IDirectoryLock`**
  (acquire/release; Windows impl opens a directory handle without delete/rename share) is held by the
  daemon, **ref-counted per project** (first terminal acquires, last releases), and the **project-root-edit
  path refuses to change a root** while terminals are open. Behind the OS abstraction (Principle II).
- **The persistent daemon + push transport is the one big architectural addition** (the 004 plan
  explicitly deferred "reworking the daemon's per-call request/response pipe into a persistent push
  channel … until real terminals/scrollback land" — that time is now). The UI **spawns the daemon
  detached if the pipe is absent** and reconnects otherwise; a **single long-lived events socket** carries
  daemon→UI **JSON-RPC notifications** (`terminal.output`/`terminal.exit`/`terminal.flavourMissing`),
  which UI main **forwards to the renderer via `webContents.send`** (the proven 003/004 push pattern).
  Terminal **commands** (start/write/resize/kill/attach/list) reuse the existing per-call JSON-RPC.
- **No persistence migration.** A Panel's `kind` + `config` ride inside the existing
  `workspace_layout.layout_json` blob (auto-(de)serialised). The daemon holds an **in-memory session
  registry keyed by `panelId`** (PTY handle + bounded scrollback ring + durable tag); reattach after a UI
  restart is registry lookup. After **daemon** death the OS has already killed the child processes, so
  those terminals return **cold** (respawned from the persisted `config`) — nothing a SQLite table could
  restore. **SQLite stays at `user_version 6`.**
- **The view** mounts **xterm.js** (new renderer dep) inside the Terminal Panel body, themed via
  `var(--throng-*)` tokens (new terminal colour tokens). The type-selection **form** is a plain themed
  React component. `react-arborist`/`@dnd-kit` are untouched (pane-scoped).
- New **`settings.terminals`** section + **terminal theme tokens** extend the 003/004 config schemas,
  hot-reloaded like the rest. The emulated `panelHasRunningSubprocess` (`renderer/workspace/subprocess.ts`)
  becomes a **real** daemon-backed query.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS (ESM); React 18 (renderer).

**Primary Dependencies**: Electron (UI shell; UI-main spawns the daemon + owns `IShellDetection`); React 18
+ Vite; **xterm.js** (`@xterm/xterm` + `@xterm/addon-fit` — **new**, renderer-only terminal view);
**node-pty** (**new**, in `@throng/platform-windows`/daemon — ConPTY-backed PTY; built for **plain Node 20**,
no electron-rebuild, same model as `better-sqlite3`); InversifyJS + reflect-metadata (DI); better-sqlite3
(daemon store, **unchanged**); Vitest (unit/integration/contract); Playwright-Electron (E2E). No editor
libraries (the open-file/editor concern remains a separate feature).

**Storage**:
- **No schema change; SQLite stays at `user_version 6`.** A Panel's `kind` (`'terminal' | …`) and
  `config` (the captured per-type configuration, e.g. the resolved terminal launch spec) are new
  **optional** fields on the core `Panel` type and serialise inside the existing
  `workspace_layout.layout_json` blob — restored verbatim on project reopen (no migration, mirroring
  004's "no persistence for live data").
- The daemon's **terminal session registry is in-memory** (PTY handle + bounded scrollback ring +
  durable tag `{projectId, panelId, flavourId, cwd, params}`), keyed by `panelId`. Lost only on daemon
  death (when the OS has already reaped the child processes) → cold respawn from the persisted `config`.
- User config (003/004, UI-main-owned JSON under `%USERPROFILE%\.throng\`) gains a **`terminals`**
  section in `settings.json` (`flavours: TerminalFlavourConfig[]` user-defined entries; optional
  `disabledBuiltins: string[]`; per-flavour `defaultParams` overrides) and **terminal theme tokens**
  (`colour.terminalBg/terminalFg/terminalCursor/…` + a `terminal` icon). All hot-reloaded.

**Testing**: Vitest unit (core: panel-type **registry** open/closed behaviour, per-type **validation**,
**assign-from-untyped + `clearPanelType` revert** (fixed-while-typed, re-typeable), **launch-spec
resolution**, **flavour union/merge** of built-ins + user-defined, **default-params** selection,
**root-confinement** rules, **idle/busy** classification
logic); Vitest integration/contract (**`IShellDetection`** contract suite vs `WindowsShellDetection` on a
real machine; **`IPtyHost`** contract suite vs the node-pty impl — start/echo/write/resize/exit against a
real short-lived shell; **daemon terminal service** start→stream→attach-replay→kill over the real pipe
incl. the new notification channel; **persistent-daemon** spawn-if-absent + single-instance + reconnect);
Playwright-Electron **E2E per phase** (A: form renders, type select swaps inputs, Clear resets, Confirm
locks type, persists across reload; B: Flavour dropdown populated from machine + user-added flavour
appears + params default fills/changes; C: live terminal echoes input, cwd = project root, unexpected
exit shows code, **survive app close→reopen reattaches live with scrollback**, idle cold-respawn,
app-close three-choice prompt, root-confinement). **Every user-facing UI change ships with passing E2E**
(constitution v3.4.0 Principle V); each phase lands green before the next. RGR mandatory.

**Target Platform**: Windows 11 desktop (first supported); OS seams (`IShellDetection`, `IPtyHost`) keep
macOS/Linux open.

**Project Type**: Desktop application (Electron UI client + headless **plain-Node daemon**), npm-workspaces
monorepo (extends 001/002/003/004).

**Performance Goals**: Type-selection form opens instantly with the placeholder. Flavour detection
completes within **~1 s** of selecting Terminal (cached after first run). A confirmed terminal is
interactive within **~3 s** (SC-004). PTY output streams to xterm with imperceptible latency. Reattach
after UI restart replays scrollback and resumes streaming within **~2 s**. Scrollback ring is bounded
(e.g. last ~64 KB/session) so memory stays flat under long-running output. *(Update 2026-07-02: output
frame **coalescing/debounce** — originally listed here as a ~16 ms flood guard — was deliberately **NOT
implemented** (T132). It risks the renderer's per-chunk screen-clear detection and the mirror path for a
marginal gain, and the memory concern it targeted is already handled by the bounded scrollback. Recorded
as an accepted deferral, not a shipped constraint.)*

**Constraints**: No Docker; npm scripts only. `@throng/core` keeps **zero OS/DOM imports** (guarded) — all
shell detection and PTY work is behind `IShellDetection`/`IPtyHost`. Renderer is **sandboxed** (no
`fs`/`node-pty`/sockets); it reaches terminals only through the preload `terminal.*` bridge → UI main →
daemon. **One IoC composition root per process** (daemon, UI main, UI renderer = 3) — `IPtyHost` +
terminal service bound in the **daemon** root; `IShellDetection` instantiated in **UI main** (Phase B,
inline like 004's FS seams). Terminals **start in** the project root (cwd set at spawn); *cwd confinement
is WON'T FIX (2026-07-02) — the achievable guarantee is the **root lock** while a terminal is open
(FR-022)*. The daemon is **persistent/detached** and **single-instance** (pipe = lock).
Configuration injected via typed settings (Principle X).

**Scale/Scope**: Single user, single machine, local-only. A handful to dozens of concurrent terminals
across projects/sub-workspaces, each a daemon-owned PTY with a bounded scrollback buffer. Packages
touched: `core` (new `panel-type/` + `terminal/` + `IShellDetection`/`IPtyHost`/`IDirectoryLock`
abstractions + contract suites), `platform-windows` (new `WindowsShellDetection`, `NodePtyHost`,
`WindowsDirectoryLock`), `daemon` (terminal service + registry + lock manager + root-edit guard + streaming
notifications + composition), `ui` (main: daemon-spawn + events socket + shell detection + `terminal.*`
ipc; renderer: form, terminal view, settings, theme), `ipc-contract` (terminal RPC methods + notification
frames), and `persistence` (**read-only** — a test asserting `user_version` stays at 6, T074). **No**
persistence migration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against all eleven principles of constitution **v3.4.0** (note the v3.4.0 Principle V rule:
**every user-facing UI change MUST ship with passing E2E coverage** — honoured per phase below).

> **Note (batch 2, 2026-07-01):** the A/B/C gate below was assessed at **v3.4.0** and remains valid. The
> constitution is now **v3.6.0** (Principle XI Sidebar change + Principle III elevation clause); those
> deltas are re-evaluated in the **[Batch 2 Constitution Check](#constitution-check--batch-2-re-evaluated-vs-v360)**.

| # | Principle | Verdict | How this plan satisfies it |
|---|-----------|---------|----------------------------|
| I | Project-First Context Isolation | ✅ PASS | Terminals **start in the active project's root** (cwd-confinement afterwards is WON'T FIX — FR-016); each terminal is tagged with its owning `projectId` + `panelId`; a Panel reattaches only within its project. The **project root is locked while terminals are open** (FR-022) and its root path cannot be changed then — the binding context can't be pulled out from under a running terminal. Strengthens isolation. |
| II | Platform-Abstracted Core | ✅ PASS | New OS seams **`IShellDetection`** (detect installed shells), **`IPtyHost`** (spawn/stream/kill PTYs) and **`IDirectoryLock`** (lock the project root against delete/move) in `@throng/core` with **contract suites**; concrete impls (`WindowsShellDetection`, `NodePtyHost` over node-pty/ConPTY, `WindowsDirectoryLock`) live in `@throng/platform-windows`. Core stays OS/DOM-free. |
| III | Detached/Persistent Terminals | ✅ PASS | **The headline.** Terminals run in a **persistent, detached, single-instance daemon** that **outlives the UI**; active sessions **survive app close** and **reattach live with scrollback**; idle shells **close + cold-respawn**; each terminal is **durably tagged**; **unexpected exit surfaces code+output**; the **app-close three-choice** warning is implemented. Terminal lifecycle is separate from its Panel's. |
| IV | Native Terminal Support & Auto-Detection | ✅ PASS | Hosts **real installed shells** (not an emulator); **auto-detects** them (built-in catalogue filtered to installed) and lets the user **add their own** in settings; new terminal cwd = **project root**; running terminals are listable/switchable as Panels. |
| V | Test-First Quality Discipline | ✅ PASS | Unit + integration + **contract suites** for both new seams + **E2E for every UI change, delivered and observed green per phase** (A form, B detection, C live/persist). RGR per task; lifecycle (spawn/detach/tag/reattach/idle-respawn) covered by automated tests. |
| VI | Simple, Modern, Discoverable UX | ✅ PASS | A discoverable form (dropdown + Confirm/Clear) replaces the blank Panel; a familiar inline terminal; fully themed; respects the dominant project colour. |
| VII | Change Review & Approval | ✅ PASS (N/A) | The edit list is out of scope; this feature does not mutate the review flow. (Terminals will become a change *source* a future edit-list feature consumes.) |
| VIII | SOLID/DRY/YAGNI | ✅ PASS | **Reuse** node-pty + xterm.js + the proven watch/push pattern + the existing JSON-RPC framing (notifications added, not a new protocol); segregated seams (ISP); pure decisions/registry in core (SRP). **YAGNI**: no SQLite terminals table (config rides the layout blob; nothing restorable after daemon death); detection in UI main avoids daemon coupling in Phase B. The persistent push channel is built **now that it is actually needed**, not speculatively. |
| IX | DI & Composition Root | ✅ PASS | Still three roots. `IPtyHost` + the daemon **terminal service** + the events publisher are **constructor-injected** in the **daemon** root; `IShellDetection` is instantiated in **UI main** (inline, matching 004). Renderer gets data only via the preload bridge. |
| X | Externalised Configuration | ✅ PASS | The **`settings.terminals`** section (user flavours, disabled built-ins, default-params overrides), terminal **theme tokens**, pipe name, and scrollback limit are **injected typed settings** — nothing hardcoded in logic. |
| XI | Dockable Workspace: Panes, Tabs & Panels | ✅ PASS | **Advances** Principle XI: a Panel becomes **typed**; a Terminal Panel hosts a real terminal while staying a draggable/splittable/detachable Panel whose **lifecycle is independent of its terminal** (closing the terminal leaves the Panel; destroying the Panel kills the terminal). Works in the main workspace and sub-workspaces. |

**Architecture constraints**: daemon single SQLite writer **unchanged** ✅ (no migration); per-user local
storage ✅; renderer sandbox preserved (terminals via bridge → UI main → daemon) ✅; **single instance**
extended to guarantee a single **daemon** (pipe = lock) ✅; **lazy loading** preserved (terminals
reattach on demand when a project/panel opens) ✅; Electron+TS + **daemon-owns-terminals** baseline
**now realised** ✅; **reuse-not-fork** (node-pty + xterm.js, not a forked IDE terminal) ✅; agents remain
a future layer above terminals ✅.

**Gate result: PASS — no violations.** Deliberate, compliant decisions recorded under
[Complexity Tracking](#complexity-tracking): the persistent-daemon + streaming-transport addition, the new
`node-pty` (daemon, plain-Node) and `xterm.js` (renderer) dependencies, detection owned by UI main in
Phase B, no SQLite migration, and the pragmatic idle/busy classification.

## Phased Delivery

Each phase is an independently shippable, **independently E2E-verified** increment (Incremental Delivery
rule). The user reviews the running result of each phase before the next starts.

| Phase | Delivers (verify point) | Touches | New deps | E2E gate |
|------|--------------------------|---------|----------|----------|
| **A — Panel type UI** | `Panel.kind`+`config`; `setPanelType`/`clearPanelType` ops; `PanelBody` dispatcher; type-selection form (dropdown, per-type dynamic inputs, Confirm/Clear, validation, type **fixed while typed** — re-typeable when untyped). Terminal inputs render with a **stub** flavour list; **no launch**. | `core/panel-type`, `core/workspace` model+ops, `ui` renderer (form, dispatcher), persistence rides existing blob | — | Form renders instead of "Empty Panel"; select type → inputs swap; Clear resets; Confirm assigns type; type fixed while typed; survives reload. |
| **B — Settings & detection** | `settings.terminals` (user flavours + disabled built-ins + default-params); built-in flavour **catalogue**; **`IShellDetection`** + `WindowsShellDetection` (UI-main inline); `terminal.listFlavours` bridge; real **Flavour** dropdown (built-ins∩installed ∪ user) + **default Startup Params** per flavour. **No daemon, no launch.** | `core/terminal` (catalogue, flavour model, merge, defaults), `core/abstractions` + `platform-windows`, `ui` main (detection + bridge) + renderer (form wiring, settings read) | — | Flavour dropdown populated from machine; user-added flavour in `settings.json` appears; params field fills default & updates on flavour change. |
| **C — Terminal & daemon** | Persistent detached daemon (spawn-if-absent, single-instance, reconnect); daemon→UI **streaming notifications**; **`IPtyHost`**/node-pty PTYs; daemon **terminal service** + in-memory registry; `terminal.*` bridge; **xterm.js** Terminal Panel; **reattach by panelId** (live + scrollback); **mirrored sessions** (FR-021); **revert-to-form on exit** (FR-020); **project-root lock** (`IDirectoryLock`, ref-counted + edit guard, FR-022); **idle-close/cold-respawn**; **app-close three-choice**; **root confinement**; **unexpected-exit surfacing**; real `panelHasRunningSubprocess`. | `core` (`IPtyHost`, `IDirectoryLock`, launch-spec, idle/busy, contracts), `platform-windows` (`NodePtyHost`, `WindowsDirectoryLock`), `daemon` (terminal service, registry, lock manager, notifications, root-edit guard, composition, lifecycle), `ui` main (daemon spawn, events socket, `terminal.*` ipc) + renderer (xterm view, revert), `ipc-contract` | `node-pty`, `@xterm/xterm`, `@xterm/addon-fit` | Live echo; cwd=root; exit shows code **+ panel reverts to form**; **close app→reopen reattaches live+scrollback**; synced panel mirrors one session; **root undeletable while open**; idle cold-respawn; three-choice prompt; cd-above-root blocked. |

## Project Structure

### Documentation (this feature)

```text
specs/005-terminal-panel-type/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 — decisions D1–D17 (D15–D17 = FR-020/021/022 clarifications)
├── data-model.md        # Phase 1 — Panel.kind/config, panel-type registry, flavour/launch-spec, settings, in-memory session + root-lock model (no SQL)
├── quickstart.md        # Phase 1 — phased validation/run guide (A → B → C)
├── contracts/           # Phase 1
│   ├── panel-type.md             # core PanelType registry + per-type input schema/validation + assign/revert (clearPanelType)
│   ├── shell-detection.md        # IShellDetection seam contract (detect installed shells; extended for FR-024 ordered resolver + registry probe)
│   ├── pty-host.md               # IPtyHost seam contract (start/write/resize/kill + output/exit)
│   ├── directory-lock.md         # IDirectoryLock seam contract (lock project root vs delete/move, FR-022)
│   ├── elevation.md              # (batch 2) IElevationState seam contract (detect elevation + de-elevated spawn, FR-025a/c)
│   ├── terminal-rpc.md           # daemon JSON-RPC methods + daemon→UI notification frames + persistent events socket + daemon spawn/single-instance
│   ├── terminal-bridge.md        # preload terminal.* API (listFlavours/start/write/resize/kill/attach/list + onOutput/onExit push)
│   └── config-additions.md       # settings.terminals + terminal theme tokens
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Extends the existing monorepo. **New** files marked `(new)`; **extended** marked `(ext)`. Phase tags
`[A]/[B]/[C]` show when each lands.

```text
packages/
├── core/
│   ├── src/
│   │   ├── abstractions/
│   │   │   ├── shell-detection.ts       # (new)[B] IShellDetection — detectInstalledShells(): DetectedShell[]
│   │   │   ├── pty-host.ts              # (new)[C] IPtyHost — start/write/resize/kill + onData/onExit
│   │   │   └── directory-lock.ts         # (new)[C] IDirectoryLock — acquire/release (lock root vs delete/move, FR-022)
│   │   ├── panel-type/                   # (new)[A] pure panel-type system
│   │   │   ├── registry.ts             #   open registry: register/list PanelTypeDescriptor; resolve by id
│   │   │   ├── descriptor.ts           #   PanelTypeDescriptor: id, label, input schema, validate, defaults
│   │   │   └── assignment.ts           #   setPanelType (assign from untyped) + clearPanelType (revert to form, FR-020); fixed-while-typed
│   │   ├── terminal/                     # (new)[B/C] pure terminal domain
│   │   │   ├── flavour.ts              #   TerminalFlavour model; built-in catalogue; merge built-ins∩installed ∪ user (B)
│   │   │   ├── defaults.ts             #   per-flavour default startup params (PowerShell -NoLogo, CMD /K, Git Bash -i -l) (B)
│   │   │   ├── launch-spec.ts          #   resolve flavour+params+projectRoot → { file, args, cwd } (C)
│   │   │   ├── confine.ts              #   root-confinement rule helpers (C)
│   │   │   ├── lifecycle.ts            #   idle/busy classification + reattach/cold-respawn decision (C)
│   │   │   └── panel-type.ts           #   Terminal PanelTypeDescriptor (stub flavours [A]; real [B]) — registers into the panel-type registry
│   │   ├── workspace/
│   │   │   ├── model.ts                # (ext)[A] Panel gains `kind?` + `config?` (optional → back-compat)
│   │   │   └── operations.ts           # (ext)[A] setPanelType (assign from untyped) + clearPanelType (revert) ops
│   │   ├── config/
│   │   │   ├── app-settings.ts         # (ext)[B] add `terminals` { flavours[], disabledBuiltins[], defaultParams } + validator + defaults
│   │   │   └── theme.ts                # (ext)[C] terminal colour tokens + `terminal` icon + defaults
│   │   └── testing/
│   │       ├── shell-detection-contract.ts # (new)[B] reusable IShellDetection contract suite
│   │       ├── pty-host-contract.ts        # (new)[C] reusable IPtyHost contract suite
│   │       └── directory-lock-contract.ts  # (new)[C] reusable IDirectoryLock contract suite
│   └── tests/unit/                        # (ext) registry, assignment/lock, flavour-merge, defaults, launch-spec, confine, idle/busy
│
├── platform-windows/
│   ├── src/
│   │   ├── windows-shell-detection.ts   # (new)[B] IShellDetection: probe PATH + known install dirs (PowerShell 5/7, CMD, Git Bash)
│   │   ├── node-pty-host.ts             # (new)[C] IPtyHost over node-pty (ConPTY)
│   │   ├── windows-directory-lock.ts     # (new)[C] IDirectoryLock: open dir handle w/o delete/rename share (FR-022)
│   │   └── index.ts                     # (ext) export the impls
│   └── tests/contract/                    # (ext)[B/C] run shell-detection + pty-host + directory-lock contract suites vs real impls
│
├── ipc-contract/
│   └── src/
│       ├── terminal.ts                  # (new)[C] terminal.* method names + params/results + notification frame types
│       └── index.ts                     # (ext)[C] export terminal contract
│
├── daemon/
│   ├── src/
│   │   ├── terminal-service.ts          # (new)[C] start/write/resize/kill/attach/list; in-memory registry keyed by panelId; scrollback ring; tags; multi-subscriber (FR-021)
│   │   ├── terminal-events.ts           # (new)[C] publisher: fan out terminal.output/exit to ALL subscribed sockets
│   │   ├── terminal-lock-manager.ts      # (new)[C] ref-counted IDirectoryLock per project: acquire on first terminal, release on last (FR-022)
│   │   ├── project-service.ts           # (ext)[C] refuse root-path change while a project has open terminals (FR-022 edit guard)
│   │   ├── ipc-server.ts                # (ext)[C] allow server-initiated notification frames on a long-lived (subscribed) socket
│   │   ├── rpc-router.ts                # (ext)[C] register terminal.* methods
│   │   ├── composition-root.ts          # (ext)[C] bind IPtyHost (NodePtyHost) + IDirectoryLock (WindowsDirectoryLock) + TerminalService + lock manager + events publisher
│   │   ├── tokens.ts                    # (ext)[C] PtyHost, DirectoryLock, TerminalService, LockManager tokens
│   │   └── main.ts                      # (ext)[C] fill the reserved terminal extension point; keep running while sessions live
│   └── tests/integration/                 # (ext)[C] terminal start→stream→attach-replay→kill over the pipe; notification channel; mirror fan-out; root-lock; root-edit guard
│
└── ui/
    ├── src/
    │   ├── main/
    │   │   ├── daemon-lifecycle.ts      # (new)[C] connect-or-spawn-detached + single-instance race handling + readiness wait
    │   │   ├── daemon-events.ts         # (new)[C] long-lived events socket → forward terminal notifications to renderers (webContents.send)
    │   │   ├── shell-detection-service.ts # (new)[B] instantiate WindowsShellDetection; merge with settings.terminals; serve listFlavours
    │   │   ├── terminal-ipc.ts          # (new)[C] ipcMain handlers: terminal.start/write/resize/kill/attach/list → daemon RPC
    │   │   ├── composition-root.ts      # (ext)[B/C] wire shell-detection (B) and terminal bridge (C)
    │   │   └── main.ts                  # (ext)[B] register terminal:listFlavours; (C) spawn daemon, wire events socket + terminal ipc + app-close prompt
    │   ├── preload/preload.cts          # (ext)[B] terminal.listFlavours; (C) terminal.{start,write,resize,kill,attach,list,onOutput,onExit}
    │   └── renderer/
    │       ├── workspace/
    │       │   ├── panel-body.tsx       # (new)[A] dispatcher: kind==='terminal' → <TerminalPanel/>; untyped → <PanelTypeForm/>; else placeholder
    │       │   ├── panel-placeholder.tsx# (ext)[A] body delegates to <PanelBody/>; destroy uses real running-process check (C)
    │       │   ├── split-tree.tsx       # (ext)[A] render <PanelBody/> at the panel leaf (split-tree.tsx:114)
    │       │   └── subprocess.ts        # (ext)[C] panelHasRunningSubprocess → query daemon/terminal state (was emulated)
    │       ├── panel-type/               # (new)[A] the type-selection form
    │       │   ├── panel-type-form.tsx  #   Panel-Type dropdown + dynamic inputs host + Confirm/Clear + validation (fixed-while-typed)
    │       │   ├── terminal-inputs.tsx  #   Terminal type inputs: Flavour dropdown + Startup Params (stub list [A]; real [B])
    │       │   ├── use-flavours.ts       # (new)[B] load terminal.listFlavours; default-params wiring
    │       │   └── panel-type.css       #   themed form styling via var(--throng-*)
    │       ├── terminal/                 # (new)[C] the inline terminal view
    │       │   ├── terminal-panel.tsx   #   mount xterm.js; attach by panelId; stream I/O via terminal.* bridge; on exit → surface error + clearPanelType (revert to form, FR-020)
    │       │   ├── use-terminal.ts        #   attach lifecycle, onOutput/onExit subscription (mirrored, FR-021), scrollback replay, resize (fit addon)
    │       │   └── terminal.css          #   xterm container theming via var(--throng-*)
    │       ├── app-close-prompt.tsx     # (new)[C] three-choice warning when running terminals exist on app close
    │       └── config/config-store.tsx  # (ext)[B] expose settings.terminals + terminal theme tokens
    ├── tests/unit/                         # (ext) panel-type-form reducer, terminal-inputs, use-flavours, use-terminal reducer
    └── tests/e2e/                          # (ext) panel-type-form.e2e.ts [A], terminal-flavours.e2e.ts [B], terminal.e2e.ts [C]
```

**Structure Decision**: Extend the 001/002/003/004 monorepo. **All decision logic is pure in
`@throng/core`** (`panel-type/` registry + `terminal/` flavour/launch/confine/lifecycle + the
`IShellDetection`/`IPtyHost` abstractions). **Flavour detection is owned by UI main** (Phase B, inline
like 004's FS seams) so the settings/dropdown slice needs **no daemon work**. **Terminals are owned by
the daemon** (Phase C): `NodePtyHost` + a terminal service with an **in-memory registry keyed by
`panelId`**, streamed to the renderer over a **new persistent daemon→UI notification channel** (the
transport 004 deferred), with the **renderer sandboxed** behind the `terminal.*` preload bridge and an
**xterm.js** view. The **daemon becomes persistent/detached** (UI spawns-if-absent, single-instance via
the pipe). **Persistence (SQLite) and the migration runner are untouched** — a Panel's `kind`+`config`
ride the existing layout JSON blob, and live session state is in-memory by necessity.

## Complexity Tracking

> No Constitution Check violations. Rows below are deliberate, compliant decisions recorded for reviewer
> scrutiny (Dev Workflow gate). Note: this feature **closes** two prior tracked deferrals — the terminal
> layer (Principle III/IV) and the persistent daemon push transport the 004 plan deferred.

| Decision | Why needed | Alternative rejected because |
|----------|------------|------------------------------|
| **Persistent detached daemon + new daemon→UI streaming channel** (UI spawns-if-absent, single-instance via pipe; long-lived events socket carrying JSON-RPC **notifications**) | Principle III requires terminals to **outlive the UI** and **reattach live with scrollback**; that is impossible without a long-lived holder of the PTY masters and a push channel for output. The 004 plan explicitly deferred this transport "until real terminals/scrollback land" — now true. | **Keep request/response only** — rejected: cannot stream live PTY output or survive UI close (the whole point of Option B). **A brand-new protocol/transport** — rejected: reuse the existing newline-delimited JSON-RPC framing and just add notification frames + one subscribed socket (DRY). **Terminals in UI main** — rejected: dies with the UI (violates III). |
| **New native dep `node-pty` in the daemon (plain Node)** | Real ConPTY-backed shells (Principle IV) need a PTY; node-pty is the standard. Because the **daemon runs as plain Node**, node-pty builds against host Node 20 at install — **no electron-rebuild** (same as `better-sqlite3`). | **child_process without a PTY** — rejected: no TTY semantics (no interactive prompts/ANSI/resize). **winpty** — rejected: ConPTY (node-pty) is the modern Windows path. **PTY in the Electron process** — rejected: would need electron-rebuild and couples terminals to the UI. |
| **New renderer dep `xterm.js`** (`@xterm/xterm` + `addon-fit`) | The de-facto terminal emulator widget (ANSI, selection, resize, performance) — renders the daemon's PTY stream inline; themed via tokens. | **Hand-rolled terminal view** — rejected (reinvents ANSI parsing/perf/a11y; violates reuse/YAGNI). |
| **Flavour detection owned by UI main** (Phase B), not the daemon | Lets the **settings + dropdown** slice ship and be verified with **zero daemon work**, mirroring 004's UI-main FS seams; the resolved launch spec is captured into `config` and handed to the daemon at start. | **Detection in the daemon** — rejected for Phase B: pulls daemon lifecycle work into the settings phase and breaks the user's phase boundary; the daemon only needs the resolved launch spec, not detection. |
| **No SQLite migration; Panel `kind`+`config` ride the layout JSON blob; session registry in-memory** | The layout blob already round-trips arbitrary Panel fields (DRY — one source of truth). Live session state (PTY handle, scrollback) is inherently in-memory; after **daemon** death the OS has reaped the children, so a terminals table could restore nothing useful — only the `config`, which already persists. | **A `terminals` table (migration v7)** — rejected (YAGNI): duplicates `config`, restores no live process, adds schema/versioning surface for zero recoverable benefit. |
| **Pragmatic idle/busy classification** (a terminal is "busy" if its shell has a live non-shell descendant process; else "idle") | Principle III distinguishes active vs idle terminals for close/respawn; needs a concrete, testable rule behind the OS seam. | **Perfect foreground-job detection** — rejected (over-engineered/fragile on ConPTY); the descendant-process heuristic is implementable, testable, and good enough, with a documented safe default (treat as busy if undetectable, never silently killing a running process). |
| **Re-typeable panels** (type fixed only while content is live; revert to form on terminal end via `clearPanelType`) — clarified FR-006/FR-020 | The user clarified that a closed/failed terminal returns the Panel to the form so they can relaunch or pick another type; matches the constitution's "panel remains, ready for a new terminal." | **Permanent immutability** (original FR-006) — rejected by clarification. **A bare restart button** — rejected: the user wants to switch to *another* type, which only the form offers. |
| **New OS seam `IDirectoryLock` + per-project ref-counted root lock** (daemon holds the root open w/o delete/rename share; project-root-edit guard) — clarified FR-022 | The user chose **prevention**: while terminals are open, the project root must not be deletable/movable and its path not editable (Principle I — the binding context can't vanish under a running terminal). A held directory handle is the standard Windows mechanism. | **After-the-fact error only** — superseded by the user's prevention choice. **A deletion-watcher** — rejected (racy; reacts, can't *prevent*). Behind the OS abstraction (II) so other OSes use their own advisory lock. |
| **Synced Terminal Panel = one session, many views** (multi-subscriber fan-out; clarified FR-021) | A panel synced into a sub-workspace shares its `panelId` (clone-by-id), so it maps to one registry session; the streaming design already carries a `subscribers` set. | **Disallow syncing terminals** — rejected (user chose mirroring). **Independent session per view** — rejected: two sessions under one key is architecturally inconsistent. |

> **Closed deferrals (recorded for the constitution's Incremental Delivery ledger):** (1) Principle III/IV
> terminal layer — **delivered here**. (2) The persistent daemon push transport the 004 plan deferred —
> **delivered here**. **Still deferred (unchanged):** terminal **presets** (Principle III presets), and the
> editor/Markdown-preview that consumes the file-explorer open-intent (004 deferral) — both out of scope.

---

## Batch 2 — Post-Phase-C Refinements (2026-07-01)

Phases A/B/C above are implemented. This batch adds four independently-verified phases (**D–G**) for the
refinements captured in the **2026-07-01 clarifications** and **FR-023…FR-027 / US5…US9**. It is
**re-evaluated against constitution v3.6.0** (Principle XI: Sidebar = Projects + Sub-workspaces only,
Sub-workspaces pinned to bottom; Principle III: **terminal elevation follows the application**). Same
constitutional boundaries as A/B/C: pure logic in `@throng/core`, OS work behind seams, renderer
sandboxed behind the preload bridge, one composition root per process, **E2E for every UI change**, RGR.

### Phase D — Sidebar cleanup + drag-panel-to-new-tab (FR-023, FR-027)

UI/core only — **no daemon, no new deps**.

- **FR-023 (sidebar):** remove the `terminals` entry from the sidebar `panels` array (`ui/app.tsx`
  ~327–350) and reorder so **`subworkspaces` is last** (the `VerticalPanelStack.fit()` logic already pins
  trailing panels to the bottom). Delete `ui/renderer/sidebar/terminals-panel.tsx`. Constitution XI + the
  003/005 spec text are already amended.
- **FR-027 (drag → new tab):** new **pure core op** `addTabFromPanel(layout, sourcePanelId, { tab })` in
  `core/workspace/operations.ts` — removes the panel from its current tab (collapsing emptied split slots /
  pruning an emptied source tab via the existing `removeFromNode`) and creates a **new tab whose root is
  exactly that panel**, made active. Renderer: make the New-Tab **`+`** button a `useDroppable`
  (`newtab|+`) in `workspace/tab-group.tsx`; in `onDragEnd`, when a `panel|…` drag ends over `newtab|+`,
  call `ws.addTabFromPanel(panelSrc)` (a new store action wrapping the op). Add an `--over` style for the
  `+` drop affordance.
- **Tests:** core unit for `addTabFromPanel` (single-panel tab, deep-split source, last-panel guard);
  **E2E** `sidebar.e2e.ts` (Projects + Sub-workspaces only, Sub-workspaces at bottom) and
  `drag-to-new-tab.e2e.ts` (drag a panel onto `+` → new active tab with just that panel; source slot
  collapses).

### Phase E — Robust shell detection (FR-024)

Core (pure resolution) + `platform-windows` (real probes) — **no daemon, no new deps**.

- Extract the per-shell resolution into a **pure ordered resolver** in `core/terminal/` :
  `resolveShellFile(candidates, probes)` where `probes = { exists(path), onPath(exe), fromRegistry(key) }`
  tries **well-known paths → PATH → registry**, first hit wins. Keeps ordering logic pure and unit-testable
  with fake probes.
- `WindowsShellDetection` supplies real probes: `exists` (fs), `onPath` (resolve against `%PATH%`), and a
  new **registry probe** reading Git-for-Windows `InstallPath` from `HKLM\SOFTWARE\GitForWindows`,
  `HKCU\…`, and the `WOW6432Node` variant (via `reg query` / a small registry read helper in
  `platform-windows`). Git Bash now resolves by default path **or** `bash.exe` on PATH **or** the registry
  install path; the same resolver backs the other built-ins.
- **Tests:** extend the reusable **`IShellDetection` contract suite** to assert resolution order and **no
  false positives** (a shell resolvable by none of the probes is absent); core unit for `resolveShellFile`
  ordering with fake probes; `platform-windows` contract test exercises the real probes. E2E is covered by
  the existing B-phase `terminal-flavours.e2e.ts` (extended with a PATH/registry-only case where feasible).

### Phase F — Destroy-panel-everywhere cascade (FR-026, FR-026a, FR-026b)

Renderer + daemon persistence + dialog — **no new deps**. **P1 data-integrity fix.**

- **Ownership model:** a panel belongs to its originating project; the cascade is **one-directional**
  (clarified 2026-07-01). Destroying it **in the project** removes it from the project **and every
  sub-workspace** containing it (same `panelId`, FR-021), terminating the one terminal session **once**.
  Destroying it **inside a sub-workspace** is **local** — only that sub-workspace loses it; the project keeps
  its panel.
- **Open windows (live):** new cross-window broadcast `panel.notifyDestroyed(panelId)` + listener
  `renderer/workspace/panel-destroy-sync.tsx` (mirrors `panel-rename-sync.tsx`), mounted in every window's
  `WorkspaceProvider`; on receipt each window applies `ws.removePanel(panelId)` (no-op if absent). The
  destroying window kills the terminal (existing `terminal.kill`) exactly once, then broadcasts.
- **Closed/lazy sub-workspaces (persisted):** new daemon workspace-service method
  `workspace.purgePanelEverywhere(panelId)` (+ preload bridge) that loads all persisted sub-workspaces,
  strips the panel via the existing pure removal helper, prunes emptied tabs, and **deletes any
  sub-workspace left empty** (FR-026b), then persists the set. A pure core helper
  `stripPanelFromSubWorkspaces(list, panelId) → { list, deletedIds }` holds the logic.
- **Warning (FR-026a):** extend `ConfirmOptions`/`confirm-dialog.tsx` with an optional **`warningMessage`**
  rendered as a highlighted callout (`.modal__warning`, danger-tinted). In `panel-placeholder.tsx`, before
  confirming, compute where else the panel lives — a query `workspace.findPanelLocations(panelId)`
  (daemon, over persisted sub-workspaces) + the current window — and, when it exists elsewhere, pass a
  warning naming those locations ("also in sub-workspace *X* and *Y* — it will be removed from all").
- **Guards:** the main project always retains ≥1 tab/panel (existing `totalPanels<=1` guard); destroying a
  project's sole panel stays disallowed so the cascade can't invalidate the project. A cascade that empties
  a *sub-workspace* deletes it (FR-026b).
- **Tests:** core unit (`stripPanelFromSubWorkspaces`: strips, prunes, reports emptied→deleted;
  `findPanelLocations`); daemon **integration** (`purgePanelEverywhere` across several persisted
  sub-workspaces incl. one emptied→deleted); **E2E** `destroy-cascade.e2e.ts` (sync a panel into a
  sub-workspace; destroy in sub-ws → gone from parent; destroy in parent → gone from sub-ws; multi-location
  warning shown; emptied sub-ws deleted).

### Phase G — Run a terminal as administrator (FR-025, FR-025a–d)

Largest slice: new OS seam + Windows token work + daemon + UI capability. **No new npm deps** (uses
Windows APIs already reachable from the daemon's native layer / `child_process`).

- **Generic flag (FR-025):** add `runAsAdmin?: boolean` to `TerminalPanelConfig` (core), the form values,
  `AttachRequest` (ui main), `TerminalAttachParams` (ipc-contract), and `PtyStartOptions` (core
  `IPtyHost`). One boolean, **not** per flavour.
- **Elevation capability (FR-025a):** new core seam **`IElevationState`**
  (`abstractions/elevation.ts`: `isElevated(): boolean`), Windows impl in `platform-windows`
  (`WindowsElevation`, checks the process token elevation). The **daemon** owns the relevant elevation
  (it spawns PTYs), so the daemon exposes it via RPC (`terminal.capabilities → { elevated }`); UI main
  forwards it through a preload bridge query (`terminal.capabilities()`). The form's **"run as admin"**
  checkbox in `terminal-inputs.tsx` is **enabled only when `elevated`**; otherwise `disabled` with a
  `title` hint ("Launch throng as administrator to run terminals as admin"). Pure gating helper
  `canRunAsAdmin(elevated)` in core.
- **Elevated-daemon handshake (FR-025b):** extend `ui/main/daemon-lifecycle.ts` — on connect, read the
  app's own elevation (`IElevationState` in UI main) and the daemon's (`terminal.capabilities`); if the app
  is elevated but the daemon is not, **retire the daemon and re-spawn it elevated** (reuses the existing
  build-id/instance retirement path; an elevated app spawns an elevated child normally).
- **Mixed mode (FR-025c):** in `NodePtyHost.start`, when the daemon is elevated:
  `runAsAdmin === true` → spawn normally (inherits the elevated token); `runAsAdmin === false` → **spawn
  de-elevated** at normal integrity using a **filtered/shell token** (obtain the shell's medium-integrity
  token, e.g. via the explorer/`CreateProcessWithTokenW`/filtered-token technique) behind a new
  `IElevation.spawnDeElevated`-style capability on the Windows seam. When the daemon is **not** elevated,
  `runAsAdmin` can only be false (checkbox was disabled) → spawn normally.
- **ADMIN pill (FR-025d):** in `panel-placeholder.tsx` header (~line 242, beside type + flavour) render a
  **red-outlined `ADMIN` pill** (`.panel-box__admin`) when the terminal is actually running elevated.
- **Tests:** core unit (`canRunAsAdmin` gating; `runAsAdmin` plumbing through launch-spec/attach); new
  **`IElevationState` contract suite**; `platform-windows` contract test asserting a de-elevated spawn runs
  at **medium** integrity and an elevated spawn at **high** (run in an elevated context); **E2E**
  `terminal-admin.e2e.ts` — the **always-runnable** case (not elevated → checkbox disabled + hover text)
  plus, in an elevated run, checked→pill+elevated and unchecked→no-pill+normal integrity (the elevated E2E
  is gated on an elevated runner and documented as such; the disabled-state E2E runs unconditionally, so no
  UI change ships without an observed E2E per Principle V).

### Constitution Check — Batch 2 (re-evaluated vs v3.6.0)

**Gate result: PASS.** Deltas from the A/B/C check:

- **II (Platform-Abstracted Core):** two new seams — **`IElevationState`** (detect/de-elevate) and the
  registry/PATH probes behind `IShellDetection` — both contract-tested; core stays OS/DOM-free (the
  ordered shell resolver and elevation gating are pure).
- **III (Detached/Persistent Terminals):** honours the new **elevation-follows-the-app** clause — no
  broker; elevation gated on the daemon's integrity; unchecked terminals de-elevated.
- **V (Test-First):** each of D/E/F/G lands green with unit/contract/integration + **E2E for every UI
  change** before the next begins (the admin disabled-state E2E is always-runnable so Principle V holds
  even where true-elevation E2E needs an elevated runner).
- **XI (Dockable Workspace):** Sidebar now = Projects + Sub-workspaces (Sub-workspaces bottom-pinned,
  FR-023); the **destroy cascade** enforces "a Panel belongs to its project" and "a sub-workspace cannot be
  empty" (FR-026/026b); drag-to-new-tab is a new layout gesture within the model (FR-027).
- **X (Externalised Config):** no new hardcoded values; the elevation hint text and pill are UI copy.

### Batch-2 Complexity Tracking

| Decision | Why needed | Alternative rejected because |
|----------|------------|------------------------------|
| **De-elevate unchecked terminals from an elevated daemon** (filtered/shell token in `NodePtyHost`) | User chose true **mixed mode** (FR-025c): admin + non-admin terminals coexisting when the app is elevated. | **All-terminals-elevated in admin mode** — rejected by the user; would make the checkbox and pill meaningless in an elevated session. |
| **Elevated-daemon retirement + respawn** (app-elevated but daemon-not → replace) | An elevated app that reconnects to a pre-existing **non-elevated** daemon could never launch admin terminals (FR-025b). | **Attach to whatever daemon exists** — rejected: silently disables the feature; **broker process** — rejected by the user (chose launch-app-elevated instead). |
| **New `IElevationState` seam + daemon `terminal.capabilities`** | The renderer is sandboxed and must not probe the OS; the *daemon's* integrity is what governs elevation, so it must report it (FR-025a). | **Renderer/UI-main-only elevation check** — rejected: the daemon spawns the PTYs, so its integrity — not the renderer's — is authoritative. |
| **Ordered shell resolver (well-known → PATH → registry)** behind `IShellDetection` | Fixes the reported Git-Bash-missing defect and machine-to-machine flakiness (FR-024) without a hardcoded path. | **Add more hardcoded paths** — rejected: still brittle; **shell out to `where` only** — rejected: misses registry-only/portable installs. |
| **Cross-window `panel.notifyDestroyed` broadcast + daemon `purgePanelEverywhere` on persisted sub-workspaces** | Destroying a panel must remove it from open **and** closed/lazy sub-workspaces to kill ghost panels (FR-026); the rename broadcast already proves the pattern. | **Broadcast-only** — rejected: misses closed/lazy sub-workspaces (the reported bug); **persist-strip-only** — rejected: open windows wouldn't update live. |

> **Constitution ledger update:** Principle XI Terminals-Panel-in-sidebar sub-requirement **removed**
> (v3.6.0); Principle III **elevation-follows-the-app** clause **added** (v3.6.0). No new deferrals.

## Batch 3 — Sub-workspace terminals & lifecycle (2026-07-01) — FR-028/029/030

Three sub-workspace refinements delivered test-first (each with E2E), building on the batch-1/2 layers:

- **FR-028 — sub-workspace-owned terminals.** A Panel created inside a sub-workspace has no owning project.
  Approach: a `rootless` flag on the pure `PanelTypeContext` lets Terminal `validate` accept a null root;
  UI-main resolves cwd = `os.homedir()` when the attach is rootless; the daemon **skips the project-root
  lock** for rootless sessions (locking home would be wrong). `PanelBody` detects an owned Panel (no matching
  project) and never falls back to an unrelated active project's root. Pure logic stays in `@throng/core`.
- **FR-029 — close-last closes the sub-workspace.** `removePanel`/`closeTab` keep a workspace non-empty
  (correct for the main window), so in a sub-workspace window the last close is intercepted in the renderer:
  a shared `destroySubWorkspace` helper deletes the record (`subworkspace.delete`), broadcasts `changed` (so
  the main sidebar refreshes) and closes the window — after a highlighted warning confirm. One-directional:
  a cloned project Panel closed this way leaves the project's Panel intact.
- **FR-030 — owned Panels can't leave.** Cross-window drag from a sub-workspace was already a no-op (no
  `detach` there); the added value is a **red invalid-drop warning** on the drag ghost, via a new
  `dragGhost.hint(text, warn)` arg + a `.hint.warn` style, shown while an owned Panel is dragged beyond its
  window.

### Constitution Check — Release convergence (re-evaluated vs v3.7.0 → v3.10.1)

**Gate result: PASS.** The A/B/C gate was assessed at v3.4.0 and batch 2 at v3.6.0 (above). The
constitution advanced through v3.7.0–v3.10.1 during the convergence phases; the deltas and how the
delivered work satisfies them:

- **v3.7.0 — `@admin` elevation-gating (Principle V).** Elevation-dependent E2E can't run on a
  non-elevated CI host, so the true-elevation assertions are tagged `@admin` and skipped unless the runner
  is elevated, while an always-runnable arm (disabled checkbox / no-pill) keeps every UI change covered.
  Satisfied by the `terminal-admin-integrity` @admin suite + the always-run `terminal-admin.e2e.ts`
  (T110/T125).
- **v3.8.0 — no orphaned OS processes (Principle III resource hygiene).** Every terminal releases its
  Windows `conhost.exe` by **any** end path (panel-destroy, project-delete, app-close "Terminate all",
  natural `exit`, daemon shutdown); the de-elevated PTY agent reaps its ConPTYs on disconnect + a
  daemon-liveness heartbeat. Satisfied by `NodePtyHost` per-session conhost tracking + `TerminalService.shutdown()`
  and verified by `terminal-no-orphans.e2e.ts` (T134).
- **v3.9.x / v3.10.x — no orphaned windows / test-artifact cleanup (Principle III/V).** E2E close their
  windows and clean their temp roots; the `@admin` suite documents its elevation requirement each run.
  Satisfied across the terminal E2E (temp-cleanup automated in the finalisation pass).
- **v3.10.0 — Documentation-currency rule (NON-NEGOTIABLE merge gate).** README / ROADMAP / CONTRIBUTING
  are brought current **in the same change**: the branch's public-docs commit gives ROADMAP a delivered
  **Terminals** section and README the terminal/daemon/run-as-admin capability text. Reconciled and
  verified at pre-merge (tasks T139). *(The rule was retrofitted after the task list was written, so no
  per-phase task tracked it; the outcome the gate requires — docs current at merge — is met.)*
- **v3.10.1 — editorial/clarity bump.** No behavioural obligation; no action.

No new violations and no new deferrals beyond those already recorded (FR-016 cwd-confinement WON'T FIX;
T132 output-coalescing deferred).

**Constitution check (v3.6.0):** unchanged — pure logic in core (no OS/DOM), OS access behind existing
seams (`IPtyHost`/`IDirectoryLock`), renderer sandboxed (all cross-window/ OS access via the preload bridge),
every UI change ships passing E2E. No new deferrals beyond the Phase-G native de-elevation already tracked.
