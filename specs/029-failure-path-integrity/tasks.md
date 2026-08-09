---

description: "Task list for 029 Failure-Path Integrity"
---

# Tasks: Failure-Path Integrity

**Input**: Design documents from `/specs/029-failure-path-integrity/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/failure-cause.md

**Tests**: REQUIRED. Constitution Principle V is non-negotiable, and SC-007 forbids declaring a fix by
weakening a test. The four E2E specs already exist and are **red** — they are the acceptance criteria,
not work to schedule.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisable — different files, no dependency on incomplete work
- **[Story]**: US1 (#204), US2 (#182), US3 (#196), US4 (#181)

## The red bar this feature turns green

| Spec | Currently fails on |
|---|---|
| `packages/ui/tests/e2e/terminal-launch-failure-config.e2e.ts` | 4 assertions — panel reverts, no retry, layout loses `"kind":"terminal"`, terminal never returns |
| `packages/ui/tests/e2e/daemon-death-notice.e2e.ts` | nothing on screen says the daemon stopped |
| `packages/ui/tests/e2e/fileop-lock-cause.e2e.ts` | 6 assertions across two tests — no folder named, no cause, raw errno is the headline |
| `packages/ui/tests/e2e/project-missing-root-wedge.e2e.ts` | 3 assertions — no folder named, no cause, raw internal error reaches the user |

**In these four files, no assertion may be LOOSENED.** That is what SC-007 forbids, and it is the
"declared, not made" failure mode.

Three edits ARE permitted, and tasks below rely on them:

- removing `expect.soft` (once a spec is expected green, a soft assertion hides a regression);
- removing the `[MEASURE-*]` logging, which existed to trace the defect;
- **ADDING** assertions — more coverage is never the failure this rule guards against.

Behaviour that is genuinely new UI gets its **own** spec rather than being bolted on, because a
replication spec should keep reading as the reproduction of its bug.

---

## Phase 1: Setup

**Purpose**: The one new module boundary. Everything else uses directories that already exist.

- [x] T001 Create `packages/core/src/failure/` with an `index.ts` barrel, and re-export it from `packages/core/src/index.ts`

---

## Phase 2: Foundational — the shared concept

**Purpose**: `FailureCause` serves all four stories. Nothing below this line can start until it exists.

**⚠️ BLOCKS EVERY USER STORY.**

### Classification (pure, unit-tested)

- [x] T002 [P] Write failing unit tests for `classifyFailure` in `packages/core/tests/unit/failure-cause.test.ts` — cover all five kinds of FR-011a, the `EBUSY`/`EPERM` split for `held`, the `operation` parameter resolving ambiguous `EPERM`, and `null` for an unmatched errno (FR-011b)
- [x] T003 Implement `classifyFailure` in `packages/core/src/failure/cause.ts` with the `FailureKind`, `FailureOperation`, `Holder` and `FailureCause` types from `contracts/failure-cause.md`
- [x] T004 [P] Write failing unit tests for `causeMessage` in `packages/core/tests/unit/failure-cause-message.test.ts` — one canonical sentence per kind, the subject interpolated, and the SAME text regardless of which reporter supplied it (FR-019e)
- [x] T005 Implement `causeMessage` in `packages/core/src/failure/cause.ts`
- [x] T006 [P] Write failing unit tests for `causeKey` in `packages/core/tests/unit/failure-cause-key.test.ts` — equal for same kind+subject, different for different subjects, and NOT derived from message text (the two measured #181 messages differ but share a cause)
- [x] T007 Implement `causeKey` in `packages/core/src/failure/cause.ts`

### Daemon state machine (pure, unit-tested)

- [x] T008 [P] Write failing unit tests for `nextDaemonState` in `packages/core/tests/unit/daemon-state.test.ts` — every transition in `data-model.md`, and specifically that `disconnected` yields `reconnecting` NOT `stopped` (a legitimate daemon restart must not raise a false alarm)
- [x] T009 Implement `nextDaemonState` and `DAEMON_GRACE_MS = 1200` in `packages/core/src/failure/daemon-state.ts`

### Suppression (pure, unit-tested)

- [x] T010 [P] Write failing unit tests for cause-keyed notice suppression in `packages/ui/tests/unit/notice-suppression.test.ts` — a second failure sharing a live cause raises nothing (FR-019); a DIFFERENT cause still raises (FR-019b); dismissal re-arms (FR-019c)
- [x] T011 Implement suppression in `packages/ui/src/renderer/common/notification.tsx`, keyed on `causeKey` and bounded by the notice's own lifetime

**Checkpoint**: `npm run test:unit` green, and the four E2E specs still fail exactly as before — nothing user-visible has changed yet.

---

## Phase 3: User Story 1 — a terminal that could not start keeps its panel (P1) 🎯 MVP

**Goal**: A terminal that fails to LAUNCH keeps its panel type; one that EXITS still reverts.

**Independent test**: `terminal-launch-failure-config.e2e.ts` goes green while `terminal-revert`,
`terminal-slow-start` and `terminal-persistence` stay green.

- [x] T012 [P] [US1] Write failing unit tests for the FR-003 split — landed in `packages/core/tests/unit/failure-cause-message.test.ts` rather than a separate file, since the predicate lives beside `causeMessage` and splitting them would have separated a rule from the wording it governs. Originally planned as `start-failure-policy.test.ts` for the FR-003 split — a `path-missing` cause preserves the panel type, a missing-flavour cause reverts it
- [x] T013 [US1] Implement the policy predicate in `packages/core/src/failure/cause.ts` (exported from the barrel), so both consumers ask one function rather than each deciding
- [x] T014 [US1] Carry a `FailureCause` (not a bare string) through the attach failure path in `packages/ui/src/renderer/terminal/use-terminal.ts` at `:998` and `:1088`
- [x] T015 [US1] Split `onError` in `packages/ui/src/renderer/terminal/terminal-panel.tsx:489` — a preserving cause sets an in-place start-failure state; an unsatisfiable one keeps calling `end()` (FR-001, FR-002, FR-003)
- [x] T016 [US1] Render the start-failure state in `packages/ui/src/renderer/terminal/terminal-panel.tsx`, reusing the `terminal-starting-*` surface shape, with the cause's message and a `terminal-retry-*` control (FR-004). **Entering the failure state MUST drop the loading skeleton immediately** — `PanelSkeleton` renders while `!attached && !giveUpSkeleton` and `giveUpSkeleton` is a 4000ms delayed flag, so a failed panel is never attached and would sit under an opaque "loading" cover for four seconds with the failure badge floating on top. That is not "presenting the failure in place"
- [x] T017 [US1] Add the Clear control to that state in `packages/ui/src/renderer/terminal/terminal-panel.tsx` — icon + hover title, calling `ws.clearPanelType` deliberately (FR-004a, FR-004b)
- [x] T018 [US1] Make retry act on ONE panel only in `packages/ui/src/renderer/terminal/terminal-panel.tsx` — no retry-all, no cascade to other failed panels (FR-004c)
- [x] T019 [P] [US1] Write a failing integration test in `packages/ui/tests/integration/terminal-remembered-cwd-fallback.test.ts` for a remembered directory that no longer exists
- [x] T020 [US1] Implement the remembered-directory fallback in `packages/daemon/src/terminal-service.ts` — start in the project root and report it, never fail a second time (FR-005a, FR-005b)
- [x] T020a [US1] Add Retry and Clear as items in the terminal Panel's menu in `packages/ui/src/renderer/terminal/terminal-panel.tsx` (FR-004d) — the Constitution binds a feature adding a panel action to add its menu item in the same increment, and FR-004a makes clearing user-invoked for the first time
- [x] T021 [US1] Remove `expect.soft` and the `[MEASURE-204-*]` logging from `packages/ui/tests/e2e/terminal-launch-failure-config.e2e.ts` and confirm all four assertions pass unweakened, INCLUDING that the reopened terminal carries its original flavour, shell arguments and startup command (FR-005 — verified, not inferred)
- [x] T021a [US1] Create `packages/ui/tests/e2e/terminal-start-failure-controls.e2e.ts` for US1's NEW UI — drive Clear from a start-failure state and assert the panel returns to the type-selection form keeping its position and title (US1 scenario 5, FR-004a); assert Retry and Clear both appear in the panel's context menu, right-clicking the PANEL BODY rather than the failure badge (the badge is a sibling with no handler of its own, so a click on it bubbles past and opens nothing) (FR-004d), which is reachable in this state because `onContextMenu` sits on a div rendered in every state (`terminal-panel.tsx:539`); assert both controls are icons with hover titles (FR-004b). A SEPARATE spec, symmetrical with T031a — new UI does not get bolted onto a replication spec, which should keep reading as the reproduction of its bug
- [x] T021b [US1] Register `terminal-start-failure-controls.e2e.ts` in BOTH `packages/ui/tests/e2e/shard-plan.json` AND the serial tier of `packages/ui/tests/e2e/parallel-plan.json` — it drives a context menu, which CLAUDE.md makes a categorical criterion, and `shard-plan.test.ts` cannot detect that. Deferring it to Phase 7 would leave a menu-driving spec running at several workers from Phase 3 onward, flaking UNRELATED specs **in the same commit as T021a** — `shard-plan.test.ts` fails the build the moment an unregistered spec exists

**Checkpoint**: #204 is fixed and independently shippable.

---

## Phase 4: User Story 2 — throng says when its daemon has stopped (P2)

**Goal**: Daemon loss is detected from the connection dropping, reported once, and recoverable from the status bar.

**Independent test**: `daemon-death-notice.e2e.ts` goes green.

- [x] T022 [P] [US2] Write a failing integration test in `packages/ui/tests/integration/daemon-supervisor.test.ts` — a real daemon killed under a live subscription drives `running → reconnecting → stopped`, and a restart drives it back
- [x] T023 [US2] Create `packages/ui/src/main/daemon-supervisor.ts` owning `DaemonState`, fed by the existing socket lifecycle
- [x] T024 [US2] Emit connect/disconnect into the supervisor from `packages/ui/src/main/daemon-events.ts:57` instead of retrying silently (FR-006, FR-006a)
- [x] T025 [US2] Broadcast `throng:daemon:state` to every window on each transition, and register `throng:daemon:restart` in `packages/ui/src/main/main.ts` (contract §3)
- [x] T026 [US2] Expose both channels through `packages/ui/src/preload/preload.cts` and `packages/ui/src/renderer/global.d.ts`
- [x] T027 [US2] Raise the stopped-daemon notice ONCE from the renderer on entering `stopped` (FR-007), using `causeMessage` for a `daemon-stopped` cause
- [x] T028 [US2] Add the daemon indicator to `packages/ui/src/renderer/statusbar/status-bar.tsx` — icon + hover title, reflecting all four states, and IS the restart control (FR-008, FR-009b)
- [x] T029 [US2] Disable the indicator while `restarting` so a restart cannot be triggered twice (FR-009b)
- [x] T030 [US2] Report restart success or failure to the user (FR-009)
- [x] T031 [US2] Attribute daemon-dependent failures to the stopped daemon in `packages/ui/src/renderer/state/projects-store.tsx` and `packages/ui/src/renderer/explorer/file-tree.tsx`, pointing at the status bar (FR-010)
- [x] T031a [US2] Create `packages/ui/tests/e2e/daemon-status-bar.e2e.ts` covering the new UI this story adds: the indicator reflects every state (FR-008), activating it restarts the daemon and reports the outcome (FR-009), it is disabled while restarting so it cannot fire twice (FR-009b), it is an icon with a hover title, and it SURVIVES the notice being dismissed — the reason the action lives there and not on the notice (FR-009a)
- [x] T031b [US2] Register `daemon-status-bar.e2e.ts` in `packages/ui/tests/e2e/shard-plan.json` **in the same commit as T031a** — `packages/ui/tests/unit/shard-plan.test.ts` fails the build if a spec is in no group, and a spec in no group runs nowhere, silently
- [x] T032 [US2] Assert in `packages/ui/tests/e2e/daemon-status-bar.e2e.ts` that NOTHING is disabled or blocked while the daemon is down, and that work needing no daemon still succeeds (FR-010a, FR-010b)
- [x] T033 [US2] Remove the `[MEASURE-182-*]` logging from `packages/ui/tests/e2e/daemon-death-notice.e2e.ts` and confirm it passes. (It contains no `expect.soft` — the assertions there are hard.)
- [x] T033b [US2] Assert in `packages/ui/tests/e2e/daemon-status-bar.e2e.ts` that the notice raised on daemon loss carries NO restart control of its own (FR-009a) — a testable negative, matching how T032 asserts the FR-010a/b negatives
- [x] T033c [US2] Assert the SC-002 ceiling: no more than **2 seconds** from killing the daemon to the notice being visible, in `packages/ui/tests/e2e/daemon-status-bar.e2e.ts`. Measured end to end, because `DAEMON_GRACE_MS` being 1200 at unit level does not prove what the user sees

**Checkpoint**: #182 is fixed and independently shippable.

---

## Phase 5: User Story 3 — a blocked file operation says what is holding the file (P3)

**Goal**: `EBUSY`/`EPERM` become a stated cause; throng's own terminals are named as holders.

**Independent test**: both tests in `fileop-lock-cause.e2e.ts` go green.

- [x] T034 [P] [US3] Write a failing integration test in `packages/ui/tests/integration/files-service-cause.test.ts` — a real holder process on a real folder produces a `held` cause, not a raw errno
- [x] T035 [US3] Classify at the single seam `message()` in `packages/ui/src/main/files-service.ts:403`, passing the operation so ambiguous `EPERM` resolves correctly (FR-011, FR-011a)
- [x] T036 [US3] Pass the operation kind from each of the seven `catch` sites in `packages/ui/src/main/files-service.ts`
- [x] T037 [US3] Assert in `packages/ui/tests/integration/files-service-cause.test.ts` that a failure matching none of the five kinds passes through byte-identical to today (FR-011b). Distinct from T002's unit coverage of `classifyFailure` returning `null` — this is the `files-service` seam actually preserving the raw string, which is what guarantees no regression. Also drive `ENOTEMPTY` and `EACCES` through the seam: FR-011c argues hardest for those two kinds precisely BECAUSE neither was replicated, which makes them the two most likely to ship unexercised
- [x] T038 [P] [US3] Create the holder-lookup seam in `packages/platform-windows/src/holder-lookup.ts`, returning "unidentified" (FR-012, FR-014)
- [x] T039 [P] [US3] Write failing unit tests in `packages/daemon/tests/unit/throng-holder.test.ts` — a known terminal cwd at or under the failed path resolves to a throng holder; an unrelated cwd does not
- [x] T040 [US3] Expose known terminal cwds keyed by panel from `packages/daemon/src/terminal-service.ts`, and resolve throng holders by prefix match (FR-013)
- [x] T040a [US3] Publish `PanelIdentity[]` (panel id → title, plus the sub-workspace window when not the main one) from the renderer to main over `throng:panels:identities`, per contract §2b. **This is the one genuinely unbuilt seam in the design**: the daemon knows cwds by panel id, the renderer owns panel titles and window ownership, and main — where classification runs — holds the layout only as an opaque blob. Nothing joined them before 029
- [x] T040b [US3] Create `packages/ui/src/main/panel-identity.ts` to hold the published identities and map a panel id to a holder, degrading to FR-013b when the id is unknown
- [x] T040c [P] [US3] Write failing unit tests in `packages/ui/tests/unit/panel-identity.test.ts` — a known id yields panel title; a panel in another window also yields its window title (FR-013a); an unknown id yields the "could not identify which panel" holder (FR-013b), which is the SAME branch an unresolvable third party takes so neither can rot unnoticed
- [x] T041 [US3] Name the sub-workspace window when the holding panel is in a different one (FR-013a), and degrade to "could not identify which panel" when it cannot be resolved (FR-013b)
- [x] T042 [US3] Put the raw error in the notice's Copy payload and the diagnostics log, adding no new control (FR-018, FR-018a)
- [x] T043 [US3] Remove `.soft`/logging from `packages/ui/tests/e2e/fileop-lock-cause.e2e.ts` and confirm both tests pass

**Checkpoint**: #196's classification half is fixed. Third-party holder naming remains deferred (plan.md Complexity Tracking).

---

## Phase 6: User Story 4 — a project whose folder is gone says so (P4)

**Goal**: One notice naming the folder, no raw internal errors, workspace stays coherent.

**Independent test**: `project-missing-root-wedge.e2e.ts` goes green.

- [x] T044 [P] [US4] Write a failing integration test in `packages/ui/tests/integration/project-entry-missing-root.test.ts` — entering a project whose root is gone yields a `path-missing` cause naming the folder
- [x] T045 [US4] Classify the `realpath` failure in `within()` at `packages/ui/src/main/files-service.ts:395` — this is the measured source of #181's `ENOENT` (FR-015)
- [x] T046 [US4] Classify the directory-lock failure so `Internal error: Cannot lock "…"` never reaches a notice (FR-016)
- [x] T047 [US4] Ensure both failures share one cause key so they collapse to one notice (FR-019), with the wording coming from the cause and not the reporter (FR-019e)
- [x] T047a [US4] Assert in `packages/ui/tests/e2e/project-missing-root-wedge.e2e.ts` that a SUPPRESSED secondary failure still renders its own in-place panel failure (FR-019a) — suppression must hide the duplicate notice, never which parts of the workspace broke
- [x] T048 [US4] Confirm a watcher re-reporting an unchanged failure stays silent while the notice stands (FR-019d)
- [x] T049 [US4] Verify the explorer and project list cannot disagree about the current project (FR-020) — this passes today and is a guard, so assert it rather than change it
- [x] T050 [US4] Remove `expect.soft` and the `[MEASURE-181-*]` logging from `packages/ui/tests/e2e/project-missing-root-wedge.e2e.ts` and confirm it passes

**Checkpoint**: all four bugs fixed.

---

## Phase 7: Polish & cross-cutting

- [x] T050a [P] Sweep the covered paths for FR-016/SC-003 — no user-facing notice carries a raw error code or internal error string. FR-017 gets this sweep via T051; its twin FR-016 had only one path-specific task, leaving SC-003 resting entirely on per-path assertions
- [x] T051 [P] Confirm every notice in the covered paths names its subject in prose, not via a path inside a diagnostic string (FR-017)
- [x] T052 [P] Run the regression fence — `terminal-revert`, `terminal-slow-start`, `terminal-persistence`, `notice-stacking` — and confirm all four still pass
- [x] T052a Measure `daemon-death-notice.e2e.ts`, `daemon-status-bar.e2e.ts` and `terminal-launch-failure-config.e2e.ts` at 6 workers and add any that starve or interfere to the serial tier — AND add `terminal-start-failure-controls.e2e.ts` unconditionally, because CLAUDE.md makes the focus criterion CATEGORICAL for any spec driving a context menu, which T021a makes it. Measurement decides the CPU cases; the menu case is decided already in `packages/ui/tests/e2e/parallel-plan.json`. All three drive real shells and the daemon specs force-kill a process tree — the CPU criterion the plan states, and a mis-resolved kill under contention is the #192 shape. Decide it here rather than discovering it on CI
- [x] T053 [P] Refresh the test counts in the "Measured on this suite" line of `docs/testing.md` to the post-029 figures (cited by heading, not line number — line-pinned references drift)
- [x] T053a Reconcile the user-facing documentation with what this feature added — the status-bar daemon indicator, the terminal panel start-failure state and its two controls, and the new notice behaviour — across `README.md` and the affected `docs/` guides. Documentation currency is non-negotiable and part of the definition of done
- [x] T054 Run the full local gates: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `test:integration`, `test:contract`, `npm run test:e2e`
- [x] T055 File the deferred third-party holder-lookup issue, referencing #133

---

## Dependencies

```
Phase 1 (T001)
   └─▶ Phase 2 (T002-T011)  ── BLOCKS EVERYTHING ──┐
                                                   ├─▶ Phase 3 US1 (T012-T021b) ← MVP
                                                   ├─▶ Phase 4 US2 (T022-T033c)
                                                   ├─▶ Phase 5 US3 (T034-T043, incl. T040a-c)
                                                   └─▶ Phase 6 US4 (T044-T050)  incl. T047a
                                                              └─▶ Phase 7 (T051-T055, incl. T052a/T053a)
```

**The four stories are independent once Phase 2 lands** — different files, different subsystems. US4
reads the classifier US3 wires into `files-service.ts`, so running US3 first avoids a merge in one
file, but neither blocks the other logically.

## Parallel opportunities

- **Phase 2**: T002, T004, T006, T008, T010 — five test files, no shared state
- **Phase 3**: T012 and T019 while T014–T018 proceed
- **Phase 5**: T038 and T039 are different packages from T035–T037
- **Across stories**: after Phase 2, US1/US2/US3/US4 can proceed concurrently

## Implementation strategy

**MVP is Phase 1 + 2 + 3.** That fixes #204 — the only one of the four that destroys persistent user
state — and is shippable alone.

Then US2 (total, silent failure), US3 (frequent, misleading), US4 (same defect, lowest cost), in that
order. Each phase ends with its E2E going green, so progress is measured by the red bar shrinking
rather than by tasks ticked.

---

## Where the work actually landed

Recorded because a task list that quietly describes a different codebase is worse than none. Every
item below is done; only its address differs from what the plan guessed.

| Task | Planned | Actual | Why |
| --- | --- | --- | --- |
| T019 / T020 | integration test + daemon implementation of the remembered-cwd fallback | `fallbackToReport` in `packages/core/src/terminal/start-directory.ts`, unit-tested in `cwd-fallback-report.test.ts`; used by `terminal-ipc.ts` | The fallback resolves in UI main, not the daemon — `resolveStartDirectory` already lived in core and this is its sibling. Extracting it also FIXED it: the inline condition compared paths with `!==` while the value it compares against comes back path-normalised, so a remembered directory that was honoured could be reported as missing |
| T034 / T037 / T044 | two integration files, `files-service-cause` and `project-entry-missing-root` | one file, `files-service-cause.integration.test.ts` | Both drive the same seam. A second file would have been a near-duplicate of the first with one different root |
| T038 | seam in `packages/platform-windows/src/holder-lookup.ts` | as planned, and filed as #210 | — |
| T039 / T040b / T040c | `packages/daemon/tests/unit/throng-holder.test.ts`, `panel-identity.ts` | `packages/ui/tests/unit/throng-holder.test.ts` and `panel-identity.test.ts` | The join runs in UI main, which is the only process that can see both the daemon's cwds and the renderer's panel titles. The daemon cannot host a test for code it does not contain |
| T050a / T051 | a sweep of the covered paths | an exhaustive guard over the closed set in `failure-cause-message.test.ts` | A sweep is true on the day it is done. Every classified message comes from `causeMessage`, so asserting it over all five kinds is the same claim, permanently — and `Record<FailureKind, ...>` makes a sixth kind fail to compile until someone writes its wording |

### Defects found while doing the above, and fixed

None of these were in the four issues 029 set out to fix. All were found by writing a test, not by
reading the code.

1. **The grace timer never expired.** The reconnect loop's 500ms closes each restarted a 1200ms
   grace, so the daemon stayed `reconnecting` forever and was never declared dead.
2. **A stopped daemon went on dying.** `stopped` + another close returned `reconnecting`, so the
   whole cycle repeated roughly every 1.7s — the status bar alternating between two labels, and the
   notice returning a second after every dismissal.
3. **One window's panel identities erased another's.** A flat map cleared on every publish, while
   each renderer publishes only its own panels.
4. **The holder path comparison normalised case but not separators**, so a PEB-supplied
   `c:\proj\inner` never matched a stored `C:/Proj/Inner` and the lookup silently found nothing.
5. **The remembered-cwd fallback compared paths by string** — see T019 above.
6. **Three icon tokens named glyphs the theme does not define**, rendering as invisible controls.
   Guarded now by `icon-tokens-exist.test.ts`.

---

## Phase 8: Convergence

Appended by `/speckit-converge` after implementation. Two gaps between what the artifacts call for
and what the code does — neither is missing behaviour; both are things the feature claims that
nothing currently proves.

- [x] T056 Assert the remembered-directory fallback NOTICE renders per FR-005a (partial) — `terminal-panel.tsx:747` draws `terminal-cwd-fallback-<id>` and its dismiss, and NO test at any layer asserts it appears. `fallbackToReport` is unit-tested, but that covers only WHEN to report; FR-005a's "MUST say so in the panel" is unverified. It is the one 029 surface with zero coverage — `terminal-start-failed`, `terminal-retry`, `terminal-clear`, `status-daemon` and `daemon-error` are all asserted. Cover that the notice appears when a remembered subfolder is gone, names the vanished folder, is NOT an error (the terminal started), and can be dismissed
- [x] T057 Reconcile `contracts/failure-cause.md` with what shipped per plan: contract (partial) — the contract exists for surfaces "consumed by more than one package", and three are absent: `terminal.list { refreshCwd }` (daemon↔main), the files-bridge failure envelope carrying `cause` (main↔renderer), and `cwdFallback` on the attach envelope. §2b also specifies a `HoldingPanelQuery` answered by the daemon, where what was built has main call `terminal.list` and run the prefix match itself — so the contract currently describes a design that does not exist
- [x] T058 Write the raw error to the DIAGNOSTICS LOG as well as the Copy payload per FR-018 (missing) — FR-018 names both, deliberately: Copy serves the user writing a bug report while the notice is on screen, the log serves everyone after it has been dismissed, which is the state a support conversation actually begins in. Only Copy shipped, and T042 was ticked claiming both. `FilesService` gains an injected `setDiagnosticLog` seam (explicit, not a bare `console.warn` that would silently stop working the day someone removed `attachConsole`), the daemon logs at its two classification sites, and only DEMOTED failures are logged — an unclassified one is already shown verbatim, so logging it would duplicate the notice

> **T042's tick was false when it was made.** It claimed the Copy payload AND the diagnostics log; only Copy existed. Recorded rather than quietly corrected, because a task list that has been wrong once is worth knowing about.
