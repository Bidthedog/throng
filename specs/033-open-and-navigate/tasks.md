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
- [ ] T008 [P] RED — write `packages/core/tests/unit/quick-open-budget.test.ts` asserting SC-002's measurable half over a synthetic corpus of 50,000 root-relative paths through `compileQuery` → filter → `rankFilePath` → `rankStable` → `slice(QUICK_OPEN_MAX_ROWS)`. Assert it as **work done** — one `RegExp` per query TERM and one scoring per candidate, counted at 500 paths and at 50,000 and identical for both — and **not as a wall-clock figure**: the first version asserted the worst of N against a hard 100 ms and failed intermittently in full runs at 102.5–147.0 ms while passing in isolation at 45 ms, because ~160 unit files in parallel are what it was measuring. A calibrated ratio against a reference workload timed in the same run was built and measured as the replacement, and rejected too — it survived an ordinary full run but failed three of four runs under deliberate CPU starvation. The duration half of SC-002 is asserted at T026 instead. Run the file and record the failure.

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
- [ ] T026 [US1] RED — create `packages/ui/tests/e2e/quick-open-perf.e2e.ts` covering SC-002's architectural half and FR-015: instrument the preload bridge in-page, type ten characters, and assert **zero** `throng:files:*` and zero `throng:fileIndex:subscribe` calls occur on the keystroke path; measure in-page keystroke-to-list latency against a realistic project in the style of `packages/ui/tests/e2e/editor-highlight-perf.e2e.ts` and **assert it against a stated ceiling of 250 ms** — deliberately looser than SC-002's 100 ms, and **this is the only tier where SC-002 is asserted as a duration at all**, because the unit layer (T008) counts the pure pipeline's work rather than timing it — ~160 parallel unit files made a wall-clock line there a measurement of the machine; this number carries Electron IPC, React render and paint, and a measurement with no threshold asserts nothing at all; **assert the candidate set tracks the filesystem while the app runs (FR-016, SC-005) — create a file in the project from outside throng and confirm it becomes choosable, then delete one and confirm it stops being offered, each within two seconds, polling for the condition and never sleeping for it (moved here from T020: this spec is already serial, and the assertion has a wall-clock ceiling that would flake at high worker count)**; and, against a large seeded fixture, assert the modal opened before enumeration finishes renders its "still listing" state and then its results rather than a partial list presented as whole. Run it and record the failure.
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

---

## Phase 10: Convergence

**Recorded 2026-08-15 by `/speckit-converge`, as a BASELINE reading taken before any amendment.**
Its purpose is to separate drift that already exists in the delivered slice from work a later
amendment adds, so appending it is not a claim that anything here is newly broken.

**What this phase does NOT re-task.** Phases 4–9 have not started — US2's modal and chord
(T042–T053, less the pure clamp T046), US5 (T054–T073), US3 (T074–T084), US4 (T085–T092, less the
pure targets T088), the two `Editor · Navigation` settings (T093–T100) and polish (T101–T108). Every
one of those is already an open, traceable task above, so re-stating them here would duplicate
sixty-eight tasks and leave the converge loop with nothing that could ever make it terminate. The
tasks below are only the findings that **no existing task covers** — all of them against **US1 as
built**.

**US1's verdict**: FR-001 – FR-018c each have an implementation and E2E coverage, and US1 is
demonstrable end to end. It is **not fully satisfied**: FR-006 is honoured for one of the explorer's
two exclusion mechanisms, FR-015's failure path stops at the process boundary, and four decisions in
the shipped code were taken by the implementation rather than by the spec.

- [ ] T109 [US1] Honour the project's **hidden paths** in the candidate set per **FR-006** and **SC-003** (partial) — HIGH. `ProjectFileIndexService` is wired with `() => currentSettings.explorer.excludeGlobs` alone (`packages/ui/src/main/main.ts` ~L1000), but the explorer applies a **second** exclusion on top of the globs: the project-scoped hidden paths of 004, dropped in `packages/ui/src/renderer/explorer/use-explorer-data.ts` (`hiddenSet`, ~L425–435). So a file the user chose "Hide in this project" for is invisible in the tree and **offered by Quick Open** — which is exactly the "two mechanisms, two answers" FR-006 forbids. `packages/ui/tests/e2e/quick-open.e2e.ts:576` proves only the glob half. Either feed the hidden paths into the index (they are per project, the index is keyed by root) or filter them in `quick-open.tsx`, and assert the case in the E2E fixture beside the `node_modules` / `.git` one.
- [ ] T110 [US1] Complete **FR-015**'s failure path across the process boundary (partial). On a permanent watch failure `project-file-index.ts` (`onWatchFailed`, S11) drops the root's paths, marks it `building` and pushes `{ status: 'building' }` with no `paths` and no delta — and `packages/ui/src/renderer/navigate/use-file-index.ts` (~L66–72) answers that push by **keeping the paths it already holds**. The renderer therefore keeps serving a set main has just declared unmaintainable, and the "Still listing this project's files…" state never renders because the list is not empty. Neither half is wrong alone; `contracts/file-index.md §4` states no R-rule for a `building` push, which is why they disagree. Decide the rule, state it in the contract, and cover it in the integration or E2E layer.
- [ ] T111 [US1] Settle where focus lands **after a file is opened**, per **FR-065** (contradicts). `quick-open.tsx` (~L106–117) focuses the landing editor via `getLastActiveEditor` + `requestPanelFocus`. FR-065 says focus "returns to the invoking surface **either way**", and no FR asks for focus to follow the opened file. The shipped behaviour is very probably the right one — a Quick Open that left the caret in the terminal would be a two-step gesture — so the expected resolution is an **amendment that authorises it**, not a code change. Recorded because an unrequested behaviour that reads as correct is the kind that survives review unexamined.
- [ ] T112 [US1] Decide whether the target control must show **both** options, per **FR-010** and **US1/AS-11** (partial). The spec says "a two-option target control … offering the currently active editor and a new editor panel in this tab". `quick-open-target.tsx` renders a **single icon toggle** that shows only the destination currently chosen; the alternative is named in the hover title and nowhere else. The stated reason is the constitution's themeable-icon-control rule (file header, ~L9–20), which is a real constraint — but "two-option control" and "one icon showing one of two states" are not obviously the same promise, and the difference is what a user can see without hovering. Settle it in the spec, then in the code if the spec moves.
- [ ] T113 **SC-002's 100 ms is asserted nowhere** (partial). The unit budget (`packages/core/tests/unit/quick-open-budget.test.ts`) counts *work* rather than time, and the only duration assertion is `quick-open-perf.e2e.ts`'s **250 ms**. Both choices are argued at length in [plan.md § Complexity Tracking](./plan.md), and the measurements behind them are recorded — but SC-002 still reads "under **100 ms**, measured", so the spec states a number the feature never checks. Reconcile the criterion with what is actually proved (a spec amendment, not a code change).
- [ ] T114 Justify or narrow the **`keepShift` widening** in `packages/ui/src/renderer/app.tsx` (unrequested). Resolving `Ctrl+Shift+T` required the window-level dispatcher to stop dropping Shift for letters (`keepShift = backtick || /^F\d{1,2}$/.test(e.key) || /^[a-z]$/i.test(e.key)`). It is load-bearing for FR-002 and the reasoning in the comment is sound, but it changes chord resolution for **every** command in that listener's `HANDLED` set, not only the new one, and no requirement, plan touch-point or task called for it. Record it in plan.md, and add an assertion that the existing `Ctrl+`-letter window chords still resolve — a regression here fails silently, which is the property the comment itself identifies.
- [ ] T115 Justify or consolidate the **second window-level keydown dispatcher** in `packages/ui/src/renderer/navigate/navigation-chrome.tsx` (~L119–138) (unrequested). T033 asked only that `NavigationChrome` be mounted in both window shells and T038 placed dispatch in `app.tsx` + `keybindings/scope.ts`; this listener is a third site, live only in sub-workspace windows, resolving through `resolveAction` + `scopeFromKind` and bypassing `isPanelScoped` entirely. Assumption 6 makes it necessary — `subworkspace-app.tsx` mounts no `KeybindingsHandler` — but two dispatchers with two resolution paths is the shape a future chord gets right in one window and wrong in the other. Record the decision, or give the sub-workspace shell the shared dispatcher.
- [ ] T116 [US1] Name the command's chord in the Quick Open button's tooltip **while it is disabled**, or amend **FR-018a** (partial). `explorer/toolbar.tsx` (~L73–77) titles the disabled control "Quick Open — no project is open" and names no chord; FR-018a states the tooltip MUST name the current chord without qualifying it by state. AS-16 and AS-17 exercise only the project-open case, so nothing fails today.
- [ ] T117 Record the **sixth** picker prop change in `contracts/picker-extensions.md`, or revert it (unrequested). `PickerProps.emptyMessage` was widened from `string` to `ReactNode` so Quick Open's "still listing" state could carry its own test id. The contract and T029 name exactly five new props. The widening is inert for a caller passing a string, so SC-013 holds and the tab picker is untouched — this is a documentation gap, not a behavioural one.
- [ ] T118 Record the `packages/core/src/explorer/expand.ts` change in plan.md's file map (unrequested). `findNode` and `childFolders` were exported for `subtree.ts` (US4, T088) and deliberately kept off the package barrel. The plan's Source-code map lists `subtree.ts` as new and `expand.ts` as untouched.

---

## Phase 11: Post-delivery feedback (FR-068 – FR-075, SC-017 – SC-022, F6 – F9)

**Added 2026-08-15**, from the user's hand-testing of the delivered US1 plus the baseline
`/speckit-converge` findings they asked to be cleared in the same round. The design is
[plan.md § Post-delivery design increment](./plan.md), decisions **D1 – D6**; every task below names
the decision it implements so a reviewer can argue with the design rather than with the diff.

**Phases 1–10 are untouched.** Nothing above this line is re-stated, re-numbered or re-ticked. Where
a task above is now factually wrong it is corrected in place and the correction is dated; nothing
else changes. Every Phase 10 finding is closed here, six of them by a requirement the amendment
absorbed them into:

| Phase 10 | Becomes | Closed by |
|---|---|---|
| T109, F1 — hidden paths not honoured | FR-069a | T134 – T139 |
| T110, F2 — the disowned candidate set | FR-075 | T140 – T142 |
| T111, F3 — focus after an open | FR-072 | T158 |
| T112, F10 — the one-icon target control | FR-068 | T151 – T154 |
| T113, F5 — SC-002 asserted nowhere | FR-073 | T159, T160 |
| T114, F6 — the `keepShift` widening | SC-021 | T155 – T157 |
| T115, F7 — the second chord dispatcher | *design, recorded* | plan.md D6 + T164 |
| T116, F4 — the disabled button's tooltip | FR-074 | T161 |
| T117, F8 — the picker's sixth change | *contract* | T162 |
| T118, F9 — `expand.ts` in the file map | *plan + a guard* | T163 |

**Order within the phase is a dependency, not a preference**: D1 (overlays) is independent and goes
first; **FR-070 before the hidden set** so the fixture rework happens once; **the hidden set before
the toggle**, because the toggle selects between rule sets that must both exist; and **FR-075 before
the toggle**, because FR-069d's "still listing" state *is* FR-075's rule doing its job — a toggle
built first would serve a stale list on its first flip and look correct.

**Two new E2E spec files** — `transient-overlays.e2e.ts` and `window-chord-resolution.e2e.ts`. Each
is registered by the very next task, per the rule at the top of this file. Neither opens Preferences
nor drives a context menu nor asserts a wall-clock ceiling, so both stay in the **parallel** tier:
`packages/ui/tests/unit/shard-plan.test.ts` requires a group in `shard-plan.json` and treats absence
from `parallel-plan.json`'s `serial` list as "parallel". Everything else extends the four existing
`quick-open*.e2e.ts` specs, because the behaviour belongs to them.

### 11.1 One transient overlay per window — D1 (FR-071, FR-071a, SC-017)

- [ ] T119 [P] **RED** — write `packages/ui/tests/unit/transient-overlay.test.ts` against a module that does not exist yet. Six cases, each of which is a trap D1 names: (1) claiming with an empty slot dismisses nothing; (2) claiming while another holds the slot calls the incumbent's `dismiss` **exactly once**; (3) an incumbent whose `dismiss` **synchronously calls its own release** leaves the NEW claim in the slot — the claim-before-dismiss ordering; (4) a release from a superseded claim is a no-op and does not clear the current holder — the late-unmount case; (5) release is idempotent; (6) an incumbent whose `dismiss` throws does not prevent the new claim from being recorded. **Red step**: run `npx vitest run --project unit packages/ui/tests/unit/transient-overlay.test.ts` and capture the module-resolution failure for `../../src/renderer/common/transient-overlay.js`.
- [ ] T120 Create `packages/ui/src/renderer/common/transient-overlay.ts` — `claimTransientOverlay(dismiss): () => void` and the `useTransientOverlay(open, dismiss)` React seam, exactly as D1 specifies (token identity on release, claim written before the incumbent is dismissed, `dismiss` read through a ref so the effect is keyed on `open` alone). T119 goes green.
- [ ] T121 **RED** — create `packages/ui/tests/e2e/transient-overlays.e2e.ts`, a shared-app (`openApp`) spec covering **SC-017**: all **six** ordered pairs of Quick Open (`Ctrl+Shift+T`, testid `quickopen`), Go To Line (`Ctrl+G`, testid `gotoline`) and the tab picker (`Ctrl+Alt+T`, testid `tabpicker`) — after the second chord, **exactly one** of the three is in the DOM — plus one directional case for the editor status strip's language picker (opening Quick Open dismisses it). Uses `openQuickOpen` / `openGotoLine` from `packages/ui/tests/e2e/helpers/navigation.ts`. **Red step**: `npx playwright test transient-overlays.e2e.ts` — the Quick-Open-then-tab-picker and tab-picker-then-Quick-Open pairs both show two overlays; capture the output. *(Go To Line's four pairs cannot run until Phase 4 ships the modal; write them now, mark them `test.fixme` with the task number, and un-fixme them in T053's checkpoint — a fixme with an owner is a plan, a missing test is a gap.)*
- [ ] T122 Register `transient-overlays.e2e.ts` in `packages/ui/tests/e2e/shard-plan.json` — group **1**, which holds `quick-open-target.e2e.ts` and is the lightest of the three. Do **not** add it to `packages/ui/tests/e2e/parallel-plan.json`: it opens no Preferences window and drives no context menu, and absence from `serial` means parallel. Verify with `npx vitest run --project unit packages/ui/tests/unit/shard-plan.test.ts`.
- [ ] T123 Claim the slot for both navigation modals in `packages/ui/src/renderer/navigate/navigation-chrome.tsx` — one `useTransientOverlay(modal !== null, closeNavigationModal)` covers Quick Open and Go To Line, because `setNavigationModal` replaces *within* the slot and the boolean never flickers. Import from `../common/transient-overlay.js` and **nothing** from `../workspace/` (FR-071a).
- [ ] T124 Claim the slot for the tab picker in `packages/ui/src/renderer/workspace/tab-group.tsx` — `useTransientOverlay(pickerOpen, () => setPickerOpen(false))` beside the existing `useState` at ~L705. The open flag **stays local**; nothing is lifted into a store, and nothing here imports `../navigate/`.
- [ ] T125 Claim the slot for the editor status strip's language picker in `packages/ui/src/renderer/editor/status-strip.tsx` — the same one-line call beside its `useState` at ~L49. It is the third overlay of this shape already in the codebase and is registered now rather than becoming the next `Ctrl+Alt+T` / `Ctrl+Shift+T`. T121 goes green.
- [ ] T126 **RED via a recorded mutation, then green** — write `packages/ui/tests/unit/overlay-feature-isolation.test.ts`, a source scan in the shape of `icon-call-sites.test.ts`: no file under `packages/ui/src/renderer/navigate/` may import `workspace/tab-picker` or `workspace/tab-group`, and no file under `packages/ui/src/renderer/workspace/` may import `renderer/navigate/`; plus the guard-the-guard assertion that it scanned a non-trivial number of files. **This guard is green on arrival, so its Red is a mutation run** — the device `quickstart.md` already uses for FR-053b: add `import { requestTabPicker } from '../workspace/tab-picker.js';` to `navigation-chrome.tsx`, run the test, capture the failure, revert, re-run green. Record both outputs. FR-071a is a structural requirement and this is what proves it.
- [ ] T127 Record the outcome in `specs/033-open-and-navigate/contracts/navigation-modals.md` §2 — add **S6**: *opening any transient overlay dismisses whichever held the window's slot, through `common/transient-overlay.ts`; no overlay imports another's module (FR-071, FR-071a)* — and mark S1/S2's "the two new modals only" scope as widened by FR-071 rather than replaced.

**Checkpoint**: `Ctrl+Alt+T` then `Ctrl+Shift+T` leaves one modal on screen, in either order, and the guard fails if a future overlay reaches for another's store.

### 11.2 `**/node_modules` joins the shipped default — D4 (FR-070, SC-019)

- [ ] T128 **RED** — rework `packages/ui/tests/e2e/helpers/deep-tree.ts` for the new default *before* changing it, so the failure is the fixture's tripwire and not a hundred confusing ones. Invert `EXCLUDABLE_FOLDERS` (~L96–99) so `node_modules` carries `hiddenByDefaults: true`; move `node_modules/quarantined-pkg/quarantined-module.ts` from `listedByDefaults` into `excludedByDefaults` (~L141–152); delete the now-degenerate `NODE_MODULES_GLOB`, `globsExcludingNodeModules` and `listedExcludingNodeModules` (~L102, L149–152) and the callers that read them; and rewrite the L16–36 header comment, which currently states in terms that `node_modules` is not excluded. Leave `assertShippedDefaultsUnchanged()` (~L175–187) in place and re-point it at the new expectation — it is the guard that made this change safe and must keep working in the other direction. **Red step**: `npx playwright test quick-open.e2e.ts` — the fixture now throws *"deep-tree fixture is stale"* at construction, because the constant has not moved yet. Capture it.
- [ ] T129 Add `'**/node_modules'` to `DEFAULT_EXCLUDE_GLOBS` in `packages/core/src/explorer/exclude.ts` (~L9–16). The list stays the VS Code `files.exclude` set plus this one entry, and the file comment says which is which and why (FR-070). Re-run `npx vitest run --project unit packages/core/tests/unit/explorer-exclude.test.ts packages/core/tests/unit/explorer-exclude-compiled.test.ts packages/core/tests/unit/app-settings.explorer.test.ts` — all three read the constant and none should flip; if one does, it was asserting the literal rather than the rule and that is the finding.
- [ ] T130 **RED** — invert `packages/ui/tests/e2e/quick-open.e2e.ts:576-604` (*'a file inside an excluded folder is never listed'*): the `quarantined` query must now return **zero** rows rather than the single `node_modules/quarantined-pkg/quarantined-module.ts` row, and the L586–593 comment inverts with it. Add the **tree half of SC-019** in the same file, against the same fixture the spec already opens: with the shipped defaults and no configuration, no `node_modules` entry appears in the Files & Folders tree. *(It goes here rather than in an explorer spec because this is the only spec that materialises a `node_modules` fixture, and a second project open for one assertion would violate FR-029 root exclusivity.)* **Red step**: run the file, capture both failures.
- [ ] T131 **RED** — write `packages/core/tests/unit/shipped-defaults-settings-migration.test.ts`: a settings document whose `explorer.excludeGlobs` deep-equals the **v4** six-glob list is rewritten to the v5 list; a document whose list differs by even one entry (including an explicit `[]`) is left untouched; a document already on the v5 list is left untouched; and **re-running the migration on its own output changes nothing** — the idempotent-re-run assertion this project requires of every migration. **Red step**: `npx vitest run --project unit packages/core/tests/unit/shipped-defaults-settings-migration.test.ts` fails to resolve the exported planner.
- [ ] T132 Bump `SHIPPED_DEFAULTS_VERSION` 4 → 5 in `packages/core/src/config/shipped-defaults.ts:53`, with a comment in the established style saying what the bump is for and why it is not bookkeeping: first-run `seed()` materialises the whole settings document, so without it FR-070 reaches fresh installs only — the population every E2E can see, and the only one that does not need the fix. Add the pure planner beside `planThemeUpgrade` (one leaf, `explorer.excludeGlobs`, guarded on equality with the v4 list) and apply it from `upgrade()` in `packages/ui/src/main/shipped-defaults-service.ts`, under the same document lock the theme upgrade takes. T131 goes green.
- [ ] T133 Mark the FR-006 verification block quote in `specs/033-open-and-navigate/spec.md:422-429` **superseded by FR-070**, in place and without deleting it. It states that `node_modules` is not in the shipped list and that "this feature does not change a shipped default that governs every project's file tree" — both were true when written and are now false. *(This is the one place the amendment contradicts itself; recording the supersession rather than editing the sentence keeps the reasoning that produced it readable, which is this spec's house rule.)*

**Checkpoint**: a fresh install and an upgraded one both hide `node_modules` from the tree and from Quick Open; a user who edited their globs keeps them.

### 11.3 The per-project hidden set reaches UI-main — D3 (FR-069a, SC-022, closes F1)

- [ ] T134 [P] **RED** — write `packages/core/tests/unit/hidden-path-globs.test.ts` for a new pure `hiddenPathGlobs(paths)` in `packages/core/src/explorer/exclude.ts`: a hidden **folder** hides its descendants (`docs` ⇒ `docs/guide.md` excluded — the flat-index trap D3 names, which an exact-string `Set.has` would miss); a hidden **file** hides only itself; glob metacharacters in a literal path are **escaped**, so hiding a file genuinely named `a[1].ts` does not become a character class and hide `a1.ts`; an empty list yields an empty list. **Red step**: `npx vitest run --project unit packages/core/tests/unit/hidden-path-globs.test.ts` — unresolved export.
- [ ] T135 Implement `hiddenPathGlobs()` in `packages/core/src/explorer/exclude.ts` and export it from `packages/core/src/explorer/index.ts` and `packages/core/src/index.ts`. It emits `p` and `p/**` per path, escaped. **It is not a second exclusion mechanism** — its output is appended to the glob list and compiled by the same `compileExcluder`, which is how FR-069c is satisfied by construction rather than by care.
- [ ] T136 **RED** — extend `packages/ui/tests/integration/project-file-index.integration.test.ts` with the hidden-path cases against a real temp tree: a root whose `hiddenPaths` names a file omits that file; a root whose `hiddenPaths` names a folder omits every path beneath it; the two mechanisms compose (a glob-excluded path and a hidden path are both absent from one walk); and changing the hidden set for a root **re-walks it and pushes the difference** rather than waiting for a filesystem event. **Red step**: `npx vitest run --project integration packages/ui/tests/integration/project-file-index.integration.test.ts` — the service takes no hidden-paths dependency, so the harness cannot supply one.
- [ ] T137 Give `ProjectFileIndexService` (`packages/ui/src/main/project-file-index.ts`) a fifth constructor dependency `hiddenPaths: (root: string) => readonly string[]`, in the shape of the fourth and read at the same three points `excludeGlobs` is (~L239 walk, ~L300 rescan, ~L377 reconcile) so S10's read-at-walk-time rule covers both inputs identically. Compile one excluder from `[...excludeGlobs(), ...hiddenPathGlobs(hiddenPaths(root))]`.
- [ ] T138 Wire it in `packages/ui/src/main/main.ts` (~L984–1003, beside `FilesService`): add a root-keyed projects cache fed by `daemonClient.call('projects.list')` — the call already made at ~L1143, whose `hiddenPaths` field is currently discarded — and **re-point `registerEditorIpc`'s `listProjects` closure at the same cache** so there is one reader, not two (VIII). Key the cache by the index's own normalised root form (`normaliseForCompare`), which is unambiguous because no two projects may share a root.
- [ ] T139 Keep the cache fresh, and close the matching gap for the globs. Add a main-side listener on the existing `throng:projects:changed` relay: re-list from the daemon and ask the index to re-walk any root whose hidden set actually changed — **no new IPC channel**, because main already relays that poke. Then subscribe the index to `onSettingsChanged` (there are exactly two such subscribers today, at ~L719 and ~L1125, and neither is the index) and re-walk affected roots when `explorer.excludeGlobs` changes. Without this second half the two inputs behave differently — hidden paths live, globs stale until the next filesystem event — and FR-069c's "the same glob list and the same hidden set the tree obeys" would be false the moment a user edits their globs. T136 goes green.

**Checkpoint**: a file the user chose "Hide in this project" for is absent from Quick Open, which is the defect F1 named and the half of SC-018 the delivered code did not satisfy.

### 11.4 The exclusion toggle — D2 (FR-069 – FR-069d, FR-075, SC-018, SC-022)

- [ ] T140 [P] **RED** — write `packages/core/tests/unit/file-index-view.test.ts` for a new pure `applyIndexUpdate(view, update)` extracted from the hook: a `ready` push carrying `paths` replaces the set; a `ready` push carrying `added`/`removed` applies the delta and keeps the sorted order; and — **FR-075** — a push whose status is not `ready` and which carries no `paths` and no delta **discards the held paths and reports `building`**. **Red step**: `npx vitest run --project unit packages/core/tests/unit/file-index-view.test.ts` — unresolved module. *(Extracted to core deliberately: `use-file-index.ts` is a hook, there is no component tier, and this rule is arithmetic. It is the same split the plan's Structure Decision makes everywhere else.)*
- [ ] T141 Create `packages/core/src/explorer/file-index-view.ts` with `applyIndexUpdate`, export it from both barrels, and rewrite `packages/ui/src/renderer/navigate/use-file-index.ts` (~L60–80) to call it instead of holding the reducer inline — its current L67–69 branch is the one that keeps the paths main has just disowned. T140 goes green.
- [ ] T142 Add the missing rule to `specs/033-open-and-navigate/contracts/file-index.md` §4: **R-rule** — a `building` push with no `paths` and no delta means the index has disowned the set, and the renderer MUST clear what it holds (FR-075). The contract stating no rule for this push is why both halves looked correct in isolation, which is finding F2's actual cause.
- [ ] T143 **RED** — extend `packages/ui/tests/integration/project-file-index.integration.test.ts` with the subscription-key cases: two subscriptions to the same root at different `includeHidden` values get **different** candidate sets; each is disposed independently on its own last unsubscribe (S9); and the delta protocol is unchanged for each (I2, S7, S8). **Red step**: run the integration project — `subscribe` takes no flag.
- [ ] T144 Key the index by `(root, includeHidden)` in `packages/ui/src/main/project-file-index.ts` — the flag joins `normaliseForCompare(root)` at ~L140 and `subscribe` (~L138) takes it. When `includeHidden` is true the excluder is `compileExcluder([])`, which already returns `() => false`; nothing else in `publish`, `drop` or `teardown` learns a new concept. Widen `throng:fileIndex:{subscribe,unsubscribe}` in `packages/ui/src/main/file-index-ipc.ts` and the `fileIndex` bridge in `packages/ui/src/preload/preload.cts` (~L478–480) and its typing in `packages/ui/src/renderer/global.d.ts` (~L261–273) to carry `{ root, includeHidden }`. T143 goes green.
- [ ] T145 **RED** — extend `packages/ui/tests/e2e/quick-open-target.e2e.ts` (it already owns the header) with **SC-018** and **SC-022**: with the shipped default a file matching `explorer.excludeGlobs` and a file hidden by "Hide in this project" are **both** absent, asserted **independently** so the glob half cannot carry the hidden half; with the toggle flipped both are present; and the toggle is drawn as the target button's sibling in `.picker__header` and is present **even when the target button is not** — i.e. when the modal is invoked from a terminal or the tree (FR-011 draws the target control only from an editor; FR-069 draws the toggle always). Seed the hidden path through the project-settings route the tree already uses. **Red step**: `npx playwright test quick-open-target.e2e.ts` — no `quickopen-hidden` control exists.
- [ ] T146 Extend `packages/ui/tests/e2e/helpers/deep-tree.ts` with a file the fixture can hide via "Hide in this project" (a plain `src/…` file, not one already excluded by a glob), and expose it on `DEEP_TREE` beside `excludedQuery` so both halves of SC-018 name distinct files. *(No shard registration — this is a helper, not a spec.)*
- [ ] T147 Add the setting `editor.navigation.quickOpenExcludeHidden`, shipping **on**, to `packages/core/src/config/app-settings.ts` and a `FieldDescriptor` to `packages/core/src/config/settings-metadata.ts` in the **`Editor · Navigation`** group. **Dependency and collision**: T096/T097 create the `editor.navigation` block and that metadata group for the two `remember*` settings; whichever phase runs first creates them and the other joins them — never a second group, and this task is **never `[P]` with T097**, because Phase 8's own note reserves `settings-metadata.ts` to one task at a time. Verify with `npx vitest run --project unit packages/core/tests/unit/settings-metadata.test.ts` (the completeness gate) and assert the setting in **both** states per SC-014's standing rule, not merely that it renders.
- [ ] T148 Add the `showHidden` icon token to `packages/core/src/config/theme.ts` (`THRONG_THEME.icons`, beside the existing `hide: '⊘'`), its label and description to `theme-copy.ts`, and its glyph to the bundled icon-pack SVG set. The toggle uses `hide` when it is excluding and `showHidden` when it is not — reusing the token the "Hide in this project" menu item already carries, so the control reads as the same idea. Gates: `npx vitest run --project unit packages/ui/tests/unit/icon-tokens-exist.test.ts packages/ui/tests/unit/icon-call-sites.test.ts`.
- [ ] T149 Create `packages/ui/src/renderer/navigate/quick-open-hidden.tsx` — the toggle, an `IconButton` with a hover title naming both the state and what pressing it does — and render it from `quick-open.tsx`'s `header` slot, which must now be built **unconditionally** (today it is `undefined` when `invokedFrom === null`, which would drop the toggle for every non-editor invocation). Hold the flag in `navigation-chrome.tsx` as D2 specifies: `standing` at the setting's value for the window's lifetime, `flipped` at the opposite only while the toggle differs, reset to the setting on each open (FR-069b) by an effect on the modal-open transition rather than a `key` remount. Add the CSS for both header controls to `packages/ui/src/renderer/theme.css` — **not** `preferences.css`, which the main window never loads. T145 goes green.
- [ ] T150 **RED** — add **FR-069d** to `packages/ui/tests/e2e/quick-open-perf.e2e.ts`, which owns the 12,000-file fixture and is already serial: flipping the toggle on the big project shows the `quickopen-building` "still listing" state before it shows the wider list, and never shows a partial list presented as whole. **Place it before the file's final test**, which is documented as needing to stay last. **Red step**: run the file and capture — with FR-075 in place the state should already appear, and if it does not, the finding is that the flipped subscription is not producing a fresh `building` push. *(If it passes on arrival, record that and say so: FR-069d is satisfied by FR-075's mechanism, which is what D2 predicts. A test that passes for the reason the design gives is evidence; one that passes for an unknown reason is not.)*

### 11.5 The target button says where the file will land — D5 (FR-068, SC-020, closes F10)

- [ ] T151 **RED** — extend `packages/ui/tests/e2e/quick-open-target.e2e.ts` with **SC-020**: the control states its destination **in visible text, without hovering**, reading "Will open in a new editor" or "Will open in the active editor (*panel name*)" and **naming the panel** in the second case; it remains a single click target (one `button`, text and icon both inside it); and `data-value` still carries `lastActive` / `new` so the six existing assertions in this file keep working unchanged. **Red step**: `npx playwright test quick-open-target.e2e.ts` — the control renders an icon and no text.
- [ ] T152 Rewrite `packages/ui/src/renderer/navigate/quick-open-target.tsx` as an icon-plus-text button following the context-menu item's vocabulary (`workspace/context-menu.tsx:305-353`): an `aria-hidden` icon span beside a label span, inside one `<button>`. It cannot be `IconButton` — that component takes no children and its one text-ish slot, `badge`, is documented as "an optional COUNT … never a label". Read the destination panel's name from the workspace layout for the `lastActive` case. **Rewrite the file's L9–20 header comment**: it currently argues the icon-only shape from the constitution, and that argument is superseded by D5's reading of the exception's rationale — leave the old reasoning visible and marked, per this spec's house rule.
- [ ] T153 Add the control's CSS to `packages/ui/src/renderer/theme.css` with a class-scoped selector (never a bare `button { … }` rule, which `button-typography-coverage.test.ts` forbids, and never a name containing `__btn`, which its font-weight check catches as a substring). Gates to run: `npx vitest run --project unit packages/ui/tests/unit/css-variables-defined.test.ts packages/ui/tests/unit/no-inline-artwork.test.ts packages/ui/tests/unit/surface-token-roles.test.ts packages/ui/tests/unit/hover-suppression-coverage.test.ts packages/ui/tests/unit/button-token-exclusion.test.ts packages/ui/tests/unit/button-typography-coverage.test.ts`. T151 goes green.
- [ ] T154 Fix the styling defect found while designing this and named in plan.md's Complexity Tracking: `.icon-button` is defined only in `packages/ui/src/renderer/preferences/preferences.css`, which the preferences window alone imports, so **any main-window control passing `className="icon-button"` renders unstyled**. Give the new toggle (T149) its own class-scoped rule in `theme.css` and grep the renderer for other main-window `IconButton` call sites passing the default class; report what is found rather than fixing it here, since anything outside this feature belongs in its own issue.

### 11.6 The remaining baseline findings (F3, F4, F5, F6, F7, F8, F9)

- [ ] T155 **RED** — create `packages/ui/tests/e2e/window-chord-resolution.e2e.ts` for **SC-021**: every window-level chord in `app.tsx`'s `HANDLED` allowlist whose key goes through one of `keepShift`'s three branches still resolves after the widening. The **letter** branch is the one F6 is about and the one nothing covers: `Ctrl+Alt+T` (`tabs.openPicker`), `Ctrl+Alt+B` (`view.toggleProjects`), `Ctrl+Alt+N` (`view.toggleExplorer`), `Ctrl+Z` / `Ctrl+Y` (`file.undo` / `file.redo`, with the explorer pane active, since they are `EXPLORER_ONLY`) and `Ctrl+Shift+T` itself. Cover the other two branches with one case each — `Ctrl+`` (`focus.cycle`) and `Ctrl+Shift+`` (`focus.cycleBack`) for the backtick branch, `F2` (`panel.rename`) and `F11` for the function-key branch. Shared app, `mode: 'serial'`, each test restoring the state it changed. **Red step**: run it and capture — it is expected to pass on arrival, because the widening was correct; **capture the run and say so**, because SC-021 asks for evidence that nothing else broke, and a test that has never been run is not evidence. Then demonstrate it can fail: revert `keepShift`'s `/^[a-z]$/i` branch in `packages/ui/src/renderer/app.tsx:260`, re-run, capture the failures, restore. A guard whose failure mode is never exercised is a claim, not a test — FR-053b's rule, applied to the guard that F6 asks for.
- [ ] T156 Register `window-chord-resolution.e2e.ts` in `packages/ui/tests/e2e/shard-plan.json` — group **3**, the group already holding the two other chord-heavy Quick Open specs. Not in `parallel-plan.json`'s `serial` list: it opens no Preferences window and drives no context menu. Verify with `npx vitest run --project unit packages/ui/tests/unit/shard-plan.test.ts`.
- [ ] T157 Record the `keepShift` widening in `plan.md` — it is already argued in `packages/ui/src/renderer/app.tsx:241-258` and in `keybindings.ts`, but no plan touch-point named `app.tsx`'s dispatcher as a file this feature changes. Add it to the Source-code map beside the other renderer entries, naming SC-021 as its cover. *(Closes F6's first half; T155 is its second.)*
- [ ] T158 **RED** — assert **FR-072** in `packages/ui/tests/e2e/quick-open.e2e.ts`: **dismissing** returns focus to the invoking surface (the existing Q6 case already covers Escape from a terminal — extend it to state the requirement it now satisfies), and **choosing a file** puts focus in the **landing editor**, asserted from a terminal invocation so the two outcomes are visibly different. **Red step**: run the file; the second half is expected to pass because the behaviour shipped — capture it, and record that FR-072 exists to authorise shipped behaviour that FR-065 forbade, not to change it. *(Closes F3.)*
- [ ] T159 Extend `packages/core/tests/unit/quick-open-budget.test.ts` for **FR-073**'s second half: the work per query term is the **same** at 5,000 and at 50,000 candidates — one `RegExp` per term and one scoring per candidate at both sizes, counted rather than timed. The corpus-independence claim is the half SC-002 was really making and the half the existing budget test does not assert. **Red step**: run it and capture whatever the current counters report before adding the assertion.
- [ ] T160 Mark **SC-002** in `specs/033-open-and-navigate/spec.md` as restated by **FR-073** — in place, the way FR-006's note is marked, naming the measurements already recorded in plan.md's Complexity Tracking and the one duration that survives (the in-app 250 ms at E2E). SC-002 still reads "under 100 ms, measured" and nothing measures it; a criterion nobody can check is reinterpreted at the moment it fails rather than challenged. *(Closes F5's spec half.)*
- [ ] T161 **RED** — assert **FR-074** in `packages/ui/tests/e2e/quick-open-toolbar.e2e.ts`, whose first test (~L122, `runOwnApp`) already opens with no project: while the button is **disabled** its tooltip explains why and names **no** chord; once a project is open it names the current chord, and after a rebind it names the new one (the file's L247 test already proves the rebind half — extend rather than duplicate). **Red step**: run the file and capture; the shipped string already satisfies this, so record the pass as the evidence FR-074 asks for and note that AS-16/AS-17 exercised only the project-open case, which is why nothing failed. Update `contracts/navigation-modals.md` §4 **V3** to carry the narrowing. *(Closes F4.)*
- [ ] T162 Record the **sixth** picker prop in `specs/033-open-and-navigate/contracts/picker-extensions.md` §3 — retitle the block and add `emptyMessage?: ReactNode` with the reason (FR-015's "still listing" state carries its own test id; inert for a caller passing a string, so SC-013 holds and the tab picker is untouched). While the file is open, fix the §5 registry's internal inconsistency: its prose says "three more test identifiers" and its table lists two — `quickopen-truncated` is the third and appears only in P4. *(Closes F8; plan.md's Delivery order and file map are already corrected.)*
- [ ] T163 **RED** — write `packages/core/tests/unit/expand-barrel.test.ts` asserting that `findNode` and `childFolders` are **not** re-exported from `packages/core/src/explorer/index.ts` or `packages/core/src/index.ts`, and that `subtree.ts` is their only in-package consumer. **Red step**: run it; it should pass on arrival, so demonstrate the failure by adding `findNode` to the explorer barrel, re-run, capture, revert. F9 is a documentation finding, and a documentation finding whose rule nothing enforces becomes a documentation finding again in six months. *(Closes F9; plan.md's file map is already corrected.)*
- [ ] T164 File the two deferrals plan.md records for this increment as tracked GitHub issues, before the branch merges, using the `github-issues` skill: (1) **consolidate the two window-level chord dispatchers** — give `subworkspace-app.tsx` the shared dispatcher rather than the second listener at `navigate/navigation-chrome.tsx:119-138`, whose resolution path differs from `app.tsx`'s in four ways (D6's table); (2) **decide whether context menus join the transient-overlay registry** — they qualify under D1's own test and are excluded on the ground that they already dismiss on outside pointer and focus change. Cross-link both to this feature and to #219. *(Closes F7.)*

### 11.7 Documentation and closure

- [ ] T165 [P] Bring `docs/quick-start.md` current (Documentation currency, and FR-070 makes this a user-facing capability change, not a note): the exclusion toggle and the target button's new wording in the Quick Open section, `editor.navigation.quickOpenExcludeHidden` beside the two `remember*` settings in the preferences table, and — the one that matters most — **`node_modules` is now hidden from the Files & Folders tree by default, and how to get it back** by editing `explorer.excludeGlobs`. A user whose tree silently loses a folder after an update needs the answer in the docs, not in the diff.
- [ ] T166 [P] Re-check `README.md` against its finite-state capability claims for the same reason, and confirm `docs/testing.md` needs no change — two new parallel-tier spec files add no tier, no shard and no new harness rule.
- [ ] T167 Run the full local gate once, at the end, per the `running-tests` skill: `npm run lint`, `npm run typecheck`, `npx vitest run` and the two-tier E2E. Quote the actual output. Expected cost is the usual ~21 minutes for E2E on this machine, so state before starting why you expect it to pass — this run is to prove nothing **else** broke, not to find out what did.

**Checkpoint**: FR-068 – FR-075 are demonstrable by hand in the running app, SC-017 – SC-022 each have a named test, and Phase 10's ten findings are closed — six by these tasks and four by the requirements that absorbed them.
