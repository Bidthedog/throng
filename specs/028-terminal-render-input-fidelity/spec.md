# Feature Specification: Terminal Render & Input Fidelity

**Feature Branch**: `feature/S028-I162-terminal-render-input-fidelity`

**Created**: 2026-07-31

**Status**: Draft

**Input**: Consolidates five tracked v1.0.0 terminal issues — #162, #163, #187, #198, #200 — chosen
as one set because they share a single user-visible complaint: **a throng terminal needs a nudge
before it behaves.** A resize to show what is in the buffer, a `PageUp` to make the wheel work, a
click-and-retype to recover a lost character.

**Feature number**: 028. The number 027 is *not* free — it was consumed by the merged
`feature/S027-I161-stranded-editor-recovery` work (issues #161, #201), whose spec directory was never
committed. 027 is deliberately left as a gap rather than reused, exactly as 022 is.

**Explicitly out of scope**: #164 (throng's global chords fire inside a focused terminal, so `Ctrl+B`,
`Ctrl+N`, `Ctrl+F` and `Escape` never reach the shell). It is a keybindings-policy change — which
chords are *reserved* application-wide and which belong to the terminal — with its own constitutional
touchpoint (Principle IV's reserved/shadowable tiers). It gets its own spec.

---

## Why these five together

Four of the five are the same sentence with a different verb: the terminal does not do what the
buffer, the pointer or the keyboard says until something unrelated forces it to re-synchronise. #162
needs a resize, #187 needs a keypress, #163 asks for the nudge to become a real command instead of a
folk remedy, and #200 loses the keystroke that would have been the nudge. #198 is the odd one out —
it is about a gesture firing *twice* rather than not at all — but it lives in the same file, on the
same gesture surface, and its remaining unexplored hypothesis (the alternate screen buffer) is the
same buffer #162 and #187 both implicate.

Two of them carry findings that contradict their own issue bodies, and this spec is written to those
findings rather than to the original reports:

- **#198 does not reproduce as reported.** Measured on `08d0fdc` at the single `openExternal` seam,
  all four link shapes opened exactly once. The stated mechanism — two registered handlers both
  firing — is not possible on the normal screen buffer, because a registered link provider is only
  consulted where no OSC 8 link already matched. Four "exactly once" cases are already committed as
  regression fences (`packages/ui/tests/e2e/terminal-link-once.e2e.ts`, merged to master). The
  unexamined case is the **alternate screen**, which is where Claude Code actually runs, and which no
  scripted shell has yet produced a clickable link on.
- **#162 is very unlikely to be a render-layer fault.** A repaint of every visible row from the
  buffer already runs on a 2-second interval for every visible terminal and does not clear the
  corruption, while a resize clears it instantly. That points at the buffer's own wrap/reflow state,
  not at what is drawn from it. A previous attempt to suppress repaints on a UI condition was tried
  during feature 024 and reverted, because it could suspend the self-heal indefinitely.

**New evidence from the reporter (2026-07-31), which narrows #162 considerably.** The corruption is
not diffuse: it correlates with **tab activation**. With an agent session running in each of two tabs
of the same project (or of a parent project), switching between those tabs **almost always** leaves
the newly-shown terminal mis-rendered, and a manual resize is needed **every time**. That reframes
#162 from "terminals drift over time" to "a terminal that was hidden comes back wrong", and it names
the seam: whatever the character grid and wrap state do while a tab is not showing, they are not
reconciled when it shows again. The reporter's proposed remedy — redraw the terminals in a tab when
that tab is opened — is recorded here as the leading candidate; FR-013 still requires the cause to be
measured before it is adopted, because a redraw on activation that hides a stale-grid cause would
paper over the same fault everywhere else it can occur.

**The tabs are also differently laid out**, which is the second half of the same evidence: the
terminals being switched between sit in different panel geometry — one tiled in a quadrant with other
panels, another filling its tab or resized by hand — so they have different natural column counts.
A wrong-column render is exactly what a panel would show if, on becoming visible, it were briefly or
lastingly driven by a column count that is not its own. That makes **grid identity across a hidden
period** the sharpest available hypothesis, above "the drawing is stale": the symptom is not only
that old pixels survive, it is that the new ones are laid out to the wrong width. A reproduction with
two identically-sized tabs would very likely show nothing at all, which is why FR-019a makes
differing geometry a required condition of the test rather than a detail of the anecdote.

Both facts are load-bearing: they make "repaint harder" and "de-duplicate the two link handlers" the
two most tempting fixes, and both would be fixes to something that is not happening. Where this spec
and an issue body disagree, **this spec is authoritative**, and the correction is recorded on the
issue.

Consequently this feature is **diagnosis-gated**: each defect's cause must be replicated and stated
before its fix is designed (Constitution Principle V — red before green). A cause that cannot be
replicated does not get a speculative fix; it gets the invariant fenced and the issue returned to the
tracker with the measurement attached.

---

## Clarifications

### Session 2026-07-31

- Q: What should the mouse wheel do over a full-screen (alternate-screen) program that has not claimed
  mouse reporting? → A: Translate wheel notches into up/down arrow key presses sent to the program,
  as Windows Terminal and xterm do — the alternate screen has no scrollback of its own, so the wheel
  drives the program's list or pager rather than moving the view.
- Q: Should throng record when it reconciles a terminal or detects lost input? → A: Yes, as cheap
  in-memory diagnostic counters that are off (unsurfaced) by default — reconciliations by trigger,
  backstop firings, and input written versus acknowledged — readable by tests so the feature's
  invariants can be asserted rather than merely observed.
- Q: What is the budget for the extra work tab activation now does? → A: No more than about 16ms of
  main-thread work per activation (one frame at 60Hz) for a tab of up to four terminals, and it MUST
  NOT block the switch — the tab appears immediately and already correct.
- Q: If no automated test can put a clickable link on the alternate screen, what is acceptable for
  #198? → A: A hand-verified check, gated on the maintainer. The maintainer must have understood the
  ticket and personally performed the verification; their confirmation — not the implementer's
  report — is what settles #198's disposition. Automation covers what it can reach, and what it
  cannot is stated plainly rather than implied.
- Q: Does feature 028 ship as one increment, or in stages? → A: One branch and one spec, ordered so
  each story reaches an independently green, mergeable state: shared diagnosis first, then the P1s
  (#162, #200), then the P2s (#187, #163), then #198. A story blocked on an upstream decision MUST
  NOT hold the finished ones back.
- Q: What does a redraw target — for the manual action, and for tab activation? → A: Manual targets
  one terminal (the one whose menu was opened, or the focused one for the chord); tab activation
  reconciles every terminal in the tab becoming visible.
- Q: Should a view in a hidden tab still constrain the shared grid of a mirrored terminal? → A: No.
  The agreed grid is the minimum across the views the user can currently **see**; a view in an
  inactive tab or a collapsed pane does not constrain it, and re-joins the calculation when it
  becomes visible — which is already a reconciliation point.
- Q: How should the intermittent #200 fix be proven, given the repetition cost? → A: Split. A fast
  deterministic test that forces the identified losing condition runs in the normal suite as the
  merge gate, across every flavour; the heavy repetition soak (SC-003) stays in the repo as an
  opt-in run, executed on demand and before this feature merges, not on every pull request.
- Q: Should a periodic background self-heal survive once activation reconciliation lands? → A: Yes,
  but demoted. Reconciliation is event-driven (becoming visible, resize, re-attach, alt-screen exit)
  and one deliberately slow, cheap periodic pass is retained as a backstop for causes not yet
  identified, running only for terminals the user can see. FR-012's bounded interval is that
  backstop's period.
- Q: If #162's measured cause is upstream (terminal engine, ConPTY, or the program itself), what
  closes the issue? → A: Not decided in advance. The cause is presented to the maintainer, who is
  then guided through verifying it hands-on; the disposition (mitigate and close, mitigate and keep
  open, or escalate) is decided at that checkpoint. If an upstream report is warranted, the feature
  produces a standalone write-up with exact reproduction steps that do not involve throng, and a
  minimal reproduction project where one can be built.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what is actually in the terminal, without touching a divider (Priority: P1)

A user works in a terminal panel for an hour — a long agent session, a build, anything that produces
screens of full-width output. The panel gradually stops showing the truth: glyphs sit on top of one
another, fragments of earlier frames survive, and lines wrap at a column that is not the panel's
edge, leaving the prompt and caret in the wrong place. The only cure they have found is to drag a
panel divider a pixel or two, at which point everything snaps correct.

The most reliable way to see it is to switch tabs. With a long-running session in a terminal in each
of two tabs of the same project, activating a tab almost always shows a corrupted terminal, and the
user resizes to fix it **every single time they switch**.

The tabs are **not laid out identically**, and that appears to be part of it: one terminal sits in a
quadrant beside other panels, another fills its tab, another has been dragged to a size the user
chose. So the two terminals being switched between have **different panel geometry**, and therefore
different natural column counts.

**Why this priority**: This is the defect the user hits most often and the one that makes the
application feel unreliable. The terminal is throng's core surface; a terminal that misreports its
own contents undermines every other thing the product does well. The workaround also disturbs the
layout the user deliberately arranged. Tab switching is a constant action, so the cost is paid
constantly.

**Independent Test**: With a long-running program producing full-width output in a terminal in each
of two tabs **whose panels are deliberately different sizes** — one in a quadrant beside other
panels, one filling its tab or manually resized — switch between the tabs repeatedly and confirm
every newly-shown terminal is rendered correctly at the moment it appears, with no resize, no divider
drag and no keypress. Delivers #162 alone.

**Acceptance Scenarios**:

1. **Given** two tabs of one project, each holding a terminal running a program that produces
   full-width output, **and** the two terminal panels are different sizes (different split geometry
   or a manual resize), **When** the user switches from one tab to the other, **Then** the terminal
   in the newly-shown tab is rendered correctly the moment it appears — correct wrapping for *its
   own* width, no overlapped or stale cells — with no user action.
2. **Given** the same two tabs, **When** the user switches back and forth repeatedly, **Then** every
   switch shows a correct render; there is no accumulating drift and no switch that needs a resize.
3. **Given** a tab whose terminal panel was resized by the user, **When** the user switches away and
   back, **Then** the terminal still wraps at the size the user left it at, not at the size of
   anything in the other tab.
4. **Given** a tab whose terminal shares its tab with other panels in a quadrant layout, **When** it
   is activated, **Then** it wraps at its own quadrant's width — not at the width of a terminal that
   fills a different tab.
5. **Given** a terminal panel that has produced several screens of full-width output, **When** the
   user reads the panel without touching anything, **Then** every visible row matches the terminal's
   buffer contents — no overlapped glyphs and no fragments of an earlier frame.
6. **Given** a terminal panel of a known width, **When** a program prints lines longer than that
   width, **Then** the lines wrap at the panel's own column count and the caret sits where the shell
   believes it to be.
7. **Given** the same terminal presented in two panels at different sizes, **When** output arrives,
   **Then** both views show the same buffer, wrapped consistently with the grid the application has
   agreed for that terminal, and neither view sizes itself independently of the other.
8. **Given** a terminal that has entered the mis-rendered state, **When** no user action is taken,
   **Then** the panel returns to a correct render within a bounded, stated interval — the self-heal
   is not merely "eventually".
9. **Given** a program switches to and back from a full-screen (alternate screen) mode, **When** it
   returns, **Then** no cells from the full-screen program survive underneath the restored view.
10. **Given** a tab whose terminals were hidden while the user worked elsewhere for several minutes,
    **When** the tab is activated, **Then** the terminals show their true current contents, not a
    frame from before they were hidden.
11. **Given** a terminal mirrored into a wide visible panel and a narrow panel in a hidden tab,
    **When** output arrives, **Then** the visible panel uses its own full width — the hidden mirror
    does not squeeze it.
12. **Given** that same hidden tab, **When** it is activated so both mirrors are visible at once,
    **Then** the terminal settles on the grid the application agrees for the visible pair, and both
    views render correctly at it.

---

### User Story 2 - Type into an idle panel and have every character arrive (Priority: P1)

A user leaves a terminal panel alone for several minutes while working elsewhere in throng, comes
back, clicks into it and types `git status`. The shell receives `it status`. The first character is
gone — not merely unrendered, but never delivered — and the user usually types several more
characters before noticing.

**Why this priority**: Every other defect in this feature is visible the moment it happens. This one
is **silent divergence between what the user typed and what the machine ran**, in a surface whose
entire purpose is to run what the user typed. It is intermittent, which makes it both hard to trust
away and hard to catch. A dropped character can turn a benign command into a different, valid one.

**Independent Test**: Idle a panel, activate it, type immediately, and assert the shell received
every character — repeatedly, because a single pass proves nothing about an intermittent fault.
Delivers #200 alone.

**Acceptance Scenarios**:

1. **Given** a terminal panel left idle for several minutes, **When** the user clicks into it and
   types immediately, **Then** the shell receives every character in order, with none dropped.
2. **Given** the same idle panel, **When** the user reaches it by keyboard rather than by click and
   types immediately, **Then** every character still arrives.
3. **Given** an idle panel in each supported shell flavour, **When** the sequence is repeated many
   times, **Then** the character-loss rate is zero across all runs — not merely low.
4. **Given** a panel reached after a tab switch, a project switch, or an application restart with the
   session re-attached, **When** the user types immediately, **Then** every character arrives.
5. **Given** a character is delivered to the shell, **When** the panel renders, **Then** the echo of
   that character appears — a character that arrives but is never shown is also a failure of this
   story, and the two cases are distinguished in the diagnosis rather than conflated.

---

### User Story 3 - Scroll a terminal with the wheel, from the first frame (Priority: P2)

A user opens a terminal panel, lets it produce more than a screen of output, and scrolls the mouse
wheel over it. Nothing happens. After they press an unmodified `PageUp` and `PageDown` — keys the
running program handles, not throng's scrollback binding — the wheel starts working and keeps
working for the rest of the session.

**Why this priority**: The wheel is the reflexive way to look back at output, and its silence is
indistinguishable from "there is nothing to scroll". It is ranked below the first two because a
workaround exists that costs one keypress and the state, once unstuck, stays unstuck. throng has
already fixed one instance of this exact failure mode for newly-opened panels; this is the same
symptom surviving that fix in another situation.

**Independent Test**: Open a panel, generate more than a screen of output, and scroll the wheel
without pressing any key first. Delivers #187 alone.

**Acceptance Scenarios**:

1. **Given** a terminal panel with more than a screen of output, **When** the user scrolls the wheel
   over it having pressed no key at all, **Then** the view scrolls.
2. **Given** a panel that has been resized, re-attached, or moved to another window, **When** the
   user scrolls the wheel, **Then** it scrolls.
3. **Given** a program running in the terminal has genuinely claimed mouse reporting, **When** the
   user scrolls the wheel, **Then** the wheel events go to that program and the view does not scroll
   — and this case is identified as correct behaviour rather than counted as the defect.
4. **Given** any of the above, **When** the user holds the zoom modifier and scrolls, **Then** the
   panel zoom changes exactly as it does today and the view does not scroll.
5. **Given** a full-screen program that has not claimed mouse reporting, **When** the user scrolls the
   wheel, **Then** the program receives up/down arrow key presses and moves its own list or pager;
   the view itself does not scroll.
6. **Given** a shell at its prompt on the normal screen, **When** the user scrolls the wheel, **Then**
   the view scrolls through scrollback and **no** characters or key presses reach the command line.

---

### User Story 4 - Fix a bad render on purpose, from a menu (Priority: P2)

A user whose terminal has gone wrong wants to correct it deliberately. Today the only cure is to drag
a divider a pixel or two — an accidental discovery, undiscoverable to anyone who has not been told,
dependent on landing a mouse drag precisely enough to change the character grid, and destructive to
the layout they arranged.

**Why this priority**: This is the escape hatch that keeps the product usable for whatever User Story
1's fix does not catch, and it turns a folk remedy into a named, discoverable action. It is ranked
below the defects themselves because it is a mitigation, not a cure — but it is wanted regardless of
how well the cure works.

**Independent Test**: Invoke the action from each of its two menus on a terminal in the bad state and
confirm the render is corrected with nothing else disturbed. Delivers #163 alone.

**Acceptance Scenarios**:

1. **Given** a terminal panel, **When** the user opens the right-click menu over the terminal itself,
   **Then** a "Refresh / redraw terminal" action is present.
2. **Given** the same panel, **When** the user opens the panel header's context menu, **Then** the
   same action is present, named identically.
3. **Given** a terminal exhibiting the mis-render, **When** the user invokes the action, **Then** the
   view is corrected — verified against a case that a bare repaint demonstrably does not fix.
4. **Given** a terminal with scrollback, a selection, a cursor position and focus, **When** the user
   invokes the action, **Then** none of those change: no scrollback is lost, nothing is cleared, the
   selection and cursor survive, and focus stays where it was.
5. **Given** a program is running in the terminal, **When** the user invokes the action, **Then** the
   program is not interrupted and no input is injected into the shell.
6. **Given** the arranged layout, **When** the user invokes the action, **Then** no panel changes
   size and the layout is untouched.
7. **Given** a perfectly healthy terminal, **When** the user invokes the action several times in a
   row, **Then** nothing visible changes and nothing is disturbed.
8. **Given** a focused terminal panel, **When** the user presses `Ctrl+F5`, **Then** that terminal is
   redrawn exactly as the menu entries redraw it.
9. **Given** a focused editor panel or the file tree, **When** the user presses `Ctrl+F5`, **Then**
   nothing happens and the key is not consumed on their behalf.
10. **Given** the preferences editor, **When** the user looks for the action, **Then** it is listed
    like every other command and its chord can be changed or cleared.

---

### User Story 5 - Click a link once, open it once (Priority: P3)

A user Ctrl+clicks a URL printed by an agent session in a terminal panel and two browser tabs open.

**Why this priority**: Lowest, and deliberately so — **the reported defect does not currently
reproduce**. Four link shapes were measured at the single opening seam and each opened exactly once,
and the mechanism the issue proposes is not possible on the normal screen buffer. What remains is one
unexamined condition (the alternate screen, where agent sessions actually run) and two alternative
explanations (the same URL genuinely printed twice; a double-open originating above the terminal).
The user-visible harm is also the mildest in the set: a duplicate browser tab.

**Independent Test**: Reproduce a link on the alternate screen and count openings at the single seam
every route converges on. Delivers #198 alone — or retires it with evidence.

**Acceptance Scenarios**:

1. **Given** a hyperlink whose visible text is the URL, on the **alternate screen**, **When** the user
   Ctrl+clicks it once, **Then** the browser is asked to open it exactly once.
2. **Given** a plain-text URL with no hyperlink wrapper, **When** the user Ctrl+clicks it once,
   **Then** the browser is asked to open it exactly once.
3. **Given** a hyperlink whose visible text is *not* the URL, **When** the user Ctrl+clicks it once,
   **Then** the browser is asked to open its target exactly once — the destination, not the text.
4. **Given** any link, **When** the user hovers it, **Then** the hover underline and tooltip appear
   once, and neither hover nor click is registered by two mechanisms.
5. **Given** any link, **When** the user clicks it without the modifier, **Then** the click keeps its
   ordinary terminal meaning and nothing is opened.
6. **Given** a link whose scheme is not `http`/`https`, **When** the user Ctrl+clicks it, **Then**
   nothing is opened.
7. **Given** the alternate-screen case is measured and **does not** double-open, **Then** the
   measurement is recorded on the issue with the conditions tested, the invariant stays fenced by
   tests, and no de-duplication is built for a fault that has not been observed.
8. **Given** the alternate-screen condition cannot be reached by automation, **When** the disposition
   of #198 is decided, **Then** it rests on the maintainer's own hand-verified check, made after they
   have been briefed on the report, both measurements, and exactly what to look for — and the
   automation gap is stated in writing rather than left implied.

---

### Edge Cases

- **A terminal that is never looked at.** A panel in a background tab or a collapsed pane must not be
  paying the cost of a self-heal it cannot show, and must be correct the moment it becomes visible.
- **A tab holding many terminals, activated.** Whatever happens on activation runs for every terminal
  in that tab at once; it must not make tab switching feel slow, flash, or reorder output.
- **Rapid tab switching.** Switching away before an activation reconciliation has finished, or
  flicking through several tabs quickly, must leave every terminal correct and none mid-reconcile.
- **A tab activated while its terminal is producing output**, and a tab activated when its terminal
  has been silent for an hour — both must show the truth immediately.
- **A tab activated in a window that is not focused**, and a window restored from minimised with a
  terminal tab already active.
- **Two views of one terminal at different widths.** The application agrees a single grid for a
  terminal presented more than once; a view must never size itself independently. The question this
  feature must answer is whether the agreed grid, applied to a wider view, is itself a cause of
  wrong-column wrapping — the "different tabs of the same project" case in the report.
- **Two *independent* terminals in differently-sized tabs.** This is the reporter's actual case and it
  is not the mirrored one: two separate terminals, each with its own correct width, where switching
  between them still corrupts the render. A cause that only explains mirrored views does not explain
  this, and the diagnosis must say which it observed.
- **A tab whose layout changed while it was hidden** — a panel closed, a split added, the window
  resized — and a tab hidden at one window size and shown at another.
- **The last visible view of a mirrored terminal being hidden.** With no visible view at all, the
  terminal still needs a defined grid; it must not collapse, jump to a default, or reflow its
  scrollback into a size no user ever saw.
- **A mirrored view becoming visible at a narrower size**, which legitimately shrinks the agreed grid
  for every other view — a grid change the user did cause, and which must reflow cleanly rather than
  corrupt.
- **A mirrored view versus a second, independent terminal.** The two have different causes and the
  diagnosis must state which it observed.
- **A terminal whose program is on the alternate screen.** Implicated in three of the five defects;
  its behaviour for wheel, redraw and link activation must be stated deliberately rather than
  inherited.
- **A redraw invoked while output is streaming.** No dropped bytes, no reordered output, no
  interruption of the running program.
- **A redraw invoked on a terminal whose process has exited.** The failure message and exit code
  already displayed must survive it.
- **An idle panel that is activated and immediately destroyed**, or activated twice in quick
  succession — no character may be delivered to the wrong terminal.
- **A character delivered while a session is re-attaching.** Output is already gated during attach;
  input has no such gate, and the feature must establish whether one is needed or whether input is
  ordered by another guarantee.
- **A wheel scroll over a terminal with no scrollback at all** — nothing to scroll is not the same as
  a dead wheel, and the tests must distinguish them.
- **The same URL printed twice on one line**, which is two legitimate targets rather than one
  double-opening target.

---

## Requirements *(mandatory)*

### Cross-cutting

- **FR-001**: Each defect in this feature (#162, #187, #198, #200) MUST have its cause **replicated
  against the running application and stated in writing** before its fix is designed. A fix MUST NOT
  be built against an inferred mechanism that measurement has not confirmed.
- **FR-002**: Where a stated cause is contradicted by measurement, the contradiction MUST be recorded
  **on the issue** as well as in this feature's artifacts, so the correction is not confined to a
  branch.
- **FR-003**: A defect whose cause cannot be replicated MUST NOT receive a speculative fix. Its
  required invariant MUST instead be fenced by tests, and the issue returned to the tracker with the
  measurement and the conditions tested.
- **FR-004**: No change in this feature MAY let a view of a terminal choose its own grid independently
  of the other views of that same terminal. The application agrees one grid per terminal and
  broadcasts it; that rule is preserved.
- **FR-004a**: The agreed grid is derived from the views the user can **currently see**. A view in an
  inactive tab, a collapsed pane, or a hidden window MUST NOT constrain it. A terminal MUST NOT be
  squeezed by a panel nobody is looking at.
- **FR-004b**: A hidden view **re-joins** the calculation when it becomes visible, at which point the
  agreed grid is recalculated and broadcast — the same moment FR-017 already requires a
  reconciliation. Becoming visible is therefore expected to be a grid change, not merely a repaint,
  and MUST be tested as one.
- **FR-004c**: FR-004a MUST NOT be implemented as a view sizing itself. The set of contributing views
  changes; the rule that one authority agrees the grid and broadcasts it does not.
- **FR-005**: No change in this feature MAY suppress the terminal's self-heal on a transient user-
  interface condition (such as hovering). That approach was tried and reverted because it can suspend
  the self-heal indefinitely — the exact symptom this feature exists to remove.
- **FR-006**: Every defect in this feature — #162, #187, #198, #200 — MUST have an **end-to-end test
  that reproduces it**, driving the real application through the user's own sequence of actions. Each
  such test MUST fail against the unfixed behaviour and pass against the fixed one, and MUST be part
  of the automated suite rather than a one-off measurement.
- **FR-006a**: A reproduction test MUST be **deterministic**, not opportunistic. It MUST establish the
  conditions the defect needs — the idle interval, the tab switch, the **differing panel geometry
  between the tabs**, the full-width output, the screen buffer — rather than waiting for the fault to
  happen to occur. Where the defect is intermittent, the
  test MUST repeat the sequence enough times to make a passing run meaningful (FR-024), and the
  repetition count MUST be stated.
- **FR-006b**: A reproduction test MUST assert on the state that actually diverged — the characters
  the shell received, the cells the terminal is showing against what its buffer holds, the count of
  open requests — and MUST NOT settle for a proxy that a broken build could still satisfy.
- **FR-006c**: Every user-facing behaviour changed or added by this feature (including the redraw
  action's two menu entries) MUST ship with its own end-to-end coverage, independently of the
  reproduction tests.
- **FR-006d**: Finding a reproduction is **exploratory, and the exploration is expected to be wide**.
  As many end-to-end probes MAY be written as it takes to make each defect fail on demand — varying
  the conditions (tab geometry, idle duration, screen buffer, output shape, flavour, activation path)
  until one of them reddens. A probe that produces no useful failure MUST then be **removed**: the
  suite keeps what earns its place, not the search that found it.
- **FR-006e**: FR-006d MUST NOT be used to delete a test that **passes for a reason**. A probe that
  found nothing is scaffolding and goes; a test that pins an invariant the feature relies on — the
  "exactly once" link cases are the standing example — is a fence and stays, whether or not it ever
  went red here. The distinction is whether the test would catch a future regression, not whether it
  caught this one.
- **FR-006f**: Conditions that were probed and produced **no** failure MUST be recorded on the issue
  alongside the reproduction that worked. A ruled-out condition is a measurement, and deleting the
  probe without recording it discards the only evidence that it was tried.
- **FR-007**: Terminal behaviour required here MUST hold for every shell flavour the application
  supports, not only the flavour named in the report.
- **FR-007a**: The five stories MUST be ordered so that each reaches an **independently green,
  mergeable state** — shared diagnosis first, then the P1s, then the P2s, then #198. Every such point
  MUST leave the application shippable, with no half-applied change to the terminal's render or input
  path.
- **FR-007b**: A story blocked on a decision outside the team's control — the FR-003a checkpoint above
  all — MUST NOT hold back the stories that are finished. It is carved out and the rest proceeds.
- **FR-003a**: When a diagnosis lands on a cause **outside throng** — the terminal engine, the
  platform's console layer, or the program running in the terminal — the finding MUST be brought to
  the maintainer as a **decision checkpoint** before the disposition is chosen. The feature MUST NOT
  decide on its own whether to mitigate and close, mitigate and keep the issue open, or escalate.
- **FR-003b**: At that checkpoint the maintainer MUST be **guided through verifying the cause
  hands-on** — given the sequence to run and what to look for — rather than asked to accept a written
  conclusion.
- **FR-003c**: Where the checkpoint decides to escalate, the feature MUST produce an **upstream-ready
  report**: a plain statement of the defect, and **exact, standalone reproduction steps that do not
  involve throng** and can be followed by someone who has never seen it. A report that can only be
  reproduced inside throng is not upstream-ready.
- **FR-003d**: Where the defect can be demonstrated by a small standalone project, that **minimal
  reproduction** MUST be produced alongside the report — it is what makes an upstream issue
  actionable rather than anecdotal.
- **FR-009**: The application MUST keep **in-memory diagnostic counters** for the behaviour this
  feature governs: reconciliations performed, broken down by what triggered them (becoming visible,
  resize, re-attach, alt-screen exit, manual action, backstop); backstop firings; and input written
  versus input acknowledged by the terminal.
- **FR-009a**: These counters MUST be cheap enough to leave permanently on — no allocation per
  keystroke, no work proportional to output volume — and MUST NOT be surfaced in ordinary use. They
  are read by diagnostics and by tests, not shown to users.
- **FR-009b**: The counters MUST be readable by the automated tests, so this feature's invariants can
  be **asserted** rather than eyeballed. FR-014b in particular (a reproduction must not pass merely
  because the backstop fired) MUST be enforced by asserting the backstop counter did not advance
  during the run.
- **FR-009c**: A counter MUST NOT become the acceptance criterion in place of the user-visible
  outcome. What is asserted is the rendered state and the characters the shell received; the counters
  explain *why* a test passed, and catch the cases where it passed for the wrong reason.
- **FR-008**: Taking `Ctrl+F5` (FR-049a) adds a chord throng consumes inside a terminal. The
  constitution enumerates its shadowable-tier exceptions by name, so this feature MUST amend that
  enumeration in the same increment that ships the binding — the list of what throng takes from the
  terminal MUST NOT silently fall out of date.

### Correct render without a nudge (#162)

- **FR-010**: A terminal panel MUST present, at all times, what its buffer actually contains: no
  overlapped or smeared cells, and no fragments left from an earlier frame.
- **FR-011**: A terminal's lines MUST wrap at the column count of the grid agreed for that terminal,
  and the caret MUST sit where the shell believes it to be.
- **FR-012**: A terminal that enters a mis-rendered state MUST return to a correct render **without
  any user action**, within a stated bounded interval.
- **FR-013**: The identified cause MUST be stated explicitly as one of — the buffer's wrap/reflow
  state, the drawing layer, or the agreed-grid rule applied across differently-sized views — and the
  fix MUST address that cause rather than repainting more often or more aggressively.
- **FR-014**: Reconciliation MUST be **event-driven**: a terminal is reconciled when something
  happens that can invalidate its render — it becomes visible, it is resized, its session is
  re-attached, or a full-screen program exits. These events, not the passage of time, are the primary
  mechanism.
- **FR-014a**: A single **periodic backstop** MUST be retained for causes not yet identified, and MUST
  be deliberately modest: it runs only for terminals the user can currently see, costs little enough
  to be unnoticeable under heavy output, and does the work the diagnosis shows actually clears the
  fault rather than the repaint that demonstrably does not. Its period is the bounded interval
  FR-012 requires to be stated.
- **FR-014b**: The backstop MUST NOT be the primary mechanism, and MUST NOT be relied on to hide a
  missing event trigger. If a reproduction only passes because the backstop eventually fires, the
  event coverage is incomplete and the reproduction MUST be treated as failing.
- **FR-014c**: Today's periodic repaint MUST NOT be retained unchanged merely because it exists. The
  evidence is that it does not fix these symptoms; it is either replaced by the FR-014a backstop or
  removed.
- **FR-015**: Correct rendering MUST hold when the same terminal is presented in two panels of
  different sizes, in different tabs of one project, and in different windows.
- **FR-016**: No self-heal introduced or retained here MAY cost measurable responsiveness in a
  terminal receiving heavy output, and MUST NOT run for a terminal the user cannot currently see.
  *(Refined by measurement, 2026-07-31: an inactive tab does not hold hidden terminals — its panels
  are unmounted entirely, so this clause bites only for a collapsed pane or a hidden window. The
  requirement stands; its scope is narrower than assumed when written. Same correction applies to
  FR-004a: a view in an inactive tab has already detached, so it cannot constrain the agreed grid.)*
- **FR-017**: A terminal panel that **becomes visible** — its tab is activated, its pane is expanded,
  its window is restored or re-focused — MUST present a correct render at the moment it becomes
  visible: correct wrapping for the grid agreed for that terminal, and no cells surviving from before
  it was hidden. This MUST hold without any user action and without the user perceiving a corrupted
  frame first.
- **FR-017a**: Activation reconciles **every terminal in the tab becoming visible**, not only the
  focused one. A tab holding four terminals in a quadrant presents four correct terminals; a terminal
  the user has not focused MUST NOT be left wrong until they click it.
- **FR-017b**: Activation reconciliation MUST NOT block the switch. The tab MUST appear immediately
  and already correct — the user MUST NOT see a pause before it opens, nor a corrupted frame that
  settles a moment later. Its cost is bounded by SC-012.
- **FR-018**: A terminal that is hidden MUST NOT be left in a state its view cannot recover from on
  its own. Whatever reconciliation a becoming-visible panel needs MUST be performed by the
  application as part of activation — the user MUST NOT be the mechanism that triggers it.
- **FR-019**: FR-017 MUST hold when each of two tabs of one project holds its own terminal running a
  long-lived program, switched between repeatedly — the reporter's case, and the reproduction
  required by FR-006. It MUST equally hold for tabs of a parent project, and for a terminal mirrored
  into more than one tab.
- **FR-019a**: The reproduction for FR-019 MUST give the two tabs **different terminal panel
  geometry** — one terminal tiled beside other panels (a quadrant layout), the other filling its tab
  or manually resized — because the reporter's case is not two identical tabs and a reproduction with
  matching sizes would very likely miss the fault entirely.
- **FR-019b**: A terminal MUST wrap at the width of **its own** panel. A panel becoming visible MUST
  NOT adopt, even briefly, a column count belonging to a panel in another tab, to the tab that was
  just hidden, or to a size the panel held before the user resized it. The one legitimate exception
  is a terminal genuinely **mirrored** into more than one *visible* view, which is bound by its agreed
  grid (FR-004/004a) — a hidden mirror is not such a case.
- **FR-019c**: A panel's size, and any manual resize the user applied to it, MUST survive being hidden
  and re-shown. The terminal MUST come back at the size the user left it at.

### Every keystroke arrives (#200)

- **FR-020**: Every character the user types into a focused terminal panel MUST be delivered to the
  shell, in order, however long that panel has been idle.
- **FR-021**: FR-020 MUST hold whether the panel is activated by pointer or by keyboard.
- **FR-022**: FR-020 MUST hold after a tab switch, a project switch, and an application restart with
  the session re-attached.
- **FR-023**: The diagnosis MUST state **where** a lost character is lost — before it reaches the
  terminal process, inside it, or only in the echo — and the two failure shapes (missing from the
  shell versus missing only from the display) MUST be distinguished by the tests, not conflated.
- **FR-024**: Coverage for this defect MUST be **repeated**, because the fault is intermittent: a
  single passing attempt is not evidence, and the acceptance measure is zero losses across many
  repetitions.
- **FR-024a**: That repetition MUST be split into two tests with different jobs. A **fast gate**
  forces the identified losing condition deliberately, covers every shell flavour, and runs in the
  normal suite on every change. A **soak** performs the full repetition count of SC-003 and is
  **opt-in**: kept in the repository, run on demand, and run before this feature merges — not on
  every pull request.
- **FR-024b**: The fast gate MUST NOT be a shrunken soak that hopes to catch the fault by chance. It
  MUST trigger the cause on purpose, and MUST fail reliably against the unfixed behaviour — if it
  cannot, the cause is not yet understood well enough to gate on.
- **FR-024c**: The soak MUST state its repetition count and the flavours it covers in its own output,
  so a run's evidence is legible without reading its source.
- **FR-025**: No input MAY be delivered to a terminal other than the one the user is typing into,
  including while a panel is being activated, destroyed, or re-attached.

### Wheel scrolling (#187)

- **FR-030**: The mouse wheel MUST scroll a terminal panel that has scrollback from the first frame,
  with no prior keypress, click-through or other priming action.
- **FR-031**: FR-030 MUST hold after a panel is resized, re-attached, or moved to another window.
- **FR-032**: When a program running in the terminal has genuinely claimed mouse reporting, wheel
  events MUST go to that program. This MUST be identified as correct behaviour and MUST be
  distinguished in the tests from the defect.
- **FR-033**: The zoom-modifier wheel gesture MUST be unaffected.
- **FR-034**: The identified cause MUST be stated explicitly as one of — an unset viewport scroll
  area, alternate-buffer wheel handling, or application mouse tracking — and the fix MUST address
  that cause.
- **FR-035**: On the alternate screen, when the running program has **not** claimed mouse reporting,
  a wheel notch MUST be delivered to that program as an **up or down arrow key press**, so the wheel
  drives the program's own list, menu or pager. The alternate screen has no scrollback of its own, so
  moving the view is not the useful behaviour.
- **FR-035a**: FR-035 MUST NOT apply on the normal screen, where the wheel scrolls the view through
  scrollback (FR-030), and MUST NOT apply when the program **has** claimed mouse reporting, where the
  wheel event goes to the program unchanged (FR-032). The three cases MUST be separately tested.
- **FR-035b**: The number of key presses sent per wheel notch MUST be stated, MUST match the
  application's existing scroll-step convention, and MUST NOT be so large that one notch jumps the
  view unpredictably.
- **FR-035c**: Arrow keys synthesised by the wheel MUST be indistinguishable to the program from a
  real arrow key press, and MUST NOT be injected while the terminal is on the normal screen — a wheel
  gesture MUST NEVER put characters into a shell's command line.

### Deliberate redraw action (#163)

- **FR-040**: A **"Refresh / redraw terminal"** action MUST be available on the terminal's own
  right-click context menu.
- **FR-041**: The same action, under the same name, MUST be available on the terminal panel header's
  context menu.
- **FR-042**: Invoking the action MUST correct a terminal that is in the mis-rendered state,
  including at least one case that a plain repaint does not fix — the User Story 1 reproduction (two
  tabs of differing panel geometry, switched between) is that case.
- **FR-043**: The action MUST NOT lose scrollback, clear the screen, re-spawn the process, move focus,
  change the selection, or move the cursor.
- **FR-044**: The action MUST NOT interrupt a running program and MUST NOT inject any input into the
  shell.
- **FR-045**: The action MUST NOT change any panel's size or the layout.
- **FR-046**: The action MUST be safe to repeat: invoking it on a healthy terminal changes nothing
  visible.
- **FR-047**: The action MUST work even when the panel's measured size is unchanged — the case the
  user's manual nudge often is, and the case a size-change-only path would silently skip.
- **FR-048**: A hard terminal reset (clear and re-initialise) and re-spawning the process are **out of
  scope**; this action MUST NOT do either.
- **FR-049**: The action MUST be registered as a first-class, rebindable application command, so it is
  exposed by the preferences editors alongside every other command.
- **FR-040a**: The action targets **exactly one terminal**: the terminal whose own context menu was
  opened, or the terminal in the panel whose header menu was used. It MUST NOT touch any other
  terminal, including others in the same tab.
- **FR-049a**: The action MUST carry the default chord **`Ctrl+F5`**, dispatched in **terminal scope
  only** — it has no meaning in an editor or the file tree and MUST NOT be consumed there. Invoked by
  chord, it targets the **focused** terminal, and only that one.
- **FR-049b**: `Ctrl+F5` MUST NOT reach the shell while a terminal has focus, since throng consumes
  it. That is a deliberate shadow of a key a terminal program could otherwise receive, and it MUST be
  **recorded as a shadowable-tier exception** alongside the existing ones rather than taken silently.
  It MUST NOT take any key from the reserved tier.
- **FR-049c**: The chord is an **accelerator over** the two menu entries, never a substitute for them:
  both menu items remain present and remain the canonical way to find the action.
- **FR-049d**: Bare `F5` MUST NOT be taken. Terminal file managers and other full-screen programs bind
  the unmodified function keys heavily, and swallowing `F5` would remove a working key from them.

### One click, one open (#198)

- **FR-050**: A single modifier-click on a link MUST result in exactly **one** request to open it,
  for every link shape: a hyperlink whose visible text is the URL, a plain-text URL, and a hyperlink
  whose visible text differs from its target — on the normal screen **and on the alternate screen**.
- **FR-051**: Hover feedback (underline and tooltip) MUST appear for every link shape and MUST NOT be
  registered twice.
- **FR-052**: A click without the modifier MUST keep its ordinary terminal meaning and MUST open
  nothing.
- **FR-053**: Schemes other than `http` and `https` MUST still be refused.
- **FR-054**: Coverage MUST assert the count of openings at the **single seam every route converges
  on**, not the visible outcome, so a double open cannot hide behind a browser that reuses a tab.
- **FR-055**: The alternate-screen case MUST be measured before any de-duplication is designed. If it
  does not double-open, the invariants above stay fenced, the measurement is recorded on the issue,
  and no de-duplication is built (per FR-003).
- **FR-055a**: Automation MUST be attempted for the alternate-screen case and MUST cover as much of it
  as it can reach. Where it cannot reach the condition, that gap MUST be **stated plainly** in the
  feature's artifacts and on the issue — never implied by silence or absorbed into a green bar.
- **FR-055b**: #198's disposition MUST be gated on a **hand-verified check performed by the
  maintainer**, not by the implementer. The maintainer's own confirmation is what settles whether the
  defect is fixed, fenced, or retired.
- **FR-055c**: Before that check, the maintainer MUST be given what they need to **understand the
  ticket**: what was originally reported, what the two measurements showed, why the stated mechanism
  was ruled out, what condition remains untested, and exactly what to do and look for. The gate is
  informed confirmation, not a request to click something and say whether it looked right.
- **FR-055d**: This exception is confined to #198's alternate-screen condition. It MUST NOT be used to
  substitute manual verification for automated coverage anywhere else in this feature, and it does
  not relax FR-006 for the other four defects.

### Key Entities

- **Terminal**: one shell process owned by one project, presented by one or more panel views. Holds
  the buffer, the scrollback, the agreed grid, and which screen (normal or alternate) is active.
- **Panel view**: one on-screen presentation of a terminal. Owns view-only state — what is visible,
  the selection, zoom, focus — and never owns the grid.
- **Agreed grid**: the single column/row size the application decides for a terminal and broadcasts to
  every view of it. Authoritative over any individual view's measurement.
- **Redraw action**: a named, rebindable command that re-synchronises a panel view with its terminal
  without altering the terminal's content, process or the layout.
- **Reconciliation trigger**: the reason a terminal was re-synchronised — becoming visible, a resize,
  a re-attach, a full-screen program exiting, the manual action, or the periodic backstop. Counted
  per trigger (FR-009) so a test can tell which mechanism did the work.
- **Link activation**: one user gesture on one link, which must result in exactly one open request
  regardless of how many mechanisms recognised the link.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a one-hour session of continuous full-width output, a terminal panel requires
  **zero** manual resizes to show its true contents.
- **SC-002**: After a terminal is driven into the mis-rendered state, it returns to a correct render
  with no user action within a stated interval, in **100%** of attempts across repeated runs.
- **SC-003**: Across at least 50 repetitions per shell flavour of "idle for minutes, activate, type
  immediately", **zero** characters fail to reach the shell. This is measured by the opt-in soak
  (FR-024a), run before the feature merges; the everyday gate is the fast deterministic test, which
  must fail against the unfixed behaviour.
- **SC-004**: The mouse wheel scrolls a terminal with scrollback on the **first** attempt, with no
  key pressed beforehand, in every supported flavour and after resize, re-attach and move-to-another-
  window.
- **SC-005**: A user who has never been told about the divider trick can find the redraw action from
  the terminal or its panel header in **one** menu opening.
- **SC-006**: Invoking the redraw action leaves scrollback length, selection, cursor position, focus,
  panel sizes and the running program **unchanged**, measured before and after.
- **SC-007**: One modifier-click produces exactly **one** open request for every link shape on both
  screen buffers — measured at the single converging seam, not inferred from the browser.
- **SC-008**: Every fix in this feature is accompanied by a written statement of its cause, and each
  defect carries an end-to-end reproduction test that fails against the unfixed behaviour and passes
  against the fixed one — four defects, four reproductions, zero exceptions.
- **SC-011**: Across at least 20 consecutive switches between two tabs of one project — each holding a
  terminal running a long-lived full-width program, **in panels of deliberately different sizes** —
  **100%** of the newly-shown terminals render correctly on arrival, each wrapped at its own panel's
  width, and **zero** resizes are needed.
- **SC-012**: Activation reconciliation costs no more than **~16ms** of main-thread work per
  activation — one frame at 60Hz — for a tab holding up to four terminals, and **never blocks the
  switch**: the tab appears immediately, already correct, with no perceptible pause and no visible
  reflow settling after it is shown.
- **SC-009**: A terminal under heavy output shows no measurable loss of responsiveness attributable to
  any self-heal introduced or retained here.
- **SC-010**: No defect in this set requires the user to perform an unrelated action — a resize, a
  keypress, a re-click — before the terminal behaves correctly.

---

## Assumptions

- **The five issues share a surface, not necessarily a cause.** They are bundled because they present
  as one complaint and live in one area, and because #200 explicitly names #162 and #187 as possible
  siblings. If diagnosis shows a single common cause (activation/attach, or the alternate screen), so
  much the better; the spec does not assume it and each story is independently testable and
  deliverable.
- **The alternate screen is the leading suspect for #198**, because it is where agent sessions run and
  the only condition not yet measured. If the defect reproduces there, the fix is scoped to it; if it
  does not, FR-003 and FR-055 govern.
- **"Diagnosis stated" means written into this feature's artifacts and onto the issue** — not merely
  understood by whoever wrote the fix.
- **The redraw action is exposed by menus, and additionally registered as a rebindable command** so it
  satisfies the configuration-editor completeness rule. It ships with **`Ctrl+F5`** as its default
  chord (FR-049a), chosen on 2026-07-31 after checking the shipped bindings: `F2`, `F3`, `Shift+F3`,
  `F11` and `Shift+F10` are taken, and both `F5` and `Ctrl+F5` are free. It reads as "hard refresh"
  from browsers and Visual Studio, and is far less trafficked in terminal programs than the bare
  function keys. The terminal's keyboard is contested territory (see #164, out of scope here), so the
  chord is deliberately **terminal-scoped** and its shadow is **recorded**, not assumed harmless.
- **The action's placement within its menus** follows whatever sectioning #160 settles; this feature
  does not restructure the menus, it adds one entry to each.
- **"Bounded interval" for the automatic self-heal (FR-012)** is the period of the FR-014a backstop,
  and is left to the plan to state as a number, because it depends on the cause found. What the spec
  fixes is that it must be **stated and tested**, not that it is any particular value. It is expected
  to be slower than today's two seconds, not faster: with reconciliation event-driven, the backstop
  covers only unknown causes and buys nothing by running often.
- **Existing coverage is inherited, not re-created.** `terminal-link-once.e2e.ts` already fences four
  link shapes on master; this feature extends that fence to the alternate screen rather than
  rewriting it.
- **The 2-second periodic repaint is not assumed to survive.** It predates this diagnosis; FR-014
  requires it to be justified against the cause found or removed.
- **Test evidence is gathered on a developer machine as well as in CI**, because parts of this
  behaviour are elevation-gated and CI runs elevated — a green CI bar alone does not prove these
  fixes.
- **Redrawing a tab's terminals when the tab is opened is the leading candidate fix for #162**, on the
  reporter's own evidence that the fault correlates with tab activation. The spec requires the
  *outcome* (FR-017/FR-018/FR-019) rather than that mechanism, for two reasons: a reconciliation on
  activation must also cover the other ways a panel becomes visible, and if the underlying cause is a
  stale or wrongly-agreed grid, an activation redraw would mask it while leaving it live everywhere
  activation is not involved. FR-013 therefore still binds — the cause is measured first, and the
  activation redraw is adopted if it is the right shape for that cause.
- **The reproduction phase is a search, and is budgeted as one.** Four defects here are stated as
  hypotheses rather than known causes, and two of them are intermittent. The expectation is that many
  more probes get written than survive: the work is to make each defect fail on demand, and the
  probes that never redden are deleted once the one that does is found (FR-006d). What survives to
  the branch is the reproduction, the fences it justifies, and a note on the issue of what was ruled
  out (FR-006f) — not the search.
- **A reproduction test may drive a stand-in program rather than a real agent session.** What the
  tests need is the *conditions* — full-width output, the alternate screen, sustained redrawing,
  hidden-then-shown tabs — not a specific third-party tool, which could not be a dependency of the
  suite. Each reproduction must state which conditions it recreates and why they are the ones that
  matter.
