# Feature Specification: E2E Layer Migration

**Feature Branch**: `feature/S035-e2e-layer-migration`

**Created**: 2026-08-18

**Status**: Draft

**Input**: An exhaustive per-test classification of all 229 E2E spec files (687 tagged tests, 1165
`test(` declarations) carried out by five parallel assessors, each given the constitution's E2E
reserve verbatim and required to return one verdict per test with evidence by `file:line`. The
consolidated evidence, the measurements taken to settle the central question, and the list of items
that could NOT be settled are the input to this spec.

---

## Why this spec exists

Spec 034 cut the E2E suite's wall-clock from 46.9 to 21.2 minutes — a 55% reduction — but moved the
test count only 791 → 689. It worked on **launches and clocks**, not on **layers**. Of 229 files, 39
were ever examined for whether their tests belonged lower.

This spec is the layer pass 034 did not do. It is not a general tidy-up: it is the conclusion of a
census in which **every** test in the suite was read and verdicted, and it inherits that census's
two uncomfortable findings.

**Finding 1 — the ceiling is about 480, not 200.** Five assessors, working independently on balanced
thirds of the suite, each returned the same split: **~70% of E2E tests genuinely cannot move**, and
~30% can. That is ~200 tests, landing the suite near 480–500. The 100–200 that was hoped for is not
reachable by migration alone, and a spec that promised it would be promising something the evidence
does not support.

**Finding 2 — the reason for the 70% is a layer that does not exist.** Three of the five assessors
independently proposed the same new reserve entry, in different words: *"real end-to-end wiring
through the app's own backend"*, *"cross-process persistence and hot-reload"*, *"wiring witness"*.
It was the single largest KEEP-E2E bucket in the whole census. It does not survive measurement:

| span of the wiring | layer that owns it | state today |
|---|---|---|
| renderer action → bridge call | component, against a fake bridge | pattern established |
| channel agrees across preload ↔ main | **static source guard** | **does not exist** |
| main handler → real effect (disk, SQLite, OS) | **contract** | **1 of 98 channels** |

**That "1" is measured, and it corrects a figure this spec previously carried.** The repository has
**20** contract test files. Twelve of them live in `core` and `platform-windows` and cover platform
*abstractions* — a pipe endpoint, a PTY host, elevation, a directory lock — not IPC channels. Of the
seven under `packages/ui/tests/contract`, five import a `src/main` module, two
(`themes-ipc`, `file-index-ipc`) are source-scanning guards that read files and assert on their text
rather than driving anything, and exactly **one** — `config-write-patch.contract.test.ts` — imports a
registered handler and drives it against real state on disk.

So the destination layer is not 7% built. It is built **once**, as a worked example, and that example
is the pattern everything in Phase B follows.

`config-write-patch.contract.test.ts` imports the **real** main-process handler and drives it against
a real config store in real temporary directories. So *main → real effect* is provable below E2E
**today**, for any channel someone writes the test for — and the proof is that somebody already did
it once. A static cross-check of the two bridge ends found **zero one-way gaps**: every channel the
main process registers is reachable from the preload.

So the honest statement is not "wiring needs the running application". It is:

> **The destination layer for wiring exists, is correct, and has been built exactly once.** E2E has
> been standing in for the other 97 channels, one feature at a time, at roughly two seconds per
> launch.

That is why 034 could not move the count, and it is why this spec's centre of gravity is **building a
destination** rather than performing migrations. The migrations that need nothing built are worth
doing and are scoped here as P1. They are not the point.

---

## Clarifications

### Session 2026-08-18

- Q: FR-014 requires contract coverage for every main-process channel with a real effect — 91 beyond the 7 that exist. How much belongs in this spec? → A: Only the channels currently propping up an E2E test's "wiring is live" justification; the remainder becomes a follow-up spec. *(The "7" in the question was wrong and was corrected while recording the baseline: the repo has 20 contract files, 5 reaching a `src/main` module, and exactly 1 driving a registered IPC handler. The answer is unaffected — it scopes by evidence, not by a count.)*
- Q: Is SC-001's ≤500 a target the work is measured against, or a gate it must hit? → A: A target. Done means every census verdict applied or explicitly declined with a reason; the resulting count is reported, not targeted.
- Q: How should an E2E test name the reserve entry that makes it irreducible? → A: A third tag class in the test title, alongside the existing significance and category tags, using a stable identifier rather than prose.
- Q: Who settles the eleven items the census left unresolved, and when? → A: All eleven are settled by direct reading as the first work item of this spec, before any migration is applied.
- Q: How is SC-009's "no new intermittent failures" established? → A: A worker sweep of the surviving suite at 1, 3 and 6 workers, compared against 034's measured baseline of 38/0, 34/4 and 20/14.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Reclaim the tests that already have a home (Priority: P1)

A contributor runs the gate. The E2E stage no longer spends launches re-proving assertions that a
unit, component, integration or contract test already makes — because those tests have been deleted,
with the covering test named in the commit that removed them.

**Why this priority**: It is the largest effect available with no new infrastructure, it is backed by
evidence read on both sides, and it de-risks everything after it by exercising the removal discipline
on cases where the replacement demonstrably already exists.

**Independent Test**: Delete one confirmed duplicate, run the covering test and the trimmed spec, and
observe the suite is smaller with no assertion lost.

**Acceptance Scenarios**:

1. **Given** an E2E test whose assertion a named lower-layer test already makes, **When** the census
   verdict is applied, **Then** the E2E test is deleted and the commit names the covering test by
   `file:line`.
2. **Given** a spec file whose every test has been deleted or relocated, **When** the file empties,
   **Then** the file is removed and the E2E budget is re-seeded in the same commit.
3. **Given** a deletion that would drop coverage, **When** no covering test can be named, **Then** the
   deletion does not happen and the test is recorded as KEEP with its reason.

---

### User Story 2 — Retire tests justified by a reserve entry they never exercise (Priority: P1)

A contributor reads an E2E test's header, sees it claim the OS drag-and-drop reserve, and finds the
test dispatching a synthetic in-page event. The claim is corrected and the test moves down.

**Why this priority**: This is a distinct defect class from duplication, it was found independently by
multiple assessors, and it is invisible to every guard the suite currently has. It is also the class
most likely to recur, which is what the governance change in User Story 4 addresses.

**Independent Test**: Take `tree-drop-open.e2e.ts`, confirm all five tests dispatch a
`throng:tree-drop` CustomEvent rather than a real drag, write the component replacement, observe it
fail against a broken implementation, then delete the E2E file.

**Acceptance Scenarios**:

1. **Given** an E2E test citing a reserve entry, **When** the mechanism it actually drives is
   inspected, **Then** a test that does not exercise that mechanism is migrated to the layer that can
   observe what it really does.
2. **Given** such a migration, **When** the replacement is written, **Then** it is observed failing
   against a broken implementation before the E2E test is deleted.
3. **Given** a test whose justification has drifted but whose assertion still needs the running
   application for a *different* reason, **When** it is assessed, **Then** the header is corrected and
   the test stays.

---

### User Story 3 — Build the destination layer for cross-process wiring (Priority: P1)

A contributor adds a new IPC channel. A static guard tells them immediately if the two ends disagree,
and a contract test proves the handler's real effect — without launching the application. The feature
riding that channel is then proven at the layer that owns its logic.

**Why this priority**: It is the deliverable. It converts the largest KEEP-E2E bucket from
irreducible into movable, and it is the thing whose absence made 034's test-count result look like a
failure of effort when it was a failure of destination.

**Independent Test**: Introduce a deliberate mismatch between the preload and main, and observe the
static guard fail in milliseconds where previously only a full E2E run would have caught it.

**Acceptance Scenarios**:

1. **Given** a channel the preload speaks that the main process does not register, **When** the guard
   runs, **Then** the build fails and names the channel.
2. **Given** a channel registered through a named constant or a helper map rather than a string
   literal, **When** the guard runs, **Then** it resolves the constant and does not report a false
   mismatch.
3. **Given** a main-process handler with a real effect on disk, a database or the OS, **When** its
   contract test runs, **Then** the effect is asserted without an application launch.
4. **Given** a feature whose only remaining E2E justification was "the wiring is live", **When** the
   guard and the channel's contract test both exist, **Then** that E2E test is migrated down.

---

### User Story 4 — Stop justifications from rotting (Priority: P2)

A contributor adds an E2E test. The build requires them to name which reserve entry makes it
irreducible, and a reviewer can later check that claim against what the test does.

**Why this priority**: Every finding in User Story 2 was a justification that was true when written
and decayed silently. Without this, the suite re-accumulates the same debt and a sixth census becomes
necessary. It is P2 rather than P1 only because it prevents future cost rather than removing present
cost.

**Independent Test**: Add an E2E test with no named reserve entry and observe the build fail.

**Acceptance Scenarios**:

1. **Given** a new E2E test, **When** it names no reserve entry, **Then** the build fails.
2. **Given** an E2E test naming an entry, **When** a reviewer compares the claim to the mechanism the
   test drives, **Then** the claim is checkable without reading the whole file.
3. **Given** the enumerated reserve changes, **When** an entry is added or reworded, **Then** existing
   tests naming the old wording still build.

---

### Edge Cases

- **A file empties entirely.** Seven do. The file is deleted and the budget re-seeded in the same
  commit, because the budget ratchet fails both ways — over budget, and under it without re-seeding.
- **A test splits.** Many verdicts are SPLIT rather than MOVE: part of the assertion duplicates a
  lower test, part genuinely needs the application. The E2E test narrows rather than disappearing,
  and the count falls by less than the verdict list suggests.
- **A migration target does not exist yet.** Several verdicts name a component seam that must be
  extracted first. The extraction is a production refactor and is verified against the *unmodified*
  E2E test before any test is removed.
- **The replacement cannot be made to fail.** If a replacement passes against a deliberately broken
  implementation, it is not a replacement. The E2E test stays and the finding is recorded.
- **An assessor's citation was wrong.** One assessor's cross-file citations resolved against the wrong
  working tree. Those citations are re-checked before they are acted on, not trusted.
- **A channel has no observable real effect** (a pure query). Its contract test asserts the returned
  shape rather than a side effect.
- **A migration destabilises a neighbouring spec.** Removing tests changes what runs concurrently, so
  a spec this work never touched can start failing through focus theft or shared state. The worker
  sweep in SC-009 is what surfaces it; the fix belongs to the migration that caused it, not to the
  spec that exposed it.
- **A test appears to need two reserve entries.** Per FR-016b that is evidence it asserts two things,
  and it is split rather than given a second tag.

---

## Requirements *(mandatory)*

### Functional Requirements

**Migration — applying the census**

- **FR-001**: Every E2E test deleted MUST have a named covering test recorded by `file:line` in the
  commit that removes it.
- **FR-002**: A replacement written for a migrated test MUST be observed failing against a broken
  implementation before the E2E test is deleted.
- **FR-003**: A spec file whose tests have all been removed MUST be deleted, and the E2E budget
  re-seeded in the same commit.
- **FR-004**: A test whose verdict was SPLIT MUST be narrowed to the assertion that genuinely requires
  the running application, with the removed portion's covering test named.
- **FR-005**: The system MUST NOT delete an E2E test on the strength of a filename match alone; the
  covering test's assertions MUST be read.
- **FR-006**: A component seam that must be extracted before a migration MUST be verified against the
  unmodified E2E test before any test is removed from that file.

**The justification-drift class**

- **FR-007**: An E2E test citing a reserve entry MUST actually exercise the mechanism that entry
  names; one that does not MUST be migrated to the layer that can observe what it does drive.
- **FR-008**: A test that dispatches a synthetic in-page event MUST NOT be justified by the OS
  drag-and-drop reserve.
- **FR-009**: A test that drives an in-document control MUST NOT be justified by the native menus and
  dialogs reserve.

**The destination layer**

- **FR-010**: The build MUST fail when the renderer-facing bridge speaks a channel the main process
  never registers.
- **FR-011**: The build MUST fail when the main process registers a channel the renderer-facing bridge
  cannot reach.
- **FR-012**: The channel cross-check MUST resolve channels declared as named constants or in helper
  maps, not only string literals, so that a correctly-wired channel is never reported as a mismatch.
- **FR-013**: The channel cross-check MUST complete without launching the application.
- **FR-014**: Each main-process channel handler that an E2E test currently relies on for its "the
  wiring is live" justification MUST have coverage asserting its real effect on disk, a database or
  the operating system, without an application launch. Channels carrying no such E2E justification
  are explicitly deferred to a follow-up specification: the work here is bounded by what the
  migrations need, not by the size of the channel surface.
- **FR-014a**: The set of channels selected under FR-014 MUST be derived from the census's KEEP-E2E
  justifications rather than chosen by traffic, risk or convenience, and the derivation MUST be
  recorded so a later reader can see why a channel was in or out.
- **FR-015**: An E2E test whose sole remaining justification is that the wiring is live MUST be
  migrated once its channel's cross-check and effect coverage both exist.

**Governance**

- **FR-016**: Every E2E test MUST name the reserve entry that makes it irreducible by carrying a third
  class of tag in its title, alongside the significance and category tags it already carries. The
  build MUST fail on a test that carries none, and on one naming an entry that does not exist.
- **FR-016a**: The reserve tag MUST be a stable identifier rather than prose, so that rewording an
  entry's description does not invalidate the tests naming it (satisfying FR-019).
- **FR-016b**: A test MUST carry exactly one reserve tag. A test that appears to need two is evidence
  it is asserting two things and SHOULD be split.
- **FR-017**: The enumerated E2E reserve MUST gain an entry for behaviour whose correctness depends on
  a true property of the real application runtime that a substitute either lacks or satisfies by
  coincidence.
- **FR-018**: The reserve's existing "real layout and text rendering" entry MUST be reworded to
  include resolved colour and cascaded style, not only geometry.
- **FR-019**: A reserve entry's wording change MUST NOT invalidate existing tests that named the
  previous wording.

**Honesty about scope**

- **FR-020**: Every item the census recorded as unresolved MUST be settled by direct reading of both
  sides — the E2E test and the lower-layer test alleged to cover it — before any migration is applied.
  No verdict for these may be inferred from a filename, a test title, or another assessor's summary.
- **FR-020a**: Until an unresolved item is settled, the spec asserts nothing about it and it MUST NOT
  be deleted, migrated or counted toward the projection.
- **FR-021**: Reported outcomes MUST state the achieved test count against the projected range, and
  name the shortfall if the projection is missed.
- **FR-022**: Every census verdict MUST end in one of two states — applied, or declined with a recorded
  reason. A verdict left in neither state MUST fail the completion check, and the test count MUST NOT
  be used as a substitute for that check.

### Key Entities

- **Verdict**: one per E2E test — keep, move to a named lower layer, delete as a duplicate, or split —
  carrying its evidence by `file:line` and a confidence marker.
- **Reserve entry**: one of the enumerated categories of behaviour that only the running application
  can observe. A test names exactly one.
- **Channel**: a named message path between the renderer-facing bridge and the main process. It has
  two ends that must agree, and usually a real effect.
- **Covering test**: the lower-layer test named as the replacement for a deleted E2E test. Without
  one, no deletion happens.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every verdict the census produced is applied, or explicitly declined with a recorded
  reason; the count of verdicts in neither state is zero. This — not a number — is the finish line.
- **SC-001a**: The E2E suite is expected to fall from 687 tagged tests to roughly 500 as a
  *consequence* of SC-001. The achieved figure is reported against that projection, and a shortfall is
  named rather than absorbed. Reaching 500 with verdicts still unapplied does NOT satisfy SC-001.
- **SC-002**: The number of E2E spec files falls from 229 to no more than 215.
- **SC-003**: Every test removed is accounted for by a named covering test; the count of unaccounted
  removals is zero.
- **SC-004**: A disagreement between the two ends of a message channel is detected in under one second
  and without launching the application.
- **SC-005**: Every message channel that an E2E test relied on for a "wiring is live" justification has
  coverage of its real effect that runs without an application launch, and no E2E test retains that
  justification once its channel is covered.
- **SC-006**: Every E2E test names exactly one reserve entry via a stable tag; the count naming none,
  naming more than one, or naming an entry that does not exist is zero.
- **SC-007**: The full gate's wall-clock falls by at least 15% against the 034 baseline of ~21.2
  minutes for the E2E stage.
- **SC-008**: No assertion present before the migration is absent after it — demonstrated by every
  removal citing its replacement, not by the suite passing.
- **SC-009**: The surviving suite is no more flaky than before, established by running it at 1, 3 and
  6 workers and comparing against 034's measured baseline (38 pass / 0 fail, 34/4, and 20/14
  respectively, improved by 034 to 31/31/31). A failure appearing only at higher worker counts counts
  as a regression, because that is where this suite's instability has historically lived.

---

## Assumptions

- **The census's ~70/30 split is representative.** Five independent assessors returned 68%, 74%, 67%,
  ~70% and 71% KEEP. The projection in SC-001 follows from that consistency, not from one sample.
- **The two phases are separable.** The migrations in User Stories 1 and 2 need nothing built; User
  Story 3 builds infrastructure. If Story 3 is deferred, Stories 1 and 2 still deliver ~200 tests'
  worth of reduction.
- **A static cross-check of the two bridge ends is sufficient to prove channel-name agreement.** This
  was demonstrated during the census. It is **not** assumed sufficient to prove payload shapes agree —
  see Out of Scope.
- **Existing lower-layer patterns are reusable.** The fake-bridge component pattern and the real-handler
  contract pattern both already exist in the repository; this spec extends their reach rather than
  inventing an approach.
- **The budget ratchet already exists and is not re-specified here.** The constitution already requires
  a declared E2E budget that the build enforces downward-only. What it does not require — and what
  FR-016 adds — is that each test name *why* it is irreducible.

---

## Out of Scope

- **Proving that payload shapes agree across the bridge.** The census established name agreement only.
  Whether a static check can also prove the shapes match is an open question, and asserting it here
  without evidence would repeat the mistake this spec was written to correct.
- **Contract coverage for channels no E2E test depends on.** Completing the remaining ~97 channels is
  worth doing and is deferred to a follow-up specification. Scoping it by the channel census rather
  than by what the migrations need would make the build's size a function of the IPC surface instead
  of a function of the evidence.
- **Re-tiering or re-sharding the suite.** 034 settled the local two-tier arrangement and removed CI
  sharding.
- **Changing which tests are `@core`.** The significance tagging is orthogonal to the layer question.
- **The tests recorded as unresolved.** Listed below; they stay as they are.

---

## Explicit non-assertions

The census could not settle the following, and this spec asserts nothing about them **as written**.
Per FR-020 they are settled by direct reading as the first work item, before any migration is applied
— so this list is a work queue with a deadline, not a permanent disclaimer. It is recorded in full so
that a later reader knows they were considered and left open, rather than missed.

- `active-panel.e2e.ts` (both tests) — three assessors suspected duplication against a core unit test
  **on the strength of the filename alone**; none opened it. Left as-is pending a direct read.
- `preferences-themes.e2e.ts:161,179,226,290` and `preferences-settings.e2e.ts:112` — genuine
  unresolved disagreement over whether a mocked bridge can prove a real write followed by a real
  repaint.
- `explorer-live-sync.e2e.ts:113,145` — a plausible duplicate was named, but the file documents itself
  as a deliberate regression fence for a bug proven separately at a lower layer.
- `editor-move-repoint.e2e.ts:239`, `preferences-map-control.e2e.ts:152` (handler not traced),
  `theme-sweep.e2e.ts:113`, `icon-colour.e2e.ts:145`, `fileop-lock-cause.e2e.ts:209`,
  `projects.e2e.ts:273`, `editor-stranded-recovery.e2e.ts:185`, `quick-open.e2e.ts:386,549`,
  `menu-keyboard.e2e.ts:145` — verdicts given but flagged low-confidence.
- One assessor's cross-file citations resolved against a different working tree than the branch under
  review. Its citations for `editor-language-override.e2e.ts` and `search-keybindings-editor.e2e.ts`
  require a same-branch check before being acted on.

A correction the census produced, recorded because the dispatch that produced it was wrong:
`terminal-input-idle.e2e.ts` is `@extended`-only and carries no opt-in environment gate, contrary to
the assumption it was assessed under.

---

## Constitution amendments required

Three changes, all to Principle V. Two are additive; one is a rewording that removes no rule.

1. **A ninth reserve entry — real application-runtime identity.** Behaviour whose correctness depends
   on a true property of the running application that a substitute either lacks or satisfies by
   coincidence. The worked examples come from the census: a frozen renderer-facing bridge object, into
   which a page-level instrument literally cannot install itself; and the identity of the executable
   path used to spawn a child process, where the existing lower-layer test runs *as* that executable
   and so cannot observe the regression **by construction**. This is narrow and checkable, which is
   what distinguishes it from the broad wiring entry the census rejected.

2. **Reword "real layout and text rendering" to include resolved colour and cascaded style.** The
   entry currently names only geometry — a caret against a gutter, what is scrolled into view, a
   wrapped line's height, a measured rectangle. Four assessors independently proposed a colour entry,
   and three separate test files have each re-derived the same justification from scratch because the
   enumeration did not cover it. This is a wording gap in an existing entry, not a new entry, and
   treating it as new would have inflated the reserve for no gain.

3. **Every E2E test names its reserve entry, and the build fails on one that names none.** The
   constitution already requires a significance tag, a category tag and a downward-only budget. None
   of those can detect a test whose justification has decayed, which is precisely the defect class
   User Story 2 exists to clear. Naming the entry makes the claim checkable by a reviewer and by a
   guard. The mechanism is a **third tag class carried in the test title**, which reuses the
   enforcement path the significance and category tags already have, and uses a stable identifier so
   that amendment 2's rewording does not invalidate the tests that named the entry.

**Deliberately not proposed: a test-count ceiling.** The constitution already requires a declared E2E
budget enforced as a downward-only ratchet, and the repository already implements it. Proposing a
ceiling would have duplicated a rule that has been in force for two releases — the specific mistake
CLAUDE.md's "find the requirement that already governs it" section exists to prevent.

**Rejected reserve entries**, each proposed during the census and each already covered or already
provable below E2E: real filesystem watchers, real configuration hot-reload, real clipboard access,
real pointer-driven in-app drag, real taskbar chrome, real main-thread performance, real subprocess
termination, real cross-process environment propagation, and persisted state surviving a relaunch.
The broad *"real end-to-end wiring through the application's own backend"* is rejected on the
measurement recorded above: it is the largest KEEP bucket and it is the one this spec dissolves.
