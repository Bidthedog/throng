# Tasks: Editor & Terminal Enhancements

**Feature**: `specs/024-editor-terminal-enhancements` | **Branch**: `feature/S024-editor-terminal-enhancements`

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/seams.md](./contracts/seams.md), [quickstart.md](./quickstart.md)

Test-first throughout (constitution Principle V, FR-020). Each `[P]` task is parallelizable (distinct
files, no incomplete dependency). Story labels map to spec user stories. Absolute repo paths are under
the worktree root.

**Recommended execution order (risk-tiered, from plan.md)** — phases are independent, so deliver in
this order for fastest safe increments: **US5 → US6 → US1 → US2 → US7 → US4 → US3**. US3 is the
platform-risk story and a candidate for its own branch.

---

## Phase 1: Setup

- [ ] T001 Add `@xterm/addon-web-links` to `packages/ui/package.json` dependencies (US7 plain-text link detection); run `npm install` in the worktree and confirm it links.
- [ ] T002 [P] Confirm the green baseline is recorded (typecheck, lint, `vitest run --project unit --project integration --project contract`) before any change; note pre-existing e2e flakes from the baseline memory.

## Phase 2: Foundational (shared prerequisites)

- [ ] T003 [P] Add a shared **tree-drag payload** seam used by US2 and US4: on tree `dragstart` in `packages/ui/src/renderer/explorer/tree-node.tsx` / `file-tree.tsx`, write the selected items' absolute paths to `dataTransfer['application/x-throng-tree-paths']` (JSON, selection order) and mirror into a renderer drag-state store; add a `throng:tree-drop` CustomEvent seam (`{panelId, paths}`) mirroring `throng:os-drop` for e2e. Do NOT change the tree's internal react-arborist move/copy drag or the Ctrl-copy cursor (FR-081).
- [ ] T004 [P] Unit test the payload builder (paths in selection order; folder/multi flags) in `packages/core/tests/unit/tree-drag-payload.test.ts` (extract a pure helper into `packages/core/src/editor/` if needed so it is unit-testable).

---

## Phase 3: US1 — Editor word-wrap toggle + terminal status bar + preferences (P1)

**Goal**: Editors gain a per-document word-wrap toggle (status bar + content menu + `Ctrl+Alt+W`);
terminals gain a new status bar; three visibility/default preferences ship. Terminal wrap is descoped (#169).
**Independent test**: `editor-word-wrap.e2e.ts` + `preferences-settings.e2e.ts` (3 toggles) green;
toggling one editor rewraps every panel on that file; hiding a status bar strands nothing.

### Tests first
- [ ] T005 [P] [US1] Parser tests for `editor.defaultWordWrap` + `editor.showStatusBar` in `packages/core/tests/unit/editor-settings.test.ts` (default-when-absent, honour `false`, reject non-boolean; update the full-section `toEqual` objects).
- [ ] T006 [P] [US1] Parser test for `terminals.showStatusBar` in `packages/core/tests/unit/app-settings.terminals.test.ts`.
- [ ] T007 [P] [US1] Completeness assertions for the three keys in `packages/core/tests/unit/settings-metadata.test.ts` (`control` = `'toggle'`, correct `group`).
- [ ] T008 [P] [US1] Keybindings tests for `editor.toggleWordWrap` in `packages/core/tests/unit/` (completeness descriptor present; scope `{editor}`; no collision; `Ctrl+Alt+W` resolves in editor scope, not terminal).
- [ ] T009 [P] [US1] E2E `packages/ui/tests/e2e/editor-word-wrap.e2e.ts`: toggle via status bar, content menu, and `Ctrl+Alt+W`; two panels on one file wrap together; reopen resets to preference; hidden editor status bar still allows the chord + "Set Language…".
- [ ] T010 [P] [US1] Extend `packages/ui/tests/e2e/preferences-settings.e2e.ts`: the three toggles persist and round-trip (Editor group ×2, Terminal group ×1).

### Implementation
- [ ] T011 [US1] Add the three booleans to `packages/core/src/config/app-settings.ts` (interface fields, `DEFAULT_APP_SETTINGS` = `true`, tolerant parser lines) — `EditorSettings` ×2, `TerminalSettings` ×1.
- [ ] T012 [US1] Add three `FieldDescriptor`s to `packages/core/src/config/settings-metadata.ts` (`editor.defaultWordWrap`, `editor.showStatusBar` → `group: 'Editor'`; `terminals.showStatusBar` → `group: 'Terminal'`; all `control: 'toggle'`).
- [ ] T013 [US1] Register `editor.toggleWordWrap` in `packages/core/src/config/keybindings.ts` (ActionId union; `COMMAND_SCOPES` → `{editor}` via an EDITOR_ONLY-style set; `WINDOWS_BINDINGS` → `['Ctrl+Alt+W']`) and a `chord()` descriptor in `keybindings-metadata.ts`.
- [ ] T014 [US1] Editor per-document wrap state: add `wordWrap` to the document authority in `packages/ui/src/main/editor-coordinator.ts` (`CoordDoc`), seed from `editor.defaultWordWrap` on first open, broadcast to all views; expose a toggle over the editor IPC/preload. In-memory only (FR-003).
- [ ] T015 [US1] Wire CodeMirror line-wrapping to the document `wordWrap` in `packages/ui/src/renderer/editor/use-editor.ts` (reconfigure the wrap compartment; rewrap the whole document).
- [ ] T016 [US1] Add the wrap toggle control to the editor status strip `packages/ui/src/renderer/editor/status-strip.tsx`, and gate the whole strip's visibility on `editor.showStatusBar` (reclaim the row for content when hidden).
- [ ] T017 [US1] Add the checkable "Word Wrap" item (chord + checked state) to `packages/ui/src/renderer/editor/content-menu.ts` (FR-003d, Principle VI) and dispatch `editor.toggleWordWrap` in the renderer command switch (`app.tsx`).
- [ ] T018 [US1] Create the terminal status bar `packages/ui/src/renderer/terminal/terminal-status-bar.tsx` showing the **shell flavour label** (FR-001; not an empty row), render it in `terminal-panel.tsx` gated on `terminals.showStatusBar`, and ensure adding/removing it re-fits the PTY (row count). No wrap control (FR-003e).

**Checkpoint**: US1 e2e + unit green; `Ctrl+Alt+W` audited not to reach `{terminal}`.

---

## Phase 4: US2 — Drag a file/folder onto a terminal to paste its path (P2)

**Goal**: Dropping tree items on a terminal inserts their absolute path(s) at the shell cursor.
**Independent test**: `terminal-path-drop.e2e.ts` green.

- [ ] T019 [P] [US2] Unit test the path formatter in `packages/core/tests/unit/`: whitespace→double-quoted else bare; multi-item space-joined in order; atomic string (FR-005/FR-004a).
- [ ] T020 [P] [US2] E2E `packages/ui/tests/e2e/terminal-path-drop.e2e.ts` (via `throng:tree-drop`): single file path inserted at cursor + trailing space with cursor before it, line not submitted; folder same; multi-item space-joined; drop on an editor pastes nothing.
- [ ] T021 [US2] Add `onDragOver`/`onDrop` to the terminal panel div in `packages/ui/src/renderer/terminal/terminal-panel.tsx` reading the tree-drag payload; format the path(s) (T019 helper) and write via `window.throng.terminal.write(panel.id, text)`, then emit one cursor-left so the caret sits before the trailing space (FR-004b).
- [ ] T022 [US2] Ensure an editor content-area drop of a tree payload pastes nothing (FR-005a) and an empty-panel drop routes to US4, not path-paste.

**Checkpoint**: US2 e2e green; editor/empty-panel drops unaffected.

---

## Phase 5: US3 — Undo/redo tree move/rename/delete, persisted (P3) — LARGEST, platform risk

**Goal**: `Ctrl+Z`/`Ctrl+Y` reverse tree ops; delete restores from the recycle bin; stack persisted
per project; refusals warn. **Independent test**: `explorer-undo.e2e.ts` + `migration-v8.integration.test.ts`
+ the restore-from-trash contract case green. **Candidate for its own branch.**

### Tests first
- [ ] T023 [P] [US3] Add a `restoreFromTrash` case to the shared contract suite `packages/core/src/testing/file-system-contract.ts` (trash → restore → assert back; restore-after-purge → rejects).
- [ ] T024 [P] [US3] Unit tests for the pure undo engine in `packages/core/tests/unit/fileop-undo.test.ts` (record clears redo; redo does not; bound to 50; validate refuses on stale world; serialise/parse round-trip; parse of garbage → empty).
- [ ] T025 [P] [US3] Integration test `packages/persistence/tests/integration/migration-v8.integration.test.ts` (v7→v8 upgrade; repo round-trip; CASCADE on project delete) mirroring migration-v7.
- [ ] T026 [P] [US3] E2E `packages/ui/tests/e2e/explorer-undo.e2e.ts`: cut+paste/rename/delete each undone+redone from the tree; delete restored from recycle bin; editor-focused `Ctrl+Z` is text; a stale-world undo raises a persistent error notice and changes nothing; **an open editor on the affected file follows the undone move/rename without going dirty or warning (FR-009 / SC-003 Acceptance #7)**; persistence across an app restart; undo/redo also invocable from the explorer context menu (FR-006a).

### Implementation
- [ ] T027 [US3] Add `restoreFromTrash(originalAbsPath, deletedAt)` to `IFileSystem` (`packages/core/src/abstractions/file-system.ts`) and a Windows impl (PowerShell `Shell.Application` recycle-bin verb) in `packages/ui/src/main/node-file-system.ts` (+ `packages/platform-windows` if that is the seam home); unimplemented platforms reject with a well-known "unsupported" error.
- [ ] T028 [US3] Create the pure undo engine `packages/core/src/fileop-undo/undo-stack.ts` (record/undo/redo/validate/serialise/parse; bound 50; injected `world` probe) per contracts/seams.md §2.
- [ ] T029 [US3] Add migration `packages/persistence/src/migrations/v8-fileop-undo.ts` + register in `migration-runner.ts` (`LATEST_VERSION → 8`); add `FileOpUndoRepository` and export from `index.ts`.
- [ ] T030 [US3] Record ops: in `packages/ui/src/main/files-service.ts` / `main.ts`, at the existing `setOnMoved`/`setOnDeleted` callback registrations (anchor on those symbols, not a line number), push move/rename/delete entries (with original paths + timestamp) into the per-project stack; delete must route to `trash` (already default) and record the restore target.
- [ ] T031 [US3] Apply undo/redo: validate (FR-008), then drive `FilesService.move`/`rename` or `IFileSystem.restoreFromTrash`; re-drive `beginMove`/`markMoved` (reversed `MovePair`s) and `EditorCoordinator.load` so open editors follow (reuse the existing re-point machinery). Refuse → persistent `error` notice via `useNotify`/explorer error (FR-008a).
- [ ] T032 [US3] Register `file.undo`/`file.redo` ActionIds in `packages/core/src/config/keybindings.ts` (scope `{explorer}`; `WINDOWS_BINDINGS` → `file.undo: ['Ctrl+Z']`, `file.redo: ['Ctrl+Y','Ctrl+Shift+Z']`) **and** add their `keybindings-metadata.ts` `chord()` descriptors (the completeness gate requires a descriptor per ActionId), then dispatch from the explorer keybinding handler.
- [ ] T032a [P] [US3] Keybindings unit tests for `file.undo`/`file.redo` in `packages/core/tests/unit/` (completeness descriptor present; scope `{explorer}`; `Ctrl+Z` resolves to `file.undo` in explorer scope but to editor text-undo in `{editor}` scope; no collision) — mirrors T008/T045.
- [ ] T032b [US3] Add "Undo"/"Redo" items to the File Explorer context menu (`packages/ui/src/renderer/explorer/context-menu-items.ts`) showing their chords, each disabled when its stack is empty (FR-006a, Principle VI).

**Checkpoint**: US3 e2e + contract + migration green; keybindings completeness gate green; explorer menu items present; degrade-cleanly verified where restore is unimplemented.

---

## Phase 6: US4 — Drag a tree file onto an empty panel; ownership conversion (P4)

**Goal**: A tree file dropped on an untyped panel opens as an editor; sub-workspace→project conversion.
**Independent test**: extended `os-drop.e2e.ts` (tree-drop → editor; sub-workspace conversion survives restart).

- [ ] T033 [P] [US4] Unit test `convertPanelToProject` in `packages/core/tests/unit/panel-ownership.test.ts` (rewrites `originProjectId`; result passes `validateMainLayout` / INV-4; no-op when already project-owned).
- [ ] T034 [P] [US4] E2E extension in `packages/ui/tests/e2e/os-drop.e2e.ts` (or a new `tree-drop-open.e2e.ts`): tree file → untyped project-owned panel becomes editor; sub-workspace-owned panel converts + survives restart; folder/multi rejected; already-open file focuses its panel.
- [ ] T035 [US4] Add the pure op `convertPanelToProject(layout, panelId, projectId)` to `packages/core/src/workspace/operations.ts` (or `assignment.ts`).
- [ ] T036 [US4] Feed the tree-drag payload into the untyped-panel `onOpen` in `packages/ui/src/renderer/workspace/panel-body.tsx` (reuse the OS-drop `setPanelType(id,'editor',{filePath})` path); on a sub-workspace-owned target call `convertPanelToProject` first; gate through `resolveDrop` confinement.
- [ ] T037 [US4] Reject folder / multi-item tree payloads on an untyped panel with the "not allowed" drag effect (FR-011a); route an already-open file to reveal+focus its panel (FR-011b).
- [ ] T038 [US4] Update `specs/006-editor-panel-type/spec.md` FR-079 ("Not planned") to record the shipped behaviour (FR-014).

**Checkpoint**: US4 e2e green; INV-4 holds; internal tree drag unchanged.

---

## Phase 7: US5 — Editor panels name themselves from the open file (P5) — SMALLEST

**Goal**: An editor's title auto-derives from its open file's basename unless renamed; unsaved dot reused.
**Independent test**: `editor-naming.e2e.ts` green.

- [ ] T039 [P] [US5] Unit test basename derivation in `packages/core/tests/unit/` (`foo.test.ts`→`foo.test`, `Makefile`→`Makefile`, `.gitignore`→`.gitignore`, never blank) via `packages/core/src/editor/path-display.ts`.
- [ ] T040 [P] [US5] E2E `packages/ui/tests/e2e/editor-naming.e2e.ts`: `foo.ts`→`foo`; open `bar.md`→`bar`; rename `Scratch`, open `baz.ts`→stays; "Reset Name"→`baz`; unsaved dot shows for auto-named and renamed; persists across restart.
- [ ] T041 [US5] Extend `effectiveTitle` in `packages/ui/src/renderer/workspace/panel-placeholder.tsx`: when `!titleIsCustom && kind === 'editor'`, use the editor's `displayName` basename (from `useEditorState`); mirror the terminal `terminalTitle` branch. Confirm the shared `throng-unsaved-dot` renders for a dirty editor regardless of naming (FR-017a) — no name mutation.

**Checkpoint**: US5 e2e green.

---

## Phase 8: US6 — Sub-menu fix + keyboard nav + `menu.open` (P6) — mostly refinement

**Goal**: A parent click never closes its sub-menu; full keyboard nav; a `menu.open` command.
**Independent test**: `context-menu.e2e.ts` regression + `menus.e2e.ts` keyboard + `menu.open` green.

### Tests first (regression fails on master)
- [ ] T042 [P] [US6] Regression e2e in `packages/ui/tests/e2e/context-menu.e2e.ts`: open a sub-menu by click, click the parent again → it stays open (fails on `origin/master`).
- [ ] T043 [P] [US6] Keyboard e2e in `packages/ui/tests/e2e/menus.e2e.ts`: `→`/`Enter` enters a sub-menu focusing its first child; `←`/`Escape` steps back to the parent; `Enter` on a leaf runs it.
- [ ] T044 [P] [US6] E2E for `menu.open`: with a tree row / editor / terminal focused, `Shift+F10` and the `ContextMenu` key open that surface's menu with the first item focused.
- [ ] T045 [P] [US6] Keybindings unit tests for `menu.open` (descriptor present; scope `{explorer,editor,terminal}`; `Shift+F10` + `ContextMenu` resolve; no collision).

### Implementation
- [ ] T046 [US6] Fix the parent-click toggle → idempotent open in `packages/ui/src/renderer/workspace/context-menu.tsx` (the `onClick` handler and the Enter/Space handler: `setOpenLabel(item.label ?? null)`), FR-018.
- [ ] T047 [US6] Add sub-menu keyboard exit/enter in `context-menu.tsx`: thread an `onBack`/parent-focus callback through the recursive `MenuLevel`; focus the first child on open; `←`/`Escape` close the innermost level and return focus to the parent (FR-018b).
- [ ] T048 [US6] Register `menu.open` in `packages/core/src/config/keybindings.ts` (`['Shift+F10','ContextMenu']`, scope `{explorer,editor,terminal}`) + `keybindings-metadata.ts` descriptor.
- [ ] T049 [US6] Fix the dispatch in `packages/ui/src/renderer/app.tsx` to pass `shift` for function keys (so `Shift+F10` tokenises), add `menu.open` to `HANDLED` + a switch case that builds the focused surface's menu items and calls `openMenu` at `activeElement.getBoundingClientRect()` (FR-018c). Add a shared "menu for the focused surface" helper.

**Checkpoint**: US6 regression + keyboard + `menu.open` e2e green.

---

## Phase 9: US7 — Terminal URLs open the system browser (P7) — bug + capability

**Goal**: Terminal links open the system browser; in-app browser windows denied; plain-text detection; link menu.
**Independent test**: `terminal-links.e2e.ts` green (incl. window-open denial); `external-url.test.ts` updated.

### Tests first
- [ ] T050 [P] [US7] Update `packages/ui/tests/unit/external-url.test.ts`: `http://` now accepted, `https://` accepted, `javascript:`/`file:`/`data:` still rejected.
- [ ] T051 [P] [US7] E2E `packages/ui/tests/e2e/terminal-links.e2e.ts`: `Ctrl+click` an OSC 8 link and a plain-text URL → `shell.openExternal` intercepted, no new BrowserWindow (`app.evaluate` on `getAllWindows().length`); plain click opens nothing; link-aware menu offers Open Link/Copy Link Address only over a link with no selection; `javascript:` opens nothing.

### Implementation
- [ ] T052 [US7] Widen `isSafeExternalUrl` to `/^https?:\/\//i` in `packages/ui/src/main/external-url.ts`.
- [ ] T053 [US7] Add a shared main-process window-open deny helper and apply `webContents.setWindowOpenHandler` in every window creator in `packages/ui/src/main/main.ts` (+ about/preferences/ghost): `http(s)` → `shell.openExternal`, then `{action:'deny'}` (FR-019b).
- [ ] T054 [US7] Hoist the preload `openExternal` bridge to top-level `window.throng.openExternal` in `packages/ui/src/preload/preload.cts` + `global.d.ts`.
- [ ] T055 [US7] Override xterm `options.linkHandler.activate(event, uri)` in `packages/ui/src/renderer/terminal/use-terminal.ts`: gate on `ctrl/metaKey` (FR-019c), route `http(s)` through the hoisted bridge; add a hover affordance; load `@xterm/addon-web-links` (modifier-aware, `http(s)` only) for plain-text detection (FR-019a).
- [ ] T056 [US7] Add `getLinkAt(x,y)` to `TerminalApi` and the link-aware items ("Open Link", "Copy Link Address") to the terminal `onContextMenu` in `terminal-panel.tsx`, above Copy/Paste, only when a link is under the point and no text is selected (FR-019d).

**Checkpoint**: US7 e2e green; window-open denial verified; regression covers #159.

---

## Phase 10: Polish & cross-cutting

- [ ] T057 [P] Run the full gates (typecheck, lint, unit/integration/contract, e2e for the touched suites) and confirm no regression against the 1764-test baseline.
- [ ] T058 [P] Verify every added panel action has a menu item and shows its chord (Principle VI audit): editor Word Wrap present; terminal link items present; explorer Undo/Redo present.
- [ ] T059 [P] Audit no reserved terminal key was taken (Principle IV): `Ctrl+Alt+W`, `Shift+F10`, `ContextMenu` all clear.
- [ ] T060 Update `specs/024-editor-terminal-enhancements/checklists/requirements.md` if any decision shifted during implementation; keep the spec's clarifications authoritative.

---

## Dependencies & independent-test criteria

- **Setup (T001–T002)** and **Foundational (T003–T004)** precede the stories that use them (US2, US4 use T003).
- **Story independence**: US1, US5, US6, US7 are fully independent. US2 and US4 both depend on the T003 tree-drag seam. US3 is self-contained (its own seam + migration). US4's FR-014 (T038) edits a *different* spec file — safe any time.
- **Each story is independently testable** via its named e2e (see per-phase Independent test).

## Implementation strategy (MVP-first, risk-tiered)

1. **Quick wins first**: US5 (T039–T041, view-only) and US6 (T042–T049, mostly the 2-line menu fix + keyboard + command).
2. **Core capability**: US1 (settings + command + status bars), then US2 (needs T003).
3. **Bug + capability**: US7 (window-open denial is a real security fix).
4. **New model op**: US4 (needs T003 + the conversion op).
5. **Largest, isolate**: US3 — its own branch if the recycle-bin-restore validation runs long; nothing else depends on it.

**Suggested MVP**: US5 + US6 + US1 — three complete, independently shippable increments covering the
naming, the menu bug, and the headline word-wrap capability, with the whole settings/command/menu
infrastructure the later stories reuse.
