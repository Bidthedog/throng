# Phase 1 Data Model: Typed Panels — Terminal Panel Type

Entities, types, config additions, and the in-memory session model. **No SQL / no migration** (see
research D2/D3): persisted state rides existing structures; live state is in-memory.

---

## 1. Panel typing (core domain — Phase A)

Extends `packages/core/src/workspace/model.ts` (`Panel`, currently untyped):

```ts
interface Panel {
  type: 'panel';            // existing discriminator (layout node)
  id: string;
  originProjectId: string;
  title: string;
  kind?: PanelKind;         // NEW — undefined = untyped placeholder (back-compat)
  config?: PanelConfig;     // NEW — type-specific captured config (set at Confirm)
}

type PanelKind = 'terminal'; // open union; future: 'editor' | 'agent' | …
type PanelConfig = TerminalPanelConfig | Record<string, never>;
```

- **Validation / state**: `kind` is assignable **only from the untyped state** (not write-once). Two ops in
  `panel-type/assignment.ts` (via `operations.ts`): `setPanelType(layout, panelId, kind, config)` assigns
  when the panel is **untyped** (initial creation, or after a revert); `clearPanelType(layout, panelId)`
  clears `kind`+`config` back to untyped. While a panel hosts live content its `kind` is **fixed** (the type
  control is not offered, FR-006); when a Terminal Panel's process ends the renderer calls `clearPanelType`
  so the form returns and the user may re-type (FR-020). A panel is never half-typed.
- **Persistence**: serialised inside `workspace_layout.layout_json` (no schema change). Old layouts
  deserialise with `kind`/`config` `undefined` → valid untyped panels.

### PanelTypeDescriptor (registry — `core/panel-type/`)

```ts
interface PanelTypeDescriptor<V = unknown> {
  id: PanelKind;                          // 'terminal'
  label: string;                          // 'Terminal'
  inputs: PanelTypeInputSpec[];           // declarative form inputs (dropdown/text/…)
  defaults(ctx: PanelTypeContext): V;     // initial input values (e.g. first flavour + its params)
  validate(values: V, ctx): ValidationResult; // gates Confirm (FR-005)
  buildConfig(values: V, ctx): PanelConfig;    // values → persisted config (Confirm)
}

interface PanelTypeInputSpec {
  key: string;
  label: string;                          // 'Flavour' | 'Startup Params'
  control: 'dropdown' | 'text';
  required?: boolean;
  options?: (ctx) => Array<{ value: string; label: string }>; // dropdown source (flavours)
}
interface PanelTypeContext { projectRoot: string | null; flavours: TerminalFlavour[]; }
```

- The **registry** (`register`/`list`/`get`) is the single extension seam; the renderer form is generic
  over `inputs` (SC-006).

---

## 2. Terminal flavour & launch (core `terminal/` — Phases B/C)

```ts
// Detected on the machine (B) — from IShellDetection
interface DetectedShell { id: string; label: string; file: string; defaultArgs: string[]; }

// User-defined (B) — from settings.terminals.flavours
interface TerminalFlavourConfig { id: string; label: string; file: string; args?: string[]; defaultParams?: string; }

// Merged catalogue entry the dropdown shows (B)
interface TerminalFlavour {
  id: string;            // unique; user entry wins on collision
  label: string;
  file: string;          // executable
  source: 'builtin' | 'user';
  defaultParams: string; // resolved default Startup Params (D6)
}

// Captured on Confirm (B values → C launch). Persisted in Panel.config.
interface TerminalPanelConfig {
  flavourId: string;
  params: string;        // user-edited Startup Params at confirm time
  // launch spec is re-resolved from flavour+params+projectRoot at (re)start (C)
}

// Resolved at (re)start (C) — never persisted (cwd derives from the live project root)
interface LaunchSpec { file: string; args: string[]; cwd: string; } // cwd = project root
```

- **Merge rule** (`flavour.ts`): `availableFlavours = dedupeById([ ...userFlavours,
  ...builtinsInstalled.filter(b => !disabledBuiltins.has(b.id)) ])` — user entries take precedence.
- **Default params** (`defaults.ts` + settings override, D6): `resolveDefaultParams(flavour, settings)`.
- **Launch spec** (`launch-spec.ts`, D2): `resolve(flavour, params, projectRoot) → { file, args:
  splitArgs(flavour.args, params), cwd: projectRoot }`. **Refuses** if `projectRoot` is null (edge case:
  no active project).
- **Confinement** (`confine.ts`, D12/US4): **WON'T FIX (2026-07-02)** — cwd-confinement of a live
  interactive shell is infeasible without a fake shell, so `confine.ts` ships as an **intentional no-op
  stub**. The terminal only **starts** at the root (launch-spec cwd above); the achievable guard-rail is
  the project-root **lock** while a terminal is open (FR-022, `directory-lock`). See FR-016.

---

## 3. Terminal session (daemon, in-memory — Phase C)

Not persisted (research D3). Held by `TerminalService` in a registry keyed by `panelId`.

```ts
interface TerminalSession {
  tag: TerminalTag;          // durable identity
  handle: PtyHandle;         // IPtyHost handle
  scrollback: RingBuffer;    // bounded (~64 KB) for reattach replay
  status: 'running' | 'exited';
  exit?: { code: number | null; signal?: string };
  subscribers: Set<SocketRef>; // ALL UI events sockets attached to this panelId (FR-021 mirror): output
                               // fans out to every subscriber; input from any view writes the one PTY
}

interface TerminalTag {        // the "tag" Principle III requires
  projectId: string;
  panelId: string;             // registry key; matches Panel back on reattach
  flavourId: string;
  cwd: string;                 // project root
  params: string;
}
```

- **Lifecycle** (D11/D12): `attach(panelId)` → live session (replay scrollback + stream) or cold start
  from `config`. `idle/busy` classification (`lifecycle.ts`) decides close-on-project/app-close vs
  keep-running. Unexpected `onExit` with non-user kill → `status='exited'` + surface `exit` to the Panel
  (FR-017).

---

## 4. Config & theme additions (Phase B/C)

`settings.json` → `AppSettings.terminals` (new section; tolerant validator like 004 `explorer`):

```ts
interface TerminalSettings {
  flavours: TerminalFlavourConfig[];          // user-defined (default [])
  disabledBuiltins: string[];                 // built-in ids to hide (default [])
  defaultParams: Record<string, string>;      // per-flavour-id param overrides (default {})
}
// DEFAULT_APP_SETTINGS.terminals = { flavours: [], disabledBuiltins: [], defaultParams: {} }
```

Theme (`core/config/theme.ts`, Phase C) — new tokens with defaults + CSS vars:
`colours.terminalBg`, `terminalFg`, `terminalCursor`, `terminalSelection`, `terminalAnsi*` (optional set);
`icons.terminal`. Resolved via the existing `resolveColour`/`resolveIcon` fallbacks → `--throng-colour-*`.

---

## 5. State transitions (terminal panel)

```
[untyped Panel] --select type+Confirm(valid)--> [typed: terminal, config set]   (A)  (kind fixed while live)
[typed terminal] --mount/attach--> running (cold start | reattach+scrollback)    (C)
running --user types (any mirrored view)--> running (stream I/O to one PTY)       (C, FR-021)
running --process exits unexpectedly--> exited (surface code+output)             (C, FR-017)
exited / user-closed shell --> clearPanelType --> [untyped Panel] (form returns)  (C, FR-020)  ← re-typeable
running --project/app close & BUSY--> running (kept in daemon)                   (C, III)
running --project/app close & IDLE--> closed --reopen--> running (cold respawn)  (C, III)
typed terminal --destroy Panel (confirm if running)--> Panel removed + PTY killed (C, FR-018)
```

## 5b. Project root lock (daemon, in-memory — FR-022)

Not persisted. A daemon **lock manager** ref-counts an `IDirectoryLock` handle **per project**.

```ts
interface IDirectoryLock { acquire(absPath: string): LockHandle; release(h: LockHandle): void; }
// daemon lock manager: Map<projectId, { handle: LockHandle; openTerminals: number }>
```

- **Acquire** the root lock when a project's **first** terminal starts; **release** when its **last**
  terminal closes (ref-count → 0). While held, the OS refuses to delete/move the root folder (Windows: a
  directory handle opened without delete/rename share access).
- The **project-edit path** (daemon project service + edit UI) MUST **refuse to change a project's root
  path** while `openTerminals > 0` for that project.

---

## 6. What is NOT modeled (out of scope)

- No `terminals` SQLite table / migration (research D3).
- No terminal **presets** (saved shell+cwd+command sets) — deferred.
- No editor/preview consuming any open intent — separate feature (004 deferral).

---

## 7. Batch 2 additions (2026-07-01 — Phases D–G)

### 7.1 Terminal config gains `runAsAdmin` (Phase G, FR-025)

```ts
interface TerminalPanelConfig {
  flavourId: string;
  params: string;
  flavourLabel?: string;
  runAsAdmin?: boolean;   // NEW — generic OS-level elevation flag (default false / undefined)
}
```

Plumbed unchanged through `AttachRequest` (ui main) → `TerminalAttachParams` (ipc-contract) →
`PtyStartOptions.runAsAdmin` (core `IPtyHost`). One boolean per Panel, **not** per flavour.

### 7.2 Elevation capability + de-elevation seam (Phase G, FR-025a/c)

```ts
// core/abstractions/elevation.ts (NEW seam, contract-tested)
interface IElevationState {
  isElevated(): boolean;                 // is THIS process running elevated (high integrity)?
}
// Windows impl (platform-windows) also provides the de-elevated spawn used by NodePtyHost:
//   spawn a child at medium integrity from an elevated parent (filtered/shell token).

// pure gating helper (core/terminal)
function canRunAsAdmin(daemonElevated: boolean): boolean; // === daemonElevated
```

- Daemon reports its elevation via RPC `terminal.capabilities → { elevated: boolean }`; UI main forwards it
  through the preload bridge (`terminal.capabilities()`). The renderer NEVER probes the OS directly.
- Spawn rules in `NodePtyHost.start` (daemon-owned): daemon **not** elevated → always normal spawn
  (`runAsAdmin` can only be false, checkbox disabled). Daemon **elevated** → `runAsAdmin===true` normal
  (inherit elevated token); `runAsAdmin===false` **de-elevated** (medium-integrity filtered token).

### 7.3 New pure workspace ops (Phases D & F)

```ts
// core/workspace/operations.ts
function addTabFromPanel(layout, sourcePanelId, ids: { tab: string }): WorkspaceLayout; // FR-027 — move panel into a new solo tab
// core/workspace/sub-workspace.ts (or a new sub-workspace-ops module)
function stripPanelFromSubWorkspaces(
  list: SubWorkspace[], panelId: string,
): { list: SubWorkspace[]; deletedIds: string[] };  // FR-026/026b — strip panel, prune empty tabs, drop emptied sub-workspaces
function findPanelLocations(list: SubWorkspace[], panelId: string): string[]; // FR-026a — which sub-workspaces contain the panel (for the warning)
```

- `addTabFromPanel` reuses `removeFromNode` (collapses emptied split slots / prunes an emptied source tab);
  the new tab's `root` is the moved panel; it becomes `activeTabId`. Subject to the existing
  `totalPanels <= 1` guard (a project's sole panel can't be moved out into nothing).
- `stripPanelFromSubWorkspaces` returns `deletedIds` so the daemon deletes emptied sub-workspaces (FR-026b).

### 7.4 Cross-window "panel destroyed" signal (Phase F, FR-026)

```ts
// preload bridge (global.d.ts) — mirrors the existing panel.notifyRenamed/onRenamed
panel.notifyDestroyed(panelId: string): void;
panel.onDestroyed(cb: (panelId: string) => void): () => void;
// daemon workspace-service (persisted sub-workspaces)
'workspace.purgePanelEverywhere'(panelId): { deletedSubWorkspaceIds: string[] };
'workspace.findPanelLocations'(panelId): { subWorkspaceIds: string[] };
```

### 7.5 Shell-detection resolver (Phase E, FR-024)

```ts
// core/terminal — pure, unit-testable with fake probes
interface ShellProbes { exists(path: string): boolean; onPath(exe: string): string | null; fromRegistry(key: string): string | null; }
function resolveShellFile(candidates: { path?: string; onPath?: string; registry?: string }[], probes: ShellProbes): string | null;
// order per candidate: well-known path → PATH → registry; first existing wins; null ⇒ shell absent (no false positive)
```
