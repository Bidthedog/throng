# Phase 0 Research: Typed Panels — Terminal Panel Type

Decisions resolving the Technical Context. Each: **Decision / Rationale / Alternatives**. Grounded in the
existing codebase (file paths cited) and the spec's confirmed answers.

---

## D1 — Where the panel-type "system" lives (extensibility)

**Decision**: A **pure registry** in `@throng/core/panel-type/`. A `PanelTypeDescriptor` declares
`{ id, label, inputSchema, validate(values), defaults(ctx) }`. The registry exposes `register()` /
`list()` / `get(id)`. The renderer form reads `list()` for the Panel-Type dropdown and renders the
selected descriptor's inputs generically; adding a future type = registering one descriptor + one inputs
component, **no change to the shared form/confirm/clear/lock flow** (SC-006).

**Rationale**: Open/closed (Principle VIII); the user explicitly asked for an easy-to-expand design;
keeps all per-type knowledge declarative and unit-testable in core (no DOM).

**Alternatives**: A `switch (kind)` in the form — rejected (every new type edits shared code; violates
open/closed). A plugin/file-discovery system — rejected (YAGNI for a fixed in-repo set).

---

## D2 — Panel typing in the domain model + persistence

**Decision**: Extend the core `Panel` (`packages/core/src/workspace/model.ts:20`) with **optional**
`kind?: string` and `config?: unknown` (typed per descriptor). Two pure ops in `operations.ts`:
`setPanelType(layout, panelId, kind, config)` assigns **only from the untyped state** (refused while typed,
FR-006) and `clearPanelType(layout, panelId)` reverts to untyped on terminal end (FR-020, see D15) — the
type is fixed *while content is live*, not permanently. These fields **auto-persist**: the whole
`WorkspaceLayout` is already stored as a JSON blob in `workspace_layout.layout_json`
(`packages/persistence/src/workspace-repository.ts:69`) and round-tripped via `JSON.stringify`/`parse`.

**Rationale**: One source of truth (DRY); no migration; back-compatible (optional fields; old layouts
have untyped panels). Mirrors 004's "no persistence for live/derivable data."

**Alternatives**: A normalized `panel_types` table / migration v7 — rejected (YAGNI; the blob already
carries it). A required `kind` field — rejected (breaks existing v2 layouts; untyped placeholder must
remain valid).

---

## D3 — No SQLite migration (stay at user_version 6)

**Decision**: **No migration.** Panel `kind`+`config` ride the layout blob (D2); the daemon's terminal
**session registry is in-memory** (keyed by `panelId`: PTY handle, bounded scrollback ring, durable tag
`{projectId, panelId, flavourId, cwd, params}`).

**Rationale**: Reattach after a **UI** restart is an in-memory registry lookup (the daemon never died).
After **daemon** death the OS has already reaped the PTY child processes, so no live session is
restorable — only the `config`, which already persists in the layout blob and drives a **cold respawn**.
A terminals table would therefore restore nothing useful. Migration runner pattern (if ever needed) is
well-defined (`migration-runner.ts` MIGRATIONS array + `schema-guard.ts` ADDITIVE_COLUMNS).

**Alternatives**: `terminals` table (migration v7) — rejected (duplicates `config`; zero recoverable
benefit; adds schema surface).

---

## D4 — Flavour auto-detection seam & ownership

**Decision**: New OS seam **`IShellDetection`** (`core/abstractions/shell-detection.ts`):
`detectInstalledShells(): DetectedShell[]` where `DetectedShell = { id, label, file, defaultArgs }`.
Windows impl **`WindowsShellDetection`** (`platform-windows/`) probes `PATH` + known install dirs for the
built-in catalogue (Windows PowerShell 5.1 `System32\…\powershell.exe`, PowerShell 7 `pwsh.exe` /
`%ProgramFiles%\PowerShell\7`, CMD `%ComSpec%`, Git Bash `%ProgramFiles%\Git\bin\bash.exe`). It is
**instantiated in UI main** (Phase B), inline like 004's `NodeFileSystem`/`ElectronShellIntegration`
(`ui/src/main/main.ts:275`), and merged with `settings.terminals`.

**Rationale**: Honors the user's confirmed model — a **built-in catalogue grown over time** filtered to
installed, **plus** user-defined flavours. UI-main ownership keeps Phase B daemon-free; a contract suite
keeps the seam honest (Principle II/V). Detection is cached after first run (perf).

**Alternatives**: Registry/Windows-Terminal-fragment enumeration — rejected for v1 (couples to WT;
heavier); the path/dir probe is deterministic and dependency-free. Detection in the daemon — rejected for
Phase B (see D13). Spawning each shell `--version` at detection — avoided on the hot path (optional, lazy;
presence is enough to list a flavour).

---

## D5 — User-defined flavours in settings.json

**Decision**: `settings.terminals.flavours: TerminalFlavourConfig[]`, each `{ id, label, file, args?,
defaultParams? }`; plus `disabledBuiltins?: string[]` and `defaultParams?: Record<flavourId,string>`
overrides. The dropdown shows **`(built-ins ∩ installed, minus disabled) ∪ user-defined`**, de-duplicated
by `id` (user entry wins). Parsed by a tolerant validator added to `parseAppSettings`
(`core/config/app-settings.ts`, same pattern as the 004 `explorer` section).

**Rationale**: Externalised configuration (Principle X); the user explicitly asked for a configurable
array; tolerant parsing means a malformed entry falls back without breaking the app.

**Alternatives**: A separate `flavours.json` file — rejected (one user-config surface already exists;
settings.json + hot-reload is established).

---

## D6 — Default startup params per flavour

**Decision**: Built-in defaults in `core/terminal/defaults.ts` (e.g. PowerShell 5/7 `-NoLogo`, CMD `/K`,
Git Bash `-i -l`), overridable via `settings.terminals.defaultParams[flavourId]` and per user-defined
flavour `defaultParams`. Selecting/changing **Flavour** repopulates the **Startup Params** field with the
resolved default (confirmed overwrite behaviour, spec Assumptions).

**Rationale**: The user confirmed "built-in per-flavour defaults"; injected via settings so they're
overridable without code (Principle X).

**Alternatives**: Empty default / derive-from-WT-profile — rejected per the spec decision.

---

## D7 — PTY seam & engine (daemon-owned)

**Decision**: New OS seam **`IPtyHost`** (`core/abstractions/pty-host.ts`): `start({file,args,cwd,cols,
rows}) → handle`; `write(handle,data)`, `resize(handle,cols,rows)`, `kill(handle)`; events
`onData(handle,cb)`, `onExit(handle,cb)`. Impl **`NodePtyHost`** wraps **`node-pty`** (ConPTY) in
`@throng/platform-windows`, consumed by the **daemon**. Verified by an `IPtyHost` **contract suite**
(start a short-lived shell, echo a marker, observe data + exit code).

**Rationale**: Principle II/III/IV; node-pty is the standard ConPTY binding; the contract suite keeps the
boundary testable and macOS/Linux open.

**Alternatives**: `child_process.spawn` (no TTY) — rejected (no interactive/ANSI/resize). winpty —
rejected (legacy vs ConPTY).

---

## D8 — node-pty build model (no electron-rebuild)

**Decision**: Add `node-pty` to `@throng/platform-windows` (consumed by the **daemon**). Since the daemon
runs as **plain Node** (`node packages/daemon/dist/main.js`, root `package.json:18`), node-pty builds
against host **Node 20** at `npm install` via its prebuilt binaries — **no electron-rebuild**, exactly
like the existing `better-sqlite3` (`packages/persistence/package.json`).

**Rationale**: The terminal engine never loads in the Electron process; keeping it daemon-side sidesteps
Electron ABI rebuilds entirely. Confirmed by mapping: better-sqlite3 already relies on this property.

**Alternatives**: PTY in Electron main + `electron-rebuild` postinstall — rejected (adds a native-rebuild
build step and couples terminals to the UI process). If future packaging (electron-builder) is added, the
daemon remains plain Node, so this stays valid.

---

## D9 — Persistent, detached, single-instance daemon

**Decision**: Add `ui/src/main/daemon-lifecycle.ts`: on UI startup, **try to connect** to the pipe
(`\\.\pipe\throng.daemon`); if absent, **spawn the daemon detached** (`child_process.spawn(node,
[daemonMain], { detached:true, stdio:'ignore' }).unref()`) and **wait for readiness** (retry `health.ping`
with backoff). Two UIs racing to spawn → the loser's spawn hits the pipe-in-use / the loser simply
connects to the winner (the pipe **is** the single-instance lock; the daemon already releases it on
shutdown, `ipc-server.ts:54`). The daemon **keeps running after UI close** while sessions exist.

**Rationale**: Principle III (outlive the UI) + the architecture's single-instance constraint; reuses the
existing pipe and health.ping. The dev `concurrently` script already starts a daemon — in that case the
UI just connects (spawn skipped), so dev and packaged flows both work.

**Alternatives**: A lockfile/mutex for the daemon — rejected (the named pipe already serializes binding;
simpler). UI owns the daemon as a child that dies with it — rejected (violates III).

---

## D10 — Streaming transport (daemon → UI push)

**Decision**: Reuse the existing **newline-delimited JSON-RPC framing** and add **notifications** (JSON-RPC
messages with **no `id`**). UI main opens **one long-lived "events" socket** to the daemon and sends a
`terminal.subscribe`; the daemon pushes `terminal.output` / `terminal.exit` / `terminal.flavourMissing`
**notifications** tagged with `panelId`. UI main **forwards** them to renderers via
`webContents.send('throng:terminal:...')` — the **proven** 003/004 push pattern
(`main.ts` config/explorer/subworkspace broadcasts). Terminal **commands** (start/write/resize/kill/
attach/list) stay on the existing **per-call** request/response sockets.

**Rationale**: Minimal, DRY extension of the current protocol (JSON-RPC already defines notifications);
isolates the one new long-lived socket. *(This exploration proposed coalescing output ~16 ms to avoid IPC
flooding; that micro-optimisation was **not implemented** in delivery — see spec Release Status / T132 —
the bounded scrollback handles the memory concern.)* This is exactly the channel the 004 plan deferred
until terminals landed.

**Alternatives**: A second bespoke binary protocol — rejected (reinvents framing). Per-terminal sockets —
rejected (socket lifecycle sprawl). Polling — rejected (latency/cost).

---

## D11 — Reattach, scrollback, idle-close / cold-respawn

**Decision**: The daemon keeps a **bounded scrollback ring** (~64 KB) per session. Renderer terminal
panels call `terminal.attach(panelId)` on mount: if the registry has a live session → return buffered
scrollback + resume streaming (**reattach**); if not → start a new PTY from the persisted `config`
(**cold respawn** at project root). **On project/app close**: **busy** terminals (D12) keep running in
the daemon; **idle** terminals are closed (and cold-respawned on reopen). The same `config` drives both
cold respawn and the first launch.

**Rationale**: Implements Principle III's exact close/reopen rules with in-memory state only (D3).

**Alternatives**: Persisting scrollback to disk — rejected (bounded in-memory is enough; survives UI
restart, and daemon death loses the live process anyway).

---

## D12 — Idle vs busy classification

**Decision**: A terminal is **busy** if its shell process has a **live non-shell descendant** (a running
command), else **idle**. Implemented behind the OS seam (descendant-process enumeration by the shell PID
on Windows). If liveness can't be determined, **default to busy** (never silently kill a running process).
Pure decision (`core/terminal/lifecycle.ts`) takes the descendant info and returns idle/busy +
close/respawn/reattach action.

**Rationale**: Concrete, testable, matches Principle III intent; the safe default protects user work.

**Alternatives**: True foreground-job/console-attach detection — rejected (fragile on ConPTY,
over-engineered). Treat all as idle — rejected (would kill running watchers/servers — the exact failure
Principle III forbids).

---

## D13 — Phase boundaries (UI → settings → terminal)

**Decision**: **A** = panel-type form + dispatcher + persistence, Terminal inputs with a **stub** flavour
list, **no daemon/launch**. **B** = `settings.terminals` + catalogue + `IShellDetection` (UI-main) +
`terminal.listFlavours` bridge → real dropdown + default params, **still no launch**. **C** = persistent
daemon + streaming + `IPtyHost`/node-pty + xterm.js + reattach/idle/respawn + app-close prompt +
confinement. Each phase ships **passing E2E** before the next (Principle V; user's explicit request).

**Rationale**: Matches the user's three verify points; each phase is internally consistent and demoable;
daemon risk is isolated to C; B is daemon-free because detection is UI-main-owned (D4) and the daemon only
needs the resolved launch spec (D2/D11).

**Alternatives**: One big-bang feature — rejected (the user wants staged verification; harder to review).

---

## D14 — Renderer integration points & theming

**Decision**: A new **`PanelBody`** dispatcher rendered at the panel leaf in `split-tree.tsx:114`
(`isPanel(node)`): `kind==='terminal'` → `<TerminalPanel/>`; untyped → `<PanelTypeForm/>`; fallback →
existing placeholder. The form and xterm container are themed entirely via `var(--throng-*)` (new
terminal colour tokens + a `terminal` icon in `core/config/theme.ts`). The emulated
`panelHasRunningSubprocess` (`renderer/workspace/subprocess.ts`) becomes a **real** query of daemon
session state (Phase C), feeding the existing destroy-confirmation flow.

**Rationale**: Minimal, localized rendering seam (one dispatcher); reuses the established theming + the
panel-destroy confirmation machinery (DRY); xterm.js gets a full-bleed themed container.

**Alternatives**: Branching inside `PanelPlaceholder` — rejected (placeholder should stay the untyped
fallback; a dispatcher is cleaner and keeps each body component focused).

---

## D15 — Re-typeable panels & revert-to-form on terminal end (FR-006/FR-020, clarified)

**Decision**: A Panel's type is **fixed only while it hosts live content**, not permanently. When a Terminal
Panel's process **ends** (user closed it or it failed), the Panel **reverts to untyped** and shows the
type-selection form again, where the user may pick any type (relaunch Terminal or a different one). The
core gains a `clearPanelType(layout, panelId)` op (clears `kind`+`config`); `setPanelType` assigns when the
panel is **untyped** (initial creation **or** after a revert). The renderer drives the revert on a
`terminal.exit`, keeping the exit code/output visible as the form returns (FR-017).

**Rationale**: Matches the clarified user intent and the constitution's "panel remains, ready to host a new
terminal" (Principle III). Keeps the model simple — a Panel is either *untyped→form* or *typed→content*;
there is never a half-typed state.

**Alternatives**: Permanent immutability (original FR-006) — rejected per clarification. A dedicated
"restart" affordance without re-typing — rejected: the user explicitly wants to switch to **another** type,
which only the form provides.

**Impact**: `core/panel-type/assignment.ts` adds `clearPanelType`; `Panel.kind` is **not** write-once
(reassignable only from the untyped state); renderer `terminal-panel.tsx`/`use-terminal.ts` trigger the
revert on exit; the Panel persists as **untyped** once reverted (FR-007).

## D16 — Synced/mirrored Terminal Panel = one session, many views (FR-021, clarified)

**Decision**: A Terminal Panel synced into a sub-workspace shares its **panel id** (the existing clone-by-id
"Sync to" model), so it maps to **one** registry session. The daemon session already holds a
`subscribers: Set<SocketRef>`; output is broadcast to **all** subscribed views and input from **any** view
is written to the single PTY. No second PTY is created for a mirrored panel.

**Rationale**: This is the natural fallout of the registry being keyed by `panelId` (research D3) and the
multi-subscriber streaming design (D10); no special-casing needed — only an explicit test that two views of
one panel id mirror correctly.

**Alternatives**: Disallow syncing terminal panels — rejected (the user chose mirroring). Independent
session per view — rejected: architecturally awkward (two sessions, one key) and not what the user wants.

**Impact**: `terminal.attach` is idempotent per `panelId` and **adds** the caller's events socket as a
subscriber (rather than replacing); `terminal.output`/`terminal.exit` fan out to every subscriber; a new
E2E mirrors a panel across windows.

## D17 — Project-root lock while terminals are open (FR-022, clarified)

**Decision**: New OS seam **`IDirectoryLock`** (`acquire(path) → handle`, `release(handle)`) in
`@throng/core/abstractions`; Windows impl **`WindowsDirectoryLock`** opens a **directory handle without
delete/rename share access** (so the OS refuses deletion/move; an opportunistic-lock-style hold), in
`@throng/platform-windows`, consumed by the **daemon**. The daemon ref-counts locks **per project**:
acquire on the **first** terminal opened in a project, release when the **last** closes. Separately, the
**project-edit path refuses to change a project's root** while it has open terminals (a guard in the
project service / edit UI). If a root still becomes unavailable (removable/network media), launch/cold-
respawn surfaces an error (FR-019).

**Rationale**: Implements the clarified prevention-first requirement; strengthens Principle I (the root is
the terminal's binding context). A held directory handle is the standard Windows mechanism to block
deletion/rename. Behind the OS abstraction (Principle II) so macOS/Linux can use their own advisory lock.

**Alternatives**: After-the-fact error only (my original recommendation) — superseded by the user's
prevention choice. A filesystem watcher that reacts to deletion — rejected (racy; can't *prevent*).

**Impact**: new `core/abstractions/directory-lock.ts` + contract suite; `platform-windows/
windows-directory-lock.ts`; a daemon **lock manager** (ref-counted per project) wired into `TerminalService`
start/close; a **project-root-edit guard** (block root change while terminals open) in the daemon project
service + surfaced in the edit UI. In-memory only (no persistence).

### Dependency summary

| Dependency | Where | Phase | Build note |
|------------|-------|-------|-----------|
| `node-pty` | `@throng/platform-windows` → **daemon** (plain Node) | C | Prebuilt for Node 20; **no electron-rebuild** (better-sqlite3 model) |
| `@xterm/xterm`, `@xterm/addon-fit` | `@throng/ui` renderer | C | Pure JS; no native build |
| *(none)* | panel-type form, settings, detection | A, B | Reuses existing stack |
