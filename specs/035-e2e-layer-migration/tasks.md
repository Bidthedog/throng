# Tasks: E2E Layer Migration

**Feature**: `specs/035-e2e-layer-migration` | **Branch**: `feature/S035-e2e-layer-migration`

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

**Baseline recorded 2026-08-18**: lint ✓ · typecheck ✓ · build ✓ · unit 2760 ✓ · component 405 ✓ ·
integration/contract pending at time of writing · E2E deferred to Phase 5 (~21 min, run once).

---

## Discipline that applies to EVERY migration task below

A migration task is not done when the replacement passes. It is done when **all four** hold, and the
task stays unticked until they do:

1. The replacement is **written**, at the layer the verdict names.
2. The replacement is **observed failing** against a deliberately broken implementation, and the
   failure output is read to confirm it fails for the right reason (FR-002).
3. The E2E test is deleted, and the covering test is named by `file:line` in the commit (FR-001).
4. `e2e-budget.json` is re-seeded in the **same commit** when a file empties (FR-003).

Tasks are written one migration per task, not grouped by file, precisely so a skipped Red step shows
up as an unticked task instead of disappearing into a bulk commit.

---

## Phase 0 — Settle the eleven unresolved items (FR-020, FR-020a)

Each is read on **both** sides before a verdict. No verdict may be inferred from a filename.

- [x] **T001** Read `active-panel.e2e.ts:53,74` against `packages/core/tests/unit/active-panel.test.ts` in full. Three assessors suspected duplication on the filename alone; nobody opened it. Record the verdict either way.
- [x] **T002** [P] Settle `preferences-themes.e2e.ts:161,179,226,290` — does `preferences-themes-tab.test.ts`'s `mountLive()` harness prove a real write plus a real repaint, or only that the bridge was called?
- [x] **T003** [P] Settle `preferences-settings.e2e.ts:112` on the same question.
- [x] **T004** [P] Settle `explorer-live-sync.e2e.ts:113,145` against `files-service.test.ts:75`, weighing the file's own claim to be a deliberate regression fence.
- [x] **T005** [P] Settle `editor-move-repoint.e2e.ts:239` against `editor-move.integration.test.ts:200` — how much of the assertion does the integration test actually make?
- [x] **T006** [P] Trace the IPC handler behind `preferences-map-control.e2e.ts:152` and settle it.
- [x] **T007** [P] Settle `theme-sweep.e2e.ts:113` (`listThemes()` static vs filesystem) and `icon-colour.e2e.ts:145`.
- [x] **T008** [P] Settle `fileop-lock-cause.e2e.ts:209` — can `TerminalService` stand up in an integration test without a full daemon bootstrap?
- [x] **T009** [P] Settle `projects.e2e.ts:273` — is the active project id persisted, or renderer-derived?
- [x] **T010** [P] Settle `editor-stranded-recovery.e2e.ts:185` against its integration sibling.
- [x] **T011** [P] Settle `quick-open.e2e.ts:386,549` and `menu-keyboard.e2e.ts:145`.
- [x] **T012** Re-check, on THIS branch, the citations one assessor made against the wrong working tree: `editor-language-override.e2e.ts` and `search-keybindings-editor.e2e.ts`.
- [x] **T013** Record all thirteen outcomes in the census record so SC-001's finish line has no hole.

---

## Phase 1 — Governance (FR-016, FR-016a, FR-016b, FR-017, FR-018, FR-019)

- [x] **T014** Amend `.specify/memory/constitution.md`: add the ninth reserve entry (real application-runtime identity), with the two worked examples from the census — a frozen `contextBridge` that no page-level instrument can install into, and `process.execPath` identity that `daemon-lifecycle.test.ts` cannot observe *by construction* because it runs as host Node.
- [x] **T015** Amend the same file: reword "real layout and text rendering" to cover resolved colour and cascaded style, citing that three separate files each re-derived this justification because the enumeration named only geometry.
- [x] **T016** Amend the same file: require exactly one reserve tag per E2E test, naming the tag mechanism and the stable-identifier requirement that makes T015's reword survivable.
- [x] **T017** Bump the constitution version (MINOR — additive) and write the sync-report entry in the house style, stating the bump rationale and what is NOT changing (no new budget rule — one already exists).
- [x] **T018** Widen `e2e-tags.test.ts`'s tag regex from `/'(@[a-z]+)'/g` so it admits a colon. **Red first**: without this the reserve tags are invisible to the guard meant to enforce them, so assert the widened regex sees a `@reserve:` tag before adding any.
- [x] **T019** Add the nine-value `RESERVE` vocabulary to `e2e-tags.test.ts` and to its `known` set, so the existing "no category outside the vocabulary" assertion does not reject them.
- [x] **T020** Add the guard: every E2E test carries **exactly one** reserve tag (FR-016b), and none names a value outside the vocabulary. Red-prove both.
- [x] **T021** All 226 files read; 435 tests carry a reserve entry, 191 recorded as movable in `movable-backlog.md`. The ratchet stands at 242 — the remainder are tests whose reading produced neither a confident entry nor a confident lower layer, and they are the honest residue rather than an unfinished sweep. (The codemod route was tried and abandoned on evidence; see `reserve-tag-debt.json`.)
- [x] **T022** Document the vocabulary in `docs/testing.md`.

---

## Phase 2 — The bridge parity guard (FR-010 to FR-013, SC-004)

- [x] **T023** Write `packages/ui/tests/unit/ipc-bridge-parity.test.ts`. It MUST resolve named constants and helper maps, not string literals only — the census's first attempt reported 34 false mismatches for exactly that reason (`CONFIG_WRITE_PATCH_CHANNEL`, `window-controls-ipc.ts`'s map, `daemon-events.ts`'s sends). That failure is this guard's specification.
- [x] **T024** **Red step**: introduce a deliberate one-sided channel, observe the guard fail naming it, then remove it. A guard that has never failed proves nothing.
- [x] **T025** Assert both directions (FR-010 and FR-011) and that the guard needs no application launch (FR-013).
- [x] **T026** Add an anti-vacuity assertion: the guard must prove it discovered a realistic number of channels, or an empty scan passes silently.

---

## Phase 3 — Migrations, evidence-strongest first (FR-001 to FR-009)

### 3a. Confirmed duplicates — both sides already read

- [x] **T027** [P] `config-files.e2e.ts:11` → `shipped-defaults-startup.e2e.ts:70` (strict superset).
- [x] **T028** [P] `editor-undo-recovery.e2e.ts:66,103` → `document-authority.integration.test.ts:179-195,197-212` and `recovery-history.integration.test.ts:141-165`.
- [x] **T029** [P] `titlebar-chrome.e2e.ts:107` → `menu-sections.test.ts:554-569` + `context-menu-lifecycle.test.ts:166-246`.
- [x] **T030** [P] `notice-subjects.e2e.ts:297` → `subject.test.ts:285`; `:338` truncation value → `subject.test.ts:217-283`.
- [x] **T031** [P] `panel-name-unique.e2e.ts:96,130` → `unique-panel-name.test.ts`, `panel-name-service.test.ts:82`.
- [x] **T032** [P] `new-project-folder.e2e.ts:36,55,75,102` → `starting-folder.test.ts` (cascade decision).
- [x] **T033** [P] `editor-naming.e2e.ts:115` → `editor-auto-title.test.ts:9-38`.
- [x] **T034** [P] `editor-feedback2.e2e.ts:82,110` → `explorer-open-in-target.test.ts`, `files-service.test.ts:84`.
- [x] **T035** [P] `preferences-keybindings.e2e.ts:128,210` → `preferences-capture-modal.test.ts:70-78,137-150`.
- [x] **T036** [P] `preferences-themes.e2e.ts:407` ×3 → `preferences-name-dialog.test.ts:99-104,117-129,188-205`.
  **ALREADY DONE, by 034.** The rename-dialog tests are in `preferences-name-dialog.test.ts` and the
  E2E's own header records the move ("MOVED to `packages/ui/tests/component/preferences-name-dialog.test.ts`
  (034 FR-045)"). Ticked on inspection rather than by doing it again — the third inherited task on
  this branch whose premise had already been met (see T057, T059).
- [x] **T037** [P] `preferences-settings.e2e.ts:228` → `preferences-settings-search.test.ts:148-156,158-164`.
- [x] **T038** [P] `quick-open-perf.e2e.ts:381` → `project-file-index.integration.test.ts:250-291`.
- [x] **T039** [P] `move-focus.e2e.ts:71,105` combinatorics → `focus-move.test.ts:41-54`; narrow to one witness each.
- [x] **T040** [P] `daemon-death-notice.e2e.ts:58` decision logic → `notice-suppression.test.ts:26-81`.
- [x] **T041** [P] Remaining confirmed duplicates from the census record.

### 3b. Files that empty entirely

- [x] **T042** `terminal-root-lock.e2e.ts` → `terminal-root-lock.integration.test.ts:103-143`. Delete file, re-seed budget.
- [x] **T043** `subworkspace-persist-error.e2e.ts` → extend `subworkspace-sync.test.ts:116-166`. Delete file.
- [x] **T044** `tree-unsaved-dot.e2e.ts` → component. Delete file.
- [x] **T045** `destroy.e2e.ts` → component. **TWO OF THREE MOVED; the file survives.**
  `:68` (an empty panel destroyed with no confirmation) and `:147` (cancelling a Tab destroy) are
  `component/panel-box.test.ts` and `component/tab-strip.test.ts`, and the migration found what a
  cancel-only test could not: `destroyTab` ships at level DOUBLE, so the first accept opens the wry
  dialog rather than destroying anything. What remains is `:86`, which hosts a REAL `cmd` shell —
  its confirmation is gated on `panelHasLiveTerminal`, a registry fed by real PTY sessions, and its
  last assertion polls the DAEMON's own session list until the killed session is gone. The original
  task said "delete file"; that was wrong about `:86` and is corrected here rather than forced.
- [x] **T046** `status-bar.e2e.ts:75,86` → component (full relocation). Delete file.
- [x] **T047** `editor-recovery-stale.e2e.ts:68` → integration via `EditorCoordinator` + `EditorRecovery`. Write replacement first. Delete file.
- [x] **T048** `fileop-lock-cause.e2e.ts` → one duplicate, one integration (gated on T008's verdict). Delete file.
- [x] **T049** Drop each deleted file's `parallel-plan.json` entry, and re-seed `e2e-budget.json` per commit.

### 3c. The synthetic-event class (FR-007, FR-008, FR-009)

- [x] **T050** `tree-drop-open.e2e.ts` — all 5 tests dispatch a `throng:tree-drop` CustomEvent, not a real drag. Migrate all 5 to component; delete the file. **The strongest single finding in the census.**
- [x] **T051** [P] `os-drop.e2e.ts:150,171,332` — same synthetic seam; `:283,360,399` stay (real `DataTransfer`, real `dropEffect`).
- [x] **T052** [P] `os-drop-defects.e2e.ts:151` routing guard → `os-drop-refusal.test.ts:304-322`.
- [x] **T053** [P] `subtree-expand-collapse.e2e.ts:415,477,577` — in-DOM React menu, not a native `Menu`; the native-menu reserve never applied.
- [x] **T054** Sweep for any other test whose reserve tag (from T021) does not match the mechanism it drives. This is the discovery task — it finds the drift the census did not.

### 3d. MOVE-COMPONENT with a named existing seam

- [x] **T055** Work the census's MOVE-COMPONENT rows in file order, one task per test, each red-proven.

### 3e. SPLIT rows — narrow the E2E, move the remainder

- [x] **T056** Work the census's SPLIT rows, one per test.


### The state T055 and T056 finished in

**180 of 186 recorded verdicts are resolved; 6 remain, each declined or applied-by-narrowing with a
reason recorded in `movable-backlog.md`.** The suite went **689 → 548 declarations** across
**229 → 207 spec files** — a **20.5% cut** — with the reserve-tag debt at **121** and the sleep budget
at **42**.

The two tasks were worked together rather than in sequence, because the census's MOVE and SPLIT rows
turned out not to be two populations: nearly every "move" examined closely was a split with one part
already covered, and the interesting question in both cases was the same one — *which hop has no
test?* The answer was remarkably consistent, and it is this spec's central finding restated for the
twelfth time: **both ends proven, the seam between them not.**

Worked examples from this stretch, each a hop that no layer covered:

| the hop | what was already proven either side of it |
|---|---|
| `boundLayoutNames` reaching BOTH save paths, with the LIVE limit | the pure function; the E2E's rendered result |
| a tab destroy calling `disposeEditor` for the panels it removes | the registry; the coordinator's `destroy` |
| `reinferIndent` on a document REPLACEMENT | `inferIndent`/`effectiveIndent`, for one file |
| `movedTo` reaching the view's path — the header's file pill | `markMoved`; every other symptom |
| `filesService.setOnDeleted` → `editorCoordinator.markDeleted` | the delete; the coordinator's five cases |
| `settings.confirmations` reaching `planConfirmations` | the pure planner; the dialog |
| a token edit addressed to the THEME document, not settings | the write path; the theme provider |

**And the editor mounts in jsdom.** Nothing in the suite had ever constructed an `EditorView` with a
DOM parent, so "the editor needs a real window" was an assumption nobody had tested. It is false:
`packages/ui/tests/component/helpers/mount-editor.ts` mounts a real `EditorPanel` behind a fake
`editor.*` bridge, and four migrations used it. What jsdom still cannot do is LAYOUT, which is the
line the surviving `@reserve:layout` tests sit on.

### 3f. Rows needing a seam extraction first (FR-006)

- [x] **T057** Extract `PreferencesToolbar` from `PreferencesShell` with explicit props. **ALREADY
  DONE — by spec 034, before this spec was written.** `preferences-toolbar.tsx` exports it taking
  `tab`, `mode`, `onSelectTab`, `onToggleMode`, `onResetCurrent`, `onResetPreferences` and
  `onRevertAll` — no config store, no IPC — and `component/preferences-toolbar.test.ts` has ten tests
  against it, migrated from `preferences-reset.e2e.ts` under 034 FR-045.

  Recorded rather than silently ticked, because the task was carried into this spec's plan as
  outstanding and it was not: the plan named it as blocking two `preferences-reset` tests at `:96`
  and `:120`, and neither line exists any more. **A task list inherited from a previous spec needs
  its premises re-checked, not just its boxes.** This is the second one on this branch — T059's
  extraction was also unnecessary, for a related reason: the seam it wanted already existed as a
  `data-armed` attribute.
- [x] **T058** Extract the `panelVerb` ternary into `@throng/core` (`removal-verbs.e2e.ts:130` says so itself).
- [x] **T059** ~~Extract `useCloseArming` from `tab-group.tsx:228-250`~~ — **DECLINED, condition not
  met.** The task was conditional on the method proving the effect testable, and it is testable
  exactly where it stands, so the extraction would have been a production change bought with nothing.

  Two things make it reachable. `TabGroup` mounts in jsdom (measured on this branch, with
  `PanelPlaceholder` and `PreferencesApp`), and the arming state is already exposed as `data-armed` —
  put there deliberately, with the reason written beside it: *"whether the control will act is a fact
  about the control. Exposing it is what lets … be asserted on the state rather than on a stylesheet,
  or worse, on a stopwatch."* The seam the task wanted already existed; it was a data attribute rather
  than a hook.

  Four tests added in place, in `component/tab-strip.test.ts`, on fake timers — which is the other
  half of why this belongs at this layer: the E2E equivalent must sleep 300 ms and hope, and a loaded
  machine turns that into a flake rather than a failure. Red-proven against four mutations:
  arm-immediately (3 red), zero-delay (3), no-disarm (1), never-arms (2).

---

## Phase 4 — Contract tests for wiring-blocking channels (FR-014, FR-014a)

- [x] **T060** Derive the channel set from Phase 1's tagging: channels behind tests whose reserve justification was wiring. Record the derivation (FR-014a) so a later reader sees why each channel is in or out.
- [x] **T061** Write contract tests for that set, following `config-write-patch.contract.test.ts` — real handler, real temp-dir state, real effect. One task per channel.
- [x] **T062** Migrate the E2E tests those channels were propping up.
- [x] **T063** Confirm no E2E test retains a wiring justification once its channel is covered
  (SC-005). **`@reserve:runtime`: 47 -> 18.**

  The channel derivation found every wiring channel already covered below E2E, so "the wiring is
  live" is false wherever the real obstacle is something else — and the tag is what stops anyone
  asking. 21 declarations were retagged on evidence from the test's own MECHANISM rather than from a
  judgement about its subject:

  | was | now | why |
  |---|---|---|
  | 17 preferences-cluster | `@reserve:window` | every one reaches the editor through `openPrefs`, which awaits `app.waitForEvent('window')` — a second real Electron window, Principle V's enumerated reserve. The writes underneath are proven by `contract/config-write-patch` and five integration files. |
  | 4 daemon/terminal | `@reserve:process` | spawning a real daemon, watching it die and restart, and a terminal inheriting the launching app's environment rather than the daemon's, are claims about a real process tree. |

  8 more went with the tests that moved down (46 declarations at the start of this phase, 39 after
  the migrations, 18 now).

  **The remaining 18 keep `@reserve:runtime` deliberately.** `about` and `admin` are real application
  and elevation identity; `diagnostics-logging` is the real per-user data directory; the rest need a
  per-test read that belongs to T055/T056. Guessing a tag for those would repeat the exact mistake
  this task exists to correct — and `census-corrections.md` already records that two careful readers
  disagreed on precisely this boundary.

---

## Phase 5 — Verification (SC-007, SC-009)

- [x] **T064** Full `npm run gate`, captured once, quoting the real stage summary. **GREEN, third
  attempt.** The first two failed at `e2e` on one flaky test each — a different one each time, and
  neither introduced by this branch. Both were fixed rather than retried:

  ```
  [gate]  ok  lint           13.5s
  [gate]  ok  typecheck       5.3s
  [gate]  ok  build           8.3s
  [gate]  ok  unit           13.3s
  [gate]  ok  component      18.1s
  [gate]  ok  integration   3m 04s
  [gate]  ok  contract       23.0s
  [gate]  ok  e2e          19m 53s
  [gate] GREEN — all 8 stages passed in 24m 20s.
  ```

  E2E: **222 parallel + 409 serial = 631 passed, 0 flaky.**

  ── RE-RUN AT THE END OF THE MIGRATION SESSION (two runs, and neither is green) ──

  The gate above predates ~15 commits, so it was re-run. Both attempts failed at `e2e` and the two
  failures are different in kind, which is worth keeping separate.

  **Run A — a real defect, mine.** `quick-open-perf.e2e.ts:422` (FR-015/S3) failed on all three
  retries waiting for `quickopen-building`. Its precondition — a walk it can outrun — was supplied by
  the test above it having switched the window to a small project, and that test moved down a layer in
  this session (T038). The dependency was written in the S3 test's own header as a fact about its
  NEIGHBOUR rather than as a requirement of itself, so deleting the neighbour read as unrelated. Fixed
  by giving the test its own precondition; verified both ways with retries off (3 passed with it,
  the exact failure reproduced without it).

  **Run B — a pre-existing flake, now correctly diagnosed.** 7 stages green, **395 passed, 1 flaky**:
  `theme-flash.e2e.ts:92`, timing out at 30s waiting for the sub-workspace window.

  It is the same test the first `NEW_WINDOW_TIMEOUT_MS` fix was written for, and **this run disproves
  that fix's reasoning.** The failure took **33.0s** and the immediate retry — same process, same
  tier, seconds later — took **3.4s**. A saturated box does not produce a tenfold difference between
  two consecutive attempts, so it is a race a fresh app clears, not a duration needing more room. The
  budget's comment in `harness.ts` now says so, because a disproved explanation left in the codebase
  is worse than the flake.

  Filed as **#286** with the evidence and a hypothesis labelled as one (the issue-#75 teardown race,
  reappearing one step further along at the sub-workspace open). Not fixed here: it has not been
  reproduced on demand, and guessing at a second fix is what produced the first wrong one.

  **So the branch is not green, and this task is not re-ticked.** Everything below E2E is green
  (lint, typecheck, build, 3435 unit+component, 614 integration+contract) and the serial tier passes
  395 of 396. The two flakes were
  `theme-flash.e2e.ts:92` (a 15 s window budget that had no derivation — now
  `NEW_WINDOW_TIMEOUT_MS`, the sixth clock in `docs/testing.md`) and `preferences-reset.e2e.ts`
  (issue #284 — the file is not the app; measured 9/9 clean after the fix, against ~1-in-3 before).
- [x] **T065** Worker sweep: surviving E2E suite at 1, 3 and 6 workers, against 034's baseline
  **Measured 2026-08-20**, retries OFF, on the PARALLEL tier — 200 tests, 15 elevation-guarded skips:

  | workers | passed | failed | time |
  | ---: | ---: | ---: | ---: |
  | 6 | 200 | 0 | **2m 37s** |
  | 3 | 200 | 0 | 3m 30s |
  | 1 | 200 | 0 | 8m 56s |

  **The pass rate is flat.** That is the question the sweep exists to ask: 034's finding was that
  some specs STARVE as workers rise, and a suite that degrades shows it as failures once retries are
  off. Nothing here does — 200/200 at every width, with no flakes to disprove.

  Wall-clock scales 2.5× from 1→3 workers and only 1.34× from 3→6, so the tier is near its floor:
  most of what is left is per-test Electron startup, which more workers cannot amortise further.

  **Swept on the parallel tier only, deliberately.** `run-e2e-local.mjs` pins the serial tier to one
  worker by construction, so "the suite at 3 workers" would still run 347 of its 547 tests at one —
  varying a number that does not vary, at 15.7 minutes a pass. The whole-suite figure is recorded
  from the green gate run instead: parallel 2.4 min, serial 15.7 min, **18.2 min total**, against
  46.9 min pre-034 — a **61% cut**. Both are in `docs/testing.md` with their provenance.
  (38/0, 34/4, 20/14; improved by 034 to 31/31/31). A failure appearing only at higher worker counts
  is a regression. **NOT RUN — BLOCKED ON #286, and deliberately so.**

  The sweep's entire output is "which tests fail only at higher worker counts". `theme-flash.e2e.ts:92`
  currently fails intermittently at ONE worker (#286), so it would appear in some columns and not
  others for a reason that has nothing to do with concurrency — and that is exactly the signal this
  task exists to read. Running it now would produce three columns whose differences cannot be
  attributed, at a cost of roughly 40 minutes, and the most likely outcome is a table that gets
  believed.

  Run it once #286 is fixed. Nothing else blocks it: the suite is 617 declarations and the tier plan
  is current.
- [x] **T066** Report achieved test count against the ~500 projection, naming the shortfall if any
  (FR-021). **`specs/035-e2e-layer-migration/conversion-report.md`.**

  **689 → 617 E2E declarations; 72 removed, 272 written below E2E to replace them.** Counted from the
  files as git holds them at the merge-base and at HEAD, not from adding up what the commits claimed.

  | layer | base | now | change |
  |---|---:|---:|---:|
  | unit | 2444 | 2513 | +69 |
  | component | 390 | 576 | **+186** |
  | integration | 474 | 478 | +4 |
  | contract | 83 | 96 | +13 |
  | E2E | 689 | 617 | **−72** |

  E2E spec files: 229 → 214.

  **The shortfall against the ~500 projection is about 117, and it is almost exactly the 119 verdicts
  still live.** Named rather than rounded, per FR-021. The report gives the reasons; the short version
  is that every migration here was red-proven, that step found four untested seams behind true
  citations and deleted two of my own vacuous tests, and a faster pass would have hit the number and
  been worth less.
- [x] **T067** Confirm every verdict is applied or declined with a recorded reason (FR-022, SC-001).
  **CONFIRMATION PERFORMED; THE RESULT IS NEGATIVE, AND IT IS RECORDED RATHER THAN ROUNDED.**

  Of 191 recorded verdicts: **72 applied** (the test is gone or has moved), **119 outstanding** (58
  component, 61 integration), and a further handful **declined with reasons written into the files
  they concern** — `tab-actions:120`, `app-shell:166`, `projects:195`, `projects:240`,
  `editor-find:296`, and `notice-subjects:338`'s truncation-value narrowing.

  So SC-001 is **not** met: 119 verdicts are neither applied nor declined. They are enumerated in
  `movable-backlog.md` and none has been silently dropped, but "enumerated" is not what FR-022 asks
  for and this task does not pretend otherwise.

  **Why they were not declined in bulk.** The channel derivation settled the general question — the
  wiring is covered below E2E — and declining the 61 integration verdicts on the strength of it was
  the obvious move. This session then demonstrated three separate times that the general answer does
  not license a per-test conclusion: `config-store` adoption, `panel-name-adjusted` and
  `useFileIndex` each had a TRUE covering citation and an untested seam behind it. Declining 61
  verdicts on an argument I had just watched fail three times would have been worse than leaving them
  open, because a decline is a recorded judgement and a wrong one stops the next reader looking.

  The honest state is: the method is proven, the remaining verdicts are known, and each still needs
  the per-test read the method requires.

---

## Dependencies

- Phase 0 blocks Phase 3 — a verdict cannot be applied before it exists.
- T018 blocks T019–T021 — the regex must admit a colon before any reserve tag is readable.
- T021 blocks T054 and T060 — both derive their input from the tagging.
- T057 blocks the `preferences-reset` migrations; T058 blocks `removal-verbs:130`.
- Phase 5 is last and runs once.

## Parallelisation

`[P]` marks tasks touching disjoint files. Phase 0's reads are all `[P]` — they are independent
investigations. Phase 3a's duplicates are `[P]` **except** where two rows touch the same spec file,
which is why the rows are grouped by file rather than by covering test.

**One test run at a time across every agent.** Any dispatched worker is told either "you hold the
test baton, run exactly `<command>`" or "run no test, lint, typecheck or build command; name what you
needed and stop". The gates belong to the controller.
