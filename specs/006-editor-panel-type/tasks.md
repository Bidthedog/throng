---
description: "Task list for Typed Panels — Editor Panel Type"
---

# Tasks: Typed Panels — Editor Panel Type

**Input**: Design documents from `/specs/006-editor-panel-type/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅ (D1–D14), data-model.md ✅, contracts/ ✅ (6),
quickstart.md ✅

**Tests**: INCLUDED — the constitution (Principle V, NON-NEGOTIABLE) mandates test-first Red-Green-Refactor
with unit/contract/integration layers and **passing E2E for every user-facing UI change**. Contract suites
are required for the new `IFileLock` OS seam (Principle II).

**Organization**: Tasks are grouped by the plan's **five verify-as-you-go delivery phases (A–E)** — each an
independently E2E-verified increment — with every task tagged to the spec user story it serves. This
follows the plan's dependency-driven phasing (a story like US3-save depends on the US1 editor existing), so
the delivery phase, not an isolated per-story phase, is the true independent-test boundary.

**Architecture reminder (research D2)**: the editor is **UI-main + renderer, NOT daemon-backed**. **No**
daemon change, **no** `ipc-contract` module, **no** SQLite migration (`user_version` stays 6). File I/O via
the existing `IFileSystem`; the new `IFileLock` seam + editor coordinator + recovery live in **UI main**;
the renderer reaches them via a new `editor.*` preload bridge (peer of `files.*`).

**User story legend**: US1 create editor · US2 open-from-tree · US3 save+confinement · US4 encoding/endings
· US5 active-pane gating · US6 Open-In/Send-to-Tab/Sync menus · US7 auto-save · US8 unsaved indicators+pills
· US9 unsaved-open prompt · US10 sub-workspace ownership+mirror · US11 crash recovery · US12 rename no-op fix.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1…US12 (Setup/Foundational/Polish carry no story label)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and package scaffolding.

- [x] T001 Add CodeMirror 6 deps (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`) to `packages/ui/package.json` and run `npm install` (renderer-only; no native build)
- [x] T002 [P] Create the pure core editor domain folder `packages/core/src/editor/` with an `index.ts` barrel and export it from `packages/core/src/index.ts`
- [x] T003 [P] Create the renderer editor folder `packages/ui/src/renderer/editor/` (empty barrel) and add the `packages/ui/tests/e2e/` fixtures dir note for editor specs

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared substrate every editor story needs — the Editor panel type is selectable and
dispatches to an inline CodeMirror view, the `editor.*` bridge + UI-main service/coordinator skeleton
exist, the `IFileLock` seam + `editor`/theme config land. **No story delivers value yet.**

**⚠️ CRITICAL**: No user-story phase (A–E) can begin until this phase is complete.

- [x] T004 [P] Add `EditorPanelConfig` (`filePath?`/`encoding?`/`hasBom?`/`lineEnding?`) + `EncodingId`/`LineEndingId` types and document `kind:'editor'` in `packages/core/src/workspace/model.ts` (optional fields; back-compat)
- [x] T005 [P] Create `EditorDocument` model in `packages/core/src/editor/document.ts` (panelId, ownerKind, filePath, encoding/hasBom/lineEnding, dirty, recoveryTempPath) — pure, no I/O
- [x] T006 [P] Add the `editor` settings interface + `editorSettings()` tolerant parser + `DEFAULT_APP_SETTINGS.editor` (`openOnClick:'single'`, `autoSave:false`, `autoSaveDebounceMs:500`, `saveAllScope:'project'`, `defaultLineEnding:'lf'`, `maxOpenFileBytes:10485760`) + `structuredCloneSettings` entry in `packages/core/src/config/app-settings.ts` per `contracts/config-additions.md` (the `autoSaveDebounceMs` (FR-060) and `maxOpenFileBytes` (FR-062) fields satisfy the injected-config requirement, Principle X)
- [x] T007 [P] Unit test the `editorSettings()` parser (defaults, per-field fallback, tolerant drop) in `packages/core/tests/unit/editor-settings.test.ts`
- [x] T008 [P] Add editor theme tokens (`colours.editorBg/editorFg/editorCursor/editorSelection`, shared `colours.unsavedDot`, and `colours.activePaneHighlight` for the active Files & Folders pane — FR-015/SC-006) + defaults to `packages/core/src/config/theme.ts` (emitted by `toCssVariables`) per `contracts/config-additions.md`
- [x] T009 [P] Add `editor.save` (Ctrl+S) and `editor.saveAll` (Ctrl+Shift+S) `ActionId`s + `DEFAULT_KEYBINDINGS` entries in `packages/core/src/config/keybindings.ts`
- [x] T010 [P] Create the `IFileLock` OS seam in `packages/core/src/abstractions/file-lock.ts` (`acquire(absPath)`/`release(handle)`, `LockHandle`)
- [x] T011 [P] Create the reusable `IFileLock` contract suite in `packages/core/src/testing/file-lock-contract.ts` (acquire blocks external write/delete; release restores; double-acquire/idempotent release; self-cleaning temp file) per `contracts/file-lock.md`
- [x] T012 [US1] Create `editorPanelType` descriptor (id `'editor'`, label `'Editor Panel'`, `inputs:[]`, `validate` ok when project-root-or-rootless, `buildConfig → {}`) in `packages/core/src/editor/panel-type.ts` and register it in `packages/core/src/panel-type/default-registry.ts` alongside `terminalPanelType`
- [x] T013 [US1] Contract/unit test the editor descriptor + registry (Editor+Terminal listed in stable order; validate ok with root and rootless; buildConfig `{}`; `clearPanelType` never used for editors) in `packages/core/tests/unit/editor-panel-type.test.ts` per `contracts/editor-panel-type.md`; **assert the shared selection/confirm/clear/revert flow (`panel-type-form.tsx` shared logic / `form-state.ts`) is unchanged apart from the additive `'editor'` branch — SC-016** (registry-driven, no shared-flow edit)
- [x] T014 Create the UI-main `IFileLock` binding: add `WindowsFileLock` to `packages/platform-windows/src/windows-file-lock.ts` (hold a file handle without share-write/delete — analogue of `WindowsDirectoryLock`) and export from `packages/platform-windows/src/index.ts`
- [x] T015 Run the `IFileLock` contract suite vs `WindowsFileLock` in `packages/platform-windows/tests/contract/windows-file-lock.contract.test.ts`
- [x] T016 Create the UI-main `editor-service` skeleton (load/save via injected `IFileSystem`; confinement hook) in `packages/ui/src/main/editor-service.ts` and add `FileLock`/`EditorService`/`EditorCoordinator` tokens in `packages/ui/src/main/tokens.ts`
- [x] T017 Create the UI-main `editor-coordinator` skeleton (open-document registry map; dirty/lock/recovery state) in `packages/ui/src/main/editor-coordinator.ts`
- [x] T018 Bind `IFileLock`→`WindowsFileLock`, `EditorService`, `EditorCoordinator` in `packages/ui/src/main/composition-root.ts`
- [x] T019 Create the `editor.*` ipcMain handlers skeleton (`load`/`save`/`saveAll`/`openInto`/`isOpen`/`notifyDirty`/`list`/`recover` + `onSync`/`notifySync`) in `packages/ui/src/main/editor-ipc.ts` and register it from `packages/ui/src/main/main.ts`
- [x] T020 Add the `editor.*` preload bridge (peer of `files.*`) in `packages/ui/src/preload/preload.cts` per `contracts/editor-bridge.md`
- [x] T021 [P] Add the `kind==='editor' → <EditorPanel/>` branch in `packages/ui/src/renderer/workspace/panel-body.tsx` (L36) and the `'editor'` inputs branch in `packages/ui/src/renderer/panel-type/panel-type-form.tsx` (L103)
- [x] T022 [P] Create the minimal Editor type inputs (explanatory copy, no fields) in `packages/ui/src/renderer/panel-type/editor-inputs.tsx`
- [x] T023 Mount a CodeMirror 6 plain-text view (no language extensions) in `packages/ui/src/renderer/editor/editor-panel.tsx` with `packages/ui/src/renderer/editor/editor.css` themed via `var(--throng-colour-editor*)`; expose the document lifecycle scaffold in `packages/ui/src/renderer/editor/use-editor.ts`
- [x] T024 [P] Expose `settings.editor` + editor theme tokens via `packages/ui/src/renderer/config/config-store.tsx`

**Checkpoint**: Selecting **Editor Panel** creates a dispatched, mounted (empty) CodeMirror view; the
`editor.*` bridge/service round-trip and the `IFileLock` seam are green. No save/open/indicators yet.

---

## Phase 3 — Delivery A: Editor type + editing + save + encoding/endings + active pane (US1, US3, US4, US5, US8-pills) 🎯 MVP

**Goal**: A usable editor — create → type → **Ctrl+S** (confined) → encoding/endings preserved →
**Ctrl+Shift+S** scoped Save-All → Files-pane active gates Ctrl+S → dirty file locked → type + filename
pills.

**Independent Test**: Create an Editor Panel, type into a new doc, Ctrl+S under the project root (out-of-tree
refused), edit a CRLF+BOM file and confirm bytes preserved, Ctrl+Shift+S saves the scoped set, clicking the
Files pane makes Ctrl+S a no-op, and an external write to a dirty file is blocked.

### Tests for Delivery A (write first, must fail)

- [x] T025 [P] [US4] Unit test text fidelity (UTF-8±BOM + CRLF/LF/CR detect + round-trip byte-identical on single-line edit; new-doc defaults) in `packages/core/tests/unit/text-fidelity.test.ts` per `contracts/text-fidelity.md`
- [x] T026 [P] [US3] Unit test confinement (`isWithinTree`, `isOutsideAllProjects`, `resolveSaveConfinement`) in `packages/core/tests/unit/confinement.test.ts`
- [x] T027 [P] [US3] Unit test Save-All scope resolution (tab/project/all → panelIds; skip+report unpathed; **sub-workspace-owned editors are in scope only for `tab`, never `project`/`all`** — FR-023) in `packages/core/tests/unit/save-scope.test.ts`
- [x] T028 [P] [US3] Integration test `editor-service` save round-trip (encoding/BOM/CRLF/LF preserved; out-of-tree refused; new-doc defaults; **and a save whose target no longer exists / is not writable fails clearly leaving the buffer unsaved** — FR spec edge "save target becomes invalid") on a real temp file in `packages/ui/tests/integration/editor-service-save.integration.test.ts`
- [x] T029 [P] [US3] Integration test the dirty-file lock (via `IFileLock`): it blocks an external write while dirty and releases on save; **and asserts a clean or unpathed document holds NO lock** (SC-020's second arm) in `packages/ui/tests/integration/editor-dirty-lock.integration.test.ts`
- [x] T030 [P] [US1] E2E `packages/ui/tests/e2e/editor-basics.e2e.ts` — create editor, type, two editors independent; Ctrl+S in-tree writes / out-of-tree refused; Ctrl+Shift+S scope; CRLF/BOM/LF preserved; new-doc `defaultLineEnding`; Files-pane active → Ctrl+S no-ops; external write blocked while dirty; type + `filename (relFolder)` pills; **the active Files & Folders pane is visibly highlighted** (SC-006)

### Implementation for Delivery A

- [x] T031 [P] [US4] Implement pure text fidelity (`detectEncoding`/`decode`/`detectLineEnding`/`encode`/`newDocumentDefaults`) in `packages/core/src/editor/text-fidelity.ts`
- [x] T032 [P] [US3] Implement confinement predicates in `packages/core/src/editor/confinement.ts`
- [x] T033 [P] [US3] Implement Save-All scope resolution in `packages/core/src/editor/save-scope.ts`
- [x] T034 [US3][US4] Implement `editor-service.load`/`save` (read raw bytes via `IFileSystem` → decode; encode preserving encoding/ending; enforce confinement; refuse out-of-tree; new-doc chooser constrained) in `packages/ui/src/main/editor-service.ts` per `contracts/editor-service.md`
- [x] T035 [US3] Implement `editor.saveAll` (resolve scope, save pathed, skip+report unpathed) in `editor-service.ts` + `editor-ipc.ts`
- [x] T036 [US3][US4] Wire `use-editor.ts` load/edit/dirty/save through the `editor.*` bridge; acquire/release the dirty-file lock via `editor.notifyDirty` in `packages/ui/src/renderer/editor/use-editor.ts` + `editor-coordinator.ts`
- [x] T037 [US1] On confirming the Editor type, create a **new empty in-memory document** (no filePath) and render it editable in `editor-panel.tsx`; support multiple concurrent instances
- [x] T038 [US5] Create the active-pane context (`Files & Folders` vs workspace Panel) in `packages/ui/src/renderer/workspace/active-pane.tsx`; highlight the Files pane on click (themeable) and follow Panel focus (reuse `ws.setActivePanel`)
- [x] T039 [US5] Gate **all panel-scoped shortcuts** (`editor.save`/`editor.saveAll` **and** terminal/editor panel keys — FR-016) in `packages/ui/src/renderer/app.tsx` `KeybindingsHandler` on the active pane being a workspace Panel; register the two editor ActionIds' handlers (terminal keys are already delivered to the focused xterm view, which does not receive focus while the Files pane is active)
- [x] T040 [US8] Render the **type pill** + **`filename (relative folder)` file pill** (reuse the terminal-flavour pill style) in `packages/ui/src/renderer/workspace/panel-placeholder.tsx`; new/unsaved docs show a placeholder name
- [x] T041 [US3] Add the project-tree save-location chooser (constrained to the allowed tree) for a new/unpathed doc, wired from `use-editor.ts` → `editor.save`
- [x] T085 [US3] Handle an **invalid save target** (target vanished or not writable at save time): `editor-service.save` returns `reason:'io'`, the renderer surfaces it clearly, and the buffer stays **unsaved** (never silent loss) — spec edge "save target becomes invalid" (asserted in T028)
- [x] T086 [US1] Surface a **clean file deleted/moved on disk** externally: once a document is clean (lock released), if its backing file disappears, `use-editor.ts` marks a subsequent edit as unsaved-against-a-missing-target rather than overwriting silently or losing the buffer — spec edge "file deleted/moved on disk while clean" (+ integration assertion in `editor-service-save.integration.test.ts`)

**Checkpoint**: Delivery A E2E green. Editors create, edit, save (confined, encoding/endings preserved),
Save-All by scope, respect the active pane, lock dirty files, and show type + file pills. **Note**: US1
Acceptance Scenario 4 (persist+restore an **unsaved** new document) depends on recovery temp files and is
therefore acceptance-verified in **Delivery E** (T069/T076); Delivery A verifies US1's create/edit/save/
multi-instance behaviour.

---

## Phase 4 — Delivery B: Open from tree + one-buffer + unsaved-open prompt + rename fix (US2, US9, US12)

**Goal**: Open files from Files & Folders into the last active editor per `openOnClick`; Enter opens (never
renames); app-wide one buffer per file; the four-choice unsaved-open prompt; the rename-no-op fix.

**Independent Test**: Click/Enter opens per setting (folder never opens, Enter never renames); opening an
already-open file focuses the one editor and disables Open-In for it; opening into a dirty editor shows the
four choices; confirming a rename with an unchanged name shows no error and does nothing.

### Tests for Delivery B (write first, must fail)

- [x] T042 [P] [US2] Unit test the open-document registry (`openOrFocus`/`isOpenAnywhere`: focus-existing, no duplicate) in `packages/core/tests/unit/open-registry.test.ts`
- [x] T043 [P] [US2] Integration test app-wide one-buffer across **two BrowserWindows** (second open focuses the first) in `packages/ui/tests/integration/editor-one-buffer.integration.test.ts`
- [x] T044 [P] [US2][US9] E2E `packages/ui/tests/e2e/editor-open.e2e.ts` — openOnClick single/double/none; Enter opens (never renames); folder no-op; already-open focuses one editor + Open-In disabled; unsaved-open four-choice each behave
- [x] T045 [P] [US12] E2E `packages/ui/tests/e2e/rename-noop.e2e.ts` — confirming a rename with an unchanged name shows no error and leaves the item unchanged; a changed valid name still renames

### Implementation for Delivery B

- [x] T046 [P] [US2] Implement the pure open-document registry logic in `packages/core/src/editor/open-registry.ts`
- [x] T047 [US2] Implement `editor.openInto`/`editor.isOpen` in `editor-coordinator.ts` (app-wide registry; focus/raise the existing editor window+Panel; ownership check FR-036) + `editor-ipc.ts`
- [x] T048 [US2] Track the **last active editor per tab** and wire the explorer `throng:open-file` intent → last active editor (create the tab's **single dedicated** editor only if none exists — never auto-create a second, FR-010; a subsequent open reuses it) in `packages/ui/src/renderer/editor/editor-open.ts`; assert the auto-create-only-one invariant in `editor-open.e2e.ts`
- [x] T049 [US2] Honour `editor.openOnClick` (single/double/none) for mouse activation in `packages/ui/src/renderer/explorer/file-tree.tsx` + `tree-node.tsx`
- [x] T050 [US2][US12] In `packages/ui/src/renderer/explorer/use-explorer-data.ts`: make **Enter open** a highlighted file (not `edit()`), never rename; folders never open; and **no-op** `onRename` when the new name equals the old (FR-070)
- [x] T051 [US12] Belt-and-braces in `packages/ui/src/main/files-service.ts` `rename()`: treat `dest === src` (unchanged name) as a success no-op so the exists-check never wrongly errors
- [x] T052 [US9] Implement the four-choice unsaved-open prompt (discard / save+open / keep+open-in-new / cancel) naming the editor+file, orchestrated in `editor-open.ts` (reuse `confirm-dialog.tsx`); "keep+open-in-new" creates a new Editor Panel
- [x] T053 [US2] Disable **Open In** targets for a file already open in an editor (query `editor.isOpen`) — wiring hook consumed by the Phase-D menu (leave the menu build to T064)
- [x] T087 [US2] Handle a **non-text / binary file**: `editor-service.load` detects an undecodable file and returns a "cannot open as text" indication that the editor renders gracefully (no corrupted buffer); rich/binary editing stays out of scope — spec edge "binary / non-text file opened" (unit test in `packages/core/tests/unit/text-fidelity.test.ts` for the detect path + E2E arm in `editor-open.e2e.ts`)
- [x] T088 [US2] Handle a **very large file**: `editor-service.load` reports a too-large indication when the file exceeds the injected **`editor.maxOpenFileBytes`** setting (FR-062; default 10 MiB, never hardcoded — Principle X), else opens responsively, so opening never hangs the UI — spec edge "very large file" (integration assertion in `editor-service-save.integration.test.ts` + E2E arm)

**Checkpoint**: Delivery B E2E green. Files open from the tree into the last active editor per setting;
one buffer per file app-wide; unsaved-open prompt works; rename no-op fixed.

---

## Phase 5 — Delivery C: Unsaved indicators + auto-save (US8, US7)

**Goal**: The shared themeable red dot on Panel/Tab/project (replacing the loaded dot); debounced auto-save.

**Independent Test**: Editing shows the red dot on panel/tab/project; save/discard clears all; the loaded
dot is gone (unloaded projects keep greyed italics); auto-save off keeps pending, on writes within the
debounce respecting confinement.

### Tests for Delivery C (write first, must fail)

- [x] T054 [P] [US8] Unit test unsaved aggregation (`panelUnsaved`/`tabUnsaved`/`projectUnsaved`) in `packages/core/tests/unit/indicators.test.ts`
- [x] T055 [P] [US8][US7] E2E `packages/ui/tests/e2e/editor-indicators.e2e.ts` — edit → red dot on panel/tab/project; save/discard clears; loaded dot gone; all dots one style; auto-save off pending vs on writes debounced (confined)

### Implementation for Delivery C

- [x] T056 [P] [US8] Implement unsaved aggregation in `packages/core/src/editor/indicators.ts`
- [x] T057 [US8] Render the unsaved dot on the Panel (right of name, before pills) in `panel-placeholder.tsx` and on the Tab (between name and panel count) in `packages/ui/src/renderer/workspace/tab-group.tsx`, styled via `--throng-colour-unsavedDot` (one shared class in `theme.css`)
- [x] T058 [US8] In `packages/ui/src/renderer/sidebar/projects-panel.tsx`: **remove** the `project-item__loaded` dot and render the unsaved dot in its place (keep `project-item--unloaded` greyed italics with no dot)
- [x] T059 [US7] Implement debounced auto-save in `use-editor.ts` (on edit-settle when `editor.autoSave` on, using the injected **`editor.autoSaveDebounceMs`** — never a hardcoded interval, Principle X; respect confinement; skip writing an unpathed doc until a location is chosen); toggling takes effect without restart

**Checkpoint**: Delivery C E2E green. Unsaved dots aggregate/clear across panel/tab/project; auto-save works.

---

## Phase 6 — Delivery D: Open In / Send to Tab / unified Sync menus + destroy prompt (US6, US1-lifecycle/FR-006a)

**Goal**: The Open In submenu, Send to Tab → New Tab on every panel, a shared Sync-to-Sub-workspace cascade
across panel types, and the save/discard/cancel prompt on destroying a dirty editor/tab/project.

**Independent Test**: Open In shows the three groups (only current-project targets, OS-Explorer moved under
it); Send to Tab → New Tab == drag onto `+`; Editor & Terminal Sync menus share shape; destroying a dirty
editor/tab/project prompts save/discard/cancel and cancel is a no-op.

### Tests for Delivery D (write first, must fail)

- [x] T060 [P] [US6] E2E `packages/ui/tests/e2e/editor-menus.e2e.ts` — Open In groups + current-project-only + OS-Explorer under it; Send to Tab → New Tab equals drag-onto-`+`; Editor & Terminal Sync cascades identical; disabled Open-In for an open file
- [x] T061 [P] [US1] E2E arm in `editor-menus.e2e.ts` — destroying a dirty editor Panel, a Tab with dirty editors, prompts save/discard/cancel; cancel leaves everything unchanged

### Implementation for Delivery D

- [x] T062 [US6] Extract a **shared panel-menu builder** (Sync-to-Sub-workspace cascade + Send to Tab) into `packages/ui/src/renderer/workspace/panel-context-menu.ts`, reused by both panel types; refactor `panel-placeholder.tsx` (L211-270) and the terminal path to consume it (DRY)
- [x] T063 [US6] Add **Send to Tab → New Tab** to the shared builder, invoking `ws.addTabFromPanel` (005 FR-027) — same result as dropping on the tab-strip `+`; the target is always within the **current project** (an editor is never sent into another project — FR-035 ownership guard from T072)
- [x] T064 [US6] Add the **Open In** submenu to `packages/ui/src/renderer/explorer/context-menu-items.ts`: **OS File Explorer** (move the existing reveal item under it), **Editor Here** (New / existing editors of the active tab), **Other Tab** (each tab → New / existing) — current-project targets only; disable entries for a file already open (T053)
- [x] T065 [US1] Implement the dirty-destroy **prompt** (save/discard/cancel, naming files) in `panel-placeholder.tsx` for a dirty editor Panel and a Tab with dirty editors, reusing `confirm-dialog.tsx` `warningMessage`; save honours confinement, cancel aborts (FR-006a)

**Checkpoint**: Delivery D E2E green. Menus unified across panel types; deliberate destroy of dirty editors
is guarded.

---

## Phase 7 — Delivery E: Sub-workspace ownership + project-panel mirror + crash recovery (US10, US11)

**Goal**: Synced project editors mirror one document across views; sub-workspace-owned editors save outside
all projects; the project-overlap creation block; recovery temp files restore unsaved content on launch.

**Independent Test**: A synced editor edits one buffer across two windows; a sub-ws-owned editor saves only
outside projects; creating a project over a sub-ws editor's file is blocked with save-and-close; closing the
app with unsaved editors restores them on reopen; temp removed on full save.

### Tests for Delivery E (write first, must fail)

- [x] T066 [P] [US10] Unit test the sub-workspace save rule + project-overlap detection (`projectRootWouldContainOpenEditor`) in `packages/core/tests/unit/overlap.test.ts` and `confinement` sub-ws arm
- [x] T067 [P] [US11] Integration test recovery write/restore/cleanup (write temp → simulate relaunch → restore content by panelId → delete temp on save) in `packages/ui/tests/integration/editor-recovery.integration.test.ts`
- [x] T068 [P] [US10] E2E `packages/ui/tests/e2e/editor-subworkspace.e2e.ts` — synced project editor mirrors one document (content+dirty) across two windows; sub-ws-owned editor saves outside projects & refuses project trees; project-overlap block with save-and-close instruction; destroy-in-project removes the sub-ws copy (one-directional)
- [x] T069 [P] [US11] E2E `packages/ui/tests/e2e/editor-recovery.e2e.ts` — close app with unsaved editors (no warning) → reopen restores in-progress content; full save removes the temp; temp never shows an unsaved dot; destroying a dirty project/sub-workspace prompts (FR-006a arm)

### Implementation for Delivery E

- [x] T070 [P] [US10] Implement the project-overlap detector in `packages/core/src/editor/overlap.ts` and the sub-workspace save-rule arm in `confinement.ts`
- [x] T071 [US10] Implement the cross-window editor **mirror**: `editor.notifySync`/`onSync` relay (content + dirty, no echo) in `editor-coordinator.ts` + the listener `packages/ui/src/renderer/workspace/editor-sync.tsx` (sibling of `panel-state-sync`), mounted per window; one `EditorDocument` per `panelId`
- [x] T072 [US10] Sub-workspace-owned editor flow + **cross-project enforcement (FR-035)**: resolve ownership via existing `ownedBySub`; enforce the outside-all-projects save rule in `editor-service`; block loading a project's file into another project / sub-ws editor (FR-036); and **explicitly guard the editor move paths** — verify the inherited 005 same-project reattach constraint covers **drag**, and add an ownership check to the shared **Send-to-Tab** (T063) and **Sync** (T062) builders so an editor Panel can never be moved/sent/synced into another project (not merely a different tab/sub-workspace of its own project). T089 asserts this end-to-end.
- [x] T073 [US10] Add the **project-creation overlap guard** (FR-038) in the UI-main project-create path: block/defer when the new root would contain a file open in a sub-ws-owned editor, instructing save-and-close
- [x] T074 [US1] Extend the dirty-destroy prompt (T065) to **deleting a project or sub-workspace** with dirty editors (UI-main delete guards + confirm), completing FR-006a
- [x] T075 [US11] Implement `packages/ui/src/main/editor-recovery.ts` — debounced write of open-doc content to `%APPDATA%\throng\recovery\<panelId>` (independent of auto-save); not a dirty signal (FR-053)
- [x] T076 [US11] Implement launch-time reconciliation in `editor-coordinator.ts`/`main.ts`: restore in-progress content for persisted editor Panels (match by panelId), delete temps for saved/closed docs (FR-042/043); wire `editor.recover`
- [x] T077 [US11] Ensure **no unsaved-editor warning on app close** (FR-040) — editor content is protected by recovery, distinct from the terminal running-process app-close prompt (unchanged)
- [x] T089 [US10] Verify the **cross-project restriction** (FR-035 / SC-021): an editor Panel belonging to a project **cannot** be dragged, **Send-to-Tab**'d, or **Synced** into another project — assert the refusal in `packages/ui/tests/e2e/editor-subworkspace.e2e.ts` (and a unit assertion on the ownership guard reused from T072); an editor reaches a sub-workspace only via the sync menu, never another project

**Checkpoint**: Delivery E E2E green. Sub-workspace mirror + ownership + overlap block + crash recovery all
work; all five phases complete.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation currency (constitution v3.10.0 merge gate), validation, and hygiene.

- [x] T078 [P] Persistence read-only test asserting `user_version` stays **6** (no migration) in `packages/persistence/tests/integration/no-editor-migration.integration.test.ts`
- [x] T079 [P] Confirm the core purity guard (`packages/core/tests/unit/no-os-imports.test.ts`) still passes with the new `core/editor/*` + `panel-type/editor` modules (no `node:*`/DOM)
- [x] T080 [P] Update `README.md` — add the editor-panel capability to the current shipped-state description (plain-text editor; no per-feature narration)
- [x] T081 [P] Update `ROADMAP.md` — mark "Rich code editors" as **plain-text editor panels delivered**; keep syntax highlighting / language features / Markdown preview as planned
- [x] T082 [P] Update `CONTRIBUTING.md` if the toolchain changed (CodeMirror dep; editor E2E specs) — else confirm no change needed
- [x] T083 Run `quickstart.md` end-to-end (all five phases) and confirm each phase's E2E is observed green (Principle V)
- [x] T084 Remove any scratch/temp test artifacts; confirm recovery-temp and lock tests self-clean (constitution v3.9.0)

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → no deps.
- **Foundational (P2)** → depends on Setup; **BLOCKS all delivery phases** (the editor type, view, bridge,
  service, lock seam, and config must exist first).
- **Delivery A (P3)** → depends on Foundational. The **MVP**.
- **Delivery B (P4)** → depends on A (needs a working editor to open files into) + the open-registry.
- **Delivery C (P5)** → depends on A (dirty state) — independent of B.
- **Delivery D (P6)** → depends on A (panels/menus) and B (T053 open-file disabling) — independent of C.
- **Delivery E (P7)** → depends on A–B (documents, registry) and reuses D's confirm/prompt (T065→T074).
- **Polish (P8)** → after the desired delivery phases.

### Within a phase

- Tests (unit/contract/integration/E2E) are written **first and must fail** (RGR), then implementation.
- Core pure logic (encoding, confinement, registry, indicators, overlap) before the UI-main service before
  the renderer wiring.

### Parallel opportunities

- Setup T002/T003 in parallel; Foundational T004–T011 (+T021/T022/T024) are largely `[P]` (different files).
- Within each delivery phase, the `[P]` test tasks run together, and the pure-core `[P]` implementations
  (text-fidelity/confinement/save-scope; open-registry; indicators; overlap) run together before their
  UI-main/renderer consumers.
- Delivery C and D can proceed in parallel once A (and B's T053 for D) is done.

---

## Parallel Example: Delivery A

```bash
# Tests first (parallel — different files):
Task: "Unit test text fidelity in packages/core/tests/unit/text-fidelity.test.ts"           # T025
Task: "Unit test confinement in packages/core/tests/unit/confinement.test.ts"                # T026
Task: "Unit test Save-All scope in packages/core/tests/unit/save-scope.test.ts"              # T027
Task: "Integration test editor-service save round-trip"                                      # T028

# Then pure-core implementations (parallel — different files):
Task: "Implement text-fidelity.ts"                                                           # T031
Task: "Implement confinement.ts"                                                             # T032
Task: "Implement save-scope.ts"                                                              # T033
```

---

## Implementation Strategy

### MVP first (Delivery A)

1. Phase 1 Setup → Phase 2 Foundational (editor selectable + mounted + bridge/service/lock + config).
2. Phase 3 Delivery A → **STOP & VALIDATE** (`editor-basics.e2e.ts` green): create/edit/save (confined),
   encoding/endings, Save-All scope, active-pane gating, dirty lock, pills. This is a demoable MVP.
   **Scope note**: US2 (open-file-from-tree) is a **P1** story but intentionally lands in **Delivery B** —
   it depends on the working editor from Delivery A — so the A increment is a demoable editor without the
   tree-open path yet. **Crash-recovery is not active until Delivery E** (T075/T076): in increments A–D an
   unsaved editor closed by app restart is not yet restored (an accepted intra-feature gap — the feature is
   complete only after E; US1 AS4's unsaved-restore is verified there).

### Incremental delivery

3. Delivery B (open-from-tree + one-buffer + prompt + rename fix) → validate → demo.
4. Delivery C (indicators + auto-save) → validate → demo.
5. Delivery D (unified menus + destroy prompt) → validate → demo.
6. Delivery E (sub-workspace mirror + ownership + recovery) → validate → demo.
7. Phase 8 polish + docs currency before merge.

Each delivery phase lands **green (unit/contract/integration + E2E)** before the next begins (Principle V,
Incremental Delivery). The daemon, `ipc-contract`, and SQLite schema are never touched.

---

## Notes

- `[P]` = different files, no incomplete-task dependency.
- Every user-story task carries its `[USn]` label; Setup/Foundational/Polish carry none.
- Verify tests fail before implementing; commit after each task or logical group.
- The editor is **UI-main + renderer** — no daemon/`ipc-contract`/migration work appears anywhere by design
  (research D2). `user_version` stays 6 (T078).
- **Terminology**: "**rootless**" (used in `PanelTypeContext`/`validate`, T012) is the code alias for a
  **sub-workspace-owned** editor — a Panel with no owning project root. The two terms are the same concept.
- Docs currency (README/ROADMAP/CONTRIBUTING) is part of the definition of done (T080–T082), not optional.
- **Edge-case / cross-project tasks T085–T089** were appended after the analyze pass; execute them **within
  their labelled delivery phase** despite the higher IDs — T085/T086 in Delivery A, T087/T088 in Delivery B,
  T089 in Delivery E (they close the binary-file, large-file, deleted-while-clean, invalid-save-target, and
  cross-project-restriction spec edges / FR-035). Total tasks: **89** (T001–T089).

---

## Phase 9 — Post-Delivery-E feedback (Session 2026-07-05b, FR-071–078)

User feedback after Delivery E; spec-first (new Clarifications session + FR-071–078), TDD, implemented.

- [x] T090 [US5] Active-pane highlight renders ABOVE the tree selection box (FR-071): overlay `::after`
  border in `panes.css` (z-index + pointer-events:none); asserted in `editor-basics.e2e.ts`
- [x] T091 [US2] "Open In → New Editor" target forcing a new dedicated editor Panel, disabled when the file
  is already open (FR-072/FR-011a): `openFileInNewEditor` + `file-tree.tsx`; `editor-feedback.e2e.ts`
- [x] T092 `editor.autoSaveDebounceMs` default 300 ms (FR-073): `app-settings.ts` + `editor-settings.test.ts`
- [x] T093 [US8] Themeable editor & terminal fonts (FR-074, default Consolas 14px): `theme.ts` typography
  roles `editor`/`terminal`; editor `.cm-scroller` + xterm `fontFamily/fontSize`; `editor-feedback.e2e.ts`
  (editor) + `terminal-font.e2e.ts` (confirms terminals ARE app-stylable)
- [x] T094 [US1] Editor Panel "Revert" (discard all changes, with confirmation, FR-075): `use-editor.revert`
  + `panel-placeholder.tsx` menu; `editor-feedback.e2e.ts`
- [x] T095 [US3] Editor Panel header "Save" menu item (== Ctrl+S, FR-076): `panel-placeholder.tsx`;
  `editor-feedback.e2e.ts`
- [x] T096 [US10] Sub-workspace-owned editor can save (outside all projects) + be destroyed (FR-077):
  shared `EditorChrome` (keybindings + dialogs) mounted in `subworkspace-app.tsx`; context-aware
  `editor-inputs.tsx` copy; `editor-subworkspace-owned.e2e.ts`
- [x] T097 [US3] Visible save-refusal message (FR-078): `editor-notice-store`/`-dialog` +
  `use-editor` reportSaveError; `editor-feedback.e2e.ts`

Total tasks: **97** (T001–T097).

---

## Phase 10 — Startup fix + feedback batch 2 (Session 2026-07-06)

- [x] T098 FIX startup "does nothing" on multi-monitor: fresh window centres on the PRIMARY display;
  IDisplayInfo.primaryBounds()/centerOnPrimary(); single-instance recovers a lost window onto a visible
  display. Display unit + contract tests.
- [x] T099 [US2] "Editor Here" → "This editor"; disabled when open in the target editor (FR-082);
  editor-feedback2.e2e + editor-menus updated
- [x] T100 [US2] "New Folder" in the Files & Folders context menu (FR-086); editor-feedback2.e2e
- [x] T101 Ctrl-drag copy cursor on the tree's internal move/copy (FR-081); in-tree drop onto the same
  folder is a no-op, not an "already exists" error (FR-080); files-move-same-folder integration test
- [x] T102 [US3] Save dialog defaults the file-name to the Panel name (FR-083); refusal message applies to
  unpathed saves; editor-feedback2.e2e
- [x] T103 [US3] "Save As" — editor-header menu item + Ctrl+Alt+S (FR-084); editor-feedback2.e2e
- [x] T104 [US8] Editor file pill shows the folder in brackets (truncated first); owner text right-aligned +
  always visible (FR-085)
- [x] ~~T105 [US2] Drag a file from the tree into a new editor Panel (FR-079)~~ — **WITHDRAWN 2026-07-06**:
  not supported (incompatible drag systems); "Open In" menu covers it. Moved to Out of Scope.

Total tasks: **104** delivered (T001–T104); FR-079/T105 withdrawn.

---

## Phase 11 — Feedback batch 3 (Session 2026-07-06b)

- [x] T106 [US10] Owner (project/sub-workspace) text right-aligned beside the panel controls in every
  window (FR-087); panel-owner-align.e2e
- [x] T107 [US8] Editor pill always shows the containing folder in brackets — subfolder path, or the
  project folder name for a root file (FR-088); editor-feedback3.e2e
- [x] T108 Context menus stay fully on-screen — flip left/up near edges, then clamp; all menus, all windows
  (FR-089); editor-feedback3.e2e
- [x] T109 Inline tree rename commits on blur (click-away = Enter), Escape still cancels (FR-090);
  editor-feedback3.e2e
- [x] T110 Drag highlights the destination folder in the tree via react-arborist willReceiveDrop (FR-091).
  NOTE: mid-drag visual state is not reliably testable through Playwright's atomic HTML5-drag simulation —
  verified by construction (tracked coverage gap, like @admin-gated tests).
- [x] T111 Live copy/move drag cursor — Ctrl → copy (+), else move; updates as the modifier is
  pressed/released mid-drag (FR-092). Same Playwright HTML5-drag limitation as T110; copy-vs-move logic is
  core-tested (resolveDragEffect).

Total tasks: **111** delivered (T001–T111; FR-079/T105 withdrawn).

---

## Phase 12 — Feedback batch 4 (Session 2026-07-06c)

- [x] T112 [US8] Editor pill shows the fully-qualified path (project-relative "/…/" or absolute for
  sub-ws), per two new `editor.` settings projectPathDisplay/subWorkspacePathDisplay ('full'|'name',
  default full) (FR-088); pure editorPathParts + unit tests; editor-feedback3.e2e; settings parser + test
- [x] T113 Inline rename selects only the name stem, not the extension (FR-093); editor-feedback3.e2e
- [x] T114 FIX multi-select delete removes ALL selected files AND folders — files-service.delete is now
  resilient (existence-first, continue past failures, ENOENT = no-op, report once) (FR-094);
  files-delete-mixed integration (4) + delete-mixed.e2e (3)

Total tasks: **114** delivered (T001–T114; FR-079/T105 withdrawn).

---

## Phase 13 — Feedback batch 5 (Session 2026-07-06c)

- [x] T115 Windows-style, user-configurable drag modifiers — Ctrl=copy / Shift=move by default; live cursor
  via a window-level dragover override of react-dnd's Alt behaviour; two new explorer. settings
  dragCopyModifier/dragMoveModifier (FR-095). resolveDragEffect(config) + settings parser unit-tested.
  NOTE: the native drag cursor is not observable through Playwright's HTML5-drag simulation — the resolver +
  settings are unit-tested; wiring verified by construction (tracked coverage gap).
- [x] T116 [US3] "New File" context-menu action — creates an empty file under the target (folder→inside,
  file→parent) and enters inline rename (FR-096); files-service.newFile integration + explorer-new-items.e2e
- [x] T117 [US3] Right-clicking empty space in the Files & Folders pane opens a root-targeted menu (New File
  / New Folder / Paste / Open in file explorer) (FR-097); explorer-new-items.e2e

Total tasks: **117** delivered (T001–T117; FR-079/T105 withdrawn).

---

## Phase 14 — Feedback batch 6 (Session 2026-07-06d)

- [x] T118 [US2] "This editor" Open-In target relabelled "Last Active Editor (<Panel name>)" (FR-098);
  editor-file-deleted.e2e + editor-menus/feedback2 updated
- [x] T119 [US7] Deleting a file open in an editor marks it dirty + keeps the buffer; save re-creates the
  file at its original path; destroy uses the dirty prompt (FR-099). Coordinator.markDeleted +
  fileMissing flag + files-service onDeleted wiring; editor-file-deleted integration (4) + e2e
- [x] T120 [US7] "Cannot open file" dialog names the file + panel, explains moved/renamed/deleted with the
  save-to-recover option, and re-appears on every tab selection while missing (FR-100); editor-file-deleted.e2e

Total tasks: **120** delivered (T001–T120; FR-079/T105 withdrawn).

---

## Phase 15 — Feedback batch 7 (Session 2026-07-06e)

- [x] T121 OS-native path separators everywhere paths are shown — pill, hover title, dialogs (FR-101).
  Pure core toDisplayPath(path, os) + editorPathParts(os); host OS exposed via preload window.throng.osName;
  path-display unit tests + editor-feedback3.e2e title/pill assertions
- [x] T122 [US11] A deleted-file editor restores its last content (dirty buffer / last-loaded), not blank —
  recovery temp written promptly on deletion and used on load-fail (FR-102); editor-file-deleted integration
  (recovery-temp-immediately) + e2e (restart restore)

Total tasks: **122** delivered (T001–T122; FR-079/T105 withdrawn).

---

## Phase 16 — Feedback batch 8 (Session 2026-07-06e)

- [x] T123 Remove the dirty-file lock (FR-103): delete IFileLock seam + WindowsFileLock + the file-lock
  contract; strip acquire/release from the coordinator; drop the `locked` field. It no longer blocks
  external tools writing an open file.
- [x] T124 Replace it with soft external-change detection (revised FR-028): coordinator watches each open
  doc's folder — clean editor live-reloads, dirty editor shows a one-shot "changed on disk" notice, a
  vanished file routes through FR-099. editor-external-change integration (3) + editor-basics.e2e updated.
- [x] T125 Per-user data under %APPDATA%\throng (FR-104): app.setName('throng') before any getPath so
  recovery temps + window state sit alongside throng.db. Verified userData resolves to %APPDATA%\throng.

Total tasks: **125** delivered (T001–T125; FR-079/T105 withdrawn).

---

## Phase 17 — Feedback batch 9 (Session 2026-07-06f)

- [x] T126 Aggregate the "Cannot open file" dialog: ALL missing files on a (re-)opened tab appear in ONE
  dialog (FR-100); single-file keeps the detailed message. editor-missing-notice helper; editor-state gains
  fileMissing; editor-missing-aggregate.e2e.
- [x] T127 [US11] Raise the popup from a TAB-activation watcher (MissingFileWatcher in EditorChrome), not
  per-editor mount — so a panel drag/move (remount without a tab change) NEVER re-warns (FR-105);
  editor-missing-aggregate.e2e (delete/remount = no popup).
- [x] T128 New setting editor.warnOnMissingFile (default true) to disable the popup (FR-105); missing-file
  editors then restore silently. Core setting + parser + unit tests; editor-missing-aggregate.e2e.

Total tasks: **128** delivered (T001–T128; FR-079/T105 withdrawn).

---

## Phase 18 — Feedback batch 10 (Session 2026-07-06g)

- [x] T129 Re-pointing an editor at a different file deletes the old file's recovery temp (awaited) so a
  stale temp can't be restored over the new file on the next launch (FR-106); editor-recovery-stale.e2e
  (2-session).
- [x] T130 Regression guard: "Open in New Editor" from the unsaved-changes prompt (with a dirty
  deleted-file editor active) opens the CLICKED file, not another file; editor-open-new-after-dirty.e2e
  (tree-delete + external-delete variants). NB: the reported "opens CLAUDE.md" could not be reproduced in
  the current build — this test pins the correct behavior.

Total tasks: **130** delivered (T001–T130; FR-079/T105 withdrawn).

---

## Phase 19 — Feedback batch 11 (Session 2026-07-06g)

- [x] T131 Consistent OS reveal: a single top-level "Open in OS File Explorer" for BOTH files and folders;
  removed the duplicate inside the file "Open In" submenu (which now holds only editor targets) (FR-107);
  editor-menus/explorer/explorer-new-items e2e updated.
- [x] T132 Create-project "Browse" button is project-neutral — dropped the stale duplicate CSS whose hover
  used the active project's --accent; project-browse-neutral.e2e.

- [x] T133 Renaming a project updates its name live on sub-workspace panels in OTHER windows —
  cross-window throng:projects:changed broadcast + projects-store subscribe/notify; project-rename-subworkspace.e2e.
- [x] T134 Project name capped at 120 chars while typing (maxLength on the inline + form inputs); a rejected
  rename keeps the inline editor OPEN (no lost edits) instead of closing; project-rename-guard.e2e.

- [x] T135 Periodic non-destructive terminal repaint (visible terminals only, every 2s) to self-heal stale
  xterm render artifacts without touching content/scroll/cursor/focus (FR-109); terminal-refresh.e2e.

Total tasks: **135** delivered (T001–T135; FR-079/T105 withdrawn).
