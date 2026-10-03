---

description: "Task list for 050 Cross-Project Clipboard"
---

# Tasks: Cross-Project Clipboard

**Input**: Design documents from `specs/050-cross-project-clipboard/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R17), data-model.md, contracts/transfer-ipc.md,
contracts/ui-surfaces.md

**Tests**: Mandatory — constitution Principle V (test-first, lowest layer). Every implementation task is preceded by
its failing test task; run it, read why it fails, then implement. The engine is proven at the integration layer on a
real temp filesystem (single fork); prompts, notices and stores at the component layer (jsdom); pure rules at core
unit. Two E2E declarations, both `@extended @explorer @reserve:runtime` (the composed application: a real project switch remounting the tree and
a real editor following a file between roots); the commit that adds them re-seeds `ui/tests/e2e/e2e-budget.json`
with its one-sentence justification.

**Organization**: by user story, in spec order US1, US2 (P1), US5, US3, US4 (P2). Paths are repository-relative.
`core` = `packages/core`, `ui` = `packages/ui`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task
- **[Story]**: US1–US5 as in spec.md

---

## Phase 1: Setup

- [x] T001 Confirm the baseline before any change: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:unit` green at the branch base (recorded in the autopilot ledger); no code change

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: the pure rules (R3, R10), the cancellable copy seam (R5), the shared queue (R2), the application
clipboard (R1) and the transfer engine's spine (R2, R4, R7) that every story pastes through.

### Pure rules in core

- [x] T002 [P] Write failing unit tests in `core/tests/unit/transfer-plan.test.ts` for `classifyTopLevel(sourceParentReal, targetReal, sourceReal, mode)` → `'same-folder-duplicate'` when the source's parent real path equals the target (copy and cut alike), `'into-own-descendant'` when the target is the source or inside it, else `'ordinary'`; `clashKind(incoming, existing)` → `'merge'` for folder/folder and `'replaceable'` for file/file, file/folder and folder/file; `keepBothName('a.txt', ['a.txt'])` → `'a copy.txt'` and `['a.txt','a copy.txt']` → `'a copy 2.txt'` (the `dedupeName(..., 'copy')` form, FR-018a); `newerOf({modifiedMs: 1}, {modifiedMs: 2})` → `'incoming'`, equal → `'neither'`, a folder side with no time → `'neither'`
- [x] T003 Implement `core/src/explorer/transfer-plan.ts` (`classifyTopLevel`, `clashKind`, `keepBothName`, `newerOf`, types `TopLevelClass`, `ClashKind`, `ClashChoice = 'replace' | 'skip' | 'keep-both'`); export from `core/src/explorer/index.ts` and `core/src/index.ts`
- [x] T004 [P] Write failing unit tests in `core/tests/unit/fileop-undo.test.ts` (extend) for the widened entry: `parse` round-trips a `move` with `id` and `projects: {source, target}`, a `paste` entry `{kind:'paste', id, moved, copied, replaced:[{path, trashedAt}], projects?, at}`, and still parses every pre-050 blob unchanged; `plannedMoves(paste, 'undo')` reverses `moved` only; `validate(paste, 'undo', exists)` refuses when a `moved.to` or `copied.to` is absent or a `moved.from` is occupied, and accepts otherwise; `validate(paste, 'redo', exists)` refuses when a `moved.from` or `copied.from` is absent; `removeById(stack, id)` and `pushRedoEntry(stack, entry)` / `pushUndoEntry(stack, entry)` move one entry between lists without clearing the other (FR-020); `dropEntriesNamingProjects(stack, liveIds)` drops entries whose `projects` names an id not in `liveIds`
- [x] T005 Implement the widened `FileOpUndoEntry` in `core/src/fileop-undo/undo-stack.ts` (optional `id` on every kind, optional `projects` on `move`, new `paste` kind), extend `plannedMoves`, `validate`, `isEntry`, and add `removeById`, `pushUndoEntry`, `pushRedoEntry`, `dropEntriesNamingProjects`; export the new names from `core/src/index.ts`
- [x] T006 [P] Write failing unit tests in `core/tests/unit/file-clipboard-rules.test.ts` for the pure clipboard transitions: `followMoves(items, moves)` rewrites an item equal to or under a moved `from` by prefix, comparing separator- and case-normalised (`C:/a/b` vs `C:\A\b`), and leaves others; `dropDeleted(items, deleted)` drops items equal to or under a deleted path; `retainProjects(clipboard, idToRoot)` returns `null` when any item's `projectId` is missing or its `projectRoot` differs, else the same clipboard; `afterRun(clipboard, snapshot, notMoved)` returns `notMoved` (or `null` when empty) only while `clipboard` still equals `snapshot`, else `clipboard` unchanged
- [x] T007 Implement `core/src/explorer/file-clipboard-rules.ts` (types `FileClipboard`, `ClipboardItem` per data-model: `absPath`, `projectId`, `projectRoot`; `mode: 'cut' | 'copy'`; "never empty" — an empty item list is `null`) with `followMoves`, `dropDeleted`, `retainProjects`, `afterRun`; export from `core/src/index.ts`

### Settings (FR-018f)

- [x] T008 [P] Write failing unit tests in `core/tests/unit/app-settings.explorer.test.ts` (extend): `explorer.replaceMode` defaults to `'recycle'`, accepts `'permanent'`, falls back to `'recycle'` for any other value; the settings-metadata completeness test (existing) fails until a descriptor exists; the descriptor sits directly after `explorer.deleteMode`
- [x] T009 Add `replaceMode: 'recycle' | 'permanent'` to the explorer settings in `core/src/config/app-settings.ts` (default `'recycle'`, guard, write-through beside `deleteMode`) and its descriptor in `core/src/config/settings-metadata.ts` after `explorer.deleteMode` — label `When Paste replaces an item`, options `Move it to the Recycle Bin` / `Delete it permanently` (contracts/ui-surfaces §6)

### Cancellable copy seam (R5)

- [x] T010 [P] Write failing integration tests in `ui/tests/integration/node-file-system-copy-cancel.integration.test.ts` on a real temp dir: `copyFileCancellable(src, dest, signal)` copies bytes exactly; aborting mid-copy of a multi-megabyte file (abort from the first `data` chunk via a wrapped read) rejects with an abort error and leaves NO file at `dest`; an already-aborted signal copies nothing
- [x] T011 Add `copyFileCancellable(src: string, dest: string, signal: AbortSignal): Promise<void>` to `IFileSystem` in `core/src/abstractions/file-system.ts`; implement in `ui/src/main/node-file-system.ts` with `stream/promises.pipeline(createReadStream, createWriteStream, { signal })`, removing the partial `dest` before rethrowing on abort; add the method to every `IFileSystem` test double the typecheck finds

### Shared queue (R2)

- [x] T012 Write failing integration test in `ui/tests/integration/files-exclusive.integration.test.ts`: two ops passed to `FilesService.exclusive` run strictly one after the other (the second starts only after the first resolves), a rejecting op does not wedge the next, and `rename`/`move` still queue behind an `exclusive` op
- [x] T013 Rename `FilesService.bracketed` to public `exclusive<T>(op)` in `ui/src/main/files-service.ts` (callers updated), and expose `beginMoveBracket(absPaths)` / `endMoveBracket(moves)` that call the existing `onMoveStarted` / `onMoved` callbacks, plus `activeRoot(): string | null` and `holderFor(absPath, windowId?)` (absolute-path variant of the private one) for the transfer engine; existing `files-move-bracket.integration.test.ts` stays green

### Application clipboard (R1)

- [x] T014 Write failing integration tests in `ui/tests/integration/file-clipboard.integration.test.ts` for `FileClipboardService` with an injected broadcaster and project lookup: `setFromRelative('cut', ['a.txt','dir'], activeRoot, activeProjectId)` stores absolute items and broadcasts once; `''` (the root) is refused; `set` replaces (FR-003); `clear` broadcasts `null`; `followMoves`, `dropDeleted`, `retainProjects` and `afterRun` (T007 rules) each broadcast only when the value changed; nothing is written anywhere persistent (FR-007); the OS-clipboard `ClipboardService` double is never called (FR-008)
- [x] T015 Implement `ui/src/main/file-clipboard.ts` (`FileClipboardService`) over the T007 rules; construct it in `ui/src/main/main.ts` beside `FilesService`; add `clipboard.followMoves` as the last consumer of `moved` in `ui/src/main/in-app-moves.ts` (deps + `createInAppMoveCallbacks`, extend `ui/tests/integration/in-app-moves*.test.ts` order assertion if one exists); fan `filesService.setOnDeleted` out to the coordinator AND `clipboard.dropDeleted`; after every `refreshProjectsCache()` call `clipboard.retainProjects(idToRoot)` (FR-011)

### Transfer engine spine (R2, R4, R7 — no prompts yet)

- [x] T016 Write failing integration tests in `ui/tests/integration/transfer-service.integration.test.ts` on two real temp roots A and B (projects cache double, `FilesService` real): a copy job of a file and a folder from A into a B folder lands both with identical bytes and directory structure at every depth (FR-018e) and leaves A untouched; a cut job moves them and reports exactly the moved pairs to the bracket in one start/end pair; a source outside every project root fails that item only (FR-010); a target outside the active root fails the job before any change; a missing source fails that item, the rest still land, and the result lists one failure naming it (FR-013); a copy pasted into its own folder takes `name copy.ext` with no clash question (FR-018c); a cut pasted into its own folder is a no-op; jobs queue FIFO inside `FilesService.exclusive` (a second job starts only after the first's result), and a `drag` job submitted while a paste runs waits behind it and emits no progress (FR-019e); the result's `placed` lists the absolute paths created; the result's `undo` is a `move` entry of exactly the moved items for a cut and `null` for a copy (FR-022, FR-023)
- [x] T017 Implement `ui/src/main/transfer-service.ts` (`TransferService`): job queue (data-model *Transfer job*: `state: 'queued' | 'running' | 'awaiting-cancel-choice' | 'rolling-back' | 'done'`, `progress.total` = top-level items), confinement on real paths (target within `activeRoot`, each source within some root of the injected project cache), per-item continue-past-failure classified through `classifyFailure` with `'lock'` operation and the holder resolver, `classifyTopLevel` handling, same-volume move via `fs.move`, copy via a recursive walk over `copyFileCancellable`, journal (`placed`, `moved`, `replaced`, `inProgress`), bracket open before the first change and closed in `finally` with exactly `journal.moved`, and `TransferResult` per contracts/transfer-ipc §2, its `undo` built from the journal as a `move` entry of exactly `journal.moved` for a cut (or `null` for a copy) — T045 extends this to the `paste` kind, `id` and `projects`; a clash is reported as a per-item failure until T043 replaces it with the question
- [x] T018 [P] Write failing integration test in `ui/tests/integration/transfer-cross-volume.integration.test.ts` with an `IFileSystem` decorator whose `move` rejects `EXDEV`: a cut falls back to copy-then-remove and reports the pair to the bracket as a move (FR-014); when the source removal then rejects `EBUSY`, the copy stays, the source stays, the item is a failure naming the source (and holder when the resolver returns one), it is absent from the bracket pairs and from the undo entry (FR-015)
- [x] T019 Implement the EXDEV fallback and FR-015 handling in `ui/src/main/transfer-service.ts`

### IPC and bridge (contracts/transfer-ipc §1–§2)

- [x] T020 Write failing contract test in `ui/tests/contract/transfer-ipc.contract.test.ts` driving the registrar on a fake `ipcMain` (as `history-ipc.contract.test.ts` does): `throng:fileClipboard:get/set/clear` round-trip and push `throng:fileClipboard:changed`; `throng:transfer:paste` returns `{ jobId }` and later pushes `throng:transfer:done` to the SENDER only; malformed payloads (non-string paths, unknown mode) are refused with an error envelope and change nothing
- [x] T021 Implement `ui/src/main/transfer-ipc.ts` (every channel in contracts/transfer-ipc §1–§2, payload shape-checks, owner-window routing by `event.sender`); register it from `ui/src/main/main.ts` with the services from T015/T017
- [x] T022 Expose `window.throng.fileClipboard { get, set, clear, onChange }` and `window.throng.transfer { paste, drop, cancel, finishCancel, resolveClash, applyUndo, exists, quitChoice, onProgress, onClash, onCancelChoice, onDone, onQuitPrompt }` in `ui/src/preload/preload.cts` and type them in `ui/src/renderer/global.d.ts`

### Renderer clipboard mirror

- [x] T023 Write failing component tests in `ui/tests/component/file-clipboard-store.test.ts`: `useFileClipboard()` starts from `fileClipboard.get()`, follows `onChange` pushes, and two components using it see the same value; a consumer unmounted and remounted (the pane hidden and shown, or the tree remounted for another project) reads the same clipboard back from main (FR-001); `isCut(absPath)` compares normalised paths
- [x] T024 Implement `ui/src/renderer/explorer/file-clipboard-store.ts`; replace `useState<ClipboardState>` in `ui/src/renderer/explorer/use-explorer-data.ts` so `cut`/`copy` call `fileClipboard.set`, `clearClipboard` calls `fileClipboard.clear`, and `clipboard` is derived from the store; `ClipboardState` in `use-explorer-data.ts`, `context-menu-items.ts` and `explorer-context.ts` becomes the store's shape; `explorer-keybindings.ts` Escape still clears (FR-005)

**Checkpoint**: one clipboard in main, one engine, every paste and drag can be routed through it.

---

## Phase 3: User Story 1 — Copy a file from one project into another (P1) 🎯 MVP

**Goal**: Ctrl+C in A, switch to B, Ctrl+V on a folder → a copy in B, A untouched; Paste names what lands.

**Independent Test**: two projects; copy a file in A, switch to B, paste on a folder: same bytes in B, A unchanged.

- [x] T025 [P] [US1] Write failing unit tests in `ui/tests/unit/paste-label.test.ts` for `pasteLabel(clipboard, activeProjectId, projectName)` per contracts/ui-surfaces §5: `null` → `Paste`; one item same project → `Paste "config.json"`; three items → `Paste 3 items`; 1,000 items → `Paste 1,000 items` (digit-grouped through `number-format.ts`); another project → suffix ` from <name>`
- [x] T026 [US1] Implement `pasteLabel` in `ui/src/renderer/explorer/context-menu-items.ts` and use it for the Paste row (`context-menu-items.ts:137`), passing the active project id and a project-name lookup from the projects store through `file-tree.tsx`; Paste enabled whenever the clipboard holds items (FR-025)
- [x] T027 [US1] Write failing component test in `ui/tests/component/explorer-paste.test.ts` mounting the tree with a `window.throng` double: Paste on a folder calls `transfer.paste(<that folder's rel path>)` (shared target rule, 004 FR-017), a copy leaves the clipboard unchanged after `onDone` (FR-006), and a `done` result with failures raises ONE error notice listing every failed item by `formatSubject` (FR-013) while a result with none raises nothing
- [x] T028 [US1] Route `paste` in `ui/src/renderer/explorer/use-explorer-data.ts` through `window.throng.transfer.paste`, handle `onDone` for this window's jobs (reload affected dirs, carry nothing for a copy, report failures as one notice) — keep the old `files.copy` call only where `applyEntry` uses it
- [x] T029 [P] [US1] Write failing component test in `ui/tests/component/explorer-paste-reveal.test.ts`: after a `done` whose `placed` are in the active project, the tree opens their folders and selects every placed row with the first focused (FR-025b); a `done` for another project is queued in `pending-reveal` and applied when that project's tree next becomes ready, without switching project
- [x] T030 [US1] Implement `ui/src/renderer/explorer/pending-reveal.ts` (map `projectId → absolute paths`) and drain it in `use-explorer-data.ts` once `ready` (open ancestors via `revealInTree`'s loader, `select` every placed row, focus the first)

**Checkpoint**: US1 is shippable — cross-project copy, labelled Paste, failures as one notice, placed items selected.

---

## Phase 4: User Story 2 — Move a file from one project into another (P1)

**Goal**: cut in A, paste in B → the file lives in B only; open editors and previews follow it; A's row stays greyed
until then.

**Independent Test**: cut a file with an editor open in A, paste in B: only in B, editor on the new path, not dirty,
no notice.

- [x] T031 [P] [US2] Write failing component test in `ui/tests/component/explorer-cut-greying.test.ts`: a row whose absolute path is on the clipboard as a cut renders greyed; after the tree remounts for another project and back (project switch) it is still greyed (FR-004); after `fileClipboard.clear` (Escape in any explorer, FR-005) it is not
- [x] T032 [US2] Compare absolute paths in `ui/src/renderer/explorer/file-tree.tsx` (`cutSet` at ~596 built from the store's cut items mapped through the tree's root) and pass the result to `tree-node.tsx` unchanged in shape
- [x] T033 [P] [US2] Write failing integration test in `ui/tests/integration/transfer-editor-follow.integration.test.ts` wiring `TransferService` to the real `createInAppMoveCallbacks` with coordinator / previews / history doubles: a cross-project cut of a file and of a folder holding an open file calls `beginMove` before the first change and `markMoved` with the exact pairs after (FR-016), and `clipboard.followMoves` runs from the same callback
- [x] T034 [US2] Pass `FilesService.beginMoveBracket` / `endMoveBracket` (T013) into `TransferService` in `ui/src/main/main.ts` so a transfer job's bracket reaches the same `inAppMoves.started` / `inAppMoves.moved` callbacks `FilesService.move` uses; T033 green
- [x] T035 [P] [US2] Write failing integration tests in `ui/tests/integration/transfer-clipboard-after.integration.test.ts`: after a cut job in which one item fails and one is skipped, the clipboard holds exactly those two, still `cut` (FR-006); after every item moved it is `null`; a copy job leaves it unchanged; a clipboard the user replaced while the job ran is left alone (data-model transition table)
- [x] T036 [US2] Call `clipboard.afterRun(snapshot, notMoved)` at the end of every job in `ui/src/main/transfer-service.ts`
- [x] T037 [P] [US2] Write failing component test in `ui/tests/component/explorer-cross-project-override.test.ts`: on a `done` cut whose `sourceProjectId` differs from the target, the renderer reads the language override with `documents.getState(source, rel)`, writes it with `setState(target, rel', state)` and clears the source (FR-016, research R10); within one project it still calls `movePath`
- [x] T038 [US2] Implement the cross-project override carry in `ui/src/renderer/explorer/use-explorer-data.ts` (`carryOverride` gains the cross-project branch)
- [x] T039 [P] [US2] Write failing integration test in `ui/tests/integration/file-clipboard-follow.integration.test.ts` through the real `FilesService.rename` / `move` / `delete`: renaming a pending item, or a folder containing one, rewrites the clipboard path; deleting one drops it (FR-009); `projects.changed` with the holding project removed, or re-rooted, empties it (FR-011)
- [x] T040 [US2] In `ui/src/main/main.ts`: `filesService.setOnDeleted` calls `editorCoordinator.markDeleted` then `fileClipboard.dropDeleted`; the `in-app-moves` deps carry `fileClipboard`; every `refreshProjectsCache()` resolution is followed by `fileClipboard.retainProjects(idToRoot)`; T039 green
- [x] T041 [US2] Route drag-and-drop through the engine (until T043 lands, a drag onto an existing name fails that item rather than asking — an interim state inside this branch, never shipped): write the failing component test first in `ui/tests/component/explorer-drop-transfer.test.ts` (a drop calls `transfer.drop(items, dest, mode)` and on its result records the undo entry it returns, migrates `pendingOpen` for moved folders as today and reloads affected dirs), then change `drop` in `ui/src/renderer/explorer/use-explorer-data.ts` to call `window.throng.transfer.drop` (FR-017, FR-019e)

**Checkpoint**: US1 + US2 — copy and move between projects, editors follow, clipboard keeps what did not move.

---

## Phase 5: User Story 5 — Stay in control of clashes and long pastes (P2)

**Goal**: every clash asks (Replace / Skip / Keep both / Cancel, apply to all); a slow paste shows progress with
Cancel; cancel asks keep-or-roll-back; queued pastes show; quitting mid-paste asks.

**Independent Test**: paste a set over some existing names — one prompt per clash or one with apply-to-all; cancel a
large paste and roll back — target and sources as before.

### Engine: clashes, replace, merge

- [x] T042 [P] [US5] Write failing integration tests in `ui/tests/integration/transfer-clash.integration.test.ts` with a scripted `ClashAsker`: a file clash asks once with `ClashQuestion` (name, target folder, both sides' size and modified time, `newer` marked, `permanentReplace`) and nothing in the target changes before the answer (FR-017, SC-006); Replace with `replaceMode: 'recycle'` trashes the existing item (trash double records path and time) then lands the incoming one; Replace with `'permanent'` deletes it and leaves it out of the undo entry (FR-018f); Skip leaves both and keeps the source on the clipboard (FR-018a); Keep both lands `name copy.ext`; apply-to-all answers every later clash in the same job without asking and does not carry into the next job; a folder/folder clash merges — non-clashing children land, `docs/guide/img/logo.png` lands at its relative path while only `docs/guide/intro.md` is asked about (FR-018c, FR-018e, US5 AS6); a cut merge removes the source folder only once empty; a file/folder clash offers Replace (existing to the Recycle Bin) and never merges; re-pasting the same set asks about every item (US5 AS7); the same rules hold for a paste within one project (US5 AS5); a job with no clash never asks (FR-018d)
- [x] T043 [US5] Implement clash discovery, the `ClashAsker` port, the decision cache, Replace/Skip/Keep both and folder merge at depth in `ui/src/main/transfer-service.ts` (replacing T017's stub), reading `explorer.replaceMode` through an injected settings reader
- [x] T044 [P] [US5] Write failing integration test in `ui/tests/integration/transfer-undo-entry.integration.test.ts`: a job that replaced something returns a `paste` entry (`moved`, `copied`, `replaced` with `trashedAt`) and a copy that replaced something is therefore undoable (FR-018b, FR-022); a cut with one failure returns a `move` entry of exactly the moved items (FR-023); a cross-project cut's entry carries `id` and `projects: {source, target}`
- [x] T045 [US5] Build the undo entry from the journal in `ui/src/main/transfer-service.ts` (fresh `id`, `projects` when source and target project differ)

### Engine: cancel, roll back, queue

- [x] T046 [P] [US5] Write failing integration tests in `ui/tests/integration/transfer-cancel.integration.test.ts`: `cancel(jobId)` during a large file's copy aborts it, removes the partial file and leaves its source intact, then waits in `awaiting-cancel-choice`; `finishCancel('keep')` returns `outcome: 'kept'` with the landed items, not-started items skipped, and an undo entry of exactly what landed (FR-019a, FR-019b); `finishCancel('rollback')` removes every placed copy, moves every moved item back (cross-volume by copy-then-remove), restores every replaced item from the trash double, returns `undo: null`, and names any item it could not restore in `rollbackFailures` (edge case *Roll back cannot finish*, SC-007); Cancel answered from the clash prompt behaves identically; after a cancelled cut (either choice) the clipboard holds exactly the items that did not move, and after a cancelled copy it is unchanged (FR-019c); a queued job cancelled before it starts never runs and asks nothing (FR-019d); a second job queued behind a running one runs after it with the clipboard snapshot taken when its paste was requested (the `transfer.paste` call), not when it begins running (FR-019d); Cancel stops before the next item begins (SC-008)
- [x] T047 [US5] Implement cancel (AbortController per job), the cancel-choice wait, keep finished, roll back from the journal in reverse, and queued-job cancel in `ui/src/main/transfer-service.ts`; a lost owner window answers Cancel → Keep finished (R9)

### Notification model widening (R8)

- [x] T048 [P] [US5] Write failing component tests in `ui/tests/component/notice-update.test.ts`: `notify` returns the new notice's id; `update(id, patch)` changes that card's message, severity and body in place (same DOM node, no second card), files one log record when severity changes, and is a no-op for a dismissed id; every existing `notify` caller compiles unchanged
- [x] T049 [US5] Implement `notify(...): string` and `update(id, patch)` in `ui/src/renderer/common/notification.tsx`

### Progress notice, prompts

- [x] T050 [P] [US5] Write failing component tests in `ui/tests/component/paste-progress-notice.test.ts` (fake timers) per contracts/ui-surfaces §2: no notice before 1 s; at 1 s one `paste-progress` notice with `done of total` (digit-grouped) and the current item; the cancel control is an icon button titled `Cancel paste` and calls `transfer.cancel`; a queued run shows `Paste queued` with its own cancel at once; a run ending without failures dismisses its notice; a run ending with failures turns the SAME notice into the error report listing each item; a run that fails inside 1 s raises the error notice directly; the notice stays when the active project changes (FR-019)
- [x] T051 [US5] Implement `ui/src/renderer/explorer/paste-runs-store.ts` and `ui/src/renderer/explorer/paste-progress-notice.tsx` (fed by `transfer.onProgress` / `onDone`), mounted once per window in `ui/src/renderer/app.tsx` beside `AppClosePrompt`; remove the per-call failure reporting T028 added in favour of the run's notice, updating T027's failure assertion to read the run's notice (still exactly one)
- [x] T052 [P] [US5] Write failing component tests in `ui/tests/component/clash-prompt.test.ts` per contracts/ui-surfaces §1: an `onClash` question opens `clash-dialog` naming the item and folder; both sides' size (digit-grouped) and modified time, or item count for a folder, with the newer side labelled; Enter answers Replace, Escape answers Cancel; the `clash-apply-all` checkbox is reachable by Tab and its state is sent with the choice; under `permanentReplace` the Replace label reads `Replace (cannot be undone)`; each answer reaches `transfer.resolveClash(requestId, ...)`
- [x] T053 [US5] Implement `ui/src/renderer/explorer/clash-prompt.tsx` (host listening on `transfer.onClash`, `useChoose` with the details table and checkbox), mounted in `ui/src/renderer/app.tsx`
- [x] T054 [P] [US5] Write failing component tests in `ui/tests/component/paste-cancel-choice.test.ts`: `onCancelChoice` opens `Cancel paste?` with `Keep finished` / `Roll back`; each sends `transfer.finishCancel(jobId, 'keep' | 'rollback')`; Escape sends `'keep'`
- [x] T055 [US5] Implement the cancel-choice host in `ui/src/renderer/explorer/clash-prompt.tsx` (same host, second listener)

### Quit while a paste runs (FR-019f)

- [x] T056 [P] [US5] Write failing integration test in `ui/tests/integration/transfer-quit.integration.test.ts` for the close-flow gate extracted to `ui/src/main/transfer-quit-gate.ts`: not busy → proceeds at once; busy → sends `throng:transfer:quitPrompt` and waits; `wait` proceeds once the queue drains; `keep` / `rollback` cancel every queued and running job with that choice, then proceed; `dismiss` abandons the close and leaves the jobs running
- [x] T057 [US5] Implement `ui/src/main/transfer-quit-gate.ts` and call it first in the main window's `close` handler in `ui/src/main/main.ts` (before the terminals prompt), re-entering the existing flow when it proceeds
- [x] T058 [P] [US5] Write failing component test in `ui/tests/component/paste-quit-prompt.test.ts` per contracts/ui-surfaces §4: `onQuitPrompt` opens `A paste is still running` with `Wait` / `Cancel pastes`; Cancel pastes then asks Keep finished / Roll back; Escape sends `dismiss`
- [x] T059 [US5] Implement `ui/src/renderer/explorer/paste-quit-prompt.tsx`, mounted in `ui/src/renderer/app.tsx`

**Checkpoint**: nothing is overwritten unasked; long pastes are visible, cancellable and reversible.

---

## Phase 6: User Story 3 — Undo a move between projects (P2)

**Goal**: Ctrl+Z in either project undoes a cross-project move once; the other project's stacks follow; it survives a
restart.

**Independent Test**: cut-paste A→B, Ctrl+Z in B → back in A; repeat with Ctrl+Z in A; Redo puts it back.

- [x] T060 [P] [US3] Write failing integration tests in `ui/tests/integration/transfer-apply-undo.integration.test.ts`: `applyUndo(crossProjectMove, 'undo')` moves the item back from B to A inside `exclusive` and the move bracket (editors follow, US3 AS1); `'redo'` re-applies it; a `paste` entry's undo removes the pasted items and restores the replaced one from the trash double (FR-018b), its redo re-applies; a stale entry (target edited away, name re-occupied) is refused by `validate` with nothing changed (US3 AS4, FR-021); any path outside every project root is refused before any change (plan *Re-evaluation*, I); `exists(absPaths)` answers `false` outside every root
- [x] T061 [US3] Implement `applyUndo` and `exists` in `ui/src/main/transfer-service.ts` (confine every path, `validate`, apply moves / removals / trash restores, bracket the moves)
- [x] T062 [P] [US3] Write failing component tests in `ui/tests/component/explorer-cross-project-undo.test.ts` with a `FileOpUndoClient` double holding A's and B's stacks: a `done` cross-project cut records the entry in the active (B) stack AND in A's persisted stack; Ctrl+Z in B calls `transfer.applyUndo` once, moves the entry to B's redo, removes it by id from A's undo and pushes it onto A's redo (FR-020, US3 AS3); Ctrl+Z from A behaves symmetrically; a refused undo leaves both stacks unchanged and raises the 024 FR-008a notice; an entry naming a project that no longer exists is dropped on load; existing within-project `move`/`rename`/`delete` entries still apply through the root-relative bridge
- [x] T063 [US3] Implement the two-stack recording and by-id sync in `ui/src/renderer/explorer/use-explorer-data.ts` (`pushUndo` for entries with `projects`; `applyEntry` routes entries with `projects` or kind `paste` to `transfer.applyUndo`; `undoFileOp` / `redoFileOp` update the other project's stack through `fileOpUndo.load/save`; load drops entries via `dropEntriesNamingProjects` with the projects store's ids)
- [x] T064 [P] [US3] Write failing integration test in `ui/tests/integration/fileop-undo-cross-project-persist.integration.test.ts` over the daemon's `FileOpUndoRepository` (as `undo-persistence` tests do): a cross-project entry saved into both projects' stacks reads back from each after a reopen, and counts toward each stack's 50-entry bound (FR-021, US3 AS5)
- [x] T065 [US3] No production change expected: T005's `parse` widening is what lets a cross-project entry round-trip through `FileOpUndoRepository`; if T064 is red, the fix is in `core/src/fileop-undo/undo-stack.ts` `isEntry`; T064 green

**Checkpoint**: a cross-project move is reversible from either side, across restarts.

---

## Phase 7: User Story 4 — The root row survives the keyboard (P2)

- [x] T066 [US4] Failing component test then fix: Left arrow and Space on the root row leave the tree's expansion unchanged; Left arrow on an open subfolder still collapses it (FR-030, SC-005) — `ui/src/renderer/explorer/file-tree.tsx`, `ui/src/renderer/explorer/tree-node.tsx`, `ui/tests/component/explorer-tree-interaction.test.ts` (commit `0fc44e5f`, Fixes #448)

---

## Phase 8: Polish & Cross-Cutting

- [x] T067 [P] Write the two E2E declarations in `ui/tests/e2e/explorer-cross-project.e2e.ts`, both `{ tag: ['@extended', '@explorer', '@reserve:runtime'] }` on one line each, with two seeded project roots: (1) copy a file in A, switch to B, the context menu reads `Paste "<file>" from <A>`, paste lands it in B and A keeps it; then cut a file open in an editor in A, switch to B and back (row greyed), paste in B — the editor shows B's path, is not dirty, no notice (US1, US2, SC-001, SC-002); (2) after that move, Ctrl+Z in A's explorer returns the file to A and the editor follows; B's Undo is no longer offered (US3 AS1–AS3, SC-003). Re-seed `ui/tests/e2e/e2e-budget.json` (`total` +2, `@explorer` +2) with the one-sentence justification in its `note`: a real project switch remounts the tree from a new root and a real editor in the same window must follow a file between two roots, which no lower layer composes
- [x] T068 [P] Document the setting in `docs/preferences.md` (`explorer.replaceMode`, beside `explorer.deleteMode`) and cross-project paste, clash prompt, progress/cancel and cross-project undo in the File Explorer section of the user docs (load `throng-docs`; run its audit); `ui/tests/unit/docs-currency.test.ts` green
- [x] T069 Delete the now-unused renderer `ClipboardState` relative-path type and any dead `files.copy`/`files.move` paste/drag code left in `ui/src/renderer/explorer/use-explorer-data.ts`; `npm run lint` and `npm run typecheck` clean
- [x] T070 Run quickstart.md's automated block and walk its by-hand table into the branch's manual test plan (`planning-manual-tests`)

---

## Dependencies & Execution Order

- **Phase 2** blocks everything. Inside it: T003 ← T002; T005 ← T004; T007 ← T006; T009 ← T008; T011 ← T010;
  T013 ← T012; T015 ← T007, T014; T017 ← T003, T005, T011, T013, T016; T019 ← T017, T018; T021 ← T015, T017, T020;
  T022 ← T021; T024 ← T022, T023.
- **US1 (Phase 3)** ← Phase 2. **US2 (Phase 4)** ← Phase 2; T041 also ← T017. US1 and US2 are independent of each
  other.
- **US5 (Phase 5)** ← Phase 2 (engine) and T028 (paste routing). T043 ← T017; T045 ← T043; T047 ← T043; T051 ← T049;
  T057 ← T047.
- **US3 (Phase 6)** ← T005, T045 (entries carry `id`/`projects`).
- **US4** done.
- **Polish** ← all stories.

## Parallel Opportunities

- Phase 2 test tasks T002, T004, T006, T008, T010 touch different files and run together; their implementations
  T003, T005, T007, T009, T011 likewise.
- Across boundaries once Phase 2's IPC (T022) lands: renderer work (T025–T032, T037–T038, T048–T055, T058–T059,
  T062–T063) runs beside main work (T033–T036, T039–T047, T056–T057, T060–T061).

## Implementation Strategy

MVP is Phase 2 + US1: one application clipboard and cross-project copy. US2 completes #7's move half; US5 makes
every clash and long paste the user's decision; US3 makes the move reversible from both sides. Each phase ends at a
checkpoint that can be shown and hand-tested on its own.

## Phase 9: Convergence

- [x] T071 Amend FR-025 to require Paste enabled in the context menu only — the explorer toolbar has no Paste control and 004 FR-020 never gave it one per FR-025 (contradicts)

## Phase 10: Iteration 2 — after manual testing (FR-031 – FR-034)

**Purpose**: Session 2026-10-03 (fifth). Progress only for a paste over 5 MB (MT-04), a clearer clash prompt
(MT-03), structure kept across folders (MT-08), no-entry cursor (MT-09). Research R14 – R17. No defects handed over.

**No new E2E** (Principle V, lowest layer that proves it): FR-031 is decided in main (integration T077) and
raised by the renderer (component T079); FR-032 is markup and theme (component T081 + MT-03); FR-033 is a main
engine rule (integration T083) with its routing in the renderer (component T085); FR-034 is a `dropEffect` the
renderer sets — Playwright cannot see the OS cursor, so the component test (T087) and MT-09 own it.

**Order**: T072 → T078; T073 → T074 → T084; T075 → T076 → T084, T086; T078 and T084 share
`transfer-service.ts` and run one after the other; renderer tasks follow the core ones they import.

**Foundational (core, blocks the rest)**

- [x] T072 [P] Add `display: boolean` to `TransferProgress` and export `PROGRESS_MIN_BYTES = 5 * 1024 * 1024` and `PROGRESS_WORK_MS = 1000` in `core/src/explorer/transfer-contract.ts`; re-export from `core/src/explorer/index.ts` and `core/src/index.ts` (R14, FR-031)
- [x] T073 [P] Write failing unit tests for `landingPlan(sources, targetDir)` in `core/tests/unit/transfer-plan.test.ts`: `/r/test/test.md` + `/r/test.md` → `targetDir/test/test.md` dir and `targetDir` dir; one shared parent → every item in `targetDir`; a source inside another selected source is dropped; case-insensitive parent comparison on Windows spellings (R16, FR-033, SC-010)
- [x] T074 Implement `landingPlan` in `core/src/explorer/transfer-plan.ts` (returns `{ src, destDir }[]` in input order, nested sources removed) and export it (R16)
- [x] T075 [P] Write failing unit tests in `core/tests/unit/fileop-undo.test.ts`: a `move` and a `paste` entry with `createdDirs` parse round-trip, a malformed `createdDirs` is dropped by `parse`, and `plannedMoves` is unchanged by it (R16, FR-033)
- [x] T076 Add optional `createdDirs?: string[]` to the `move` and `paste` kinds in `core/src/fileop-undo/undo-stack.ts` (`isEntry` accepts a string array or absence) (R16)

**FR-031 — progress only when it is worth it (MT-04)**

- [x] T077 [P] [US5] Write failing integration tests in `ui/tests/integration/transfer-progress-display.integration.test.ts` on the real engine: a ≤5 MB paste with a clash question held open for 2 s never emits `display: true`; a >5 MB paste emits `display: true` only after 1 s of work, and time a clash question is open is not counted; a queued paste emits `display: true` at once; drags never emit progress (R14, FR-031, SC-009)
- [x] T078 [US5] Implement in `ui/src/main/transfer-service.ts`: size the job in `prepare` (sum of file sizes under every source via `fs.stat`/`fs.modifiedAt`), a work clock that starts with the first item and pauses in `decide` and `askCancelChoice`, and `display` on every progress event (R14)
- [x] T079 [P] [US5] Write failing component tests in `ui/tests/component/paste-progress-notice.test.ts`: the card is raised only when an event carries `display: true` (no renderer timer); a small paste whose clash prompt is open raises no card; a `display: true` queued event raises it at once (FR-031, SC-009)
- [x] T080 [US5] Implement in `ui/src/renderer/explorer/paste-progress-notice.tsx`: drop `PROGRESS_DELAY_MS` and the timer; raise on first `display: true`; failure reporting unchanged (FR-031)

**FR-032 — the clash prompt layout (MT-03)**

- [x] T081 [P] [US5] Write failing component tests in `ui/tests/component/clash-prompt.test.ts`: two `.clash-side` boxes, incoming first then existing, an `aria-hidden` arrow between them, the newer box carries `.clash-side--newer` and still says "Newer", the boxes name their side in words (FR-032)
- [x] T082 [US5] Implement in `ui/src/renderer/explorer/clash-prompt.tsx` and style `.clash-*` in `ui/src/renderer/theme.css` with theme tokens only (no literal colours): boxes, arrow, newer highlight, gaps between message, boxes, apply-to-all and buttons (R15, FR-032)

**FR-033 — structure kept across folders (MT-08)**

- [x] T083 [P] [US1] Write failing integration tests in `ui/tests/integration/transfer-structure.integration.test.ts`: `/test/test.md` + `/test.md` pasted into `/test2` (same project and another project) land at `/test2/test/test.md` and `/test2/test.md`; `/test/a.md` + `/b.md` copied onto the root lands `a copy.md` in `/test` (a cut: a no-op for `a.md`); undo leaves a created folder the user has since put a file in; an existing `/test2/test` is merged into with a clash question for an existing file; a file named `test` where a folder is needed fails that item, named; a cut leaves `/test` in place; roll back removes the created `/test2/test`; the undo entry carries `createdDirs`; `applyUndo` undo removes it once empty and redo recreates it; a drag of the same selection lands the same way (R16, FR-033, SC-010)
- [x] T084 [US1] Implement in `ui/src/main/transfer-service.ts`: place each source via `landingPlan`, `mkdir` missing intermediate folders journalled as `createdDir`, roll back removes them newest first when empty, `buildUndo` adds `createdDirs`, `applyUndo` removes/recreates them (R16)
- [x] T085 [P] [US1] Write failing component test in `ui/tests/component/explorer-cross-project-undo.test.ts`: a within-project `move` entry carrying `createdDirs` (no `projects`) is applied through `transfer.applyUndo`, not `files.move` (R16)
- [x] T086 [US1] Route `createdDirs` entries to `transfer.applyUndo` in `applyEntry` in `ui/src/renderer/explorer/use-explorer-data.ts` (R16)

**FR-034 — no-entry cursor (MT-09)**

- [x] T087 [P] [US2] Write failing component tests in `ui/tests/component/drag-no-entry.test.ts`: a tree drag `dragover` over an element no target claimed — a Projects pane row included — ends with `dropEffect === 'none'` (`file-tree.tsx`'s window listener, registered after react-dnd's backend, so its value is the one that stands); an OS `Files` drag over nothing ends with `dropEffect === 'none'` and its `drop` is still prevented (`useNoDropNavigation`); a target that chose `copy` still gets `copy` (R17, FR-034, SC-011)
- [x] T088 [US2] Implement in `ui/src/renderer/explorer/file-tree.tsx` (fallback `'none'` instead of `'copy'`) and `ui/src/renderer/composition-root.tsx` (`useNoDropNavigation` sets `dropEffect = 'none'` on an unclaimed `dragover`) (R17, FR-034)

**Close-out**

- [x] T089 Grep the E2E specs for what FR-031 and FR-034 change (a progress notice expected for a small paste, a `copy` effect over a non-target) and fix any made stale; they run in the heavy gate on CI — never as a local batch. `explorer-cross-project.e2e.ts` may run alone locally
- [x] T090 Document FR-033 and FR-031 at tour depth in `docs/quick-start.md` (items from several folders keep their structure; progress for large pastes), rewording any text that says progress shows after 1 second; run the `throng-docs` audit
- [x] T091 Widen MT-03, MT-04, MT-08 (add `core/src/fileop-undo/undo-stack.ts`, `core/src/explorer/transfer-plan.ts`) and MT-09 `Paths:` in the manual test plan to the files that now implement them
