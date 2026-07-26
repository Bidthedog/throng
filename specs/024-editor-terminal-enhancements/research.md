# Research: Editor & Terminal Enhancements

Codebase survey (five parallel探 passes) plus the resulting decisions. Every "NEEDS CLARIFICATION"
from the spec's non-functional gaps is either resolved here or explicitly deferred to implementation
with a reason.

## US1 — editor word-wrap + terminal status bar + preferences

**Settings pipeline (Decision: fully generic, 3 files each).** A boolean setting is added in
`packages/core/src/config/app-settings.ts` (interface field + `DEFAULT_APP_SETTINGS` value + tolerant
parser line), plus a `FieldDescriptor` in `settings-metadata.ts`. The Preferences UI
(`preferences/settings-tab.tsx` + `form-controls.tsx` `case 'toggle'`) and the config-store
persistence are **entirely descriptor-driven** — no per-field wiring. A `settings-metadata.test.ts`
completeness gate fails if a new `AppSettings` leaf has no descriptor (the TDD anchor).
- `editor.defaultWordWrap` and `editor.showStatusBar` → `group: 'Editor'`.
- `terminals.showStatusBar` → new `group: 'Terminal'` (the first *rendered* terminal setting; a hidden
  `'Terminals'` group exists but is withheld). Add to `TerminalSettings` + `terminalSettings()` parser.
- No `SHIPPED_DEFAULTS_VERSION` bump — settings resolve via tolerant merge-over-defaults.

**Editor wrap is per-document, not per-panel (Decision, from FR-001a / Principle XI).** The editor is
CodeMirror 6; the wrap flag must be owned by the document authority (`EditorCoordinator`/`CoordDoc`),
not the panel, so two panels on one file wrap together. Reflow is CodeMirror's line-wrapping
compartment reconfigured — rewraps the whole document. In-memory only; seeded from
`editor.defaultWordWrap` when a document opens that is not already open anywhere.

**Terminal status bar is a new surface.** Terminals have no status bar today; a new
`terminal-status-bar.tsx` renders below the xterm viewport. It must resize the PTY (fit) so the shell
sees the reduced row count. It carries **no** wrap toggle this feature (terminal wrap descoped, FR-003e).

**`Ctrl+Alt+W` command (Decision).** A single-token chord the model already expresses; audited clear
of the reserved terminal-key tier (v4.2.0). Add `editor.toggleWordWrap` to the `ActionId` union,
`COMMAND_SCOPES` (`{editor}` only — terminal scope waits for #169), `WINDOWS_BINDINGS`, and a
`keybindings-metadata.ts` descriptor. A checkable "Word Wrap" item goes in the editor content menu
(`content-menu.ts`), showing the chord and current state (Principle VI).

## US2 — drag a file/folder onto a terminal to paste its path

**The tree drag carries nothing readable (key finding).** react-arborist's react-dnd drag exposes node
ids (= relPaths) only on its internal channel; `dataTransfer` has no readable MIME. **Decision: add a
shared tree-drag payload.** On tree `dragstart`, write the selected items' absolute paths to
`dataTransfer` under `application/x-throng-tree-paths` (JSON) *and* to a small renderer drag-state
store (for the e2e CustomEvent seam). This same payload serves US4.

**Terminal drop.** `terminal-panel.tsx`'s panel div has no drop handler; add `onDragOver`/`onDrop`.
On drop, insert the path text via the existing paste seam `window.throng.terminal.write(panelId, text)`
(the single write-to-PTY route from #142) — a terminal has no caret, text lands at the shell cursor
like a paste. Quote per FR-005 (double-quote only if whitespace); multi-item = space-joined
(FR-004a); trailing space with cursor left before it (FR-004b) → insert `"path" ` then emit one
cursor-left. E2E via a new `throng:tree-drop` CustomEvent mirroring `throng:os-drop`.

## US3 — undo/redo tree operations, persisted (the large one)

**Recycle-bin *delete* already exists; *restore* does not (critical finding).**
`IFileSystem.trash(path)` → Electron `shell.trashItem` is seamed, contract-tested, and already the
default delete. But `shell.trashItem` is one-way and Electron has no restore API. **Decision: add
`IFileSystem.restoreFromTrash(originalAbsPath): Promise<void>` to the seam**, with:
- a contract-test case in `file-system-contract.ts` (trash then restore then assert the file is back);
- a Windows concrete impl. **Decision: PowerShell `Shell.Application` Recycle-Bin automation** (the
  `NameSpace(0xA)` verb approach) invoked from the main process, rather than a native module — no
  build-toolchain dependency, testable, and reversible. macOS/Linux impls deferred behind the seam
  (the spec's "degrade cleanly where unimplemented" edge case covers this: the undo of a delete
  reports unavailable rather than crashing).
- **Risk & mitigation:** matching a trashed item back to its original path is the fragile part
  (the recycle bin renames entries). The undo entry records the original absolute path and the delete
  timestamp; restore searches the bin for the most-recent match. If not found → refuse with the
  FR-008 error notice. This is the "focused validation pass" the spec (FR-045-adjacent, US3 assumptions)
  asks for; it is why US3 is a candidate for its own branch.

**Undo engine (Decision: new pure module `core/fileop-undo/undo-stack.ts`).** Mirror the shape of the
existing `UndoHistory` (`undo-service.ts`): bounded stack (cap **50**), record clears redo, redo does
not clear. Each entry is `{op: 'move'|'rename'|'delete', ...paths, timestamp}`. Pure, unit-tested for
bound/redo-truncation/validate semantics.

**Recording seams already exist.** `FilesService` emits `setOnMoved(MovePair[])`, `setOnDeleted(abs[])`,
and `removed[]` — wire the recorder into `main.ts:810-815` alongside the existing editor-repoint
callbacks. **Editor re-point on undo is free:** feeding reversed `MovePair`s back through
`beginMove`/`markMoved` re-points every open editor (the #87/019 machinery); a restored delete drives
`EditorCoordinator.load` so a `fileMissing` doc re-points.

**Persistence (Decision: SQLite migration v8).** Add `packages/persistence/src/migrations/v8-fileop-undo.ts`
(template: `v7-document-state.ts`), a `FileOpUndoRepository` keyed `(owner_user, project_id)` storing
the stack as a bounded JSON blob (like `workspace_layout`) or N rows, and register in
`migration-runner.ts` (`LATEST_VERSION → 8`). Persisted entries are validated under FR-008 on load-and-apply;
a missing/unreadable/old-format stack degrades to empty (FR-010a).

**Scope resolution.** `Ctrl+Z`/`Ctrl+Y` already resolve by `DispatchScope`; the explorer scope drives
the file-op undo, the editor scope keeps text undo — no change to `resolveAction`, only new bindings
scoped `{explorer}`.

## US4 — tree file → empty panel; sub-workspace → project ownership

**Reuses the OS-drop path.** `panel-body.tsx` already wraps an *untyped* panel in `PanelDropTarget`
whose `onOpen` calls `setPanelType(id,'editor',{filePath})`. Feed the US2 tree-drag payload into that
same `onOpen`. Confinement via the existing `resolveDrop`/`resolveSaveConfinement` (core `drop.ts`).

**The one new model op (Decision).** Ownership is `Panel.originProjectId`; INV-4 (`invariants.ts`)
forbids a main-layout panel whose `originProjectId ≠ layout.projectId`. A drop onto a
sub-workspace-owned untyped panel must rewrite `originProjectId` to the target project. Add a pure core
op `convertPanelToProject(layout, panelId, projectId)` (unit-tested against the invariants), distinct
from `setPanelType`. Already-open-elsewhere → reveal+focus that panel (FR-011b) reusing the editor
coordinator's existing "focus the panel showing this file" path; folder/multi-item drop → rejected with
the drag's "not allowed" effect (FR-011a).

## US5 — editor panels name themselves from the open file

**Smallest story — view-only (Decision).** `panel-placeholder.tsx`'s `effectiveTitle` already does
"auto-title unless `titleIsCustom`" for terminals (`terminalTitle`). Extend the branch: when
`!titleIsCustom && kind === 'editor'`, use the open file's basename (final extension stripped, per
FR-015) from `useEditorState`'s `displayName`. "Reset Name" already restores the auto source once
`titleIsCustom` clears. The **unsaved dot** (`throng-unsaved-dot`, already on header + tab) is reused
unchanged (FR-017a) — it is decoration beside the title, never folded into the name. No persistence
change; basename derivation gets a core unit test (`path-display.ts`).

## US6 — sub-menu fix + keyboard nav + `menu.open`

**Most of this already shipped (018) — key finding.** The shared menu (`context-menu.tsx`) already has
roving-focus keyboard nav (arrows/Home/End/Enter/Escape/ArrowRight-opens/ArrowLeft-closes).

- **The "bug" (#157) is a toggle (Decision: idempotent open).** Clicking a parent runs
  `setOpenLabel(cur => cur === label ? null : label)` — so a click on an *already-open* parent closes
  its sub-menu. Fix: `setOpenLabel(label)` in both the click handler and the Enter/Space handler. This
  is exactly FR-018's "a parent click MUST NEVER toggle its sub-menu shut". Red-first regression test.
- **Keyboard gap:** ArrowLeft cannot exit a leaf sub-menu back to its parent (the child's ArrowLeft only
  acts if the child has its *own* open grandchild), and ArrowRight/Enter don't deterministically focus
  the first child. Thread a `onBack`/parent-focus callback through the recursive `MenuLevel`, and focus
  the first child on open (FR-018b).
- **`menu.open` command (Decision, + a dispatch fix).** Add `menu.open` bound to `Shift+F10` and
  `ContextMenu`, scoped `{explorer,editor,terminal}`. **Gotcha:** `app.tsx:180-186` drops Shift for
  non-backtick keys, so `Shift+F10` tokenises as `F10` and would never match — the dispatch must
  include `shift` for function keys. There is no shared "build the focused surface's menu" helper, so
  add one keyed by the focused panel/row, opening at `activeElement.getBoundingClientRect()` (FR-018c).

## US7 — terminal URLs open the system browser

- **No `setWindowOpenHandler` anywhere (the bug's root).** Renderer `window.open` is unguarded → a new
  in-app BrowserWindow. **Decision: a shared main-process helper** applied to every window creator
  (`createMainWindow`, `createSubWorkspaceWindow`, about, preferences, ghost) returning
  `{ action: 'deny' }`, routing `http(s)` targets through `shell.openExternal` and dropping the rest
  (FR-019b). Testable via the e2e harness `app.evaluate` (assert `getAllWindows().length` unchanged).
- **OSC 8 routing (Decision).** Override xterm `options.linkHandler.activate(event, uri)` in
  `use-terminal.ts`; gate on `event.ctrlKey || event.metaKey` (FR-019c); route through the seam. A
  hover affordance via the link handler's `hover`/`leave` (or a `Ctrl`-held CSS class on the container).
- **Plain-text detection (Decision: add `@xterm/addon-web-links`).** Loaded next to `FitAddon`; its
  activation handler is modifier-aware and matches only `http(s)` (FR-019a). This is the one new npm dep.
- **Widen the seam.** `isSafeExternalUrl` is `https`-only; change to `/^https?:\/\//i` (FR-052/FR-019);
  update the one unit test (`external-url.test.ts` asserts `http→false` today — flip it, keep the
  `javascript:`/`file:`/`data:` rejections as the injection guard). **Hoist** the `openExternal` preload
  bridge out of the `about` namespace to a top-level `window.throng.openExternal`.
- **Link-aware menu (Decision).** Extend `TerminalApi` with `getLinkAt(x,y)`; add "Open Link" /
  "Copy Link Address" to the terminal `onContextMenu`, above Copy/Paste, only when a link is under the
  point and no text is selected (selection wins, FR-019d).

## Deferred to implementation (with reasons, not omissions)

- **Performance budgets.** The spec sets none, deliberately. Reflow, link detection and path insert are
  interactive one-shots; the undo stack is O(1) bounded-50. No synthetic threshold is invented; if a
  task surfaces a real budget (e.g. a large-buffer reflow), it is stated in that task.
- **macOS/Linux `restoreFromTrash`.** Behind the seam; Windows-first. The spec's degrade-cleanly edge
  case governs the unimplemented platforms.
- **US3 recycle-bin match robustness** is the identified project risk; its own validation pass and,
  likely, its own branch.

## Alternatives considered

- *US1 wrap per-panel* — rejected: violates Principle XI for editors (two panels, one file). Per-document.
- *US3 undo stack in localStorage* — rejected: renderer-scoped, not restart-durable. SQLite (v8).
- *US3 restore via native module* — rejected for the first cut: build-toolchain cost; PowerShell
  automation is dependency-free and testable. A native module can replace it later behind the seam.
- *US6 build the whole menu keyboard system fresh* — unnecessary: 018 already shipped most of it; refine.
- *US7 detect URLs with a hand-rolled regex link provider* — the addon is the maintained, tested path.
