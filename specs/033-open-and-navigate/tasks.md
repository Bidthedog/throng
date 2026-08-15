---

description: "Task list for feature 033 — Open and navigate"
---

# Tasks: Open and navigate — Quick Open, Go To Line, and menus you can read

**Input**: Design documents from `/specs/033-open-and-navigate/`

**Prerequisites**: [spec.md](./spec.md) (75 FRs, 16 SCs, 5 user stories), [plan.md](./plan.md),
[research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/),
[quickstart.md](./quickstart.md), `.specify/memory/constitution.md` **v4.7.0**

**Tests**: Test tasks are **mandatory** here. Principle V (Test-First Quality Discipline) is
NON-NEGOTIABLE in this repository, and the spec requires it in sixteen success criteria. Every
behavioural task is preceded by a task that writes its test and **records the failure**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: may run concurrently with the other `[P]` tasks in the same unbroken block. Every `[P]`
  task names the exact files it writes, and no two `[P]` tasks in one block name the same file.
- **[Story]**: US1–US5. Setup, Foundational, Settings and Polish phases carry no story label.
- Every task names the files it creates or edits, `[P]` or not.

## How to read a task in this list

1. **The Red step is an act, not an intention.** A task that says "RED" is finished only when the
   named command has been run and its failure output captured. Follow the `running-tests` skill:
   capture once, parse the capture. A Red that was not observed is not a Red.
2. **A new E2E spec is registered by the very next task.** `packages/ui/tests/unit/shard-plan.test.ts`
   fails the unit layer the moment a `*.e2e.ts` file exists in no shard group, so the registration
   task always sits immediately after the task that creates the file — never later in the phase.
   That is also why the spec-creation tasks are **not** `[P]`: their registration tasks all write
   `shard-plan.json` and `parallel-plan.json`, so the block would collide on those two files.
3. **The test layers are the four this repository actually has** — `unit`, `integration` and
   `contract` (vitest, `environment: 'node'`, globs `packages/**/tests/<tier>/**/*.test.ts`) and
   Playwright-on-Electron E2E (`packages/ui/tests/e2e/*.e2e.ts`). There is **no component/jsdom
   tier**: nothing renders React below E2E. Any renderer behaviour is proved at E2E, and anything
   worth a fast test is pure and lives in `@throng/core`.

## Delivery order, and why it is not the priority order

Stated in [plan.md § Delivery order](./plan.md): **US5's machinery must precede US3 and US4**,
because FR-049 is implemented by making `section` a *required* field on the menu-item type, and
neither of those stories' new menu items can compile until the vocabulary exists. Every slice
remains independently shippable and independently demonstrable.

`US1 (P1) → US2 (P2) → US5 (P5) → US3 (P3) → US4 (P4) → the two Editor · Navigation settings`

---

## Phase 1: Setup

**Purpose**: a recorded baseline, and the two E2E helpers four later specs share.

- [ ] T001 *(done 2026-08-15 by the orchestrator, outside the repo — a captured log is a build artifact, not source, and `.claude-scratch/` is not in `.gitignore`)* Capture the pre-change baseline so any later red is attributable to this feature: run `npm run lint`, `npm run typecheck` and `npx vitest run --project unit` from the worktree root per the `running-tests` skill, writing the combined output to `.claude-scratch/033-baseline.txt`. Confirm `packages/ui/tests/unit/shard-plan.test.ts` and `packages/ui/tests/unit/icon-tokens-exist.test.ts` are green before any file is added.
- [ ] T002 [P] Create the E2E helper `packages/ui/tests/e2e/helpers/navigation.ts` — `openQuickOpen(win)`, `openQuickOpenFromToolbar(win)`, `quickOpenRows(win)`, `chooseQuickOpenRow(win, i)`, `openGotoLine(win)`, built on the `data-testid` values fixed by [contracts/picker-extensions.md §5](./contracts/picker-extensions.md) (`quickopen`, `quickopen-truncated`) and `gotoline`.
- [ ] T003 [P] Create the E2E helper `packages/ui/tests/e2e/helpers/deep-tree.ts` — materialises a temp project root containing nested folders several levels deep, a `node_modules/` folder matching the shipped `DEFAULT_EXCLUDE_GLOBS`, two files sharing a basename in different folders, and a pair where one file matches a query by **name** and another matches only by a **directory** segment (SC-003, SC-013, FR-007a). Exposes a cleanup function in the shape the existing specs' `cleanupTemp` uses.

**Checkpoint**: baseline recorded, shared test helpers exist.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the pure core this feature is mostly made of, plus the one genuinely new machine — the
project file index — which US1 cannot start without.

**⚠️ CRITICAL**: no user story work begins until this phase is complete.

**Scope note**: the renderer half of the picker extension (`picker.tsx`) is deliberately **not**
here. It has no observable Red until a caller exists, so it lands in US1 immediately after the two
E2E specs that drive it go red. Its pure core — `compileQuery`, `rankFilePath`, `rankStable`,
`QUICK_OPEN_MAX_ROWS` — is foundational and is here.

### Tests first (all five files are new, all independent)

- [ ] T004 [P] RED — write `packages/core/tests/unit/picker-compile-query.test.ts` asserting C1–C3 of [contracts/picker-extensions.md](./contracts/picker-extensions.md): `matches(t, q) === compileQuery(q).test(t)` and `matchSpans(t, q)` deep-equals `compileQuery(q).spans(t)` over a table of inputs; `CompiledQuery.empty` is true for a whitespace-only query; and a query's `RegExp`s are constructed **once per term**, not once per entry (count constructions across a 1,000-entry corpus). Run `npx vitest run --project unit packages/core/tests/unit/picker-compile-query.test.ts` and record the failure — `compileQuery` is not exported.
- [ ] T005 [P] RED — write `packages/core/tests/unit/picker-rank.test.ts` asserting K1–K6: a name-segment hit outranks a directory-only hit; an earlier hit outranks a later one; unseparable entries keep their **seeded index** order (assert the explicit tiebreak, not the engine's sort stability); the result is a pure function of `(items, query)`; an empty query scores every entry equally; `rankStable` returns a new array. Also assert `QUICK_OPEN_MAX_ROWS === 200`. Run the file and record the failure.
- [ ] T006 [P] RED — write `packages/core/tests/unit/explorer-exclude-compiled.test.ts` asserting `compileExcluder(globs)(relPath) === isExcluded(relPath, globs)` over the table already used by `packages/core/tests/unit/explorer-exclude.test.ts`, and that `picomatch` is compiled once per glob list rather than once per call. Run the file and record the failure.
- [ ] T007 [P] RED — write `packages/core/tests/unit/file-index.test.ts` asserting W1–W8 and D1 of [contracts/file-index.md §1](./contracts/file-index.md) against a hand-written fake `IFileSystem`: files only; root-relative POSIX paths only; an excluded folder is **not descended into**; a symlinked directory is not descended into and no entry outside the root is produced; `cancelled()` is polled per directory; a directory that disappears mid-walk is skipped rather than thrown; output is sorted; `diffPaths` returns exactly the symmetric difference and two empty arrays for equal inputs. Run the file and record the failure.
- [ ] T008 [P] RED — write `packages/core/tests/unit/quick-open-budget.test.ts` asserting SC-002's measurable half: a synthetic corpus of 50,000 root-relative paths through `compileQuery` → filter → `rankFilePath` → `rankStable` → `slice(QUICK_OPEN_MAX_ROWS)` completes in **under 100 ms**, taking the **worst** of N samples rather than the mean. Run the file and record the failure.

### Implementation (four distinct source files)

- [ ] T009 [P] Add `CompiledQuery` and `compileQuery(query)` to `packages/core/src/picker/match.ts`, and make `matches` / `matchSpans` one-line wrappers over it. The existing `packages/core/tests/unit/picker-match.test.ts` **must pass unmodified** — that is the evidence the refactor changed nothing (C1).
- [ ] T010 [P] Create `packages/core/src/picker/rank.ts` with `rankFilePath(text, query)`, `rankStable(items, score)` and the exported constant `QUICK_OPEN_MAX_ROWS = 200` (R11 — a named constant in core, never a literal at its point of use, and never a user setting).
- [ ] T011 [P] Add `compileExcluder(globs)` to `packages/core/src/explorer/exclude.ts` and make `isExcluded` its wrapper. No behaviour change; `packages/core/tests/unit/explorer-exclude.test.ts` passes unmodified.
- [ ] T012 [P] Create `packages/core/src/explorer/file-index.ts` with `WalkOptions`, `walkFiles(fs, root, options)`, `FileIndexDelta` and `diffPaths(previous, next)`. It depends only on the `IFileSystem` seam and imports no `node:*` module (Principle II, W8).
- [ ] T013 Export the new core surface from **both** barrels — `packages/core/src/explorer/index.ts` (`compileExcluder`, `walkFiles`, `diffPaths`, `WalkOptions`, `FileIndexDelta`) and `packages/core/src/index.ts` (those plus `compileQuery`, `CompiledQuery`, `rankFilePath`, `rankStable`, `QUICK_OPEN_MAX_ROWS`). **One task owns both barrels** because every module above adds to the same two files. Confirm `packages/core/tests/unit/no-os-imports.test.ts` stays green.

### The project file index in UI-main

- [ ] T014 [P] RED — write `packages/ui/tests/integration/project-file-index.integration.test.ts` asserting S1–S11 of [contracts/file-index.md §2](./contracts/file-index.md) over a **real** temp tree and a **real** `NodeFileWatcher`: one `RootIndex` per absolute root, ref-counted by `webContentsId`; `{ status: 'building' }` with no paths while the walk is in flight; `{ status: 'ready', paths }` to every subscriber on completion; a targeted rescan on a watch signal producing a delta; a full reconcile debounced by `quietMs` and **forced** after `reconcileMaxWaitMs` under sustained churn; no message at all when a reconcile finds no difference; a delta computed against the snapshot last *sent*; the last unsubscribe disposing the watch; `excludeGlobs()` re-read at each rescan; and SC-005 — a create, a rename and a delete each reflected **within two seconds**. Run `npx vitest run --project integration packages/ui/tests/integration/project-file-index.integration.test.ts` and record the failure.
- [ ] T015 [P] RED — write `packages/ui/tests/contract/file-index-ipc.contract.test.ts` asserting I1–I4 of [contracts/file-index.md §3](./contracts/file-index.md): the three channel names and payload shapes; pushes reach **only** the subscribing `webContents` and never `broadcastToWindows`; a full `paths` array arrives at most once per root per subscription and everything after is `added`/`removed`. Follow the shape of `packages/ui/tests/contract/themes-ipc.contract.test.ts`. Run it and record the failure.
- [ ] T016 Create `packages/ui/src/main/project-file-index.ts` — `ProjectFileIndexService` exactly as [contracts/file-index.md §2](./contracts/file-index.md) declares it, with `IFileSystem`, `IFileWatcher`, `excludeGlobs: () => readonly string[]`, `push` and `ProjectFileIndexOptions` (`quietMs` default 750, `reconcileMaxWaitMs` default 10_000) taken by **constructor** (Principles IX and X). Nothing is `new`-ed inside it.
- [ ] T017 Create `packages/ui/src/main/file-index-ipc.ts` — register `throng:fileIndex:subscribe` (invoke), `throng:fileIndex:unsubscribe` (send) and the per-window `throng:fileIndex:update` push, mirroring the registration shape of `packages/ui/src/main/files-ipc.ts`.
- [ ] T018 Wire the service in `packages/ui/src/main/main.ts` beside `FilesService` and `ExplorerWatcher` — the UI-main composition root — and unsubscribe a destroyed `webContents` from every root (S9, Principle IX).
- [ ] T019 Add the `fileIndex` bridge to `packages/ui/src/preload/preload.cts` (`subscribe`, `unsubscribe`, `onUpdate` returning an unsubscriber, I3) and its declaration to `packages/ui/src/renderer/global.d.ts`. One task owns both files because a bridge without its declaration fails only at the call site.

**Checkpoint**: the pure layer and the index are proved below E2E. User story work can begin.

---

## Phase 3: User Story 1 — Open any file by typing its name (Priority: P1) 🎯 MVP

**Goal**: a window-scoped chord and a Files & Folders toolbar button open a centred modal over the
shared picker, seeded from the current project's file index, ranked by match quality, capped at 200
rendered rows, routing the chosen file through the open route the tree already uses.

**Independent Test**: open a project with nested folders, press `Ctrl+Shift+T` from a **terminal**
panel, type part of a path, press Enter, and the file opens in an editor. Nothing from US2–US5 is
involved.

### Tests for User Story 1 ⚠️ write these first and record the failures

- [ ] T020 [US1] RED — create `packages/ui/tests/e2e/quick-open.e2e.ts` covering AS-1 to AS-10, AS-12 to AS-15 and AS-18, and Q1–Q7 of [contracts/navigation-modals.md §3](./contracts/navigation-modals.md): the chord opens a centred modal from a focused terminal **and the terminal receives no keystroke**; typing lists every matching file with its full project-relative path and marked runs; Down-Down-Enter opens the third row; a click opens; Escape closes, opens nothing and returns focus to the terminal; a no-match query keeps the modal open and says so; `editor.openTarget` decides the landing panel in both its values; an already-open file focuses its existing editor; a dirty target raises the shipped unsaved-changes prompt and Cancel leaves the buffer untouched; an excluded folder's files are never listed; a second project's files are never listed; a name match sorts above a directory-only match; arrowing an unchanged result set never reorders it; the truncation line appears past 200 rows; a reopened modal is empty at the shipped defaults; **the target control is ABSENT when the modal is invoked from a terminal rather than an editor (FR-011) — the in-editor case is T022's, and without this one nothing asserts the control is conditional at all; the candidate set in a SUB-WORKSPACE window is that window's own root and never the main window's (FR-017, Assumption 6) — a chord silently serving the wrong root is exactly what that assumption rejects, and integration cannot see it;**

  **The FR-016 / SC-005 live-index case is deliberately NOT here — it moved to T026.** It asserts a two-second ceiling, and T021 keeps this spec out of the serial tier on the express grounds that it asserts no wall-clock ceiling; a timed assertion in a spec running at high worker count is a flake under the strict flaky gate. `quick-open-perf.e2e.ts` is already serial and already about timing, so the case belongs there. This is the only E2E evidence that the index stays current; without it FR-016 is proved at the integration layer alone, which cannot see the renderer half. Uses `helpers/navigation.ts` and `helpers/deep-tree.ts`. **This task also carries SC-001** (chord, type, Enter — three actions or fewer from any focus context) **and SC-004** (every Quick Open route produces the same outcome as the equivalent route from the tree — asserted by driving both routes and comparing, never assumed); neither is named by any other task, so trimming them here drops them from the feature. Run `npx playwright test packages/ui/tests/e2e/quick-open.e2e.ts` and record the failure.
- [ ] T021 [US1] Register `quick-open.e2e.ts` in `packages/ui/tests/e2e/shard-plan.json`. It is **not** added to the `serial` list of `packages/ui/tests/e2e/parallel-plan.json`: it opens no preferences window, drives no context menu, runs no long-lived shell command and asserts no wall-clock ceiling. Run `npx vitest run --project unit packages/ui/tests/unit/shard-plan.test.ts` and confirm green.
- [ ] T022 [US1] RED — create `packages/ui/tests/e2e/quick-open-target.e2e.ts` covering AS-11, AS-11a, AS-11b, AS-11c and T1–T6, P7, P8, E1–E5 of [contracts/picker-extensions.md](./contracts/picker-extensions.md): invoked from **inside an editor panel**, a two-option control sits above the input, preselected from `editor.openTarget`; focus starts in the typeahead input and typing goes there; Shift+Tab moves to the control; Space changes its value and opens nothing; **Enter on the control changes its value and opens nothing**; Enter with a row highlighted in the list is the only thing that opens a file; choosing "the currently active editor" produces the Last-Active-Editor outcome and choosing "a new editor panel in this tab" produces a new editor panel in the **current tab**. Run it and record the failure.
- [ ] T023 [US1] Register `quick-open-target.e2e.ts` in `packages/ui/tests/e2e/shard-plan.json`. Not serial — same reasoning as T021. Re-run `shard-plan.test.ts`.
- [ ] T024 [US1] RED — create `packages/ui/tests/e2e/quick-open-toolbar.e2e.ts` covering AS-16, AS-17, FR-018, FR-018c, V1–V5 and SC-012's Quick Open half: the Files & Folders toolbar carries a Quick Open button beside Expand and Collapse all; its tooltip names the action **and the command's current chord**; rebinding the chord in Preferences → Key Bindings changes the tooltip **and** makes the new chord work while the old one stops; with no project open the button is **drawn and disabled** and the chord opens nothing; Expand, Collapse all, New folder and Delete are untouched. Run it and record the failure.
- [ ] T025 [US1] Register `quick-open-toolbar.e2e.ts` in `packages/ui/tests/e2e/shard-plan.json` **and** in the `serial` list of `packages/ui/tests/e2e/parallel-plan.json` — it opens the preferences window, which steals focus and closes menus underneath a concurrent app. Re-run `shard-plan.test.ts`.
- [ ] T026 [US1] RED — create `packages/ui/tests/e2e/quick-open-perf.e2e.ts` covering SC-002's architectural half and FR-015: instrument the preload bridge in-page, type ten characters, and assert **zero** `throng:files:*` and zero `throng:fileIndex:subscribe` calls occur on the keystroke path; measure in-page keystroke-to-list latency against a realistic project in the style of `packages/ui/tests/e2e/editor-highlight-perf.e2e.ts` and **assert it against a stated ceiling of 250 ms** — deliberately looser than SC-002's 100 ms, which is measured over the pure pipeline at the unit layer (T008); this number carries Electron IPC, React render and paint, and a measurement with no threshold asserts nothing at all; **assert the candidate set tracks the filesystem while the app runs (FR-016, SC-005) — create a file in the project from outside throng and confirm it becomes choosable, then delete one and confirm it stops being offered, each within two seconds, polling for the condition and never sleeping for it (moved here from T020: this spec is already serial, and the assertion has a wall-clock ceiling that would flake at high worker count)**; and, against a large seeded fixture, assert the modal opened before enumeration finishes renders its "still listing" state and then its results rather than a partial list presented as whole. Run it and record the failure.
- [ ] T027 [US1] Register `quick-open-perf.e2e.ts` in `packages/ui/tests/e2e/shard-plan.json` **and** in the `serial` list of `packages/ui/tests/e2e/parallel-plan.json` — it asserts a wall-clock ceiling, which contention breaks without anything having regressed. Re-run `shard-plan.test.ts`.

### Implementation for User Story 1

- [ ] T028 [P] [US1] Create `packages/ui/src/renderer/navigate/use-file-index.ts` — `useFileIndex(root, active)` per [contracts/file-index.md §4](./contracts/file-index.md) (R1–R5): the only consumer of the `fileIndex` bridge; `root === null` gives `status: 'idle'` and no subscription; a root change unsubscribes the old root **before** subscribing the new one and clears `paths`; typing performs no IPC. The root is resolved by the rule `packages/ui/src/renderer/workspace/panel-body.tsx` already applies — the active panel's origin project's `rootFolder`, never the main window's active project (R6, FR-017).
- [ ] T029 [P] [US1] Extend `packages/ui/src/renderer/common/picker.tsx` with the five optional props `rank`, `maxRows`, `truncatedMessage`, `header`, `initialQuery` and the key-handling narrowing of [contracts/picker-extensions.md §§3–4](./contracts/picker-extensions.md): pipeline `entries → filter → rank (only when given) → slice(maxRows) → render`; the truncation line renders with `data-testid="<testId>-truncated"`; `header` renders above the input, inside the focus trap, and focus still lands in the query input; `Enter`/`ArrowUp`/`ArrowDown` are claimed **only** when the event target is the query input, `Escape` from anywhere. `packages/ui/src/renderer/workspace/tab-picker.tsx` is **not** edited and passes none of these props — that is SC-013's proof. (`initialQuery` is wired here but first exercised in Phase 8.)
- [ ] T030 [P] [US1] Create `packages/ui/src/renderer/navigate/navigation-store.ts` — the whole `NavigationModal` union (`quickOpen` with `invokedFrom`, `gotoLine` with `panelId`, `null`) as a **single slot** so opening either replaces the other and neither can be opened twice (FR-066, S1–S2), plus the `RememberedInput` fields declared but unread until Phase 8. It must not import from `packages/ui/src/renderer/search/search-store.ts` (S4, FR-026a).
- [ ] T031 [US1] Create `packages/ui/src/renderer/navigate/quick-open-target.tsx` — the two-option control rendered into the picker's `header`, preselected from `editor.openTarget`, Space or Enter changing its value, drawn as a themeable control with a hover title (T1–T6). Depends on T029.
- [ ] T032 [US1] Create `packages/ui/src/renderer/navigate/quick-open.tsx` — seeds `PickerEntry` from `useFileIndex` (`id`/`text`/`label` all the root-relative POSIX path, per [data-model.md §4](./data-model.md)), passes `rank: rankFilePath`, `maxRows: QUICK_OPEN_MAX_ROWS`, the truncation message, the header only when invoked from inside an editor panel, and routes the choice through the **existing** `openFileInTab(ws, activeTabId, absPath, target)` / `openFileInNewEditor(ws, activeTabId, absPath)` so the one-buffer rule, the unsaved-changes prompt and tab-editor creation are inherited rather than re-implemented (contracts/navigation-modals.md §3). **FR-065 is satisfied by inheritance here**: the shared picker already supplies focus-on-open, Escape-to-dismiss and focus restoration via its shipped focus trap, so this component adds no modal behaviour of its own — state that in a comment, because an inherited requirement with nothing written down reads as an unmet one at review.
- [ ] T033 [US1] Create `packages/ui/src/renderer/navigate/navigation-chrome.tsx` mounting the modal slot, and mount `<NavigationChrome />` beside `EditorChrome` in **both** roots in `packages/ui/src/renderer/composition-root.tsx` — `CompositionRoot()` and `SubWorkspaceCompositionRoot({ id })`. A chord that works in one window and does nothing in the other is the failure Assumption 6 rejects.
- [ ] T034 [P] [US1] Add `navigate.quickOpen` to `packages/core/src/config/keybindings.ts` — a new member of the `ActionId` union in a new `navigate.` namespace, default chord `Ctrl+Shift+T`, `COMMAND_SCOPES` **EVERYWHERE** (`editor`, `terminal`, `explorer`). `packages/core/tests/unit/keybindings-collision.test.ts` is the collision gate.
- [ ] T035 [P] [US1] Add the `icons.quickOpen` theme token to `packages/core/src/config/theme.ts`, its label and description to `packages/core/src/config/theme-copy.ts`, and its SVG to the built-in icon pack in `packages/ui/src/main/icon-pack-service.ts`. Gates: `packages/ui/tests/unit/icon-tokens-exist.test.ts` and `packages/ui/tests/unit/no-inline-artwork.test.ts`.
- [ ] T036 [US1] Add the `navigate.quickOpen` descriptor to `packages/core/src/config/keybindings-metadata.ts` in a new `Navigate` group (FR-064). **The Red is automatic and must be observed first**: after T034, run `npx vitest run --project unit packages/core/tests/unit/keybindings-metadata.test.ts packages/core/tests/unit/reset-completeness.test.ts` and record the completeness failure, then make it green. **One task owns this file** for both new commands' descriptors in this phase and the next — do not split a second descriptor into a `[P]` sibling.
- [ ] T037 [US1] RED — add `navigate.quickOpen` cases to `packages/core/tests/unit/keybindings-scope.test.ts` (resolvable from the terminal scope) and to `packages/ui/tests/unit/scope.test.ts` (`isPanelScoped` returns **false** — it is a window command like `zoom.*`, `view.*` and `tabs.openPicker`). Run both and record the failures.
- [ ] T038 [US1] Dispatch the command: add `navigate.quickOpen` to the `HANDLED` allowlist of the window-level capture listener in `packages/ui/src/renderer/app.tsx`, and return `false` from `isPanelScoped` for it in `packages/ui/src/renderer/keybindings/scope.ts`. **One task owns both files** — [data-model.md §2](./data-model.md) records that missing either is a silent failure, not a compile error.
> **T039 carries an uncosted structural change, found while writing the E2E specs.** FR-018c
> requires the Quick Open button to be **drawn and disabled** when no project is open. It cannot
> be, where the toolbar currently lives: `ExplorerToolbar` renders inside `FileTree`, and
> `file-explorer-pane.tsx:82` renders `FileTree` only when `activeProject` is truthy — so with no
> project there is no toolbar at all to draw a disabled button on. T039 must therefore hoist the
> toolbar out of that conditional, or render a toolbar in the empty state. `quick-open-toolbar.e2e.ts`
> asserts the requirement, so it stays red until this is done — it is not a failing test to be
> explained away.
>
> A second consequence, already handled in the spec: the Files & Folders pane defaults to
> **collapsed** when no project is open (`throng.explorerVisibleNoProject`, `app.tsx:557`), so any
> test of this case must expand the pane first.

- [ ] T039 [US1] Add the Quick Open button to `packages/ui/src/renderer/explorer/toolbar.tsx` beside Expand and Collapse all — `<Icon token="quickOpen" />`, a hover title naming the action and `firstBinding(keybindings, 'navigate.quickOpen')` read live, drawn and **disabled** when no project is open (V1–V5, FR-018a–FR-018c).
- [ ] T040 [US1] GREEN — run the four US1 specs (`npx playwright test packages/ui/tests/e2e/quick-open.e2e.ts packages/ui/tests/e2e/quick-open-target.e2e.ts packages/ui/tests/e2e/quick-open-toolbar.e2e.ts packages/ui/tests/e2e/quick-open-perf.e2e.ts`) plus `npx vitest run --project unit` and `--project integration`, and quote the passing output. Confirm `packages/ui/tests/e2e/tab-picker`-driving specs pass **unmodified** (SC-013's second half).

**Checkpoint**: US1 is fully functional and demonstrable on its own — Quickstart Scenario 1.

---

## Phase 4: User Story 2 — Jump to a line number (Priority: P2)

**Goal**: an editor-scoped chord opens a small modal asking for a line number; confirming scrolls
that line into view and puts the caret at its first column, and the number typed is the number the
**gutter** draws. Its content-menu item (FR-027) is deliberately **not** here — it lands in US5, as
the first menu item written under the new section vocabulary.

**Independent Test**: open a file longer than a screen, press `Ctrl+G`, type a line number, and the
gutter beside the caret shows that number.

### Tests for User Story 2 ⚠️ write these first and record the failures

- [ ] T041 [US2] RED — write `packages/core/tests/unit/goto-line.test.ts` for `resolveGotoLine(raw, lineCount)` asserting G3–G5: a number beyond the count clamps to the **last** line; `0` and negatives clamp to the **first**; empty, whitespace and non-numeric input return `null`; an empty document has one line, so every number resolves to 1. Run `npx vitest run --project unit packages/core/tests/unit/goto-line.test.ts` and record the failure.
- [ ] T042 [US2] RED — create `packages/ui/tests/e2e/goto-line.e2e.ts` covering AS-1 to AS-9, AS-12 and G1, G2, G6–G8, G10, plus FR-066 and SC-006, SC-007: the modal opens with the caret in its input; a confirmed line scrolls into view with the caret at its first column and **the rendered gutter number beside the caret equals the number typed**, asserted for a wrapped document and an unwrapped one; out-of-range and non-numeric input behave per G3/G4 with **no error notice**; Escape leaves caret, selection and scroll exactly as they were; focus returns to the **editor** on both confirm and cancel; a find bar open in the same editor keeps its query, its match count and its highlights and merely loses focus; with a terminal focused **no modal opens and the shell receives `^G`**; with no active panel nothing happens; and opening Quick Open while Go To Line is open leaves exactly one modal on screen. Run it and record the failure.
- [ ] T043 [US2] Register `goto-line.e2e.ts` in `packages/ui/tests/e2e/shard-plan.json`. Not serial: no preferences window, no context menu, no long-lived shell command, no wall-clock ceiling — the `^G` assertion reads a single prompt, not a running process. Re-run `packages/ui/tests/unit/shard-plan.test.ts`.
- [ ] T044 [US2] RED — create `packages/ui/tests/e2e/goto-line-keybinding.e2e.ts` covering AS-10 and SC-012's Go To Line half: the action is listed in Preferences → Key Bindings with its name, description and chord; it can be rebound; after the rebind the **new** chord works and the **old** one does not. Run it and record the failure.
- [ ] T045 [US2] Register `goto-line-keybinding.e2e.ts` in `packages/ui/tests/e2e/shard-plan.json` **and** in the `serial` list of `packages/ui/tests/e2e/parallel-plan.json` — it opens the preferences window. Re-run `shard-plan.test.ts`.

### Implementation for User Story 2

- [ ] T046 [US2] Create `packages/core/src/editor/goto-line.ts` with `resolveGotoLine(raw, lineCount): number | null`, and export it from `packages/core/src/editor/index.ts` and `packages/core/src/index.ts`. One task owns both barrels.
- [ ] T047 [US2] Create `packages/ui/src/renderer/navigate/goto-line.tsx` — the modal per [contracts/navigation-modals.md §5](./contracts/navigation-modals.md): the app's shipped presentation (`.modal-overlay` scrim, `role="dialog" aria-modal="true"`, `useFocusTrap`, focus in the input on open, Escape cancels, Enter confirms); on confirm it dispatches through `getEditorView(panelId)` to `doc.line(n)` and places the caret at its first column; focus returns by calling `getEditorView(panelId)?.focus()` **explicitly, not** by restoring the captured `activeElement`, which would hand focus back to a focused find bar and quietly violate FR-026 (R10). It must not import from `packages/ui/src/renderer/search/search-store.ts` and must not change the active panel (S4, S5).
- [ ] T048 [US2] Mount `GotoLine` in `packages/ui/src/renderer/navigate/navigation-chrome.tsx` alongside Quick Open, driven by the same one-modal slot created in T030.
- [ ] T049 [US2] Add `navigate.gotoLine` to `packages/core/src/config/keybindings.ts` — `ActionId` member, default chord `Ctrl+G`, `COMMAND_SCOPES` **EDITOR_ONLY**.
- [ ] T050 [US2] Add the `navigate.gotoLine` descriptor to `packages/core/src/config/keybindings-metadata.ts`, in the same `Navigate` group T036 created. Observe the automatic Red first: run `npx vitest run --project unit packages/core/tests/unit/keybindings-metadata.test.ts packages/core/tests/unit/reset-completeness.test.ts` after T049 and record the completeness failure. **Same single owner as T036** — this file is never split across `[P]` tasks.
- [ ] T051 [US2] RED — add `navigate.gotoLine` cases to `packages/core/tests/unit/keybindings-scope.test.ts` (not resolvable from the terminal scope), to `packages/ui/tests/unit/scope.test.ts` (`isPanelScoped` returns **true**), and to `packages/ui/tests/unit/commands.test.ts` asserting the action is **absent** from the CodeMirror keymap built by `packages/ui/src/renderer/editor/commands.ts`. Run all three and record the failures.
- [ ] T052 [US2] Dispatch the command: add the window listener in `packages/ui/src/renderer/app.tsx` gated on `getActivePane() === 'workspace'` and the active panel being an editor — the shape `editor.save` and `search.find` already use — and return `true` from `isPanelScoped` for it in `packages/ui/src/renderer/keybindings/scope.ts`. Leave `packages/ui/src/renderer/editor/commands.ts` **unchanged**: adding it to the keymap would `preventDefault` the chord inside the view and make the scope gate unreachable (A2, A3).
- [ ] T053 [US2] GREEN — run `npx playwright test packages/ui/tests/e2e/goto-line.e2e.ts packages/ui/tests/e2e/goto-line-keybinding.e2e.ts` and `npx vitest run --project unit`, and quote the passing output.

**Checkpoint**: US2 is demonstrable on its own — Quickstart Scenario 2, steps 1–8. Step 9 (the menu
item) arrives with US5.

---

## Phase 5: User Story 5 — Menus with sections you can read (Priority: P5, delivered third) + the adopted #244 guard fix

**Goal**: one section vocabulary in `@throng/core`, a **required** `section` field so an undeclared
item is a compile error, dividers derived per menu level rather than pushed by hand, and every menu
in the app conforming. Go To Line's content-menu item (FR-027) lands here as the first item written
under the new rule. #244's vacuous keyboard guard is replaced here, because this is the slice that
restructures the menus its tests drive.

**Delivered third on purpose**: US3 and US4 add menu items that cannot compile until `section`
exists.

**Independent Test**: open each of the app's context menus in turn and confirm its items fall into
the declared sections, in the declared order, with dividers between them and nowhere else.

### Tests for User Story 5 ⚠️ write these first and record the failures

- [ ] T054 [US5] RED — write `packages/core/tests/unit/menu-sections.test.ts` asserting `MENU_SECTION_ORDER` is exactly FR-047's seven sections in FR-047's order, and that `groupBySection` drops empty groups, preserves intra-group order, and returns **one** group for a single-section menu. Run it and record the failure.
- [ ] T055 [US5] RED — create `packages/ui/tests/e2e/menu-sections.e2e.ts` covering SC-010 and AS-1 to AS-8: open each menu in the running app in turn — a file row, a folder row, the tree's empty space, an editor's content, a terminal's content (with and without a link under the pointer), a panel header, a tab, the cog — read the rendered `<li>` order and assert `.context-menu__separator` appears at **every** section boundary and **nowhere else**; the cog menu carries **no** divider; the terminal's link items **lead** the menu; and **Go To Line appears on the editor's content menu showing its current chord** (FR-027, G9). Run it and record the failure.
- [ ] T056 [US5] Register `menu-sections.e2e.ts` in `packages/ui/tests/e2e/shard-plan.json` **and** in the `serial` list of `packages/ui/tests/e2e/parallel-plan.json` — it drives context menus throughout, and throng closes menus when its window loses focus. Re-run `packages/ui/tests/unit/shard-plan.test.ts`.
- [ ] T057 [US5] RED — write `packages/ui/tests/unit/menu-sections.test.ts` invoking **every** builder over a table of fixtures — `buildContextMenuItems` (`explorer/context-menu-items.ts`), `editorContentMenu` (`editor/content-menu.ts`), `panelHeaderMenu` (`workspace/panel-header-menu.ts`), `terminalContentMenu` (`terminal/terminal-content-menu.ts`), and the newly extracted `tabContextMenu` (`workspace/tab-menu.ts`) and `cogMenuItems` (`title-bar/cog-menu-items.ts`) — asserting each item declares a section, that sections appear in `MENU_SECTION_ORDER`, **satisfying SC-016's sibling requirement that the menu tests prove what they claim**, and that the derived divider positions are exactly the boundaries. **The Key Bindings chord menu is deliberately NOT in this list**: it builds a single item inline in `preferences/keybindings-tab.tsx` and FR-052 exempts it while it holds one item — a one-item menu has one section and no boundary, so there is nothing for this test to assert. It is still covered by the type change (T059), which is the point of moving the guarantee to the provider. The Red here is an **unresolvable import** of the four not-yet-extracted modules; run `npx vitest run --project unit packages/ui/tests/unit/menu-sections.test.ts` and record that output as the Red.

### Implementation for User Story 5

- [ ] T058 [US5] Create `packages/core/src/workspace/menu-sections.ts` with `MenuSection`, `MENU_SECTION_ORDER` and `groupBySection`, and export them from `packages/core/src/index.ts`.
- [ ] T059 [US5] Change the menu-item type and derive the dividers in `packages/ui/src/renderer/workspace/context-menu.tsx` **and close the hole at the provider boundary in `packages/ui/src/renderer/context-menu-provider.tsx`** — `openMenu` currently takes `MenuItem[]` (lines 29, 37, 62), and since `MenuItem` admits `{ separator: true }`, every caller could still hand-push a divider and compile. Change `openMenu` and `OpenMenuOptions` to take **`MenuAction[]`**, and make `MenuAction.submenu?: MenuAction[]` so a nested level cannot smuggle one either. Without this the FR-049 compile-time guarantee covers only the builders that happen to be extracted, while spec, plan and contract all claim it covers every menu: `MenuAction.section` becomes **required**, `MenuItem = MenuAction | { separator: true }`, builders return `MenuAction[]` (so a divider cannot be placed by hand), and `ContextMenu` joins `groupBySection`'s groups per level **including inside every submenu** (M1–M6). `separator` keeps its exact current rendering and stays excluded from the keyboard's `enabled` array (FR-051). Expect `npm run typecheck` to go red across every builder — that is FR-049's gate working, and T060–T066 clear it.

The next seven tasks each own one builder and touch no file another touches:

- [ ] T060 [P] [US5] Declare sections in `packages/ui/src/renderer/explorer/context-menu-items.ts` and remove its four hand-pushed separators — Content (Rename, Cut, Copy, Paste, Undo, Redo), Create (New File, New Folder), Destroy (Delete), Navigate (Open In, Copy Path), View & state (Hide in this project). **Zero movement**: the four derived boundaries must land exactly where the four hand-pushed ones did ([contracts/menu-sections.md §3.1](./contracts/menu-sections.md)).
- [ ] T061 [P] [US5] Declare sections in `packages/ui/src/renderer/editor/content-menu.ts` — Content (Cut, Copy, Paste, Select All, Undo, Redo), Navigate (**Go To Line**, new), View & state (Set Language…, Word Wrap) — and add the `gotoLine: { chord?: string; open: () => void }` bundle to `ContentMenuArgs`, supplied from `packages/ui/src/renderer/editor/editor-panel.tsx` with `firstBinding(keybindings, 'navigate.gotoLine')`, matching the shape `wordWrap` already uses. No existing item moves.
- [ ] T062 [P] [US5] Extract the panel header menu from `packages/ui/src/renderer/workspace/panel-placeholder.tsx` into the new `packages/ui/src/renderer/workspace/panel-header-menu.ts` and declare its sections — Content (Rename, Save, Save As…, Revert, Reload from disk), Destroy (the panel's destroy verb), Navigate (Reveal File in Files & Folders, Open in OS Explorer, Send to Tab, Sync to), View & state (Reset Name, Zoom, Try again, Copy details, Clear panel type, Refresh / redraw terminal). The extraction moves code without altering a label, an icon, an action or a condition (N6).
- [ ] T062a [P] [US5] Extract the tab context menu from the inline `menuItems` arrow function at `packages/ui/src/renderer/workspace/tab-group.tsx:1311` into the new `packages/ui/src/renderer/workspace/tab-menu.ts`, returning `MenuAction[]` and declaring its sections — Content (Rename), Destroy (Destroy Tab, Destroy other tabs), Navigate (Sync to). It is a closure over component state today, so the extraction takes what it needs as arguments, exactly as T079/T080 do for the flavour catalogue. Moves code without altering a label, an icon, an action or a condition (N6, FR-053).
- [ ] T062b [P] [US5] Extract the cog menu's item list from the inline `MENU_ITEMS.map(...)` at `packages/ui/src/renderer/title-bar/cog-menu.tsx:39` into the new `packages/ui/src/renderer/title-bar/cog-menu-items.ts`, returning `MenuAction[]` with all five items in **Application** and therefore **no divider** (FR-052 as corrected, AS-5, and T055's assertion). The `cog-menu-*` test identifiers are load-bearing for roughly ten preferences E2E specs and MUST NOT change (FR-053).
- [ ] T063 [P] [US5] Extract the terminal content menu from `packages/ui/src/renderer/terminal/terminal-panel.tsx` into the new `packages/ui/src/renderer/terminal/terminal-content-menu.ts` and declare its sections — Contextual (Open Link, Copy Link Address, leading the menu), Content (Copy, Paste), View & state (Refresh / redraw terminal, Try again, Copy details, Clear panel type). The only visible change is that the separator between *Refresh / redraw terminal* and *Try again* disappears — both are View & state and FR-050 permits a divider only at a real boundary.
- [ ] T064 [P] [US5] Declare sections for the tab context menu in `packages/ui/src/renderer/workspace/tab-group.tsx` — Content (Rename), Destroy (Destroy Tab, Destroy other tabs), Navigate (Sync to). *Sync to* moves from second to last; that is FR-047's fixed order, and FR-053 protects order **within** a section only.
- [ ] T065 [P] [US5] Declare sections in `packages/ui/src/renderer/title-bar/cog-menu.tsx` — all five items (Settings, Key Bindings, Themes, Open Logs Folder, About throng) are **Application**, therefore **one section and no divider**. See T071: this is the recorded contradiction with FR-052.
- [ ] T066 [P] [US5] Declare `section: 'destroy'` on the Key Bindings chord menu's single `Remove "<token>"` item in `packages/ui/src/renderer/preferences/keybindings-tab.tsx`. Exempt from grouping while it holds one item, **not** exempt from FR-049.

### #244 — the guard that guards nothing

- [ ] T067 [US5] RED — write `packages/ui/tests/unit/focus-guards.test.ts` scanning every file under `packages/ui/tests/e2e/` for the vacuous shape `document.activeElement?.textContent … includes(` and failing with the offending file and line. It is **red on the shipped tree**, because `packages/ui/tests/e2e/menu-keyboard.e2e.ts` still carries it around line 91. Run it and record that failure — the Red here is the defect itself. First check `packages/ui/tests/unit/guards-are-live.test.ts`: it scans **unit** sources for `.skip`/`.only`, so it is the wrong home rather than creating a second scanner (DRY, Principle VIII).
- [ ] T068 [US5] Replace the `rowFocused` predicate in `packages/ui/tests/e2e/menu-keyboard.e2e.ts` (both of its uses in the first test) with the corrected form already used later in the same file and, with its reasoning written out, in `packages/ui/tests/e2e/notice-stacking.e2e.ts`: assert `document.activeElement?.closest('[data-testid="file-explorer-tree"]') != null` **and** that the specific row carries `tree-row--selected`. Re-run `focus-guards.test.ts` and the spec; both green.
- [ ] T069 [US5] Add the FR-051 assertion to `packages/ui/tests/e2e/menu-keyboard.e2e.ts`: arrow through a menu that now contains dividers and assert **no divider ever takes focus** and that arrowing steps over them. Same file as T068, so it is sequential by construction, not `[P]`.
- [ ] T070 [US5] FR-053b — perform the recorded mutation from [quickstart.md §Scenario 6](./quickstart.md) by hand: run `menu-keyboard.e2e.ts` green, delete the `await row.click()` before the first guarded keystroke, run it again and confirm it **fails in the guard** rather than three assertions later, then restore the click and confirm green. Paste the red output into the PR body and record the run in the PR description. This is a manual proof stated as a manual proof — a test that asserts another test fails cannot live in the suite.

### Governance and regression sweep for US5

- [ ] T071 [US5] Verify the **cog-menu contradiction stays resolved** in all five artifacts. It was settled on 2026-08-15, before implementation began. **Do not grep for "separated from the diagnostic and About items"** — that phrase legitimately survives inside every superseded notice, and a grep for it has produced a false positive in three consecutive review rounds. Check the five statements instead: (1) `spec.md` FR-052's cog row says one Application section, no divider; (2) `spec.md` US5 AS-5 says the same; (3) `plan.md`'s Constitution Check and Complexity Tracking rows both state it in the PAST tense; (4) `contracts/menu-sections.md` records the resolution rather than calling it unsatisfiable; (5) `quickstart.md` does not tell a human tester to expect a divider. Then confirm `menu-sections.e2e.ts` (T055) and `packages/ui/tests/unit/menu-sections.test.ts` (T057) both assert the cog menu carries none.
- [ ] T072 [US5] SC-011 sweep — run every existing menu-driving E2E spec (`packages/ui/tests/e2e/context-menu.e2e.ts`, `context-menu-icons.e2e.ts`, `context-menu-sections.e2e.ts`, `context-menu-shortcuts.e2e.ts`, `editor-content-menu.e2e.ts`, `editor-menus.e2e.ts`, `menu-keyboard.e2e.ts`, `copy-path.e2e.ts`) and confirm each passes. **Every change beyond the two named exceptions is a defect in this feature, not a test that needed updating.** The two named exceptions are `menu-keyboard.e2e.ts` (required by FR-053a/FR-051 — T068, T069) and `context-menu-sections.e2e.ts:49` (US3 — T083). Anything else must be fixed in the builders.
- [ ] T073 [US5] GREEN — run `npx vitest run --project unit` and `npx playwright test packages/ui/tests/e2e/menu-sections.e2e.ts packages/ui/tests/e2e/menu-keyboard.e2e.ts`, and confirm `npm run typecheck` is clean (the FR-049 gate).

**Checkpoint**: US5 is demonstrable on its own — Quickstart Scenario 3 — and US3 and US4 can now
compile their new menu items.

---

## Phase 6: User Story 3 — Open a terminal where you are looking (Priority: P3)

**Goal**: a **Terminal** submenu nested inside the existing Open In submenu, seeded from the one
flavour catalogue, launching a new terminal panel in the active tab whose shell starts in the
right-clicked folder — or, for a file, its parent folder — with keyboard focus already in it.

**Independent Test**: right-click a nested folder, choose Open In → Terminal → any flavour, and the
new terminal's prompt is in that folder and accepts typed input with no further click.

### Tests for User Story 3 ⚠️ write these first and record the failures

- [ ] T074 [US3] RED — add a case to `packages/core/tests/unit/start-directory.test.ts` asserting FR-032 for the new source: `resolveStartDirectory(root, requested, dirExists)` with a `requested` that resolves **outside** the project root is refused and the root is used instead. Run it and record the failure (or, if the shipped coverage already asserts it, record that and state so in the task's completion note rather than inventing a duplicate).
- [ ] T075 [US3] RED — create `packages/ui/tests/e2e/open-in-terminal.e2e.ts` covering AS-1 to AS-8, A1–A6, B1–B9 and SC-008, SC-015: a folder's Open In contains a Terminal submenu listing every enabled flavour and matching the panel type-picker's list exactly; choosing one opens a new terminal panel in the **active tab**, makes it the active panel, does **not** open it in rename mode, starts its shell in the right-clicked folder, and gives it keyboard focus so `keyboard.type` immediately after launch reaches the shell; a right-clicked **file** starts the terminal in its parent folder; a custom flavour appears with no further configuration and a disabled built-in does not; a start directory outside the root is refused; with no project open the Terminal parent is **shown and disabled**; and the three-level path traverses by mouse without an intermediate flyout collapsing and by arrow keys with Enter launching. Assert SC-008 and SC-015 for **every enabled flavour `listFlavours()` reports on the machine**. Run it and record the failure.
- [ ] T076 [US3] Register `open-in-terminal.e2e.ts` in `packages/ui/tests/e2e/shard-plan.json` **and** in the `serial` list of `packages/ui/tests/e2e/parallel-plan.json` — it drives a context menu **and** spawns a real shell per flavour. Re-run `packages/ui/tests/unit/shard-plan.test.ts`.

### Implementation for User Story 3

- [ ] T077 [US3] Add the optional `startDirectory?: string` field to `TerminalPanelConfig` in `packages/core/src/terminal/panel-type.ts` (absolute; set when the panel was created from a tree node) so a restored panel restarts where it was created (B5).
- [ ] T078 [US3] Pass `rememberedCwd ?? startDirectory` as `requested` to the shipped `resolveStartDirectory` in `packages/ui/src/main/terminal-ipc.ts`. **This is the only change on that path** — the containment check, the existence check, the fallback and the `cwdFallback` report are untouched and therefore inherited (B6, B7, FR-032, FR-034).
- [ ] T079 [US3] Add the Terminal submenu to the existing Open In submenu in `packages/ui/src/renderer/explorer/context-menu-items.ts`, for both folders and files, every item declaring `section: 'navigate'` (single-section, therefore divider-free). `buildContextMenuItems` gains a `flavours` argument rather than calling a hook — a `.ts` module cannot call `useFlavours()`. Shown and **disabled** when no project is active (A3, A6, FR-035).
- [ ] T080 [US3] Supply the flavours and wire the launch in `packages/ui/src/renderer/explorer/file-tree.tsx`: read `useFlavours()` (`packages/ui/src/renderer/panel-type/use-flavours.ts` — the **same** catalogue the panel type-picker uses, so no second copy of the list exists) and pass it to `buildContextMenuItems`.
- [ ] T081 [US3] Implement the launch sequence in `packages/ui/src/renderer/explorer/file-tree.tsx` exactly as [contracts/explorer-actions.md §A.2](./contracts/explorer-actions.md) states it: `ws.addPanel(activeTabId)` → `ws.clearLastAddedPanel()` (so it does **not** open in rename mode) → `ws.setPanelType(id, 'terminal', { flavourId, shellArguments, startDirectory })` → `window.throng.panel.notifyTyped(id, 'terminal', config)` → `ws.setActivePanel(activeTabId, id)` → `focusPanel(id)`. The start directory is the right-clicked folder, or a right-clicked file's parent folder (B1–B4, FR-033, FR-033a).
- [ ] T082 [US3] Verify FR-037 by inspection and by test: nothing in `packages/core/src/terminal/`, `packages/ui/src/renderer/panel-type/` or the Terminal settings UI changed. `packages/core/tests/unit/flavour-record.test.ts` and the panel-type specs pass unmodified.
- [ ] T083 [US3] Update the **one** permitted existing-spec assertion: `packages/ui/tests/e2e/context-menu-sections.e2e.ts:49` asserts a folder's Open In submenu holds exactly one item; US3 adds Terminal to it by design, so the count becomes two. This is SC-011's sole named exception — **any other change to an existing menu spec is a defect in this feature.**
- [ ] T084 [US3] GREEN — run `npx playwright test packages/ui/tests/e2e/open-in-terminal.e2e.ts packages/ui/tests/e2e/context-menu-sections.e2e.ts` and `npx vitest run --project unit`, and quote the passing output.

**Checkpoint**: US3 is demonstrable on its own — Quickstart Scenario 4.

---

## Phase 7: User Story 4 — Tidy one branch of the tree (Priority: P4)

**Goal**: a folder's context menu offers **Collapse All Children** (closing every descendant at every
depth while leaving the folder itself open) and **Expand All Children** (opening the folder's
immediate child folders, one level, loaded as an ordinary chevron click would). A file's menu draws
neither.

**Independent Test**: expand a folder three levels deep, right-click the top folder, choose Collapse
All Children, and the folder is still open with everything beneath it closed.

### Tests for User Story 4 ⚠️ write these first and record the failures

- [ ] T085 [US4] RED — write `packages/core/tests/unit/explorer-subtree.test.ts` asserting C1–C5 of [contracts/explorer-actions.md §B.1](./contracts/explorer-actions.md): `descendantOpenFolders` excludes the anchor, returns every open descendant at every depth deepest-first, and returns `[]` when nothing beneath is expanded; `immediateChildFolders` returns one level only and never a grandchild; both are pure and reuse the existing `ExpandNode` view from `packages/core/src/explorer/expand.ts` rather than defining a second tree shape. Run it and record the failure.
- [ ] T086 [US4] RED — create `packages/ui/tests/e2e/subtree-expand-collapse.e2e.ts` covering AS-1 to AS-11, D1–D10, E1–E3 and SC-009, FR-045: a folder's menu offers both items and a **file's menu draws neither at all, not even disabled**; Collapse All Children closes every descendant at every depth and leaves the anchor open; on a folder with nothing expanded it changes nothing and errors on nothing; on the project root the root stays open; Expand All Children opens immediate child folders only and never a grandchild; on a closed folder it opens the folder first; **zero folders end up marked open with unloaded children** (the #120 desync — assert every opened folder renders at least one child or is genuinely empty on disk); an excluded folder is not expanded into; the resulting open state survives a project switch and a window reload; and the toolbar's Expand and Collapse all behave exactly as before. Run it and record the failure.
- [ ] T087 [US4] Register `subtree-expand-collapse.e2e.ts` in `packages/ui/tests/e2e/shard-plan.json` **and** in the `serial` list of `packages/ui/tests/e2e/parallel-plan.json` — it drives a context menu. Re-run `packages/ui/tests/unit/shard-plan.test.ts`.

### Implementation for User Story 4

- [ ] T088 [US4] Create `packages/core/src/explorer/subtree.ts` with `descendantOpenFolders(root, relPath)` and `immediateChildFolders(root, relPath)`, and export both from `packages/core/src/explorer/index.ts` and `packages/core/src/index.ts`. One task owns both barrels.
- [ ] T089 [US4] Add `expandChildren(relPath)` and `collapseChildren(relPath)` to `packages/ui/src/renderer/explorer/use-explorer-data.ts`, driving the **same** `await ensureLoaded(rel)` → `api.open(rel)` → `persist(selectedId)` path a chevron click and the toolbar's `expandStep` already use, issuing the loads together with `Promise.all` and applying the opens in one pass (D1–D10). The toolbar's existing Expand and Collapse all are **not** edited (FR-046, D9).
- [ ] T090 [US4] Add **Collapse All Children** and **Expand All Children** to `packages/ui/src/renderer/explorer/context-menu-items.ts`, in that order, in the **Navigate** section after Copy Path, drawn **only for a folder** — a file can never acquire children, so neither item is drawn for one, not even disabled (E1, E2, FR-038).
- [ ] T091 [US4] Wire both items to `expandChildren` / `collapseChildren` in `packages/ui/src/renderer/explorer/file-tree.tsx`, passing the right-clicked node's relative path. Neither item takes a key binding or a toolbar button (E3, out of scope).
- [ ] T092 [US4] GREEN — run `npx playwright test packages/ui/tests/e2e/subtree-expand-collapse.e2e.ts packages/ui/tests/e2e/explorer-tree-state.e2e.ts` and `npx vitest run --project unit`, and quote the passing output.

**Checkpoint**: US4 is demonstrable on its own — Quickstart Scenario 5.

---

## Phase 8: The two `Editor · Navigation` settings (FR-057 – FR-063, SC-014)

**Goal**: two toggles, both shipping **off**, each making one modal reopen with the last value it
**accepted**, fully selected. Held per window for the running application only, never written to
disk, discarded when the setting is turned off, and — for Quick Open — discarded when the active
project changes.

**Independent Test**: with both settings at their defaults both modals open empty every time; turn
one on, use its modal, reopen it, and the last accepted value is present and fully selected.

**Why it is a phase of its own**: it spans US1 and US2, both of which ship complete and demonstrable
without it (FR-057 is the shipped default), and it is the only place `initialQuery` is exercised.

### Tests first

- [ ] T093 RED — write `packages/core/tests/unit/editor-navigation-settings.test.ts` asserting the two leaves parse tolerantly and default to **false**: `editor.navigation.rememberQuickOpenQuery` and `editor.navigation.rememberGotoLineNumber`, each falling back key-by-key on an absent or non-boolean value. Run it and record the failure.
- [ ] T094 RED — create `packages/ui/tests/e2e/navigation-remember.e2e.ts` covering AS-18 to AS-21 (US1), AS-13 to AS-15 (US2), M1–M8 and SC-014: **both settings asserted in both states** — off, the modal opens empty; on, it opens with the last accepted value present and **fully selected**, with Quick Open showing that query's results rather than an empty list, and typing replacing it outright; a query abandoned with Escape is **not** remembered; turning a setting off discards the value already held; and Quick Open's remembered query is discarded when the active project changes. "The toggle appears in Preferences" is explicitly **not** sufficient evidence — that is the defect #108 exists to prevent. Run it and record the failure.
- [ ] T095 Register `navigation-remember.e2e.ts` in `packages/ui/tests/e2e/shard-plan.json` **and** in the `serial` list of `packages/ui/tests/e2e/parallel-plan.json` — it opens the preferences window to toggle the settings. Re-run `packages/ui/tests/unit/shard-plan.test.ts`.

### Implementation

- [ ] T096 Add the nested `navigation: EditorNavigationSettings` block to `EditorSettings` in `packages/core/src/config/app-settings.ts`, with both booleans defaulting to `false`, and its tolerant per-section parsing. Three-level leaf keys are not new (`panes.projects.maxWidth`) and `leavesOfDeclared` walks to any depth, so no change to the completeness machinery is needed.
- [ ] T097 Add both `FieldDescriptor`s to `packages/core/src/config/settings-metadata.ts` in a new **`Editor · Navigation`** group, placed **adjacently** and next to the other `Editor · …` groups, because `settings-tab.tsx` renders sections in first-appearance order (FR-059, [data-model.md §1.1](./data-model.md)). **The Red is automatic and must be observed first**: after T096 run `npx vitest run --project unit packages/core/tests/unit/settings-metadata.test.ts packages/core/tests/unit/reset-completeness.test.ts` and record the completeness failure, then make it green. **One task owns this file** for both descriptors — never two `[P]` tasks each adding a key to `settings-metadata.ts`.
- [ ] T098 Implement the remembered values in `packages/ui/src/renderer/navigate/navigation-store.ts`: record only an **accepted** value (a query that opened a file, a number that was gone to); hold it per window for the running application only; never write it to disk or across a process boundary; discard it when its setting is turned off; and discard `quickOpenQuery` when the active project changes (M1–M7, FR-061 – FR-063).
- [ ] T099 Read the settings and seed the inputs: pass `initialQuery` from the remembered query in `packages/ui/src/renderer/navigate/quick-open.tsx` (so the picker shows that query's **results**, P5/P6) and seed the input, fully selected, in `packages/ui/src/renderer/navigate/goto-line.tsx`. Both read the settings live so a toggle takes effect at the next invocation.
- [ ] T100 GREEN — run `npx playwright test packages/ui/tests/e2e/navigation-remember.e2e.ts` and `npx vitest run --project unit`, and quote the passing output.

**Checkpoint**: SC-014 is satisfied — each setting is asserted in both states, and neither is a
rendered control nothing reads.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T101 [P] FR-067 / P3 — document the feature in `docs/quick-start.md`: both new chords in its shortcut table (around L311) — `Ctrl+Shift+T` Quick Open and `Ctrl+G` Go To Line — the two new explorer actions (Open In → Terminal, and Collapse / Expand All Children), and the two new preferences under `Editor · Navigation`.
- [ ] T102 [P] FR-067 — check `README.md` against its finite-state claim and its shipped-capability list, and update it if this feature changes what the app is described as doing. Documentation currency is part of done, in the **same** change.
- [ ] T103 [P] Check `CONTRIBUTING.md` and `docs/testing.md` for anything this feature invalidates — in particular the two-tier / three-shard description now that ten new E2E specs are registered — and update or explicitly record that no change is needed.
- [ ] T104 File the two deferrals from [plan.md § Complexity Tracking](./plan.md) as tracked GitHub issues using the `github-issues` skill, each with a type, an area label, a milestone and its parent link: (a) the **second recursive watch** — consolidating `ExplorerWatcher` and `ProjectFileIndexService` onto one multi-root watch; (b) `FilesService` / `ExplorerWatcher` remaining **single-root**, so a sub-workspace whose panels belong to a non-active project reads the wrong root for ordinary `files.*` calls. Then link both issue numbers into the Complexity Tracking rows in `specs/033-open-and-navigate/plan.md`. There is no ROADMAP.md and no second forward-looking list in a tracked file — issues and milestones only.
- [ ] T105 Confirm every new E2E spec is in both plans where required: `quick-open.e2e.ts`, `quick-open-target.e2e.ts`, `quick-open-toolbar.e2e.ts`, `quick-open-perf.e2e.ts`, `goto-line.e2e.ts`, `goto-line-keybinding.e2e.ts`, `menu-sections.e2e.ts`, `open-in-terminal.e2e.ts`, `subtree-expand-collapse.e2e.ts`, `navigation-remember.e2e.ts` — all ten in `packages/ui/tests/e2e/shard-plan.json`, and seven of them (`quick-open-toolbar`, `quick-open-perf`, `goto-line-keybinding`, `menu-sections`, `open-in-terminal`, `subtree-expand-collapse`, `navigation-remember`) also in the `serial` list of `packages/ui/tests/e2e/parallel-plan.json`. Re-balance the shard groups if `shard-plan.json`'s measured distribution has drifted. `npx vitest run --project unit packages/ui/tests/unit/shard-plan.test.ts` is the gate.
- [ ] T106 Run the full local gate per the `running-tests` skill and quote the actual output: `npm run lint` (0 errors), `npm run typecheck` (clean — and this is the FR-049 gate), `npm run test:unit`, `npm run test:integration`, then the full E2E suite once, at the end, with workers capped to leave at least two cores free. State in one sentence why it is expected to pass before starting it.
- [ ] T107 Walk all six scenarios in [quickstart.md](./quickstart.md) by hand in a real session, including the two that need a second project and the live-updating check, and record the outcome of each in the PR description.
- [ ] T108 Confirm the constitutional governance gates one last time against `.specify/memory/constitution.md` v4.7.0: both settings have descriptors and both commands have key-binding descriptors (configuration-editor completeness); the new toolbar button draws from a theme token and no inline artwork was added (themeable icon controls); every new panel action has a menu item, and Quick Open's toolbar button is the recorded, accepted exception for a window-level command; and `packages/core/tests/unit/no-os-imports.test.ts` is green (Platform-Abstracted Core).

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)** — no dependencies.
- **Phase 2 (Foundational)** — depends on Phase 1. **Blocks every user story.**
- **Phase 3 (US1, P1)** — depends on Phase 2. Depends on nothing else. **This is the MVP.**
- **Phase 4 (US2, P2)** — depends on Phase 2 only. Independent of US1 in code; it shares
  `navigation-store.ts`, `navigation-chrome.tsx`, `keybindings.ts`, `keybindings-metadata.ts`,
  `app.tsx` and `scope.ts` with US1, so it is scheduled **after** US1 rather than beside it.
- **Phase 5 (US5, P5, delivered third)** — depends on Phase 4 for Go To Line's content-menu item
  (T061 needs `navigate.gotoLine` to exist). **Blocks US3 and US4**: `MenuAction.section` becomes
  required in T059, and their new items cannot compile without it.
- **Phase 6 (US3, P3)** — depends on Phase 5.
- **Phase 7 (US4, P4)** — depends on Phase 5. Independent of US3 in behaviour, but both edit
  `explorer/context-menu-items.ts` and `explorer/file-tree.tsx`, so they are **sequential, never
  concurrent**.
- **Phase 8 (settings)** — depends on Phases 3 and 4 (both modals must exist).
- **Phase 9 (Polish)** — depends on everything above.

### Files that forced serialisation

These are the places where tasks that look independent are **not**, because they write the same
file. Each is stated here so no one re-parallelises them by eye:

| File | Tasks | Why it is single-owner |
|---|---|---|
| `packages/core/src/index.ts` + `packages/core/src/explorer/index.ts` | T013, T046, T088 | Every new core module exports through the same two barrels. T013 owns the whole foundational batch in one task rather than four `[P]` tasks each appending a line. |
| `packages/core/src/config/keybindings-metadata.ts` | T036, T050 | Both new commands add a descriptor to the same file and the same new `Navigate` group. Sequenced across phases; never two `[P]` siblings. |
| `packages/core/src/config/keybindings.ts` | T034, T049 | Same file, same `ActionId` union. |
| `packages/core/src/config/settings-metadata.ts` | T097 | **One task adds both** descriptors. Two `[P]` tasks each adding a key here is the classic collision. |
| `packages/ui/tests/e2e/shard-plan.json` + `parallel-plan.json` | T021, T023, T025, T027, T043, T045, T056, T076, T087, T095, T105 | Every registration writes both plans, so no registration task is ever `[P]` — which is also why the spec-creation tasks they follow are not `[P]`. |
| `packages/ui/src/renderer/explorer/context-menu-items.ts` | T060, T079, T090 | Three phases add to one builder. |
| `packages/ui/src/renderer/explorer/file-tree.tsx` | T080, T081, T091 | US3's wiring and US4's wiring, plus the flavour supply. |
| `packages/ui/src/renderer/navigate/navigation-store.ts` | T030, T098 | Created in US1, extended in Phase 8. |
| `packages/ui/src/renderer/navigate/navigation-chrome.tsx` | T033, T048 | Mounts both modals. |
| `packages/ui/src/renderer/navigate/quick-open.tsx` | T032, T099 | Created in US1, seeded in Phase 8. |
| `packages/ui/src/renderer/app.tsx` + `keybindings/scope.ts` | T038, T052 | One command each, same two files. Both are single tasks owning both files because missing one is a silent failure. |
| `packages/ui/tests/e2e/menu-keyboard.e2e.ts` | T068, T069 | The guard replacement and the divider assertion touch one file. |
| `packages/ui/tests/unit/scope.test.ts` | T037, T051 | One command each. |

### Within each story

Tests are written and **observed failing** before implementation. Pure core before renderer. Every
new E2E spec is registered by the immediately following task.

---

## Parallel Opportunities

### Phase 1

```text
T002  packages/ui/tests/e2e/helpers/navigation.ts
T003  packages/ui/tests/e2e/helpers/deep-tree.ts
```

### Phase 2 — the RED block (five new test files, no overlap)

```text
T004  packages/core/tests/unit/picker-compile-query.test.ts
T005  packages/core/tests/unit/picker-rank.test.ts
T006  packages/core/tests/unit/explorer-exclude-compiled.test.ts
T007  packages/core/tests/unit/file-index.test.ts
T008  packages/core/tests/unit/quick-open-budget.test.ts
```

### Phase 2 — the GREEN block (four source files, no overlap)

```text
T009  packages/core/src/picker/match.ts
T010  packages/core/src/picker/rank.ts
T011  packages/core/src/explorer/exclude.ts
T012  packages/core/src/explorer/file-index.ts
```

Then **T013 alone** — both barrels.

### Phase 2 — the index tests

```text
T014  packages/ui/tests/integration/project-file-index.integration.test.ts
T015  packages/ui/tests/contract/file-index-ipc.contract.test.ts
```

### Phase 3 — three independent new modules

```text
T028  packages/ui/src/renderer/navigate/use-file-index.ts
T029  packages/ui/src/renderer/common/picker.tsx
T030  packages/ui/src/renderer/navigate/navigation-store.ts
```

and later

```text
T034  packages/core/src/config/keybindings.ts
T035  packages/core/src/config/theme.ts + theme-copy.ts + packages/ui/src/main/icon-pack-service.ts
```

### Phase 5 — the seven menu builders (one file each, no overlap)

```text
T060  packages/ui/src/renderer/explorer/context-menu-items.ts
T061  packages/ui/src/renderer/editor/content-menu.ts + editor/editor-panel.tsx
T062  packages/ui/src/renderer/workspace/panel-header-menu.ts  (from panel-placeholder.tsx)
T063  packages/ui/src/renderer/terminal/terminal-content-menu.ts  (from terminal-panel.tsx)
T064  packages/ui/src/renderer/workspace/tab-group.tsx
T065  packages/ui/src/renderer/title-bar/cog-menu.tsx
T066  packages/ui/src/renderer/preferences/keybindings-tab.tsx
```

### Phase 9 — documentation

```text
T101  docs/quick-start.md
T102  README.md
T103  CONTRIBUTING.md + docs/testing.md
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1).
2. **Stop and validate**: Quickstart Scenario 1, end to end, in a real session.
3. Quick Open alone is one of the three headline v1.0.0 items and the largest daily saving in the
   feature. It touches no menu, so it ships without any of US5's restructuring.

### Incremental delivery

| Slice | Adds | Demonstrated by |
|---|---|---|
| Setup + Foundational | the pure core and the file index | unit + integration + contract layers green |
| **US1 (P1)** | Quick Open: chord, modal, ranking, cap, toolbar button | Quickstart Scenario 1 |
| **US2 (P2)** | Go To Line: chord, modal, clamp, find-bar rule | Quickstart Scenario 2, steps 1–8 |
| **US5 (P5)** | one section vocabulary, derived dividers, Go To Line's menu item, the #244 guard | Quickstart Scenario 3, and Scenario 2 step 9 |
| **US3 (P3)** | Open In → Terminal | Quickstart Scenario 4 |
| **US4 (P4)** | Expand / Collapse All Children | Quickstart Scenario 5 |
| settings | the two `Editor · Navigation` toggles | SC-014, both states, both settings |
| Polish | docs, deferrals filed, full gate | `npm test` green, Scenario 6 recorded |

Each slice adds value without breaking the one before it, which is the Incremental Delivery gate in
the constitution's Development Workflow.

---

## Notes

- `[P]` means different files and no dependency on an incomplete task. Every `[P]` task above names
  its files; the collision table records every place where two tasks that look parallel are not.
- The `[Story]` label maps a task to its user story for traceability. Setup, Foundational, settings
  and Polish tasks carry none, by the template's rule.
- **Verify each Red before implementing.** A task whose test was never seen failing has not been
  done, however green the tree looks afterwards.
- Commit after each task or logical group. Stop at any checkpoint to validate a story on its own.
- Two known spec tensions are carried in [plan.md § Complexity Tracking](./plan.md) and must be
  closed before the branch merges: the cog-menu contradiction (T071, now a consistency check — the amendment landed 2026-08-15) and SC-011's
  literal impossibility (T072, T083 — plus `menu-keyboard.e2e.ts`, which FR-053a itself requires
  changing and which SC-011's exemption table now names explicitly, as row 2).
