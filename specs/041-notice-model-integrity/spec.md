# Feature Specification: Notice-Model Integrity

**Feature Branch**: `feature/S041-I278-I314-I327-I328-notice-consolidation`

**Created**: 2026-08-26

**Status**: Draft

**Input**: User description: "Notice-model integrity: one condition, one notice. A single condition must raise exactly one notice, carrying exactly one row per distinct casualty, and a repeat of that same condition must make the existing notice louder rather than adding another. Covers #278, #328, #327, #314."

---

## What this feature is, and what it is not

**Three of the four items are conformance, not invention.** The rules they ask for were established
by 029 and 030, shipped, and have since stopped holding in production code. This spec restores them;
it does not restate them as new requirements, and it must not renumber them.

| Item | The requirement that already governs it | Status today |
|---|---|---|
| #278 — one notice per expanded folder | **029 FR-019** — "One underlying cause MUST NOT produce a separate notice for each thing it broke" | Not honoured |
| #278 — raw `ENOENT` on screen | **029 FR-016 / FR-018**, **030 FR-034** — the raw error is demoted to Copy and the log, never rendered | Not honoured |
| #328 — duplicate row per re-attempt | **030 FR-037a** — a fresh notice "MUST NOT repeat panels the earlier notice already reported" | Not honoured |
| #327 — a panel for a refused file | No requirement either way | **Genuinely unspecified** |
| #314 — no keyboard route to a notice | **030 FR-060a** — names #314 explicitly and defers it | Deferred by name |

So this feature has exactly **two** pieces of new ground: what happens when a file is refused and no
editor panel exists (#327), and what the keyboard route to a notice actually is (#314). Everything
else is the existing contract, plus the guards that would have caught it going.

**This does not supersede anything.** 029 FR-016, FR-018, FR-019 and 030 FR-034, FR-035, FR-036,
FR-037, FR-037a, FR-060a all stand exactly as written. Where this spec states a requirement that
overlaps one of them, it is stating **how conformance is proven**, not restating the rule.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One cause, one notice (Priority: P1)

A user removes a folder outside throng — a `git worktree remove`, a cleanup script, a delete in
Explorer. throng notices, and tells them **once**, naming the folder that actually went.

Today it tells them once per expanded folder in the tree. One `git worktree remove` produced five
dialogs, differing only in which folder each named, all describing the same event — and each carried
`ENOENT: no such file or directory, realpath '<path>'` as its second line, under a correctly-worded
first line that had already said the folder could not be found.

**Why this priority**: It is the most visible breach, it is the one a user hits by doing something
completely ordinary, and it is a rule the project has written down twice. A five-dialog pile-up for
one event is the failure mode 029 FR-019 exists to prevent.

**Independent Test**: Remove a folder that has several expanded descendants in the tree, and count
the notices. One, naming the deepest folder that actually went, with no `ENOENT` on screen.

**Acceptance Scenarios**:

1. **Given** a project tree with a folder and three of its descendants expanded, **When** that folder
   is removed outside throng, **Then** exactly one notice appears.
2. **Given** that notice, **Then** it names the deepest folder that actually went — the one the user
   would recognise — and not each descendant that was merely affected by its going.
3. **Given** that notice, **Then** no raw system error text is rendered anywhere on it.
4. **Given** that notice, **When** it is copied, **Then** the raw system error is present in the
   clipboard payload, below the human-readable cause (029 FR-018).
5. **Given** that notice, **Then** the raw system error is present in the diagnostics log exactly
   once (029 FR-018, 030 FR-034).
6. **Given** two folders in genuinely unrelated locations removed as two separate events, **Then**
   two notices appear — consolidation is by cause, never by time (030 FR-036).
7. **Given** the descendant's removal is reported **before** its ancestor's, **Then** the outcome is
   identical to the reverse order — one notice, naming the ancestor.
8. **Given** any arrival order, **Then** no notice is raised and later amended to name a different
   subject.

---

### User Story 2 - One row per casualty, flashed on repeat (Priority: P1)

A user tries to open a file throng will not open. They get one notice with one row. They try the same
file again, and the notice they already have **flashes** — it does not grow.

Today each re-attempt appends another identical row: same panel, same path, same reason. The list
grows for as long as the user keeps trying, which is exactly as long as they have not understood the
first row.

**Why this priority**: The same rule as US1, one level down, and it is already written: 030 FR-037a
says a notice "MUST NOT repeat panels the earlier notice already reported." A list that repeats a row
is reporting one fact several times, and it makes the notice *less* readable the harder the user
tries.

**Independent Test**: Open a refused file three times with the notice on screen, and count the rows.
One, and the notice flashes on attempts two and three.

**Acceptance Scenarios**:

1. **Given** a notice already listing a panel for a cause, **When** the same panel is defeated by the
   same cause again, **Then** the notice's list is unchanged and the notice flashes.
2. **Given** that same repeat, **Then** no second notice is raised (030 FR-037).
3. **Given** a notice listing panel A, **When** a *different* panel B is defeated by the same cause,
   **Then** B is added as a new row and the notice flashes (030 FR-037).
4. **Given** a notice listing a panel, **When** the same panel is defeated by a **different** cause,
   **Then** a second notice is raised for that cause (030 FR-036).
5. **Given** the notice has been dismissed, **When** the same cause defeats the same panel again,
   **Then** a fresh notice is raised (030 FR-037a) — the suppression is per live notice, not
   permanent.
6. **Given** the flash, **Then** what is announced to assistive technology is the change, not a
   re-reading of the whole notice (030 FR-032a).
7. **Given** a notice with a display timeout, **When** the same casualty repeats, **Then** the notice
   pulses and its timer restarts from the configured timeout.
8. **Given** repeats arriving faster than the timeout, **Then** the notice does not expire between
   them — it cannot vanish while the user is still producing the condition.
9. **Given** a notice whose severity is set to **Dismiss only**, **When** the casualty repeats,
   **Then** it pulses and is otherwise unaffected — there is no timer to restart.
10. **Given** a notice row, **Then** it shows the subject's path **relative to the project root**, and
    the absolute path appears in the Copy payload and the log rather than on screen.
11. **Given** a refused open, which creates **no** panel (US3), **Then** its notice still carries one
    row for that casualty — the row has a subject and no panel — and a repeat of it flashes rather
    than appending, exactly as a panel row does.
12. **Given** a notice carrying both a panel row and a panel-less row, **Then** the panel row appears
    under its tab in the workspace's order and the panel-less row appears ungrouped, and both orders
    are the same on every run.
13. **Given** repeats arriving faster than a pulse completes, **Then** they are absorbed into the
    running pulse and produce **one** announcement between them — while repeats spaced beyond it each
    pulse and each announce.

---

### User Story 3 - A refusal is not a document (Priority: P2)

A user opens a file throng will not open — too large, binary, outside the project. They are told, in a
notification. **No panel is created**, whether or not an editor panel already happens to be open.

Today the outcome depends on unrelated workspace state. With an editor panel already open, the refusal
arrives correctly as a notification and no panel is created. With **no** editor panel open, throng
creates one, shows the refusal inside it as a "This file could not be read" banner, and raises no
notification at all — leaving the user holding a panel for a file that was never opened, and which
they must now clean up.

**Why this priority**: It is a real defect with a clean expected outcome, but it is one action with
one wrong result, where US1 and US2 are rules being broken repeatedly. It is also the item with no
existing requirement, so it is the one that most needs writing down.

**Independent Test**: With an empty workspace, open a refused file. No panel is created and a
notification appears. Repeat with a panel already open and get the identical outcome.

**Acceptance Scenarios**:

1. **Given** a workspace with no editor panels, **When** a refused file is opened from Files &
   Folders, **Then** no panel is created.
2. **Given** that same action, **Then** a notification is raised naming the reason.
3. **Given** a workspace with an editor panel already open, **When** the same file is opened, **Then**
   the outcome is identical to scenarios 1 and 2.
4. **Given** any refusal reason in the not-a-missing-file set — too large, binary, outside the
   project, a folder — **Then** the outcome is the same for each.
5. **Given** a file that is refused because it is **missing**, **Then** existing recovery behaviour is
   unchanged — a missing file's panel can hold a recovered buffer and be saved back, so it is not a
   refusal in this sense.
6. **Given** a panel that is **already open** on a file which later becomes unopenable, **Then** its
   banner behaviour is unchanged (030 FR-038) — this story is about panels being *created*, never
   about panels that already exist.

---

### User Story 4 - A keyboard route to a notice (Priority: P3)

A user who is told "eleven panels could not be opened" can reach the list of them from the keyboard,
and can tell that they can.

030 FR-060a states this gap in its own words and defers it to #314 by name: the affected-panel list is
a tab stop, but "no binding focuses a notice, nothing autofocuses one, and no cue indicates the list
is a tab stop." Reaching it today means tabbing forward through the whole application until focus
happens to land there.

**Why this priority**: It is the only item that adds a capability rather than restoring one, it is the
one with a real design decision in it, and the other three are defects a user is hitting now.

**Independent Test**: Raise a notice with more rows than fit, press the binding, and scroll the list
with the keyboard. Escape returns focus where it started.

**Acceptance Scenarios**:

1. **Given** a notice on screen, **When** the user presses `Ctrl+Alt+M` (`focus.notice`), **Then**
   focus moves to the most recent notice.
1a. **Given** a **focused terminal**, **When** the binding is pressed, **Then** focus still moves to
    the notice — the command is scoped EVERYWHERE and the chord is in neither reserved tier, so the
    shell never sees it.
1b. **Given** the user cycles focus with `Ctrl+\``, **Then** notices are **not** in the ring.
1c. **Given** **three** live notices, **When** the binding is pressed twice, **Then** focus is on the
    most recent notice both times — the binding does not walk the stack.
1d. **Given** focus on a notice, **When** a further notice is raised, **Then** focus does not move.
2. **Given** focus on that notice, **Then** the casualty list can be scrolled with the keyboard
   (030 FR-032b, preserved by FR-060).
3. **Given** focus on that notice, **When** Escape is pressed, **Then** focus returns to the element
   that had focus before the binding was pressed.
3a. **Given** three live notices, **When** the user presses the binding, tabs on to a second notice
    and then presses Escape, **Then** focus lands on the element they started from — not on the
    notice they tabbed from.
3b. **Given** the origin element has since been destroyed — its panel closed — **When** Escape is
    pressed, **Then** focus lands on a real focusable surface rather than the document body.
4. **Given** focus on that notice, **When** the user tabs, **Then** focus leaves the notice — it never
   traps (030 FR-032b, preserved by FR-060).
5. **Given** no notice is on screen, **When** the binding is pressed, **Then** nothing happens and no
   notice is raised to say so.
6. **Given** a notice carrying a focusable list, **Then** a visible affordance indicates it is
   focusable **before** focus arrives, not only once it has.
7. **Given** the notice is dismissed or times out while focused, **Then** focus returns to where it
   came from rather than being lost to the document body.

---

### Edge Cases

- **A cause that defeats panels across several projects.** Consolidation is by cause; the notice names
  one project (030 FR-031). Two projects defeated by one cause is two notices, one per project — the
  existing per-project shape is unchanged by this feature.
- **A folder removed while its own removal is still being processed.** Repeat events for a cause
  already reported flash the existing notice; they do not queue further flashes.
- **A refused file opened from two different places at once** — the tree and a drag — resolves to one
  row, because the row's identity is the casualty, not the gesture.
- **The deepest folder that went cannot be determined** — the whole project root vanished, say. The
  notice names the highest thing it can name truthfully rather than naming nothing.
- **A notice flashing while the user is reading it.** The flash must not move the list, change its
  scroll position, or steal focus from a user who has focused it under US4.
- **A refusal arriving while the workspace is being restored at startup**, when panels are being
  created legitimately. Panel creation during restore is not the same act as opening a file, and must
  not be suppressed by US3.
- **A file refused for one reason on one attempt and a different reason on the next** — it grew past
  the size limit between attempts. Different cause, so a second notice (030 FR-036), not a flash.
- **A whole tree removed in one command, several roots at once** (`git clean`). Each removed folder
  whose parent survives is its own cause (FR-003a), so this can legitimately produce several notices.
  That is the truthful report, and merging them would be grouping by time, which 030 FR-036 forbids.
- **A refused file dropped onto empty space rather than opened from the tree.** A drop that would
  create a panel obeys FR-013; a drop onto an existing panel does not, because it creates nothing.
- **A repeat arriving while the notice is being read by a screen reader.** The repeat announcement is
  polite, so it queues rather than interrupting, and it never carries the casualty list.
- **A storm of repeats — a watcher re-firing, or a user hammering the same refused file.** They are
  absorbed into the running pulse (FR-008e) and produce one announcement between them (FR-011c). The
  timer is still restarted by each, so the notice cannot expire mid-storm.
- **A cause suppressed on screen but still being logged.** The log grows while the notice does not —
  intended (FR-005a), and worth stating so that a future reader does not "fix" the apparent mismatch.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Group 1 — Restoring one-cause-one-notice (#278)

- **FR-001**: A single filesystem event that defeats several tree nodes MUST raise exactly one notice.
  This is 029 FR-019 restored, not a new rule; the requirement is that conformance is now *proven*
  rather than assumed.
- **FR-002**: That notice MUST name the deepest folder that actually went — the thing the user acted
  on and would recognise — rather than each descendant that was defeated by its going.
- **FR-003**: A descendant defeated because its ancestor was removed MUST be suppressed by that
  ancestor's notice, and MUST NOT raise one of its own.
- **FR-003a**: The unit of a cause is a **removed folder whose parent survives**. A folder whose
  ancestor also went is suppressed by it (FR-003); a folder whose parent is still there is its own
  cause and raises its own notice. So one removal with four expanded descendants is one notice, and
  three independent sibling removals are three.
- **FR-003b**: Co-incident removals MUST NOT be merged on the grounds of arriving together. 030
  FR-036 states that consolidation is by cause or by originating operation, "never by time or by
  window", and this feature does not supersede it. Where several unrelated folders genuinely go at
  once, several notices is the truthful report.
- **FR-003c**: Whether a removal is suppressed MUST be decidable from **that removal alone**, by
  checking whether any ancestor of it inside the project root is also absent. It MUST NOT depend on
  having seen the ancestor's own event, and MUST NOT buffer events to find out. A watcher gives no
  ordering guarantee — `/a/b/c` can be reported gone before `/a/b` — so a rule phrased as "suppressed
  by the ancestor's notice" would otherwise need a wait, and a wait is the grouping by time that
  FR-003b forbids. Deciding per event makes the outcome independent of arrival order.
- **FR-003d**: A notice MUST NOT be raised and then amended to name a different subject. A subject
  that changes after the user has read it is a second report wearing the first one's clothes, and it
  defeats FR-002's purpose — the notice is supposed to name the thing the user acted on, first time.
- **FR-004**: No raw system error string MUST be rendered on any notice this feature touches. This is
  029 FR-016 and 030 FR-034 restored.
- **FR-005**: The raw system error MUST remain reachable, unchanged from 029 FR-018: in the notice's
  Copy payload below the human-readable cause, and in the diagnostics log, exactly once each.
- **FR-005a**: **Suppression is a presentation rule and MUST NOT reduce what reaches the diagnostics
  log.** Every casualty MUST be logged, including those whose notice was suppressed and those whose
  row was not appended — one removal defeating five tree nodes produces one notice and five log
  entries. 029 FR-018 demotes the raw error rather than discarding it, and consolidating the notice
  must not quietly become discarding the evidence.
- **FR-005b**: Suppressed casualties MUST be logged at the same level as the cause that reported them,
  not demoted to debug. A log level the user has to have enabled in advance is not a record.
- **FR-006**: Two genuinely different causes MUST still raise two notices (030 FR-036). Suppression is
  by cause, never by proximity in time.

#### Group 2 — One row per casualty (#328)

- **FR-007**: A notice's **casualty list** MUST hold at most one row per distinct casualty. A
  casualty's identity is **the subject it failed on and the reason**, plus the panel **where there is
  one** — a repeat of that identity is the same casualty.
- **FR-007aa**: "Plus the panel where there is one" means the panel **supersedes** the pair, not that
  it joins it. Where a row has a panel, the panel alone identifies it; the `(subject, reason)` pair
  identifies a row that has none.

  > This is not a shortcut, it is what the surrounding rules already imply. A notice consolidates one
  > cause or one operation (030 FR-035/FR-036), and within one of those **a given panel fails once** —
  > so `reason` can never distinguish two rows that share a panel, and folding it into the key would
  > buy nothing while changing behaviour that 030 FR-037a already fixed ("a panel appears once,
  > however many times its failure is reported").
  >
  > The case that looks like a counter-example — the same panel defeated by a **different** cause —
  > is settled one level up: a different cause is a different **notice** (FR-006, 030 FR-036, US2
  > acceptance scenario 4), never a second row in this one. Row identity is asked only *within* a
  > notice, where the cause is already fixed.
- **FR-007a**: Suppression MUST be keyed on the **cause**, and MUST NOT depend on the notice carrying
  a casualty list. A notice MAY carry such a list — a refused open does — or carry none — a
  folder removal does not — and the same suppression applies to both. 029 FR-019 is a rule about
  causes and says nothing about panels, so one mechanism serves both scales: suppressing a second
  *notice* for a cause already reported, and suppressing a second *row* for a casualty already listed.
- **FR-007b**: The list 030 FR-031a/FR-037a calls the **affected-panel list** MUST generalise to a
  casualty list whose panel is **optional**, and its de-duplication key MUST become the casualty
  identity FR-007 and FR-007aa state — the panel where there is one, else `(subject, reason)` —
  rather than the panel unconditionally. Today `AffectedPanel` requires a panel identity and
  de-duplicates on it, so after FR-013 a refused open has nothing to key on: the row it must carry is
  a casualty with a subject and no panel. Keying on the panel alone would leave #328 unfixable for
  exactly the case #327 creates.
- **FR-007e**: The widening MUST NOT make `subject` or `reason` **required on a row that has a
  panel**. Today's rows carry neither field, and six call sites across source and tests construct
  them; requiring the pair would break every one of them at compile time. The two forms MUST be
  expressible such that a panel-less row cannot omit `subject` and `reason`, while a panelled row is
  unchanged from what it is today. This is not a convenience — a widening that edits the tests
  proving the old behaviour has stopped being able to prove the old behaviour was preserved.
- **FR-007c**: A row **with** a panel MUST keep its current rendering unchanged — grouped under its
  tab, in the workspace's tab and panel order (030 FR-031a), named through the shared subject
  formatter (030 FR-031b). A row **without** a panel has no tab to sit under and MUST render
  ungrouped, through the same formatter and the same per-part truncation, so one long subject cannot
  break the height bound 030 FR-032 sets.
- **FR-007d**: Ordering among panel-less rows MUST be deterministic and MUST NOT inherit the order
  the failures happened to arrive in. The failures race, so arrival order carries no information and a
  growing notice would look shuffled — the same reasoning 030 FR-031a already applies to panel rows.
- **FR-008**: A repeat of a casualty already listed on a live notice MUST flash that notice and MUST
  NOT append a row. This is 030 FR-037a restored.
- **FR-008a**: To flash is to do exactly two things: **briefly pulse the notice card**, and **restart
  that notice's dismissal timer** from its configured timeout. Nothing is added to the notice, and
  nothing in it changes.
- **FR-008aa**: "Briefly" is deliberately left without a duration, and that is not an omission.
  Nothing in this feature is measured against the pulse's *length*: FR-008e binds absorption to the
  pulse being **in flight**, and FR-011c binds the announcement to **one per pulse**. Both are
  therefore assertions about the pulse's start and end, which a test can observe directly, rather
  than about a number a test would have to race. The pulse MUST be observable as **a state on the
  notice** — applied when it starts and removed when it ends — so those two rules have something to
  hang on that is not a clock.
- **FR-008b**: Restarting the timer is what stops a notice expiring while the user is still producing
  the condition it reports. A notice the user is actively re-triggering MUST NOT time out mid-repeat.
- **FR-008c**: A notice whose display mode is **Dismiss only** has no timer to restart; it MUST pulse
  and otherwise be unaffected. A notice whose severity is set to **Never display** MUST NOT be raised
  or pulsed — the existing notification preferences continue to govern, unchanged by this feature.
- **FR-008d**: No repeat count MUST be rendered on a row. The pulse is the signal; a count is a new
  element inside a height-bounded list (030 FR-032) and was not asked for.
- **FR-008e**: Repeats arriving while a pulse is still running MUST be **absorbed into it** rather
  than queueing a further pulse. The pulse is a signal that the condition recurred, not a counter, and
  a queue of them would make the notice twitch for as long as the user kept trying. The dismissal
  timer is still restarted by each absorbed repeat, so FR-008b holds regardless.
- **FR-009**: A repeat MUST NOT raise a second notice (030 FR-037).
- **FR-010**: The flash MUST NOT move the list, change its scroll position, or move focus.
- **FR-011**: What is announced to assistive technology on a flash MUST be the change alone, never a
  re-reading of the notice (030 FR-032a).
- **FR-011a**: A **pure repeat** — where nothing was added — MUST still be announced, briefly and
  politely, naming the recurring subject rather than restating the notice. The pulse is a
  visual-only signal, so without this a screen-reader user's retry is met with silence and they
  cannot tell whether it registered.
- **FR-011b**: FR-011a MUST NOT re-read the casualty list. 030 FR-032a exists to stop a notice
  re-reading itself, and this feature does not weaken it: the announcement names the subject and says
  the condition recurred, nothing more.
- **FR-011c**: **The announcement follows the pulse — exactly one per pulse.** A repeat absorbed into
  an in-flight pulse (FR-008e) MUST NOT be separately announced. A polite live region queues rather
  than interrupts, so an unbounded announcement would turn ten rapid retries into ten utterances a
  screen-reader user must sit through — the audible form of the row-stacking #328 exists to stop. This
  binds the announcement to a bound the feature already has rather than introducing a timing constant
  of its own, and it leaves FR-011a's purpose intact: a retry after a pause is its own pulse, so it is
  still confirmed.
- **FR-012**: Suppression MUST be scoped to the live notice. Once it is dismissed or has timed out,
  the same cause defeating the same casualty MUST raise a fresh notice (030 FR-037a).

#### Group 3 — A refusal is not a document (#327)

- **FR-013**: Opening a file that is refused MUST NOT create a panel, regardless of how many editor
  panels currently exist.
- **FR-013a**: FR-013 binds **every entry point that would create a panel** — opening from Files &
  Folders, Quick Open, and a drop that would create a panel — not only the path #327 was reported
  from. The rule is about panel **creation**; leaving it scoped to one entry point preserves the very
  defect #327 describes, which is that one refusal has two outcomes.
- **FR-013b**: A drop onto an **existing** panel creates nothing and is therefore unaffected, in line
  with FR-016. Its current refusal handling stands.
- **FR-013d**: The explorer's *Open In → New Editor* menu item MUST be gated **at its call site**,
  because it is the one caller of `openFileInNewEditor` that does not route through `openFileInTab`
  and therefore never reaches `openInto`. `openFileInNewEditor` itself MUST stay **synchronous** and
  MUST NOT be given the gate.

  > **033 already decided this, and recorded why in the source.** `quick-open.tsx` fixed the same
  > shape of bug — a caller bypassing the router — and states that the gate belongs in the caller
  > "rather than inside `openFileInNewEditor` deliberately. That function means *force a new panel*;
  > making it silently not force would change a shipped contract under a caller that has already done
  > the check, and would turn a synchronous call into an asynchronous one for both." Both reasons
  > still hold, so this feature mirrors that fix rather than reversing it.
  >
  > An earlier draft of this requirement said the opposite and overstated the gap. `openFileInTab`
  > **already** awaits `openInto` at its first line, before the `openTarget === 'new'` branch — so
  > that path and Quick Open are both covered by FR-013a's ordinary handling, and the only genuinely
  > ungated caller is the tree's menu item. Naming a second one would have meant changing a shipped
  > contract to fix a defect that was not there.
- **FR-013c**: throng has **two refusal paths today** — `DropRejection` in `packages/core/src/editor/drop.ts`
  and the load-result reason in `packages/ui/src/main/editor-service.ts` — which share reason names
  but are separate types with separate tests. Whether they converge is a planning decision; what this
  requirement fixes is that both produce the **same observable outcome** for the same refusal.
- **FR-014**: Every refusal MUST be reported through the notice model, so the outcome of the action
  does not depend on unrelated workspace state.
- **FR-015**: "Refused" means the not-a-missing-file set — too large, binary, out of tree, a folder.
  A **missing** file is not a refusal: its existing recovery path, where a panel may hold a recovered
  buffer and be saved back, is unchanged.
- **FR-016**: A panel that already exists and whose file becomes unopenable MUST keep its current
  banner behaviour (030 FR-038). This feature changes only whether a panel is **created**.
- **FR-017**: Panel creation that is not an open-a-file action — workspace restore, an explicit
  new-panel command — MUST be unaffected.
- **FR-018**: A notice row MUST render the subject's path **relative to the project root**, never the
  absolute path. The notice already names the project (030 FR-031), so the root is context and is
  elided — the same principle 030 FR-022a applies to the project and tab parts of a panel name.
- **FR-018a**: Where the subject lies **outside** the project root, no relative path exists. Such a
  row MUST render the path through the existing display-path formatter, subject to the same
  per-part truncation, so that one long path cannot break the height bound 030 FR-032 sets.
- **FR-018b**: FR-018's path MUST arrive as its **own rendered field** on the row, and MUST NOT be
  delivered by promoting the row's existing `detail` into the DOM. `detail` continues to carry the
  **absolute** path and the raw system error to Copy and the diagnostics log only (FR-018c).

  > **This requirement previously said the opposite, and was wrong.** It asserted that
  > `editor-missing-notice.ts`'s comment — *"copied and logged, never rendered (FR-034)"* — was
  > inaccurate because "a path is plainly rendered", and instructed that the comment be corrected.
  > Reading the render path settles it: the row emits `row.label` and nothing else, and `row.detail`
  > reaches the DOM by no path at all, so **the comment is accurate and MUST be left as it is**. The
  > mistake was reasoning about the rendering from the type rather than from the renderer, which is
  > the same class of error this spec's own opening section warns about.
  >
  > FR-018 itself is unaffected and is better justified than when it was clarified: after FR-013 a
  > refused open has **no panel**, so `panelName` — the only thing a row renders today — does not
  > exist for it. A panel-less row has to render something, and the project-relative path is the
  > thing the user would recognise.

- **FR-018c**: The full absolute path MUST remain in Copy and the diagnostics log unchanged (029
  FR-018, 030 FR-048). Rendering the relative form narrows what is *shown*, never what is
  *recoverable* — a bug report still needs the absolute path.
- **FR-019**: A panel's own failure banner MUST NOT print the same path twice. The banner names the
  path once (030 FR-040a); the reason is not a second copy of it.
- **FR-019a**: FR-019 is **already honoured** and MUST be kept so by a guard rather than implemented.
  Both panel types compose a path-free headline — `'This file could not be read'`
  (`editor-failure.ts`) and `'This terminal could not be opened'` (`terminal-panel.tsx`) — beside a
  single rendered `detail.path`. Nothing prints it twice today.

  > A requirement that is true with nothing asserting it is **exactly** how 029 FR-016, FR-019 and
  > 030 FR-037a came to stop holding, which is the defect this whole feature exists to repair. So
  > FR-019 takes a guard under FR-028 like every other restored requirement, and does not take an
  > implementation task — writing one would mean changing code that is already correct.

#### Group 4 — A keyboard route to a notice (#314)

- **FR-020**: A command `focus.notice` MUST move focus to the most recent notice on screen. This
  supplies the keyboard half of 030 FR-060a, which that requirement deferred to #314 by name.
- **FR-020a**: `focus.notice` MUST be scoped **EVERYWHERE**, joining the existing `focus.*` command
  family (`focus.left`, `focus.cycle`, …) which is scoped that way already. A notice can be raised
  while any surface has focus, including a terminal, so a narrower scope would leave it unreachable
  exactly where it is most likely to appear.
- **FR-020b**: Its default chord MUST be **`Ctrl+Alt+M`** — unbound today, and in the `Ctrl+Alt`
  family throng already owns, which keybindings.ts records as being in neither constitutional tier
  (constitution IV), so it displaces no hosted line-editor binding and needs no exception.
- **FR-020c**: A notice MUST NOT be added to the `focus.cycle` ring. The ring is cycled constantly and
  a notice is transient — a notice that times out mid-cycle would change what the next press does.
- **FR-020d**: `focus.notice` MUST be **idempotent**: every press focuses the most recent live notice,
  and pressing it again re-focuses that same notice. It MUST NOT cycle or walk through the stack.
  Several notices can be live at once (FR-003a, FR-006), and traversing them is already Tab's job
  under FR-023 — so the binding only has to get the user *into* the stack, which is all SC-005's one
  keystroke claims. Cycling here would also contradict FR-020c's own reasoning, since a notice that
  expires mid-sequence would change what the next press does.
- **FR-020e**: A notice arriving while another is focused MUST NOT steal focus, and MUST NOT change
  what the next press of the binding targets while focus remains inside the stack. This is FR-010's
  rule about a flash, applied to a new arrival: the user is reading, and the surface must not move
  under them.
- **FR-021**: From that notice, the casualty list MUST be reachable and scrollable by keyboard
  (030 FR-032b, preserved by FR-060).
- **FR-022**: Escape MUST return focus to **the element that had focus before the binding was
  pressed**.
- **FR-022a**: FR-022 holds wherever inside the notice stack focus has since travelled. A user who
  presses the binding, tabs on to a second notice and then presses Escape MUST land back on the
  element they started from — not on the notice they arrived from, and not on the document body. The
  origin is captured when the binding is pressed and is not re-captured by Tab.
- **FR-022b**: Where the origin element no longer exists when Escape is pressed — its panel was
  closed, its tab went — focus MUST fall back to a real, focusable surface rather than the document
  body, for the same reason FR-026 gives.
- **FR-023**: Focus MUST NOT be trapped — a user who tabs into a notice can tab out again (030
  FR-032b, preserved by FR-060).
- **FR-024**: Pressing the binding with no notice on screen MUST do nothing, and MUST NOT raise a
  notice saying so — that would be a notice about the absence of notices.
- **FR-025**: A notice carrying a focusable list MUST show a visible affordance that it is focusable
  **before** focus arrives, not only a focus ring that appears afterwards.
- **FR-025a**: That affordance MUST be **observable in the markup**, not in the stylesheet alone — an
  element or attribute a test can assert without a rendering engine. A cue expressed only as CSS is
  untestable at the layer that owns focus behaviour (jsdom applies no stylesheet), so it would have
  to be proven by an E2E launch, and Constitution V reserves E2E for what no cheaper layer can
  observe. The **styling** of the cue remains CSS and remains unasserted, like all styling.
- **FR-026**: A notice that is dismissed or times out while focused MUST return focus where it came
  from, rather than dropping it to the document body.
- **FR-027**: The binding MUST be registered through the application's existing keybinding
  configuration, so it is visible and rebindable in Preferences like every other binding.

#### Group 5 — Keeping it true

- **FR-028**: Each restored requirement MUST gain a guard that fails when it stops holding. Three
  shipped requirements silently stopped being honoured; restoring them without a guard leaves the next
  regression exactly as undetectable.
- **FR-029**: Each guard MUST assert the requirement's **observable outcome** — the notice count, the
  row count, the absence of raw error text — rather than the shape of the code that currently produces
  it, so a refactor does not quietly retire it.
- **FR-030**: Each guard MUST be written at the lowest layer that can observe the outcome. Counting
  notices raised for one cause, and counting rows for one repeated casualty, are both decidable well
  below an Electron launch.
- **FR-030a**: Each guard's sensitivity MUST be proven **once, during implementation**, by reverting
  that guard's fix and observing **that** guard fail — and the pairing (guard → the failure observed)
  MUST be recorded in the pull request. A guard nobody has ever seen go red is an assertion that it
  would, which is exactly the assumption Group 5 exists to stop making.
- **FR-030b**: FR-030a MUST NOT ship as tooling. No mutation harness, no new gate stage, and no
  paired negative test that re-drives the pre-fix behaviour. What must hold continuously is that a
  future regression fails something, which the guard itself delivers; re-proving each guard's
  sensitivity on every run is machinery for a fixed handful of guards, and Constitution VIII rules out
  building it before there is a need.

### Key Entities

- **Cause**: The underlying thing that failed — a folder that went, a limit that refused a file. Already
  the unit of consolidation under 029 FR-019 and 030 FR-035/036; this feature adds no new kind.
- **Casualty**: One thing defeated by one cause — identified by the subject it failed on and the
  reason, plus the panel where there is one. This feature makes that identity explicit, because it is
  what FR-007 de-duplicates on. A casualty need not have a panel: a removed folder defeats tree nodes,
  and its notice carries no casualty list (FR-007a); a refused open (FR-013) defeats a subject with no
  panel at all, and is the case that forces the panel to be optional (FR-007b).
- **Casualty list**: 030's **affected-panel list**, generalised so its row is a casualty rather than a
  panel (FR-007b) — the panel becomes optional and the de-duplication key becomes the casualty
  identity. A row with a panel renders exactly as it does today, grouped under its tab in the
  workspace's order; a row without one renders ungrouped through the same formatter (FR-007c), in a
  deterministic order that does not inherit arrival order (FR-007d). This is a widening of an existing
  entity, not a new one, which is what keeps #278 and #328 one mechanism rather than two.
- **Notice**: Unchanged from 030 — the transient report carrying a severity, subject, message, optional
  casualty list and optional supporting detail.
- **Flash**: The existing notice being made louder on a repeat. Not a new notice, not a new row, and
  not a change to the notice's contents.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Removing a folder with any number of expanded descendants produces exactly **one**
  notice, measured at 1, 3 and 5 expanded descendants.
- **SC-002**: **Zero** raw system error strings are rendered on any notice, while the same string is
  present in both the Copy payload and the diagnostics log for every notice that has one.
- **SC-003**: Opening the same refused file **ten** times with the notice on screen produces one
  notice carrying exactly **one** row.
- **SC-003a**: The ten repeats in SC-003 are measured on a casualty with **no panel**, which is what a
  refused open now produces — one notice, one row, zero panels. The same measurement on a casualty
  **with** a panel yields the same counts, so one de-duplication key demonstrably serves both.
- **SC-004**: Opening a refused file creates **zero** panels, and the count is identical with 0, 1 and
  3 editor panels already open — the outcome no longer varies with workspace state.
- **SC-005**: A keyboard user reaches **the notice carrying the casualty list** in **one** keystroke
  from anywhere in the application — including from a focused terminal — against an unbounded number
  of Tab presses today. The list itself is then reachable from that notice (FR-021); the measured
  claim is about arriving at the notice, because that is the step which currently has no bound at all.
- **SC-005a**: A notice re-triggered at intervals shorter than its configured timeout stays on screen
  indefinitely, measured at **five** repeats spaced at half the timeout — where today it expires
  mid-sequence.
- **SC-005b**: A row shows the subject's path relative to the project root; the absolute path appears
  in the Copy payload and the log. Verified on a subject whose absolute path exceeds **100**
  characters, where the rendered row stays inside the notice's height bound.
- **SC-006**: Every requirement restored in Groups 1–3 has a guard that fails when the requirement is
  removed — verified **once during implementation** by reverting the fix and observing that guard
  fail, not by assertion. The pairing of guard to observed failure is recorded in the pull request;
  no mutation tooling ships and no gate stage is added (FR-030a, FR-030b).
- **SC-006a**: A removal defeating five tree nodes yields **one** notice and **five** log entries —
  the count on screen falls while the count in the log does not.
- **SC-006b**: Opening the same refused file produces the **same** outcome — zero panels, one
  notification — across **every** entry point FR-013a and FR-013d name. The count is deliberately not
  written as a number: an earlier version said "all three", FR-013d then named another, and a
  measurable outcome that has to be re-counted every time the requirement list moves is one that will
  eventually be wrong without anyone noticing.
- **SC-006c**: Three independent sibling folder removals yield **three** notices, and one removal with
  four expanded descendants yields **one** — measured as two separate cases, so that suppression is
  shown to key on ancestry rather than on arrival time.
- **SC-006f**: The one-notice result of SC-006c is identical across **every** permutation of the
  removal events' arrival order, including deepest-first. Measured by permuting the order, not by
  waiting — a result that needs a delay to be right is the time-grouping FR-003b forbids.
- **SC-006d**: A repeat is announced to assistive technology, and the announcement does **not**
  contain the casualty list.
- **SC-006e**: Utterances equal pulses. SC-003's **ten** rapid repeats produce **one** pulse and
  **one** announcement, while ten repeats spaced beyond the pulse produce **ten** of each — measured
  as two cases, so coalescing is shown to bound the storm without silencing a genuine retry.
- **SC-007**: No behaviour established by 029 or 030 changes except where this spec names it. The
  existing failure-presentation suites pass unchanged.

---

## Assumptions

- **Flash is a small addition to an existing surface.** It is now defined (FR-008a) as a pulse plus a
  timer restart. The notice surface already distinguishes a notice growing (030 FR-037) from a new one
  being raised, and already owns the dismissal timer, so both halves are assumed to sit within that
  surface rather than needing a new notification mechanism.
- **"The deepest folder that actually went" is decidable** from the event and the tree's own state,
  per event and without waiting for its siblings (FR-003c) — the question "is an ancestor of this also
  absent?" is answerable from the path and the filesystem. Where the whole project root has gone and
  no ancestor inside it survives, FR-002 falls back to naming the highest node it can name truthfully
  rather than guessing.
- **#278's two defects are one fix each, in one place.** The event storm and the rendered errno are
  both on the notice path; if they turn out to be in different layers, Group 1 is still one group.
- **The refusal set is the existing not-a-missing-file set** — too large, binary, out of tree, folder.
  This feature does not add a reason, remove one, or change how any of them is classified.
- **The keyboard binding does not collide with a reserved terminal key.** A terminal panel forwards
  nearly everything to the shell, so the binding must come from the tier that the application keeps.
- **Escape's existing meanings take precedence.** Where a modal or a find bar already binds Escape,
  returning focus from a notice is the lower-priority meaning and does not steal it.
- **No new setting is introduced.** The keybinding is registered in the existing keybinding
  configuration (FR-027); nothing here becomes a preference of its own.

---

## Clarifications

### Session 2026-08-26

- Q: Does a folder-removal notice carry an affected-panel list, or is de-duplication independent of
  that list? → A: **De-duplication is keyed on the cause and is independent of the list.** A notice
  MAY carry an affected-panel list (a refused open does) or none (a folder removal does not), and the
  same suppression mechanism serves both. A casualty's identity generalises to *(subject, reason)*
  plus the panel where there is one. Recorded as **FR-007a**; FR-007 and the *Casualty* entity
  updated to match.

- Q: Does a notice row render the path? → A: **Yes, but only the path relative to the project root.**
  The notice names the project already, so the root is context and is elided, the same way 030
  FR-022a elides the project and tab parts of a panel name. This also settles #327's second
  observation: the source comment is what is wrong, not the rendering. Recorded as **FR-018**,
  **FR-018a** (out-of-project subjects), **FR-018b** (correct the comment) and **FR-018c** (Copy and
  the log keep the absolute path).

- Q: Which binding focuses the most recent notice? → A: **A dedicated `focus.notice` command, scoped
  EVERYWHERE, default `Ctrl+Alt+M`.** It joins the existing `focus.*` family rather than inventing a
  vocabulary, and `Ctrl+Alt+M` is unbound and in the family keybindings.ts records as being in
  neither constitutional tier. Notices are explicitly NOT added to the `focus.cycle` ring. Recorded
  as **FR-020**, **FR-020a**, **FR-020b**, **FR-020c**.
- Q: What is the flash, observably? → A: **Pulse the notice card and restart its dismissal timer.**
  Nothing is added, nothing changes, no repeat count is rendered. Restarting the timer is what stops
  a notice expiring while the user is still producing the condition. Recorded as **FR-008a**,
  **FR-008b**, **FR-008c** (Dismiss-only and Never-display cases) and **FR-008d**.

- Q: Does consolidating a notice also reduce what reaches the diagnostics log? → A: **No —
  suppression is a presentation rule only.** Every casualty is logged, at the same level as the cause,
  including those whose notice was suppressed and those whose row was not appended. One removal
  defeating five tree nodes gives one notice and five log entries. Recorded as **FR-005a**,
  **FR-005b**.
- Q: What does a screen reader hear when a casualty repeats and the notice only pulses? → A: **A
  short, polite announcement naming the recurring subject.** The pulse is visual-only, so silence
  would leave a screen-reader user unable to tell whether their retry registered. It must not re-read
  the affected-panel list — 030 FR-032a stands. Recorded as **FR-011a**, **FR-011b**.
- Q: Does FR-013 bind the drag-and-drop path too? → A: **Yes — it binds every entry point that would
  create a panel**, including a drop that creates one; a drop onto an existing panel creates nothing
  and is unaffected. The two refusal paths (`DropRejection` and the load-result reason) need not
  converge, but must produce the same observable outcome. Recorded as **FR-013a**, **FR-013b**,
  **FR-013c**.
- Q: Several unrelated sibling folders removed at once — one notice or several? → A: **One per removed
  folder whose parent survives.** Descendants are suppressed by their ancestor; independent siblings
  are independent causes. Co-incident removals are explicitly NOT merged, because 030 FR-036 forbids
  grouping by time or window and this feature does not supersede it. Recorded as **FR-003a**,
  **FR-003b**.
- Q: After FR-013 a refused open creates no panel — so what does its notice's affected-panel list hold?
  → A: **Generalise the list to a casualty list whose panel is optional.** `affected.ts` requires a
  `panelId`, `tabId`, `tabName`, `tabOrder` and `panelOrder` on every row and de-duplicates on
  `panelId`, so a refused open would have had nothing to key on and #328 would have stayed unfixable
  for exactly the case #327 creates. The key becomes the casualty identity FR-007 already states.
  Panel rows render unchanged; panel-less rows render ungrouped, deterministically ordered, through
  the same formatter and truncation. Recorded as **FR-007b**, **FR-007c**, **FR-007d**; FR-007,
  FR-007a, the *Casualty* entity and the new *Casualty list* entity updated to match, and this spec's
  own references to the "affected-panel list" renamed throughout (quotations of 029/030 left as
  written).
- Q: Several notices can be live at once — what does a second press of `focus.notice` do, and does an
  arriving notice steal focus? → A: **The binding is idempotent; Escape returns to the element focused
  before it was pressed.** Every press focuses the most recent live notice; it never cycles or walks
  the stack, because FR-023 already makes Tab the way through it and cycling would break the same
  reasoning FR-020c uses to keep notices out of the ring. An arriving notice never steals focus. The
  Escape origin is captured at the press and survives tabbing on to another notice, with a real
  focusable fallback if the origin is gone. Recorded as **FR-020d**, **FR-020e**, **FR-022a**,
  **FR-022b**; FR-022 tightened to name the element.
- Q: FR-011a announces every pure repeat — what stops SC-003's ten repeats becoming ten queued
  utterances? → A: **The announcement follows the pulse — exactly one per pulse.** Repeats arriving
  during a running pulse are absorbed into it and are not separately announced, so a storm yields one
  pulse and one utterance while a spaced retry still gets its own. This binds the announcement to a
  bound the feature already had rather than inventing a timing constant, and it keeps FR-011a's
  purpose: silence after a retry was the thing to avoid. Recorded as **FR-008e**, **FR-011c**, with
  **SC-006e** measuring utterances against pulses.
- Q: A watcher can report `/a/b/c` gone before `/a/b` — how is FR-003's suppression decided when the
  ancestor's event has not arrived? → A: **Statelessly, from the removal alone — walk up and check
  whether an ancestor inside the project root is also absent.** No buffering and no wait, because a
  wait is the grouping by time FR-003b forbids; and no raise-then-amend, because a subject that
  changes after the user has read it defeats FR-002. The outcome is therefore identical under every
  arrival order. Recorded as **FR-003c**, **FR-003d**, with **SC-006f** permuting the order rather
  than waiting.
- Q: SC-006 asks each guard to be proven by removing it — is that tooling that ships, or a one-off? →
  A: **A one-off during implementation, recorded in the PR.** Each guard's fix is reverted once, that
  guard is observed to fail, and the pairing is written down. No mutation harness, no new gate stage,
  no paired negative test — what must hold continuously is that a future regression fails something,
  which the guard itself delivers, and building machinery to re-prove sensitivity for a fixed handful
  of guards is the speculative generality Constitution VIII rules out. Recorded as **FR-030a**,
  **FR-030b**; SC-006 tightened to say so.

**No open questions remain.** Ready for `/speckit-plan`.

### Corrections from analysis — 2026-08-26

Not clarifications. These are places where a requirement, written in good faith, did not survive being
checked against the code, and they are recorded rather than quietly amended because **a wrong
requirement that is silently fixed teaches nobody anything**.

- **FR-018b said the opposite of what the code does, and has been rewritten.** It claimed a source
  comment was inaccurate; the render path shows the comment is correct. FR-018 stands. The lesson is
  narrow and worth keeping: the claim was reasoned from the row *type* (which carries a `detail`
  field) rather than from the *renderer* (which never emits it).
- **FR-019 is already honoured**, in both panel types, and gains **FR-019a**: it takes a guard rather
  than an implementation. It had no task at all, which is how a true-but-unasserted requirement
  becomes an untrue one — the exact history of the three requirements this feature restores.
- **FR-025 gains FR-025a**: the affordance must be observable in the markup, not the stylesheet
  alone, or the requirement can only be proven by an E2E launch that Constitution V would refuse.
- **FR-008a gains FR-008aa**: "briefly" has no duration on purpose, and the pulse must be observable
  as a state with a start and an end, so FR-008e and FR-011c hang on that rather than on a clock.

**Second analysis pass**, run against the source rather than the artifacts, and it found the sharper
version of the same class of mistake:

- **FR-007 gains FR-007aa**, because "the subject and the reason, **plus** the panel" reads as a
  triple and is not one. The panel *supersedes* the pair. Within one notice the cause is already
  fixed and a given panel fails once, so `reason` can never separate two rows sharing a panel — and
  the case that looks like it should is a different **notice**, not a second row. A task had already
  been written asserting the opposite; it could not have passed.
- **FR-007 gains FR-007e**, because the widening as specified would have made `subject` and `reason`
  required on every row, breaking six construction sites at compile time — including the four test
  files whose job is to prove the old behaviour survived. A widening that edits those tests can no
  longer prove anything about them.
- **FR-013a gains FR-013d**, because "every entry point" missed one: `openFileInNewEditor` is
  synchronous, never calls `openInto`, and is invoked directly by the explorer's own *Open In → New
  Editor*. The compile-time enforcement the design leans on does not reach a function that never asks
  the question.

---

## Dependencies

- **029 Failure-Path Integrity** — FR-016, FR-017, FR-018, FR-019 are restored, not amended.
- **030 Failure Presentation** — FR-031/031a/031b, FR-032/032a/032b, FR-034/034a, FR-035, FR-036,
  FR-037/037a, FR-038, FR-040a, FR-048/048a, FR-060/060a all stand. This feature supplies FR-060a's
  deferred keyboard half and proves conformance with the rest.
- **#307** — *nothing detects a functional requirement that production code has stopped honouring* — is
  the general form of what Group 5 addresses locally. This feature does not close #307; it stops three
  specific requirements from being silently retired again.
