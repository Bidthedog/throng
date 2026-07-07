# Implementation Plan: Typed Panels — Editor Panel Type

**Branch**: `006-editor-panel-type` | **Date**: 2026-07-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-editor-panel-type/spec.md`

## Summary

Ship the **second concrete Panel type — Editor** — on the extensible typed-panel system delivered by 005.
An Editor Panel hosts a **well-known embeddable code-editor component** (see the headline decision below)
for viewing and editing a project's text files inline, configured for **plain-text only** this pass
(encoding, line endings, save, save-all, panel movement, sub-workspace sync, crash recovery — the
cross-platform fundamentals — before any syntax highlighting). It plugs into the same panel-type registry,
`PanelBody` dispatcher, and type-selection form that Terminal uses (`core/src/panel-type/`,
`renderer/workspace/panel-body.tsx`, `renderer/panel-type/panel-type-form.tsx`) with **no change to the
shared selection/confirm/clear flow** (SC-016).

**Headline decision — the editor is UI-main + renderer, NOT daemon-backed.** Unlike a terminal (a live OS
process that must outlive the UI, so the daemon owns it), an editor is a text buffer plus file I/O whose
only cross-restart survival is the **recovery temp file** (FR-041/042). Basic editing, saving, encoding/
line-ending handling, the app-wide **open-document registry** (FR-011a), the **dirty-file OS lock**
(FR-028), **recovery temp files**, and **cross-window editor sync** therefore all live in **UI main**
(reusing the existing `IFileSystem`/`files-service.ts` FS ownership from 004) and the **sandboxed
renderer** (reached only through a new `editor.*` preload bridge, mirroring `files.*`). **The daemon is
untouched** — no `ipc-contract` changes, no daemon service, no SQLite migration. This is the same
UI-main-owns-the-OS-seam pattern 004 used for the file explorer and 005 used for shell detection, and it
keeps the whole feature off the daemon's critical path.

**Editor component (research D1, decided here):** **CodeMirror 6** (`@codemirror/*` +
`@codemirror/state`/`view`). It satisfies every spec criterion — well-known, cross-platform, capable
programmatic API (UI + keyboard), extensible syntax highlighting via language packages (kept **off** this
pass), many concurrent lightweight instances, performant and **light on resources** — and bundles cleanly
under Vite into the **sandboxed, offline** renderer with **no web workers or CDN** (unlike Monaco). The
component stays capable of the deferred "Rich code editors" ROADMAP increment. *(No editor library is
currently a dependency; the early-002/003 Monaco placeholder was removed when panels became typed in 005.)*

Delivery is **strictly phased, each phase independently visible and E2E-verified before the next**
(Incremental Delivery rule; Principle V "every user-facing UI change ships passing E2E"):

- **Phase A — Editor type + inline plain-text editor + save/save-all + encoding/endings + settings**
  (US1, US3, US4, US5, US8-pills). The MVP: register `editorPanelType`; `PanelBody`/form `'editor'` branches; a CodeMirror
  plain-text view; a **new empty in-memory document** on Confirm; a UI-main **`editor-service`** that reads/
  saves via `IFileSystem` with **encoding + line-ending detection/preservation** (pure helpers in core);
  **Ctrl+S** (active editor) and **Ctrl+Shift+S** (scoped Save-All) with **project-tree confinement**; the
  **active-pane focus model** that gates panel shortcuts; the **dirty-file OS lock** (new `IFileLock` seam);
  the new **`editor` settings category** (`openOnClick`, `autoSave`, `autoSaveDebounceMs`, `saveAllScope`, `defaultLineEnding`, `maxOpenFileBytes`)
  and **editor theme tokens**; the **type pill + `filename (relative folder)` pill**.
- **Phase B — Open files from the tree + app-wide one-buffer registry + unsaved-open prompt + rename fix**
  (US2, US9, US12). Wire the explorer's `throng:open-file` intent into the **last active editor**;
  `editor.openOnClick` (single/double/none) + **Enter-to-open** (removing Enter→rename); the **app-wide
  open-document registry** (FR-011a — focus-existing, disable Open-In-when-open); the four-choice
  **unsaved-on-open** prompt (US9); the **rename-no-op** bug fix (US12).
- **Phase C — Unsaved indicators + auto-save** (US7, US8). The shared **themeable red dot** on Panel/Tab/
  project (**replacing** the project "loaded" dot); debounced **auto-save**; pure dirty-aggregation.
- **Phase D — Open In / Send to Tab / unified Sync menus + destroy-prompt** (US6, FR-006a). The **Open In**
  submenu (OS-Explorer moved under it, Editor Here, Other Tab); **Send to Tab → New Tab** on **every**
  panel type; a **shared Sync-to-Sub-workspace cascade** reused by Editor and Terminal (DRY); the
  save/discard/cancel prompt on destroying a **dirty** editor Panel or Tab (FR-006a). *(FR-006a's
  project/sub-workspace-deletion arm lands in Phase E — T074 — with the delete guards.)*
- **Phase E — Sub-workspace ownership + project-panel sync mirror + crash recovery** (US10, US11). Editor
  **sync into a sub-workspace** mirrors **one document** across views (cross-window content sync, like a
  synced terminal); **sub-workspace-owned** editors (save **outside all loaded projects**); the
  **project-creation-overlap** block (FR-038); and **recovery temp files** under `%APPDATA%\throng`
  (continuous write, restore-on-launch, cleanup on full save).

**Technical approach — preserve the 001–005 constitutional boundaries:**

- **Pure decisions live in `@throng/core`** (new `editor/` + `panel-type/editor`): the **`editorPanelType`
  descriptor** (registered in `core/src/panel-type/default-registry.ts` — the single new-type seam), the
  **encoding + line-ending model** (detect from bytes, preserve on save, new-doc defaults — pure given the
  raw bytes), **path-confinement predicates** (`isWithinTree`, `isOutsideAllProjects`), **Save-All scope
  resolution**, the **open-document registry logic** (app-wide uniqueness), and **unsaved-indicator
  aggregation**. Zero OS/DOM imports (guarded by `core/tests/unit/no-os-imports.test.ts`).
- **File I/O + OS locking are UI-main-owned OS seams.** Reuse the existing **`IFileSystem`** (read/write
  bytes, exists) behind `files-service.ts`; add a new OS seam **`IFileLock`** (`acquire(file)`/`release`)
  with a Windows impl **`WindowsFileLock`** (open a file handle **without** share-write/delete, the
  file-granularity analogue of 005's `WindowsDirectoryLock`), instantiated in **UI main** and **contract-
  tested** (`core/testing/file-lock-contract.ts`). Held while a document is **dirty + pathed** (FR-028).
- **UI main owns the app-wide editor coordinator** — an **open-document registry** (path → owning
  `panelId`/window, for FR-011a), **recovery temp management** (`%APPDATA%\throng\recovery\<panelId>`),
  **confinement enforcement** at save time, and the **cross-window editor sync relay** (edits/dirty-state
  of a mirrored panel fan out to other windows via `webContents.send`, exactly like the existing
  `panel-rename-sync`/`panel-destroy-sync`/`panel-state-sync` broadcasts). Renderer reaches all of this
  only through the new **`editor.*` preload bridge** (`load`, `save`, `saveAll`, `openInto`, `notifyDirty`,
  `list`, `recover`, …) — **no daemon RPC, no `ipc-contract` module** (mirrors `files.*`).
- **The editor and its Panel are inseparable** (FR-006, clarified): the `editorPanelType` never reverts to
  the form and has **no independent close-document** step; an editor is removed only by
  closing/destroying its Panel, gated by the dirty-editor **save/discard/cancel** prompt (FR-006a, Phase D)
  extended to Tab and project/sub-workspace deletion.
- **App-wide one buffer per file** (FR-011a, clarified): the UI-main open-document registry rejects a
  second open of a path already open **anywhere**, focusing (and raising) the existing editor instead;
  Open-In targets for an open file are disabled. This is the only scope coherent with the machine-wide
  dirty-file lock.
- **Sub-workspace sync = one document, many views** (FR-034, mirrors 005's terminal FR-021): a project
  editor synced into a sub-workspace shares its `panelId`; UI main relays content + dirty state across the
  views so both edit **one** buffer (never a second). **Ownership** (project vs sub-workspace) reuses the
  existing `ownedBySub` detection (`panel-body.tsx`/`panel-placeholder.tsx`) and the one-directional
  destroy cascade (005 FR-026).
- **The context menus are unified** (DRY, Principle VIII): extract the terminal "Sync to Sub-workspace"
  cascade (`panel-placeholder.tsx` + `detach-context.tsx`) into a **shared builder** used by both panel
  types; add **Send to Tab → New Tab** (reusing `addTabFromPanel`, 005 FR-027) to every panel menu; add the
  **Open In** submenu to the file context menu (`explorer/context-menu-items.ts`), moving the existing
  reveal item under it.
- **New `editor` settings section + editor theme tokens** extend the config schema
  (`core/src/config/app-settings.ts`, `theme.ts`) with the same tolerant-parse + hot-reload pattern as
  `settings.terminals`. Persisted editor state (the real target path + encoding/ending) rides the existing
  `Panel.config` in the layout blob — **no SQLite migration** (`user_version` stays at 6).

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS (ESM); React 18 (renderer).

**Primary Dependencies**: Electron (UI shell; UI-main owns FS + editor coordinator + `IFileLock`); React 18
+ Vite; **CodeMirror 6** (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`,
`@codemirror/language` — **new**, renderer-only, plain-text config this pass; pure JS, no native build, no
workers); InversifyJS + reflect-metadata (DI); `react-arborist` (file tree, extended for open-intent);
better-sqlite3 (daemon store, **unchanged**); Vitest (unit/contract/integration); Playwright-Electron
(E2E). **node-pty/xterm.js and the daemon are untouched** by this feature.

**Storage**:
- **No schema change; SQLite stays at `user_version 6`.** An Editor Panel persists `kind='editor'` +
  `config: EditorPanelConfig` (`{ filePath?: string; encoding?: EncodingId; hasBom?: boolean;
  lineEnding?: LineEndingId }`) inside the existing `workspace_layout.layout_json` blob — restored verbatim
  on reopen. A brand-new
  unpathed document has no `filePath`; its in-progress content is restored from the recovery temp file.
- **Recovery temp files** live on disk under `%APPDATA%\throng\recovery\<panelId>` (the existing app-data
  root, distinct from the `%USERPROFILE%\.throng` JSON config root), written continuously while a document
  is open in an editor and removed on full save / editor close-without-unsaved-content (FR-041/043).
- **The UI-main editor coordinator state is in-memory** (open-document registry: `path → { panelId,
  windowId }`; per-document dirty flag + file lock handle + recovery temp handle). Lost only on app close
  (when editors close and recovery temp files hold the last content).
- User config (`%USERPROFILE%\.throng\settings.json`) gains an **`editor`** section
  (`openOnClick`/`autoSave`/`autoSaveDebounceMs`/`saveAllScope`/`defaultLineEnding`/`maxOpenFileBytes`) and
  **editor theme tokens** (`colours.editorBg/editorFg/editorSelection/…`, `colours.unsavedDot`,
  `colours.activePaneHighlight`), hot-reloaded like the rest.

**Testing**: Vitest unit (core: `editorPanelType` descriptor register/validate/buildConfig; encoding
detect/encode + line-ending detect/preserve/new-doc-default; `isWithinTree`/`isOutsideAllProjects`
confinement; Save-All scope resolution; open-document-registry uniqueness/focus; unsaved-indicator
aggregation; project-overlap detection for FR-038); Vitest contract (**`IFileLock`** contract suite vs
`WindowsFileLock` — acquire blocks an external write/delete, release restores it) + the existing
`IFileSystem` contract; Vitest integration (UI-main `editor-service`: save round-trips encoding/endings on
a real temp file; recovery write/restore/cleanup; one-buffer registry across two windows); Playwright-
Electron **E2E per phase** (A: create editor, type, save within tree, out-of-tree refused, Ctrl+Shift+S
scope, encoding/endings preserved, active-pane gates Ctrl+S; B: click/Enter open per setting, already-open
focuses one editor, unsaved-open four-choice, unchanged-rename no-op; C: red dot on panel/tab/project +
clears, auto-save writes debounced; D: Open In / Send to Tab / shared Sync menus, destroy-dirty prompt; E:
sub-workspace mirror one document, sub-workspace-owned save-outside-projects, project-overlap block,
close→reopen restores unsaved content). **Every user-facing UI change ships passing E2E**; each phase lands
green before the next. RGR mandatory.

**Target Platform**: Windows 11 desktop (first supported); the OS seams (`IFileSystem`, new `IFileLock`)
keep macOS/Linux open.

**Project Type**: Desktop application (Electron UI client + headless plain-Node daemon), npm-workspaces
monorepo (extends 001–005). **This feature touches the UI + core only; the daemon is not modified.**

**Performance Goals**: Creating an editor and typing is instant (SC-001, <10 s including selecting the
type). CodeMirror handles large text efficiently; opening a large file either opens responsively or clearly
indicates it is too large without hanging the UI (edge case). Auto-save debounce is an injected
tunable (documented default **500 ms** after typing stops, Principle X). The recovery temp write is debounced and asynchronous so it never blocks
typing. The dirty-file lock is acquired/released within the save/dirty transition without perceptible
latency.

**Constraints**: No Docker; npm scripts only. `@throng/core` keeps **zero OS/DOM imports** (guarded) — all
file I/O and OS locking are behind `IFileSystem`/`IFileLock`; encoding/line-ending logic is pure over
bytes/strings. Renderer is **sandboxed** (no `fs`/sockets); it reaches files and editor coordination only
through the preload `editor.*`/`files.*` bridges → UI main. **One IoC composition root per process**
(daemon, UI main, UI renderer = 3, unchanged in count) — `IFileLock` + the editor coordinator bound in the
**UI main** root; the renderer stays sandboxed. Editors save **only** within their owning project's tree
(or, for sub-workspace-owned editors, **outside every loaded project**). Configuration injected via typed
settings (Principle X).

**Scale/Scope**: Single user, single machine, local-only. A handful to dozens of concurrent editors across
tabs/projects/sub-workspaces, each a lightweight CodeMirror instance with its own document and (while
dirty) a file lock + recovery temp. Packages touched: `core` (new `editor/` domain + `panel-type/editor`
descriptor + `IFileLock` abstraction + contract suite + `editor` settings/theme), `platform-windows` (new
`WindowsFileLock`), `ui` (main: `editor-service`, open-document registry, recovery, `IFileLock` wiring,
`editor.*` ipc, cross-window editor sync, project-overlap guard, confinement; renderer: editor view, panel-
body/form branches, open-from-tree wiring, active-pane focus, indicators/pills, menus, prompts, settings/
theme), and `persistence` (**read-only** — a test asserting `user_version` stays at 6). **No** daemon
change, **no** `ipc-contract` change, **no** persistence migration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against all eleven principles of constitution **v3.10.1** (note Principle V: **every user-facing
UI change MUST ship passing E2E coverage** — honoured per phase below; and the v3.10.0 **Documentation-
currency** merge gate — README/ROADMAP/CONTRIBUTING reconciled at close, the ROADMAP "Rich code editors"
item advanced to "editor panels (plain text)" delivered + rich editing still planned).

| # | Principle | Verdict | How this plan satisfies it |
|---|-----------|---------|----------------------------|
| I | Project-First Context Isolation | ✅ PASS | An editor **belongs to its originating project** and can **never** load/save another project's file (FR-035/FR-036); saves are **confined to the owning project tree** (or outside all projects for sub-workspace-owned editors) — enforced in UI main against the known project roots. A project's file reaches a sub-workspace only via the sync menu (FR-034). Creating a project that would swallow a sub-workspace-owned editor's file is **blocked** with a save-and-close instruction (FR-038). Strengthens isolation. |
| II | Platform-Abstracted Core | ✅ PASS | File I/O stays behind the existing **`IFileSystem`**; the new **`IFileLock`** seam (`acquire`/`release`) has a **contract suite** and a Windows impl (`WindowsFileLock`); encoding/line-ending logic and all path/confinement rules are **pure** in core. Core stays OS/DOM-free (guard test). |
| III | Detached/Persistent Terminals | ✅ PASS (N/A) | The editor does **not** touch the terminal/daemon layer. It deliberately does **not** use the daemon (an editor is not a live OS process to keep alive); durability across restarts is the **recovery temp file**, not a daemon session. Terminals and their guarantees are unchanged. |
| IV | Native Terminal Support & Auto-Detection | ✅ PASS (N/A) | Not a terminal feature; no shells involved. |
| V | Test-First Quality Discipline | ✅ PASS | Unit + contract (`IFileLock`) + integration (`editor-service`, recovery, one-buffer) + **E2E for every UI change, delivered and observed green per phase** (A–E). RGR per task; encoding/ending fidelity, confinement, one-buffer, recovery all covered. Generated test temp files self-clean (v3.9.0 rule). |
| VI | Simple, Modern, Discoverable UX | ✅ PASS | A familiar code editor inline; discoverable open-from-tree (configurable), Open In / Send to Tab / Sync menus, clear unsaved indicators + file pills, standard Ctrl+S / Ctrl+Shift+S; themed via tokens; respects the dominant project colour. |
| VII | Change Review & Approval | ✅ PASS (N/A) | The combined edit list is out of scope; the editor does not mutate the review flow. (Editor writes will become a future change *source* the edit-list feature consumes.) |
| VIII | SOLID/DRY/YAGNI | ✅ PASS | **Reuse** CodeMirror (not a forked IDE), the existing FS seam/`files-service`, the proven cross-window broadcast pattern, `addTabFromPanel`, and the panel-type registry (open/closed — a new descriptor, no shared-flow edits, SC-016). **Unify** the Sync cascade across panel types (removes duplication). **YAGNI**: no daemon/`ipc-contract`/SQLite surface for a feature that needs none; syntax highlighting deferred. Pure logic (encoding, confinement, registry) segregated in core (SRP). |
| IX | DI & Composition Root | ✅ PASS | Still three roots. `IFileLock` + the **editor coordinator/`editor-service`** are **constructor-injected** in the **UI main** root (inline like 004's FS seams); the renderer gets data only via the preload bridge. No new process, no shared container. |
| X | Externalised Configuration | ✅ PASS | The new **`editor`** settings section (open-on-click, auto-save, save-all scope, default line ending), editor **theme tokens**, the recovery directory, and the auto-save debounce are **injected typed settings** — nothing hardcoded in logic. |
| XI | Dockable Workspace: Panes, Tabs & Panels | ✅ PASS | **Advances** Principle XI: a Panel becomes an **editor** while staying a draggable/splittable/detachable Panel; the editor↔Panel binding, one-editor-per-tab default, the destroy prompts, and the sub-workspace mirror all respect the docking model and one-directional project→sub-workspace cascade. Adds the **active-pane** concept (Files & Folders vs a workspace Panel) that gates panel shortcuts. |

**Architecture constraints**: daemon single SQLite writer **unchanged** ✅ (no migration, no daemon code);
per-user local storage ✅ (recovery under `%APPDATA%\throng`, config under `%USERPROFILE%\.throng`);
renderer sandbox preserved (editor via `editor.*` bridge → UI main; no `fs` in renderer) ✅; single
instance unaffected ✅; lazy loading preserved (editors restore on demand when a project/panel opens) ✅;
Electron+TS baseline, **reuse-not-fork** (CodeMirror component, not a forked IDE editor) ✅; agents remain
a future layer ✅.

**Gate result: PASS — no violations.** Deliberate, compliant decisions recorded under
[Complexity Tracking](#complexity-tracking): the CodeMirror renderer dependency, the new UI-main `IFileLock`
seam + editor coordinator, the app-wide one-buffer registry, and no daemon/`ipc-contract`/SQLite surface.

## Phased Delivery

Each phase is an independently shippable, **independently E2E-verified** increment (Incremental Delivery
rule). The user reviews the running result of each phase before the next starts.

| Phase | Delivers (verify point) | Touches | New deps | E2E gate |
|------|--------------------------|---------|----------|----------|
| **A — Editor type + editing + save** | `editorPanelType` (registry); `PanelBody`/form `'editor'` branches; **CodeMirror** plain-text view; new in-memory doc; UI-main **`editor-service`** (read/save via `IFileSystem`); pure **encoding + line-ending** model; **Ctrl+S** (active editor) + **Ctrl+Shift+S** (scope) with **project-tree confinement**; **active-pane** focus model; **`IFileLock`** dirty-file lock; **`editor` settings** + **theme tokens**; **type + file pills**. | `core/panel-type/editor`, `core/editor`, `core/abstractions/file-lock`, `core/config`, `core/testing`, `platform-windows`, `ui` main (`editor-service`, coordinator, `editor.*` ipc, lock) + renderer (editor view, form/body branch, active pane, keybindings, pills, settings/theme) | `@codemirror/*` | Create editor → type; multiple editors independent; Ctrl+S writes in-tree, out-of-tree refused; Ctrl+Shift+S saves the scoped set; CRLF/BOM/LF preserved on untouched lines; new doc uses `defaultLineEnding`; Files-pane active → Ctrl+S no-ops; external write blocked while dirty. |
| **B — Open from tree + one-buffer + prompt + rename fix** | explorer `throng:open-file` → last active editor; `editor.openOnClick` (single/double/none); **Enter-to-open** (Enter no longer renames); **app-wide open-document registry** (FR-011a: focus-existing, disable Open-In); **unsaved-on-open** four-choice prompt (US9); **rename-no-op** fix (US12). | `core/editor` (registry logic), `ui` main (registry, `editor.openInto`), renderer (tree wiring, prompt, active-pane integration), `explorer/use-explorer-data.ts` + `files-service.ts` (rename fix) | — | Click/Enter opens per setting; Enter never renames; folder never opens; already-open focuses the one editor; Open-In disabled for an open file; unsaved-open prompt (4 choices) each behave; unchanged rename shows no error/does nothing. |
| **C — Unsaved indicators + auto-save** | shared **themeable red dot** on Panel (right of name, before pills), Tab (between name & count), project (**replacing** the loaded dot; unloaded keep greyed italics); pure dirty-aggregation; debounced **auto-save** setting. | `core/editor` (aggregation), `core/config/theme.ts` (`unsavedDot` token), renderer (panel/tab/project dot, `projects-panel.tsx` loaded-dot removal, auto-save hook) | — | Edit → red dot on panel/tab/project; save/discard → clears; loaded dot gone; all dots one style; auto-save off (default) keeps pending; on → writes within debounce, respecting confinement. |
| **D — Menus + destroy prompt** | **Open In** submenu (OS-Explorer moved under it; Editor Here New/existing; Other Tab → New/existing); **Send to Tab → New Tab** on **all** panels; **shared Sync-to-Sub-workspace** cascade (Editor + Terminal, one builder); dirty-editor/Tab/project **destroy prompt** (save/discard/cancel, FR-006a). | renderer (`explorer/context-menu-items.ts`, `workspace/panel-placeholder.tsx`, `workspace/detach-context.tsx` → shared builder, `confirm-dialog.tsx`), `ui` main (project/sub-ws delete guard) | — | Open In shows the three groups + only current-project targets; Send to Tab → New Tab == drag onto `+`; Editor & Terminal Sync menus share shape; destroying a dirty editor/tab/project prompts save/discard/cancel; cancel is a no-op. |
| **E — Sub-workspace sync + ownership + recovery** | project editor **synced** into a sub-workspace mirrors **one document** across views (cross-window content + dirty sync); **sub-workspace-owned** editors save **outside all projects**; **project-overlap** creation block (FR-038); **recovery temp files** (`%APPDATA%\throng`, continuous write, restore-on-launch, cleanup on save). | `core/editor` (ownership save-rule, overlap detection, recovery model), `ui` main (recovery service, cross-window editor sync relay, overlap guard in project-create), renderer (`editor-sync` listener, sub-ws-owned save flow) | — | Synced editor edits one buffer across two windows; sub-ws-owned editor saves outside projects & refuses project trees; creating a project over a sub-ws editor's file is blocked with save-and-close; close app with unsaved editors → reopen restores content; temp removed on full save; temp never marks unsaved. |

## Project Structure

### Documentation (this feature)

```text
specs/006-editor-panel-type/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 — decisions D1–D14 (component, UI-main ownership, seams, one-buffer, recovery, lock)
├── data-model.md        # Phase 1 — Panel.kind='editor'+config, EditorDocument, encoding/ending, settings/theme, open-doc registry, recovery (no SQL)
├── quickstart.md        # Phase 1 — phased validation/run guide (A → E)
├── contracts/           # Phase 1
│   ├── editor-panel-type.md      # core editorPanelType descriptor (registry entry; minimal inputs; buildConfig)
│   ├── file-lock.md              # IFileLock seam contract (lock a dirty file vs external write/delete, FR-028)
│   ├── editor-bridge.md          # preload editor.* API (load/save/saveAll/openInto/notifyDirty/list/recover + onSync push) — NO daemon RPC
│   ├── editor-service.md         # UI-main editor-service + open-document registry + confinement + recovery behaviour
│   ├── text-fidelity.md          # encoding + line-ending detection/preservation + new-doc defaults (pure core)
│   └── config-additions.md       # settings.editor + editor theme tokens (incl. unsavedDot)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Extends the existing monorepo. **New** files marked `(new)`; **extended** marked `(ext)`. Phase tags
`[A]…[E]` show when each lands.

```text
packages/
├── core/
│   ├── src/
│   │   ├── abstractions/
│   │   │   └── file-lock.ts               # (new)[A] IFileLock — acquire(file)/release (dirty-file lock, FR-028)
│   │   ├── panel-type/
│   │   │   └── default-registry.ts        # (ext)[A] register editorPanelType alongside terminalPanelType
│   │   ├── editor/                         # (new) pure editor domain
│   │   │   ├── panel-type.ts              #   editorPanelType descriptor (kind 'editor'; new-doc, no launch inputs) [A]
│   │   │   ├── document.ts               #   EditorDocument model + EditorPanelConfig (filePath?/encoding?/lineEnding?) [A]
│   │   │   ├── text-fidelity.ts          #   detectEncoding/encode + detectLineEnding/apply + new-doc defaults (pure over bytes) [A]
│   │   │   ├── confinement.ts            #   isWithinTree / isOutsideAllProjects / resolveSaveConfinement (ownership) [A/E]
│   │   │   ├── save-scope.ts             #   Save-All scope resolution (tab/project/all) → editor ids [A]
│   │   │   ├── open-registry.ts          #   app-wide one-buffer registry logic (path→panelId; focus-vs-open) [B]
│   │   │   ├── indicators.ts             #   unsaved aggregation for panel/tab/project [C]
│   │   │   └── overlap.ts                #   project-root-would-contain-open-editor detection (FR-038) [E]
│   │   ├── workspace/
│   │   │   └── model.ts                  # (ext)[A] PanelKind already `'terminal' | (string & {})` — document 'editor'; EditorPanelConfig type
│   │   ├── config/
│   │   │   ├── app-settings.ts           # (ext)[A] add `editor` { openOnClick, autoSave, autoSaveDebounceMs, saveAllScope, defaultLineEnding, maxOpenFileBytes } + parser + defaults
│   │   │   └── theme.ts                  # (ext)[A/C] editor colour tokens + `unsavedDot` token + defaults
│   │   └── testing/
│   │       └── file-lock-contract.ts     # (new)[A] reusable IFileLock contract suite
│   └── tests/unit/                        # (ext) editorPanelType, text-fidelity, confinement, save-scope, open-registry, indicators, overlap
│
├── platform-windows/
│   ├── src/
│   │   ├── windows-file-lock.ts          # (new)[A] IFileLock: hold a file handle w/o share-write/delete (analogue of WindowsDirectoryLock)
│   │   └── index.ts                      # (ext) export WindowsFileLock
│   └── tests/contract/                    # (ext)[A] run file-lock contract suite vs WindowsFileLock (external write/delete blocked while held)
│
└── ui/
    ├── src/
    │   ├── main/
    │   │   ├── editor-service.ts         # (new)[A] read/save via IFileSystem; encoding/ending; confinement enforce; save-all
    │   │   ├── editor-coordinator.ts     # (new)[B/E] app-wide open-document registry; cross-window sync relay; recovery orchestration
    │   │   ├── editor-recovery.ts        # (new)[E] recovery temp files under %APPDATA%\throng\recovery\<panelId>; write/restore/cleanup
    │   │   ├── editor-ipc.ts             # (new)[A] ipcMain: editor.load/save/saveAll/openInto/notifyDirty/list/recover → service/coordinator
    │   │   ├── files-service.ts          # (ext)[B] rename(): no-op when new name === old (bug fix, FR-070) — plus reveal stays (moves under Open In in renderer)
    │   │   ├── project-service.ts (or create path) # (ext)[E] block creating a project whose root would contain an open sub-ws-owned editor (FR-038)
    │   │   ├── composition-root.ts       # (ext)[A] bind IFileLock (WindowsFileLock) + EditorService + EditorCoordinator
    │   │   ├── tokens.ts                  # (ext)[A] FileLock, EditorService, EditorCoordinator tokens
    │   │   └── main.ts                    # (ext)[A] register editor.* ipc; (E) wire recovery restore on launch + editor sync broadcast
    │   ├── preload/preload.cts           # (ext)[A] editor.{load,save,saveAll,openInto,notifyDirty,list,recover}; (E) editor.onSync/notifySync
    │   └── renderer/
    │       ├── editor/                     # (new) the inline editor view
    │       │   ├── editor-panel.tsx       #   mount CodeMirror (plain text); load/save via editor.* bridge; dirty tracking; pills [A]
    │       │   ├── use-editor.ts          #   document lifecycle: load, dirty, save (Ctrl+S), auto-save debounce, recovery write, sync mirror [A/C/E]
    │       │   ├── editor-open.ts         #   open-file-into-last-active-editor flow + unsaved-open prompt orchestration [B]
    │       │   └── editor.css             #   CodeMirror container theming via var(--throng-*) [A]
    │       ├── panel-type/
    │       │   ├── panel-type-form.tsx    # (ext)[A] add `'editor'` inputs branch (Editor has no config inputs → confirm creates a new doc)
    │       │   └── editor-inputs.tsx      # (new)[A] Editor type inputs (minimal/none; explanatory copy)
    │       ├── workspace/
    │       │   ├── panel-body.tsx         # (ext)[A] add `kind==='editor'` → <EditorPanel/>
    │       │   ├── panel-placeholder.tsx  # (ext)[A/C/D] editor pills (type + filename(relFolder)); unsaved dot; destroy-dirty prompt; Send to Tab; shared Sync
    │       │   ├── panel-context-menu.ts  # (new)[D] shared panel menu builder (Sync cascade + Send to Tab) reused by editor & terminal
    │       │   ├── editor-sync.tsx        # (new)[E] cross-window mirror listener (content + dirty) — sibling of panel-rename-sync/panel-state-sync
    │       │   ├── tab-group.tsx          # (ext)[C] tab unsaved dot between name and panel count
    │       │   └── active-pane.tsx        # (new)[A] active-pane context: Files&Folders vs workspace Panel; gates panel shortcuts
    │       ├── explorer/
    │       │   ├── file-tree.tsx          # (ext)[B] open-intent already emits throng:open-file; honour openOnClick single/double/none
    │       │   ├── tree-node.tsx          # (ext)[B] click/Enter open per setting; Enter never renames; folders no Open
    │       │   ├── use-explorer-data.ts   # (ext)[B] onRename no-op when name unchanged (FR-070); Enter no longer triggers edit()
    │       │   └── context-menu-items.ts  # (ext)[B/D] Open In submenu (OS Explorer moved under it; Editor Here; Other Tab)
    │       ├── sidebar/
    │       │   └── projects-panel.tsx     # (ext)[C] remove the loaded-dot; show unsaved dot in its place; keep greyed italics for unloaded
    │       ├── app.tsx                     # (ext)[A] register editor.save/saveAll ActionIds + handlers; active-pane provider
    │       └── config/config-store.tsx    # (ext)[A] expose settings.editor + editor theme tokens
    ├── tests/unit/                         # (ext) use-editor reducer, editor-open flow, active-pane, indicators
    ├── tests/integration/                  # (ext)[A/E] editor-service save round-trip; recovery write/restore/cleanup; one-buffer across windows
    └── tests/e2e/                          # (ext) editor-basics.e2e.ts [A], editor-open.e2e.ts [B], editor-indicators.e2e.ts [C],
                                            #       editor-menus.e2e.ts [D], editor-subworkspace.e2e.ts + editor-recovery.e2e.ts [E], rename-noop.e2e.ts [B]
```

**Structure Decision**: Extend the 001–005 monorepo. **All decision logic is pure in `@throng/core`**
(`editor/` domain + `panel-type/editor` descriptor + the `IFileLock` abstraction). **File I/O and the
dirty-file lock are UI-main-owned OS seams** (`IFileSystem` reused; `IFileLock`/`WindowsFileLock` new),
matching 004's UI-main FS ownership — so **the whole feature is daemon-free**: no daemon service, no
`ipc-contract` module, no SQLite migration. The **renderer is sandboxed** behind a new `editor.*` preload
bridge (a peer of `files.*`) and hosts a **CodeMirror** view. UI main owns the **app-wide open-document
registry** (one buffer per file, FR-011a), **recovery temp files**, **confinement enforcement**, and the
**cross-window editor sync relay** (reusing the proven broadcast pattern). A Panel's `kind='editor'` +
`config` ride the existing layout JSON blob; unsaved content survives restarts via recovery temp files.

## Complexity Tracking

> No Constitution Check violations. Rows below are deliberate, compliant decisions recorded for reviewer
> scrutiny (Dev Workflow gate). This feature **advances** the ROADMAP "Rich code editors" item (plain-text
> editor panels delivered; syntax highlighting / language features remain a tracked future increment).

| Decision | Why needed | Alternative rejected because |
|----------|------------|------------------------------|
| **Editor is UI-main + renderer, NOT daemon-backed** (file I/O via `IFileSystem`, coordinator + lock + recovery in UI main) | An editor is a text buffer + file I/O, not a live OS process that must outlive the UI; its only cross-restart survival is the recovery temp file. Keeping it in UI main mirrors 004's file explorer, avoids daemon/`ipc-contract` coupling, and keeps it off the daemon's critical path (YAGNI, Principle VIII/III-N/A). | **Daemon-owned editor service** — rejected: adds a daemon RPC surface + lifecycle coupling for zero benefit (nothing to keep alive after UI close; content lives in the recovery temp file, not a daemon session). |
| **New renderer dep CodeMirror 6** (`@codemirror/*`) | The spec requires a well-known, cross-platform, capable, extensible, **light-on-resources, multi-instance** editor; CM6 fits and bundles cleanly under Vite into the **sandboxed offline** renderer with no workers/CDN. | **Monaco** — rejected for this pass: heavier per-instance memory, web-worker/CDN assumptions awkward in a sandboxed offline renderer, and many concurrent panel instances is exactly CM6's strength. **Hand-rolled editor** — rejected (reinvents editing/undo/selection; violates reuse/YAGNI). Monaco stays a viable future swap if rich IDE parity is wanted. |
| **New UI-main OS seam `IFileLock` + `WindowsFileLock`** (hold a file handle w/o share-write/delete while dirty) | FR-028 requires preventing external modification of a dirty file (the clarified alternative to detect-and-warn); a held file handle without write/delete sharing is the standard Windows mechanism — the file-granularity analogue of 005's `WindowsDirectoryLock`. | **Detect-and-warn on external change** — superseded by the user's prevention choice. **A filesystem watcher** — rejected (racy; reacts, can't prevent). Behind the OS abstraction (II) so other OSes use their own advisory lock. |
| **App-wide open-document registry in UI main** (one buffer per file everywhere) | FR-011a (clarified app-wide) is the only scope coherent with the machine-wide file lock; UI main is the single process that sees all windows, so it is the natural owner of path→panelId uniqueness and focus-existing. | **Per-tab/per-project uniqueness** — rejected by clarification (would collide on the machine-wide lock and allow divergent buffers). **Renderer-local tracking** — rejected: cannot see other windows/sub-workspaces. |
| **Unify the Sync-to-Sub-workspace cascade across panel types** (shared builder) | The user asked to make the terminal Sync menu consistent with the editor's; DRY (Principle VIII) — one builder, both panel types. | **Duplicate the cascade per type** — rejected (divergence risk; the user explicitly asked to share the code). |
| **No SQLite migration; `Panel.config` holds the editor's path/encoding/ending; unsaved content in recovery temp files** | The layout blob already round-trips arbitrary Panel config (DRY); unsaved content is inherently transient and is handled by recovery temp files, not a durable table. | **An `editors` table (migration v7)** — rejected (YAGNI): duplicates config, and unsaved content belongs in the recovery temp, not the project DB. |

> **ROADMAP ledger:** "Rich code editors" advances — **plain-text editor panels delivered here**; syntax
> highlighting, language features, and Markdown preview remain planned future increments (the CodeMirror
> component is chosen to keep them open). No new deferrals introduced.
```
