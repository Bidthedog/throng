# Tasks: Settings Write Integrity

**Feature**: 032-settings-write-integrity | **Date**: 2026-08-14 | **Revised**: after analysis
**Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md) | **Contract**: [contracts/config-write.md](./contracts/config-write.md)

Test-first throughout. Principle V is NON-NEGOTIABLE and FR-016 requires a test that fails against
today's code, so the Red step is the deliverable of Phase 2 rather than a formality inside it.

**`[P]` means genuinely parallel** — different files, no dependency on anything unfinished.

**Not every task names a file, and that is deliberate.** Tasks marked *(process)* are audits, runs or
decisions whose output is a recorded finding rather than an edited file. An earlier draft claimed all
43 tasks carried a file path; seven did not, and the claim was the defect rather than the tasks.

## Phase 1: Setup

- [x] T001 *(process)* Record the pre-change baseline in `specs/032-settings-write-integrity/research.md` — captured: lint, typecheck, build, unit 2200, integration 417, contract 69, preferences E2E 94/94 with retries off

## Phase 2: Foundational — the reproduction (BLOCKING)

Nothing in Phase 3+ may start until T005 completes. This is the repo's rule for a reported bug: the
failing E2E comes first, its output goes to the developer, and production code is not touched until
they confirm it genuinely reproduces the bug.

- [x] T002 Write the cross-window clobber reproduction in `packages/ui/tests/e2e/settings-write-integrity.e2e.ts`. **Forcing mechanism, not left to chance**: open Preferences, pre-fill the main window's project form, change `notifications.error.mode` in Preferences, then click project-save — exactly one click between the two writes. `createProject()` cannot be used as-is; its four interactions exceed the ~45 ms window
- [x] T003 Register the new spec in `packages/ui/tests/e2e/shard-plan.json` and in the serial list of `packages/ui/tests/e2e/parallel-plan.json` — **immediately**, because `packages/ui/tests/unit/shard-plan.test.ts` reds the unit layer the moment an unregistered spec file exists
- [x] T004 [P] Write the R2 probe in `packages/ui/tests/integration/config-watcher-partial-read.test.ts` — drive `startConfigWatcher` at a partially written settings file and record whether the broadcast payload is `DEFAULT_APP_SETTINGS`
- [x] T005 *(process, GATE)* Run T002 and T004 against HEAD with retries off, capture complete output to a file, and report the observed failure to the developer for confirmation before any production file is edited.

  **Pass criterion, stated so "it reproduced" is not a judgement call**: T002 must fail **10 out of 10** consecutive runs. It becomes a permanent suite member, and the constitution's flaky rule means a test that is red 6 runs in 10 is not a reproduction — it is a new flake being introduced deliberately.

  **Three outcomes, three responses.** Red 10/10 → confirmed, proceed. Green → the Context's hypothesis is falsified; stop, report, and re-argue the design from what the probe showed rather than building the fix anyway. **Intermittent** (the likeliest, since redness depends on winning a ~45 ms race with one Playwright click) → do not ship it as an E2E. Take the plan's own escape: demote the guarantee to the deterministic integration-level proof in T008/T009, keep the E2E only if it can be made reliably red, and say plainly which layer ended up carrying the evidence

## Phase 3: User Story 1 — A change I made stays made (P1)

**Goal**: A settings write changing one key cannot revert another key changed by another window.
**Independent test**: The quickstart's manual reproduction no longer reverts the setting, and
`settings-write-integrity.e2e.ts` goes green.

### Tests (write first, observe failing)

- [x] T006 [P] [US1] Unit tests for patch application in `packages/core/tests/unit/config-patch.test.ts` — ordered application, intermediate object creation, segment-array paths, rejection of empty paths and of `__proto__`/`constructor`/`prototype`
- [x] T007 [P] [US1] Contract tests in `packages/ui/tests/contract/config-write-patch.contract.test.ts` — guarantees G1, G2, G4, G10 and every error identifier including `unsupported-doc` and `read-failed`
- [x] T008 [P] [US1] Integration test for concurrent writers in `packages/ui/tests/integration/config-write-concurrency.test.ts` — two patches to different paths both survive whatever the order (G2), two to the same path resolve to the later (G3, disk half)
- [x] T009 [P] [US1] Soak test in `packages/ui/tests/integration/config-write-soak.test.ts` — 1,000 interleaved writes from two concurrent writers, zero lost (SC-004)
- [x] T010 [P] [US1] Contract test that an **unparseable base is refused** in `packages/ui/tests/contract/config-write-patch.contract.test.ts` — a corrupt `settings.json` plus a one-key patch must write nothing and return `read-failed` (FR-006a, G10). Without this the fix destroys every setting the user has

### Implementation

- [x] T010a [P] [US1] Integration test for main-process serialisation in `packages/ui/tests/integration/config-write-serialisation.test.ts` — two concurrent read-modify-write calls over *different* channels (a patch and a `resetSetting`) must not interleave; the later must read the earlier's result (G11, G12). Write it before T010b so the Red step shows the interleave

- [x] T010b [US1] **Implement the per-document serialisation point** in `packages/ui/src/main/config-write-lock.ts` — an async per-document lock held across read → apply → write, released on completion or failure. This is the task the whole feature rests on: without it the fix relocates the defect from the renderer into main rather than removing it, because two read-modify-write paths with an `await` between read and write interleave as read-A → read-B → write-A → write-B. Verified absent today — `config-write-ipc.ts` has no chain, queue, mutex or lock, and the only serialisation in the system is `writeChains` in a *renderer* module
- [x] T010c [US1] Route **every** main-process writer through the lock — `writeConfigDoc`, the new patch handler, and all **nine** `shipped-defaults-service.ts` writers: `resetSetting`, `resetBinding`, `resetSettings`, `resetKeybindings`, `resetEverything`, `restoreTheme`, `restoreAllThemes`, plus `seed():162` and `upgrade():183`. A writer that bypasses it is a defect (G12).

  `seed` and `upgrade` run at startup before a window can race them, so they are *probably* harmless — but "probably harmless" is the reasoning that hid four writers across three rounds of this spec, and taking the lock costs them nothing. Route them; if either turns out to need the lock **not** held (a startup deadlock), record that as a finding rather than as an omission

**The lock's own safety.** The daemon reads `settings.json` and never writes it, deliberately: `packages/daemon/src/composition-root.ts:114` records that "two processes writing one config file is how a config file gets truncated". UI-main is the sole writing process by an existing asserted invariant, which is what makes an in-process lock sufficient rather than a hopeful approximation. The two writers outside it are the E2E helper (G8's atomic replace covers it) and the user hand-editing the file (a named edge case).

- [x] T011 [US1] Implement `applyConfigPatch` in `packages/core/src/config/config-patch.ts` — pure, OS-agnostic, no Electron reference (Principle II)
- [x] T012 [US1] Export `applyConfigPatch` and `ConfigChange` from `packages/core/src/index.ts`
- [x] T013 [US1] Implement read-modify-write for the patch path in `packages/ui/src/main/config-write-ipc.ts` — confine, reject non-`settings` kinds, validate, read current, refuse an unparseable base, apply, bounds-guard the result, write atomically
- [x] T014 [US1] Register the `throng:config:writePatch` handler in `packages/ui/src/main/config-write-ipc.ts`
- [x] T015 [US1] Expose `writePatch` on the config bridge in `packages/ui/src/preload/preload.cts`, beside `write` at line 319
- [x] T016 [US1] Add `writeConfigPatch` to `packages/ui/src/renderer/config/write-config.ts`, sharing the existing per-document write chain so patches and document writes to one file cannot interleave
- [x] T017 [P] [US1] Convert the apply-client to send a change rather than a document in `packages/ui/src/renderer/preferences/apply-client.ts`
- [x] T018 [P] [US1] Convert `persistLastProjectFolder` to a single-key change in `packages/ui/src/renderer/sidebar/projects-panel.tsx` (line 207)
- [x] T019 [US1] Update the settings-tab and themes-tab callers of `createApplyClient` so they pass a path and a value — `packages/ui/src/renderer/preferences/settings-tab.tsx:130` and `packages/ui/src/renderer/preferences/themes-tab.tsx:115`

### Audit — the finding that nearly shipped

- [x] T020 *(process)* [US1] **Audit every settings write site — renderer AND main process — and record the verdict in research.md.** There are **eight**: `apply-client.ts:31` (converted), `projects-panel.tsx:210` (converted), `preferences-app.tsx:189` (converted by T020b), `shipped-defaults-service.ts:133` (converted by T020c), `json-tab.tsx:91` (retained — raw hand editing, carved out of FR-001), and `keybindings-tab.tsx:117` + `themes-tab.tsx:316`/`:441` (whole-document retained — no reported defect, and a dotted-key path representation is unasked-for work). Evidence for G5.

  **The audit covers `packages/ui/src/main` and `packages/daemon/src`, not just the renderer.** The main-process writers were missed by three successive passes that grepped only renderer call sites — and the phrase that hid them, "single-window document", is now deleted from every artifact. It was a substitution of *window* for *writer*: the main process is a writer, holds its own copy, and is not a window, so a rule expressed in windows could not see it. `shipped-defaults-service.ts` writes settings, keybindings and every theme
- [x] T020a [P] [US1] Integration test in `packages/ui/tests/integration/reset-setting-integrity.test.ts` — resetting one setting must not revert another key written concurrently (FR-001b), and must **refuse** rather than write defaults when the current document is unreadable (FR-006a)
- [x] T020b [US1] Convert Revert All in `packages/ui/src/renderer/preferences/preferences-app.tsx:189` (FR-001a). **The key set is defined, not left to the implementer**: the settings leaves that carry a `SETTINGS_METADATA` descriptor — equivalently, all leaves *except* `SETTINGS_INTERNAL_KEYS`, which is exactly where `newProject.lastProjectFolder` lives. That is the same registry the completeness gate already walks, so it stays correct without maintenance.

  Three things this task must settle rather than assume. **(a)** `OnEntrySnapshot` (`packages/core/src/config/theme-reset.ts:17`) captures **raw serialised documents**, not keys — `{settings: string, keybindings: string, themes, activeTheme}` — so the captured key set has to be derived by parsing the snapshot, and "revert only captured keys" has no referent until it is. **(b)** A descriptor-carrying key that did **not** exist at snapshot time has three defensible meanings — leave it, delete it, reset it to shipped default. Pick *reset to shipped default*: it is the only one expressible without reviving the `remove` variant that was cut under YAGNI, and it matches what "revert to how this window opened" means to a user. **(c)** `revertAll` also restores keybindings and themes, which `writePatch` rejects with `unsupported-doc`; those two continue through the document channel, so the write plan is deliberately **mixed**
- [x] T020c [P] [US1] Fix `resetSetting` in `packages/ui/src/main/shipped-defaults-service.ts:133` — it reads with a `DEFAULT_APP_SETTINGS` fallback and writes the whole document, so a reset against a corrupt file replaces every other setting with its shipped value. Refuse on an unreadable base and go through the **shared** read-modify-write path from T010b/T010c rather than keeping its own (FR-001b, FR-006a)
- [x] T020d [P] [US1] Fix `resetBinding` in the same file at line 122 — the exact twin of `resetSetting`, reading `keybindings.json` with a `DEFAULT_KEYBINDINGS` fallback, so resetting one action against a corrupt file replaces **every other binding** with its shipped value (FR-001c). An earlier draft made this an *audit* task; a MUST whose remedy is an audit is not covered
- [x] T020e *(process)* [US1] Audit the remaining reset and restore paths in the same file — `resetSettings:107`, `resetKeybindings`, `resetEverything:112`, `restoreTheme:87`, `restoreAllThemes:76` — confirm each is wholesale **by definition** rather than by accident, and that each now takes the lock (T010c). Record the verdict per method, not per category

### Verify

- [x] T021 [US1] Observe `settings-write-integrity.e2e.ts` passing, and add to it a **restart** assertion (FR-006, US1 scenario 4) and a **cross-window convergence** assertion — G3's second half, which a main-process test structurally cannot reach.

  **And a correction to T005's confirmation, which was invalid.** The reproduction selected
  `notifications.error.mode = 'never'`, and `never` is the one value on that setting which raises a
  CONSENT DIALOG first (030 FR-008). Nothing answered it, so no write was ever issued — the test
  failed because the value never arrived, not because anything clobbered it. It was then run ten
  times, came back red ten out of ten, and was accepted as a confirmed reproduction. A test that
  fails for a *different* reason than the reported one is indistinguishable from a real reproduction
  when you are looking at an exit code, which is the exact trap the repo's testing rule names. It now
  selects `timed`, which needs no consent, so the write happens and the race is actually run
- [x] T022 *(process)* [US1] Run the reproduction 20 times with retries off and record the count (SC-001) — **20 passed / 0 failed**, one worker, retries off

## Phase 4: User Story 2 — The suite cannot lose the change it is testing (P2)

**Goal**: No writer, application or test, can expose a partial file; an unreadable read recovers.

### Tests

- [x] T023 [P] [US2] Unit tests for `unreadable` in `packages/core/tests/unit/settings-read.test.ts` — an unparseable document reports `unreadable`, an out-of-range but parseable one reports only `corrected`
- [x] T024 [P] [US2] Integration test for the bounded re-read in `packages/ui/tests/integration/config-watcher-retry.test.ts` — an unreadable first read retries and broadcasts the recovered value (G6); a persistently corrupt file broadcasts after the retries are spent (G7)
- [x] T024a [P] [US2] Measure FR-004's bound in `packages/ui/tests/integration/config-broadcast-latency.test.ts` — the interval between a write completing and the payload reaching a subscriber must be under 100 ms (SC-008). An FR with a number nothing reads is the old unbounded wording wearing a figure; this is also the measurement that says whether the deferred cross-window broadcast in T048 is needed to meet it

### Implementation

- [x] T025 [US2] Add `unreadable` to `CorrectionOutcome<T>` in `packages/core/src/config/bounds-guard.ts` — extending the shipped type, not inventing a new one
- [x] T026 [US2] Report `unreadable` from `parseSettingsGuarded` in `packages/core/src/config/settings-read.ts` without changing the value it returns
- [x] T027 [US2] Define the `ConfigWatchPolicy` **injected constant** (3 attempts, 50 ms) in `packages/ui/src/main/config-watcher.ts`. Not an `AppSettings` key — **not** because the completeness gate forbids it (`SETTINGS_INTERNAL_KEYS` is a supported escape hatch, used by `newProject.lastProjectFolder`) but because these are tuning constants, not configuration: no user and no machine needs to vary them
- [x] T028 [US2] Implement the bounded re-read in `packages/ui/src/main/config-watcher.ts` using the injected policy
- [x] T029 [US2] Bind the policy in `packages/ui/src/main/composition-root.ts` — the main process's actual container. `startConfigWatcher` is called from `main.ts:715`, so passing it there would work, but Principle IX puts the boundary's bindings in one file and the plan claims "injected at the main composition root"; either the binding moves or the claim is false
- [x] T030 [US2] Create the single atomic test-write helper in `packages/ui/tests/e2e/helpers/config-write.ts` — **done**. Temp file in the *same directory* as the target (a rename is only atomic within a volume), then replace, retrying EPERM/EACCES/EBUSY on a **1000 ms budget at 20 ms intervals** — the actual numbers in `renameWithRetry` (`config-store.ts:42`), so the test path and the product path fail at the same point. An earlier draft of this task said "10 attempts at 20 ms", which is 200 ms and would have made the helper give up while the product was still trying
- [x] T030a [P] [US2] Assert the application's own rename-retry exhaustion in `packages/ui/tests/integration/config-store-retry-exhaustion.test.ts` — FR-009's second half ("MUST report a definite outcome once the retries are spent") is currently unasserted for the product path; T030 only covers the test helper
- [x] T031 [US2] Convert **all four** genuine running-app writes to the shared helper: `packages/ui/tests/e2e/preferences-json.e2e.ts:122` and `:151`, `packages/ui/tests/e2e/keybindings.e2e.ts:36`, and `packages/ui/tests/e2e/terminal-flavours.e2e.ts:62`. The last two are not named in #253 and were found by the T033 enumeration; both also wait on a fixed `waitForTimeout(500)` rather than a condition, so replace that with a poll on the observable effect while you are in there
- [x] T032 [US2] Delegate `packages/ui/tests/e2e/helpers/tab-settings.ts` to the shared helper so exactly one implementation exists (FR-013)
- [x] T033 *(process)* [US2] **Re-audit which specs write a *running* app's config root** — **done**, recorded as R7a in `research.md`. 36 config-document writes in the E2E tree; 32 are pre-launch seeds, **four** are live. #253 named three sites: two correct, one (`preferences-settings.e2e.ts:378`) a pre-launch seed with no race, and it missed `keybindings.e2e.ts:36` and `terminal-flavours.e2e.ts:62` entirely. Classification is by brace depth relative to the enclosing `runApp`/`openApp`, not by eye
- [x] T034 *(process)* [US2] Post a correction on issue #253 naming the pre-launch seed, so the issue does not keep sending people to a call site with no defect

## Phase 5: User Story 3 — A configuration failure is reported wherever it happens (P2)

**Goal**: A write that cannot land is reported from whichever window issued it.

### Tests

- [x] T035 [P] [US3] Extend the **existing** `packages/ui/tests/e2e/config-write-failure.e2e.ts` with a main-window case — a failed write issued from the main window raises a notice naming the document. Extend rather than add: that file already covers #102's JSON-edit failure, and a near-duplicate `config-write-failure-notice.e2e.ts` would be pure duplication (Principle VIII)
- [x] T036 *(withdrawn)* [US3] ~~Add a sub-workspace window case~~ — **there is nothing to test.** `subworkspace-app.tsx` issues no configuration write of any kind, so a config write cannot fail there. Verified by grep: the only `writeConfig` callers are `preferences/*` and `sidebar/projects-panel.tsx`
- [x] T037 [P] [US3] Assert the diagnostics-log record survives a suppressed severity in `packages/ui/tests/integration/config-write-failure-logging.test.ts` (FR-012) — an earlier draft left this with no file, no layer and no test

### Implementation

- [x] T038 [US3] Make the subscriber mountable outside the Preferences window in `packages/ui/src/renderer/config/config-write-notices.ts`. **No cross-process dedup**: each window publishes only its own failures, so FR-011 holds by construction. An earlier draft cited `subjectOf()` for dedup — that function is private and unexported in the *main-process* module `packages/ui/src/main/files-service.ts:557` and cannot be imported from a renderer
- [x] T039 [US3] Mount it in the main window in `packages/ui/src/renderer/app.tsx`
- [x] T040 *(withdrawn)* [US3] ~~Mount it in `subworkspace-app.tsx`~~ — it would be a subscriber that can never fire. A window that issues no writes cannot have one fail. Mounting it "for symmetry" is dead code, and dead code that looks like coverage is worse than none

## Phase 6: User Story 4 — A spec's result does not depend on what else is running (P3)

The cause is unknown. These tasks commit to the method, not to a predetermined fix. A retry, a longer
timeout or an added wait are excluded in advance — they remove the symptom and leave the cause.

- [x] T041 *(process)* [US4] Reproduce under the full serial tier — **done, and it does NOT reproduce**. 463 passed, 0 failed, 26.6 min, retries off; `preferences-reset.e2e.ts:77` passed in 2.6 s. Recorded as R6a in `research.md`, together with the ruled-out explanation that spec 031's tiering fixed it (it did not — the spec was already serial as of 2c55596, spec 028)
- [x] T041a *(process)* [US4] Reproduce under a **real** full run — parallel tier at 6 workers, then serial at 1, in that order. T041 ran the serial tier alone and so excluded everything the parallel tier leaves behind: machine load, lingering handles, temp pressure, orphaned processes. #250 says "during a full suite run", and a full run is both tiers
- [x] T041b *(process)* [US4] **If T041a is also clean**, report "cannot reproduce" on #250 with all three counts and the exact conditions tried, and propose closing it as such. Never as "fixed" — nothing was changed, and two specs merged since it was filed (S030, S031) touched these paths, so the perturbation may simply be gone. Say what was measured, not what it means
- [x] T042 *(withdrawn)* [US4] ~~Bisect the co-scheduled set~~ — **there is nothing to bisect.** T041/T041a
  measured `preferences-reset.e2e.ts:77` passing in all three conditions, including a real full run
  (parallel@6 → serial@1). A bisect looks for the spec that perturbs a failing one; nothing fails.
- [x] T043 *(withdrawn)* [US4] ~~Fix at the identified cause~~ — no cause was identified because no
  failure was observed. Fixing something here would mean changing code on a hypothesis, which is
  what the constitution forbids and what this phase's own preamble refuses in advance.
- [x] T044 *(withdrawn)* [US4] ~~Re-stress 20 in isolation and 20 under group scheduling~~ —
  superseded. SC-003 measures the stability of a fix, and there is no fix; re-stressing a spec that
  already passes in every condition would spend 40 full-tier runs to re-observe T041a's result.

  **What the investigation DID find is filed as [#267](https://github.com/Bidthedog/throng/issues/267).**
  `editor-missing-aggregate.e2e.ts:155` passed in the serial tier alone and failed in the same
  serial tier immediately after the parallel tier — same spec, same worker count, same machine, only
  the preceding work differing. That is #250's signature, attached to evidence, in a different spec
  with a different cause. Folding it into #250 would have attached real evidence to the wrong
  subject.

## Phase 8: The JSON editor's edit lifecycle (added 2026-08-15)

Added by `speckit-iterate` after hand-testing, and delivered in the same run. FR-017 through FR-019a.

**Why it is a phase and not a patch.** The reported symptom — a conflict banner milliseconds after a
keystroke — was accurate, and the cause was throng writing the file itself: the 300 ms debounce
applied a half-typed value that happened to parse, and 031's bounds guard corrected it and wrote the
correction back. No tuning fixes that, because the premise is wrong.

- [x] T052 Pure validity checking in `packages/core/src/config/settings-validity.ts` — reads
  `SETTINGS_METADATA`, so there is no second list of allowed values to keep in step (FR-019)
- [x] T053 [P] Unit tests in `packages/core/tests/unit/settings-validity.test.ts` — every option
  listed, every range stated, and **absence is not a problem** (reporting it would lock the user
  inside an editor they cannot leave, over a document that works perfectly)
- [x] T054 The edit gate in `packages/ui/src/renderer/preferences/json-edit-gate.tsx` — the one place
  the shell and the JSON tab agree about whether the buffer may be left
- [x] T055 Rework `json-tab.tsx`: no debounce, apply on leaving, live validity notice (FR-017/FR-019)
- [x] T056 Wire all three exits through the gate in `preferences-app.tsx` — tab switch, mode toggle,
  window close. A rule enforced at two of three is a rule the user learns to distrust
- [x] T057 The close gate in `packages/ui/src/main/preferences-window.ts`, in MAIN rather than on the
  close button, because Alt+F4, the taskbar and every teardown path reach `win.close()` without
  passing through React. **Fails open** after 1.5 s: an unclosable window is a worse defect than the
  one FR-018 fixes
- [x] T058 The *Discard changes and close* escape (FR-018a), rendered rather than notified — a notice
  in this application cannot carry a button, and the escape has to be pressable
- [x] T059 **The FOURTH exit.** FR-017 names three apply triggers; closing the whole APPLICATION with
  Preferences open is a fourth that none of them cover. `registerPendingCommit` lets the shutdown
  drain commit the buffer. Without it this would have been a *regression* — the old debounce at least
  left an armed timer for the drain to fire
- [x] T060 Rework the E2E lifecycle coverage in `preferences-json.e2e.ts`. Two FR-041 conflict tests
  are withdrawn: the conflict they described was throng arguing with itself, and it is gone with the
  write that caused it. Four new tests cover FR-017/FR-018/FR-018a/FR-019
- [x] T061 Update `terminate-all-drain.e2e.ts`'s C19. Its mtime discriminator existed because BOTH
  worlds eventually wrote the file; with no timer left, the presence of the bytes IS the
  discriminator. Delete the drain and it now fails on every machine rather than only a fast one
- [x] T062 Update `config-write-failure.e2e.ts:99` — it drove the debounced path, which no longer
  exists. The write it produces is identical and its result is still dropped, so #102 is as reachable
  as it ever was

## Phase 7: Polish & cross-cutting

- [x] T045 [P] Update `docs/testing.md` with the shared config-write helper and the rule that no spec writes a running app's config root directly
- [x] T046 *(process)* Assess `README.md`, `docs/` and `CONTRIBUTING.md` against the docs-currency gate and record the verdict — **done**, recorded as R8 in `research.md`. Two files need changes (`docs/testing.md` via T045, and `docs/quick-start.md` via T046a); README, CONTRIBUTING, installation and releasing do not
- [x] T046a Update `docs/quick-start.md:281-292` — it describes hand-editing a config file and an out-of-range value being corrected and written back, but is silent on a file that cannot be **parsed**. That case changes here: today it silently loads the shipped defaults and stays there; afterwards it is retried and a persistently unreadable file surfaces. The difference between "your settings were corrected" and "your settings were replaced" is worth a sentence in the paragraph people read before hand-editing
- [x] T047 Replace the grep check with a real assertion in `packages/ui/tests/unit/config-write-helper-single.test.ts` — no E2E spec may call `writeFileSync` on a config root inside a `runApp`/`openApp` callback, and the helper has exactly one implementation (SC-007). A grep for `writeFileSync` matches 119 files and measures nothing
- [x] T048 *(process)* Decide the deferred cross-window write broadcast: R3 adopted it as a "secondary improvement" for freshness and no task implements it. Either implement it or file an issue and record it as an explicit deferral under the Incremental Delivery rule
- [x] T049 *(process)* Run `npm run gate` and record the full stage summary in the PR (SC-006) —
  **six of seven stages green, and every test in the repository passes.** The gate's own E2E stage
  does not, and the reason is measured rather than asserted:

  | Stage / tier | Result |
  |---|---|
  | lint · typecheck · build | ok |
  | unit | 2270 passed |
  | integration | 468 passed |
  | contract | 90 passed |
  | E2E serial tier, 1 worker | **472 passed**, 0 failed, 0 flaky |
  | E2E parallel tier, 3 workers | **295 passed**, 0 failed, 0 flaky |
  | E2E parallel tier, **6 workers** (the gate's default) | fails, with a **moving** set |

  Two consecutive 6-worker runs failed on different specs — run 1 `terminal-revert` plus five
  `terminal-*` flakes, run 2 `projects` and `terminal-altscreen-fidelity` plus four interrupted — and
  every one passes in isolation at one worker. A defect fails the same test every time. The same
  tier at three workers is clean, which is [#251](https://github.com/Bidthedog/throng/issues/251)'s
  stated hypothesis ("including on master") tested directly; the 3-worker figure is posted there as
  new evidence.

  **SC-006 is therefore not met as literally worded, and is not claimed.** Every test passes; the
  command does not. Lowering the local runner's default worker count would close it, and that is
  #251's decision rather than this branch's.
- [x] T049a *(process)* **The serial tier found five regressions, all mine** — recorded here because
  the task list is where the next reader looks. Whole-document normalisation wrongly removed
  (contradicting 007 FR-023 / #95), the same over-correction in both reset paths, the JSON editor no
  longer refreshing after a reset (015 FR-013b), `alwaysOnTop` conflicting with 007 FR-013's
  assertion, and one that was not a regression at all — `preferences-reset` failed only because I
  re-ran serial-tier specs at two workers. Fixed in `08bc173`; the eight affected specs then passed
  54/54, and the whole tier 472/472.
- [x] T050 *(process, HUMAN)* Walk the `quickstart.md` manual pass and record zero reverts (SC-002) —
  **done by the developer, who confirmed it directly.** Every step is human-speed: the un-performable
  ~45 ms race was withdrawn, and so was the case describing a sub-workspace window that cannot exist.
  The pass itself was always a person looking at a screen — where the caret sits after a pause,
  whether a window refuses to close, whether a notice reads as an explanation — and no automated
  layer could have stood in for it. Four of the defects it found this round (three redundant
  notices, the missing save-state explanation, and the theme that trapped the user with no way out)
  were invisible to every green suite
- [x] T051 *(process)* Update the PR body and close-links for #249, #260, #253 and #250 — PR #262,
  closing #249, #260, #253, #263, #264, #265, and recommending #250 be closed as cannot-reproduce.
  Follow-ups filed: #266 (intellisense, vNext) and #267 (the scheduling interference the full run
  actually caught)

## Dependencies

```text
Phase 1 (T001)
   │
Phase 2 (T002 → T003, T004 [P]) → T005 GATE — developer confirmation
   │
   ├── Phase 3 US1 (P1) ── the fix
   │      │
   │      T010a → T010b (serialisation) → T010c ── EVERYTHING below depends on this
   │                                        │
   │            ┌───────────────────────────┼───────────────────────┐
   │      T011-T016 (patch path)   T017/T018 (callers)   T020a-e (main-process writers)
   │            └───────────────────────────┴───────────────────────┘
   │                                        │
   │                                  T020, T021, T022
   │
   ├── Phase 4 US2 (P2) ── independent of US1
   └── Phase 5 US3 (P2) ── independent of US1 and US2
   │
Phase 6 US4 (P3) ── AFTER Phase 3, so the cheap "did US1 fix it too?" check comes first
   │
Phase 7 Polish
```

Phase 6 sits after Phase 3, not parallel to Phase 2. An earlier draft's graph branched it off Phase 2
while the prose said "deliberately last" — the graph was wrong. If the perturbing spec turns out to
be one that writes settings, US1's fix may resolve #250 outright, and finding that out costs one run.

## Parallel opportunities

| Wave | Tasks | Why safe |
|---|---|---|
| Repro | T002 → T003, then T004 | T003 registers the file T002 creates, so it is sequential; T004 is a different layer |
| US1 tests | T006, T008, T009, T010a, T020a | Five different test files. T007 and T010 share `config-write-patch.contract.test.ts`, so they are **one** unit of work, not two |
| **Serialisation** | T010a → **T010b** → T010c | Strictly sequential, and everything else in US1 depends on it. T010b is the task the feature rests on |
| US1 callers | T017, T018 | `apply-client.ts` and `projects-panel.tsx` |
| US1 main-process fixes | T020c, T020d | Same file, different methods — sequential in practice; both depend on T010c |
| US2 tests | T023, T024, T024a, T030a | Four different test files |
| US2 conversion | T030 first, **then** T031, T032 | T030 creates the helper the others import — it is **not** `[P]` with them |
| US3 tests | T035, T036, T037 | T035 and T036 share one spec file, so they are one unit; T037 is separate |
| Polish | T045, T047 | Docs versus a new test |

Every task added in rounds two and three — T010a–c, T020a–e, T024a, T030a — appears above and in the
graph below. The previous revision added six tasks and put none of them in either, which is the same
enumeration-versus-category failure this document keeps diagnosing.

## Implementation strategy

**MVP is Phase 2 + Phase 3.** The reproduction proves the defect and US1 fixes it; that alone closes
#249 and #260 and is worth releasing. Phases 4 and 5 make the guarantee enforced rather than merely
true. Phase 6 is the one open investigation and is last on purpose.

## What the analysis pass changed

Recorded so the diff is reviewable rather than mysterious. Three findings were load-bearing:

1. **The fix was scoped to 2 of 7 write sites.** Verified by grep: `keybindings-tab.tsx:117`,
   `themes-tab.tsx:316`, `themes-tab.tsx:441` and `preferences-app.tsx:189` all serialise whole
   documents, and the old audit task was scoped to `createApplyClient`, which has only the two
   callers already handled. Resolved by scoping the feature to the `settings` document with a stated
   reason — only `settings` is written from two different windows — and recording the retained
   writers as design (T020).
2. **The blocking gate had no mechanism and no exit.** Everything waited on a reproduction with no
   stated way to land inside a 45 ms window, and no answer for the likely case that it comes back
   green. Both are now written down (T002, T005).
3. **A dotted path cannot address `keybindings.bindings`**, which is keyed by action ids containing
   dots. Changed to segment arrays before any code was written.

And one that would have caused data loss: an unparseable base was unhandled, so a patch applied to
`{}` would have replaced every setting the user has (T010, FR-006a, G10).

### Round two found three more, one of them the same mistake again

1. **An eighth write site, in the main process.** `shipped-defaults-service.ts:133` (`resetSetting`)
   reads the whole settings document with a `DEFAULT_APP_SETTINGS` fallback and writes it back — the
   exact pattern this feature removes, with a worse failure mode, in the path
   `preferences-reset.e2e.ts` drives. It was missed **twice**, because both audits grepped only
   `packages/ui/src/renderer`. T020 now requires the main process and the daemon to be searched too.
2. **Settings-only scoping did not close FR-001.** The scope was chosen because settings is the one
   document two windows write — and then two whole-document settings writers were waved through as
   "design". FR-001 now carves out the JSON tab explicitly, and FR-001a converts Revert All.
3. **Every task ID cited for traceability was wrong**, five of them naming real tasks that do
   something else. Added to satisfy "a success criterion nothing runs is a wish", they pointed at
   the wrong things. Re-verified after renumbering.

The recurring failure across both rounds is the same: a category-level claim ("seven writers",
"retained by design", "all tasks carry a file path") standing in for a per-item check. Each was
written in good faith and each was wrong in a way only enumeration could catch.

### Round three found the design hole, and the fourth instance of the pattern

1. **Nothing serialises read-modify-write in the main process.** Verified: `config-write-ipc.ts` has
   no chain, queue, mutex or lock, and the only serialisation in the system is `writeChains` in a
   *renderer* module. After this feature there would have been **two** main-process read-modify-write
   paths over different channels, each with an `await` between read and write, interleaving as
   read-A → read-B → write-A → write-B. The fix would have **relocated the defect from the renderer
   into main** rather than removing it, and T009's soak is exactly the test that would have caught it
   — after the work was done. Now FR-002a, contract step 0, G11/G12, and T010a–c.
2. **"Single-window documents" was false**, and it is the fourth instance of the same substitution:
   *window* for *writer*. `shipped-defaults-service.ts` writes keybindings and every theme wholesale,
   and its `resetBinding` is `resetSetting`'s twin — a defaults fallback that replaces every other
   binding when the file is corrupt. The phrase is deleted from every artifact and the scope now
   rests on "no reported defect", which is true.
3. **T020b had no referent.** `OnEntrySnapshot` captures raw serialised documents, not keys, so
   "revert only its captured preference keys" could not be implemented as written. The key set is now
   defined as the descriptor-carrying leaves minus `SETTINGS_INTERNAL_KEYS`, with the added-key case
   decided and the collision against the cut `remove` variant resolved.

Four rounds, four instances of one shape. The lesson is cheap to state and was expensive to learn:
**a claim about a category is not a check.** Every one of these was written in good faith by someone
who believed they had looked.

### A fifth, found by a human reading the quickstart

The reviewer asked what one of the manual test cases meant. It meant nothing: it said to open "a
sub-workspace window showing the same preference" and change a setting in both windows "within a
second". Checked, and both halves were false — `subworkspace-app.tsx:138` passes `showCog={false}`,
so a sub-workspace window has no cog and cannot open Preferences at all, and there is exactly one
Preferences window. The timing half was the same un-performable race that had already been withdrawn
from #249 two paragraphs earlier.

Pulling that thread found dead work: **`subworkspace-app.tsx` issues no configuration write of any
kind.** T040 would have mounted a failure subscriber that can never fire, and T036 would have tested
a scenario that cannot occur. Both withdrawn.

How it got in is the part worth keeping. The round-2 analysis flagged "you are changing a
sub-workspace window with no E2E coverage", which is a correct rule, and the response was to add the
test — **without checking the premise that a sub-workspace writes config**. Acting on a review
finding is not a substitute for verifying it. That is the same failure as the other four, arriving
through a door that felt like diligence.
