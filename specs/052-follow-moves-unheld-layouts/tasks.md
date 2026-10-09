# Tasks: Follow Moves Into Unheld Layouts

**Input**: Design documents from `specs/052-follow-moves-unheld-layouts/`.

**Prerequisites**: plan.md, spec.md, research.md (R1–R9), data-model.md, contracts/workspace-rpc.md,
contracts/editor-replace.md.

**Tests**: test-first is constitutional (Principle V). Every task writes its failing test first, at the layer
research R9 names, runs it, and reads why it fails before writing the code.

**Format**: `[ID] [P?] [Story] Description`.

## Phase 1: Setup

- [x] T001 Add the three method constants (`workspace.followMoves`, `workspace.saveSubWorkspace`,
  `workspace.deleteSubWorkspaces`) and their param/result types to `packages/ipc-contract/src/workspace.ts`. Use the
  shapes in contracts/workspace-rpc.md verbatim.

## Phase 2: Foundational (blocks US1 and US2)

- [x] T002 [P] Write failing unit tests for R6's rule in `packages/core/tests/unit/moved-paths.test.ts`:
  - a preview whose moved path another preview in the same layout already shows keeps its old `filePath` and its
    history;
  - a preview moved in the same batch does not count as "already there";
  - a chain (A→B then B→C) ends at C;
  - `docs` does not match `docs-old`;
  - a case-only rename follows.

  Then add the collision rule to `moveLayoutTabs` in `packages/core/src/workspace/moved-paths.ts`.
- [x] T003 [P] Write failing integration tests in
  `packages/persistence/tests/integration/subworkspace-repository.integration.test.ts`:
  - `saveSubWorkspace` upserts one row, keeps an existing row's position, appends a new id last, and leaves sibling
    rows byte-identical;
  - `deleteSubWorkspaces` removes only the named ids.

  Then implement both in `packages/persistence/src/workspace-repository.ts` and add them to the port
  `packages/core/src/ports/workspace-store.ts`.
- [x] T004 Write failing daemon integration tests in
  `packages/daemon/tests/integration/workspace-follow-moves.integration.test.ts` (real SQLite):
  - unheld project and sub-workspace records are rewritten (editor `filePath`, preview `filePath`, history entries,
    `movedOut` across projects);
  - held ids are untouched;
  - an untouched record is not written (`updated_at` unchanged, FR-004);
  - a corrupt record is skipped, counted in `skipped` and left unchanged (FR-009);
  - a second identical call writes nothing;
  - SC-001 sweep: one project and two sub-workspaces, each referencing the moved file in an editor, a preview and
    history. After the call, no stored layout contains the old path anywhere (string search over the stored JSON);
  - Story 1 scenario 4: rename, then the undo pair, then the redo pair. Each step ends at the file's actual path;
  - FR-009: a store whose write throws for one record leaves it unchanged, writes the others, logs once and does not
    throw;
  - a `workspace.save` issued concurrently with `followMoves` keeps both changes (FR-005);
  - 50 records complete in under 100 ms (SC-005), with the measured duration logged.

  Then implement `workspace.followMoves`, `workspace.saveSubWorkspace` and `workspace.deleteSubWorkspaces` in
  `packages/daemon/src/workspace-service.ts`. `followMoves` runs as one better-sqlite3 transaction and takes project
  roots from the daemon's project store. The per-record write applies `migratePanelTitles`. Depends on T001–T003.

## Phase 3: User Story 1 — A rename reaches every saved layout (P1) 🎯 MVP

**Goal**: every in-app move rewrites every layout no window holds, without losing a concurrent write.

**Independent test**: close a sub-workspace holding `a.md`, rename `a.md`, reopen it — the editor shows the new
name, clean, with no notice.

- [x] T005 [US1] Write failing integration tests in
  `packages/ui/tests/integration/in-app-moves-follow-layouts.integration.test.ts`. Drive the real
  `createInAppMoveCallbacks` and `FilesService` against a fake daemon that records calls. Each of these must issue
  exactly one `workspace.followMoves` carrying the held set (FR-001):
  - a `files.rename`;
  - a `files.move`;
  - an undo of a rename;
  - a redo;
  - a transfer paste;
  - a transfer roll-back with the pairs still standing.

  A throwing walk does not fail the move. Then add the walk as the last isolated consumer in
  `packages/ui/src/main/in-app-moves.ts`. Reduce `packages/ui/src/main/moved-layout-walk.ts` to building `held` (the
  active project plus `windowManager.childIds()`) and one `workspace.followMoves` call, broadcasting
  `throng:subworkspace:changed:push` per changed sub-workspace id. Wire it in `packages/ui/src/main/main.ts`.
- [x] T006 [US1] Remove `afterMoves` and `movesLanded` from `packages/ui/src/main/transfer-service.ts` and its
  wiring in `main.ts`. Update `packages/ui/tests/integration/moved-layout-walk.integration.test.ts` to the new shape:
  the walk now issues one RPC. Depends on T005.
- [x] T007 [P] [US1] Write a failing integration test (SC-003) in
  `packages/daemon/tests/integration/workspace-follow-moves.integration.test.ts`. Run 50 alternating cycles of
  `followMoves` (renaming a path in closed sub-workspace S1) against `saveSubWorkspace` of open sub-workspace S2,
  each cycle's calls in flight together. S1 ends at the latest path, and S2 holds every change. Depends on T004.
- [x] T008 [P] [US1] Move `SubWorkspaceWorkspaceClient.save` in
  `packages/ui/src/renderer/state/subworkspace-window-client.ts` onto `workspace.saveSubWorkspace`, with a failing
  component test first in `packages/ui/tests/component/subworkspace-window-client.test.ts`. The save sends only its
  own record.
- [x] T009 [P] [US1] Move `packages/ui/src/renderer/workspace/detach-context.tsx` onto the per-record RPCs:
  - detach → `saveSubWorkspace(new)`;
  - sync-to-existing → `saveSubWorkspace(updated)`;
  - purge-panel → `saveSubWorkspace` per survivor plus `deleteSubWorkspaces(emptied)`.

  Write failing component tests first in `packages/ui/tests/component/detach-context-persist.test.tsx`: no call
  sends any other record.
- [x] T010 [P] [US1] Move `packages/ui/src/main/preview-purge.ts` onto the same pair of RPCs, and update
  `packages/ui/tests/integration/preview-purge.integration.test.ts` first.
- [x] T011 [US1] Write an E2E `@extended @persistence` test, `packages/ui/tests/e2e/subworkspace-rename-follow.e2e.ts`:
  open `a.md` in a sub-workspace, close it, rename `a.md` in the main window, reopen it. The editor shows the new
  name, clean, with no could-not-read notice. Use `runOwnApp`, as the test seeds a file. Re-seed
  `packages/ui/tests/e2e/e2e-budget.json` in the same commit.

## Phase 4: User Story 2 — Open windows follow every kind of move (P1)

**Goal**: every panel of every open window follows, including tabs not shown since launch.

**Independent test**: an editor on `a.md` in a never-shown tab; rename `a.md`; the persisted layout names the new
path.

- [x] T012 [US2] Write a failing component test in `packages/ui/tests/component/editor-moved-path.test.ts` (existing file, no JSX). An
  editor panel in an unmounted tab, with no `movedTo` relay, has its `filePath` rewritten on `throng:files:moved`,
  and the next `workspace.save` the store sends carries the new path. This is the restart outcome of Story 2
  scenario 1, observed at the save boundary.
  An already-relayed mounted editor is unchanged, because the rule is idempotent. Then make `MovedPathSync`
  (`packages/ui/src/renderer/editor/moved-path-sync.tsx`) apply core's `movedPanelConfig` to every editor panel in
  the layout on `files.onMoved` (FR-007).
- [x] T013 [US2] Add a failing case to `packages/ui/tests/integration/in-app-moves-follow-layouts.integration.test.ts`
  (FR-008): a loaded-but-inactive project is absent from `held` and is rewritten by the walk. Fix `held` if it
  includes it. Depends on T005. A move that throws in the walk raises no notice in any window (FR-009).
- [x] T023 [US2] Close R4's project-switch race (FR-005):
  - Add a failing case to `packages/daemon/tests/integration/workspace-follow-moves.integration.test.ts`: `only`
    restricts the walk to the named records and ignores `held`. Implement `only` in `workspace-service.ts`.
  - Then add a failing component test, `packages/ui/tests/component/workspace-store-inflight-follow.test.tsx`:
    `throng:files:moved` arriving while a project's save is in flight (`packages/ui/src/renderer/state/layout-saves.ts`)
    chains exactly one `workspace.followMoves({ moves, only: { projectIds: [that project] } })` after the save
    settles. No call is made when no save is in flight.
  - Implement it in `packages/ui/src/renderer/state/workspace-store.tsx`.

  Depends on T004, T012.

## Phase 5: User Story 3 — Replacing a file that is open (P2)

**Goal**: after Replace onto an open file, and after its undo, there is exactly one buffer per path and no edit is
lost (FR-010 – FR-013).

**Independent test**: open `a.md` and `b.md`, cut `a.md`, paste onto `b.md`, Replace. One buffer names `b.md`, and
both panels show it.

- [x] T014 [US3] Write failing integration tests in `packages/ui/tests/integration/editor-one-buffer.integration.test.ts`
  (real coordinator and registry) for the clean case:
  - `markMoved` of A onto clean B's path disposes B's document and links B to A;
  - the registry has one claim (FR-010, SC-004);
  - a change dispatched through B's panel id edits A's document;
  - a relay for A is also sent under B's id.

  Then implement `links` and relay fan-out in `packages/ui/src/main/editor-coordinator.ts`, with `dispatchChange`,
  `undo`, `redo`, `save` and `revert` resolving a linked id to its owner (contracts/editor-replace.md).
- [x] T015 [US3] Add failing cases to the same file:
  - `destroy(owner)` with a link hands the document to the linked panel (relay `linkedTo: null`, no reload, no lost
    buffer);
  - `destroy(linked)` removes only the link.

  Then implement them in `editor-coordinator.ts`. Depends on T014.
- [x] T016 [US3] Add failing cases to the same file for the dirty case (FR-012):
  - B is dirty → B becomes `replaced`: buffer and dirty state kept, no claim, relay `replaced: true`;
  - a plain save is refused with "This file was replaced. Use Save As to keep your changes.";
  - Save As makes it ordinary at the new path;
  - `discardReplaced` links it to the owner.

  Then implement them in `editor-coordinator.ts`, with the IPC for `discardReplaced` in
  `packages/ui/src/main/editor-ipc.ts` and preload. Depends on T014.
- [x] T017 [US3] Write a failing integration test for undo (FR-013, SC-004) in
  `packages/ui/tests/integration/transfer-clash.integration.test.ts`. Use the real `TransferService` and
  coordinator: Replace A onto open B (clean, then dirty), then undo. A is back at `a.md`. A linked B unlinks and loads
  the restored `b.md`. A replaced B re-claims `b.md` and is still dirty. Each open path has exactly one buffer. Then
  implement the unlink and re-claim in `markMoved` and `markRestored`. Depends on T015, T016.
- [x] T018 [P] [US3] Write integration tests that pin today's behaviour when only `b.md` is open:
  - clean `b.md` reloads to the moved content, with one buffer;
  - dirty `b.md` keeps its buffer (FR-011, FR-012 when A is not open).

  Put them in `packages/ui/tests/integration/transfer-clash.integration.test.ts`. They should pass as written. If
  either fails, fix it in `editor-coordinator.ts`.
- [x] T019 [US3] Write a failing component test, `packages/ui/tests/component/editor-linked-panel.test.tsx`:
  - a mount whose config has `linkedTo` set, with the owner open, attaches to the owner's document;
  - with the owner absent, it drops `linkedTo` and loads `filePath`;
  - `MovedPathSync` writes and clears `linkedTo` from the relay.

  Then implement this in the editor mount (`packages/ui/src/renderer/editor/use-editor.ts`) and
  `moved-path-sync.tsx`, and add `linkedTo?: string` to the editor panel config type in `packages/core`. Per the data
  model: "`linkedTo` is never rewritten — panel ids do not move". Depends on T014.
- [x] T020 [US3] Write a failing component test, `packages/ui/tests/component/editor-replaced-notice.test.tsx`:
  - a replaced document shows one inline notice ("`b.md` was replaced by a moved file. Your unsaved changes are kept
    here.") with Save As… and Discard;
  - Ctrl+S shows the refusal in that same notice, not a second one;
  - Discard calls `discardReplaced`.

  Then implement the notice in the editor panel, following `throng-failure-notices`. Depends on T016.

## Phase 6: Polish

- [x] T021 [P] Add a sentence to `docs/architecture.md`'s persistence section on the follow-moves walk and per-record
  sub-workspace writes. Load `throng-docs`, and run `packages/ui/tests/unit/docs-currency.test.ts`.
- [x] T022 Run quickstart.md's automated block, and record the 50-record duration in research.md R2.

## Dependencies

- T001 → T003, T004.
- T002 and T003 → T004.
- T004 → T005 → T006.
- T004 → T007.
- T004 and T012 → T023.
- T005 → T013.
- US1's walk (T005) is the MVP.
- US2 (T012) is independent of US1 apart from T013.
- US3 (T014–T020) is independent of US1 and US2.
- T008, T009 and T010 are independent of one another and need only T004.

## Parallel examples

- After T004: T007 (daemon test), T008 (renderer client), T009 (detach-context) and T010 (preview-purge) touch
  disjoint files.
- US3 runs alongside US1. T018 has no dependency.

## Implementation strategy

MVP is US1 (T001–T011): rename reaches every closed layout. US2 and US3 follow as independent increments; US3 is the
largest and touches only the coordinator, the editor mount and their tests.

## Phase 7: Convergence

- [x] T024 Persist the replaced state in the editor panel config (as `movedOut` is) and restore it on mount, so after a restart the replaced notice shows and a plain Save is refused, per FR-012 (partial)
- [x] T025 Apply `throng:files:moved` to a project layout whose load was in flight when the move arrived, per FR-005 (partial)
- [x] T026 Count and log corrupt sub-workspace rows in `workspace.followMoves`, leaving them unchanged, per FR-009 (partial)
- [x] T027 Add the missing wiring and concurrency cases (a `workspace.save` concurrent with `followMoves`; a transfer roll-back, a Replace, and undo/redo of `files.move` reaching the walk; a throwing walk raising no notice) to `workspace-follow-moves.integration.test.ts` and `in-app-moves-follow-layouts.integration.test.ts`, per T004/T005/T013 (partial)
- [x] T028 Limit `markMoved`'s on-disk check to documents that have linked panels, and never unlink when a move's `from` and `to` are the same path (a case-only rename), per Edge Cases "case-only rename" (partial)
- [x] T029 Update the stale `persistSubWorkspaces` comment in `packages/ipc-contract/src/subworkspaces.ts` to name `workspace.saveSubWorkspace`, per R3 (unrequested)

## Phase 8: Convergence

- [x] T030 Add a cut roll-back case where one item cannot be put back, asserting the bracket closes with that pair still standing (so the walk ends at the file's actual path), per T005/T027 and Edge Cases "The move fails or is rolled back" (partial)
