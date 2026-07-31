# Tasks: v1.0.0 Defects & Tweaks

**Feature**: `specs/026-v1-defects-and-tweaks` · **Branch**: `feature/S026-v1-defects-and-tweaks`

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md) · [research.md](./research.md) ·
[data-model.md](./data-model.md) · [contracts/](./contracts/)

## How this list is unusual

**Most of the Red step is already done.** 29 tests are committed — 16 failing, each observed failing
for the reason its issue reports. Those tasks are marked **[R✓]**: the failing test exists, so the task
is Green-only. Do not rewrite them to match whatever you implement; if one seems wrong, that is a
finding to raise, not an assertion to adjust.

Three behaviours discovered during planning have **no** test yet and take a full Red step first.

`[P]` = parallelisable (different files, no ordering dependency). The six issues are independent, so
almost everything is `[P]` across issues; within an issue, order matters.

**Layers**: `unit` = `packages/**/tests/unit` · `integration` = `packages/**/tests/integration` ·
`e2e` = `packages/ui/tests/e2e/*.e2e.ts` (Playwright + Electron). There is no component-test stack.

---

## Phase A — Foundation (blocks nothing else, do first)

- [ ] **T001** Confirm the baseline is exactly the 9 expected failures at the vitest layers, so nothing
      later is misattributed. Run `npx vitest run --project unit --project integration --project contract`
      and record counts. Expected: unit 5 failed / 1595 passed, integration+contract 4 failed / 423 passed.

---

## Phase B — #194 case-only rename (US1, P1)

- [ ] **T002** [P] [R✓] **Green**: in `packages/ui/src/main/files-service.ts` `renameInBracket`, skip the
      `exists(dest)` collision probe when the requested leaf equals the current leaf case-insensitively
      — the destination is this item (research R2). Leave the byte-identical no-op guard above it
      untouched so FR-002 still short-circuits first.
      *Satisfies*: FR-001, FR-004 · *Turns green*: 3 in `rename-case-only.integration.test.ts`
      *Must stay green*: the 2 fences in that file (no-op moves nothing; different sibling still refused)
- [ ] **T003** [P] **Red→Green**: `packages/core/src/explorer/naming.ts` — `validateRename` must not
      report an item as colliding with itself. Add an optional current-name parameter; when supplied,
      that sibling is excluded from the case-insensitive comparison. Write the failing unit test first
      in `packages/core/tests/unit/explorer-ops.test.ts` (extend the existing rename-validation block).
      *Satisfies*: FR-005 · **Note**: the function has no callers; this makes the two rules agree
      rather than deleting an export.
- [ ] **T004** Verify FR-004 by hand-reading the bracket: a case-only rename must still call
      `onMoveStarted`/`onMoved`, because the path changes. The committed test already asserts this —
      confirm it passes rather than assuming.

---

## Phase C — #186 file tree liveness (US2, P1)

Ordered: the seam widens (T005) before its implementation (T006–T008) before its consumers (T009–T011).

- [ ] **T005** Widen the `IFileWatcher` seam with the optional trailing `WatchOptions { onFailed }`
      per [contracts/file-watcher.md](./contracts/file-watcher.md). Both existing call sites must
      compile unchanged.
      *Satisfies*: FR-010a (makes it expressible)
- [ ] **T006** [R✓] **Green**: `node-file-watcher.ts` — add `maxWaitMs` (default 1000). Record the
      burst's start; when `maxWaitMs` has elapsed since it, fire immediately instead of rescheduling.
      *Satisfies*: FR-006 · *Turns green*: the churn test in `file-watcher-liveness.integration.test.ts`
      *Must stay green*: the coalescing fence in the same file (SC-003)
- [ ] **T007** [R✓] **Green**: `node-file-watcher.ts` — on `'error'`, close the dead handle and
      re-establish on a bounded backoff; call `onFailed` once when attempts are exhausted.
      *Satisfies*: FR-010, FR-010a · *Turns green*: 1 in `file-watcher-error-recovery.test.ts`
      *Must stay green*: the dispose fence in the same file
- [ ] **T008** `node-file-watcher.ts` — `dispose()` must cancel the debounce timer **and** any pending
      retry, close the handle, and latch so no later `onChange`/`onFailed` fires.
      *Satisfies*: FR-011
- [ ] **T009** [P] **Red→Green**: diagnostics for the watcher. New unit test
      `packages/ui/tests/unit/watcher-diagnostics.test.ts` asserting a record is written for a failure,
      each retry, and the escalation. Then implement against the existing diagnostic logger.
      *Satisfies*: FR-010b, SC-013
- [ ] **T010** Wire the failure through: `explorer-watcher.ts` forwards `onFailed`; `main.ts` turns it
      into a user-facing notice.
      *Satisfies*: FR-010a
- [ ] **T011** [P] **Red→Green**: in-app delete reconciles and rolls back. New E2E
      `packages/ui/tests/e2e/explorer-delete-rollback.e2e.ts`: a delete removes the node at once, and a
      delete that **fails** puts it back with an error. Then implement in `use-explorer-data.ts`
      `remove()` — it is the one mutation that never calls `reloadDirs`.
      *Satisfies*: FR-009, FR-009a, SC-012 · *Must stay green*: all 4 in `explorer-live-sync.e2e.ts`

---

## Phase D — #161 stranded editor (US3, P1) — **NOT DELIVERED, see note**

> **Status 2026-07-30**: attempted and REVERTED. The banner, the Reload from disk menu action and
> auto-recovery were all implemented and two of the three committed tests went green — but the work
> reddened `editor-missing-aggregate.e2e.ts` on both its cases (FR-100/FR-105: the tab-open "cannot
> open file" notice fired on remounts it must not). Reverted to keep the branch green rather than
> ship a regression in exchange for a fix. The cause is in the renderer's editor state/notice
> interaction, not in the design; see the commit message on the revert for what was learnt.

Ordered: state (T012) → operations (T013–T014) → presentation (T015–T017) → trigger (T018).

- [ ] **T012** `editor-coordinator.ts` — add the additive `unloadable` flag per
      [contracts/editor-unloadable.md](./contracts/editor-unloadable.md); set it when a read of the
      path fails, clear it on any successful read, and carry it on the existing sync message.
      **It must not touch `dirty`** — that is what separates it from `fileMissing`.
      *Satisfies*: FR-013 (state half)
- [ ] **T013** `editor-coordinator.ts` — `reloadFromDisk(panelId)`: re-read the path and replace the
      document through the existing document-replace path. Must work from the unloadable state.
      *Satisfies*: FR-015, FR-019
- [ ] **T014** `editor-coordinator.ts` — `retryUnloadable(paths)`: re-attempt every unloadable document
      under those paths; idempotent.
      *Satisfies*: FR-014 (mechanism)
- [ ] **T015** [R✓] **Green**: `editor-panel.tsx` + `editor-panel.css` — render the banner above the
      content inside `.editor-panel-wrap` when `unloadable`, with testid
      `editor-unloadable-<panelId>`, naming the path, saying the text below is the last content read,
      and offering **Reload from disk**. Remembered text stays visible. Themed tokens only — no literal
      colours (the no-inline-artwork guard walks CSS and TSX).
      *Satisfies*: FR-013 · *Turns green*: the restart test in `editor-stranded-recovery.e2e.ts`
- [ ] **T016** [R✓] **Green**: add **Reload from disk** to the panel header menu in
      `panel-placeholder.tsx`, beside Revert, with its chord if bound. Wire the action through
      `use-editor.ts` / `editor-actions.ts`.
      *Satisfies*: FR-015, FR-018 (Constitution VI) · *Turns green*: the Reload test in the same file
- [ ] **T017** **Red→Green**: save guard. New E2E `packages/ui/tests/e2e/editor-unloadable-save.e2e.ts`:
      saving while unloadable asks first and proceeds on confirm. Then implement.
      **Never block, never redirect to Save As** — the buffer may be the only copy.
      *Satisfies*: FR-013a
- [ ] **T018** `main.ts` — on the existing file-change broadcast, call `retryUnloadable` (research R5).
      This is auto-recovery; no new watcher.
      *Satisfies*: FR-014 · *Must stay green*: the live move-away-and-back fence in
      `editor-stranded-recovery.e2e.ts`
- [ ] **T019** Confirm `revert()` is untouched and still refuses when `savedText === null`.
      *Satisfies*: FR-017

---

## Phase E — #197 project re-entry (US4, P2)

- [ ] **T020** [R✓] **Green**: `use-explorer-data.ts` `onRename` — migrate open state by prefix into
      `pendingOpen` exactly as `drop` does, and persist when it applies. Reuse `drop`'s logic; do not
      write a second implementation (Principle VIII).
      *Satisfies*: FR-020 · *Turns green*: 2 in `explorer-rename-reentry.e2e.ts`
- [ ] **T021** [R✓] **Green**: `use-explorer-data.ts` — give the restore read a non-reporting mode so an
      unresolvable persisted path is discarded silently, while a user-initiated listing still reports.
      *Satisfies*: FR-021, FR-022 · *Turns green*: the external-rename test in the same file
- [ ] **T022** Diagnostics for discarded state: record what was dropped and for which project.
      *Satisfies*: FR-021, SC-013
- [ ] **T023** Confirm FR-023 across **both** routes — a project switch and a restart. Both are already
      asserted by separate tests; run them, do not assume one covers the other.

---

## Phase F — #166 status bar (US5, P3)

- [ ] **T024** [P] [R✓] **Green**: `status-bar.tsx` — remove the project dot, project name,
      `Tab · Panel` context and ADMIN pill. Keep the footer, its height, theming, `data-testid` and the
      root folder path.
      *Satisfies*: FR-024, FR-025, FR-026 · *Turns green*: both in `status-bar-deduped.e2e.ts`
- [ ] **T025** [P] Amend the superseded requirement text (FR-003/004/025e in its owning spec) so
      specification and implementation agree, and check whether
      `status-admin-pill.e2e.ts` / `title-statusbar.e2e.ts` assert anything now removed — update them
      if so.
      *Satisfies*: FR-027
- [ ] **T026** [P] Confirm `activeContextLabel` still has exactly one consumer (the title bar) and no
      dead import is left behind.

---

## Phase G — #165 pane toggle defaults (US6, P3)

- [ ] **T027** [P] [R✓] **Green**: `packages/core/src/config/keybindings.ts` — `WINDOWS_BINDINGS` moves
      `view.toggleProjects` to `Ctrl+Alt+B` and `view.toggleExplorer` to `Ctrl+Alt+N`.
      *Satisfies*: FR-028, FR-029 · *Turns green*: all 4 in `pane-toggle-defaults.test.ts`
- [ ] **T028** [P] Update the tests and docs that cite the old chords: `pane-shortcuts.e2e.ts`,
      `preferences-keybindings.e2e.ts`, `keybindings.test.ts`, `chord-capture.test.ts`, and any
      documentation naming `Ctrl+B` / `Ctrl+N`.
      *Satisfies*: FR-031 · **Care**: these edits must not mask a real regression — the new unit test
      asserts the values positively from a file you are not editing.
- [ ] **T029** [P] Confirm user-saved bindings are untouched by the change, and state the behaviour
      where users will see it.
      *Satisfies*: FR-030

---

## Phase H — Verification and close

- [ ] **T030** Run every layer, unfiltered, capturing full output once (Constitution V): unit,
      integration, contract, then Playwright. Compare against T001's baseline.
      *Satisfies*: FR-033
- [ ] **T031** Confirm the fences: 4 in `explorer-live-sync.e2e.ts`, 4 in `terminal-link-once.e2e.ts`
      (FR-032 — link routing untouched, #198 deferred), 2 in `rename-case-only`, 1 each in the two
      watcher files, 1 in `editor-stranded-recovery`.
      *Satisfies*: FR-032, FR-033
- [ ] **T032** Adversarial review of the whole diff against spec, plan, contracts and constitution.
      Fix every Critical and Important finding; re-run the gates.
- [ ] **T033** Lint and type-check clean. The one pre-existing warning in `terminal-panel.tsx` is not
      this feature's and must not be "fixed" opportunistically.
      *Satisfies*: FR-036

---

## Dependencies

```
T001 ─┬─> Phase B (T002 ─> T004; T003 [P])
      ├─> Phase C: T005 ─> T006, T007 ─> T008; T009 [P]; T010 (needs T005+T007); T011 [P]
      ├─> Phase D: T012 ─> T013, T014 ─> T015, T016, T017 ─> T018; T019 [P]
      ├─> Phase E: T020, T021 ─> T022 ─> T023
      ├─> Phase F: T024 ─> T025, T026
      └─> Phase G: T027 ─> T028, T029
                                        all ─> T030 ─> T031 ─> T032 ─> T033
```

Phases B–G are mutually independent and may be done in any order or in parallel.

## Parallel opportunities

Six issues touch six disjoint file sets. The largest genuine batch:

```
T002 (files-service)  ‖  T024 (status-bar)  ‖  T027 (keybindings)  ‖  T011 (explorer delete)
```

Within Phase D everything is sequential — `unloadable` must exist before anything renders or retries it.

## Definition of done

- 16 committed red tests green; 13 committed green tests still green.
- Three new tests (T009, T011, T017) written Red first, then green.
- Lint and type-check clean, baseline warning aside.
- No change to terminal link routing (FR-032).
- Every deliberately-silent behaviour leaves a diagnostic record (SC-013).
