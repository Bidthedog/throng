# Feature Specification: Terminal Output Pipeline — Cost Follows What Is Visible

**Feature Branch**: `feature/S061-I481-terminal-output-pipeline`

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: issues [#481](https://github.com/Bidthedog/throng/issues/481) (background
terminals cost CPU in every window: per-panel output subscription and coalescing) and
[#162](https://github.com/Bidthedog/throng/issues/162) (terminal panels render wrong until manually
resized), planned together as backlog group G2 on 2026-10-25 because both live in the terminal view's
output and sizing path and in the daemon's per-view tracking.

## Background

A normal day in throng means many projects open, each with terminals that keep running when the user
switches away — several of them running full-screen programs that redraw continuously (Claude Code
sessions, watchers). The maintainer measured, on alpha9, 17 projects, 34 terminal panels and 23 live
shells (10 running Claude Code): text entry in the visible terminal lags, and the main process stops
answering in time (`RPC "projects.setActive" timed out`, repeatedly, when switching projects).

The cost scales with **every running terminal**, not with what is on screen. Verified against the code
at the start of this feature (2026-10-25):

| Hop | Today |
|---|---|
| Shell → daemon | Each chunk the shell writes is handled individually, optionally through one extra hop for de-elevated terminals. |
| Daemon → main | Every chunk of every terminal is published to the main process, unconditionally. There is no per-terminal subscription. |
| Main → windows | Every chunk is sent to **every** window, whether or not that window shows the terminal. |
| Window → terminal view | Each mounted terminal view registers its own listener and discards chunks for other terminals, so each window receives and filters every chunk once per mounted view. |
| Terminal view → screen | One write per chunk. No hop batches output. |

Inactive tabs and inactive projects are already unmounted (028), so the waste is in transport and
filtering, not in drawing hidden output.

Output batching was **deliberately not done** in spec 005 (spec.md:85-87, tasks T075 / T132, "partial by
design"), because it risked the view's per-chunk screen-clear detection and the mirror path. This spec
revisits that decision with those two risks named as requirements (FR-020 – FR-024), and supersedes it
(see *Supersessions*).

Separately, #162 reports a terminal whose output **seems to disappear**: on the reporter's work machine
only, with the window maximised and a single terminal panel, Claude Code's output appears, then clears;
resizing the panel brings it back until the user focuses or types; typed text is invisible; scrolling up
shows the missing content. The earlier #162 diagnosis (wrong content after a view rebuild) shipped in
028. This is a different symptom — **correct content that is not on screen** — and its cause is not yet
proven. The leading hypothesis is that the terminal grid applied to the view has more rows than the panel
can display, so the bottom rows, where the program draws its live region and the cursor sits, are
clipped.

## Supersessions

- **005, "Output coalescing/debounce … deliberately NOT done" (spec.md:85-87; tasks T075, T132)** is
  superseded by FR-020 – FR-024. The two risks that decision named — screen-clear detection and the
  mirror path — are kept as explicit requirements (FR-022, FR-023) rather than as a reason not to batch.
  The memory concern 005 also cited stays handled by the bounded scrollback, unchanged.

Nothing else is superseded. In particular **008 FR-009 / FR-010 / FR-013** (one grid per terminal session,
the minimum across attached views, recomputed only on a real change) stand unchanged; #162's fix
(FR-040 – FR-045) works inside them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Typing stays fast however many terminals run in the background (Priority: P1)

A user has many projects open, each with terminals running busy programs. They type into the one
terminal on screen. Their keystrokes appear as quickly as they do with nothing else running, and
switching projects responds promptly.

**Why this priority**: This is the complaint in #481 and the reason a heavy user cannot keep throng as
their only terminal. Principle XII (Responsive UI, NON-NEGOTIABLE) requires it.

**Independent Test**: Start throng with one visible terminal and N busy terminals in other, non-active
projects (N = 1, then N = 20). Measure the work the visible window does and the echo latency of typed
characters. Delivered by per-terminal subscription and per-window routing alone, without batching.

**Acceptance Scenarios**:

1. **Given** 20 terminals emitting steady output in non-active projects, **When** the user's window shows
   one idle terminal, **Then** that window receives no output messages for any of the 20.
2. **Given** the same load, **When** the user types into the visible terminal, **Then** echo latency is
   within the bound in SC-002 of the 1-terminal baseline.
3. **Given** the same load, **When** the user switches between projects 50 times, **Then** no switch times
   out.
4. **Given** a background terminal raises an attention signal (bell, notification, finished), **When**
   its project is not active, **Then** the project row still shows the attention mark exactly as it does
   today.

---

### User Story 2 - Coming back to a project shows exactly what happened while away (Priority: P1)

A user switches away from a project whose terminals keep producing output, then switches back. Each
terminal shows its output with nothing missing and nothing shown twice.

**Why this priority**: Per-terminal subscription (US1) makes every return to a project a detach /
re-attach. If that seam drops or repeats output, US1 has traded speed for wrong content. Today the seam
has no ordering marker at all, so a chunk published while a view attaches can already appear twice
(inferred from the code; no test covers it).

**Independent Test**: A terminal emitting numbered lines continuously; the user switches the project
away and back repeatedly. Every line number appears exactly once, in order.

**Acceptance Scenarios**:

1. **Given** a terminal printing a numbered line every few milliseconds, **When** its project is switched
   away and back 20 times, **Then** the terminal's content contains every number once, in order.
2. **Given** a terminal running a full-screen program, **When** its project is switched away and back,
   **Then** the program's screen is shown correctly on arrival, as 028 FR-017 already requires.
3. **Given** a terminal shown in two windows at once (a mirror), **When** one window stops showing it,
   **Then** the other keeps receiving its output without a gap.

---

### User Story 3 - A busy visible terminal costs less to draw (Priority: P2)

A user watches a terminal producing output quickly (a build log, a full-screen program redrawing). The
window keeps up, and the rest of the UI stays responsive while it does.

**Why this priority**: After US1, the only output a window handles is for terminals it shows. Batching
reduces the per-chunk overhead on that remaining path. It is P2 because it is an optimisation of a path
that is already proportional to what is visible.

**Independent Test**: One visible terminal producing sustained high-rate output. Measure messages
delivered to the window per second and the window's main-thread busy time, before and after.

**Acceptance Scenarios**:

1. **Given** a visible terminal producing sustained output, **When** batching is in place, **Then** the
   window receives at most the message rate in SC-004 for that terminal.
2. **Given** a program that clears the screen (`cls`, `clear`) in the middle of a burst of output,
   **When** that burst is batched, **Then** the output written after the clear is still on screen, and the
   scrollback is dropped exactly as it is today.
3. **Given** the user types a character, **When** the shell echoes it, **Then** the echo is not delayed
   perceptibly by batching (SC-005).

---

### User Story 4 - A terminal never hides its own bottom rows (Priority: P2)

A user with the window maximised and a single terminal panel runs Claude Code. The output, the cursor and
whatever they type stay on screen. They never need to resize the panel to see it.

**Why this priority**: #162 is a v1.0.0 bug that makes a terminal look empty while it works. It is P2
only because its trigger is environmental (one reported machine) and its cause unproven; once proven it
is cheap to fix.

**Independent Test**: A test that reproduces the cause with the panel size and cell metrics stubbed at
the reporter's conditions (see FR-040), failing before the fix and passing after.

**Acceptance Scenarios**:

1. **Given** a panel whose height is not a whole number of rows at a fractional display scale, **When**
   the terminal is sized, **Then** every row of the grid, including the cursor row, is inside the panel's
   visible area.
2. **Given** the window is maximised or moved to a monitor with a different scale, **When** the panel's
   capacity changes, **Then** the grid follows it without the user resizing anything.
3. **Given** the condition reported in #162, **When** the user focuses the terminal and types, **Then**
   the typed text is visible.

---

### User Story 5 - Evaluate a GPU renderer (Priority: P3)

The maintainer learns whether drawing terminals on the GPU reduces the cost of a busy visible terminal,
and adopts it only if it does.

**Why this priority**: #481 lists it as something to evaluate, not to ship. It is independent of US1 – US4.

**Independent Test**: The US3 measurement with and without the GPU renderer, plus a forced loss of the
graphics context.

**Acceptance Scenarios**:

1. **Given** the measurement, **When** the GPU renderer does not improve SC-006, **Then** it is not
   adopted and the result is recorded in this spec.
2. **Given** the GPU renderer is adopted and the graphics context is lost, **When** the terminal next
   draws, **Then** it falls back to the default renderer with no content lost.

---

### Edge Cases

- **A terminal shown in no window** (its project inactive everywhere): the daemon still records its
  scrollback and still raises attention, title, working-directory and command signals; nothing is sent to
  any window for it.
- **The same terminal shown in two windows** (a sub-workspace mirror): each window receives it; closing
  one view does not unsubscribe the other.
- **The same terminal shown twice in one window**: one subscription for the window, delivered to both
  views.
- **A window closes or crashes** without detaching: its subscriptions are released (the existing
  destroyed-webContents backstop already detaches its views; subscriptions follow).
- **A burst arriving while a view is attaching**: delivered once — either inside the replay or after it,
  never both, never neither (FR-012).
- **A clear sequence split across two chunks, or followed by more output in the same batch** (FR-022).
- **An alternate-screen switch inside a batch**: the view's alt-screen handling sees it in order with the
  output around it.
- **A de-elevated terminal** (output arrives through the extra hop): behaves identically.
- **A terminal exiting with output still pending in a batch**: the pending output is delivered before the
  exit is shown.
- **A start failure written as synthetic output**: delivered like any other output.
- **The last view detaching**: the grid is kept and marked stale, as today; the next attach repaints.
- **A view whose measured capacity rounds differently from the rendered rows** at fractional scale
  (FR-041).

## Requirements *(mandatory)*

### Functional Requirements

#### Per-terminal subscription (US1)

- **FR-001**: A window MUST receive a terminal's output only while it has at least one mounted view of
  that terminal.
- **FR-002**: The daemon MUST continue to record every terminal's scrollback, and to run every
  view-independent consumer of its output — attention signals (057), alternate-screen, keyboard- and
  mouse-mode tracking, window title, working directory and command — whether or not any window shows it.
- **FR-003**: A subscription MUST be established by the same act that attaches a view, and released by
  the act that detaches it. No separate step may be forgotten.
- **FR-004**: When a window is destroyed, closed or crashes, every subscription it held MUST be released
  without the window's cooperation.
- **FR-005**: A terminal shown in more than one window (008's mirror) MUST be delivered to each of them;
  releasing one window's subscription MUST NOT affect another's.
- **FR-006**: The filtering MUST happen before output crosses into a window: a window with no view of a
  terminal MUST NOT be sent its output at all, rather than being sent it and discarding it.

#### Per-window routing (US1)

- **FR-007**: A window MUST receive terminal output through one channel and route each delivery to the
  view(s) of the terminal it belongs to, rather than every view inspecting every delivery.
- **FR-008**: Routing MUST preserve per-terminal order and the existing guarantee that a view's live
  output never overtakes its replay (the ordering gate).

#### Replay without gap or duplicate (US2)

- **FR-010**: Every delivery of a terminal's output MUST carry a per-terminal position that strictly
  increases, so that a receiver can tell whether a delivery is before, inside or after a snapshot.
- **FR-011**: A view attaching to a running terminal MUST be told the position its replay ends at.
- **FR-012**: A view MUST show each piece of output exactly once: output already covered by its replay
  MUST be discarded, and output after it MUST be shown, whatever the interleaving of the attach and live
  delivery.
- **FR-013**: A gap — a delivery whose position shows output was skipped — MUST NOT be shown silently as if
  contiguous. The view MUST recover (re-attach and replay) or, if it cannot, record the gap in the
  diagnostic log. *(A gap is not expected by design; this requirement is the guard that proves it.)*
- **FR-014**: The replay itself is unchanged: it is cut at a line boundary (028) and is empty for a
  terminal on the alternate screen, as today.

#### Batching (US3) — supersedes 005's deferral

- **FR-020**: Output for a terminal MUST be batched at one or more hops between the daemon and the view,
  over a bounded interval, so that a sustained stream of small chunks is delivered as fewer, larger
  deliveries.
- **FR-021**: Batching MUST NOT add more than the bound in SC-005 to the time between a shell writing a
  byte and the view receiving it, and a batch MUST be delivered as soon as its interval ends even if the
  stream continues.
- **FR-022**: Screen-clear detection MUST give the same result on batched output as on the same output
  delivered chunk by chunk. In particular, **output following a clear inside the same batch MUST remain
  on screen** — the hazard is that clearing after a whole batch is written would wipe it. The scrollback
  drop a clear triggers today, and its suppression shortly after a resize, MUST be preserved.
- **FR-023**: Batching MUST preserve the mirror path: every view of a terminal, in every window, sees the
  same output in the same order.
- **FR-024**: Batching MUST preserve order across a terminal's output, grid, exit and attention
  notifications: output pending in a batch MUST be delivered before a later exit or grid change for the
  same terminal.
- **FR-025**: Batching MUST be bounded in size as well as time: a batch that reaches a size limit MUST be
  delivered immediately, so a flood cannot grow one message without bound.

#### Terminal sizing (US4, #162)

- **FR-040**: The cause of #162's latest symptom MUST be established and stated in this spec, proven by a
  test that fails without the fix — before the fix is written. The test MUST reproduce the reporter's
  conditions with the panel size and cell metrics stubbed (large panel, fractional display scale), not
  depend on a particular monitor.
- **FR-041**: A view MUST NEVER apply a grid with more rows or columns than its panel can fully display.
  If its own measurement and the rendered row size disagree, the view MUST size to the smaller.
- **FR-042**: A view's reported capacity MUST be re-measured, and re-sent if it changed, when anything that
  determines it changes — panel size, font, zoom, display scale, maximise / restore, moving between
  monitors — and a change MUST NOT be lost to debouncing or to the unchanged-size check.
- **FR-043**: FR-041 MUST hold within 008 FR-009 / FR-010 / FR-013: the session grid stays the minimum across
  attached views and is recomputed only on a real change. The fix corrects what a view reports or applies;
  it does not change how the session grid is agreed.
- **FR-044**: If the established cause is not the one hypothesised, FR-041 – FR-042 still hold, and the
  requirement that addresses the actual cause is appended to this section as a clarification.
- **FR-045**: 028's rendering-fidelity requirements (FR-014a – c, FR-015, FR-017, FR-019a – b) MUST NOT
  regress.

#### GPU renderer evaluation (US5)

- **FR-050**: A GPU-backed terminal renderer MUST be evaluated against the US3 measurement and adopted only
  if it improves SC-006. The result, adopted or not, MUST be recorded in this spec.
- **FR-051**: If adopted, losing the graphics context MUST fall back to the default renderer with no
  content lost, and a terminal MUST still render where the GPU renderer cannot be created.

#### Measurement (all stories)

- **FR-060**: A reproducible load harness MUST start a configurable number of terminals producing steady
  output in non-active projects alongside one visible terminal, and record: messages delivered to each
  window per second, main-process and window main-thread CPU, and typed-character echo latency.
- **FR-061**: Each of FR-001 – FR-007, FR-020 – FR-025 and FR-050 MUST be measured before and after it lands,
  separately, with the harness. The results MUST be recorded in this spec with the machine and load they
  were taken on.
- **FR-062**: The assertion that a window receives no output for terminals it does not show (SC-001) MUST be
  made at the inter-process boundary, by counting what crosses it, not inferred from what the view
  displays.

#### Hygiene

- **FR-070**: No change in this feature may leave a terminal process, helper process or subscription
  behind on any end path (Principle III). Subscription release on window close is covered by FR-004; the
  existing process-level orphan checks MUST stay green.

### Key Entities

- **Terminal output subscription**: a window's interest in one terminal's output. Created with a view's
  attach, released with its detach or the window's destruction. A window holds at most one per terminal,
  however many views of it the window has.
- **Output position**: a per-terminal, strictly increasing marker of how much output the terminal has
  produced. Carried by every delivery and by the attach result.
- **Output batch**: consecutive output of one terminal, gathered over a bounded interval and size, delivered
  as one.
- **View capacity**: the largest grid a view's panel can fully display, as measured by the view.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With 20 terminals producing steady output in non-active projects, a window showing none of
  them receives **zero** output messages for them over a 60-second sample.
- **SC-002**: With 20 busy background terminals, typed-character echo latency in the visible terminal at the
  95th percentile is no more than **1.2×** its value with 1 busy background terminal.
- **SC-003**: With 20 busy background terminals, the visible window's main-thread CPU while idle on one
  terminal is no more than **1.2×** its value with 1, and 50 consecutive project switches complete with
  **zero** timeouts.
- **SC-004**: A visible terminal producing sustained output is delivered to its window in no more than
  **60 messages per second**, whatever the shell's chunk rate.
- **SC-005**: Batching adds no more than **16 ms** to output latency at the 95th percentile, measured from the
  daemon receiving a chunk to the view receiving it.
- **SC-006**: The busy-visible-terminal measurement (US3) reports window main-thread busy time; the GPU
  renderer is adopted only if it lowers it by at least **20%**.
- **SC-007**: A terminal printing a numbered line continuously, switched away and back **20** times, shows
  every line exactly once, in order.
- **SC-008**: Under #162's reproduced conditions, **100%** of a view's applied rows are inside its panel, and
  the reproducing test fails without the fix.
- **SC-009**: Every existing terminal test covering transport, replay, screen-clear, mirror, grid, repaint and
  attention (listed in the plan) stays green.

## Assumptions

- **A window with a mounted view is a window that shows it.** A minimised window, or one behind another,
  keeps its mounted terminals subscribed. Reducing work for minimised windows is out of scope.
- **Batching interval defaults to one display frame (~16 ms)**, with a size cap; the exact values are a plan
  decision, bounded by SC-004 and SC-005.
- **Where batching happens** (daemon → main, main → window, or both) is a plan decision; FR-020 – FR-025
  constrain the result, not the hop.
- **The measurements in Background are one machine's** under heavy unrelated load; this feature takes its own
  before / after numbers (FR-061) rather than leaning on them.
- **#162's reproduction needs the reporter's display scale** on the work machine. Until it is known, the
  reproducing test covers the common fractional scales (125%, 150%, 175%) at maximised panel heights.
- **Shell-side throttling, what a terminal records in scrollback, and the node-pty 1.2.0 upgrade
  ([#503](https://github.com/Bidthedog/throng/issues/503))** are out of scope.
- **No new key bindings, settings or visible controls** are added, so Principle IV and the
  configuration-editor completeness gate are not engaged. If the GPU renderer is adopted with a user-facing
  switch, that switch brings its descriptor and docs line with it.
