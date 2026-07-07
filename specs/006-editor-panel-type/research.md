# Phase 0 Research: Typed Panels — Editor Panel Type

Decisions resolving the Technical Context. Each: **Decision / Rationale / Alternatives**. Grounded in the
existing codebase (file paths cited) and the spec's confirmed answers (three clarify sessions).

---

## D1 — The editor component (well-known, cross-platform, light, multi-instance)

**Decision**: **CodeMirror 6** (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`,
`@codemirror/language`), renderer-only, configured for **plain text** this pass (no language/highlighting
extensions loaded). Mounted in `renderer/editor/editor-panel.tsx`.

**Rationale**: Meets every spec criterion in FR-003 — well-known, cross-platform, a capable programmatic
API for both UI actions and keyboard shortcuts, syntax highlighting **extensible** via `@codemirror/language`
packages (kept off now, added per-language later for the ROADMAP "Rich code editors" item), **many
concurrent lightweight instances** (throng opens editors across tabs/projects/sub-workspaces), and
**performant + light on resources**. Critically it bundles cleanly under **Vite** into throng's
**sandboxed, offline** renderer with **no web workers and no CDN** — pure ESM JS, no native build. No editor
library is currently a dependency (the early 002/003 Monaco placeholder was removed when panels became typed
in 005), so this is a clean addition.

**Alternatives**: **Monaco** — rejected for this pass: heavier per-instance memory and a worker/CDN model
that is awkward in a sandboxed offline renderer, and throng's "many editor panels" usage is exactly where
CM6's lightweight instances win; Monaco remains a viable future swap if full VS-Code IDE parity is wanted.
**Ace** — rejected (older architecture, weaker modern API). **A hand-rolled editor** — rejected (reinvents
editing/undo/selection/perf; violates reuse + YAGNI, and the constitution's "reuse components, not the whole
IDE").

---

## D2 — Ownership: the editor is UI-main + renderer, NOT daemon-backed

**Decision**: The editor lives entirely in **UI main + the sandboxed renderer**. File read/save go through
the existing **`IFileSystem`** (UI-main `files-service.ts`); a new **UI-main editor coordinator**
(`editor-service.ts` + `editor-coordinator.ts`) owns the open-document registry, confinement enforcement,
recovery temp files, and cross-window sync. The renderer reaches it only through a new **`editor.*` preload
bridge** (a peer of `files.*`). **The daemon is not modified**: no daemon service, **no `ipc-contract`
module**, no SQLite migration.

**Rationale**: A terminal is a live OS process that must **outlive the UI**, so the daemon owns it
(Principle III). An editor is a **text buffer + file I/O**; its only cross-restart survival is the
**recovery temp file** (D9), which is plain disk I/O. There is nothing to keep alive after the UI closes.
Putting the editor in UI main mirrors 004's file-explorer FS ownership (`ui/src/main/files-service.ts`,
`main.ts:275` inline seam wiring), keeps the feature **off the daemon's critical path**, and avoids adding
an RPC/lifecycle surface for zero benefit (YAGNI, Principle VIII).

**Alternatives**: **Daemon-owned editor service** (symmetry with terminals) — rejected: couples editing to
daemon lifecycle and adds an `ipc-contract` surface for a feature that needs neither; the durability the
daemon would provide is already met by recovery temp files on disk.

---

## D3 — The Editor panel type registers like Terminal (open/closed)

**Decision**: Add a pure **`editorPanelType: PanelTypeDescriptor`** in `core/src/editor/panel-type.ts`
(kind `'editor'`), registered in `core/src/panel-type/default-registry.ts` next to `terminalPanelType`.
The Editor type has **no configuration inputs** (selecting it just creates a new empty document), so its
`inputs: []`, `validate` always ok (a project root or sub-workspace context is present), and `buildConfig`
returns an empty/initial `EditorPanelConfig`. Two renderer switch points gain an `'editor'` branch:
`panel-body.tsx` (L36 — render `<EditorPanel/>`) and `panel-type-form.tsx` (L103 — render `<EditorInputs/>`,
essentially explanatory copy).

**Rationale**: The registry is the single extension seam (005 SC-016 / research D1); adding a type is one
descriptor + one body branch + one inputs component, **no change to the shared select/confirm/clear flow**
(SC-016). Editor needs no launch inputs, so the form's per-type area is trivial.

**Alternatives**: A file-picker input on the form before confirm — rejected: the spec says confirming
creates a **new in-memory file**; files are opened afterward from the tree or Open In (US2/US6), not chosen
on the type form.

---

## D4 — Editor & Panel are inseparable; no revert-to-form (FR-006, clarified)

**Decision**: Unlike Terminal (which reverts to the type-selection form when its process ends, 005 FR-020),
`editorPanelType` **never reverts**. There is **no independent "close document"**; the document lives and
dies with the Panel. `clearPanelType` is **not** wired for editors. An editor is removed only by
closing/destroying its Panel, gated by the dirty-editor **save/discard/cancel** prompt (D11).

**Rationale**: The user clarified (2026-07-05) that "the editor and the document are inescapably linked."
Keeps the model simple — an editor Panel is always an editor until destroyed — and avoids a half-typed/empty
state the terminal model needs but the editor does not.

**Alternatives**: Reset-to-empty-doc on close, or full revert-to-form — both rejected by the clarification.

---

## D5 — Text fidelity: encoding + line endings (pure core over bytes)

**Decision**: Pure helpers in `core/src/editor/text-fidelity.ts`: `detectEncoding(bytes) → { encoding,
hasBom }` and `decode`, `encode(text, { encoding, hasBom })`; `detectLineEnding(text) → 'lf'|'crlf'|'cr'`
and `applyLineEnding`. On **load**, the UI-main `editor-service` reads **raw bytes** via `IFileSystem`,
detects encoding (UTF-8 with/without BOM this pass; extensible) and the dominant line ending, and records
both on the `EditorDocument`. On **save**, it **re-encodes with the recorded encoding/BOM** and preserves
the **recorded line ending**, changing only edited lines (CM6 preserves untouched line breaks). **New**
documents default to **UTF-8, no BOM** and the **`editor.defaultLineEnding`** setting (default **LF**; also
CRLF/CR). The editor can represent CRLF/LF/CR (FR-026).

**Rationale**: Cross-platform correctness is the explicit P1 goal; doing detection/encoding purely over
bytes keeps it in core (OS/DOM-free, unit-testable) while the byte read/write stays behind `IFileSystem`.
The clarified defaults (UTF-8 no BOM, LF, configurable ending) are encoded directly.

**Alternatives**: Reading files as UTF-8 strings and normalising all endings — rejected: loses BOM and
churns every line (the exact corruption SC-005 forbids). A third-party encoding library beyond UTF-8 —
deferred (UTF-8 with/without BOM covers this pass; the seam accepts more encodings later).

---

## D6 — Saving & confinement (project tree / outside-all-projects)

**Decision**: `Ctrl+S` (renderer `editor.save` ActionId → `editor.*` bridge → UI-main `editor-service`)
writes the active editor's buffer. Confinement is a **pure predicate** in `core/src/editor/confinement.ts`:
a **project-owned** editor may save only where `isWithinTree(path, ownerProjectRoot)`; a
**sub-workspace-owned** editor may save only where `isOutsideAllProjects(path, allLoadedProjectRoots)`. UI
main enforces it against the known project roots (it already tracks loaded projects) before writing; a
new/unpathed document's save-location chooser is **constrained by construction** to the allowed tree.
`Ctrl+Shift+S` (Save-All) resolves the in-scope editor set via `core/src/editor/save-scope.ts`
(`editor.saveAllScope`: current tab / current project / all projects), saves the **pathed** ones (each under
its own confinement), **skips** unpathed ones, and **reports** them (FR-023, clarified).

**Rationale**: Project isolation (Principle I) demands the confinement; keeping the predicate pure makes it
exhaustively testable, and UI main is where the project roots and the FS live. The clarified Save-All
skip-and-report behaviour avoids interrupting a bulk save with modal prompts.

**Alternatives**: Validate-after-write then roll back — rejected (a write outside the tree must never
happen). Prompt-per-unpathed in Save-All — rejected by clarification (non-blocking skip+report chosen).

---

## D7 — Active-pane focus model (gates panel shortcuts)

**Decision**: A new renderer **active-pane context** (`renderer/workspace/active-pane.tsx`): the top-level
zone in focus is either the **Files & Folders pane** or a **workspace Panel**. Clicking the Files & Folders
pane sets it active (themeable highlight); clicking a Panel moves focus to it (the existing
`ws.setActivePanel` pointer-down already marks the active Panel — `panel-placeholder.tsx:202`). The global
keydown handler in `app.tsx` (`KeybindingsHandler`, L66-108) consults the active pane: while **Files &
Folders** is active, panel actions (`editor.save`, `editor.saveAll`, terminal/editor panel keys) are **not**
dispatched to any Panel — the file list's own keys apply (navigation, Enter-to-open, D8); when a **Panel**
is active, panel shortcuts apply.

**Rationale**: FR-015/016 require Ctrl+S not to fire against an editor while the user navigates the tree;
there is **no** active-pane concept today (only per-Panel active + explorer-focus-scoped keybindings), so
this is a new, small, cross-cutting primitive that also disambiguates Enter-to-open (D8).

**Alternatives**: Rely on DOM focus alone — rejected: fragile across the CM6 editor, the tree, and pane
chrome; an explicit active-pane state is testable and drives the highlight.

---

## D8 — Open a file from the tree; Enter-to-open (not rename); one buffer per file

**Decision**: The explorer already emits a `throng:open-file` CustomEvent on activation
(`explorer/file-tree.tsx:139-148`, gated by an `openMode`). Wire it to the **last active editor** of the
active tab (tracked in the renderer per tab, D from spec FR-011); if none exists, create the tab's dedicated
editor. `editor.openOnClick` (**single** default / double / none) governs mouse activation;
**Enter on a highlighted file always opens** it (even when `none`) and **never** starts a rename — remove
the Enter→`edit()` path in `use-explorer-data.ts`; folders never open. **One buffer per file app-wide**
(FR-011a): before opening, the renderer asks the UI-main **open-document registry** (D2) whether the path is
open anywhere; if so, it **focuses/raises that editor** instead of loading a second buffer, and **Open In**
targets for an open file are **disabled**.

**Rationale**: Directly implements US2 + the clarified single-click default, Enter-always-opens, and
app-wide one-buffer scope (coherent with the machine-wide file lock, D10). The open-intent seam already
exists from 004; the registry is the new piece.

**Alternatives**: Renderer-local "already open" tracking — rejected: cannot see other windows/sub-workspaces
(the registry must be app-wide, so UI-main-owned). Keeping Enter as rename — rejected (the reported bug /
US2).

---

## D9 — Crash/close recovery via temp files (no daemon, no warning on close)

**Decision**: A UI-main **`editor-recovery`** service writes each open document's in-progress content to a
**recovery temp file** at `%APPDATA%\throng\recovery\<panelId>` (the existing app-data root), **debounced**
and **regardless** of the auto-save setting (FR-041). Each `EditorDocument` therefore has a **real target
path** (may be empty) and a **recovery temp path** (deterministic from `panelId`). Closing the app with
unsaved editors shows **no warning** (FR-040). On launch, `editor-coordinator` **reconciles**: for each
persisted editor Panel (`kind='editor'` in the layout blob) with a matching recovery temp, restore the
in-progress content and the real path; **delete** temp files whose document is fully saved / no longer open
(FR-042/043). The recovery temp **does not** count toward the unsaved indicator (FR-053).

**Rationale**: Guarantees no lost work across a deliberate close or crash without nagging, using plain disk
I/O in the process that already owns files — no daemon needed (D2). Keying the temp by `panelId` makes
restore a direct match to the persisted Panel.

**Alternatives**: Warn-on-close (like terminals) — rejected by the spec (editors use silent recovery). A
daemon-held in-memory buffer — rejected (D2; and it would die with the daemon anyway).

---

## D10 — Dirty-file OS lock (FR-028)

**Decision**: New OS seam **`IFileLock`** (`core/src/abstractions/file-lock.ts`: `acquire(absPath) →
handle`, `release(handle)`), Windows impl **`WindowsFileLock`** (`platform-windows/`) that holds a file
handle **without share-write/delete** so the OS refuses external modification — the **file-granularity
analogue** of 005's `WindowsDirectoryLock` (same helper/handle technique). Instantiated in **UI main** and
driven by the editor coordinator: **acquire when a document becomes dirty and has a real path**; **release
on save (clean) or Panel destroy/close**. A **clean** or **unpathed** document takes no lock. Verified by a
reusable **`IFileLock` contract suite** (`core/testing/file-lock-contract.ts`).

**Rationale**: Implements the clarified prevention-first choice (FR-028) — external processes can't change a
file while the user has unsaved edits, so the "changed underneath the editor" conflict cannot arise.
UI-main ownership is correct because the lock only needs to live as long as the UI/editor (it releases on
save/close), so no daemon persistence is required.

**Alternatives**: Detect-and-warn on external change — superseded by the user's prevention choice. Daemon-
owned lock (reuse `WindowsDirectoryLock`) — rejected: pulls the daemon into an otherwise daemon-free feature
for a lock that only needs UI lifetime.

---

## D11 — Deliberate-destroy prompt for dirty editors (FR-006a, clarified)

**Decision**: Closing/destroying a **dirty** editor Panel prompts **save / discard / cancel** (naming the
file), extended to destroying a **Tab** with dirty editors and **deleting a project or sub-workspace** with
dirty editors (all clarified). Reuse the existing `confirm-dialog.tsx` (`warningMessage`) machinery, driven
from `panel-placeholder.tsx` (panel/tab) and UI-main project/sub-workspace delete guards. **Save** honours
confinement (D6); **cancel** aborts leaving everything unchanged. This is distinct from **app close**, which
is silent + recovery (D9).

**Rationale**: A deliberate destroy of visible unsaved work should never be silent; recovery is for
accidental/app-close loss, not a chosen delete. The dialog + warning pattern already exists (005 FR-026a).

**Alternatives**: Silent discard / silent-with-recovery on deliberate delete — rejected by clarification.

---

## D12 — Sub-workspace sync = one document, many views (FR-034)

**Decision**: A **project-owned** editor synced into a sub-workspace shares its **`panelId`** (the existing
clone-by-id "Sync to" model, `detach-context.tsx:syncToExisting`), so both views map to **one**
`EditorDocument`. UI main relays **content + dirty-state** changes across the panel's windows via the same
broadcast pattern as `panel-rename-sync`/`panel-state-sync` (renderer → preload `editor.notifySync` → UI
main → other windows' `editor.onSync`). A new `renderer/workspace/editor-sync.tsx` listener (sibling of the
existing sync listeners) applies incoming edits. There is **never** a second buffer (the app-wide registry
D8 also guarantees this). **Cursor/scroll/selection are window-local** (only content + dirty mirror).

**Rationale**: Mirrors 005's terminal FR-021 (one session, many views) at the document level; reuses the
proven cross-window relay; the app-wide one-buffer registry makes "one document" the only possibility.

**Alternatives**: An independent buffer per view kept in sync by diffing — rejected (two buffers under one
`panelId` is inconsistent and risks divergence). Full CRDT/collaborative sync — YAGNI (single user, same
document).

---

## D13 — Ownership & project isolation (FR-035/036/037/038)

**Decision**: Reuse the existing **`ownedBySub`** detection (`panel-body.tsx:30`,
`panel-placeholder.tsx:120`). A **project-owned** editor may only hold/save files under its project tree; a
**sub-workspace-owned** editor may only hold/save files **outside all loaded projects** (D6). A project's
file may be loaded **only** from within its own project (never into another project's or a sub-workspace-
owned editor directly — it reaches a sub-workspace only via the sync menu, D12). **FR-038**: when creating a
project, UI main checks (`core/src/editor/overlap.ts`) whether the new root would **contain a file currently
open in a sub-workspace-owned editor**; if so it **blocks/defers** creation and instructs the user to save +
close that editor first. Editor Panels can never be dragged/sent into another project (reuse the terminal
ownership restrictions, 005 FR-030 / drag guards).

**Rationale**: Direct implementation of the project-isolation clarifications; all checks are pure predicates
in core with UI-main enforcement against the loaded-project set.

**Alternatives**: Allow cross-project editors with warnings — rejected (violates Principle I). Auto-migrate a
sub-workspace editor into a new overlapping project — rejected (the user chose an explicit save-and-close
block).

---

## D14 — Config, theme, keybindings & persistence

**Decision**: Add an **`editor`** section to `AppSettings` (`core/src/config/app-settings.ts`) —
`{ openOnClick: 'single'|'double'|'none'; autoSave: boolean; saveAllScope: 'tab'|'project'|'all';
defaultLineEnding: 'lf'|'crlf'|'cr' }` with defaults `single / false / project / lf` — via a tolerant
parser mirroring `terminalSettings()` (L158-175), and `DEFAULT_APP_SETTINGS.editor`. Add **editor theme
tokens** (`colours.editorBg/editorFg/editorSelection/editorCursor`, and a shared **`colours.unsavedDot`**)
to `theme.ts`, emitted as `--throng-*` vars (CM6 theme + the dot/pill styles read them). Add
`editor.save` / `editor.saveAll` **ActionIds** to `keybindings.ts` (defaults **Ctrl+S** / **Ctrl+Shift+S**)
handled in `app.tsx` subject to the active-pane gate (D7). Persistence: `Panel.config` (`EditorPanelConfig`)
rides the existing layout blob — **no migration; `user_version` stays 6**.

**Rationale**: Externalised configuration (Principle X) using the established tolerant-parse + hot-reload
plumbing (`config-watcher.ts` → `config-store.tsx`); no schema change (DRY with 005's approach).

**Alternatives**: A separate editor-config file — rejected (settings.json + hot-reload already exists). A new
SQLite table for editor state — rejected (YAGNI; config rides the blob, unsaved content is in recovery temp).

### Dependency summary

| Dependency | Where | Phase | Build note |
|------------|-------|-------|-----------|
| `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language` | `@throng/ui` renderer | A | Pure ESM JS; no native build; no workers/CDN (sandbox/offline safe) |
| *(none)* | core editor domain, `IFileLock`, `WindowsFileLock`, UI-main services, settings/theme | A–E | Reuses existing stack (`IFileSystem`, config, broadcast pattern); **no daemon/`ipc-contract`/SQLite change** |
