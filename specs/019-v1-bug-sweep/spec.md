# Feature Specification: v1.0.0 Bug Sweep — Signals That Were Never Sent

**Feature Branch**: `019-v1-bug-sweep`

**Created**: 2026-07-16

**Status**: Draft

**Input**: The six open **bug** issues in the **v1.0.0** milestone that are not already being worked
elsewhere: [#95](https://github.com/Bidthedog/throng/issues/95),
[#94](https://github.com/Bidthedog/throng/issues/94),
[#87](https://github.com/Bidthedog/throng/issues/87),
[#86](https://github.com/Bidthedog/throng/issues/86),
[#83](https://github.com/Bidthedog/throng/issues/83),
[#67](https://github.com/Bidthedog/throng/issues/67).

The milestone holds eight open bugs. **#90** (Shift+Enter fidelity) and **#75** (E2E flake drain) are
excluded by owner direction on 2026-07-16 — both are in flight on their own worktrees.

Each of the six was reproduced against `master @ 87e28a9` before this specification was written, and
**five of the six issues were rewritten on 2026-07-16** to match the mechanism that reproduction found
(#83, #86 and #94 retitled; #67 and #87 amended; #95 left alone, being accurate as filed). The issue
text and this specification therefore agree. Each issue carries a correction comment preserving its
original body verbatim.

| Issue | Defect | Story |
|-------|--------|-------|
| **#87** | An in-app file move leaves the open editor pointing at the old path; a later save silently undoes the move | US1 |
| **#86** | Layout and per-panel zoom are lost on an ordinary close: the pending write is never drained | US2 |
| **#94** | An elevated throng hangs indefinitely when a de-elevated terminal never arrives | US3 |
| **#67** | ~~The two terminal-flavour settings have no control type that fits their shape~~ — **PULLED to vNext on 2026-07-17**; the controls are **hidden** for v1.0.0 rather than built (see US4, C33) | US4 |
| **#95** | Two settings claim the open-on-click job; the File Explorer one is inert | US5 |
| **#83** | No syntax colour is contrast-checked against the editor background | US6 |
| **#120** | A folder's expansion state is path-keyed, so a move strands it — the tree can wedge open-but-empty | US7 |
| **#121** | Only the chevron should toggle a folder; clicking the name or glyph should select only | US8 |
| **#122** | A renamed file loses its selection when its id (its relPath) changes on rename | US9 |
| **#124** | The UI⇄JSON toggle button wraps onto two lines in the five monospace themes | US10 |

**Adopted after the adversarial review (2026-07-17).** US7–US10 (#120, #121, #122 and the new
[#124](https://github.com/Bidthedog/throng/issues/124)) were folded into this feature at the
developer's direction *after* the review, alongside the same-day decision to **pull #67 to vNext**.
All four adopted items are **pre-existing** defects — not 019 regressions; each was reproduced RED on
this branch before being fixed and is green now. See the "Adopted after the review" note under the
Summary, and clarifications **C29–C34**.

---

## Summary

Six defects, reproduced first-hand against the tree at `87e28a9` before this specification was
written. Every one of them was driven to a failing test; none was accepted on the strength of its
issue text. That mattered more than expected — **two of the six issues describe a bug that does not
exist**, and a third names a remedy that cannot work.

Read together, four of the six are the **same defect wearing different clothes**: a component knows
something and never tells anyone.

- **#87** — `FilesService` knows it moved a file. It never tells the editor coordinator, so the
  coordinator's watcher infers a *deletion* and dirties the buffer.
- **#86** — the renderer holds a pending layout write. Nothing asks it to drain before the window
  closes, so the write dies with the renderer.
- **#94** — `PtyAgentHost` establishes conclusively that the de-elevated agent will never arrive.
  It keeps that to itself, and the panel hangs on a daemon that already reported `running`.
- **#95** — Preferences renders a control that governs nothing, because the setting it writes has no
  reader at all.

In each case the *machinery for the correct behaviour already exists* — a re-point branch, a
`flushSave`, a `failAllLive` path, a working sibling setting. What is missing is the **signal that
reaches it**. This is a sweep in the spirit of feature 017: it closes a class, not a capability.

The remaining two are the inverse — a **guard that was never written** (#83) and a **control that was
never built** (#67).

### The source issues were corrected before this specification was written

The issues were written from a reading of the code that was in three places wrong, and in two places
inverted. **On 2026-07-16 each was rewritten to match the reproduced mechanism**, so the issue text and
this specification now agree; every original reading is preserved verbatim in a correction comment on
its own issue, and #83, #86 and #94 were retitled. The corrections are restated here because they
changed the *work*, not merely the prose — a reader who remembers the old text will otherwise not
understand why this feature is shaped as it is. Every one is backed by a test in this feature's RED
suite.

- **#83's premise was false. The light themes are not illegible.** All ten syntax tokens were measured
  against `editorBg` across all fifteen bundled themes: **150 pairs, zero failures**, every pair above
  **6:1** — comfortably clear of the 4.5:1 WCAG AA body threshold. `Light`'s worst token is 6.12:1.
  The cause is `default-themes/index.ts:192`, where `makeTheme` pushes every seed through
  `legibleOn(c, [editorBg], editorFg, 6)`, lifting each hue until it clears 6:1 before it ever becomes
  a token. **The authored seeds are not what ships.** The *guard gap* the issue identifies is entirely
  real — nothing measures these pairs — but the symptom is not. #83 is a **guard** feature, not a
  recolour. Its acceptance criterion "the bundled light themes are recoloured until they pass" had
  nothing to do and has been struck; `THRONG_THEME` — hand-authored, bypassing `makeTheme` — currently
  passes **by luck**.
- **#86 was inverted on both axes.** The language override is **not lost**: `setDocumentOverride` is an
  awaited IPC with no debounce onto a **synchronous** SQLite write
  (`daemon/src/document-service.ts:67`), so no close beats it. The write that is actually lost is
  **`workspace.save`** — the layout blob carrying both split structure and per-panel zoom — behind a
  400ms debounce (`workspace-store.tsx:42`) that nothing drains on shutdown. And the exit that loses
  it is the **ordinary close**, not Terminate All. Terminate All survives *by accident*: its prompt
  stalls the close ~900ms (measured: dialog visible at 21ms, window gone at 917ms), outlasting the
  debounce — **the user reading the dialog is the drain**. The ordinary close fires on a 250ms timer
  (`main.ts:661`); 250 < 400. **Fixing what #86 asks for would harden the one exit that already
  works.** The blast radius is also narrower than the issue feared: layout and zoom are the *same*
  write, the find bar's last term is not persisted at all, and "recently-used values" do not exist in
  the codebase. The issue is now titled for the defect it actually describes.
- **#94's two hypotheses were both wrong, and the real mechanism is a third thing.** The issue asked
  whether the handoff never returns a PTY, or a PTY attaches whose output is never pumped. Neither:
  `WindowsDeElevatedLauncher.launch()` is **fire-and-forget** — `spawn(…, {stdio:'ignore'}).unref()`,
  returning `void` (`windows-de-elevated-launcher.ts:31-34`) — so there is no "returning a PTY" step
  that *could* fail. The hang is that when `PtyAgentHost`'s 15s connect deadline lapses, the retry
  loop **simply stops** (`pty-agent-host.ts:67-74`): no callback, no error, no teardown. Meanwhile
  `start()` optimistically mints a synthetic handle, so the daemon reports `running` and the panel
  clears its "still starting" state. **The panel is not buggy; it is being lied to.** Also:
  `WindowsDeElevator` is dead code (`isAvailable()` hard-returns `false`).
- **#67's proposed remedy could not work as stated.** The issue said to reuse feature 016's keyed-table
  editor. That editor exists (`map-control.tsx`) but **rejects arrays outright** — `asMap` returns
  `{}` unless `!Array.isArray(value)` (`map-control.tsx:29-30`) — so feeding it `terminals.flavours`
  renders an empty table and **the first commit overwrites the array with an object**. It also has no
  ordering, no text cell (any non-number column falls through to an empty `<select>`), and no
  per-column validation. It is *generalisable*, but that is real work, not a re-point.
- **#95 was accurate as filed** — the only one of the six that was, and the only one left unedited.
  Worth recording *why* it hid:
  `decideClick(openMode, …)` (`open-intent.ts:17`) **names its parameter** `openMode`, so a search for
  the setting appears to find a consumer. The parameter is only ever fed `editor.openOnClick`.

### Defects found during reproduction

None of these appeared in the issues as filed; each has since been added to the relevant issue's body
and, where it changes the definition of done, to its acceptance criteria.

- **`FilesService.rename()` has #87's hole identically** (`files-service.ts:62-82`). A rename *is* a
  move. It is not in #87's acceptance criteria. See FR-006.
- **Path spelling is not normalised anywhere.** The coordinator stores forward-slashed paths from the
  tree; Node produces back-slashed ones. Any move-matching logic that compares paths raw will fail
  silently on Windows. See FR-007.
- **#67's control type flips with its value.** `terminals.flavours` ships `[]`, and `[].every(...)` is
  vacuously true, so an *empty* list renders as a string-array control whose Add button appends `''`
  — an empty **string** into an array of **objects**, which the tolerant parser then drops. Add one
  flavour and the control silently becomes a JSON textarea.
- **Hiding a built-in flavour is a one-way door.** The only IPC surface, `listFlavours()`, already
  subtracts `disabledBuiltins` (`shell-detection-service.ts:27-35` → `terminal/flavour.ts:33,42-43`),
  so a picker built from it **cannot offer an already-hidden built-in** to be un-hidden. See FR-017.
- **The elevated code path has zero CI coverage.** Worse than "the runners are elevated":
  `playwright.config.ts:55,88` `grepInvert`s `@admin` unless `THRONG_E2E_INCLUDE_ADMIN` is set, and CI
  never sets it. So `@admin` specs are excluded from the one runner capable of executing them, while
  `skipIfElevated()` specs self-skip there. `admin.ts`'s docblock asserts the opposite of what
  `ci.yml:157-158` does. See FR-012, FR-013 and FR-013a.
- **`terminals.defaultParams` is probably already broken.** It declares a `control: 'text'` column
  (`settings-metadata.ts:185-186`), which the map control renders as an empty `<select>`. It has zero
  test coverage. See Open Question 8 (resolved by C14).
- **`PtyAgentHost` already discards the signal its fix needs.** The protocol defines a readiness ack
  — `{ ev: 'started'; key; pid }` (`pty-agent-protocol.ts:26`) — and the host drops it unhandled
  (`pty-agent-host.ts:133-135`).

### Adopted after the review (2026-07-17)

After the adversarial review of the original six, the developer directed **four more items** into this
feature and, the **same day**, pulled **#67** out of it. The four are recorded here because they change
the shape of the feature, not merely its length:

- **#120 [Bug]** — a folder's expansion state is keyed by its path, so a move strands it; the tree can
  wedge **open-but-empty** because `build(dir)` returns `?? []`, making an *unloaded* folder
  structurally indistinguishable from an *empty* one. Same defect class as US1's #87 — id-keyed state
  orphaned by a path change. **US7.**
- **#121 [Tweak]** — only the chevron should toggle a folder; clicking the name (or the folder glyph)
  should select only. This **supersedes feature 004's FR-028** ("Clicking a folder MUST toggle its
  expansion"), which is why 004's spec is amended as part of this work. **US8.**
- **#122 [Bug]** — a renamed file loses its selection, because `selectedId` held the OLD relPath after
  the node id changed. Same class as #120. **US9.**
- **#124 [Tweak]** — the Preferences UI⇄JSON toggle glyph `{ }` wraps onto two lines in the five
  monospace themes. **US10.**

**All four are pre-existing** — none is a 019 regression. Each was verified against
`git log origin/master..HEAD` on this branch (empty for the touched paths for #120/#121/#122), and
#124's wrap predates 019 (it rides feature 018's `.icon` sizing). Each was driven RED before its fix,
exactly as the original six were, and all four are green now. The decisions they required are recorded
as **C29–C32**; the #67 pull as **C33**; and the honest state of #94 (adjusted in the same pass) as
**C34**.

**#67 was pulled to vNext the same day.** Rather than build the array-of-records control and the
detected-flavour multi-select for v1.0.0, the three terminal-flavour controls are **hidden** from the
Settings UI and the issue is rescheduled. US4's requirements below are re-cast from "the controls work"
to "the controls do not render"; the original flavour-editing FRs are marked **superseded for v1.0.0**
(they describe vNext's target, so they are kept, not deleted). See **C33**.

---

## Clarifications

### Session 2026-07-16 (resolved under autopilot, without prompting)

The developer invoked the delivery pipeline with an explicit instruction not to prompt. The two
clarification markers then outstanding (on FR-023 and FR-024) and the open questions below were therefore
resolved here rather than interactively — eight of the ten (OQ1–OQ8) in this session, OQ9 in the 2026-07-17 session
(C16), and OQ10 is **confirmatory only**: its own text records that the mechanism is flavour-independent,
so there is nothing for a clarification to decide. Each decision below is anchored to evidence gathered during reproduction or to an
existing precedent in the codebase; each is recorded with its reasoning so it can be overturned on
review. **Two of them are material enough to re-open deliberately if the developer disagrees: C3 (the
contrast threshold) and C9 (the control architecture).**

**C1 — A persisted `explorer.openMode` is dropped, not migrated.** (Resolves FR-023.)
The values are not compatible (`editor.openOnClick` has `none`; `explorer.openMode` does not), so a
migration must invent an intent the user never expressed. Decisive evidence: `explorer.openMode` has
**never had any effect**, so no user's current experience depends on its value — a user with
`openMode: 'double'` and a default `openOnClick: 'single'` gets single-click *today*. Migrating would
therefore **change** their behaviour to double-click; dropping preserves exactly what they have now.
Precedent: `parseExplorer` (`app-settings.ts:269`) already drops unknown keys silently. A stale key is
ignored and stripped on the next write, with no warning.

**C2 — The survivor keeps the key `editor.openOnClick` and moves to the "File Explorer" group.**
(Resolves FR-024.) A descriptor's Preferences section comes from its explicit `group` field
(`metadata.ts:65`), **not** from its key prefix. So the working setting can appear exactly where users
look for it — under File Explorer, labelled "Open files with" — while keeping the key 006 chose, which
already has consumers, tests and specs pointing at it. This gets the discoverability of the inert
control and the behaviour of the working one, with **no key rename and therefore no migration of a
setting that works**. Its `none` value is retained and becomes visible.

**C3 — The syntax contrast gate is 6.0:1, not WCAG AA's 4.5:1.** (Resolves Open Question 1.)
The spec's own analysis is decisive: `default-themes/index.ts:186-191` lifts every seed to 6:1 because
the search-match tint can only be as strong as the weakest syntax hue permits. A 4.5 gate would be
**weaker than the derivation it exists to protect** — it would permit a comment authored at exactly 4.5
that collapses the search highlight to invisibility. All fifteen bundled themes already measure ≥6.01,
so 6.0 gates reality with **zero recolouring**. Recorded as: WCAG AA 4.5:1 is the floor; **6.0:1 is
throng's house standard for code on the editor body**, and it is load-bearing rather than cosmetic.

**C4 — The new syntax pairings are gated on every bundled theme except the by-design low-contrast
carve-out; #83 is not blocked by #61.** (Resolves Open Question 2.) The contradiction dissolves once
the two pairing *sets* are separated. #61 widens `IN_SCOPE_THEMES` for the **existing** pairings — a
riskier change, because those themes may fail today, which is why it is milestoned vNext. The **new**
syntax/`editorBg` pairings pass on all fifteen themes *right now* (measured), so gating them everywhere
cannot fail the build and cannot block on #61. `IN_SCOPE_THEMES` is left untouched for the old
pairings. The deliberate low-contrast themes (Matrix, VI-VIM, Gothic) keep their carve-out per #61's
policy via an explicit by-design list — though all three pass anyway, so the carve-out costs nothing.

**C5 — `editorSelection` is out of scope; a follow-up issue is raised.** (Resolves Open Question 3.)
It is a genuine gap of the same class, but it is a *different* pairing set (syntax over selection),
unmeasured, and not named by #83. Folding it in could fail themes for reasons this feature never
diagnosed. Raised separately rather than silently widened.

**C6 — The shutdown drain covers sub-workspace windows.** (Resolves Open Question 4.)
FR-010 says *every* exit path. Sub-workspace windows carry their own layout writes on the same close-all
cascade, so excluding them would leave the bug half-fixed for exactly the multi-window users most likely
to have a layout worth keeping.

**C7 — Readiness budget: 15s from connect, separate from the 15s connect deadline.** (Resolves Open
Question 5.) Precedent is the existing 15s connect deadline (`pty-agent-host.ts:36`). The budgets are
kept **separate** — worst case 30s — so a slow connect does not consume the readiness allowance. It
starts at **connect**, not at `start()`, because before connect there is no agent that could ack.

**C8 — A lapsed launch deadline does not relaunch.** (Resolves **no listed Open Question** — a design
question raised by FR-012's failure path while planning, decided here rather than left implicit. Anchor
corrected under C15; it previously cited OQ6, which asks whether a flavour `id` is editable.)
The `close` path relaunches (**`:64-65`**; `:63` is its `failAllLive` call — see C28) because a *crashed* agent may come back. An agent that never
arrived indicates a systemic failure (the shim), where relaunching produces a launch loop that buries
the error. Surface the failure; the user retries deliberately.

**C9 — The map control is generalised to an array-of-records mode; no second table is built.**
(Resolves **#67's own stated goal**, not a listed Open Question above. Anchor corrected under C15; it
previously cited OQ7, which asks whether flavour order matters.) This is the issue's own stated goal — *"not two table implementations"* —
and FR-020 requires it. Rows carry the flavour's `id`, so the existing row/column machinery, add/remove
and duplicate-key refusal are reused rather than reinvented. *(This entry originally added "which
`dedupeById` already guarantees unique". That is **false** and is corrected by **C17** — the decision to
generalise the control stands untouched; only its supporting evidence was wrong.)*

**C10 — The raw detected set arrives on its own channel, not a flag on `listFlavours`.** (Resolves Open
Question 2 of #67.) `listFlavours()` subtracts `disabledBuiltins` and is what the *panel dropdown*
consumes; adding an `includeHidden` flag invites a caller to accidentally offer hidden flavours to
users. A distinct `listDetectedFlavours()` cannot be misused that way.

**C11 — Flavour order is preserved; reordering affordances are out of scope.** (Resolves Open Question
**7** — "does flavour order matter to the user?". Anchor corrected under C15; it previously cited OQ8,
which asks about `terminals.defaultParams`.) Order is user-visible — it is the panel dropdown's order, and `mergeFlavours` is first-wins — so the
record-list control must not sort. Adding move up/down is a capability, not a defect fix; raise it if
wanted.

**C12 — "An executable" means non-empty, not existence-checked.** (Resolves the validation question
FR-019 raises; **not** a listed Open Question above. Anchor corrected under C15; it previously cited
OQ9, the fleet-wide inert-settings guard, which C16 resolves.)
A flavour may legitimately point at a path that is valid on another machine or not installed yet.
Launch already reports *"not available on this machine"*, which is the right place for that check.

**C13 — A flavour `id` is immutable once created.** (Resolves Open Question **6** — "is a flavour `id`
editable after creation?". Anchor corrected under C15; it previously cited OQ10, which asks which
flavour #94's reporter used and which no clarification resolves.)
It keys `terminals.defaultParams`; the alternative to immutability is silently orphaning those params.
To rename, delete and re-add. The editor refuses a changed id on an existing row with a stated reason.

**C14 — `terminals.defaultParams` is fixed here, not raised separately.** (Resolves Open Question **8**
— this spec's, "is `terminals.defaultParams` already broken? Fold in, or raise separately?". Anchor
corrected under C15: the "of #67" qualifier was wrong — OQ8 is listed below.) Its `control: 'text'` column renders an empty `<select>` only because `MapCell` has no text cell —
which is exactly the gap FR-018 must close for the flavour table. The fix lands incidentally, so it gets
a regression test rather than an issue.

### Session 2026-07-17 (cross-artifact analysis repair, resolved under the same autopilot instruction)

Cross-artifact analysis found that this spec was revised heavily **after** its FRs were numbered and its
Open Questions were listed, leaving anchors pointing at the wrong things — and, more seriously, a
succession of claims that nothing had ever measured. **No C1–C14 decision is reversed by any of the
entries below** (no count here either: the list is what it is). What they do:
- **C15** repairs how the existing decisions are *cited* — no decision changes.
- **C16** answers the one Open Question no clarification had answered (OQ9), and narrows SC-012/FR-022
  to what is actually measured.
- **C17** adds design decisions C9 left implicit (row addressing, the per-row error surface) after C9's
  supporting evidence turned out to be false. C9's own decision — generalise the control — stands.
- **C18** corrects a false coverage claim and, as a consequence, **narrows what evidence is owed** at
  completion.
- **C19** corrects a false "there is only one deferred write" claim and, as a consequence, **widens what
  FR-010's drain must cover**. *(It said "to four". C24 measured three and struck the tally; the widening
  stands, the number never mattered.)*
- **C20** corrects **C19's own model** of the preferences window. *(Its premise — "at most one pending",
  "a seam is needed" — is itself **superseded**: qualified by C21, discarded by C22. No seam is built.
  Retained as history, not as authority.)*
- **C21** corrects **C20's** premise — which was derived from reading two of three tabs — and closes the
  in-flight-at-unmount gap C20 left.
- **C22** stops enumerating **writers** altogether: the drain settles the chokepoint every config write
  passes through, so no count is load-bearing. *(It then asserted a count of its own — see C23.)*
- **C23** applies C22's argument to the last enumeration standing, **windows**, and closes the real hole
  that one left: a workspace-window write that would have been acked in flight. *(It then asserted a
  count of its own — see C24.)*
- **C24** stops correcting the tallies and **deletes** them, after the fifth and sixth proved wrong
  (including one inside the entry titled "strike the counts"). No artifact states a tally now.
- **C25** is the first entry that is **not** about counting: it asks what a writer actually *does*, and
  finds C22's replacement API cannot express `writeTheme` and that a deletion would not compile.
- **C26** asks that of the other writers and of the module, and finds three more: the API cannot express
  `json-tab` either, a required `cancel` had been deleted, and the "new" in-flight map **already
  existed**. It also adds the neighbour-guard task US2 had gone without.
- **C27** turns the question on **US3**, which C19–C26 never asked: `failAllLive` does not emit the
  non-zero exit four documents credited it with, and the `@admin` test's own deadline is tighter than
  the budget the spec states.
- **C28** asks it of the caller C27 did not come for. A shared helper has more than one.
C17, C18 and C19 exist because a claim written confidently in five documents is not a measurement. Each
was checked against the tree; each was wrong; each is recorded here with what it was and why it changed,
rather than quietly edited into agreement.

**C15 — The traceability anchors are repaired; no decision is reversed.** (Resolves an internal
inconsistency in this section and in the requirement cross-references.) Six repairs, each recorded so
the drift is visible rather than erased:
1. **Six clarification anchors were wrong.** C8 cited OQ6 (flavour `id` editability), C9 cited OQ7
   (flavour order), C11 cited OQ8 (`defaultParams`), C12 cited OQ9 (the fleet-wide guard), C13 cited
   OQ10 (which flavour the reporter used), and C14 claimed OQ8 was "of #67" when it is listed here.
   Corrected to: **C11→OQ7, C13→OQ6, C14→OQ8**; **C8, C9 and C12 resolve no listed Open Question** and
   now say so. The decisions themselves were always unambiguous — only their citations misled.
2. **US5 AC3 demanded what FR-023 forbids.** It asked for the retired key's intent to be "honoured or
   the loss explicit"; C1 requires the key be dropped *silently*. AC3 predates C1 and has been rewritten
   to state C1's outcome. **C1 wins** — its reasoning (the key has never had an effect, so dropping is
   the only option that does not *change* a user's behaviour) is exactly what makes the silence correct.
3. **FR-013 was doing two jobs.** Its text covers only the `started` ack, yet plan, tasks and the
   readiness contract all cited it for the CI change. The CI requirement is split out as **FR-013a**
   and those citations re-pointed. No work changes — T031 already built it; only the label was wrong.
4. **FR-008 named a mechanism that does not exist.** It required the recovery snapshot to "follow the
   move or be re-keyed"; snapshots are `panelId`-keyed and carry **no path**, so there is nothing to
   re-key. Reworded to what the design actually guarantees — snapshots follow automatically, and it is
   the **persisted panel config** that must carry the new path. The obligation is unchanged; T012
   already implements the half that needed building.
5. **Three stale FR cross-references** repointed: the one-way-door correction FR-015→**FR-017**; the
   empty-flavours-list edge case FR-014→**FR-018**; US5 AC3 FR-018→**FR-023**.
6. **The Open Questions section is retained as provenance**, not deleted, and each entry now carries the
   clarification that settled it. The history of what was asked is worth more than a tidy document.

**C16 — The fleet-wide "no inert settings" guard is out of scope; SC-012 and FR-022 are scoped to what
is measured.** (Resolves Open Question 9 — the only listed question no clarification had answered.)
SC-012 claimed *"zero rendered settings have no reader"* fleet-wide while nothing measures it
fleet-wide: OQ9 and the plan's Complexity Tracking already ruled that guard out of scope, because the
only cheap implementation is a text scan and **that scan is unsound** — attempted during reproduction,
**11 false positives**, defeated by settings read through aliased section objects
(`explorerSettings.dragCopyModifier`). A sound version needs typed accessors or a type-graph check.
The decision: **do not build it, and do not claim it.** FR-022 keeps the *policy* (a control that
governs nothing must not ship) but its *enforcement* here is the open-on-click claimants, which is
precisely what `settings-open-on-click-single-owner.test.ts` measures; SC-012 is narrowed to match. The
fleet-wide ambition is tracked by the follow-up T061 raises, with the "never a grep" constraint already
written into it. Overclaiming a fleet-wide property on the strength of an unsound grep is the failure
mode this feature exists to fix — it would be a poor look to commit it in the same change.

**C17 — A duplicate flavour `id` that arrives *from the file* is shown and flagged, never silently
dropped; rows are keyed by index, not by `id`.** (Resolves an ambiguity C9 created by citing evidence
that does not support it. C9's decision — generalise the map control, do not build a second table — is
**not re-opened**; this entry fixes only what C9 claimed *about uniqueness*.)
C9 asserted that rows are "keyed by the flavour's `id`, which `dedupeById` already guarantees unique".
`dedupeById` (`flavour.ts:55`) **cannot supply that guarantee**: it is **not exported**, it operates on
the *merged runtime* `TerminalFlavour[]` (with `source` and resolved params), and it only shapes the
**launch list**. `parseTerminals` does **not** dedupe `terminals.flavours`, and the JSON tab ships — so
a hand-edited `settings.json` can hand the control two rows with one id. FR-019 covers only the
**editor-entry** path. The resulting decisions:
- **Render every row the file contains, in file order.** Hiding or auto-dropping the second row would
  be a silent data loss of something the user typed — the same class of defect as #67's tolerant parser
  swallowing the `''` its own Add button appended. This feature does not get to commit the bug it is
  fixing.
- **Key rows by index**, not by `id`. Order is preserved and never sorted (C11), so the index *is*
  stable — and it is the honest key, because `id` is not unique in this input. This fixes the React
  key. *(An earlier draft of this entry also claimed it fixed the test ids. **It does not** — the test
  ids are id-**derived** and fixed by the RED E2E, which this feature may not rewrite. That claim is
  struck and replaced by the addressing rule below, which was the actual gap.)*
- **Address rows by a `rowKey`**, defined as: the row's `id` for the **first** row claiming that id,
  and `${id}-${index}` for each subsequent row claiming it. Every id-derived test id in the `records`
  mode is built from `rowKey`, not from `id` (`${itemNoun}-row-${rowKey}`,
  `${itemNoun}-cell-${rowKey}-${column.key}`, `${itemNoun}-row-error-${rowKey}`). **For unique ids —
  every case the RED E2E drives — `rowKey === id`, so the scheme it fixes
  (`flavour-row-my-wsl`, `flavour-cell-my-wsl-label`) is unchanged and no RED assertion moves.** Only a
  file-authored duplicate produces a suffix, and it produces a *writable* locator instead of two
  elements answering one test id (a Playwright strict-mode violation, which would make the duplicate
  case untestable — i.e. undefined behaviour with extra steps). First-wins for the un-suffixed name
  follows `mergeFlavours`'s existing first-wins precedent.
- **Flag the duplicate on the offending row**, with `validateFlavourRecord`'s existing "already"
  message. This needs a surface that does not exist today: the control has exactly **one**
  control-level `role="alert"` region (`map-control.tsx:208-212`, `${itemNoun}-error`) driven by
  **transient add/commit state**, so it cannot speak for a row that was never committed through the
  editor. The `records` mode therefore adds a **per-row error cell**, `${itemNoun}-row-error-${rowKey}`,
  rendered only when that row fails validation. The control-level region keeps its current job and its
  test id **unchanged** — the RED E2E asserts on `flavour-error` for add-time failures (`:198`, `:205`,
  `:215`) and those assertions must not move. The rule the editor enforces on entry (FR-019) is the
  same rule it reports on a row that arrived pre-broken — one rule, two entry points, visible either
  way.
- **The launch list is unchanged**: `mergeFlavours` keeps its first-wins `dedupeById` behaviour. That
  is existing, tested behaviour and no part of this feature touches it. The control now *tells the
  user* which row is losing, which is the only thing that was missing.

**C18 — CI covers #67 after all; only #87 and #86 need the non-elevated developer run in PR evidence.**
(Resolves a factual error that this spec, the plan, the quickstart, the tasks and the research all
repeated. It changes what **evidence** is owed at completion, which is why it is a clarification rather
than a typo fix.)
Every artifact claimed *"six of the seven test files call `skipIfElevated()`"* and that a green CI bar
therefore *"says nothing about #87, #86 **or #67**"*. **Counted against the tree: only two do** —
`editor-move-repoint.e2e.ts` and `terminate-all-drain.e2e.ts`. **No count here** — an earlier draft said "×8" and "×5", which were `grep -c` totals **including the import line** (the real figures are one call per test). A miscount inside the entry that exists to correct a miscount; C24's rule applies to C18 too.
`preferences-terminal-flavours.e2e.ts` has **no elevation guard at all**, and the claim was impossible
on its face: three of the seven files are Vitest suites that cannot call a Playwright `test.skip`
helper, and the fourth E2E is `@admin`-tagged rather than self-skipping — at most **three** could ever
have called it. The consequences, each decided here:
- **#67's E2E executes on CI's elevated runner**, so its 4 RED assertions are **failing CI on this
  branch today** — which is the correct state for a RED test, and T046 turning them green is therefore
  visible in CI rather than only on a developer's machine.
- **The elevated-daemon caveat does not apply to it.** `admin.ts:40-52`'s reasoning is that an elevated
  daemon routes terminals through the de-elevated agent, so terminal-adjacent assumptions break. #67's
  spec drives **Preferences and shell detection** and starts **no terminal**, so it has nothing to
  break — which is presumably why its author added no guard. It is expected **green on the elevated
  runner** once T046 lands, and **CI is the check**: no separate claim is needed.
- **The PR-evidence obligation narrows to #87 and #86** (T062). Demanding a non-elevated run as proof
  for a spec CI already executes would be ceremony, and — worse — it would keep alive the impression
  that CI covers less than it does. The honest statement is the narrow one.
This is exactly the class the feature exists to close: a claim that sounded careful, that nothing
measured, and that was repeated across five documents until it read as established fact.

**C19 — There is more than one deferred write, not one; the drain covers every one the closing window owns.** (This entry said "four"; **C24** measured three — the apply client's debounce is unreachable. The correction changes nothing, which is the point.)
(Resolves a false Key Entity claim, and with it the reach of FR-010. No C1–C14 decision is touched; C6 —
"excluding them would leave the bug half-fixed" — is the precedent this follows.)
The Key Entity said the deferred write is *"`workspace.save` (layout + per-panel zoom), **and only
that**"*. Counted against the tree, there are **several** debounced renderer→daemon writes — not one — and **every one
of them drops its promise with `void`** — the identical defect FR-010 exists to close:

| Write | Debounce | Flushed today | Dropped promise |
|---|---|---|---|
| `workspace.save` (layout + zoom) | 400 ms (`workspace-store.tsx:42`) | project switch, unmount | `void client.save(…)` (`:129`) |
| Preferences **apply client** | ~~250 ms (`apply-client.ts:23`)~~ — **unreachable; see C24**: `applyDebounced` has no callers, every write goes through `applyNow`, which cancels the debounce | ~~unmount (`settings-tab.tsx:115`)~~ — flushes a debounce that can never be armed | `void writeConfig(…)` (`:25`), and `void apply.applyNow(…)` at every call site |
| Themes tab `writeTheme` | 150 ms (`themes-tab.tsx:297`) | unmount (`:302`) | `void writeConfig(…)` (`:298`) |
| JSON tab apply | 300 ms (`json-tab.tsx:54`) | **nothing — no flush at all** | `void writeConfig(…)` (`:72`) |

*(This table said **four deferred writes**. **C24 measured three** — the apply client's row is struck
above. The table is kept because the *writes* are real and the anchors are exact; only the arithmetic
built on it was fiction, and the drain never used the arithmetic.)*

The decisions:
- **The Key Entity is corrected** to name the others. The "only that" was never measured; it is how the
  other three stayed invisible, and it is the same shape as C18's "six of the seven".
- **A window's drain covers every deferred write that window owns** — `workspace.save` in a workspace
  window; the apply client, `writeTheme` and the JSON tab's apply in a preferences window. **C6 decides
  this**: it already rejected a drain that reaches some windows and not others *because it would leave
  the bug half-fixed*, and a drain that reaches some **writes** and not others is the same defect one
  level down. A user who edits a theme colour and closes throng has precisely #86's experience.
- **Each flush must become awaitable** — return the promise instead of dropping it with `void`, exactly
  as T017 does for `flushSave`. `await apply.flush()` against today's `flush(): void` **awaits
  `undefined`**: it resolves immediately, the ack fires before the write lands, and the drain reports
  success having drained nothing. That is a proof that cannot fail, inside the story about silent
  no-ops — refused here for the same reason T031a and T034 were written.
- ~~**The JSON tab gains the unmount flush its three siblings have.**~~ **SUPERSEDED by C22, as C24
  records** (and *"three siblings"* was always **two**). Its absence is real — #86's defect on another
  path, reachable without any close at all — but under C22 the module registry catches the orphaned
  timer, so an unmount flush is **redundant**, and T017a deletes the two that exist rather than adding a
  third. C22 claimed to keep every C19–C21 *decision*; that was too broad, and this is the decision it
  actually superseded. **No task implements it, because none should.**
- **Out of scope, explicitly**: the shared `debounce` helper's signature (`write-config.ts:93`) is
  **not** changed — its **search-input** callers (`keybindings-tab.tsx:93`, `settings-tab.tsx:76`, `themes-tab.tsx:121`) write nothing, and `scheduleWrite` is built **on** it, for writers only. Each write is retained by the module instead. Widening a helper used by
  non-writers to fix writers would be a blast radius bought for nothing. *(An earlier draft of this
  bullet said "four of which are search-input debouncers", which contradicts this entry's own table —
  3 writers + 4 non-writers would be 7 callers, not 6. The **decision** is unaffected: three non-writers
  would still be dragged in. Corrected here rather than quietly, per C17's precedent.)*

**Judgement call, recorded honestly**: a reasonable person could scope the drain to `workspace.save`
alone — that is what #86 reproduced, and the other three have no RED test. That option was rejected
because FR-010 says *"every exit path … MUST drain pending deferred writes"* in the plural, and the only
thing that ever made it read as singular was a Key Entity claim that turns out to be false. The narrower
option would also mean writing "the drain is complete" while knowing three writes it does not cover.
T015a adds the missing coverage rather than leaving the widening untested. (**C20** corrects this
entry's picture of the preferences window — at most **one** of those three writes is ever pending — but
not this trade-off: the drain still widens beyond `workspace.save`, and it still needs a test.)

---
**C20 — The preferences window has at most ONE pending write, and the drain reaches it through a
registered flush, not through three named ones.** (Corrects C19's *model* of the preferences window.
C19's decisions — widen the drain, make each flush awaitable, leave the shared helper alone — all
stand; what was wrong is how the window was pictured.)
C19 was derived by counting `void writeConfig` call sites, which is why every one of its anchors is
exact — and why it never asked the two questions that matter:
1. **Can the three preferences writes be pending at once? No — see C21 for the one exception.**
   `preferences-app.tsx:273-288` renders **exactly one tab** (a ternary chain), and reaching another tab
   **unmounts** the previous one, firing its unmount flush — which runs the write body **synchronously**
   (`write-config.ts:116-121`). So at most **one** preferences write is ever pending. C19's *"destroyed
   with three pending writes"* is an unreachable state, and a RED test asserting it would fail for a
   mechanism its author had not understood — which is not "observed failing for the right reason", and
   so is no RED test at all.
2. **Can a window-level handler reach those flushes? Not today.** `flushSave` is reachable because it
   lives on a **context provider**; `apply` (`settings-tab.tsx:70`), `writeTheme` (`themes-tab.tsx:295`)
   and the JSON tab's `apply` (`json-tab.tsx:52`) are component-local `useMemo` values with no context,
   no registry, no ref. A **return type change** does not create a seam. *(C20 proposed a provider to
   build one; **C22 supersedes that** with the write module itself, and under C22 no seam is built and
   no `useMemo` is ever reached — the module is. Retained as history, not as authority.)*

The decisions:
- **The drain awaits whichever writer the mounted tab owns** — one flush, not three. "All three" was
  never a reachable state; the honest statement is *"the pending write, if there is one"*.
- **The seam is a context provider**, following the **precedent that already works** for exactly this:
  `WorkspaceProvider` is why `flushSave` is reachable at all. A `PreferencesDrainProvider` in
  `preferences-app.tsx` exposes `register(flush)`; the mounted tab registers on mount and deregisters on
  unmount; the drain handler awaits whatever is registered. A tab that registers nothing drains nothing,
  which is correct rather than a special case.
- **The remaining defect is real and unchanged**: an unmount flush does not run when the window is
  **destroyed** in the close cascade (the `:88-90` caveat), and even when it does run it **drops the
  promise**, so the write can still be in flight at destroy. That is #86 on the preferences path, and it
  is what T015a proves and T017a/T019 fix.
This entry is the third time in this session that a confidently-written claim turned out to be a count
nobody had modelled. That is the feature's own thesis, applied to its own artifacts. (It was not the
last: **C21** corrects C20's own premise, which was derived by reading two of the three tabs.)

**C21 — C20's "at most one pending" is false today and stops mattering under C22; and the drain must
also settle a write already in flight from an unmounted tab.** *(This heading first read "true only
after T017a". Under T017a as it now stands it is false after it too — the unmount cleanups are deleted
and the module's armed timers survive unmount — which is exactly the body's own conclusion: it is "not a
property anything establishes" but "a premise the design **stopped needing**".)* (Qualifies C20's premise and closes the gap it left. No
decision in C19 or C20 is reversed — both are made *true* by the tasks they already name.)
Two corrections, both found by asking of C20 the question C20 asked of C19: *was this counted, or
asserted?*
- **The premise is false for the JSON tab — today.** C20 argued "at most one" from *"switching tabs
  unmounts the previous one, firing its unmount flush"*. That is true of the settings tab
  (`settings-tab.tsx:115`) and the themes tab (`themes-tab.tsx:302`) — and **false of the JSON tab**,
  which C19's own table records as having **"nothing — no flush at all"**. Its only `cancel` sits inside
  `reload` (`json-tab.tsx:108`). So leaving the JSON tab — by tab switch, or by the mode toggle at
  `preferences-app.tsx:225` — orphans an **armed 300 ms timer** that still fires `void writeConfig(…)`,
  and a JSON write **can** be pending alongside the newly-mounted tab's write. C20 read two tabs and
  generalised to three.
  ~~**The decision stands, because T017a already fixes it**: it gives the JSON tab the unmount flush its
  siblings have.~~ **SUPERSEDED by C22 (recorded in C24)**: T017a builds the module registry instead, so
  the orphaned timer is caught without any unmount flush, and the two existing cleanups are deleted
  rather than joined by a third. *"At most one pending"* is therefore not a property anything
  establishes — it is a premise the design **stopped needing**, which is why C22 is the fix and this
  bullet is history. T015a's prohibition is unaffected: settings and themes really are mutually
  exclusive, both flushing on unmount, which is why it drives Themes.
- **An in-flight write from an unmounted tab is owned by the window and not drained.** The Key Entity
  promises the drain covers *"every deferred write **that window owns**"*. It does not: an unmount flush
  runs the body synchronously but the `() => apply.flush()` cleanup **drops the returned promise**, so a
  tab unmounted moments before the close leaves a `writeConfig` in flight that no handler can await —
  the drain acks with it unsettled. Narrow (an IPC-latency window), but it is precisely the "acks having
  drained nothing" class T017a exists to refuse, and an accepted limit invented to excuse it would be
  the *"we widened the timer"* move FR-011 condemns.
  **Decision: `PreferencesDrainProvider` owns the unmount flush.** The tab registers its flush on mount;
  the provider's deregister **runs it and retains the promise** in a `settling` set until it resolves,
  and the drain awaits the registered flush **plus** everything still settling. This also deletes the
  **two** copies of `useEffect(() => () => x.flush(), [x])` (`settings-tab.tsx:115`,
  `themes-tab.tsx:302`) in favour of one (DRY, Principle VIII). *(This bullet first said "three copies …
  a fourth copy", inferring one cleanup per writer and contradicting C19's own table two entries above,
  which records the JSON tab as having **"nothing — no flush at all"**. There are **two**; the JSON tab's
  would be a **third**. Corrected per C17's precedent rather than quietly. **C22 supersedes the provider
  itself** — see below — but the DRY argument survives at 2→1 either way.)*

**C22 — Stop enumerating the writers. The drain settles the write *module*, not a list of components.**
(Supersedes C20's and C21's *mechanism* — the per-tab `PreferencesDrainProvider` — while keeping every
**decision** C19/C20/C21 made: the drain still covers every deferred write a window owns, each write is
still awaited, and the shared `debounce` helper is still not touched. C1–C14 remain untouched.)

**The evidence that this is the right shape is this session's own record.** Three consecutive attempts to
enumerate the preferences writers produced three wrong models, each verified wrong only by the next pass:
- **C19** counted four writers but claimed the Key Entity's "only one" was the sole error.
- **C20** derived "at most one pending" from **two** of the three tabs it knew about.
- **C21** fixed the JSON tab's *unmount* and asserted the problem closed — but `JsonTab` **does not
  unmount** on a tab switch: `preferences-app.tsx:273-288` renders `{mode === 'json' ? <JsonTab
  docId={…}/> : …}`, so while `mode === 'json'` a tab switch re-renders **the same instance** with a new
  `docId`. `apply` is `useMemo(…, [docKey])` (`json-tab.tsx:52-74`), so a `docKey` change mints a **new**
  debounce and **orphans the previous one's armed timer**, which still fires `void writeConfig(oldDocId,
  v)`. No unmount ⇒ no unmount flush ⇒ T017a never runs on that path.
- And all three missed a **fourth tab**: `KeybindingsTab` writes at `keybindings-tab.tsx:117`. C19
  excluded it for not being debounced — but **C21 changed the test** from *"is a write pending?"* to
  *"is a write in flight and owned by this window?"*, and under the new test a rebind followed
  immediately by a close is the same drop, the same owner, and the same exposure C21 refused to accept
  as a limit.

A design whose correctness depends on an accurate list of components is a design that will be wrong
again the next time someone adds a tab. **So do not keep a list.**

**Decision**: every config write already goes through **one chokepoint** — `writeConfig`
(`write-config.ts`). How many callers it has is **not a fact this design depends on**, which is the
entire point; C23 records what happened when this entry nonetheless asserted a number. Put the drain
there:
- `writeConfig` retains each in-flight promise in a **module-level set**, removing it on settle. This
  covers **every** write the window owns — debounced, undebounced (`KeybindingsTab`), orphaned
  (`json-tab`'s stale `apply`), and any writer added later — **without naming any of them**. *(**C26**:
  that set **already exists** — `writeChains` (`write-config.ts:24`), the per-doc in-flight tail map
  issue #50 added. `settleConfigWrites()` **awaits it**; it builds no second copy.)*
- A `debouncedWrite(id, ms)` helper in the same module registers its armed timer in a module-level
  registry. Each reachable debounced writer uses it instead of hand-rolling `debounce(() => void
  writeConfig(…))`. The **shared `debounce` helper keeps its signature** (C19) — its search-input
  callers write nothing and are untouched. *(**C25 supersedes this signature**: `debouncedWrite(id, ms)`
  **cannot express `writeTheme`**, whose id comes from the payload at fire time. It is
  `scheduleWrite(id, json, ms)`, debounced **per `ConfigDocId`**. The decision — put the debounce in the
  module — is unchanged.)*
- `settleConfigWrites(): Promise<void>` flushes every armed write, then awaits every in-flight promise.
  The drain handler calls **that one function**.
**Consequences**: the `PreferencesDrainProvider` C20/C21 proposed is **not built** — there is nothing to register,
because the module already knows. No per-tab seam, no `useMemo` identity to track across a `docKey`
change, no stale registration, no fourth-tab omission. The two `useEffect(() => () => x.flush(), [x])`
cleanups can go (Principle VIII), and "at most one pending" stops being a **premise the design relies
on** — it becomes an observation that is merely *interesting*, because settling *n* writes is the same
call as settling one. **That is the tell that this is the right fix**: the three findings above all
existed only because the design needed the count to be right.
This is also, exactly, the feature's own thesis — *"it closes a class, not a capability"* — applied to
the story about closing a class. Three passes were spent enumerating instances of a defect whose
chokepoint was in scope the whole time.

**C23 — The drain names no windows either. `settleConfigWrites()` runs in every window,
unconditionally.** (Completes C22 by applying C22's own argument one level up. No decision is reversed;
this removes the last enumeration.)
C22 said *"stop counting the writers"* — and then counted them: *"all four writers call it; a fifth
would too."* There are more call sites than that, in more files — **C24 records that this entry's own
replacement count ("six call sites, in five files") was wrong too**, which is why neither number appears
here any longer. What matters is not how many there are but which ones nobody named, and the two that
went unnamed are the two that mattered:
- **`projects-panel.tsx:208`** — `void writeConfig({kind:'settings'}, …)`, undebounced, promise dropped
  — and `ProjectsPanel` is rendered by `app.tsx:493`, in the **workspace window**. C22's task and
  contract both gated `settleConfigWrites()` on *"in a **preferences** window"*, so the workspace
  window's drain would await `flushSave()` only and **ack with this write in flight** — the exact
  exposure C21 refused to accept as a limit, shipped inside the fix for it.
- **`preferences-app.tsx:176`** — `revertAll`'s per-entry `void writeConfig(…)`, never named anywhere.
  C22's design already covers it **at zero cost**, which is C22 working exactly as intended.
That is the count wrong a **fourth** time, and the fourth time it cost real coverage — not because
anyone was careless, but because a design that mentions a number invites the reader to trust it.
The decisions:
- **Drop the window condition.** The drain handler does `await Promise.all([flushSave(),
  settleConfigWrites()])` in **every** window. T019's own sentence already licensed this — *"a window
  with nothing pending settles immediately — correct, not a special case"* — it simply was not applied
  to windows. The module set is per-renderer-process, so it costs nothing where there is nothing
  pending, and it needs no one to know which windows host which writers.
- **Strike the counts.** No artifact states how many writers, call sites or tabs there are, except where
  it is recording *this history*. The rule replacing them: **every config write goes through
  `writeConfig`; every window settles it; nobody counts.**
The lesson is now cheap enough to state in one line, and it is the feature's own: **a claim that must be
recounted whenever the code changes is not a design — it is a liability with good intentions.** Four
recounts in one session is the evidence.

**C24 — The tallies are deleted, not corrected. (And the fifth and sixth miscounts, one of them in the
entry that said "strike the counts".)** (Final entry in the C19–C24 chain. Reverses nothing: the drain
built by C22/C23 is unchanged and needed no tally to begin with — which is the point that took six
attempts to land.)
C23 said *"strike the counts"* and then asserted one: *"six call sites, in five files"*. Measured:
**eight** `writeConfig` call sites across **six** files, or six `void`-dropped sites across six files
under the reading C23 meant — wrong under either. And the tally C19 established, repeated verbatim in
six documents and painstakingly made **consistent** by a later repair pass, is itself false:
- **"Four deferred writes" is wrong: there are three.** The Preferences **apply client's 250 ms
  debounce is unreachable**. `applyDebounced` (`apply-client.ts:33`) has **zero callers** in src or
  tests; every apply-client write goes through `applyNow` (`:29-32`), which **cancels** the debounce and
  writes immediately — `settings-tab.tsx:119`, `themes-tab.tsx:312/404/438/449`, each `void`-dropped. So
  the apply client is an **undebounced** dropped promise (the `keybindings-tab.tsx:117` class), not a
  deferred write; and `settings-tab.tsx:115`'s unmount flush has always flushed **a debounce that can
  never be armed**. The reachable debounced writes are `workspace.save` (400 ms), `writeTheme` (150 ms)
  and the JSON tab's apply (300 ms).
- **None of this changes the design.** C22/C23's module set covers `void apply.applyNow(…)` exactly as
  it covers everything else — no edit is needed to the drain, which is the strongest possible evidence
  that C22/C23 are right and that every tally in this chain was decoration on a design that never used
  it.
The decisions:
- **No artifact states a tally of writers, call sites, tabs, windows, or deferred writes** — except
  where it is recording *this history*, as here. Where a list is genuinely useful (a task's edit list),
  it is written **as a list of sites to change**, never as a number to trust. The rule stands as C23 left
  it: *every config write goes through `writeConfig`; every window settles it; **nobody counts**.*
- **`applyDebounced` is deleted** (YAGNI / Principle VIII), on `WindowsDeElevator`'s precedent (T060):
  it is unreachable code whose only effect has been to make four analyses describe a debounce that
  cannot fire. T017a converts the **reachable** debounced writers only — converting dead code to
  `scheduleWrite` (C25) would have been the sixth recount's parting gift.
- **C19's "the JSON tab gains the unmount flush its three siblings have" is SUPERSEDED** (and *"three
  siblings"* was always two). C22 said it kept every C19–C21 *decision*, and that was too broad: under
  C22 the orphaned timer is caught by the module registry, so a JSON-tab unmount flush is **redundant**,
  and T017a deletes the other two rather than adding a third. No task implements it because none should.
**Why this entry exists rather than a seventh correction**: every count in this chain was found wrong by
the same question — *was this counted, or asserted?* — and each answer was patched into the next
assertion. The only move that ends it is to stop asserting. If a future reader wants a number, they
should run the grep; the design will not care what it returns.

**C25 — The debounced write is keyed by `ConfigDocId`: `scheduleWrite(id, json, ms)`, not a per-writer
factory. And `ApplyClient` shrinks to `{ applyNow }`.** (The first entry in this chain that is **not**
about counting. It settles the shape of C22's `debouncedWrite`, which the first reader to try to
implement it would have found impossible.)
**`debouncedWrite(id, ms)` cannot express `writeTheme`.** The id C22 wanted bound at *creation* is, in
`themes-tab.tsx:295-302`, derived from the debounced **payload at fire time** —
`writeTheme({ name: activeNameRef.current, theme: next })` → `writeConfig({kind:'theme', name:
doc.name}, …)` — and the instance is memoised `[]`, one for every theme. T017a ordered that conversion
*and* ordered **018 FR-023**'s captured-at-edit-time guarantee kept "exactly as it is". **Both cannot
hold.** That guarantee is load-bearing and hard-won (018's own comment: *"a Clone within the debounce
window would otherwise land theme A's pending document in theme B's file"*), so the contract bends, not
the guarantee.
The decisions:
- **`scheduleWrite(id: ConfigDocId, json: string, ms: number)`** — a module-level function, **no
  factory, no instance, no `useMemo`**. *(**C26 corrects the signature**: the payload is a **thunk**,
  `produce: () => string | null`, evaluated at fire time — this entry asked what `writeTheme` does and
  never asked what `json-tab` does. The per-id keying below is unaffected.)* It debounces **per `id`**: a pending write for theme A is keyed
  to A and a later call for theme B is keyed to B, so **neither displaces the other**. This *is* 018
  FR-023's guarantee, enforced by the write module rather than by a comment and a payload convention —
  strengthened, not preserved.
- **It dissolves the orphan C21 spent an entry on.** `json-tab`'s `useMemo(…, [docKey])` existed to give
  each doc its own debounce, and minting a new one is what stranded the old one's armed timer. With
  per-id keying there is no instance to mint and no timer to strand: `scheduleWrite(docId, v, 300)` at
  the call site, and the module keys it. The bug C21 identified stops being possible rather than being
  caught.
- **`ApplyClient` becomes `{ applyNow }`.** C24 deletes `applyDebounced` and its debounce; `flush()` and
  `cancel()` are nothing but `debounced.flush()` / `debounced.cancel()`, `cancel()` has no callers at
  all, and `flush()`'s only caller (`settings-tab.tsx:115`) is deleted by T017a. Leaving them is not a
  smell but a **compile error** — `tsc -b` covers the renderer as of `87e28a9`. Same YAGNI / Principle
  VIII precedent as `applyDebounced` and `WindowsDeElevator` (T060).
  **And `createApplyClient`'s `debounceMs = 250` parameter goes with them** (`apply-client.ts:23`): it
  exists only to size the deleted debounce, **no caller passes it** (`settings-tab.tsx:70`,
  `themes-tab.tsx:115`), and an unused parameter is a **lint error** under the v3.13.0 zero-error gate
  T062 enforces. Recorded here because T017a orders it: a task performing a deletion no clarification
  authorises is the precise drift this feature exists to close, and it would be a poor joke to commit it
  in the entry about deletions.
**What this says about the chain**: C19–C24 spent six entries on *how many* writers there are, and the
first entry to ask *what the writers actually do* found that the replacement API could not express one
of them and that a deletion would not compile. Counting was never the hard part.

**C26 — `scheduleWrite` takes a thunk, not a string; `cancelWrite(id)` exists; and the in-flight map is
the one already in the file.** (C25 asked *what does `writeTheme` do?* and never asked it of the other
two writers. This asks it of all of them, and of the module itself.)
Three findings, each fatal to T017a as C25 left it:
- **`scheduleWrite(id, json, ms)` cannot express `json-tab`'s apply.** Its debounced body
  (`json-tab.tsx:52-76`) is **not** `() => void writeConfig(…)`. It parses the buffer, and **on failure
  sets `setInvalid(true)` and returns *without writing*** (007 FR-017); on success it records
  `lastAppliedRef` in the write's **canonicalised** form (the watcher-echo suppression that stops the
  buffer being reflowed under the user's cursor, `:63-67`), clears `dirtyRef`, resolves the external
  conflict (`setExternal(null)`, 007 FR-041), **then** writes. A finished `json` string parameter forces all
  of that to the call site — per keystroke — where `dirtyRef = false` before the write lands breaks
  007 FR-041, and **an unparseable buffer would be written to the config file**. Shipping *"invalid JSON
  reaches disk"* inside this feature would be beyond parody.
  **Decision: `scheduleWrite(id, produce: () => string | null, ms)`.** The thunk is evaluated **at fire
  time** and **`null` means "do not write"** — so json-tab's body moves **unchanged**, invalid stays
  unwritten, and the echo-suppression and dirty/external bookkeeping keep firing exactly when they do
  today. `writeTheme` is unaffected: its id is already correct **at call time** (`activeNameRef.current`
  *is* the captured-at-edit-time target — C25's per-id keying and 018 FR-023 both hold).
- **`cancelWrite(id)` is required, and C25 deleted the only thing that could do it.** `json-tab`'s
  `reload` calls `apply.cancel()` (`:108`) for a stated reason — *"a debounced apply of the edit we are
  abandoning must not fire afterwards and silently write it back over the document we just adopted"* —
  and **C21 cited that very line** while arguing about orphaned timers. C25's "no factory, no instance"
  left nothing to cancel, and T017a's own "deregistered on fire **or cancel**" named a cancel the API
  never had. Add `cancelWrite(id)`. Without it, adopting an external change **silently clobbers it with
  the edit you just abandoned** — a silent config write-back, in the sweep against silent write-backs.
  It is guarded green today (`preferences-json.e2e.ts`), which is exactly how it would have been caught.
- **The "new" module-level in-flight set already exists.** `writeConfig` keeps **`writeChains`**
  (`write-config.ts:24`) — a module-level `Map<docKey, Promise>` holding each doc's in-flight tail,
  chained per document (issue #50: two writes to one file are not commutative) and deleted on settle
  when last-standing (`:74`). **`settleConfigWrites()` awaits `writeChains.values()`**; it adds **no**
  second copy of state the module already maintains. C22–C25 called the chokepoint *"the story's only
  new construct"* — half of it was already built, in the file they were all pointing at. (Principle
  VIII, which this feature's own Constitution Check invokes.) What is genuinely new is small: the armed
  **timer** registry, `scheduleWrite`, `cancelWrite`, `settleConfigWrites`.
- **"Every config write drops its promise with `void`" is false**, and it was asserted in four
  artifacts. `themes-tab.tsx:432` **awaits** its write; `apply-client.ts:31` **returns** it. Harmless —
  the chain map covers awaited writes too, because it never asked — but it is an unmeasured universal in
  the documents whose thesis is that unmeasured claims are the defect. C24 struck the counts; this one
  survived **because it is a word, not a number**. Corrected to what is measured: *every write is
  covered, `void`-dropped or awaited; the module does not distinguish.*

**C27 — `failAllLive` must emit a NON-ZERO exit, and the `@admin` run injects budgets that fit its own
deadline.** (US3's turn to be asked *"was this counted, or asserted?"* — the question C19–C26 only ever
asked of US2. Both answers were asserted.)
- **`failAllLive` does not do what four artifacts say it does.** Research §3, the readiness contract,
  data-model §4's state machine and T025 all state that it *"already"* surfaces `[throng] …` on `onData`
  **plus a non-zero `onExit`**. **Measured: it fires `cb({ code: null })`** (`pty-agent-host.ts:82`). The
  non-zero exit belongs to the **`ev:'error'`** branch (`cb({ code: 1 })`, `:127`) — the one research
  cites *separately* to "prove the shape". So Route 1 (T025, via `failAllLive`) would emit `code: null`
  while Route 2 (T026) is ordered to emit "a non-zero exit": **two exit shapes for one FR-012 outcome**,
  in four documents, unnoticed.
  **Decision: `failAllLive` emits `code: 1`.** The `error` branch's own comment says why — *"surface it
  as output + a non-zero exit **so the Panel reverts with a visible message** (005 FR-019), never a
  silent blank"* — and FR-012 requires exactly that: *"a **visible**, actionable failure to the panel"*.
  A `code: null` exit is the shape of an ordinary end, not a failure, so routing FR-012 through it risks
  satisfying the letter of "reaches the failure path" while missing the outcome the requirement names.
  **This weakens no test**: nothing anywhere asserts `code: null`, and the RED test asserts only
  `exits.length > 0` (`:114`, `:182`) — which is why nothing caught the contradiction. One outcome, one
  shape, and T025/T026 now agree.
- **The `@admin` test's budget is 25s, not 30s.** `terminal-de-elevation-hang.e2e.ts:33` sets
  `LAUNCH_BUDGET_MS = 25_000` and, on lapse, reports *"it hung (#94)"* — **the very failure it exists to
  detect**. The stated worst case is connect 15s + readiness 15s = **30s** (C7), so a pathological
  connect-at-14s followed by no ack would surface at ~29s and be reported as a hang. The test may not be
  rewritten (T054 is the one sanctioned amendment), and it has **never been executed**, so this is
  latent rather than observed.
  **Decision: T033 injects smaller budgets for that run** — `THRONG_AGENT_CONNECT_TIMEOUT_MS=8000` and
  `THRONG_AGENT_READY_TIMEOUT_MS=8000`, worst case 16s, comfortably inside 25s. This needs **no test
  change and no second amendment**: the budgets are injectable precisely because C7/T023 made them so,
  and **T031a is what carries them across the UAC hop**. Production defaults stay 15/15 (C7 untouched) —
  only the elevated run, which is measuring *whether a failure surfaces at all*, tightens them.

**C28 — `failAllLive(reason, code)` takes the exit code. The lapse passes `1`; the crashed-agent path
keeps `null`.** (C27 asked *what does this helper do?* — and asked it only of the caller it was adding.
This asks it of the caller that was already there.)
**`failAllLive` has two callers, and C27 changed both.** The one it meant is T025's new
connect-deadline lapse. The one it did not notice is **`:63` — the `close` path**,
`failAllLive('the terminal agent stopped unexpectedly')`: a **crashed** agent. Changing the helper's
body to `code: 1` changes that path's output too, and it is **user-visible**: `terminal-panel.tsx:158`
renders ``Terminal exited (code ${code ?? '—'})``, so a crashed agent's panel would go from **"Terminal
exited (code —)"** to **"Terminal exited (code 1)"**.
That is a **regression in honesty**, and precisely the kind this feature exists to prevent: when an
agent crashes, throng genuinely **does not know** the exit code, and `null` — rendered "—" — is the
truthful answer. Inventing a `1` there would be the panel *being lied to* by its own daemon, which is
the exact sentence this spec uses to describe #94.
C27's *"this weakens no test"* is true and was verified — nothing asserts the code — but **"weakens no
test" is not "changes no behaviour"**, and that gap is where a shared helper's second caller lives.
The decisions:
- **`failAllLive(reason: string, code: number | null)`.** T025's lapse passes **`1`** (FR-012's visible,
  actionable failure — the `ev:'error'` branch's shape, for the reason its comment gives). The `close`
  path at `:63` passes **`null`**, and its behaviour is **byte-for-byte unchanged**.
- **The anchor was wrong too, in a way that hid this.** T025 said *"the `close`-path relaunch
  (`:63-65`) stays exactly as it is"* — inviting the reader to believe `:63` is untouched. `:63` **is**
  the `failAllLive` call; the relaunch is **`:64-65`**. A reader checking C8's "no relaunch" decision
  would have read straight past the line C27 was about to change.
- **No test moves**, and none needs to: the crashed-agent path is unchanged, and the lapse path's shape
  is asserted only as `exits.length > 0`.
**The lesson, now that it has happened twice**: C19–C26 asked *"how many are there?"* and were wrong
every time; C27 asked the better question — *"what does it do?"* — and still got it wrong, because it
asked only about the caller it was writing. **A shared helper has callers you did not come for.**

**The pattern, stated once more and then acted on**: every entry from C19 to C28 was found by asking of
the previous one *"was this counted, or asserted?"* — and C26 is the third to find that the *design*, not
just the tally, had been asserted. **T017a's blast radius has run no neighbour guard for seven
passes**; `write-config-ordering.test.ts` guards the very function being modified, and no US2 task named
it. T021a fixes that, and it is what would have caught all three of these mechanically instead of by a
seventeenth reading.

### Session 2026-07-17 (adopted after the adversarial review — four items in, #67 out)

These six clarifications record the decisions taken when the developer folded #120, #121, #122 and #124
into the feature and pulled #67. Unlike C19–C28, none of these corrects a miscount — the code for all
four was **already written and green** when they were adopted, so each entry records the decision the
implementation embodies, anchored to the test that pins it. **No C1–C28 decision is reversed.** C33
(the #67 pull) and C34 (#94's honest state) are the two a reviewer should re-open deliberately if the
developer disagrees.

**C29 — #120's stuck state is fixed at the root: an *unloaded* folder is made distinguishable from an
*empty* one, move migrates open-state by prefix, and a self-heal effect reconciles the two open
signals.** (Resolves the "open-but-empty" wedge #120 reports.)
`build(dir)` returned `childrenMap.get(dir) ?? []` (`use-explorer-data.ts:245`), so react-arborist's
`isLeaf = !Array.isArray(children)` read an unloaded folder as an *open internal node with no children*
— chevron open, glyph 📂, nothing shown, and no `onToggle` to trigger a load because `open()`
early-returns when already open. Three decisions, each embodied in the shipped fix:
- **A move migrates the open-map entries by path prefix**, so the expansion state follows the folder to
  its new path rather than being orphaned there. This is the direct analogue of US1's move-signal for a
  different piece of id-keyed state.
- **A self-heal effect loads any folder react-arborist reports open whose children are not present**, so
  the chevron and glyph can never disagree with reality for longer than a load takes — including the
  stale-entry case where a folder is dragged **back** to a path it once occupied.
- **The `?? []` collapse is the true root fix and is worth it on its own merits**: *any* stale open-map
  entry (drag, or the persisted `expanded` list restored from localStorage) reproduces the wedge, so
  distinguishing unloaded from empty closes the class, not just the drag symptom. This is the same
  "unloaded ≠ empty" principle #120's body argues for.

**C30 — Only the chevron toggles a folder; the glyph stays a state indicator; the chevron becomes a
real control but is not a tab stop. This supersedes feature 004 FR-028.** (Resolves #121, a deliberate
*requirement reversal*, not a defect.)
004 FR-028 said *"Clicking a folder MUST toggle its expansion"*, and the code honoured it by putting the
`onClick` on the whole row. #121 changes that intent. The decisions:
- **The chevron is the sole toggle affordance.** Clicking the folder **name** (or the folder **glyph**)
  selects only. This is what `explorer-tree-state.e2e.ts` test (2) asserts: the chevron toggles open then
  closed; a name-click selects the row and, after a 400 ms settle, has **not** expanded it.
- **The folder glyph keeps swapping 📁 / 📂 with open state** but stops being a click target. It is a
  *state indicator*, never an affordance — the honest division of labour the issue asks for.
- **The chevron is promoted to a real control**: a hover affordance so its intent is discoverable,
  `aria-expanded`, an adequate hit target, and a stable testid `tree-twisty-<path>`. But its
  **`tabIndex` is `-1`** — deliberately *not* a keyboard tab stop. A tab stop per folder would make the
  tree unwalkable by keyboard on a large project; the keyboard toggle therefore **stays on row-Enter**
  (`file-tree.tsx:292-293`, unchanged), which is the one place a keyboard user already is. Discoverable
  by mouse, operable by the existing keyboard path, and not a new tab-stop tax — the three pull in the
  same direction only if the chevron is a control that Tab skips.
- **004 FR-028 is marked superseded** (see 004's spec) and this feature's FR-032/FR-033/FR-034 are the
  replacement. The root row still renders no twisty and never collapses.

**C31 — #122's "must not open an editor" half is a regression guard, not a live defect; the live defect
is the lost selection.** (Resolves the two-part #122 report by separating what reproduces from what does
not.) Measured during reproduction: rename fires **`openIntents: 0`** today — nothing opens an editor on
rename (`file-tree.tsx:287` guards `INPUT`). So the fix's only live obligation is to **re-select the
new path** after the id (the relPath) changes; the "does not open an editor" clause is a **guard that
the re-selection must not introduce** that behaviour, not a bug being cleared. `explorer-tree-state.e2e.ts`
test (3) pins both halves in one assertion — `renamedRowSelected: 1, totalSelectedRows: 1,
openIntents: 0` — with `openOnClick: 'none'` isolating the rename from the preceding click, so any open
intent seen could only have come from the rename itself. react-arborist's own `create()` re-selects
after an id change and `submit()` deliberately does not, i.e. re-selecting after a rename is explicitly
the consumer's job.

**C32 — #124's wrap is fixed app-side with `white-space: nowrap` and a 14px glyph; no theme file is
touched.** (Resolves how to unwrap the UI⇄JSON toggle without editing fifteen themes.)
The `editJson` glyph is the literal `'{ }'` (`theme.ts:331`), identical in every theme; it wraps only in
the five whose `fontFamily` is monospace, where a fixed-width `{ }` overflows the 16px `.icon` box
(feature 018's `.icon` sizing overrides the toolbar's 14px) and the browser breaks at the interior
space. The glyph is a **rendering artefact of the icon box**, not a property of any theme, so the fix
belongs in the app stylesheet — `.prefs-toolbtn--icon .icon { font-size: 14px; white-space: nowrap; }`
— and **not** in the theme files. `preferences-themes.e2e.ts` asserts the contract font-metric
independently: for each of the five monospace themes (Windows Terminal, Bash, VI-VIM, Matrix,
Cyberpunk) the glyph computes `white-space: nowrap` and occupies exactly **one** line box. Editing
themes was rejected because the glyph is shared across all of them and the defect is the box, not the
palette — a per-theme edit would be fifteen changes to fix one CSS rule, and would miss `THRONG_THEME`.

**C33 — #67 is pulled to vNext; the three terminal-flavour controls are hidden for v1.0.0, not built;
US4's flavour-editing FRs are superseded-for-v1.0.0, and C14's incidental `defaultParams` fix is hidden
with them.** (Reverses this feature's decision to *build* #67's controls; it does not reverse C9–C17,
which describe the vNext target and remain the design of record for it.)
Building the array-of-records control (C9, C17), the detected-flavour multi-select (C10) and the
per-column validation (C12, C13) is real, and the developer chose to defer it rather than carry it into
v1.0.0. The decisions:
- **The three controls do not render.** `terminals.flavours`, `terminals.disabledBuiltins` and
  `terminals.defaultParams` are added to **`SETTINGS_INTERNAL_KEYS`** (`settings-metadata.ts:12`), and
  their descriptors are moved out of the rendered `SETTINGS_METADATA` into a dormant
  **`HIDDEN_TERMINAL_FLAVOUR_DESCRIPTORS`** export (`settings-metadata.ts:396`). This is a **hide, not a
  revert**: the tolerant parser still reads the settings from a hand-edited `settings.json`, and the
  underlying record/multiselect/map controls stay live — vNext re-exposes them by spreading the array
  back into the registry and dropping the three keys from `SETTINGS_INTERNAL_KEYS`.
- **US4 is re-cast.** US4's outcome is now "the controls do not render" (**FR-020a**), and its original
  flavour-editing requirements **FR-016 … FR-020 are marked SUPERSEDED for v1.0.0** — kept verbatim
  because they are vNext's acceptance criteria, pointed here. Their Success Criteria SC-009 … SC-011 are
  annotated the same way.
- **#67 moves to vNext and the PR no longer closes it.** The agreement recorded in Assumptions covered
  the work as scoped that day; the reschedule is a later, explicit owner decision.
- **C14's `defaultParams` text-cell fix is hidden as a consequence.** It only ever landed *incidentally*
  because the map control's text cell was being built for the flavour table (C14); with the table
  withdrawn there is nothing to render it against, so `terminals.defaultParams` is hidden with its two
  siblings and **its one regression test (T040/T041's) was removed**. The completeness rule (007 FR-047)
  is satisfied because the keys are now internal, not because a control was proven.

**C34 — #94's hang→visible-error fix (FR-012) is done and holds; the deeper de-elevation goal
(FR-014 / SC-007) is NOT met and must not be claimed.** (Records the honest state of US3 after real
testing, adjusting SC-007. Reverses no earlier decision; C7/C8/C27/C28's failure-path work stands and is
exactly what holds.)
The safety net works: when an agent will not arrive, the panel now surfaces a visible, actionable
failure within a bounded time instead of hanging — FR-012, FR-013 and FR-013a are met, tested
elevation-free in CI. **But FR-014's actual goal — an elevated throng opening a *working* non-elevated
terminal — is not achieved.** Real testing shows the de-elevated agent **launches, connects, and then
crashes**; the user reaches a fail-fast error (the FR-012 net catching it), not a working prompt.
Diagnostic logging was added (`throng-agent-<pid>.log`, per FR-015's observability requirement) and a
`cwd: null` → real-cwd fix landed, but the root cause is **still under active diagnosis pending an
elevated log**. The decision, stated plainly: **SC-007 does not pass**, US3 AC3 is not satisfied, and no
artifact may claim otherwise. FR-012 is the safety net that is in place; FR-014 is the outcome that is
not yet. SC-007 is rewritten below to say so.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A file moved inside throng takes its editor with it (Priority: P1)

A user has a file open and clean in an editor. In the File Explorer they cut it and paste it into
another folder. The file moves. The editor does not follow: it still points at the old path, and
because the watcher sees the file vanish it marks the buffer **dirty**. The user never edited
anything. If they now save — the natural response to an unsaved-changes dot — the buffer is written
back to the **original location**, re-creating the file they just moved and silently undoing the move.

After this story, a move performed from inside throng re-points every editor open on that file. The
document is the same document; only its path changed.

**Why this priority**: It is the only defect in this sweep that **destroys user work by acting on a
lie**. The dirty dot invites the save, and the save undoes the move. Every other defect in the sweep
either annoys, hangs, or does nothing.

**Independent Test**: Open a file, cut+paste it to another folder, and confirm the editor's path
follows, no dirty dot appears, and a subsequent edit+save lands at the **new** path with nothing
re-created at the old one.

**Acceptance Scenarios**:

1. **Given** a clean file open in an editor, **When** the user cut+pastes it to another folder,
   **Then** the editor points at the new path, is not dirty, and no notice is raised.
2. **Given** the same, **When** the user **drag**-moves the file instead, **Then** the outcome is
   identical — the mechanism is the same and neither entry point may be privileged.
3. **Given** a file that has been moved, **When** the user edits and saves, **Then** the content lands
   at the **new** path and no file reappears at the old one.
4. **Given** a moved file, **When** the user opens it at its **new** path from the tree, **Then** the
   existing editor is focused rather than a second buffer opened on the same file.
5. **Given** a moved file, **When** the app crashes, **Then** recovery restores the document to its
   **new** path — no snapshot strands it at the old one.
6. **Given** a folder containing several open files, **When** the folder is moved, **Then** every open
   editor beneath it re-points.
7. **Given** a file moved by **another program**, **When** the watcher notices, **Then** the buffer is
   kept, dirtied and recoverable **exactly as today**. This path is correct; the fix must not touch it.

---

### User Story 2 — Closing throng keeps the layout you were looking at (Priority: P1)

A user splits a pane, or zooms a panel, and closes the app straight away. On the next launch the
change is gone. The same user, on a day when a terminal happens to be running, closes via the
Terminate All prompt — and the change survives. The difference is not a feature: it is that reading
the prompt took them past a 400ms debounce.

After this story, a layout the user could see when they closed the app is a layout they see when they
open it, on **every** exit path, by construction rather than by timing.

**Why this priority**: It is silent, it is on the **ordinary** exit — the one every user takes every
day — and it discards a decision the user watched the app accept. It ranks below US1 only because it
loses arrangement rather than content.

**Independent Test**: Add a panel (or set a zoom), close the app the ordinary way immediately, relaunch,
and confirm the change is present. Then do the same via Terminate All and confirm it is *still*
present — a fix that drains one exit only must fail.

**Acceptance Scenarios**:

1. **Given** a layout change made immediately before an **ordinary** close, **When** the app relaunches,
   **Then** the change is present.
2. **Given** a per-panel zoom set immediately before an **ordinary** close, **When** the app relaunches,
   **Then** the zoom is present.
3. **Given** either change made immediately before a **Terminate All** close, **When** the app
   relaunches, **Then** the change is present — the asymmetry is closed from both sides.
4. **Given** a language override set immediately before **either** close, **When** the app relaunches,
   **Then** the override is present. (This holds **today**; it is a guard against a regression, not a
   fix. See the corrections above.) **Only the Terminate All half was measured** —
   `terminate-all-drain.e2e.ts:182` is the sole override test, and the two ordinary-close tests are
   layout and zoom. T015b adds the ordinary-close case rather than leaving "either" resting on a
   mechanism argument: the argument is sound (an awaited IPC onto a synchronous SQLite write, no
   debounce), but "sound argument, no measurement" is what C16 refused for SC-012 and what C18 and C19
   each cost a session to undo.

---

### User Story 3 — A terminal that cannot start says so (Priority: P2)

A user running throng elevated adds a terminal panel with the elevation box cleared. The panel sits
there. Forever. No prompt, no error, no exit — because the component that *knows* the de-elevated
agent will never arrive stops trying and tells nobody, while the daemon has already reported the
terminal as `running`.

After this story, a launch that cannot complete surfaces as a **visible, actionable failure** within a
bounded time, on any failure mode — not only the de-elevation one that exposed it.

**Why this priority**: An indefinite hang with no feedback is the worst *shape* of failure in the
sweep, and the fix — a failure path where none exists — protects against every future launch defect,
not just this one. It ranks below US1/US2 because it destroys no data and needs an elevated run to
reach.

**Independent Test**: Drive the host with a launch seam that never connects, and confirm a bounded
failure reaches the panel. This is testable **without elevation** and therefore in CI.

**Acceptance Scenarios**:

1. **Given** a de-elevated agent that never connects, **When** the connect deadline lapses, **Then**
   the terminal is reported exited and the panel surfaces a visible error.
2. **Given** an agent that connects but never reports the terminal started, **When** the readiness
   budget lapses, **Then** the same visible failure occurs.
3. **Given** an **elevated** throng, **When** the user opens a non-elevated terminal, **Then** they
   reach a working prompt. *(A fail-fast error satisfies scenarios 1–2 but must not be allowed to
   launder a pass here: the de-elevation path must actually work.)*
4. **Given** a legitimately slow shell that produces no output yet, **When** it is still starting,
   **Then** it is **not** killed — readiness is acknowledged by the protocol's `started` ack, not by
   first output.

---

### User Story 4 — The terminal-flavour settings can actually be edited (Priority: P2)

> **SUPERSEDED for v1.0.0 (see C33).** #67 was pulled to vNext on 2026-07-17. The narrative below now
> describes **vNext's** target. For v1.0.0 the three terminal-flavour controls are **hidden** rather
> than built — the live requirement is **FR-020a** and the live criterion **SC-011a** ("the controls do
> not render"; a hand-edited `settings.json` still parses). The story is retained because it is vNext's
> acceptance narrative.

A user opens Preferences to hide the built-in flavours they never use, and finds a free-text list into
which they must type an identifier from a set the app already knows — with no completion and no
validation. Typo it and nothing happens, silently. Next to it, "Custom terminal flavours" is a raw
JSON textarea: an object edited through a control designed for a list of strings.

After this story, both settings have a control that fits their shape: a multi-select over the
**actually-detected** built-ins, and a structured record table with per-field validation.

**Why this priority**: It is the only story that must **build** a control rather than send a signal, so
it is the largest, and its capability is intact — it is the editing experience that is broken. It
ranks above US5/US6 because a user hitting it today has no workable path at all.

**Independent Test**: Open Preferences and confirm neither setting presents free text or JSON, that the
built-in picker offers the detected flavours, and that a flavour missing an id or an executable — or
duplicating an id — is refused with a reason.

**Acceptance Scenarios**:

1. **Given** the Settings editor, **When** the user edits "Hidden built-in flavours", **Then** they are
   offered a multi-select over the detected built-ins and never a free-text field (007 FR-029).
2. **Given** a built-in already hidden, **When** the user opens that picker, **Then** the hidden
   built-in is **still offered** (and shown as hidden) so it can be un-hidden. Hiding is not a
   one-way door.
3. **Given** the Settings editor, **When** the user edits "Custom terminal flavours", **Then** they see
   one row per flavour with a cell per field — not a JSON textarea — regardless of whether the list is
   currently empty.
4. **Given** the flavour table, **When** the user commits a flavour with no id, no executable, or an id
   that duplicates an existing one, **Then** it is refused with a stated reason.

---

### User Story 5 — Every setting shown does something (Priority: P3)

A user wanting single-click file opening finds "Open files with" under **File Explorer**, sets it to
`single`, and nothing happens. The setting that works is a different one, under **Editor**, with an
overlapping description. The user cannot tell whether they have found a bug or two settings whose
use-cases nobody explained.

After this story, exactly one setting governs which file-tree click opens a file, and a control
rendered in Preferences does something when changed.

**Why this priority**: It wastes trust rather than data, and its fix is small. But it is the one defect
here that the user can *see themselves* being lied to about.

**Independent Test**: Confirm exactly one of the two settings is rendered, and that every rendered
claimant is read by production code outside the config layer.

**Acceptance Scenarios**:

1. **Given** Preferences, **When** the settings are enumerated, **Then** exactly one control claims the
   file-tree open-on-click job.
2. **Given** that surviving control, **When** the user changes it, **Then** the file-tree click
   behaviour changes accordingly.
3. **Given** a user whose `settings.json` carries the retired key, **When** the app loads, **Then**
   the key is ignored and stripped on the next write, **their current behaviour does not change**, and
   nothing is reinterpreted into an intent they never expressed (see FR-023). No warning is raised,
   because there is nothing to warn about: the key has never had any effect, so dropping it is the
   option that preserves exactly what the user experiences today — see C1 for the reasoning.

---

### User Story 6 — A theme cannot ship code you cannot read (Priority: P3)

A theme author adds a syntax colour. Nothing measures it against the background it is painted on. The
build is green. Today the shipped themes are legible anyway — but only because a helper deep in theme
construction lifts every seed to 6:1 on the editor body. Nobody chose that as a guarantee, nothing
states it, and one hand-authored theme bypasses the helper entirely.

After this story, every colour the editor paints code with is measured against the background it is
painted on, and the pairing list is **derived from the token set** so a future token cannot be added
without being measured.

**Why this priority**: It is latent — there is no live symptom to fix (see the corrections). It is
worth doing because the ten tokens that escaped are proof the hand-written list *will* be missed
again, and because the property currently holds by accident.

**Independent Test**: Add a syntax token that is deliberately illegible on `editorBg` and confirm the
suite fails. A derived list catches it; a hand list cannot.

**Acceptance Scenarios**:

1. **Given** the token set, **When** the contrast pairings are built, **Then** every `syntax*` token is
   measured against `editorBg` at the body-text threshold.
2. **Given** a **new** syntax token added later, **When** the suite runs, **Then** it is measured
   without anyone having edited the pairing list.
3. **Given** a theme that fails the new pairings, **When** the build runs, **Then** the build **fails** —
   not a report nobody reads.
4. **Given** the deliberately low-contrast themes (Matrix, VI-VIM, Gothic), **When** the guard runs,
   **Then** they are not treated as defective — consistent with #61's policy.

---

### User Story 7 — A folder keeps its open state when it moves, and its chevron never lies (Priority: P2)

A user expands a folder in the File Explorer and drags it into another folder. It arrives closed — the
expansion is lost. Worse: drag it **back** to a path it was once expanded at and it renders **open** —
chevron open, glyph 📂 — with **no children shown**, permanently, because a stale open-map entry keyed
by the old path now applies to it while nothing has loaded its contents. The chevron says one thing and
the tree shows another, and clicking the chevron cannot recover it.

After this story, a folder moved inside throng keeps its expansion state, and a folder's chevron and
glyph **always agree** with whether its children are actually shown — because an *unloaded* folder is
made distinguishable from an *empty* one at the root.

**Why this priority**: It is the same defect class as US1 (#87) — id-keyed state stranded by a path
change — and it can leave the tree in a **stuck, unrecoverable** open-but-empty state, not merely a
transient annoyance. It ranks below US1/US2 because it strands view state, not user content.

**Independent Test**: Expand a folder, drag it into another folder, and confirm it stays expanded
(children visible, chevron open, glyph 📂). Then drag it back to a previously-expanded path and confirm
the chevron, glyph and visible children all agree — no open-but-empty wedge.

**Acceptance Scenarios**:

1. **Given** an expanded folder with a visible child, **When** it is dragged into another folder,
   **Then** after the watcher-driven re-read settles it is still open — child visible, chevron open,
   glyph 📂. (`explorer-tree-state.e2e.ts` test (1).)
2. **Given** a folder that was expanded at a path, moved away, and then dragged **back** to that path,
   **When** the tree settles, **Then** its chevron/glyph and its actual children **agree** — it shows
   its child rather than rendering open-but-empty. (`explorer-tree-state.e2e.ts` test (1b).)
3. **Given** any stale open-map entry for a path (from a drag, or the persisted `expanded` list restored
   from localStorage), **When** the folder at that path is rendered, **Then** an unloaded folder is not
   mistaken for an open empty one — the self-heal effect loads it so the two signals reconcile.

---

### User Story 8 — Only the chevron toggles a folder; the name just selects (Priority: P3)

A user clicks a folder's name to select it and the folder expands as a side effect, because the click
handler sits on the whole row. There is no way to select a folder without toggling it, and the chevron —
the thing that *looks* like the toggle — has no affordance of its own.

After this story, clicking a folder's **name** (or its glyph) selects only; only the **chevron**
toggles expansion; the chevron is a discoverable, real control; and the folder glyph is a pure state
indicator.

**Why this priority**: It is a deliberate **requirement reversal** (it supersedes feature 004's FR-028),
not a broken promise — the current behaviour is exactly what 004 asked for. It improves an interaction
that already works, so it ranks with the other P3 polish items.

**Independent Test**: Click the chevron and confirm it toggles open then closed. Then click the folder
name and confirm the row is selected but does **not** expand.

**Acceptance Scenarios**:

1. **Given** a collapsed folder, **When** its chevron is clicked, **Then** it expands; **When** the
   chevron is clicked again, **Then** it collapses. (`explorer-tree-state.e2e.ts` test (2), first half.)
2. **Given** a collapsed folder, **When** its **name** is clicked, **Then** the row becomes selected and,
   after a settle, has **not** expanded. (`explorer-tree-state.e2e.ts` test (2), second half.)
3. **Given** the tree has focus on a folder row, **When** the user presses **Enter**, **Then** the
   folder toggles — the keyboard toggle is unchanged and the chevron is deliberately not a tab stop
   (`tabIndex = -1`).
4. **Given** any folder, **When** it is open or closed, **Then** the glyph swaps 📁 / 📂 to reflect the
   state but is never itself a click target; and the root row still renders no twisty and never
   collapses.

---

### User Story 9 — A renamed file stays selected (Priority: P3)

A user selects a file and renames it with F2. When the rename commits, the file ends up **unselected** —
because the node id *is* the relPath, the rename changes the node's identity, and `selectedId` still
holds the old path, which nothing in the tree now matches.

After this story, a renamed file **stays selected** at its new name, and the rename does not open an
editor.

**Why this priority**: Same class as US7/#120 but lower-impact — it loses a selection, not a folder's
whole subtree state, and is instantly re-selectable by hand. It fixes an interaction that otherwise
works.

**Independent Test**: Select a file, F2-rename it, and confirm exactly the renamed row is selected and
no editor opened.

**Acceptance Scenarios**:

1. **Given** a selected file, **When** it is renamed and the rename commits, **Then** exactly the
   renamed row is selected (`renamedRowSelected: 1`, `totalSelectedRows: 1`).
   (`explorer-tree-state.e2e.ts` test (3).)
2. **Given** a rename in progress with `openOnClick: 'none'` isolating it from the preceding click,
   **When** the rename commits, **Then** **no** open-file intent fires (`openIntents: 0`) — a regression
   guard, since nothing opens an editor on rename today (see C31).

---

### User Story 10 — The UI⇄JSON toggle reads on one line in every theme (Priority: P3)

A user on a monospace theme opens Preferences and the UI⇄JSON mode toggle shows its `{ }` glyph broken
across two lines — `{` stacked over `}` — because the fixed-width glyph overflows the icon box and the
browser breaks at the interior space. It looks broken; it works.

After this story, the toggle's glyph occupies a single line in **every** bundled theme, including the
five monospace ones, with no theme file edited.

**Why this priority**: Pure visual polish on a control that already functions — the classic Tweak. It
ranks with the other P3 items.

**Independent Test**: In each monospace theme, confirm the toggle glyph computes `white-space: nowrap`
and occupies exactly one line box.

**Acceptance Scenarios**:

1. **Given** any of the five monospace themes (Windows Terminal, Bash, VI-VIM, Matrix, Cyberpunk),
   **When** Preferences renders the UI⇄JSON toggle, **Then** the glyph computes `white-space: nowrap`
   and occupies exactly **one** line box. (`preferences-themes.e2e.ts`.)
2. **Given** the fix, **When** the repository is inspected, **Then** **no** theme file has changed — the
   change lives entirely in the app stylesheet (`.prefs-toolbtn--icon .icon`).

---

### Edge Cases

- **A move that half-succeeds.** `FilesService.move` returns on the first disallowed item, so it must
  report **what actually moved**, not what was asked for — the lesson `delete` already learned with its
  `removed[]` accumulator.
- **The watcher racing the move signal.** The folder watch may fire before the move notification
  arrives and dirty the doc anyway. Ordering is a requirement, not an implementation detail (FR-004).
- **A move onto a path that is itself open.** Undefined today.
- **A kill (`SIGKILL`, Task Manager) during the debounce window.** Explicitly out of scope; see FR-011.
- **Sub-workspace windows** carry their own layout writes on the same close cascade — in scope, and the
  drain covers them (C6).
- **An empty flavours list**, which today silently changes the control type (FR-018).
- **Renaming a flavour id** that keys `terminals.defaultParams`, orphaning those params — refused in the
  editor; the id is immutable, and to rename you delete and re-add (C13).
- **A theme that fails the new guard on a *seed* but passes after the 6:1 lift** — the guard must
  measure the **shipped** token, not the seed.

## Requirements *(mandatory)*

### Functional Requirements

**US1 — the move signal**

- **FR-001**: `FilesService` MUST announce a completed move to the editor coordinator, reporting the
  `{from, to}` pairs that **actually moved**, in the manner `delete` already announces removals.
- **FR-002**: The coordinator MUST re-point an open document by **path mutation only** — updating the
  path, re-keying the one-buffer registry, re-establishing the watch — while preserving the buffer,
  its undo history and its clean/dirty state. It MUST NOT re-load the document.
- **FR-003**: A re-pointed document MUST NOT be marked dirty and MUST NOT raise a notice.
- **FR-004**: The move signal MUST reach the coordinator **before** the watcher can infer a deletion,
  or the watcher MUST tolerate a just-moved document. A race that dirties the buffer is a failure of
  this requirement.
- **FR-005**: A folder move MUST re-point every open document beneath it, by path prefix.
- **FR-006**: `rename` MUST carry the same signal as `move`. A rename is a move.
- **FR-007**: Move matching MUST normalise path spelling. Raw comparison fails silently on Windows.
- **FR-008**: A re-pointed document MUST NOT be stranded at its old path by any persisted artefact.
  Two artefacts could strand it, and only one needs building (C15):
  - **The recovery snapshot** is keyed by `panelId` and carries **no path** (`editor-recovery.ts`), so
    there is nothing to re-key — recovery follows the move automatically. What this requirement forbids
    is therefore a **snapshot being written at all** on a clean move, which is what AC5 asserts and what
    FR-003's prohibitions deliver.
  - **The persisted panel config** *does* carry the path (`filePath`, restored on next launch), so it
    MUST carry the **new** path — a restart reopens the moved file, not a ghost at the old one.
- **FR-009**: A file moved or deleted by **another program** MUST retain today's behaviour — kept,
  dirty, recoverable.

**US2 — the shutdown drain**

- **FR-010**: Every exit path that closes the application MUST drain pending deferred writes before the
  renderer is destroyed, and MUST await the drain. The correctness of a write MUST NOT depend on how
  long a dialog detains the user.
- **FR-011**: The system MUST NOT rely on a timer that merely outlasts the debounce. Widening the
  accident is not a fix. The bounded loss under an **uncatchable** termination (`SIGKILL`, Task
  Manager) MUST be documented as an accepted limit, not treated as a defect — the debounce is a
  deliberate trade against write amplification during drag.

**US3 — the failure path**

- **FR-012**: When the host establishes that an agent will not arrive — connect deadline lapsed, or
  readiness never acknowledged — it MUST surface a visible, actionable failure to the panel and exit
  the terminal, reaching the existing failure path rather than falling silent.
- **FR-013**: Readiness MUST be acknowledged by the protocol's existing `started` ack, not by first
  output, so a legitimately slow shell is not killed.
- **FR-013a**: The `@admin` suite MUST **execute** on CI's elevated runner, and a selection that
  executes **zero** tests MUST fail the build. Today `@admin` specs are `grepInvert`ed out of the only
  runner capable of running them, and Playwright exits **0** on an empty selection — so the suite is
  simultaneously excluded and reported green. This requirement carries the CI change; FR-013 carries
  only the ack. (Split out under C15 — plan, tasks and the readiness contract all cited FR-013 for work
  its text never described.) **CI verifies the no-hang property only**: dropping integrity
  (FR-024/FR-025c) needs an interactive elevated desktop, which GitHub's headless runners lack, so
  `terminal-de-elevation-hang.e2e.ts` (#94 — a prompt OR a visible error) runs on CI and keeps the
  executed count above zero, while the integrity-matrix specs skip there (`skipWithoutInteractiveDesktop`)
  and are verified locally via `npm run test:e2e:admin`.
- **FR-014**: An elevated throng MUST be able to open a working non-elevated terminal. FR-012 is the
  safety net, not the outcome.
- **FR-015**: The de-elevation launch MUST be **observable** — its failure reason captured rather than
  discarded to `stdio:'ignore'` — so a timeout can say *why*. This is what will finally explain the
  original hang.

**US4 — the controls**

> **SUPERSEDED for v1.0.0 (see C33).** #67 was pulled to vNext on 2026-07-17. For v1.0.0 the terminal-
> flavour controls are **hidden**, not built — the live requirement is **FR-020a**. FR-016 … FR-020
> below are **retained, not deleted**: they are vNext's acceptance criteria (and remain the design of
> record described by C9–C17). Each is prefixed **[vNext]** accordingly.

- **FR-016** *[vNext — superseded for v1.0.0 by FR-020a, C33]*: "Hidden built-in flavours" MUST be a
  multi-select over the **detected** built-ins, never free text (007 FR-029).
- **FR-017** *[vNext — superseded for v1.0.0 by FR-020a, C33]*: An already-hidden built-in MUST remain
  offered by that picker so it can be un-hidden. This requires a surface exposing the **raw detected
  set**, since `listFlavours()` subtracts the hidden ones.
- **FR-018** *[vNext — superseded for v1.0.0 by FR-020a, C33]*: "Custom terminal flavours" MUST render
  as a structured record control — one row per flavour, one cell per field — **irrespective of the
  current value**. The control type MUST NOT be inferred from the data.
- **FR-019** *[vNext — superseded for v1.0.0 by FR-020a, C33]*: That control MUST validate: an id is
  required, an executable is required, and a duplicate id is refused **in the editor** with a stated
  reason.
- **FR-020** *[vNext — superseded for v1.0.0 by FR-020a, C33]*: There MUST NOT be two structured-config
  table implementations. Feature 016's control is generalised, or it is replaced — not duplicated.
- **FR-020a** *(v1.0.0 — the live requirement)*: The three terminal-flavour controls
  (`terminals.flavours`, `terminals.disabledBuiltins`, `terminals.defaultParams`) MUST NOT render in the
  Settings UI for v1.0.0. They MUST be marked internal (added to `SETTINGS_INTERNAL_KEYS`) and their
  descriptors held dormant (`HIDDEN_TERMINAL_FLAVOUR_DESCRIPTORS`), so the completeness rule (007
  FR-047) neither demands nor rejects them. This MUST be a **hide, not a revert**: the tolerant parser
  MUST still read these settings from a hand-edited `settings.json`, and vNext MUST be able to re-expose
  the controls by spreading the dormant descriptors back into the rendered registry and dropping the
  three keys from `SETTINGS_INTERNAL_KEYS`. As a consequence, C14's incidental `terminals.defaultParams`
  text-cell fix is hidden with them and its regression test is removed (C33).

**US5 — one owner per behaviour**

- **FR-021**: Exactly one setting MUST govern file-tree open-on-click.
- **FR-022**: A control that governs nothing MUST NOT ship. **Enforced here for the open-on-click
  claimants only**: every setting rendered for that job MUST be read by production code **outside the
  config layer** (a mention in `app-settings.ts` / `settings-metadata.ts` / `metadata.ts` proves only
  that a setting *exists*). The fleet-wide form of this rule — "every setting in Preferences, measured
  automatically" — is **deliberately deferred**, not claimed: the only cheap implementation is a text
  scan, which was attempted during reproduction and is **unsound** (11 false positives, defeated by
  aliased section objects such as `explorerSettings.dragCopyModifier`). See C16 and the follow-up
  raised by T061.
- **FR-023**: A persisted `explorer.openMode` MUST be **dropped, not migrated** — ignored on load and
  stripped on the next write, with no warning and no change to the user's current behaviour (C1). It
  MUST NOT be reinterpreted into a different open-on-click behaviour than the user experiences today.
- **FR-024**: The surviving control MUST be discoverable where users look for it: `editor.openOnClick`
  keeps its key and MUST move to the **File Explorer** group, labelled "Open files with" (C2). Its
  `none` value MUST remain available. No key is renamed, so no working setting is migrated.

**US6 — the derived guard**

- **FR-025**: Every `syntax*` token MUST be measured against `editorBg`.
- **FR-026**: The pairing list MUST be **derived** from the token set, not hand-written. A hand list is
  precisely how these ten were missed.
- **FR-027**: A theme failing the pairings MUST fail the **build**.
- **FR-028**: Deliberately low-contrast themes MUST remain ungated and MUST NOT be treated as defective
  (#61's policy).
- **FR-029**: The guard MUST measure the **shipped** token values, not the authored seeds.

**US7 — the folder that keeps its open state (#120)**

- **FR-030**: A folder move MUST migrate the folder's expansion (open-map) state to the new path **by
  path prefix**, so a moved folder — and every open descendant beneath it — keeps its open state rather
  than orphaning it at the old path.
- **FR-031**: An **unloaded** folder MUST be distinguishable from an **empty** one — the tree MUST NOT
  collapse "not yet loaded" and "loaded, no children" into the same `[]`. A self-heal effect MUST load
  any folder react-arborist reports **open** whose children are not present, so a folder's chevron and
  glyph **always agree** with its shown children. This MUST hold for any stale open-map entry — a drag,
  or the persisted `expanded` list restored from localStorage — not only the drag path.

**US8 — chevron-only toggle (#121)**

- **FR-032**: Only the folder **chevron** MUST toggle a folder's expansion. Clicking the folder **name**
  or the folder **glyph** MUST select the row only and MUST NOT change its expansion. **This supersedes
  feature 004 FR-028** ("Clicking a folder MUST toggle its expansion").
- **FR-033**: The chevron MUST be a real control — a discoverable hover affordance, `aria-expanded`
  reflecting state, an adequate hit target, and a stable testid `tree-twisty-<path>`. It MUST NOT be a
  keyboard tab stop (`tabIndex = -1`); the keyboard toggle remains **Enter on the focused row**
  (`file-tree.tsx:292-293`, unchanged). The root row renders no twisty and never collapses.
- **FR-034**: The folder glyph MUST remain a 📁 / 📂 **state indicator** that reflects open state, and
  MUST NOT be a click target.

**US9 — the renamed file keeps its selection (#122)**

- **FR-035**: After a rename commits, the tree MUST re-select the file at its **new** path, so exactly
  the renamed row remains selected (the id — the relPath — having changed under the old `selectedId`).
- **FR-036**: A rename MUST NOT fire an open-file intent. This is a **regression guard** — nothing opens
  an editor on rename today (`openIntents: 0`, C31) — and the re-selection MUST NOT introduce it.

**US10 — the single-line mode toggle (#124)**

- **FR-037**: The Preferences UI⇄JSON mode-toggle glyph MUST render on a **single line** in every
  bundled theme, including the five monospace ones. The fix MUST be **app-side** — `white-space: nowrap`
  and a 14px glyph on `.prefs-toolbtn--icon .icon` — with **no theme file edited**.

### Key Entities

- **Move notification** — `{from, to}` pairs for files that actually moved; emitted by the files
  service, consumed by the editor coordinator. Symmetric, so an undone move (#85) is just a move in
  the other direction.
- **Deferred write** — a debounced renderer→daemon persistence action with a pending state that a
  shutdown must drain: `workspace.save` (layout + per-panel zoom, 400 ms) in a workspace window;
  `writeTheme` (150 ms) and the JSON tab's apply (300 ms) in a preferences window. **Every write is
  covered — `void`-dropped or awaited — because the module does not distinguish (C26).** The
  **undebounced** ones (the apply client via `applyNow`, `keybindings-tab.tsx:117`, `revertAll`, and
  `projects-panel.tsx:208` in the **workspace** window) are the same exposure with a shorter fuse; the
  **awaited** ones (`themes-tab.tsx:432`, `apply-client.ts:31`) are covered for free. *(This entry said
  "every config write drops its promise with `void`". **False** — and it outlived C24's tally strike
  **because it is a word, not a number**.)*
  **This entry states no tally, deliberately (C24)**: it has said *"`workspace.save` … and only that"*
  (false — three more) and *"there are four"* (false — the apply client's debounce is unreachable dead
  code), and each number was asserted rather than counted. A window's drain covers every write **that
  window owns**, and needs to know no number to do it.
  **The drain does not enumerate them, and does not name windows either** (**C22/C23**): counting was
  attempted repeatedly and was wrong every time — C24 measured even the correction counts as false — so the drain settles the **chokepoint every config
  write already passes through** — `writeConfig` — and **every window calls it unconditionally**. The
  rule that replaced the counts: *every config write goes through `writeConfig`; every window settles
  it; nobody counts.* That also covers **undebounced** writes, which are not *deferred* writes at all
  but are still in flight and still owned by the closing window — the exposure C21 refused to accept as
  a limit — including one in the **workspace** window (`projects-panel.tsx:208`) that a
  preferences-only drain would have acked in flight.
- **Readiness ack** — `{ ev: 'started'; key; pid }`; already defined in the PTY agent protocol,
  currently discarded.
- **Terminal flavour record** — `{ id, label, file, args, defaultParams }`; an **ordered** array whose
  `id` keys `terminals.defaultParams`. Uniqueness holds **on editor entry** (FR-019 refuses a duplicate)
  and in the **merged launch list** (`mergeFlavours` is first-wins) — but **not** in `settings.json`,
  which the JSON tab can hand a duplicate and `parseTerminals` does not dedupe. C17 defines that case.
- **Contrast pairing** — `{ fg, bg, min }`, to be derived from the token registry rather than enumerated.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A cut+paste, drag-move, folder move or rename of an open file leaves **zero** editors
  pointing at a stale path, and **zero** spurious dirty marks. (AC1–AC6 of #87, currently 6/7 RED.)
- **SC-002**: After a move, a save writes to the new path in 100% of cases and re-creates the file at
  the old path in **0%**.
- **SC-003**: A file moved by another program remains kept, dirty and recoverable — the guard that is
  green today stays green.
- **SC-004**: A layout or zoom change made immediately before **any** exit survives the next launch,
  with **no** dependence on dialog timing. Verified on both the ordinary and Terminate All paths.
- **SC-005**: A language override survives both exits (holds today; must not regress) — and **both** are
  measured once T015b lands. Today only Terminate All is; the ordinary close's override case does not
  exist, so half of "both" was an argument rather than a result.
- **SC-006**: A terminal whose agent never connects, or never acknowledges readiness, produces a
  visible error within a stated budget in 100% of runs — and **0%** hang indefinitely.
- **SC-007**: *(NOT MET — do not claim otherwise; see C34.)* An elevated throng opening a non-elevated
  terminal reaches a **working prompt**. As of 2026-07-17 this does **not** pass: the de-elevated agent
  launches, connects, then **crashes**, so the user reaches FR-012's visible fail-fast error rather than
  a working terminal. Diagnostic logging (`throng-agent-<pid>.log`) and a `cwd: null` → real-cwd fix
  have landed; the root cause is under active diagnosis pending an elevated log. The FR-012 safety net
  (SC-006) is in place and holds; this outcome is not yet achieved and MUST NOT be reported as passing.
- **SC-008**: The `@admin` suite executes in CI on the elevated runner, and the count of admin-gated
  tests actually executed there is **greater than zero** (today: zero). The executed set on CI is the
  #94 no-hang spec; the integrity-drop matrix (FR-024/FR-025c) is desktop-only and verified locally.
- **SC-009** *[vNext — superseded for v1.0.0 by SC-011a, C33]*: Neither terminal-flavour setting
  presents a free-text or JSON control in any state, including when empty.
- **SC-010** *[vNext — superseded for v1.0.0 by SC-011a, C33]*: A hidden built-in can be un-hidden
  through the editor alone, with no hand-editing of `settings.json`.
- **SC-011** *[vNext — superseded for v1.0.0 by SC-011a, C33]*: An invalid or duplicate flavour is
  refused in the editor with a reason; **0** invalid flavours reach `settings.json`.
- **SC-011a** *(v1.0.0 — the live criterion)*: **Zero** of the three terminal-flavour controls
  (`terminals.flavours`, `terminals.disabledBuiltins`, `terminals.defaultParams`) render in the Settings
  UI, while a hand-edited `settings.json` still parses them (hide, not revert), and the settings-
  completeness rule passes with the three keys internal.
- **SC-012**: Exactly **one** setting claims the open-on-click job, and that survivor has **≥1** reader
  outside the config layer — so **zero** of the open-on-click claimants that ship are inert. Scope is
  the claimant pair, matching what is measured (C16); the fleet-wide "no inert settings anywhere"
  property is **not** claimed by this feature and is tracked as the follow-up T061 raises. A feature
  that asserted it fleet-wide would be asserting it on the strength of an unsound grep.
- **SC-013**: A syntax token added with no pairing entry causes a test failure without anyone editing
  the pairing list.
- **SC-014**: All 150 shipped syntax/`editorBg` pairs remain measured and passing, and the guard's
  threshold is a **stated decision** rather than a by-product of `legibleOn`.
- **SC-015**: A folder moved inside throng — dragged into another folder, and dragged **back** to a
  previously-expanded path — leaves its chevron, glyph and actually-shown children in **agreement** in
  100% of cases, with **0** open-but-empty stuck states. (#120; `explorer-tree-state.e2e.ts` tests (1),
  (1b).)
- **SC-016**: Clicking a folder **name** selects only and changes expansion in **0%** of clicks; clicking
  the **chevron** toggles in 100%. (#121; `explorer-tree-state.e2e.ts` test (2).)
- **SC-017**: A renamed file remains the **single** selected row (`renamedRowSelected: 1`,
  `totalSelectedRows: 1`) and fires **0** open intents. (#122; `explorer-tree-state.e2e.ts` test (3).)
- **SC-018**: The UI⇄JSON mode-toggle glyph occupies exactly **one** line box in all five monospace
  themes, with **0** theme files modified. (#124; `preferences-themes.e2e.ts`.)

## Reproduction Evidence

Every requirement above is anchored to a test written **before** any fix, run against `87e28a9`, and
confirmed RED for the right reason. No production code was modified.

| Test | Covers | Status |
|------|--------|--------|
| `packages/ui/tests/e2e/editor-move-repoint.e2e.ts` | #87 AC1–AC7 | **6 RED**, 1 green (the external-move guard) |
| `packages/ui/tests/e2e/terminate-all-drain.e2e.ts` | #86 | **2 RED** (ordinary close), 2 green (pins the asymmetry) |
| `packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts` | #94 FR-012/FR-013 | **2 RED** — elevation-free, runs in CI |
| `packages/ui/tests/e2e/terminal-de-elevation-hang.e2e.ts` | #94 FR-014 | `@admin`-gated — **not executed** (session not elevated) |
| `packages/ui/tests/e2e/preferences-terminal-flavours.e2e.ts` | #67 → vNext (FR-020a) | **re-cast to guard the HIDE** — now asserts none of the three controls renders even with data (was the 4-RED "controls work" spec) |
| `packages/core/tests/unit/settings-open-on-click-single-owner.test.ts` | #95 | **2 RED** — fix-agnostic |
| `packages/core/tests/unit/theme-syntax-body-contrast.test.ts` | #83 | **4 RED**, 16 green (locks in the measured 150) |
| `packages/ui/tests/e2e/explorer-tree-state.e2e.ts` | #120 / #121 / #122 (US7–US9) | adopted post-review; **4 RED before fix**, green now |
| `packages/ui/tests/e2e/preferences-themes.e2e.ts` (mode-toggle wrap) | #124 (US10) | adopted post-review; **RED before fix**, green now |

The "no production code was modified" statement above describes the **original six** at the point this
spec was first written against `87e28a9`. The last three rows are the **adopted-after-review** items
(US7–US10) and #67's re-cast guard: their production code is written and their tests are **green**, so
they are recorded here as implemented rather than as an untouched RED baseline.

## Assumptions

- The eight-bug milestone minus **#90** and **#75**, excluded by owner direction on 2026-07-16.
- **#87 is the enabler for #85** (undo of a move). The signal is designed to be symmetric so an undone
  move is not a special case. #85 itself is out of scope.
- **#83 is not blocked by the theme-token grouping work**, because no recolouring is required — the
  measurements say the palette is already compliant. Were recolouring in scope, that blocker would bind.
- The `map` control is **generalised**, not duplicated (FR-020), per #67's stated intent. *(vNext now —
  #67 was pulled on 2026-07-17; for v1.0.0 the controls are hidden, FR-020a / C33.)*
- The 6:1 lift in `makeTheme` **stays** regardless of the gate's threshold — it is load-bearing for the
  search-match tint (Open Question 1, settled by C3).
- **All six were agreed by the maintainer on 2026-07-16**, after this specification's corrections were
  reviewed — so the agreement covers the bugs *as re-diagnosed here*, not as originally filed. Each now
  carries the `agreed` label with its body checkbox ticked to match. #95's earlier contradiction (box
  ticked, label still `needs-agreement`) is resolved, and #67 — which predated the template and had no
  agreement gate at all — was given one. *(The `needs-agreement` / `agreed` labels were subsequently
  retired from the repo, so newer items in this feature — US7–US10 — carry no such label.)*
- **Scope changed on 2026-07-17, after the adversarial review.** The developer directed four further
  pre-existing items into the feature — #120, #121, #122 (US7–US9) and the newly-raised
  [#124](https://github.com/Bidthedog/throng/issues/124) (US10) — and, the same day, **pulled #67 to
  vNext**: its controls are hidden for v1.0.0 (FR-020a, C33) rather than built, so the "map control is
  generalised" assumption below now describes vNext, not this release, and this feature's PR no longer
  closes #67.
- Agreement cleared the work to proceed; it did **not** resolve the open questions below. Because the
  developer's instruction was explicitly *not to prompt*, they were resolved in the Clarifications
  session above rather than interactively — **before** implementation, as required, not during. Two of
  them (the #83 threshold → C3, the #67 control shape → C9) change what "done" means, so they are
  flagged there for **deliberate re-opening on review** if the developer disagrees. That is the standing
  invitation; it is not an outstanding blocker.

## Open Questions

**Provenance, not a work list.** Every question here is answered — each carries its resolving
clarification. The section is retained because *what was asked* is evidence of what was considered; the
answers live in [Clarifications](#clarifications) and the answers, not these questions, are binding.

1. **#83's threshold: 4.5 or 6.0?** → **Resolved: C3 (6.0).** All fifteen themes sit ≥6.01:1 today, so both pass. But
   `default-themes/index.ts:186-191` argues the 6:1 lift is load-bearing: the search-match tint can only
   be as strong as the weakest syntax hue permits, so a comment authored at exactly 4.5 leaves zero
   budget and collapses the highlight to invisibility. **A 4.5 gate would be weaker than the derivation
   it protects.** Encode 4.5 (WCAG AA, matches the issue) or 6.0 (matches reality)?
2. **#83's gating scope contradicts itself.** → **Resolved: C4 (defines its own scope; not blocked by
   #61).** "Fails the build" is incompatible with
   `IN_SCOPE_THEMES = ['Bash','SUBNET','Cyberpunk']` — `Light` is not gated, so a Light failure would
   route to `knownContrastIssues()`, the very "report nobody reads" the issue objects to. #61 is what
   widens the gated set, and it is milestoned **vNext** while #83 is **v1.0.0**. Does #83 inherit #61's
   scope (making it blocked, which the issue denies) or define its own?
3. **Is `editorBg` the only background code is painted on?** → **Resolved: C5 (out; follow-up issue via
   T061).** `editorSelection` also sits under
   syntax-coloured text and is measured against nothing. Same class of gap — in or out?
4. **Does the shutdown drain extend to sub-workspace windows?** → **Resolved: C6 (yes).** They carry
   their own layout writes on the same close cascade.
5. **What is the readiness budget for #94, and does it start at `start()` or at connect?** →
   **Resolved: C7 (15s, from connect, separate from the connect deadline).**
6. **Is a flavour `id` editable after creation?** → **Resolved: C13 (no — immutable; delete and
   re-add).** It keys `terminals.defaultParams`; renaming silently orphans them.
7. **Does flavour order matter to the user?** → **Resolved: C11 (yes — order preserved, never sorted;
   reordering affordances out, follow-up via T061).** `mergeFlavours` is first-wins and user-first; the
   map control sorts alphabetically. If order is user-visible, reordering affordances are in scope.
8. **Is `terminals.defaultParams` already broken?** → **Resolved: C14 (yes — folded in with a
   regression test, T040/T041).** Its `control: 'text'` column renders an empty
   `<select>` and has no test coverage. Fold in, or raise separately?
9. **Is a fleet-wide "no inert settings" guard worth building?** → **Resolved: C16 (not here — out of
   scope and, critically, not claimed either; SC-012/FR-022 narrowed to match, follow-up via T061).**
   #95 is unlikely to be the only
   vestigial setting, but nothing catches the class. A text-scanning version is **unsound** — it was
   attempted during reproduction and flagged 11 false positives, because settings read via aliased
   section objects (`explorerSettings.dragCopyModifier`) defeat a static scan. It would need typed
   accessors or a type-graph check.
10. **Which flavour did #94's reporter use?** → **Confirmatory only; nothing to resolve** (no
    clarification claims it, by design). "Windows Terminal" is a *theme*; the flavours are
    `windows-powershell`/`pwsh`/`cmd`/`git-bash`. The mechanism is flavour-independent, so the answer
    cannot change the fix — it would only corroborate a diagnosis already anchored to
    `pty-agent-host.ts`. Worth asking the reporter on the issue; not worth blocking on.
