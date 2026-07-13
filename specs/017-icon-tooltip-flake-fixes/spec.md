# Feature Specification: Defect Sweep — Icon Packs, Header Tooltips & a Flaky Pane Test

**Feature Branch**: `017-icon-tooltip-flake-fixes`

**Created**: 2026-07-12

**Status**: Planned (clarified · planned · tasked)

**Input**: User description: "in a new worktree for set B"

Set B is the batch agreed during the 2026-07-12 triage of the open bug backlog: the three defects
that are **self-contained** — they need no new theme tokens, and they do not touch the fourteen
bundled theme files. They are therefore safe to land ahead of the larger "theme integrity" work
(Set A), which does.

| Issue | Defect |
|-------|--------|
| **#54** | SVG icon packs have no effect outside the Preferences → Icons grid |
| **#57** | Panel and tab header tooltips show instructions, not the title being hovered |
| **#66** | Flaky E2E: `panes.e2e.ts` "left pane: no rail strip when expanded…" |

## Clarifications

### Session 2026-07-12 (provenance)

Raised from the open-issue backlog, not from new discovery. All three issues predate this feature
and were triaged into a batch because each is independently shippable and none requires a change to
the shared theme-token vocabulary.

### Session 2026-07-12 (diagnosis verified against the code)

Each issue's stated diagnosis was checked against the current tree before this spec was written.
All three are **confirmed**, with three material corrections that shape the requirements below:

1. **#54 is broader than reported.** Two icon-resolution paths exist. The pack-aware one is reached
   from a single screen — the Preferences → Icons grid. The pack-blind one serves **every other icon
   in the application** (14 invocations across eight modules: the shared icon button, the folder
   picker, the explorer toolbar and tree, the find bar, the terminal panel, the context menu, and the
   panel-type icon). The user's icon-pack choice is therefore honoured **nowhere** in the app chrome.
   Separately, the bundled pack art is authored to inherit the surrounding text colour, but the Icons
   grid presents it in a way that isolates it from the page, so it resolves to **black regardless of
   theme**. Both halves must be fixed for a pack to be usable.

2. **#57's premise holds for panels, but only partly for tabs.** A panel title is truncated with an
   ellipsis, so its tooltip really is the only way to read it in full — and that tooltip is currently
   occupied by interaction instructions. A **tab** title is *not* truncated; a long tab grows and the
   tab strip scrolls horizontally instead. The tab tooltip is therefore a consistency and
   reachability fix (the title may sit off-screen), not a "no other way to read it" fix. Scoped
   accordingly in FR-008.

3. **#66 is not a CSS-transition race.** It is the **same class of race as #59**, which was fixed in
   the panel-add helpers and has reappeared here: the test opens with a *negative* assertion (an
   element is absent), which a not-yet-rendered DOM satisfies **vacuously**, and then performs a raw
   measurement that does not wait for anything. The pane-collapse animation cannot move the measured
   control at all — it is pinned — so the animation is a red herring. Critically, the test runner is
   configured to **retry failed tests twice**, which is the mechanism currently laundering this flake
   into a green bar. See FR-013 and FR-014.

### Session 2026-07-12 (clarification)

- Q: How far does the audit for the flaky-test race class reach? → A: The **shared E2E harness and every E2E spec** — any raw measurement not preceded by a positive settle, and any unconditional sleep standing in for a wait. Fix all found; report anything deliberately left. (Not merely the one reported test: this class already recurred once after being fixed locally in the panel-add helpers, #59.)
- Q: What enforces "a flake is not a clean pass"? → A: **Retries stay configured, but any flaky result fails the run.** A test that passes only on retry turns the run **red**, with the flake named in the report. Retries are kept so the first failure's diagnostic evidence is still captured — not so the failure can be absorbed.
- Q: What does the spec require about how pack icons are loaded and rendered? → A: A pack's icons are loaded **once** and served **from memory**; **no disk read may occur while rendering an icon**, and an icon MUST render **synchronously** so it cannot pop in after its row. The mechanism is left to the plan. *(Restated structurally during analysis remediation: the original "no perceptible regression against today's glyph rendering" was unfalsifiable — no baseline existed to measure against. See FR-006b / SC-009.)*
- Q: How are icons exposed to assistive technology? → A: **Icons are decorative** and MUST be hidden from assistive technology. The accessible name comes from the **enclosing control's** existing title/label, never from the icon itself.
- Q: How is an icon pack that fails to load surfaced to the user? → A: **Fall back to the theme's icons, and mark the pack as unavailable — with the reason — in the Preferences → Icons picker.** No global notice: the message belongs on the screen where the user chose the pack, and standing up a new notification surface would overlap #48.

### Session 2026-07-12 (baseline measurement — the suite is worse than #66 suggested)

A baseline E2E run with **retries disabled** was taken before any code was written. It found **10
tests failing on their first attempt**, across 8 files:

`context-menu` (click-outside closes), `destroy-cascade` (mirrored terminal panel),
`performance` (launch budget), `persistence-restore` (×2), `phase9` (×2), `projects` (edit/delete),
`terminal-altscreen-parity`, `terminal-slow-start`.

All ten currently pass under `retries: 2` and are reported green. **`panes.e2e.ts` — the test #66 is
actually about — passed on this particular run**, which is precisely what a flake does; its fix is
justified by the race in its code, not by a reproduction.

Two consequences, both of which *strengthen* rather than contradict the plan:

1. **The flake population is at least eleven, not one.** FR-013a's suite-wide audit was the right
   call, and is now supported by a concrete list rather than an inference.
2. **FR-014's gate cannot simply be switched on.** Enabling `--fail-on-flaky-tests` against this suite
   turns it red immediately. Every first-run failure must therefore be **fixed**, or **explicitly
   quarantined with a stated justification** in the audit report, *before* the gate is armed. This is
   the same "fix the instrument before trusting its readings" logic the delivery sequencing already
   applies — it simply turns out there is more instrument to fix than #66 alone implied.

Related: CI's own configuration comment records that "the elevated de-elevation path is **absorbed by
retries**" — i.e. a code path whose CI coverage *depends* on a retry converting a failure into a pass.
That dependency must be resolved before the gate is armed, not discovered by a red build afterwards.

### Session 2026-07-12 (analysis remediation)

Cross-artifact analysis found three critical defects in the plan-as-tasked; all are fixed:

- **A deleted function was still imported by a test.** FR-002 deletes `resolveIcon`, but
  `packages/core/tests/unit/theme.test.ts` imports and asserts on it — a hard build break that the
  renderer-only source guard would never have caught. A task now updates it.
- **Documentation would have contradicted shipped behaviour.** `docs/testing.md` documents the *old*
  retry policy in terms ("retries absorb those") that FR-014 abolishes, and CI's comments say the
  same. The constitution's documentation-currency rule is NON-NEGOTIABLE, so these move in this
  change, alongside README, ROADMAP and CONTRIBUTING.
- **FR-006d had no coverage, and a live violation exists.** Making every icon decorative (FR-006c)
  *creates* the risk FR-006d guards against, and the explorer's **symlink marker** is a real instance:
  an icon whose entire job is to convey "this is a symlink", which `aria-hidden` would erase with no
  text substitute. A task now audits information-bearing icons and gives each a text carrier.

Two success criteria were also restated to be falsifiable rather than aspirational: SC-002 now asserts
the *mechanism* (icons take their colour from the theme) instead of the unmeasurable "legible", and
SC-009 asserts the *structural* claim (zero disk reads; synchronous render) instead of an unbaselined
"no perceptible regression".

### Session 2026-07-12 (delivery sequencing)

Although the icon-pack defect (User Story 1) carries the most user-visible value, the flaky-test
defect (User Story 3) is expected to be **implemented first**. Every user-facing change in this
feature must ship with end-to-end coverage, and that coverage would otherwise be added to a suite
that is currently capable of hiding its own failures behind retries. Fixing the suite first makes
the evidence for the other two stories trustworthy. Priorities below reflect **user value**;
implementation order is a plan-level concern.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An icon pack changes the icons I actually see (Priority: P1)

A user opens Preferences → Themes → Icons and selects the bundled SVG icon pack. They expect the
application's icons — in the file explorer, on panel and tab chrome, in menus, on toolbars and
buttons — to become that pack's icons, and to remain legible against whichever theme they are using.

Today, selecting a pack changes a preview grid inside Preferences and **nothing else**. The setting
appears to do nothing, and the one place it does apply renders the art in fixed black, which is
unreadable on a dark theme.

**Why this priority**: This is the largest gap between what the product promises and what it does. A
setting that visibly exists, is persisted, and changes nothing is worse than an absent one — it reads
as a broken app. It is also a standing violation of the project's own rule that an action control's
icon and colours must come from the active theme.

**Independent Test**: Select each bundled icon pack in turn and confirm the icons change across the
application chrome, on both a light and a dark theme, without restarting. Delivers the whole value of
the icon-pack feature on its own.

**Acceptance Scenarios**:

1. **Given** the default theme and the default icon pack, **When** the user selects the SVG icon
   pack, **Then** the icons in the file explorer, panel headers, tab chrome, context menus, toolbars
   and buttons all change to that pack's icons, without a restart.
2. **Given** the SVG icon pack is selected, **When** the user switches from a dark theme to a light
   theme, **Then** the pack's icons remain clearly legible against the new background, taking their
   colour from the active theme rather than a fixed one.
3. **Given** the SVG icon pack is selected, **When** a pack does not provide an icon for some token,
   **Then** the application falls back to the active theme's icon for that token, and then to the
   default icon — an icon is always shown, never a blank space.
4. **Given** the SVG icon pack is selected, **When** the user reverts to the default pack, **Then**
   every surface returns to the default icons, without a restart.

---

### User Story 2 - Hovering a header tells me what I am looking at (Priority: P2)

A user has several panels open whose titles are too long for their headers and are cut off with an
ellipsis. They hover one to read it in full — and are shown a list of interaction instructions
instead ("Click: Activate · Drag: Move · …"). The one piece of information the tooltip exists to
provide is the one piece it withholds.

**Why this priority**: A real, daily papercut with a small, contained fix, but it degrades legibility
rather than breaking a feature. The instructions it displaces remain discoverable from the
right-click menu, which is where they belong.

**Independent Test**: Open a panel whose title is long enough to truncate, hover its header, and
confirm the full title is shown. Requires nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** a panel whose title is truncated in its header, **When** the user hovers the panel
   header, **Then** the tooltip shows the panel's **full title**.
2. **Given** a tab, **When** the user hovers it, **Then** the tooltip shows the tab's **full title**.
3. **Given** any panel or tab, **When** the user hovers its header, **Then** the tooltip does **not**
   show the list of interaction instructions.
4. **Given** a panel or tab, **When** the user renames it, **Then** hovering it afterwards shows the
   **new** title.
5. **Given** the tooltips that already show content — the panel-type icon, the terminal working
   directory, the editor file path — **When** the user hovers them, **Then** they behave exactly as
   they do today (unchanged by this feature).

---

### User Story 3 - A green test run means the tests actually passed (Priority: P3)

A developer runs the end-to-end suite. One pane test fails, is retried automatically, passes on the
second attempt, and the run is reported green. Nothing was fixed; a coin was flipped. The next flip
may land on a real regression that is silently retried away.

**Why this priority**: Developer-facing rather than user-facing, so it is P3 by user value — but it
is the *prerequisite* for trusting the evidence behind Stories 1 and 2, and the project's own
constitution is unambiguous that a test which fails and then passes with no code change is "flaky,
not fixed" and must never be "absorbed into a green bar by repetition".

**Independent Test**: Run the affected test repeatedly with retries disabled and confirm it passes
every time. Requires nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** retries are disabled, **When** the affected pane test is run repeatedly, **Then** it
   passes every time, with no failures attributable to timing.
2. **Given** the same race exists elsewhere in the suite, **When** the suite is audited for it,
   **Then** every other instance of the same pattern is closed too — the defect class, not just the
   one test.
3. **Given** a test fails and then passes on retry, **When** the run finishes, **Then** the run
   **fails**, naming that test as flaky. A green run means every test passed on its first attempt.
4. **Given** the fixes for Stories 1 and 2, **When** the full suite is run once, **Then** it is green
   with no flaky results.

---

### Edge Cases

- **An icon pack is missing, unreadable, or corrupt on disk.** The application must fall back to the
  theme's icons rather than showing blank space or failing to start — **and must say so** in the
  Preferences → Icons picker, where the pack is shown as unavailable with the reason. A silent
  fallback is not acceptable: it would reproduce the very confusion this feature exists to remove,
  where a chosen setting appears to do nothing. (See FR-004a.)
- **A pack supplies only some of the icons.** Per-token fallback applies (pack → theme → default);
  a partial pack must not produce a half-empty interface.
- **A theme's foreground colour is very close to its background.** Pack icons inherit the theme's
  colour, so they are exactly as legible as the theme's own text — no better, no worse. Guaranteeing
  a minimum contrast for every bundled theme is a separate, already-tracked concern (#61) and is out
  of scope here.
- **A panel or tab has an empty or default title.** Hovering shows whatever the title is; the tooltip
  must not fall back to showing the instructions again, and must not show an empty tooltip box.
- **A very long title.** The tooltip shows the full title; wrapping is the platform's to decide.
- **The window is too narrow for the expanded sidebar.** The pane may legitimately auto-collapse. A
  test that measures the expanded control must settle on it being present rather than assume it.

## Requirements *(mandatory)*

### Functional Requirements

**Icon packs (User Story 1)**

- **FR-001**: Selecting an icon pack MUST change the icons shown throughout the application — at
  minimum the file explorer tree and toolbar, panel headers and chrome, tab chrome, context menus,
  the find bar, terminal panels, the folder picker, and all icon buttons — and not only the
  Preferences → Icons grid.
- **FR-002**: The application MUST resolve every icon through **one** authoritative, pack-aware
  resolution path. Two divergent resolvers (one pack-aware, one pack-blind) MUST NOT survive this
  change; the pack-blind path must cease to exist or cease to be reachable.
- **FR-003**: Icon resolution MUST honour this precedence for every icon: an explicit per-icon
  **override**, then the selected **pack**, then the active **theme**'s icon, then the **default**
  icon. An icon MUST always resolve to something renderable.
- **FR-004**: Pack icons MUST take their colour from the **active theme**. A pack icon MUST NOT
  render in a fixed colour that ignores the theme, and MUST NOT be black-on-dark.
- **FR-004a**: When a selected icon pack cannot be loaded — missing, unreadable, or corrupt — the
  application MUST fall back to the active theme's icons **and** MUST show that pack as
  **unavailable, with the reason**, in the Preferences → Icons picker. The application MUST NOT fail
  to start, MUST NOT render blank icons, and MUST NOT fall back **silently**: a chosen setting that
  appears to do nothing is the precise defect this feature exists to remove. No global notification
  is required — the message belongs on the screen where the pack was chosen. (A partially readable
  pack is not a failure; per-token fallback under FR-003 covers it.)
- **FR-005**: Changing the icon pack, or changing the theme, MUST update every icon **live** — no
  application restart, no reopening of a panel or window.
- **FR-006**: Every icon introduced or altered by this change MUST take its glyph or image, and its
  colours, from the active theme's tokens — no hardcoded colours and no inline icon assets — in
  conformance with the project's themeable-icon-control rule.
- **FR-006a**: An icon pack's contents MUST be loaded **once** and served **from memory** thereafter.
  Rendering an icon MUST NOT read from disk. This is a behavioural requirement, not an optimisation:
  the file explorer resolves an icon **per row**, so a large project would otherwise perform hundreds
  of disk reads to paint a single frame.
- **FR-006b**: An icon MUST render **synchronously, from memory**. It MUST NOT be fetched, loaded on
  mount, or awaited in any way at render time — so an icon cannot appear progressively ("pop in")
  after the row that contains it, and cannot delay that row's paint. This is the structural claim
  SC-009 verifies. It is stated structurally rather than as "no perceptible regression" because a
  component that *cannot reach the disk* cannot be slow because of the disk — the property is
  provable, whereas a perceptual threshold against an unmeasured baseline is not.
- **FR-006c**: An icon MUST be treated as **decorative** and MUST be hidden from assistive
  technology. The accessible name of a control MUST come from that control's own title or label —
  which the project's themeable-icon-control rule already requires every action control to carry —
  and never from the icon inside it. This holds for both glyph and image icons, so an icon MUST NOT
  be announced to a screen-reader user in addition to the action it sits on.
- **FR-006d**: Consequently, no icon may be the **sole** carrier of meaning: any control or row whose
  icon conveys information MUST also expose that information as text or as an accessible name on the
  control itself.

**Header tooltips (User Story 2)**

- **FR-007**: Hovering a **panel header** MUST show that panel's **full title**.
- **FR-008**: Hovering a **tab** MUST show that tab's **full title**. (A tab title is not currently
  truncated, but it may sit off-screen behind the tab strip's horizontal scroll; this requirement is
  for reachability and consistency with FR-007.)
- **FR-009**: The list of interaction instructions MUST NOT occupy the panel-header or tab tooltip.
  Those interactions remain discoverable through the right-click context menu.
- **FR-010**: Tooltips that already show **content** — the panel-type icon, the terminal working
  directory, the editor file path, the unsaved indicator, the owning project — MUST be left
  unchanged, as MUST the tooltips on action controls, which correctly name their action.
- **FR-011**: A rename MUST be reflected in the tooltip immediately.

**Test-suite integrity (User Story 3)**

- **FR-012**: The flaky pane test MUST become deterministic: it MUST pass on every run with retries
  **disabled**, with no dependence on an unconditional wait to mask a timing gap.
- **FR-013**: A test MUST NOT take a measurement of the interface before the interface has settled
  into the state being measured. In particular, an assertion that something is **absent** MUST NOT be
  used as the point at which a test decides the interface is ready, because an interface that has not
  rendered yet satisfies it trivially.
- **FR-013a**: This defect **class** MUST be closed across the **whole end-to-end suite** — the
  shared test harness and **every** end-to-end spec — not merely the one reported test. The audit
  MUST find and fix all three forms of it:
  (a) a **raw measurement or read that does not wait**, taken without a preceding **positive** settle
      on the state being measured;
  (b) a **negative assertion used as the settle point** — asserting that something is *absent* as the
      first assertion of a test, which a not-yet-rendered interface satisfies trivially; and
  (c) an **unconditional sleep** standing in for a real wait on a condition.
  Any instance deliberately left in place MUST be reported with its justification, so that what was
  *not* fixed is visible rather than silent. Rationale: this class already recurred once — it was
  fixed locally in the panel-add helpers (#59) and reappeared in the pane tests — so fixing the
  instance rather than the class has already been tried and has already failed.
- **FR-013b**: A test that cannot be made deterministic MUST be **quarantined by an enumerable
  mechanism** — a tag that can be listed and counted — never by deletion, by an unexplained `skip`, or
  by silence. Lost coverage MUST remain **visible**: it must be possible to answer "what is not being
  tested?" with a command, not an archaeology exercise. Every quarantined test MUST carry a written
  justification in the audit report.
- **FR-013c**: An **environment guard** is NOT a quarantine, and this rule does not touch it. The two
  look alike — both stop a test from running — but they differ in the only way that matters:

  | | Environment guard | Quarantine |
  |---|---|---|
  | Why the test is skipped | the environment **cannot** run it (e.g. it needs an elevated process) | the test is **unreliable** |
  | Where its coverage lives | **elsewhere** — a dedicated runner verifies it for real | **nowhere** — the coverage is genuinely lost |
  | Example | `skipIfElevated()`, the `@admin` tag | `@quarantine` |

  An environment guard **preserves** coverage by routing it to a runner that can honour it; a
  quarantine **forfeits** coverage and must therefore be counted. The constitution (v3.7.0) *requires*
  privilege-dependent tests to be tagged and elevation-gated, so treating that gating as a
  banned "skip" would put this spec in direct conflict with it. It is not banned. What is banned is
  skipping a test because it *flakes* and calling that an environment problem.
- **FR-014**: A test that fails and then passes on retry MUST **fail the run**. Retries MUST remain
  configured — so that the first failure's diagnostic evidence (the assertion, the diff, the trace)
  is still captured rather than discarded — but a retry MUST NOT be able to convert a failure into a
  pass. Concretely: a run containing **any** flaky result MUST exit as a **failure**, and the flaky
  test MUST be named in the run's report. A green run therefore means every test passed on its
  **first** attempt.
- **FR-014a**: This applies to **local and continuous-integration runs alike**. A single rule, with no
  environment in which a flake is tolerated, is what stops a flake being discovered only after it has
  already masked a regression. Consequently a genuinely transient infrastructure fault will also fail
  a run; that is the accepted cost of the rule, and the remedy is to fix or quarantine the flaky test,
  never to relax the gate.
- **FR-015**: The user-facing changes in User Stories 1 and 2 MUST ship with end-to-end coverage that
  exercises them through the running application, per the project's rule that no user-facing change
  is complete on unit evidence alone.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With a non-default icon pack selected, **100%** of the application's icon-bearing
  surfaces show that pack's icons. Today the figure is one screen — the Preferences → Icons grid.
  *Verified structurally*: a directory-wide source guard proves **no** renderer module can bypass the
  shared icon component, which is what makes "100%" checkable rather than a claim about the surfaces
  someone remembered to list. Sampled end-to-end across the explorer, panel and tab chrome, menus,
  toolbar and buttons.
- **SC-002**: Pack icons resolve their colour **from the active theme**, never from a fixed value. A
  user switching between a light and a dark theme sees icons that follow the theme rather than
  rendering black-on-dark, as they do today. (This asserts the *mechanism*. Guaranteeing a contrast
  **ratio** for every bundled theme is deliberately out of scope — that is #61 — so this criterion
  does not claim it.)
- **SC-003**: A user can read the full title of **any** panel or tab by hovering it, including one
  whose title is too long to display.
- **SC-004**: The previously flaky pane test passes **20 consecutive runs** with retries disabled.
- **SC-005**: The **end-to-end** suite passes in a single unfiltered run with **zero** failures and
  **zero** flaky results, and lint and type-check report zero errors. The unit, integration and
  contract suites pass with the single exception of a **pre-existing integration flake**
  (`terminal-reattach.integration.test.ts`, "closeIdle closes an idle shell but keeps a busy one"),
  which is **named, tracked and explicitly out of scope**: it is an *integration* test and FR-013a
  scopes this feature's audit to the end-to-end suite. Naming the exception is what stops it being
  quietly absorbed — a criterion that cannot be met is worse than one that states its exception.
- **SC-006**: No icon, tooltip, or pane **behaviour** that works today regresses. This protects
  behaviour, **not** tests that assert a removed implementation: `icon-packs.e2e.ts` currently pins the
  `<img src=file://…>` rendering that FR-004 deletes, and it is **rewritten**, not preserved. A test
  that asserts the defect is not coverage worth keeping — and reading this criterion as "keep every
  test green exactly as written" would force an implementer to retain the very bug the feature
  removes.
- **SC-007**: A run in which any test needed a retry **exits as a failure** and names that test. A
  green run therefore means every test passed on its **first** attempt — verifiable by forcing a
  known-flaky test and observing the run go red.
- **SC-008**: **Zero** unguarded raw reads and **zero** unconditional sleeps remain anywhere in the
  end-to-end harness or specs — or each surviving instance is listed with a stated justification, so
  that what was not fixed is visible rather than silent.
- **SC-009**: Rendering an icon performs **zero** disk reads. Verified structurally rather than by a
  stopwatch, because the design's claim *is* structural: every pack asset is resolved **once** in the
  main process (asserted by counting the reads a pack load performs), and the icon component renders
  **synchronously** — no `fetch`, no `file://` URL, no load-on-mount effect (asserted by a source
  guard). A component that cannot reach the disk cannot be slow *because of* the disk, and it cannot
  pop in after the row that contains it.
- **SC-010**: An assistive-technology user moving across the app's controls hears **the action**,
  once — never the icon, and never the action announced twice. No control's meaning depends on an
  icon a screen reader cannot see.
- **SC-011**: With a deliberately corrupted or deleted icon pack, the application **starts normally**,
  every icon falls back to the theme's, and the Preferences → Icons picker shows that pack as
  unavailable **with the reason**. Nothing renders blank, and nothing fails silently.

## Assumptions

- **Fourteen themes ship with the application**, and the SVG pack must be legible on all of them.
  This feature makes pack icons *follow* the theme; it does not audit or gate any theme's contrast.
  That is #61 and is out of scope.
- **The instructions removed from the header tooltips need no replacement surface.** They are already
  available from the right-click context menu on both panels and tabs. No new discoverability
  affordance is introduced.
- **Retries stay configured, but a flaky result fails the run** (FR-014, clarified 2026-07-12).
  Retries are kept for their *diagnostic* value — the first failure's assertion and trace are
  captured — not for their absolving value. The test runner in use supports failing a run on flaky
  results directly, so no bespoke reporting is required. The accepted cost is that a transient
  infrastructure fault now fails a run rather than passing quietly on attempt two.
- **The bundled pack art is already authored to inherit the surrounding colour**, so making it follow
  the theme is a matter of how it is presented, not of redrawing or recolouring the assets, and no
  new colour token is required.
- **No new theme token is introduced by this feature.** This is what keeps it independent of Set A
  and off the fourteen bundled theme files.

## Out of Scope

Deliberately excluded, so that this batch stays independent of the theme-token work:

- **#62** (`panelSurface` is overloaded), **#63** (scrollbars are unthemed), **#56** (the cog and Key
  Bindings menus do not inherit the theme). These are "Set A" — they require new theme tokens,
  shipped values in all fourteen bundled themes, copy entries, and a token-completeness update, and
  they are best done as one pass rather than four.
- **#64** (the native colour-picker popup cannot be themed). This is *building* a colour picker, not
  fixing one, and does not belong in a bug-fix batch.
- **#55** (a single SVG pack with an overridable colour). This feature **unblocks** it — #55 is
  blocked on pack icons actually binding to the theme, which is FR-004 — but the icon-colour token
  and its picker are not delivered here.
- **#61** (gating bundled themes to a contrast standard, and surfacing conformance in the picker).
- Any change to the set of icons a pack contains, or to the pack's artwork.
