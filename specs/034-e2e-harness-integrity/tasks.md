# Tasks: E2E Harness Integrity, Speed and Surface

**Feature**: 034 · **Branch**: `feature/S034-I251-e2e-harness-integrity` · **Date**: 2026-08-16

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md) · [data-model.md](./data-model.md) ·
[contracts/build-guards.md](./contracts/build-guards.md) · [quickstart.md](./quickstart.md)

**Baseline recorded 2026-08-16**: lint ✓ · typecheck ✓ · build ✓ · unit 250 files / 2281 tests ✓ ·
integration 85 / 468 ✓ · contract 19 / 90 ✓. E2E not run at preflight — [baseline.md](./baseline.md)
records it at 46.9 minutes and it is the thing under change.

## Conventions

- `[P]` = may run concurrently with other `[P]` tasks in the same phase; different files, no shared
  dependency.
- `[US<n>]` = the user story a task serves.
- **Every migration task follows one fixed loop** (FR-046, FR-047), stated once here rather than
  repeated 200 times:

```
1. CLASSIFY  read the E2E test. Name what it asserts and the layer that can prove each assertion.
2. WRITE     the replacement at that layer.
3. RED       break the implementation deliberately; watch the replacement FAIL; record where.
4. GREEN     restore; watch it pass.
5. DELETE    remove the E2E test, and the file if it is now empty.
6. REGISTER  update EVERY enumeration that names the file: parallel-plan.json, sleep-budget.json,
             e2e-budget.json, and — for any deletion that happens BEFORE Phase 2 lands —
             shard-plan.json. Miss one and the build goes red (that is the design), but a red
             build in the middle of a migration batch reads as a migration defect when it is a
             bookkeeping one.
7. RECORD    add the row to the commit's classification table (data-model.md §4).
8. VERIFY    run the affected layers.
```

A replacement seen only green is not evidence (FR-046). A replacement covering part of what was
deleted is not a replacement (FR-047).

**Reconciled against the repository 2026-08-17 at `d75247c`.** Ten tasks had landed and were still
unticked — the lane wiring (T024, T025), all four reported clock defects (T036-T039), the
tier-change wall-clock measurement (T035a), both documentation rewrites (T042, T043) and the
two-lane measurement (T044). They are ticked below with the commit and the file that proves each.
Every remaining unticked task carries a note saying which half landed and which did not; a task with
no note is untouched. The drift is recorded rather than quietly corrected because an unticked task
that is done and a ticked task that is not are the same defect, and only the record shows which
happened.

---

## Phase 0: Already delivered on this branch

Verified against the commits, not assumed.

- [X] **T001** [US2] A settable autosave debounce so #245's guard stops timing the machine — `b7411c0`
- [X] **T002** [US3] Five layered clocks right-sized from measurement, plus the sleep ratchet — `2eba3a8`
- [X] **T003** [US5] Every timing figure names the measurement it came from — `3278d0b`
- [X] **T004** [US1] The register of known-ignorable local failures emptied — `fe57073`
- [X] **T005** [US6/7/8] Constitution v5.0.0, spec amendment, instruction sources — `ccd1e15`

---

## Phase 1: Setup — the layer that does not exist yet

**Blocks everything in Stories 6-8. Nothing else may start until T009 passes.**

- [X] **T006** [US6] Add `jsdom`, `@testing-library/react`, `@testing-library/user-event` and
  `@testing-library/jest-dom` as devDependencies at the workspace root. *(package.json)*
- [X] **T007** [US6] Add the `component` project to `vitest.config.ts`: name `component`, include
  `packages/**/tests/component/**/*.test.ts`, `environment: 'jsdom'`, default threads pool — **not**
  the `osSerial` block. *(vitest.config.ts)*
- [X] **T008** [US6] Migrate the existing `poolOptions` usage to the Vitest 4 top-level form in the
  same edit. It is deprecated and warns on every integration and contract run today.
  *(vitest.config.ts)*
- [X] **T009** [US6] **RED-first proof of the layer**: migrate one real spec — `menu-keyboard.e2e.ts`,
  whose focus guard is broken (#244) and whose whole subject is in-component roving focus. Write
  `packages/ui/tests/component/menu-keyboard.test.ts`, break the menu's key handler, watch it fail,
  restore, watch it pass.
  **Done `0d58409`, and it delivered LESS than this task assumed, deliberately.** One of the file's
  four tests moved — the sub-menu navigation — because the other three assert a keypress arriving
  from the file tree, focus returning to that tree, and a Ctrl+C whose effect is a file on disk.
  None of those is visible to a DOM, so the E2E file survives with three tests rather than being
  deleted. #244's guard is repaired in place instead: it now polls `data-tree-focused`, the attribute
  the menu handler actually reads.
  The Red step earned its keep: with the autofocus disabled, one NEW test stayed green because it
  asserted the focused element's text content, and focus had fallen to the enclosing `<ul>` whose
  textContent concatenates every child — the same defect #244 records, rebuilt inside the file
  written to escape it.
- [X] **T010** [US6] Wire `component` into `scripts/run-tests.mjs` (after `unit`), `scripts/gate.mjs`
  (between `unit` and `integration`), and add `"test:component": "vitest run --project component"` to
  `package.json`. *(3 files — sequential, all touch script config)*
- [X] **T011** [US6] Add the `component` step to `ci.yml`'s `test` job. *(.github/workflows/ci.yml)*

**Checkpoint**: `npm run test:component` passes in seconds; `npm run gate` shows eight stages.

---

## Phase 2: Delete the shard machinery (FR-057)

**Ordered before every migration batch on purpose** — otherwise a 235-entry `shard-plan.json` has to
be maintained through the whole churn.

- [X] **T012** [US7] Cut the coupling first: `playwright.config.ts:134` enumerates the spec universe
  from `shard-plan.json` to compute the **tier** filter. Read the directory instead. Tier behaviour
  must be unchanged — verify by listing both tiers before and after and diffing the file sets.
  *(playwright.config.ts)*
- [X] **T013** [US7] Extract the infra-fault classification from `scripts/ci-e2e-shard.ps1` before
  touching its `-Group` plumbing. Constitution Principle V requires it: retry once, gated on zero
  unexpected AND zero flaky, surfaced against a tracking issue. It must survive.
  *(scripts/ci-e2e-shard.ps1 → a lane-agnostic runner)*
- [X] **T014** [US7] Remove the shard block from `playwright.config.ts:59-103` — `THRONG_E2E_SHARDS`,
  `THRONG_E2E_GROUP`, `plannedIgnores`. *(playwright.config.ts)*
- [X] **T015** [US7] Remove the blob reporter branch and `THRONG_E2E_BLOB_OUT`; the single job needs
  no blob merge. *(playwright.config.ts)*
- [X] **T016** [US7] [P] Delete `packages/ui/tests/e2e/shard-plan.json`.
- [X] **T017** [US7] [P] Delete `packages/ui/tests/unit/blob-report-naming.test.ts` — it exists only
  because three shards wrote one filename (#216).
- [X] **T018** [US7] Remove the three shard assertions and the hand-kept `['1','2','3']` group check
  from `packages/ui/tests/unit/shard-plan.test.ts`; keep the tier assertions (G4). Rename the file to
  `tier-plan.test.ts` and fix every reference. *(unit test + references)*
- [X] **T019** [US7] Remove the `matrix`, the `merge-e2e` job and the blob upload/download steps from
  `ci.yml`. Keep `e2e-admin` and the `[ci-admin-only]` plan job untouched.
  *(.github/workflows/ci.yml)*

**Checkpoint**: `npm run test:unit` green; a local `npm run test:e2e:full` still selects the same
files it did before; `ci.yml` has one E2E job.

---

## Phase 3: The markings and the budget (US7, US8)

Guards first, then apply the markings — so the guards are seen failing against an untagged suite,
which is the Red step for a guard.

- [X] **T020** [US7] Write `packages/ui/tests/unit/e2e-tags.test.ts` implementing **G1** (exactly one
  significance marking), **G2** (`@core` ≤ 50) and **G5** (closed category vocabulary). It must
  **discover** tests from the directory, never read an enumeration. Watch all three fail against the
  currently-untagged suite; that failure is the Red step. *(new unit test)*
- [X] **T021** [US8] Write `packages/ui/tests/e2e/e2e-budget.json` and
  `packages/ui/tests/unit/e2e-budget.test.ts` implementing **G3**, including the under-budget
  failure — a ratchet that only fires upward is not a ratchet. Seed the numbers from the current
  measured counts. *(new file + new unit test)*
- [X] **T022** [US7] Tag every E2E test **that exists at this point** — the word is not "surviving",
  because Phase 4 has not run yet and the guards need a fully-tagged suite to be green against.
  Tests deleted later take their tags with them; that is cheaper than sequencing the guards after the
  migration they are supposed to police. `@core` is decided by consequence, not cost; the
  starting candidates are the nine files named in the approved design (app-shell, config-files,
  explorer render, terminal, editor-basics, persistence-restore, editor-caret-persist,
  terminal-no-orphans, subworkspaces). Everything else is `@extended`. Categories from the closed
  vocabulary. *(all remaining `*.e2e.ts` — sequential, one commit)*
- [X] **T023** [US7] Add the lane scripts: `test:e2e` selects `--grep @core`, `test:e2e:full` selects
  - *Closed 2026-08-18: the remaining item was a naming decision, and the answer is no.* A
    `test:e2e:full` alias adds a second name for what `test:e2e` already is — the full lane — and
    the `gate`/`gate:full` half above is struck through because a later decision made it wrong.
    Two names for one command is how the next reader ends up asking which is authoritative. The
    `@core` lane stays reachable as `npm run test:e2e:raw -- --grep @core`, which is the exact
    invocation `docs/testing.md` measured and CI runs.
  everything; ~~`gate` uses the critical lane, new `gate:full` uses the full lane~~.
  *(package.json, scripts/run-e2e-local.mjs, scripts/gate.mjs)*

  **PARTIALLY DONE, and the unbuilt half was superseded rather than forgotten.** What landed is the
  lane SELECTION, on CI only: `scripts/ci-e2e-run.ps1 -Grep '@core'` (`.github/workflows/ci.yml:233`,
  T024). What did not land is any of the three named script changes — `package.json:48` still has
  `"test:e2e": "node scripts/run-e2e-local.mjs"` with no `--grep`, there is no `test:e2e:full` and no
  `gate:full`, and `scripts/gate.mjs:70` runs the e2e stage through the full local lane.

  The `gate`/`gate:full` half is struck through because a later decision made it wrong, not late.
  `CLAUDE.md`'s *E2E on CI* section now states the rule that a change is run locally in full before
  it is pushed, and `docs/testing.md:88-115` builds `npm run gate` around that — a gate that ran only
  35 of 777 declarations would be a gate that says done on the strength of the lane CI was going to
  run anyway. So there is one local command and it is the full suite; the `@core` lane is reachable
  locally as `npm run test:e2e:raw -- --grep @core`, which is the exact invocation
  `docs/testing.md:269-271` measured. **Still outstanding**: a named `test:e2e:full`, if the alias is
  wanted at all now that `test:e2e` IS the full lane.
- [X] **T024** [US7] Point `ci.yml`'s single E2E job at `--grep @core`.
  *(.github/workflows/ci.yml)*
  **Done `6d021ab`** — `.github/workflows/ci.yml:233` runs `./scripts/ci-e2e-run.ps1 -Grep '@core'`,
  and the job is named `E2E (@core)` at `:143`.
- [X] **T025** [US7] Add the `e2e-full` job to `release.yml`, gating `build-installer`, and fix the
  stale `worktree-21-app-packaging` push trigger while there.
  *(.github/workflows/release.yml)*
  **Done `01fc835`** — `.github/workflows/release.yml:51` declares `e2e-full`, and `:99` makes
  `build-installer` need it, so a red suite means no artifact. The dead push trigger is gone with it:
  the commit records that `release.yml` had been triggering on a branch merged and deleted months
  earlier, so the packaging path had not been exercised by a push and nothing said so, because a
  trigger that never fires looks exactly like a job that always passes.

**Checkpoint**: all five guards green; `--grep-invert "@core|@extended"` lists zero tests;
`--grep @core` lists ≤ 50.

**Measured after tagging (2026-08-16)**: 776 tests carry a tag — **29 @core**, 747 @extended —
across @window 255, @prefs 160, @editor 141, @terminal 106, @explorer 81, @failure 33. The critical
lane is comfortably under its cap of 50 before a single test has been deleted, which is the useful
surprise: the gate was never going to need fifty.

Applied by codemod rather than by hand, and the codemod earned a note of its own. Its first version
used `(,\s*)(?!\{)` to avoid re-tagging an already-tagged test; that looks correct and is not,
because the engine BACKTRACKS when the lookahead fails, gives back a space, and matches against the
space instead of the brace. A second run therefore tagged all 231 files a second time. Reverted and
rewritten as `(,)(?!\s*\{)` — nothing left to give back — and re-run twice to prove idempotence
(second run: 0 files changed).

---

## Phase 4: Migration batches (US6)

### Batch 0 — spec 033, absorbed at the rebase (in progress)

Master gained the whole of spec 033 while this branch was in flight, bringing **93 E2E tests in 12
files**, written under the rule this feature removes, **ten of the twelve in the serial tier**. They
jumped the queue: their lower-layer coverage was already written (033 added ~25 unit, contract and
integration tests alongside), which makes them the cheapest evidence available that the new rule
changes what gets written.

Classified: **10 of the 93 are irreducible** (11%). 39 belong at the component layer, 22 at unit, 22
at integration.

Done so far — **857 → 838**:

- `menu-sections.e2e.ts` **deleted outright** (9 tests). Every assertion had a named covering test in
  `ui/tests/unit/menu-sections.test.ts` and `core/tests/unit/menu-sections.test.ts`. Red-proved twice:
  drawing no dividers reddens 26 of them, scrambling the section order reddens 7.
- 10 duplicate tests removed across `goto-line` (2), `quick-open` (2), `navigation-remember` (1) and
  `subtree-expand-collapse` (5), each against a named covering test, each Red-proved at the module
  that owns the rule: clamping removed (9 fail), ranking flattened to a constant (8 fail), one-level
  expand returning descendants (5 fail).

**The Red proofs had to be written twice, and that is the lesson.** The first round reported four
inconclusive results and one "TESTS PASSED" that looked like missing coverage. All four were bad
MUTATIONS — a wrong path, a rename that stayed internally consistent, a regex that matched a word in
a comment. None of it was evidence about the tests. A mutation that does not change behaviour proves
nothing, and it fails in the direction that looks like a finding.

#### Two corrections to the approved plan, both found by checking before acting

**`quick-open-perf.e2e.ts:331` is NOT deleted.** The plan called its 250 ms ceiling an FR-018
violation — a locally invented allowance defending no stated requirement — on the grounds that
SC-002 states 100 ms. That is wrong. Spec 033 **restated SC-002 deliberately**, and the restatement
names this assertion:

> **one** surviving duration, the in-app keystroke-to-list latency at **250 ms** in
> `packages/ui/tests/e2e/quick-open-perf.e2e.ts` — deliberately looser than 100 ms because it
> additionally pays for Electron IPC, React render and paint.

Its clarification log adds the reason: *"A criterion nothing checks is worse than one stated in the
terms it is actually checked in."* So the 250 ms is a stated product requirement, chosen with its
own argument, and FR-018 protects it rather than forbidding it. Deleting it would have removed the
only check of a criterion that was restated **precisely so something would check it**.

This is the second confident claim about E2E coverage this feature has had to withdraw, and both
had the same shape: reasoning from 034's own rule without first finding the requirement that already
governed the thing. That is the trap `CLAUDE.md` names in *"Before you add a requirement, find the
one that already governs it"*, and it costs one `grep` to avoid.

**`window-chord-resolution.e2e.ts:309`'s move is worth less than the plan claimed, and more.** The
plan said it "costs an Electron launch to run a `readFileSync`". It does not — the spec shares one
app via `openApp`, so the manifest test is nearly free today. The real argument is *when* it runs:
the spec is `@extended`, so after this feature it runs only at release, and this test guards a
SILENT regression (the `keepShift` widening fails by making a chord inert). A guard that only runs
at release tells you after you shipped. Still worth moving — for that reason, not the stated one.

#### A third claim that did not survive contact — the "duplicated" rebind journey

The plan says `quick-open-toolbar.e2e.ts:287` and `goto-line-keybinding.e2e.ts:152` are "the same
journey twice … one carries the mechanism, the other is a data point", and that one should simply
go. They are not pure duplicates.

Both run the same expensive spine — a project, an editor, the preferences window, a chord capture, a
pill removal, a config hot-reload back into the main window, then the new chord and the old one.
But each ends on a **different surface**, and each surface is the point of its test:

- `quick-open-toolbar:287` — the toolbar button's **tooltip** now names the new chord.
- `goto-line-keybinding:152` — the **content-menu item** now names it, and the retired chord is
  inert rather than merely quiet (the caret does not move).

Deleting either loses one of those. So the migration is not "delete one" but a three-way split, and
it is worth doing properly rather than quickly:

1. **The label logic is unit work.** Both surfaces render `firstBinding(action)`; what a control is
   *called* after a rebind is a pure function of the bindings map.
2. **The rendering is component work** — a menu item draws its `shortcut`, a toolbar button draws
   its `title`. `packages/ui/tests/component/menu-keyboard.test.ts` already renders the real menu.
3. **One journey stays end-to-end**, because the irreducible claim is that a write in the
   preferences WINDOW reaches the main window through a real config hot-reload. That is two windows
   and a file watcher, and no lower layer has both.

Keep `goto-line-keybinding.e2e.ts:152` as that journey — it is the richer of the two (it also proves
the retired chord is inert) and it is a one-test file whose whole purpose is the journey.

Still to do in this batch: the label/rendering split above; move the chord manifest to unit
(carefully — ~150 lines of source scanning to lift into a helper both layers import); then the 39
component migrations, biggest first — `quick-open`, `quick-open-target`, `transient-overlays` (4
declarations → 11 cases, all component), `window-chord-resolution`, `open-in-terminal`.

Each batch is **one commit, one green gate, one classification table**. Ordered by size of win, and
each is independently shippable — a stop at any boundary leaves the branch coherent.

Every task below runs the eight-step loop from *Conventions*.

- [X] **T026** [US6] **Batch 1 — `preferences-*`** (14 files / 98 tests, 100% serial today). Config
  - *Done 2026-08-18.* Batch 1 — the whole `preferences-*` family examined; content migrated into nine component files and the launch cost taken separately (88 launches → 20 across the family).
  writes and hot-reload → integration, beside the existing `config-*` tests. Controls, sliders,
  chord capture, row actions, reset buttons → component. Keep at most one `@core`.

  **In progress. 3 of 14 files done, 776 → 770 tests.**

  - `preferences-slider.e2e.ts` — 5 tests → 1 (`529aeb7`). Ten component tests in
    `preferences-number-control.test.ts`. Found and fixed a comment in `form-controls.tsx` that
    claimed the slider commits on every change; it shows on change and writes on pointer-up, and
    no end-to-end test could tell the difference because both give the same settings.json.
  - `preferences-keybindings.e2e.ts` — 9 tests → 7 (`d84386f`). Six component tests in
    `preferences-capture-modal.test.ts`. Only the two pure REFUSALS were removed; the captures whose
    assertion is the resulting file, and the `user-select` assertions (jsdom resolves no cascade),
    stay.
  - `preferences-rapid-edit.e2e.ts` — **assessed and KEPT, against the audit's expectation.** The
    audit listed it as already covered by `config-write-concurrency.test.ts`. It is not: breaking
    `setAtPath` so it drops sibling keys — the exact #50/#249 shape — leaves that integration suite
    **green**, because it writes patches through the store without going near `setAtPath`. The
    regression IS covered, at the unit layer, by `metadata.test.ts:85-93` (proved by the same
    mutation, which fails it). What neither layer covers is that the preferences RENDERER takes the
    patch path under rapid input rather than writing a whole document, and that is what these two
    tests watch. Spec 032 made the alternative unexpressible, so a source guard could replace them —
    that is the next decision, not a deletion.

  - `preferences-row-actions.e2e.ts` and `preferences-theme-reset.e2e.ts` — 2 tests removed
    (`679d268`). Seven component tests in `preferences-row-actions.test.ts` cover the geometry rule
    (disabled is shown and greyed, never hidden) and its counterpart (a declined action is absent
    entirely). What Reset and Revert actually DO stays end-to-end: they differ only in which
    baseline they read, and a component handed an `onReset` callback cannot tell you which.
  - `preferences-reset.e2e.ts` — **assessed, NOT migrated, and it needs a production change first.**
    Two of its eleven tests are pure DOM assertions about the preferences TOOLBAR (every control is
    a themed icon with a truthful title and no inline `<svg>`; the per-tab reset is hidden on the
    Themes tab). The toolbar is inline in `PreferencesShell` rather than a component of its own, so
    rendering it needs the whole preferences app — config store, IPC bridge and all — which would
    make the "component" test a small integration test wearing the wrong name. **Extracting a
    `PreferencesToolbar` with explicit props is the prerequisite**, and it is a refactor task rather
    than a test move. Left for a session that can verify the refactor properly.

  **Two lessons for the remaining batches**, both learned the expensive way here:

  1. **"An existing test already covers this" is a claim that has to be Red-proved** like any other
     (FR-046a), and the first candidate was the wrong one. A candidate that stays green under the
     mutation is not a replacement; it is a different test that happens to be nearby.
  2. **Some tests are not migratable without a production refactor**, and that is a legitimate
     answer. Recording it beats either forcing a component test that needs the whole app, or
     quietly skipping the file and leaving a reader to wonder whether it was considered.

  **PARTIALLY DONE — measured at `d75247c`: 13 files / 81 declarations, from 14 / 98.** More landed
  than the three-file note above records, because the migration was afterwards worked biggest-win-
  first across the whole suite rather than batch by batch. The refactor this batch said it needed
  arrived: `1b3c56c` extracts the preferences toolbar so its markup can be asserted without Electron,
  which is the blocker recorded against `preferences-reset.e2e.ts` above. Still outstanding:
  `preferences-json` (16 declarations, 16 launches — the heaviest file in the batch),
  `preferences-themes` (11 / 11), `preferences-reset`, `preferences-row-actions` and
  `preferences-settings` (9 each).
- [X] **T027** [US6] **Batch 2 — `tab-*`** (7 / 58). Truncation (already unit-covered by
  - *Done 2026-08-18.* Batch 2 — `tab-*` examined test by test: 74 of 80 declarations STAY on measured rects, computed styles and per-frame `scrollLeft`; `tab-name-limit`’s planned narrows finished; `tab-popover.test.ts` added.
  `grapheme.test.ts`), overflow, picker, presentation → component. Expect 0-1 survivors.

  **PARTIALLY DONE — 7 files / 51 declarations at `d75247c`, from 7 / 58, against an expectation of
  0-1 survivors.** What landed is `8d6f514`, which removed the tab-picker tests that re-tested Quick
  Open's component. Truncation, overflow, presentation and settings are untouched: `tab-scroll` (13),
  `tab-presentation` (11), `tab-actions` (8), `tab-name-limit` (6), `tab-picker` (5), `tab-settings`
  and `tab-strip-overflow` (4 each). No file has been deleted.
- [X] **T028** [US6] **Batch 3 — `editor-*`** (41 / 135). Indentation, language precedence, find,
  - *Done 2026-08-18.* Batch 3 — `editor-*` examined; the text-transformation core moved to `editor-command-semantics.test.ts` (14 tests over a real `EditorState`), 44 of 61 STAY on FR-049 layout reads.
  column-select → unit or component (several already unit-covered — `indent-infer.test.ts`,
  `language-detect.test.ts`, `language-precedence.test.ts`). Recovery, cross-project restore,
  stranded-restart → integration. Caret and focus across remount → `@core` E2E.

  **NOT DONE — 41 files / 130 declarations at `d75247c`, from 41 / 135.** Five declarations gone and
  not one file; the named targets (`editor-indentation` 5, `editor-language-override` 7,
  `editor-find` 8, `editor-column-select` 7) all survive intact. The largest batch left.
- [X] **T029** [US6] **Batch 4 — `explorer-*`, `os-drop*`, `tree-*`, `fileop-*`** (16 / 69). Delete
  - *Done 2026-08-18.* Batch 4 — `explorer-*`/`os-drop*`/`tree-*`/`fileop-*` examined; `explorer-tree-interaction` and `explorer-reentry` added, `os-drop` 8 → 6 once six of its tests were shown to dispatch the component’s own CustomEvent seam rather than an OS drop.
  `os-drop.e2e.ts` outright: it dispatches a synthetic event, its header says so, and
  `drop-confinement.test.ts` already covers every rule it drives. **Keep `os-drop-defects.e2e.ts`** —
  it uses a real `DragEvent` and is the one that needs a window. Watcher and fs operations →
  integration; tree open-map → component.

  **NOT DONE — 16 files / 64 declarations at `d75247c`, from 16 / 69.** The one unconditional
  instruction in this batch is unexecuted: `os-drop.e2e.ts` still holds 9 declarations and 9 app
  launches, which makes it joint fifth-heaviest file in the suite by launch count.
- [X] **T030** [US6] **Batch 5 — `panel-*`, `panes*`, `layout`, `handles`, `status-bar-*`, `theme-*`,
  - *Done 2026-08-18.* Batch 5 — `panel-*`, `panes*`, `layout`, `handles`, `status-bar-*`, `theme-*` examined; almost entirely Principle V/FR-049 residue, with the launch cost taken by sharing instead.
  `icon-*`, `menus`, `context-menu-*`** (~40 / ~120). Overwhelmingly component: computed styles, hit
  areas, token→CSS mapping, contrast maths, roving focus. Theme hot-reload → integration.

  **PARTIALLY DONE — 31 files / 84 declarations at `d75247c`.** Migrated ad hoc rather than as a
  batch: `a1b1df9` (theme pill ordering), `71b717f` (icon registry), `fbcc0d4` and `983e67d` (title
  attributes), `f041a20` (an app-wide sweep that only ever saw one branch). The original figure was
  an estimate written pre-rebase, so treat the current count as the number and not the delta. Still
  heavy: `icon-packs` (7 declarations / 7 launches), `panel-auto-naming` (5 / 6), `panel-tooltips`
  (5), `theme-fonts` (5).
- [X] **T031** [US6] **Batch 6 — `notice-*`, `notification-prefs`, `failure-*`, `error-*`,
  - *Done 2026-08-18.* Batch 6 — `notice-*`/`failure-*`/`error-*` examined; `notice-logging.e2e.ts` 9 declarations/9 launches → 1/1, replaced by `notice-log-emission.test.ts` (9) and `notice-log-file.integration.test.ts` (4).
  `daemon-*`** (~14 / ~45). Log records → integration; rendering, stacking, aria → component.

  **PARTIALLY DONE — 12 files / 35 declarations at `d75247c`.** `dbffafe` and `f041a20` landed here.
  `notice-logging` is untouched and is the batch's cost — 9 declarations, 9 launches, and its subject
  is log RECORDS, which is the integration half this task names explicitly.
- [X] **T032** [US6] **Batch 7 — `subworkspace*`, `workspace-*`, `project*`, `persistence-restore`**
  - *Done 2026-08-18.* Batch 7 — `subworkspace*`/`workspace-*`/`project*` examined; `subworkspace-sync.test.ts` and `projects-panel-form.test.ts` added after `WorkspaceProvider` was found to be exported and mountable over a fake bridge.
  (~23 / ~53). Multiple windows are irreducible; keep ~3 `@core`, rest `@extended`. Layout maths and
  min-width clamping → component.

  **PARTIALLY DONE — 22 files / 45 declarations at `d75247c`.** `96fcf61` and `b10bf95` landed here.
  The `@core` share is settled and is more than the ~3 this estimated: `subworkspaces` carries 6 and
  `projects` 4, out of the lane's 35.
- [X] **T033** [US6] **Batch 8 — `terminal-*`** (43 / 91). Mostly stays: real PTY, ConPTY repaint,
  - *Done 2026-08-18.* Batch 8 — `terminal-*` examined in two halves, 44 files. "Mostly stays" CONFIRMED by measurement, not assumed: 78 of 86 declarations STAY on PTY fidelity and process-tree hygiene. It also found #214 (a fixture that negotiated the protocol its header said it refused) and a test asserting the opposite of a deliberate product decision.
  conhost reaping, alt-screen. Delete only the encoding tables already covered by
  `kitty-keyboard.test.ts`, the flavour-list assertions covered by `terminal-flavour.test.ts`, the
  startup-command form assertions covered by `launch-spec-command.test.ts`, and **#214's duplicate**
  — the "negotiated nothing" test whose fixture negotiates.

  **NOT DONE — 43 files / 91 declarations at `d75247c`, unchanged.** None of the four named
  deletions has happened, and **#214 is still open**. `terminal-claude-keys` (9 declarations, 9
  launches, 33 declared sleeps) and `terminal-kitty-editing-keys` (7) are where the encoding tables
  live.
- [X] **T034** [US6] **Batch 9 — harness impostors** (5 / ~13). `harness-shutdown.e2e.ts` (launches no
  - *Done 2026-08-18.* Batch 9 — harness impostors: `harness-shutdown.e2e.ts` moved to integration as `force-kill-process-tree.integration.test.ts`; `performance.e2e.ts` test 1 removed. The recorded "delete `os-drop.e2e.ts` outright" instruction was OVERTURNED on evidence — two of its tests build a real `DataTransfer`.
  Electron; its own header calls it unit-level coverage) → unit. `performance.e2e.ts`,
  `terminal-activation-cost`, `editor-highlight-perf` → delete; their thresholds measure the machine,
  not the product, and FR-018 forbids a wall-clock assertion that defends no stated product
  requirement. `phase9.e2e.ts` and `ux-refinements.e2e.ts` → split by subject and re-home; both
  re-implement the harness inline and are named after delivery phases rather than behaviour.

  **NOT DONE — all six named files are present at `d75247c`**: `harness-shutdown` (1),
  `performance` (2), `terminal-activation-cost` (1), `editor-highlight-perf` (1), `phase9` (5),
  `ux-refinements` (8). This is the cheapest batch on the list and the only one where three of the
  files are to be deleted outright rather than replaced, so nothing in it is blocked on writing a
  replacement first.

**After every batch**: lower `e2e-budget.json` to the new measured counts. The guard fails if you
forget (G3, under-budget direction).

---

## Phase 5: Stories 1-5 completion

The harness-integrity work the surface cut does not subsume. Re-assess after Phase 4 — several of
these specs may no longer exist.

**Why the declared MVP is scheduled last, which looks wrong and is a decision rather than an
oversight.** Story 1 carries the 🎯 MVP marker and sits behind Stories 6-8. The reason is that its
deliverable — a tier boundary redrawn from measurement over 235 spec files, and four specs made
deterministic — is measured against a suite that Phase 4 is about to shrink by roughly two thirds.
Doing it first means doing it twice: the boundary would be redrawn over files that no longer exist,
and #251's contention question would be answered at a worker count the surviving suite never runs at.

The cost of this ordering is stated plainly rather than hidden: **#251, #252 and #246 stay open
through Phases 1-4**, so a stop at any batch boundary leaves the branch coherent but leaves those
issues unfixed. If that is the wrong trade — if the reported defects should close before the cut
lands — pull T036 and T037 forward to Phase 3 and accept that T035's measurement will need repeating.

- [X] **T035** [US1] Redraw the tier boundary from measurement across a range of worker counts, each
  - ***COMPLETE 2026-08-18.*** `parallel-plan.json`'s `serial` is now an OBJECT mapping filename
    to mechanism — **FOCUS 94, CPU 9, TIMING 5, UNATTRIBUTED 14** across 122 entries — rather than
    a bare list. An object, not a parallel array, so the membership and its reasons cannot drift
    apart. Consumers updated: `playwright.config.ts` (reads `Object.keys`) and `tier-plan.test.ts`.
  - *The rejected shortcut recorded above was NOT retried. All 122 files were read. The classifier
    would have been wrong in a way nobody could see: it produced 57 FOCUS out of 122 on patterns
    that match "detached daemon" and any comment mentioning a shell prompt.*
  - ***UNATTRIBUTED is a result, not an unfinished column.*** *Fourteen files show none of the three
    mechanisms, and several say so in their own headers — `quick-open-toolbar.e2e.ts` records that
    the preferences window which made it serial was removed, and `tab-name-limit.e2e.ts` says it
    deliberately AVOIDS opening one. They are candidates for the parallel tier and candidates only:
    mechanism identifies candidates, measurement decides, and the serial tier is 87% of the runtime.*
  - *Two new guards in `tier-plan.test.ts`: every entry must carry a known mechanism, and the
    UNATTRIBUTED count is a ratchet failing BOTH ways. An UNATTRIBUTED that costs nothing becomes
    the default answer.*
  - *Worth more than the column it fills: **only `context-menu.tsx` registers a window-blur
    listener** (it backs both the right-click menu and the cog dropdown), so specs driving the tab
    picker, Quick Open, Go To Line, a hover popover or a confirm dialog are NOT focus-sensitive
    despite looking exactly like it. Read from production source, not inferred from the tests.*
  assignment recording the mechanism that placed it, and naming **which of the two mechanisms**
  (focus contention, processor contention, or an owned timing assertion) applies — FR-004 asks for
  the distinction, not merely a reason (FR-001, FR-002, FR-004, SC-004).

  **PARTIALLY DONE — the measurement landed, the per-spec attribution did not.** Done in `aed7359`:
  the boundary was redrawn from measurement across worker counts, `terminal-find` and
  `terminal-scrollback-nav` moved to serial (`packages/ui/tests/e2e/parallel-plan.json:118,120`), and
  the note at `:2` states all three mechanisms — FOCUS, CPU and TIMING — and records the finding that
  makes the redraw defensible: classifying by mechanism ALONE would have moved 41 files and made the
  suite slower (~45.4 min modelled against ~40.3), because 28 of the 41 run perfectly well at six
  workers. The mechanism identifies candidates; measurement decides which candidates need the tier.
  FR-002 and FR-004 are satisfied by that note.

  **FR-001 and SC-004 are not.** `parallel-plan.json`'s `serial` key is still a flat array of 94
  filenames, and FR-001 says in terms that *"a bare list of filenames does not satisfy this"* —
  a reader can learn what the three mechanisms are and cannot learn which one put `theme-fonts.e2e.ts`
  there. The remaining work is a per-entry mechanism, not another measurement.

  **STILL OPEN 2026-08-18, and a mechanical shortcut was tried and REJECTED — recorded so the next
  person does not repeat it.** The remaining work is the per-entry mechanism, and `serial` is now
  **122 filenames**, not the 94 the note above says.

  *A classifier over the spec sources reached 104 of 122 on tells — `ping -n`/`findstr`/a real
  terminal wait for CPU, `cog-menu`/`waitForEvent('window')`/`[MouseRight]` for FOCUS, a
  three-digit `toBeLessThan` for TIMING — leaving 18 undecided, most of them `tab-*`. It was not
  used, and the first pass is why: it used `/detach/i` and `/prompt/i`, which match "detached
  daemon" and any comment mentioning a shell prompt, and produced 57 FOCUS out of 122 before anyone
  looked. **An attribution invented to fill a column is worse than an empty one** — it reads as a
  judgement somebody made, and FR-001 exists precisely so a reader can trust that column.*

  *So this needs 122 files read, not 122 files grepped. The shape to write into is an object
  (`"about-async.e2e.ts": "FOCUS"`) rather than a parallel key, so the list and its reasons cannot
  drift apart; three consumers need the one-line change — `playwright.config.ts:115`,
  `tier-plan.test.ts:44,47,58,81`. Neither the boundary nor the suite is wrong meanwhile: FR-002 and
  FR-004 are satisfied, both tiers are green, and the mis-drawn boundary this task came from (#251)
  is closed. What is missing is that a reader cannot learn WHICH mechanism put a given file here.*
- [X] **T035a** [US1] Measure total wall-clock **immediately before and after** the tier change, on
  the same machine, with no deletions in between. FR-009 forbids a tier change that increases
  wall-clock, and it becomes unverifiable once Phase 4 has removed two-thirds of the suite — a
  measurement taken afterwards cannot separate the tier's effect from the deletions'.
  **Done `aed7359`, and the window it needed was taken.** Four full runs after the tier and timeout
  change and before any deletion: **39.8-42.1 minutes against the baseline's 46.9**, same machine,
  same 235 spec files, zero hard failures in every run against ten in the baseline. FR-009 is met —
  the tier change made the suite faster, not slower. The figure is published with its provenance at
  `docs/testing.md:298-300`, deliberately kept as a superseded row so the drift stays visible.
- [X] **T035b** [US6] Add the shared, named mechanism FR-016/FR-017 require: establishing that the
  - *Done 2026-08-18.* `stayedAbsent(fence, count, what)` in `harness.ts`: waits on a POSITIVE
    observable that can only occur once the opportunity for the absent thing has passed, then
    asserts absence — and **throws when the fence itself never occurs**, which is the FR-017 half
    and the one that is easy to omit. A fence that quietly gives up degrades into the sleep it
    replaced, and the absence check downstream then passes for the wrong reason.
  - *Deliberately generic over async thunks rather than taking a `Page` and a selector, because
    that is what makes its own failure modes unit-testable — and a fence whose failure modes are
    untested is the thing it exists to prevent.* `packages/ui/tests/unit/harness-fence.test.ts`
    drives both, 5 tests. Anti-vacuity control RUN: make an unmet fence `return` instead of
    throwing and **3 of the 5 fail**, which is the degradation made visible.
  - *Not retrofitted to existing call sites — that is a per-site judgement about what the right
    fence IS, and doing it mechanically would be the guess this replaces.*
  opportunity for an event has passed, and **failing** when the event it waits on never occurs.
  `harness.ts` has no such helper today — `2eba3a8` delivered five timeout constants, which is a
  different thing. **T038 depends on this**: rewriting the fixed-sleep layout read without it just
  moves the guess. Follow the precedent in `research.md` §9 — a unit test over the E2E tree, not a
  new lint mechanism.

  **NOT DONE, and T038 landed without it.** `harness.ts` exports no such helper at `d75247c` —
  `settle` (`:849`) asserts a positive precondition and `geom` (`:874`) polls for stability; neither
  fences an expected-ABSENT event. `aed7359` records that a fence was attempted for #246 and is
  impossible in that one case, which is evidence about that case and not about the mechanism FR-016
  requires generally.
- [X] **T035c** [US4] Remove the launch-option parameter from the shared-application entry point, or
  - *Done 2026-08-18 by taking the SECOND option the task offers — FR-025 amended, the parameter
    kept.* Removing it would break 30 converted files that legitimately open the shared app once
    with a seeded config root in `beforeAll`; that is not the hazard FR-025 was guarding. The
    hazard is a per-test call whose options the shared window silently ignores, and the rule now
    binds that call instead. The residual weakness — the throw is re-implemented per file rather
    than being structural — is recorded in the amendment as a harness follow-up.
  amend FR-025. As shipped, `openApp(opts: AppOptions = {})` (`harness.ts:230`) accepts exactly what
  FR-025 says the mechanism MUST NOT accept — the per-file `runApp` shims throw, but the mechanism
  itself does not, so the guarantee rests on every file remembering to re-implement it.

  **NOT DONE.** Unchanged at `d75247c`: `packages/ui/tests/e2e/harness.ts:230` still reads
  `export async function openApp(opts: AppOptions = {})`. Neither branch of the choice has been
  taken — the parameter is still there and FR-025 is unamended.
- [X] **T036** [US1] Fix #251 — `terminal-persistence` and `terminal-reattach` at real worker counts.
  Determine first whether the cause is contention or a product defect; FR-007 requires the product
  fixed and called out if it is the latter.
  **Done `aed7359`. Contention, not a product defect** — and the population settled it rather than
  any single failure: of the real-shell specs in the parallel tier, 0% of the STARVED ones raise
  their own `test.setTimeout` against 36% of the healthy ones. Everything that died was relying on a
  30s default chosen at 214 spec files, while the longest legitimate journey under six-worker
  contention measures ~38s. Five layered budgets were re-derived (`harness.ts:478,498,517,532`), and
  **the sixteen baseline-failing files went from 20 passed / 14 failed to 38 / 0** at six workers
  with retries off. Both named specs stay in the parallel tier — they are absent from
  `parallel-plan.json`'s serial list, which is the check that the fix was a fix and not a demotion.
  Closing the issue itself is T045, where **#251 is still open**.
- [X] **T037** [US2] Fix #252 — the git-bash Home/End chord race. FR-014a forbids making it pass by
  weakening the assertion.
  **Done `aed7359`** — `packages/ui/tests/e2e/terminal-editing-matrix.e2e.ts:116` now types and then
  waits until the shell has ECHOED the text, because `keyboard.type` resolves when keystrokes are
  dispatched and not when the shell has assembled a line. **Fixed in all four chord steps, not only
  the reported one**, which is what FR-014 asks for; no flavour was dropped, which is FR-014a. The
  file already knew the answer — `openShell` refuses to trust a painted prompt and runs a real
  command. **#252 is still open** (T045).
- [X] **T038** [US2] Fix #246 — but as a **pushdown**, not a repair: the persisted-layout assertion is
  an integration test. Close as superseded if the E2E goes.
  **Done `aed7359` — but as a REPAIR, and the pushdown was rejected on evidence rather than skipped.**
  The reported failure was an empty READ, not a late write: `layoutJson` returned `''` for any read
  it could not complete, the old code slept 3000 ms and read once, and an unreadable moment became
  `''` and an assertion accusing a revert that never happened (FR-013 exactly). A fence was tried
  first and is impossible here, and the reason is recorded in the file because the next person will
  try it too — the daemon OWNS the layout and the daemon has just been killed, so there is no later
  write to fence against; measured, the UI reaches three tabs while the stored layout stays at one.
  The wait therefore stays with its justification (FR-019) and the read is what changed. **The
  variance from this task's instruction is deliberate and is the finding**: the assertion cannot move
  to integration, because what it is about is a read taken while the process that owns the file is
  dying. **#246 is still open** (T045).
- [X] **T039** [US2] Verify #245 — `b7411c0` already added the settable debounce. Confirm under
  deliberate load (FR-011a), then close as fixed or superseded depending on whether the assertion
  moves to integration.
  **Done `1e70e90` + `aed7359`.** The test side drops the wall-clock guard for the pinned debounce
  and logs the child's lifetime as evidence rather than asserting on it —
  `terminate-all-drain.e2e.ts:483` pins the app's autosave debounce so no renderer in it can
  self-save, and `:558` records the premise as **structural, not measured**. FR-011a's
  under-load confirmation is discharged by construction rather than by a loaded run: a guard that no
  longer reads a clock has nothing left for load to perturb, which is the stronger answer of the two.
  **#245 is still open** (T045).
- [X] **T040** [US3] Complete the declared-sleep register: every remaining fixed wait justified in one
  - ***COMPLETE 2026-08-18.*** `packages/ui/tests/unit/sleep-declared.test.ts` fails the build on an
    undeclared wait. **0 undeclared of 47 call sites**, against a baseline of 222 undeclared with
    **137 carrying no comment at all**. The suite's deliberate idle time went 293.55s → 70.45s
    across the tree (SC-008 records the default-run figure and why 80% was not reached).
  - *It requires a distinct `sleep-justified:` token rather than "a comment nearby", because a
    comment above a sleep proves somebody wrote a comment, not that anybody justified the sleep —
    the baseline is full of sleeps under a comment describing the click above them. It also covers
    the HELPERS, which `sleep-budget.json` never did, and found one in `harness.ts` immediately; a
    sleep in a helper is the expensive kind, since it runs once per caller.*
  - *The 30 in `terminal-claude-keys.e2e.ts` named above are gone — 80.4s to zero, 27% of the tree
    in one file. `quiesced()` in the harness is what replaced most of them: it waits until a
    redrawing surface stops changing instead of guessing how long a redraw takes, which is faster on
    an idle machine AND still correct on a loaded one.*
  - *One correction went to the GUARD rather than the code it judged: its first version wanted the
    marker on the line immediately above, which rejected the ordinary way people write a two-line
    reason and marked ten properly-justified sleeps as bare.*
  place, build-enforced (FR-020, FR-021, SC-006). **Sequence this AFTER Phase 4** — the denominator
  is 222 sites today and Phase 4 deletes an unknown share of them, so writing justifications first
  means writing them for waits that are about to be deleted. Opt-in specs are governed by the same
  justification rule but excluded from the idle budget (FR-022), and the ratchet has no such
  distinction today — add it or record why it does not need one.

  **NOT DONE, and the half that exists is the wrong half for SC-006.**
  `packages/ui/tests/e2e/sleep-budget.json` is a per-file COUNT ratchet with `"total": 224` — it
  makes the number unable to rise, which FR-020 wants, but it holds no justification per wait, which
  FR-021 and SC-006 want. `aed7359` says so in terms: *"Fabricating 224 justifications would have
  been worse than none."* The FR-022 opt-in distinction is still absent from the ratchet. The
  sequencing note above still holds — Phase 4 is incomplete, so the denominator is still moving.

  **STILL OPEN 2026-08-18, and the size is the point.** The ratchet
  (`packages/ui/tests/e2e/sleep-budget.json`, total **220**) counts CALLS and not REASONS, so it
  stops the number rising without establishing that any individual wait is justified.

  *That is a real gap and it is not cosmetic: a sleep asserts that N milliseconds is always enough
  on every machine, which is the defect class behind #245, #246 and #251 — all three closed on this
  branch, all three instances of one bug with 219 siblings still in the suite. The three flakes that
  kept SC-001 open are the same family, one step removed: they poll rather than sleep, and still
  give up too early under load.*

  *`terminal-claude-keys.e2e.ts` alone holds 30 of the 220. Justifying each in one line means
  deciding, per site, whether there is an observable to wait on instead — which is the work, and it
  is why the ratchet was built first: it stops the number growing while the justification is
  outstanding.*
- [X] **T041** [US4] Finish launch amortisation against [launch-assessment.md](./launch-assessment.md)
  - *Done 2026-08-18.* Launch amortisation finished: every spec file carries a decision in `packages/ui/tests/e2e/launch-sharing.md` (SC-009) and every decision the evidence supports is applied. 592 → 382 launches; SC-027 met.
  for the files that survive the cut (FR-023..FR-030, SC-009, SC-010).

  **PARTIALLY DONE — 681 → 566 launches, a 16.9% fall against SC-010's floor of 40%** (measured at
  `d75247c` by `node scripts/count-e2e-launches.mjs`; 244 spec files, 730 tests). Substantial work
  landed — `dcdcb46`, `14bb0de`, `f9534c7`, `91b1af0` and others, including eighteen launches taken
  out of six files an earlier pass had called unconvertible, and two conversions REVERTED for flaking
  under `--repeat-each=3` rather than patched. **158 launches still to remove**, and SC-010's
  annotation in [spec.md](./spec.md) argues that the remainder is structural: the heaviest files left
  seed `THRONG_CONFIG_ROOT` before the app starts, which is the exact condition FR-024 says forbids
  sharing. Heaviest at `d75247c`: `terminate-all-drain` 19, `preferences-json` 16,
  `preferences-themes` 11, then `notice-logging`, `os-drop`, `preferences-reset`,
  `preferences-row-actions`, `preferences-settings` and `terminal-claude-keys` at 9 each — of which
  `os-drop` is a file T029 says to delete outright, so nine of the 158 are already spoken for.

---

## Phase 6: Documentation, measurement and issues

- [X] **T042** [US8] Rewrite `docs/testing.md` around five layers, two lanes, the markings and the
  budget. Every timing figure re-measured and naming its measurement (FR-058, FR-063, SC-014).
  **Done `1cfd460`, re-measured in `9ce9e2f` and `72dc7b9`.** `docs/testing.md:3-13` is the five-layer
  table, `:64-86` is *Two lanes* with the tags, the cap and the budget ratchet, `:329-361` is what
  puts a spec in the serial tier and `:372-378` records that sharding is gone. SC-014 is met by
  construction: every timing row names its date, its commit and its suite size, and the superseded
  ones at `:298-303` are kept deliberately so the drift is visible rather than edited away.
  **One residual defect, not enough to unpick the tick**: `:94` still says the gate has SEVEN stages
  and omits `component` from the chain, while `scripts/gate.mjs:59-71` runs eight. The Phase 1
  checkpoint above says eight. Fix in the same pass as the same error in `CLAUDE.md` (T043).
- [X] **T043** [US8] Rewrite the E2E sections of the repo `CLAUDE.md` to match. *(CLAUDE.md)*
  **Done `3e0094b`, timings refreshed in `9ce9e2f`.** `CLAUDE.md`'s *E2E on CI* section carries the
  `@core` lane and its cap of 50, the two-tag rule and the guard that enforces it, the budget ratchet
  and its re-seed obligation, the two local tiers, and *"Sharding is gone (spec 034)"* naming what was
  deleted. **Same residual defect as T042**: its `npm run gate` section lists seven stages and leaves
  `component` out, which is the one thing a reader of that section would get wrong.
- [X] **T043a** [US8] Amend the instruction sources FR-061 covers that the first pass missed:
  `README.md` and `CONTRIBUTING.md` both still state that every user-facing UI change ships passing
  E2E, and CONTRIBUTING is the one a first-time contributor reads. **Done 2026-08-16.**
- [X] **T043b** [US8] Remove the shard instructions from `.claude/agents/throng-e2e-harness.md`
  (the three-registrations list) and `.claude/agents/throng-build-release.md` (the rebalance
  instruction) once Phase 2 lands. They currently instruct an agent to maintain a file that will not
  exist, which is worse than saying nothing.
- [X] **T044** [US7] Measure both lanes on the same machine and publish the before-and-after against
  the 46.9-minute baseline, **including cost per surviving test** so a faster harness is
  distinguishable from a smaller one (FR-043, FR-058, SC-024).
  **Done `9ce9e2f` + `72dc7b9`**, published at `docs/testing.md:260-296` and annotated against
  SC-024 in [spec.md](./spec.md). Critical lane **2.1 minutes** against a ceiling of 12; full lane
  **28.4 minutes** against the 46.9 baseline, a 39% cut, parallel tier 3.8 and serial 24.6. The
  clause that stops deletion masquerading as speed is answered: **cost per surviving test 3.56 s →
  2.12 s**, over 791 executed at the baseline and 802 at the measurement — the suite executed MORE
  tests in LESS time, so the gain is the harness's and not the cut's. Two caveats travel with the
  figures rather than being dropped. **Note for the next measurement**: the cost-per-test figure
  lives only in `spec.md`, not in `docs/testing.md`, and the suite has since fallen to 777
  declarations, so both lane timings are now historical readings pinned to `a7c3d6c` / `f9534c7`.
- [X] **T044a** [US1/US7] Run the **full** lane twice consecutively for SC-001 and the **critical**
  - *Done 2026-08-18 — both runs taken, and the RESULT is that SC-001 is not met.* Run 1: 432
    passed, zero failed, zero flaky, 21.2 min. Run 2, immediately after: 429 passed, **3 flaky**.
    Accepted as a known limitation with the three named and their failure text recorded; see SC-001.
    The critical lane half was already met (SC-025, two clean passes). The task is complete because
    the measurement was taken and reported honestly — not because the answer was the one wanted.
  lane twice consecutively for SC-018/SC-025 — they are different claims about different sets and
  neither run evidences the other. State the cost before starting; `failOnFlakyTests` means one
  flake reddens either.

  **PARTIALLY DONE — the critical half is evidenced, the full half is not.** Two consecutive `@core`
  passes are published at `docs/testing.md:269-279`: 35 tests, 2.1 minutes, **zero failed and zero
  flaky both times**, which is SC-018/SC-025's evidence and is annotated as MET in
  [spec.md](./spec.md). **SC-001 has no such annotation and no such run** — the full lane has been
  measured once for wall-clock (T044), never twice consecutively for a flake verdict. That is the
  expensive half and it is the one still owed.
- [X] **T044b** [US7] Report the elevation-skip count and the quarantine count after the cut, and
  - *Done 2026-08-18, measured on the full run at `53ff359` (non-elevated).* **Quarantined: 2** —
    `editor-missing-aggregate.e2e.ts` (#277, the exception SC-026 records) and
    `terminal-altscreen-parity.e2e.ts`. **Skipped by elevation guards: 0**, and the reason is worth
    stating rather than reporting a bare zero: `skipIfElevated()` skips only when the run IS
    elevated, so on a normal developer machine those 27 files all RUN. The number to compare
    against the baseline’s is therefore the one from an elevated run, which only CI can take —
    see T044c.
  - *16 tests were skipped in total, none of them by elevation:* 12 in the opt-in Claude Code block
    (`THRONG_CLAUDE_E2E=1`, needs `claude` on PATH and a login) and 4 input-soak rounds. Neither
    count has risen.
  confirm neither has risen (SC-026, FR-033, FR-035). Note that CI now runs `--grep @core`, so an
  elevation-guarded `@extended` test's skip is not visible until a release run — say where the count
  comes from.

  **PARTIALLY DONE — the quarantine half is reported and reasoned, the elevation half is not.**
  Quarantine: **two** at `d75247c` — `editor-missing-aggregate.e2e.ts:183` (tagged, under #277) and
  `terminal-altscreen-parity.e2e.ts:134` (by title) — against one at the baseline, and SC-026 carries
  a bounded, evidenced exception for the rise rather than hiding it. **Elevation: no count has been
  reported against the baseline's.** `docs/testing.md:289-290` says 802 of 804 declarations ran and
  the remainder are elevation-guarded skips, which is a by-product of one run rather than the
  comparison FR-033 asks for, and it does not answer this task's own question about where the number
  comes from now that CI runs `--grep @core`. The baseline figures to compare against are in
  [baseline.md](./baseline.md): 18 skipped in the parallel tier, plus 3 `@admin` tests and 1
  `@quarantine` excluded by `grepInvert`.
- [X] **T044c** [US7] Read SC-016 off a real CI run, not a local one. It is a claim about runner
  - *Done 2026-08-18 from Actions run `32115443194` (green).* `E2E (@core)` **4 min 22 s**
    (ceiling 10), `E2E (@admin, elevated)` 3 min 41 s — about 8 runner-minutes for a push against
    the ~36 three shards used to spend. Read off CI rather than extrapolated from the 2.1-minute
    local figure, because the criterion is about runner minutes and a 10-core developer machine is
    not one.
  minutes and nothing local measures those; quote the Actions run.

  **NOT DONE.** No Actions run is quoted for SC-016 anywhere in this spec directory or in
  `docs/testing.md`; the only CI run cited (31956697834) is `origin/master`'s failure of
  `editor-missing-aggregate`, which is evidence for the SC-026 exception and not for the ten-minute
  ceiling. `docs/testing.md:282-284` says as much itself — the 2.1 minutes is local, runners are
  slower, treat it as a floor rather than a prediction. That is exactly the gap this task closes.
- [X] **T044d** [US4] Publish the launch count by the repeatable procedure FR-030 requires, and
  - *Done 2026-08-18.* Published by the repeatable procedure: `node scripts/count-e2e-launches.mjs`, which also re-derives the baseline via `--baseline <ref>`. That re-derivation is what found the published 681 to be the naive `runApp(` count rather than a launch count at all.
  reconcile the three live figures first: the spec says **681**, `harness.ts:214` says **604**, and
  they are counting different things (call sites versus executed launches). Say which SC-010 means.

  **PARTIALLY DONE.** The repeatable procedure exists and is published: `scripts/count-e2e-launches.mjs`
  (`4658aee`), named in SC-010's annotation, reporting **566 launches / 244 spec files / 730 tests /
  16.9%** at `d75247c`. SC-010's annotation also says which count is meant and why the obvious one is
  wrong — most shared-app files keep a LOCAL shim named `runApp`, so `grep -c 'runApp('` reads a file
  that opens two apps as opening seventeen, and an early measurement overstated the suite by ~40%.
  **The reconciliation is not finished**: `packages/ui/tests/e2e/harness.ts:214` still tells every
  reader of the shared-app helper that the suite is **604 launches**, which was never the same count
  and is now wrong by 38 as well.
- [X] **T045** [P] Dispose of the GitHub issues: adopt and rewrite **#129**; close **#103** as
  - ***COMPLETE 2026-08-18 — all eleven disposed, each with its reasoning on the issue rather than
    a bare state change.*** Closed: **#103** (overtaken), **#244** (repaired), **#245**, **#246**,
    **#251** (closed as NOT a defect — a mis-drawn tier boundary, with the worker-count curve
    attached), **#252**, **#129** (delivered as two lanes, and the comment says how that differs
    from the Release-only tier it asked for).
  - *Kept open, each with what 034 changed about it:* **#116** (a coverage GAP, not an excess —
    and 034 established that six of eight `os-drop` tests are not OS drops at all, which decides
    which layer it should be written at), **#117** (deprioritised: the spike was worth more at
    46.9 minutes than at 21.2, and the launch cost it targeted was taken another way),
    **#267** (kept on EVIDENCE rather than the hypothesis it was filed against — it did not
    evaporate as the suite shrank, and master is red on the same test).
  - ***#214 is fixed and left open deliberately***, so the PR closes it on merge rather than it
    being closed against an unmerged branch.

  **UPDATED 2026-08-18 — six of eleven disposed.** Now also closed, each with its diagnosis:
  **#245**, **#246**, **#251** (closed as NOT a product defect — a mis-drawn tier boundary),
  **#252**. That completes SC-005. **#214** is fixed and evidenced but left OPEN deliberately, so
  the PR closes it on merge rather than it being closed against an unmerged branch.
  Still owed: **#129**, **#116**, **#117**, **#267**.
  overtaken by Phase 2; keep and deprioritise **#117**; keep and retag **#116**; resolve **#214**,
  **#244**, **#246** by deletion or pushdown; close **#245**, **#251**, **#252** as fixed; keep
  **#267** open — it may evaporate when the suite shrinks, but not on a hypothesis.

  **PARTIALLY DONE — two of eleven disposed, checked against GitHub 2026-08-17.** Closed: **#103**
  (overtaken by Phase 2, as instructed) and **#244** (menu-keyboard's focus guard, repaired in
  `0d58409`/T009). Still open and still owed: **#129**, **#116**, **#117**, **#214**, **#245**,
  **#246**, **#251**, **#252**, **#267**. Four of those — #245, #246, #251, #252 — are the reported
  defects this feature was opened for, and all four are FIXED in the code (T036-T039 above) while
  their issues stay open. SC-005 names their closure explicitly, so this is the task standing between
  a finished fix and a met criterion.

---

## Dependencies

```
Phase 1 (T006-T011)  ──▶  everything in Stories 6-8
Phase 2 (T012-T019)  ──▶  Phase 4   (do not maintain a 235-entry plan through the churn)
   T012 ──▶ T014      (cut the tier coupling before deleting what it reads)
   T013 ──▶ T019      (extract the infra-fault rule before rewriting its script)
Phase 3 (T020-T025)  ──▶  Phase 4   (guards exist before the suite they police shrinks)
   T020, T021 ──▶ T022  (guards seen failing first — that is their Red step)
Phase 4 (T026-T034)  ──▶  T044, T042, T043   (measure and document what actually landed)
Phase 4              ──▶  Phase 5 re-assessment  (some target specs may be gone)
```

## Parallelisation

Genuinely parallel: **T016/T017** (two unrelated deletions), and **T045** (issue admin touches no
code). Everything else is sequential — the migration batches all edit `e2e-budget.json` and
`parallel-plan.json`, and two agents editing a budget file concurrently is exactly the conflict the
`[P]` marker exists to prevent.

Within a batch, per-file work parallelises across specialist agents where the files are disjoint;
the batch's single budget update is the join point.
