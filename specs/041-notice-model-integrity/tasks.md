# Tasks: Notice-Model Integrity

**Feature**: 041 · **Branch**: `feature/S041-I278-I314-I327-I328-notice-consolidation`

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md) · [research.md](./research.md) · [data-model.md](./data-model.md) · [contracts/notice-model.md](./contracts/notice-model.md) · [quickstart.md](./quickstart.md)

---

## Status — 74 of 81, and why the other seven are open

Delivered and green: the casualty widening, #278's suppression, #328's flash and
announcement, #327's refusal path, #314's keyboard route. PR #337 (draft).

The seven that remain are open for three different reasons, and only the last group is
ordinary unfinished work:

**Not reproducible — T015, T016, T020.** #278 declares a *second* defect: a raw
`ENOENT: no such file or directory, realpath '<path>'` rendered as the notice's second
line. It could not be reproduced. `ENOENT` classifies at `cause.ts:102`, so
`files-service.ts`'s `failure()` returns `{ error: causeMessage(cause), cause }` for
anything classified — the message reaching the notice is already the spoken sentence and
the raw text rides in `copyDetail`, which no code path renders. The raw string can only
surface through the *unclassified* branch, and the route there was not found. **Nothing was
changed on a theory**: a fix behind no failing test cannot be verified by anything,
including the green suite that would follow it. These three stay open until someone
supplies the reproduction.

**Deferred by decision — T068.** The manual regression watch in
[quickstart.md](./quickstart.md#7-regression-watch) is the developer's to perform; it is
not automatable and not the implementer's to tick.

**Genuinely outstanding — T062, T062a, T063.** The guard review against FR-029/FR-030, the
labelling of already-true requirements, and FR-030a's sensitivity proof (revert each
guard's fix once, observe *that* guard fail, record the pairing in the PR). T063 is the one
with teeth: a guard nobody has watched go red is an assertion that it would, which is
precisely the assumption Group 5 exists to stop making.

---

## How to read this list

**Tests are mandatory here, not optional.** Constitution V is non-negotiable: every behaviour is
specified by a test that is written first, *run*, and observed to fail for the reason expected, before
any production code is touched. A task list that put implementation before its test would be asking
for a constitutional violation, so the ordering below is Red → Green throughout.

**The layer is chosen by what the assertion needs**, not by where the code lives — the allocation is
in [plan.md](./plan.md#test-layer-allocation). Nearly everything is unit or component; there is
**one** new E2E, for the single fact no cheaper layer can observe (a real shell not seeing a chord).

**`[P]` means genuinely parallel** — different files, nothing unfinished depended on. Check the file
path before running two together.

**Phase 2 is not optional and not deferrable.** The widening it delivers is what makes User Stories 2
and 3 expressible at all; see the sequencing note under it.

---

## Phase 1: Setup

No project initialisation is needed — this feature adds no package, no process and no dependency. The
two tasks here exist because both have bitten this repository before.

- [x] T001 Confirm the workspace builds from a clean emitted state: run `rm packages/core/tsconfig.tsbuildinfo`, `rm -rf packages/core/dist`, then `npm run build`. A stale `packages/core/dist` makes E2E disagree with unit tests about a constant, because vitest resolves `@throng/core` to source while the Electron app loads `dist` — invisible to every cheap rung by construction.
- [x] T002 Record the baseline test counts per project (`unit`, `component`, `integration`, `contract`) in the PR description, so a later count can be compared rather than asserted.

---

## Phase 2: Foundational — the casualty widening

**BLOCKING.** Every task in Phases 4 and 5 depends on this, and the dependency is not stylistic:
[research.md](./research.md) Finding 1 establishes that once FR-013 stops creating a panel, a refused
open has no `panelId`, so `mergeAffected` — which keys on `panelId` alone — cannot de-duplicate it and
FR-007 becomes **unstateable**. Widen first or the later work has nothing to key on.

**Nothing observable changes in this phase.** Every existing test must still pass, unmodified. That is
the phase's own acceptance criterion.

### Tests first

- [x] T003 [P] Write failing unit tests for `casualtyKey` in `packages/core/tests/unit/notice/casualty.test.ts`: the panel wins where there is one **and `reason` is ignored when it does** (FR-007aa); `(subject, reason)` is the identity when there is no panel; two panel-less casualties differing only in `reason` are distinct; a subject containing the separator cannot collide with a different pair. Run them and confirm they fail because the module does not exist.
- [x] T004 [P] Extend `packages/core/tests/unit/notice/affected.test.ts` with failing cases for panel-less rows: merge de-duplicates them by identity, `joinedPanels` reports them as joined, and the existing-array identity return still distinguishes "grew" from "repeat". Confirm the existing panel-row cases still pass untouched.
- [x] T004a [P] Add a failing test to `packages/core/tests/unit/notice/casualty.test.ts` for FR-007a — **one mechanism, both scales**: the same suppression decision holds for a notice that carries a casualty list (a refused open) and one that carries none (a folder removal), keyed on the cause either way. This is the parallel of SC-003a's with-and-without-a-panel pairing, and FR-007a otherwise has only the indirect cover of "the existing suppression suite still passes" — which is the shape FR-019a exists to reject.
- [x] T005 [P] Add a failing unit test in `packages/core/tests/unit/notice/affected.test.ts` for ordering: panel rows keep tab/panel order; panel-less rows form one ungrouped section after every tab group, ordered by `casualtyKey`, and the order is identical when the input array is shuffled (FR-007d).

### Implementation

- [x] T006 Create `packages/core/src/notice/casualty.ts` with `casualtyKey(c)` returning `c.panelId ?? subject + NUL + reason`. Build the NUL with `String.fromCharCode(0)` — never a literal byte in source, which makes git classify the file as binary and hides every later change to it from diff and ripgrep.
- [x] T007 Widen the row in `packages/core/src/notice/affected.ts` to a **union of two forms** (FR-007e): `AffectedPanel` keeps every field it has today and gains optional `subject`, `reason` and `displayPath`; a new `AffectedSubject` requires `subject` and `reason` and has `panelId?: undefined`; `AffectedCasualty` is their union. The union is the enforcement — a panel-less row cannot omit its identity, and a panelled row does not change. **Do not make `subject`/`reason` required on the panelled form**: six call sites construct rows without them, four of which are the tests that prove the old behaviour, and a widening that edits those tests can no longer prove it was preserved.
- [x] T008 Re-key `mergeAffected`, `joinedPanels` and `distinct` in `packages/core/src/notice/affected.ts` on `casualtyKey(p)` instead of `p.panelId`. Preserve the load-bearing "returns the ORIGINAL array when nothing joined" contract verbatim — Phase 4 hangs the flash on it.
- [x] T008a Widen the **emitted** shape in `packages/core/src/notice/affected.ts`: `AffectedRow.panelId` becomes optional and gains `displayPath?`. This is the type the renderer consumes, so widening the input without it leaves panel-less rows with nowhere to land — the gap is easy to miss because `groupAffected`'s signature mentions neither.
- [x] T009 **Leave `groupAffected`'s signature alone** — it keeps returning `readonly AffectedTabGroup[]`, and it keeps returning only the rows that *have* panels. Instead add a sibling `ungroupedAffected(casualties, context): readonly AffectedRow[]` in `packages/core/src/notice/affected.ts`, returning the panel-less rows ordered by `casualtyKey`, with `displayPath` through `formatSubject` so it takes the same per-part truncation and cannot break 030 FR-032's height bound.

  > **A sibling, not a changed return, and Phase 2's own criterion is the reason.** Changing
  > `groupAffected` to `{ groups, ungrouped }` breaks **four** consumers — `affectedDetails` inside
  > `affected.ts:169`, `notice-text.ts:147`, `notification.tsx:295` — and **five** destructuring sites
  > in `affected.test.ts` (lines 42, 56, 70, 86, 100). The implementer would then hit T011's "stop and
  > reconsider rather than editing the test" with no exit. A sibling function is non-breaking, and it
  > is the honest shape anyway: grouping by tab and listing rows that have no tab are two different
  > operations.
  >
  > **Do not** put panel-less rows in a synthetic tab group with a blank label instead — a blank
  > label already means something else (`affected.test.ts:100` asserts a blank-named tab keeps its
  > rows under an empty heading), and reusing it makes two different things indistinguishable.

- [x] T009a Update the renderer in `packages/ui/src/renderer/common/notification.tsx`: call `ungroupedAffected` alongside the existing `groupAffected`, render its rows in one section after every tab group, and key them on `casualtyKey` — a panel-less row has no `panelId` for React to key on. `notice-text.ts:147` and `notification.tsx:295` need the same second call so Copy and the announcement see the panel-less rows too.
- [x] T009b Extend `affectedDetails` in `packages/core/src/notice/affected.ts` to include panel-less casualties' `detail`. It currently projects `groupAffected(...)` only, so a panel-less row's absolute path would silently never reach the diagnostics log — **breaching FR-005a**, whose whole content is that suppression narrows what is shown and never what is logged. This is the quietest way this feature could lose data, precisely because nothing renders the value that goes missing.
- [x] T010 Export `casualtyKey`, `AffectedCasualty` and `AffectedSubject` from `packages/core/src/notice/index.ts`.
- [x] T011 Run `npm run test:unit` and `npm run test:component`. **Every pre-existing notice test must pass unmodified.** A test that needed editing to accommodate the widening means the widening changed behaviour, which this phase forbids — stop and reconsider rather than editing the test. The set that matters most: `packages/core/tests/unit/notice/affected.test.ts`, `packages/ui/tests/unit/notice-suppression.test.ts`, `packages/ui/tests/unit/notice-text.test.ts`, `packages/ui/tests/component/notice-log-emission.test.ts`, `packages/ui/tests/component/notice-pointer-events.test.ts`, and the existing E2E guard `packages/ui/tests/e2e/notice-consolidation.e2e.ts` — the automated proof of 030 US3's one-notice-per-cause rule, which SC-007 ("existing failure-presentation suites pass unchanged") ultimately rests on.

**Checkpoint**: the model can express a panel-less casualty. Nothing uses one yet.

---

## Phase 3: User Story 1 — One cause, one notice (P1, #278)

**Goal**: one `git worktree remove` produces one notice, naming the folder that went, with no raw
system error on screen.

**Independent test**: remove a folder with several expanded descendants; count the notices. One.

### Tests first

- [x] T012 [P] [US1] Write failing unit tests for `isSuppressedByAncestor` in `packages/core/tests/unit/notice/ancestor-suppression.test.ts`: a folder whose ancestor is absent is suppressed; a folder whose parent survives is not; the walk stops at the project root; the project root itself vanishing is not suppressed (FR-002's fallback case). The absence probe is injected as a third argument, so no filesystem is touched. **Parameterise the descendant count over 1, 3 and 5** — the exact measurement points SC-001 names.
- [x] T013 [P] [US1] Write a failing unit test in `packages/core/tests/unit/notice/ancestor-suppression.test.ts` asserting **order independence**: for a removal with four expanded descendants, feed the five events in **every permutation** and assert exactly one survives suppression each time, naming the same folder (FR-003c, SC-006f). Permute — never wait, because a result that needs a delay is the time-grouping FR-003b forbids.
- [x] T013a [P] [US1] Add an assertion to `packages/core/tests/unit/notice/ancestor-suppression.test.ts` for FR-003d: across every permutation, the surviving cause's subject is emitted **once and never revised** — no notice is raised and later amended to name a different folder. Without this, FR-003d exists only as prose inside T019's instructions, which is precisely the untested-requirement shape Group 5 exists to eliminate.
- [x] T014 [P] [US1] Write a failing unit test for the independent-siblings case: three removed folders whose parents all survive yield three unsuppressed causes (FR-003a, SC-006c).
- [ ] T015 [P] [US1] Write a failing component test in `packages/ui/tests/component/notice-raw-error.test.ts` asserting that no notice renders a raw system error string — driven by a casualty carrying an `ENOENT: no such file or directory, realpath '...'` detail, asserting the rendered text contains neither `ENOENT` nor `realpath`, while `noticeToText` (Copy) does contain both (FR-004, FR-005).
- [ ] T016 [P] [US1] **Extend** the existing `packages/ui/tests/unit/notice-log.test.ts` with failing assertions that a suppressed casualty still produces a log record, at the same level as the cause that reported it and not demoted to debug (FR-005a, FR-005b, SC-006a) — one removal defeating five tree nodes gives one notice and five records. Also assert FR-005's **"exactly once each"** half by *counting* occurrences of the raw error in the Copy payload and in the log record, not merely asserting presence.

### Implementation

- [x] T017 [US1] Create `packages/core/src/notice/ancestor-suppression.ts` exporting `isSuppressedByAncestor(removedPath, projectRoot, isAbsent)`, walking up from the removed path and stopping at the project root. Pure — the absence probe is the **third parameter**, never an import, which is what keeps the OS out of core (Constitution II), lets the composition root supply it (Constitution IX), and makes T013's permutation sweep affordable without building a directory tree.
- [x] T018 [US1] Export `isSuppressedByAncestor` from `packages/core/src/notice/index.ts`.
- [x] T019 [US1] Apply the new ancestor check at the explorer's raise site in `packages/ui/src/renderer/explorer/use-explorer-data.ts`: a removal whose ancestor is also absent reports to the log but raises no notice. Decide per event; do not buffer, and do not raise a notice and later amend its subject (FR-003c, FR-003d).

  > **Two different things are now called "suppression", and they compose rather than compete.**
  > `packages/ui/src/renderer/common/notice-suppression.ts` already exists and implements 029 FR-019
  > by **cause-key equality** against the live notices — it is what research Finding 3 is entirely
  > about, and it is why five vanished folders currently produce five notices (five subjects, five
  > keys, no match). The new `ancestor-suppression.ts` decides, *before* a key is minted, whether this
  > removal is a cause at all. Leave the existing module alone; it is not the defect and its own
  > suite must keep passing.
- [ ] T020 [US1] Move the raw errno off the notice message and on to the casualty's `detail` in `packages/ui/src/renderer/explorer/use-explorer-data.ts`, so the sentence the user reads is the spoken one and the errno reaches Copy and the log only (FR-004, FR-005 — 029 FR-016/FR-018 restored).
- [x] T021 [US1] Run the US1 tests and confirm green. Then run `npm run test:unit` and `npm run test:component` in full.

**Checkpoint**: #278 is fixed and provable without launching the app.

---

## Phase 4: User Story 2 — One row per casualty, flashed on repeat (P1, #328)

**Goal**: a repeat of a casualty already listed makes the notice louder instead of longer.

**Independent test**: open a refused file three times with the notice up; count the rows. One, and it
pulses on attempts two and three.

**Depends on**: Phase 2 (the identity the flash de-duplicates on).

### Tests first

- [x] T022 [P] [US2] Write failing component tests in `packages/ui/tests/component/notice-flash.test.ts` for the two sites that return silently today: a repeat of a listed casualty (`mergeAffected` returns the original array) and an identical notice raised again. Assert each pulses the card, and that the row count and the notice's content are unchanged (FR-008, FR-008a, FR-008d, FR-009).
- [x] T023 [P] [US2] **Extend** the existing `packages/ui/tests/component/notice-dismissal-timer.test.ts` with a failing test asserting the flash **restarts** the dismissal timer, and that a notice re-triggered five times at half its timeout never expires (FR-008b, SC-005a). Use fake timers — this is exactly the assertion a human cannot make with a stopwatch.
- [x] T024 [US2] Add failing component tests to `packages/ui/tests/component/notice-flash.test.ts` for the display modes: **Dismiss only** pulses and has no timer to restart; **Never display** is neither raised nor pulsed, but still reaches the log (FR-008c).
- [x] T025 [US2] Add a failing component test to `packages/ui/tests/component/notice-flash.test.ts` asserting **absorption**: repeats arriving while a pulse is in flight restart the timer but queue no second pulse (FR-008e).
- [x] T026 [P] [US2] Write failing component tests in `packages/ui/tests/component/notice-announce.test.ts`: a pure repeat is announced politely, naming the recurring subject; the announcement does **not** contain the casualty list; and **utterances equal pulses** — ten rapid repeats give one of each, ten spaced repeats give ten of each (FR-011a, FR-011b, FR-011c, SC-006d, SC-006e).
- [x] T027 [US2] Add a failing component test to `packages/ui/tests/component/notice-flash.test.ts` asserting the flash moves nothing (FR-010), using only what jsdom can actually observe: `scrollTop` on the list container is unchanged, `document.activeElement` is unchanged, and the rendered row sequence is identical before and after. **Do not assert rendered geometry** — jsdom applies no stylesheet and performs no layout, so a test that appeared to check "the list did not move" visually would pass vacuously.
- [x] T028 [P] [US2] **Extend** the existing `packages/core/tests/unit/notice/affected.test.ts` with a failing test for SC-003/SC-003a: ten repeats of one casualty yield one row, measured **both** with a panel and without one, so one key is shown to serve both.
- [x] T028a [P] [US2] Add the negative case at the layer that actually owns it. Two assertions, deliberately split:

  - in `packages/core/tests/unit/notice/casualty.test.ts` — two **panel-less** casualties sharing a subject but differing in `reason` are distinct, and two **panelled** rows sharing a `panelId` are the same casualty *whatever their reasons say* (FR-007aa);
  - in `packages/ui/tests/component/notice-flash.test.ts` — the same panel defeated by a **different cause** raises a second **notice**, which is `groupKey`'s doing, not the row key's (FR-006, US2 scenario 4).

  > An earlier version of this task asserted that a different `reason` on the same panel produced a
  > second **row**. It could never have passed: the key makes the panel supersede the pair, and US2
  > scenario 4 says *notice*, not row. The mistake was reading "the subject and the reason, plus the
  > panel" as a triple.
- [x] T029 [P] [US2] **Extend** the existing `packages/ui/tests/component/notice-subject-rendering.test.ts` with a failing test asserting a row renders the subject's path **relative to the project root**, that the absolute path appears in Copy and the log but not on screen, and that a subject outside the project root still renders inside the height bound with a >100-character path (FR-018, FR-018a, FR-018c, SC-005b).
- [x] T030 [US2] Add a failing component test to `packages/ui/tests/component/notice-flash.test.ts` asserting suppression is scoped to the **live** notice: once dismissed, the same cause defeating the same casualty raises a fresh notice (FR-012).

### Implementation

- [x] T031 [US2] Add `flash(id)` to the notification provider in `packages/ui/src/renderer/common/notification.tsx`: mark that notice as pulsing (a state with an observable **start and end**, per FR-008aa — rendered as an attribute or class, cleared when the pulse finishes) and restart that id's entry in `timers.current`. Exactly those two effects and no others.
- [x] T032 [US2] Replace the silent `if (merged === existing) return` with `flash(target.id)` in `packages/ui/src/renderer/common/notification.tsx`.
- [x] T033 [US2] Replace the silent `if (duplicate) return` in `packages/ui/src/renderer/common/notification.tsx`. The current expression is a `.some(...)` predicate; change it to `.find(...)` so the matching notice is in hand, and flash **that** notice's id. Flashing the most recent live notice instead would pulse the wrong card whenever two notices are up.
- [x] T034 [US2] Implement absorption in `packages/ui/src/renderer/common/notification.tsx`: track the pulse's in-flight state per notice id; a repeat during a running pulse restarts the timer without queueing a second pulse (FR-008e).
- [x] T035 [US2] Add the pure-repeat announcement beside the existing `announceGrowth` in `packages/ui/src/renderer/common/notification.tsx`, emitted **once per pulse**, polite, naming the subject and never the list (FR-011a–c).
- [x] T036 [US2] Create `packages/ui/src/renderer/common/notification.css` — **it does not exist today**; notice styling currently lives in `packages/ui/src/renderer/theme.css`, and the directory's precedent for a component-scoped sheet is `loading.css` and `panel-failure-banner.css`. Add the pulse animation there, keyed off the state T031 sets and cleared on animation end. Animate only compositor-safe properties (opacity, `box-shadow`, `transform` on the card) so the pulse reflows nothing — a pulse that changed a layout box would move the list and break FR-010. **The styling itself is not asserted**; T027 asserts the properties jsdom can see, and the visual choice is a design decision like every other stylesheet rule.
- [x] T037 [US2] Populate `displayPath` on casualties raised for a refused open, relative to the project root the notice already names, in `packages/ui/src/renderer/editor/editor-missing-notice.ts`. The path arrives as its **own rendered field**, never by promoting `detail` into the DOM (FR-018b as corrected). **Leave `missingFileDetail`'s comment exactly as it is** — it says the detail is copied and logged and never rendered, and that is true both before and after this change.
- [x] T038 [US2] Run the US2 tests, then `npm run test:unit` and `npm run test:component` in full.

**Checkpoint**: #328 is fixed. A repeat is louder, not longer, and audibly so.

---

## Phase 5: User Story 3 — A refusal is not a document (P2, #327)

**Goal**: opening a refused file creates no panel and raises a notification, whatever else is open.

**Independent test**: with an empty workspace, open a refused file. Zero panels, one notification.
Repeat with a panel already open; identical.

**Depends on**: Phase 2 (a refusal has no panel, so it needs the panel-less casualty).

> **Highest-risk phase in the feature.** `useReportPanelFailure` opens with `if (!place) return`.
> Leave that on the refusal path and "no panel is created" silently becomes "no panel **and no
> notification**" — worse than the bug being fixed. T041 exists to make that failure impossible to
> ship unnoticed.

### Tests first

- [x] T039 [P] [US3] Write a failing integration test in `packages/ui/tests/integration/editor-refusal-no-panel.integration.test.ts` asserting `openInto` returns `{ action: 'refuse', reason }` for binary, too-large, out-of-tree and a folder — and **`{ action: 'open' }` for a missing file** (FR-015). The missing-file branch is the one that destroys 018's recovery path if inverted, so assert it explicitly rather than leaving it to the absence of a refusal.
- [x] T040 [P] [US3] Extend `packages/ui/tests/component/editor-open-routing.test.ts` with a failing test asserting a refused open creates **zero** panels, with 0, 1 and 3 editor panels already open — the same count each time, so the outcome no longer varies with workspace state (FR-013, SC-004).
- [x] T041 [P] [US3] Extend `packages/ui/tests/component/editor-open-routing.test.ts` with a failing test asserting a refused open with **no panel anywhere** still raises a notification naming the reason (FR-014). This is the guard against the silent-drop failure above; write it before T045 so the drop is observed rather than reasoned about.
- [x] T042 [P] [US3] Extend `packages/ui/tests/component/editor-open-routing.test.ts` covering **every panel-creating entry point** (FR-013a, FR-013d, SC-006b). Four cases, not five — `openTarget: 'new'` and Quick Open are the **same code path** (`quick-open.tsx` routes through `openFileInTab` with that target):

  1. `openFileInTab` from Files & Folders (default `lastActive`);
  2. `openFileInTab` with `openTarget: 'new'` — which Quick Open also exercises;
  3. `openFileInNewEditor` called **directly**, as `file-tree.tsx:417` calls it — the one ungated caller (FR-013d);
  4. a drop onto empty space, via `openFileInPanel`'s creation fallback.

  Same outcome — zero panels, one notification — from each.
- [x] T043 [P] [US3] Extend `packages/ui/tests/component/editor-open-routing.test.ts` for the two things that must **not** change: a drop onto an **existing** panel keeps its current refusal handling (FR-013b, FR-016), and workspace restore still creates panels (FR-017).

  > **T040–T043 are component tests, not integration tests.** The assertion is a panel count in the
  > workspace store — it does not cross a process boundary, and `editor-open-routing.test.ts` already
  > stubs `window.throng.editor.openInto` and asserts panel *absence*; its own header records that it
  > exists so these claims can be made without launching Electron. Constitution V requires the lowest
  > layer that can prove it, and an integration test here would buy a slower run and nothing else.
  > **T039 stays at integration** — it asserts what main's `openInto` returns, which genuinely does
  > cross the boundary.

### Implementation

- [x] T043a [US3] Move `NOT_A_MISSING_FILE` and `isMissingReason` from `packages/ui/src/renderer/editor/editor-missing-notice.ts` to `packages/core/src/editor/refusal.ts`, **re-exporting them from their current home** so no existing caller or test changes. Main cannot import a renderer module, and the enumeration of what counts as a refusal is a pure domain decision with consumers in two processes — Constitution II's test exactly. **This must land before T044.**
- [x] T044 [US3] Add `{ action: 'refuse'; reason }` as a third variant of `OpenDecision` in `packages/core/src/editor/open-registry.ts`, and have `openInto` in `packages/ui/src/main/editor-coordinator.ts` return it — consulting the moved `NOT_A_MISSING_FILE` rather than restating the set. `openOrFocus` stays pure; the `stat` is main's. A **missing** file returns `open`. No new IPC method: every caller already awaits `openInto`, so the refusal costs no round-trip and an unhandled case fails to compile.
- [x] T045 [US3] Add a panel-less report path in `packages/ui/src/renderer/workspace/panel-failure-notice.ts`. Keep `if (!place) return` for a panel destroyed mid-flight — it is correct and 030 FR-027 depends on it — and route a refusal that never had a panel past it, carrying `subject`, `reason` and `displayPath`.
- [x] T046 [US3] Handle the new `refuse` action at every `openInto` call site in `packages/ui/src/renderer/editor/editor-open.tsx` — `openFileInTab` and `openFileInPanel` — returning without creating a panel and routing the reason to the panel-less report. The existing `focus`/`open` branches are unchanged, and the compiler names any site that has not been updated.
- [x] T046a [US3] Gate the explorer's *Open In → New Editor* at its **call site** — `packages/ui/src/renderer/explorer/file-tree.tsx:417` — mirroring the caller-side fix `quick-open.tsx` made for the same shape of bug (FR-013d). **Leave `openFileInNewEditor` synchronous and ungated.**

  > **033 decided this and left its reasoning in the source.** `quick-open.tsx:151` states the gate
  > belongs in the caller "rather than inside `openFileInNewEditor` deliberately. That function means
  > *force a new panel*; making it silently not force would change a shipped contract under a caller
  > that has already done the check, and would turn a synchronous call into an asynchronous one for
  > both." Both reasons still hold.
  >
  > **And the gap is one call site, not three.** `openFileInTab` awaits `openInto` on its first line,
  > *before* the `openTarget === 'new'` branch — the same comment says so — so that path and Quick
  > Open are already covered by T046. An earlier draft of this task would have changed a shipped
  > contract to fix a defect that was not there, which is precisely what CLAUDE.md's
  > *find-the-requirement-that-already-governs-it* rule exists to catch.
- [x] T047 [US3] Route a refusal that created no panel to the panel-less report in `packages/ui/src/renderer/editor/use-editor.ts`'s `maybeWarn`, leaving the existing already-open-panel path untouched (FR-016).
- [x] T047a [P] [US3] Write a component test in `packages/ui/tests/component/panel-failure-banner.test.ts` asserting a panel failure banner prints its path **exactly once** — for **both** panel types, driven through `useEditorFailure`'s copy shape and `terminal-panel.tsx`'s (FR-019, FR-019a). Count occurrences of the path string in the rendered text; assert 1.

  > **This is a guard, not a fix.** FR-019 is already honoured: both headlines are path-free
  > (`'This file could not be read'`, `'This terminal could not be opened'`) and `detail.path` renders
  > once. Nothing needs implementing — which is exactly why it needs asserting. A requirement that is
  > true with nothing watching it is the shape all three of this feature's restored requirements had
  > immediately before they stopped being true.

- [x] T047b [P] [US3] Assert the two refusal paths against **each other** (FR-013c) in `packages/ui/tests/component/editor-open-routing.test.ts`: for the same file and the same reason, a drop that would create a panel and an open from the tree produce the identical observable outcome — zero panels, one notification, same wording. FR-013c's whole content is that the two paths agree; testing each alone never checks that.
- [x] T048 [US3] Run the US3 tests, then `npm run test:component` and `npm run test:integration` in full.

**Checkpoint**: #327 is fixed, its fix has not silenced the report, and FR-019 is now guarded.

---

## Phase 6: User Story 4 — A keyboard route to a notice (P3, #314)

**Goal**: `Ctrl+Alt+M` reaches the most recent notice from anywhere, and Escape puts focus back.

**Independent test**: raise a notice, press the chord, scroll the list, press Escape.

**Depends on**: nothing. Last because it is the only item adding a capability rather than restoring one.

### Tests first

- [x] T049 [P] [US4] Write a failing unit test in `packages/core/tests/unit/keybindings-focus-notice.test.ts` asserting `focus.notice` is registered, scoped `EVERYWHERE`, defaulted to `Ctrl+Alt+M`, present in `keybindings-metadata.ts`, and **absent from the `focus.cycle` ring** (FR-020a–c, FR-027). It goes in `packages/core` because that is where `keybindings.ts` and `keybindings-metadata.ts` live.
- [x] T050 [P] [US4] Write failing component tests in `packages/ui/tests/component/notice-focus.test.ts`: the command focuses the most recent notice; **pressing it twice keeps focus on the same notice** across three live notices; a notice arriving while one is focused does not steal focus (FR-020, FR-020d, FR-020e).
- [x] T051 [P] [US4] Write failing component tests for focus return: Escape lands on the element focused before the chord; it still does so after the user has tabbed on to a second notice; and it lands on a real focusable surface, never the document body, when the origin has been destroyed (FR-022, FR-022a, FR-022b).
- [x] T052 [P] [US4] Write failing component tests for the remaining rules: the list scrolls by keyboard; Tab leaves the notice and is never trapped; a dismissal or timeout while focused returns focus where it came from; and pressing the chord with no notice on screen does nothing and raises **no** notice saying so (FR-021, FR-023, FR-024, FR-026).
- [x] T053 [P] [US4] Write a failing component test asserting a notice carrying a focusable list carries its focusable affordance **in the markup, before focus arrives** — the element or attribute FR-025a requires — and that a notice with no list does not (FR-025, FR-025a). Assert the markup, never computed style: jsdom applies no stylesheet, so a style-based assertion would pass vacuously and prove nothing.
- [x] T054 [P] [US4] Add **one** failing test to the existing `packages/ui/tests/e2e/window-chord-resolution.e2e.ts`, in the family it belongs to: *"the notice chord still resolves over a focused terminal — `Ctrl+Alt+M`"*. Tag it `['@extended', '@window', '@reserve:input']`. It asserts one thing: with a real shell focused, the chord reaches the application and the shell receives nothing.

  > **`@extended`, not `@core`** — and the two tags come from two different precedents, which is worth
  > separating because conflating them is what got this wrong the first time. `@reserve:input` comes
  > from the neighbouring *"the tab picker still resolves — `Ctrl+Alt+T`"*, the same `Ctrl+Alt` family:
  > the claim is about where a chord is **routed**, not terminal rendering fidelity. The
  > **significance** tag is a separate decision, and that neighbour is `@extended` too. `@core` is
  > capped at 50, sits at 38, and gates every push; chord routing does not change per-commit, so it is
  > a release-lane fact. Everything about `focus.notice` that *could* regress on a push is already
  > covered at component layer.

  > **It joins a file rather than starting one, and that decision removes three problems at once.**
  > That file already holds this exact family — *"the tab picker still resolves — `Ctrl+Alt+T`"*, an
  > `EVERYWHERE` chord in the same `Ctrl+Alt` group, tagged `@reserve:input` — so the precedent picks
  > the reserve entry: this is **real keyboard and input dispatch**, not ConPTY rendering fidelity.
  > A new spec file would instead have needed a `parallel-plan.json` serial entry with a mechanism
  > from a closed set, against an `UNATTRIBUTED` ceiling asserted by equality at 14. Joining an
  > existing serial file inherits its placement and needs none of that.
  >
  > **One assertion.** That focus *arrives* is T050's component test; folding it in would make the
  > test appear to need two reserve entries, which `e2e-tags.test.ts` fails outright (035 FR-016b).

### Implementation

- [x] T055 [US4] Register `focus.notice` in `packages/core/src/config/keybindings.ts`: add it to the command union, `COMMAND_SCOPES` as `EVERYWHERE`, and the default chords as `['Ctrl+Alt+M']`.
- [x] T056 [US4] Add its Preferences entry to `packages/core/src/config/keybindings-metadata.ts` under **Focus & Zoom**, beside the rest of the `focus.*` family. **No menu item** — the family is navigational keyboard input and Constitution VI exempts it; see [research.md](./research.md) Finding 4.
- [x] T057 [US4] Implement the command handler in `packages/ui/src/renderer/common/notification.tsx`: focus the most recent live notice, idempotently, capturing the previously-focused element as the Escape origin at the moment the chord is pressed and not re-capturing it on Tab.
- [x] T058 [US4] Implement focus return in `packages/ui/src/renderer/common/notification.tsx` for all three exits — Escape, dismissal while focused, timeout while focused — with a real focusable fallback when the origin has gone.
- [x] T059 [US4] Render the affordance's markup hook in `packages/ui/src/renderer/common/notification.tsx` (the element or attribute T053 asserts), and style it in `packages/ui/src/renderer/common/notification.css` so it is visible before focus arrives. Markup is the contract; the styling is a design choice and is not asserted.
- [x] T060 [US4] **No `parallel-plan.json` change.** T054 joins a file that already has its tier placement, so nothing is added to the `serial` map — and nothing needs a mechanism string from the closed `FOCUS`/`CPU`/`TIMING`/`UNATTRIBUTED` set, whose `UNATTRIBUTED` count is asserted by **equality** at 14 and would redden the build if raised. Confirm `window-chord-resolution.e2e.ts`'s existing entry is unchanged and move on.
- [x] T060a [US4] Re-seed `packages/ui/tests/e2e/e2e-budget.json` in the **same commit** as T054: `total` 558 → 559 and `byCategory["@window"]` 191 → 192. **`core` stays at 38** — the test is `@extended`. The category is `@window`, from the file and tag it carries, **not** `@failure`. Include the one-sentence justification the budget's own note demands — what this test asserts that no unit, component or integration test can. The ratchet fails both over and under budget, so an unseeded addition and an unclaimed removal are equally red.
- [x] T061 [US4] Run the US4 tests: `npm run test:unit`, `npm run test:component`, then the single new E2E spec narrowly at one worker.

**Checkpoint**: #314 is delivered.

---

## Phase 7: Group 5 — the guards, and keeping it true

Three shipped requirements stopped being honoured with nothing failing. These tasks are what stop that
happening again, and FR-029 is the part that matters: a guard asserts the **observable outcome**, not
the shape of the code that currently produces it.

- [ ] T062 Review every test added in Phases 3–6 against **FR-029 and FR-030**. FR-029: each must assert a notice count, a row count, a panel count or the absence of raw error text — never the presence of a particular function or module; rewrite any that would pass a refactor while the requirement was broken. FR-030: re-check each test's **layer** against what its assertion actually needs, because the layer decisions were made in the plan and nothing else revisits them at the end. Two specific traps this feature already fell into once each — an assertion parked at integration that crosses no boundary, and a visual claim parked at component where jsdom applies no stylesheet.

- [ ] T062a **Label the requirements that are already true**, so nobody goes looking for code that should not be written. Four have a test task and deliberately no implementation task: FR-008c (*Dismiss only* / *Never display* already behave correctly), FR-012 (suppression is already bounded by the live list), FR-017 (restore is already not an open-a-file action) and FR-021 (the list already carries `tabIndex={0}`). Add the one-line "guard, not a fix" note FR-019a sets the pattern for. An unlabelled already-true requirement reads as a missing implementation, and the reader's options are to write code that is not needed or to assume the task list is wrong.
- [ ] T063 Prove each guard's sensitivity **once**: revert that guard's fix, run the guard, observe it fail, restore the fix. Record the pairing (guard → the failure observed) in the PR description (FR-030a, SC-006). A guard nobody has seen go red is an assertion that it would.
- [x] T064 Confirm no mutation harness, gate stage or paired negative test has been added (FR-030b). What must hold continuously is that a future regression fails something, which the guard itself delivers.

---

## Phase 8: Polish & cross-cutting

- [x] T065 [P] Update `docs/testing.md` if the E2E counts or tiers moved.
- [x] T065a [P] Add `Ctrl+Alt+M` to the keyboard-shortcut table in `docs/quick-start.md` (around lines 443–449), beside the `focus.*` family already listed there — `Ctrl+Alt+B`/`N`/`T`, `Ctrl+``, `Ctrl+Alt+Arrow`. Check the README's shipped-state description for the same gap.

  > An earlier version of T065 said this feature "adds no user-facing surface that the manual
  > documents". That was wrong: a new default chord is exactly what that table is for, and the
  > constitution's documentation-currency rule is non-negotiable. A shortcut nobody can discover is
  > the same defect #314 reports, one layer out.
- [x] T066 [P] Re-read every comment touched in this feature against what the code now does. `missingFileDetail`'s stays as it is (Finding 2). `affected.ts`'s doc comment needs updating to describe a **casualty** rather than a panel — and to record that the panel-named symbols (`mergeAffected`, `joinedPanels`, `affectedDetails`) keep their names deliberately, so the next reader meets the decision rather than inferring drift (see [data-model.md](./data-model.md#identity)).
- [x] T067 Run `npm run gate` — eight stages in CI's order, fail-fast. Quote the actual stage summary when reporting done; a green gate goes stale the moment anything is edited after it.
- [ ] T068 Verify the regression watch in [quickstart.md](./quickstart.md#7-regression-watch) by hand: a project-root rename still gives one notice listing editors and terminals; two unrelated failures still stack; an already-open panel's banner is unchanged; a banner prints its path once.

---

## Dependencies

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundational — the widening)   ←── BLOCKING for US2 and US3
    ↓
    ├──→ Phase 3 (US1 · #278)   — independent of the others
    ├──→ Phase 4 (US2 · #328)   — needs the identity from Phase 2
    └──→ Phase 5 (US3 · #327)   — needs the panel-less casualty from Phase 2
                ↓
         Phase 6 (US4 · #314)   — depends on nothing; last by priority
                ↓
         Phase 7 (guards) → Phase 8 (polish)
```

**US1 does not depend on Phase 2** and could run beside it. US2 and US3 both do, and for the same
reason — [research.md](./research.md) Finding 1.

---

## Parallel opportunities

| Phase | Runs together | Sequential, and why |
|---|---|---|
| 2 | T003 alone | T004, T005 share `affected.test.ts` |
| 3 | T012, T015, T016 | T012 → T013 → T013a all share `ancestor-suppression.test.ts` |
| 4 | T022, T023, T026, T028, T029 | **T024, T025, T027, T030 share `notice-flash.test.ts` with T022** — that is why they lost their `[P]`. T028a touches two files, one of them `casualty.test.ts`. T031–T036 are all `notification.tsx` |
| 5 | T039, T047a, T047b | T040–T043 all extend `editor-open-routing.test.ts`. **T043a before T044** (move the enum, then consume it). **T046a before T046's callers settle** |
| 6 | T049, T050, T053, T054 | T051, T052 share `notice-focus.test.ts` with T050. T057, T058 are both `notification.tsx`. **T054 and T060a are one commit** — the test and its re-seeded budget |
| 8 | T065, T065a, T066 | — |

**The rule this table encodes**: `[P]` means a *different file*, not a different subject. Four tasks
lost their marker on this pass because they were parallel by topic and sequential by file — which is
the failure mode the marker exists to prevent, since two agents editing one file is the thing it is
supposed to make impossible.

**The recurring hazard is `notification.tsx`** — T031–T036 and T057–T058 all edit it, so they are
sequential despite belonging to different stories.

**And one machine-level rule**: at most **one** test, lint, typecheck or build command runs on this
machine at a time, whoever is running it. Parallel *authoring* is fine; parallel *running* contends,
slows both, and manufactures flakes that then cost a stress test to disprove.

---

## Implementation strategy

**MVP is Phase 2 + Phase 3** — the widening plus #278. That is the most visible breach, the one a user
hits by doing something completely ordinary, and it is independently shippable.

Then Phase 4 (#328) and Phase 5 (#327), in that order rather than by issue number: they share a root
cause, and #328's fix is what makes #327's panel-less report have somewhere to go.

Then Phase 6 (#314), which adds the only new capability, and Phases 7–8 to make it stick.

**Every phase ends green.** Not "the tests I changed pass" — `npm run gate` is the only thing that
establishes done-ness, and it is run once at the end of the work rather than between every edit.
