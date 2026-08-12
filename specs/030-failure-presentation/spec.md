# Feature Specification: Failure Presentation — Preferences, Subjects, Consolidated Notices and Shared Banners

**Feature Branch**: `feature/S030-failure-presentation`

**Created**: 2026-08-11

**Status**: Draft

**Input**: User description: "Create a new worktree and create a spec that covers #224 + #195",
then "Adopt #238, #235 and #236 into this spec. Reorder requirements based on known blockers for each
issue."

**Issues covered**:

| Issue | Type | Title |
|---|---|---|
| [#224](https://github.com/Bidthedog/throng/issues/224) | Enhancement | Configurable notification persistence and timeout, per severity |
| [#195](https://github.com/Bidthedog/throng/issues/195) | Enhancement | Notices should name their subject — pane, tab, panel, panel type, title |
| [#235](https://github.com/Bidthedog/throng/issues/235) | Tweak | One notice for a project that cannot be loaded, listing every affected panel |
| [#236](https://github.com/Bidthedog/throng/issues/236) | Tweak | One shared failure banner for every panel type, with retry and cancel |
| [#238](https://github.com/Bidthedog/throng/issues/238) | Enhancement | Copy the whole of any error — notices and panel banners |

## Overview

Everything throng does to tell a user that something failed, brought into one shape.

Today a notice tells the user *what* went wrong but not *which thing* it went wrong to; it decides how
long to stay on screen from a rule the user cannot see or change; one cause produces several notices
phrased three different ways; each panel type states its own failure in its own words with its own
controls; and what reaches the clipboard is less than what is on the screen.

Five issues, one surface. They are specified together because they are not independent: the subject
format #195 introduces is the format #235's affected-panel list is built from, #236's banner
deliberately delegates its detail to #235's notice, and #238's copy control lives on #236's shared
component and copies #235's list. Landing them in any other order means building something twice.

## Clarifications

### Session 2026-08-11

- Q: How should a severity's display behaviour be configured, and what timeout range is accepted?
  → A: Three modes per severity — **Never display** (not shown, still logged), **Display for X ms**
  (X between 1500 and 60000), and **Dismiss only** (stays until dismissed).
- Q: Which notices reach the diagnostic log — all of them, or only the undisplayed ones?
  → A: Every notice is logged whatever its mode, at a level derived from its severity
  (error → error, warning → warn, info and success → info).
- Q: What does the anti-regression guard actually check, given "the subject was available" is a human
  judgement? → A: The subject becomes part of what a notice is — every notice states its subject or
  explicitly states that none is available, enforced structurally so omission is not expressible —
  plus a check on banned generic phrases ("this item" and similar).
- Q: Where does the stated subject appear — is it presented by the notice, or written into the sentence
  by whoever raises it? → A: The notice presents it. The subject and what was attempted form the
  notice's heading; the message says only what went wrong.
- Q: Should silencing a severity be visible somewhere, given a user can switch errors off and forget?
  → A: Choosing **Never display** for `error` or `warning` asks for confirmation, explaining that those
  events will only reach the log. No persistent indicator elsewhere in the interface.
- Q: Does the consolidated notice replace per-tab batching everywhere, or only for the causes it
  covers? → A: Everywhere. Batching by tab is removed outright; every multi-panel failure groups by
  cause, whatever produced it. One rule, not two coexisting ones.
- Q: How should the growing, scrollable list behave for screen readers and the keyboard? → A: Announce
  the delta, not the whole notice — a growth announcement says what was added rather than re-reading
  the list — and make the list keyboard-scrollable with its controls reachable in tab order, without
  trapping focus.
- Q: Should the affected-panel list be clickable — do rows navigate to their panel? → A: No. The list
  reports; the panel's own banner is where the actions are, and the user meets the affected panels as
  they move about the project.
- Q: Are panels on tabs that have not been rendered included? → A: No — the list holds what is known
  so far and grows as the user visits tabs. Visiting Tab 2 adds its affected panels to the notice
  already on screen rather than raising a second one; only if that notice has been dismissed does a
  fresh one appear. This replaces the original #235 criterion asking for unrendered tabs to be
  included.
- Q: What order are the affected panels listed in? → A: Layout order — tab order, then panel position
  within the tab. Two refinements settled with it: a notice is **per project**, so the project is named
  once in the heading and never repeated per row; and the list is **grouped by tab**, each tab name a
  heading with its affected panels beneath it.
- Q: What does "a later panel joins the existing notice" mean when that notice is gone — dismissed,
  timed out, or never displayed? → A: A live notice grows; a gone notice raises a fresh one for the
  same cause, listing the newly affected panels. Dismissing means "I have read this", so a panel
  defeated afterwards is new news.
- Q: 029 classifies causes from a closed set, so an unclassified failure has no cause to group by.
  What groups those? → A: The originating operation. One project load, one tab restore, one bulk
  delete produces one notice however many panels it defeated — so grouping is by cause where a cause
  exists and by the operation that produced it otherwise. 029's closed set is not reopened.
- Q: What exactly does a display mode govern — every way throng reports a failure, or only the toast?
  → A: Only the toast. The notification preferences govern notices and nothing else; a panel's failure
  banner is always shown regardless of them, as is anything a shell prints into its own terminal. A
  user who silences a severity has silenced the toasts, and that is their decision to make.

## Delivery order and why

The user stories below are ordered by what blocks what, not by how much each is wanted. Every arrow is
a dependency stated in the issues themselves.

```
US1  #224  preferences ─────────────────────────────► (independent)
US2  #195  subject model ──┬──► US3  #235  one notice per cause ──┬──► US4  #236  shared banner ──┐
                           │                                      │                              │
                           └──────────────────────────────────────┴──────────────────────────────┴──► US5  #238  copy everything
                                                                                                       │
US6  inventory, phrase check and corrected docs ◄──────────────────────────────────────────────────────┘
```

| Story | Depends on | Why |
|---|---|---|
| US1 (#224) | nothing | Self-contained. Also the reason a consolidated notice with a scrollable list is usable at all — #235 explicitly needs a notice that does not vanish on a five-second timer |
| US2 (#195) | nothing | Introduces the `Project — Tab — Panel` subject format everything downstream renders |
| US3 (#235) | US2 | Its affected-panel list *is* the subject format applied to many subjects at once; #235 says it consumes that rather than inventing a parallel format |
| US4 (#236) | US3 | The banner deliberately carries no detail and points at the consolidated notice instead. Landing it before US3 means pointing at a notice that does not yet exist |
| US5 (#238) | US3, US4 | It copies US3's affected-panel list, and its banner copy control belongs on US4's shared component — added once, not per panel type |
| US6 (#195 remainder) | US2, US3, US4 | The inventory and phrase check must describe the notices as they finally are; running them before US3 rewrites the notices means doing the sweep twice |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Decide whether and how long a notice appears (Priority: P1)

A user finds that notices vanish before they have read them — and that one kind of notice they never
wanted to see at all. They open Preferences → Settings, find a **Notifications** category with a row
for each kind of notice — error, warning, info, success — and for each one choose between never showing
it, showing it for a set number of milliseconds, or showing it until they dismiss it.

**Why this priority**: It depends on nothing, and everything after it is easier to use once it exists —
a consolidated notice carrying a scrollable list of forty panels is unreadable on a five-second timer.
It also ships and delivers value with no message copy changed at all.

**Independent Test**: Set a severity to Dismiss only, raise a notice of that severity, and confirm it
stays until dismissed. Set the same severity to Display for 2000 ms and confirm the notice leaves on
its own. Set it to Never display and confirm nothing appears while the event still reaches the log.

**Acceptance Scenarios**:

1. **Given** Preferences → Settings is open, **When** the user looks at the category list, **Then** a
   **Notifications** category is present containing one row per severity (error, warning, info,
   success), each offering a choice of Never display / Display for a timeout / Dismiss only, and a
   timeout value in milliseconds.
2. **Given** a severity set to **Dismiss only**, **When** a notice of that severity is raised and a
   long time passes, **Then** the notice is still on screen, and it leaves only when the user dismisses
   it.
3. **Given** a severity set to **Display for** *N* ms, **When** a notice of that severity is raised,
   **Then** it is still present shortly before *N* has elapsed and gone after it.
4. **Given** a severity set to **Never display**, **When** an event of that severity occurs, **Then**
   no toast appears — no space taken, no effect on other notices — the event is recorded in the
   diagnostic log, and any panel affected still shows its own failure banner.
5. **Given** a severity whose mode is not **Display for**, **When** the user looks at that row's
   timeout control, **Then** it is disabled — it cannot be edited, and it looks that way.
6. **Given** the user sets `error` to **Display for** 3000 ms, **When** an error notice is raised,
   **Then** it auto-dismisses after 3000 ms like any other severity — errors have no built-in
   exemption.
7. **Given** the user enters a timeout below 1500 ms or above 60000 ms, **When** they try to commit it,
   **Then** the interface prevents it — the value is not accepted, and no notice ends up with a
   timeout outside that range.
8. **Given** the user chooses **Never display** for `error` or `warning`, **When** the choice is made,
   **Then** they are asked to confirm and told those events will reach only the log; confirming
   applies the mode and declining leaves it unchanged.
9. **Given** the user chooses **Never display** for `info` or `success`, **When** the choice is made,
   **Then** it applies with no confirmation.
10. **Given** a change to any notification preference, **When** the next notice of that severity is
    raised, **Then** it uses the new value, without restarting the application.

---

### User Story 2 - Know what a notice is about (Priority: P2)

A user with several projects, panes, tabs and panels open sees a notice reporting a failure. The notice
names the concrete thing it happened to — the file, the folder, the panel, the tab, the pane, the
project — so the user can act on it without hunting for what "this item" referred to.

**Why this priority**: It is the change that makes a notice *actionable*, and it is the foundation the
three stories after it build on: the `Project — Tab — Panel` format defined here is what US3 lists, US4
identifies a panel by, and US5 copies. It is more than a copy sweep — the subject becomes a stated part
of every notice, which is what makes the naming consistent on the day it lands and keeps it that way.

**Independent Test**: Trigger a rename collision on a named file in a named project and read the
resulting notice; it names the file and the project, and never says "this item". Trigger two different
failures about the same panel and confirm both name it the same way.

**Acceptance Scenarios**:

1. **Given** a file or folder operation fails, **When** the notice appears, **Then** its heading names
   the file or folder by the name shown in the interface — and its path as well when the name alone is
   ambiguous — rather than a generic phrase such as "this item", and the message below states only
   what went wrong.
2. **Given** an operation on a panel, tab, pane or project fails, **When** the notice appears,
   **Then** its heading names that subject by its displayed title.
3. **Given** a panel is named, **When** any surface names it, **Then** it uses the form
   `Project — Tab — Panel`.
4. **Given** a terminal fails, **When** the notice appears, **Then** it names the terminal flavour
   involved.
5. **Given** a notice's message, **When** it refers to a part of the interface, **Then** it uses the
   interface's own term for it (Pane, Tab, Panel, Panel Type, Panel Title, Project, Sub-workspace) and
   no invented synonym.
6. **Given** a failure whose subject is genuinely not available where the notice is raised, **When**
   the notice appears, **Then** it presents no subject and its wording is unchanged, rather than being
   padded with a placeholder.
7. **Given** any notice made longer by naming its subject, **When** it is displayed, **Then** toast
   layout, severity colours, stacking, cause suppression and dismissal behave exactly as before —
   nothing overflows and nothing replaces another notice.
8. **Given** two different failures about the same subject, **When** both notices appear, **Then**
   they name that subject identically — same quoting, same term for its kind, same treatment of an
   over-long title.

---

### User Story 3 - One notice per cause, listing every panel it affected (Priority: P3)

A user opens a project whose folder has been renamed or moved. Instead of a storm of messages — one
about the folder, one per tab about "2 files", six panel-level errors — they get a single notice that
names the cause once and lists every panel the cause defeated, across the whole project.

**Why this priority**: It is the change with the largest visible effect on a real failure, and it is
the first thing that consumes US2's subject format. US4 and US5 both need it in place: the banner
points at this notice, and the copy control copies this list.

**Independent Test**: Open a project of several tabs whose root folder has been renamed, with editors
and terminals among the panels, and count the notices: exactly one, listing every affected panel.

**Acceptance Scenarios**:

1. **Given** a project whose root folder is missing, **When** it is opened with several tabs and
   several panels affected, **Then** exactly one notice is raised.
2. **Given** that notice, **When** it is read, **Then** it names the cause and the project once, then
   lists every affected panel known so far, grouped under its tab, in this shape:

   ```
   There was a problem loading "test 1". The following panels are affected:

     Tab 1
       • Panel 1
       • Panel 2

     Tab 2
       • Panel 3
   ```

   The raw system error is **not** rendered here — 029 FR-016 forbids a notice carrying a raw error
   string and 029 FR-018a demotes it to Copy and the log. It reaches the user through the Copy
   control (FR-048) and the diagnostic log (FR-006), both of which this feature makes complete.
3. **Given** a project with many affected panels, **When** the notice appears, **Then** the list is
   vertically scrollable within a bounded height and the notice is no taller than that cap.
4. **Given** editors and terminals defeated by the same cause, **When** the notice appears, **Then**
   they appear in the same list under their own tabs, in tab order and then panel position, with no
   grouping by panel type.
5. **Given** the underlying system error, **When** the notice appears, **Then** it is not rendered in
   the notice at all; **When** the user copies the notice or reads the log, **Then** it is there
   exactly once.
6. **Given** any multi-panel failure at all, **When** notices are raised, **Then** the former per-tab
   "Cannot open N files" / "Cannot open file" notices do not appear — for this cause or any other.
7. **Given** two genuinely different causes, **When** both occur, **Then** two notices are raised.
8. **Given** a multi-panel failure that carries no identified cause, **When** it occurs during a single
   operation, **Then** one notice is raised for that operation, listing every panel it defeated — the
   storm does not return through the unclassified route.
9. **Given** the notice is on screen showing Tab 1's affected panels, **When** the user switches to
   Tab 2 and its affected panels become known, **Then** they are added to that same notice under a
   Tab 2 group; **When** the user had dismissed the notice first, **Then** a fresh notice reports
   Tab 2's panels alone.
10. **Given** any row or tab heading in the list, **When** the user clicks it, **Then** nothing
    navigates — the list is a report, and the panel's own banner carries the actions.
11. **Given** a screen reader and a notice already announced, **When** the user visits another tab and
    the notice gains a group, **Then** only the addition is announced — the tab and how many panels
    joined — and the list is not read again from the top.
12. **Given** a keyboard-only user, **When** they tab to the notice, **Then** they can scroll the list
    and reach its controls, and tab out again without being trapped.
13. **Given** the consolidated notice, **When** panels also show their own banners, **Then** the
    banners are unaffected by this change — only the notice count changes.

---

### User Story 4 - The same failure banner in every panel (Priority: P4)

A user whose editor cannot read its file and whose terminal cannot start its shell sees the same shape
in both panels: one sentence saying what could not be done, a pointer to the detail, and the same two
controls in the same order — retry, and cancel back to the panel-type selection screen.

**Why this priority**: It depends on US3, because the banner carries no detail of its own and points at
the consolidated notice instead. It also has to exist before US5, which puts its copy control on this
shared component rather than adding one per panel type.

**Independent Test**: Break an editor's file and a terminal's shell, and compare the two banners: same
markup, same controls, same order. Press Cancel on the editor and confirm the panel survives and
returns to panel-type selection.

**Acceptance Scenarios**:

1. **Given** an editor that cannot read its file and a terminal that cannot start, **When** both show
   their banners, **Then** both are rendered by the same shared component, with the same layout,
   tokens, spacing and control order.
2. **Given** either banner, **When** it is read, **Then** its message names what could not be done in
   that panel type's own words, followed by a consistent pointer to where the detail is.
3. **Given** either banner, **When** its controls are inspected, **Then** it offers Retry and Cancel,
   in that order, with the same icons, titles and accessible names in both panel types, each drawn
   from the theme's icon tokens rather than a literal glyph.
4. **Given** a panel showing the banner, **When** the user opens that panel's own menu, **Then**
   Retry and Cancel are there as commands, for every panel type.
5. **Given** an editor showing the banner, **When** the user presses Cancel, **Then** the panel
   returns to the panel-type selection screen, keeping the panel, its position in the layout and its
   title — it is not deleted.
6. **Given** a terminal showing the banner, **When** the user presses Cancel, **Then** it behaves as
   Clear panel type does today, with no regression to the behaviour specified by 029 FR-004a.
7. **Given** either banner, **When** the user presses Retry and the retry succeeds, **Then** the
   banner disappears along with the condition; **When** the retry fails, **Then** the banner remains
   and says the retry failed.
8. **Given** a banner, **When** the user looks for a way to close it, **Then** there is none — it is
   not dismissible while its condition holds.
9. **Given** an editor that cannot read its file, **When** its banner is read, **Then** it still names
   the path it could not read — 027 (#161) FR-011's protection against saving a recovered buffer over
   a moved path is unchanged.
10. **Given** each shipped theme in turn, **When** a banner is rendered, **Then** it renders legibly,
    taking every colour from that theme.

---

### User Story 5 - Copy the whole of any error (Priority: P5)

A user about to file a bug report copies the failure. What lands on the clipboard is everything they
can see — heading, message, the full list of affected panels, and the raw system error — and the same
is true from a panel's banner, where today there is no way to copy at all.

**Why this priority**: Last, because it copies what US3 renders and its banner control lives on US4's
shared component. Doing it earlier means writing the copy logic twice and adding the control per panel
type.

**Independent Test**: Trigger the consolidated notice, press Copy, paste into an editor panel, and
compare against what is on screen. Then do the same from a panel banner with no notice on screen.

**Acceptance Scenarios**:

1. **Given** a notice that renders an affected-panel list, **When** the user copies it, **Then** the
   clipboard holds that list in the same order it is displayed.
2. **Given** any notice, **When** the user copies it, **Then** the clipboard holds every rendered part
   — heading, message, list, and raw system detail — in reading order.
3. **Given** a future notice that renders a part nobody has thought of yet, **When** it is copied,
   **Then** that part is included, because the copy text is derived from what the notice renders
   rather than from a separately maintained list of fields.
4. **Given** a panel failure banner in any panel type, **When** the user looks at its controls,
   **Then** a copy control sits alongside ↻ and ✕.
5. **Given** a banner's copy control, **When** it is used, **Then** the clipboard holds the banner's
   message, its subject as `Project — Tab — Panel`, the path involved, and the underlying system
   error.
6. **Given** a banner whose related notice has already gone — dismissed, timed out, or never
   displayed — **When** the user copies from the banner, **Then** the copy still contains all of the
   above.
7. **Given** any copied failure text, **When** it is pasted into an editor panel, **Then** it arrives
   unchanged, with no reformatting.

---

### User Story 6 - Keep it true after this change (Priority: P6)

A maintainer adding a new notice later cannot ship one that says nothing about what it is about, and a
reviewer can see which notices were examined and which were deliberately left alone.

**Why this priority**: Last, because the inventory and the phrase check must describe the notices as
they finally are. Running them before US3 rewrites the project-load notices means doing the sweep
twice. The structural half of #195 — a notice that cannot omit its subject — is not deferred; it lands
with US2.

**Independent Test**: Add a notice whose text says "this item" and confirm the project's own checks
reject it. Separately, read the inventory and find every notice accounted for.

**Acceptance Scenarios**:

1. **Given** the completed sweep, **When** a reviewer asks whether it was exhaustive, **Then** an
   inventory exists covering every user-facing notice and banner string and, for each, whether it names
   its subject and why not if it does not.
2. **Given** a newly written notice that neither names a subject nor declares that none is available,
   **When** the project's checks run, **Then** they fail and identify the notice.
3. **Given** a notice whose text refers to its subject as "this item" or a similar generic stand-in,
   **When** the project's checks run, **Then** they fail and identify the notice.
4. **Given** the stated description of how severity governs display, **When** this feature is complete,
   **Then** it describes the configurable behaviour rather than contradicting it.

---

### Edge Cases

**Preferences and display modes**

- **A settings file written before this change** — it has no notification preferences at all. It must
  load and yield the shipped defaults, with no error notice about the configuration.
- **A malformed or out-of-range value** — a negative or non-numeric timeout, a timeout outside
  1500–60000 ms, an unrecognised mode, an unknown severity name, a missing severity row. The affected
  value resolves to its shipped default; the rest of the file is honoured; nothing throws and the user
  is not blocked from opening Preferences.
- **Errors set to Never display** — permitted once confirmed; the preference is the user's. The
  diagnostic log remains the complete record, which is what makes silencing a severity a recoverable
  decision rather than a destructive one.
- **A settings file that already silences errors** — a configuration edited by hand, or carried from
  another machine, applies without a confirmation; the confirmation governs the act of choosing in
  Preferences, not the loading of a file.
- **A preference changed while notices are already on screen** — already-live notices keep the
  behaviour they were raised with; the change applies from the next notice onward. In particular,
  switching a severity to Never display does not retract notices already visible.
- **Sub-workspace windows** — a notice raised in a secondary window obeys the same preferences as the
  main window.

**Subjects**

- **A subject whose displayed title is very long or contains quotes/emoji** — the notice names it
  without breaking layout.
- **A subject renamed or closed between the failure and the notice being read** — the notice names the
  subject as it was at the time of the failure; it does not go blank or update.
- **A panel with no tab or no project context** — the `Project — Tab — Panel` form degrades by omitting
  the parts that do not exist rather than printing empty separators.

**Consolidated notices**

- **Cause suppression and Never display together** — they are independent and neither changes the
  other. Cause suppression decides whether a failure becomes a notice at all (029 FR-019); the display
  mode decides what happens to a notice once raised. A failure suppressed by cause never becomes a
  notice, so the logging requirement does not apply to it, and 029's behaviour is unchanged.
- **A panel affected by the cause after the notice was raised** — a tab rendered later, or a panel
  defeated later. While the notice is on screen it simply grows. Once it has gone — dismissed, timed
  out, or never displayed — a fresh notice reports the newly discovered panels only; the user is not
  shown the same panel twice, and a failure that keeps spreading after they acknowledged it is allowed
  to say so.
- **The project is closed while its notice is on screen** — the notice stays and stops growing. It
  reports something that happened, named as it was at the time; it does not retract itself, and no
  further panels join it.
- **A project whose affected panels are never all discovered** — the user never visits Tab 3, so its
  panels never reach the list. That is correct: the list reports what is known, the panel states its
  own condition when the user arrives, and nothing eagerly renders tabs to populate a notice.
- **A cause that keeps claiming panels one at a time while its notice is silenced** — each newly
  defeated panel raises a notice that is itself never displayed, so nothing accumulates on screen; the
  log carries them and every affected panel still shows its banner.
- **Every severity set to Dismiss only, many notices at once** — stacking, ordering and cause
  suppression are unchanged; the user can still dismiss them.
- **A project with a single affected panel** — the same consolidated notice, with one tab group holding
  one panel; no separate singular phrasing to maintain.
- **One cause defeating panels in several projects** — one notice per project, each naming its own
  project and listing only that project's panels. A cause that is not project-scoped at all (a stopped
  daemon, say) raises one notice with **no** affected-panel list: it is not about particular panels,
  and inventing a cross-project list for it is out of scope (see Out of Scope).
- **An affected panel that belongs to no project** — the notice names no project and the list is
  grouped by tab alone. A panel always sits in a tab, so a tab-less panel is not a state this model
  admits; if one ever arises it is a defect in the workspace model, not a case for the list to paper
  over.
- **Two panels defeated by two different unclassified failures in one operation** — they share the
  operation, so they share a notice. Each panel carries its own raw error, which reaches the user
  through Copy (FR-048a) and the log, never rendered (FR-034).
- **A multi-panel failure the project-load path never sees** — for example a file deleted while the
  project root is fine. It groups by cause like any other; there is no surviving per-tab route for it
  to take.
- **A multi-panel failure 029 declined to classify** — no cause, so it groups by the operation that
  produced it and still raises one notice. Its wording is unchanged from today; only the grouping is
  new.

**Banners**

- **A banner pointing at a notice the user will never see** — the severity is set to Never display, or
  the notice has already timed out. The banner itself still appears; its pointer must not promise a
  notice that is not there, and its own copy control must yield the full detail regardless.
- **Every severity silenced** — the panels still show their banners, so a user who has turned off all
  toasts can still see which panels failed and copy the detail from each. Silence applies to the toast
  surface only.
- **A panel whose condition clears while the panel is not visible** — the banner goes with the
  condition, whether or not anyone was looking.
- **Retry pressed repeatedly on a condition that keeps failing** — each attempt reports its own
  failure; the banner does not accumulate messages or stack notices.

**Copying**

- **Copying while a notice's list is scrolled** — the clipboard holds the whole list, not the visible
  portion.
- **A notice that grows repeatedly as the user walks the tabs** — each growth announces only its own
  addition; the announcements do not accumulate into a re-reading of the notice, and the notice does
  not steal focus from whatever the user is doing.
- **A notice that grows while the user has focus inside its list** — the addition does not move their
  focus or scroll position.
- **Copying when the clipboard is unavailable** — the failure to copy is itself reported through the
  notice model, and is not silent. Where that severity is set to Never display the report reaches only
  the log, which is the user's own choice applied consistently rather than a special case.

## Requirements *(mandatory)*

Requirements are grouped and numbered in delivery order — the order the *Delivery order and why*
section derives from the issues' own dependencies. Nothing in a later group is a prerequisite of an
earlier one.

### Functional Requirements

#### Group 1 — Configurable display behaviour (#224, US1)

- **FR-001**: The application MUST hold, for each of the four severities (`error`, `warning`, `info`,
  `success`), a user preference selecting one of exactly three display modes — **Never display**,
  **Display for** a configured timeout, or **Dismiss only** — together with that severity's timeout
  value.
- **FR-002**: Preferences MUST expose these values in a **Notifications** category with one row per
  severity, each offering the mode choice and a timeout value entered as a number of milliseconds.
- **FR-003**: A notice of a severity set to **Dismiss only** MUST remain on screen until the user
  dismisses it, regardless of its configured timeout.
- **FR-004**: A notice of a severity set to **Display for** *N* ms MUST leave on its own once *N* has
  elapsed.
- **FR-005**: An event of a severity set to **Never display** MUST NOT be *displayed* — no toast is
  shown, no space is occupied, and no other notice's position or dwell is affected. It is still an
  **accepted** notice: it passes the duplicate and cause checks, and everything that follows from
  acceptance — the log record above all — happens exactly as it would if it were on screen. "Accepted"
  is the word FR-006 means by "every notice"; a notice rejected as a duplicate is not one.
- **FR-005b**: A silenced notice MUST be de-duplicated exactly as a displayed one is. The duplicate
  and cause checks compare against notices that are *live*, so a notice that never enters the list
  would be compared against nothing — and a file watcher re-firing one unchanged failure would write a
  record every time, where the same event displayed writes one. The application MUST therefore
  remember a silenced notice for as long as the displayed one would have lasted: **its severity's
  configured `timeoutMs`**, which every severity carries whatever its mode. After that window the
  event is genuinely new again, exactly as it would be for a notice the user had watched expire.
- **FR-005c**: That memory MUST be keyed by the notice's group key where it has one, and MUST suppress
  only a notice reporting **nothing new**. A notice whose affected panels include one not yet reported
  for that key is new information and MUST write a record naming **the panels that are new**, matching
  the displayed path's growth record (FR-006a) in content as well as in count. Without this the silenced
  path writes one record where the displayed path writes one plus a growth per newly discovered
  panel — and a cause that keeps claiming panels while silenced would go unrecorded after the first,
  which is the opposite of what silencing is allowed to cost.
- **FR-005a**: The notification preferences MUST govern notices and nothing else. A panel's failure
  banner MUST be shown whenever its condition holds, whatever the display mode of any severity, and
  terminal output is untouched by these preferences — **including the lines throng itself writes into
  a terminal**, not only those the shell writes. The audit behind FR-017 found throng printing
  `[throng] Could not run the startup command:` straight into the stream with no accompanying notice
  (`terminal-service.ts:535`), so an exemption phrased as "whatever a *shell* prints" would exempt a
  stream by its owner rather than by its speaker, and leave throng's own reports in neither camp.
- **FR-006**: Every notice MUST be recorded in the diagnostic log, whatever its severity's display
  mode, at a log level derived from its severity: `error` → error, `warning` → warn, `info` and
  `success` → info.
- **FR-006b**: A notice record MUST be written regardless of the log's configured level threshold.
  This is a deliberate exemption from `diagnostics.logLevel`: FR-008 asks the user to consent to
  "these events will thereafter reach only the log", and with `logLevel: 'error'` — a shipped,
  selectable value — a silenced `warning` would reach *nowhere*, making that consent false and
  SC-003 unachievable. A notice is a user-facing event the user chose not to see, not diagnostic
  chatter to be filtered.
- **FR-006a**: A notice that **grows** (FR-037) MUST also write a record, naming the panels that
  joined. The log is the record of what happened, and panels discovered after the first record are new
  facts; without this, silencing a severity would lose every panel found after the first. A notice
  suppressed as a duplicate, or suppressed by cause, writes nothing — nothing happened.
- **FR-007**: The log record MUST carry enough to identify the event without the screen — at minimum
  the severity, the notice's message and its subject where FR-018 gives it one.
- **FR-008**: Choosing **Never display** for `error` or `warning` MUST ask the user to confirm,
  stating that events of that severity will thereafter reach only the diagnostic log. Declining MUST
  leave the mode as it was. Choosing it for `info` or `success` MUST NOT ask.
- **FR-009**: No other part of the interface is required to indicate that a severity is silenced; the
  Preferences row is the record.
- **FR-010**: The accepted timeout range MUST be 1500 ms to 60000 ms inclusive. Preferences MUST NOT
  allow a value outside that range to be committed.
- **FR-011**: The timeout control MUST be `disabled` while the severity's mode is anything other than
  **Display for** — inert and visibly so, by the same affordance the settings editor already uses for
  a control that does not apply.
- **FR-012**: No severity may have hard-coded display behaviour. Every severity, `error` included, MUST
  be settable to any of the three modes and MUST behave accordingly.
- **FR-013**: The shipped defaults on a fresh configuration MUST be: `error` **Dismiss only**,
  `warning` **Dismiss only**, `info` **Display for** 10000 ms, `success` **Display for** 5000 ms.
- **FR-014**: A configuration written before this feature — with no notification preferences — MUST
  load successfully and resolve to the shipped defaults, raising no error notice about the
  configuration.
- **FR-015**: A malformed, missing or out-of-range individual value MUST resolve to that value's
  shipped default without discarding the rest of the configuration and without failing to start.
- **FR-016**: A change to a notification preference MUST take effect for notices raised after it,
  without restarting the application. Re-timing or retracting notices already on screen is out of
  scope.
- **FR-017**: Every notice the application raises MUST carry a severity, so that every notice is
  governed by these preferences. Any user-facing report of an event that currently sits outside the
  notice model MUST be identified during this work and either brought into it or recorded as a
  deliberate exclusion.

#### Group 2 — Named subjects (#195, US2)

- **FR-018**: A user-facing notice MUST name the concrete subject of the event it reports, wherever
  that subject is known at the point the notice is raised.
- **FR-019**: The subject MUST be a stated part of every notice rather than something embedded only in
  its prose. Raising a notice MUST require either a subject or an explicit statement that none is
  available, so that omitting one is not expressible.
- **FR-020**: The notice itself MUST present the subject. The subject, together with what was being
  attempted, forms the notice's heading; the message states only what went wrong.
- **FR-021**: How a subject is presented — its quoting, the way its kind is named, the way a containing
  project is mentioned, and how an over-long title is shortened — MUST be decided in one place, so that
  two notices about the same kind of thing name it identically.
- **FR-022**: A panel named on its own MUST be named in the form `Project — Tab — Panel`, and every
  surface that names a panel in isolation — a notice heading, banner copy text — MUST use that one
  form. Parts that do not exist for a given panel are omitted rather than rendered empty.
- **FR-022a**: Where the surrounding context already states part of that form, the stated parts MUST be
  omitted from the name rather than repeated — in the consolidated notice the project is in the heading
  and the tab is a group heading, so each row carries the panel name alone. The remaining parts MUST
  still be written the way FR-021 establishes; context removes parts, it never re-spells them.
- **FR-023**: A notice's message text MUST NOT restate the subject that the notice already presents.
- **FR-024**: Subjects MUST be named with the terms the interface itself uses — Pane, Tab, Panel, Panel
  Type, Panel Title, Project, Sub-workspace — with no synonyms invented for the message.
- **FR-025**: File and folder failures MUST name the file or folder, never a generic phrase such as
  "this item", and MUST include the path when the name alone would be ambiguous.
- **FR-026**: Terminal failures MUST name the terminal flavour involved.
- **FR-027**: Where a subject is genuinely unavailable at the point the notice is raised, the message
  MUST be left as it is rather than padded with a placeholder or a guess.
- **FR-028**: Naming subjects MUST NOT change notice layout, severity colours, stacking, cause
  suppression or dismissal behaviour, and MUST NOT cause a notice to overflow its container or replace
  another notice. Presenting a subject uses the heading a notice can already carry; it introduces no
  new visual element. (The affected-panel list introduced by FR-029 is a deliberate exception, governed
  by FR-032.)

#### Group 3 — One notice per cause (#235, US3)

> **FR-030a was withdrawn.** It restated FR-037 and was folded into it during analysis. The number is
> not reused, so a reader who finds a stale reference knows where it went.

- **FR-029**: A single cause that defeats several panels MUST raise exactly one notice **per project
  affected**, naming the cause and the project once, and listing every panel of that project the cause
  affected.
- **FR-029a**: **Panel casualties group by the originating operation, always** — not by cause. The
  cause branch serves failures that have no action behind them. This is a correction made when US3
  met the real classification: `causeKey` is `kind + subject`, and a *panel's* subject is its own
  file, so six editors defeated by one missing project root classify as **six different causes** and
  would have raised six notices — the storm this feature removes, renamed. Worse, an editor's load
  failure carries a `LoadResult` reason and no errno, so 029 correctly declines to classify it at all
  and half the casualties of one root have no cause to group by. Grouping is therefore: by operation
  for anything that defeated panels, by cause otherwise, and per-panel only where there is neither.
- **FR-029c**: The operation id MUST outlive the action that minted it, until the next operation
  replaces it. FR-037's growth happens minutes later, when the user visits a tab — an id that died
  with the action could not join those panels to the notice they belong to.
- **FR-029d**: A consolidated notice MUST NOT be suppressed by cause (029 FR-019), and MUST
  **supersede** any surface-level notice already on screen sharing its cause. It says strictly more
  than the file tree's own report of the same failure, so suppression would keep the poorer message;
  without superseding, arrival order would decide whether the user sees one notice or two.
- **FR-029b**: Identifying a cause MUST NOT require widening the classified set established by feature
  029. An unclassified failure keeps its own wording exactly as today; only its grouping changes.
- **FR-030**: The affected-panel list MUST span the whole project rather than a single tab, holding
  every affected panel known so far. It MUST NOT require panels on tabs that have not been rendered to
  be discovered in advance.
- **FR-030b**: The list MUST be a report, not a control. Rows and tab headings MUST NOT be clickable or
  otherwise navigate; the actions for an affected panel live on that panel's own banner.
- **FR-031**: The list MUST be grouped by tab: each affected tab appears as a heading, with the
  affected panels of that tab listed beneath it by their panel names alone. The project is named once
  in the notice and MUST NOT be repeated per row.
- **FR-031a**: Tabs MUST appear in the workspace's own tab order, and panels within a tab in their
  position order — the list reads as a map of what is on screen, not as arrival order or an
  alphabetical index.
- **FR-031b**: Panel and tab names in the list MUST be rendered through the one formatter FR-021
  establishes, given the notice's project and the row's tab as context so those parts are elided
  (FR-022a). The list MUST NOT define a naming format of its own, and MUST NOT render raw names
  directly — which would bypass the per-part truncation and let one long panel name break the height
  bound FR-032 sets.
- **FR-032**: The list MUST be vertically scrollable within a bounded height, so that a project with
  many affected panels does not produce a notice taller than that bound.
- **FR-032a**: When a notice grows (FR-037), what is announced to assistive technology MUST be only
  what was added — the tab and how many panels joined — not a re-reading of the whole notice. A notice
  that gains a group MUST NOT cause its entire list to be announced again.
- **FR-032b**: The affected-panel list MUST be reachable and scrollable by keyboard, and any control
  the notice carries MUST be in the tab order. Reaching the list MUST NOT trap focus: a user who tabs
  into it can tab out again. **Keyboard-only, deliberately**: 018 gives the notice card
  `pointer-events: none` so a notice can never cover the controls that would fix what it reports, and
  a mouse-scrollable list would have to take pointer events back. Measured during US3 — a scrollable
  list intercepted 60 retried clicks on the panel-type dialog underneath it.
- **FR-033**: Panel type MUST NOT affect grouping — editors and terminals defeated by the same cause
  appear in the same list.
- **FR-034**: The raw system error MUST NOT be rendered in the notice — 029 FR-016 forbids it and 029
  FR-018a demotes it to Copy and the log, both of which this feature preserves. It MUST be carried on
  the notice for copying (FR-048) and written to the log (FR-006), exactly once each.
- **FR-035**: Batching by tab MUST be removed outright. The per-tab notices this replaces ("Cannot open
  N files", "Cannot open file") MUST NOT be raised at all, and no multi-panel failure — whatever
  produced it — may group by anything other than its cause. One grouping rule, not two coexisting
  ones.
- **FR-036**: Two genuinely different causes MUST still raise two notices, and two different operations
  likewise. Consolidation is by cause or by originating operation, never by time or by window.
- **FR-037**: A panel that becomes affected by an already-reported cause, or that becomes known to be
  affected when its tab is first rendered, MUST be added to that notice's list while the notice is
  still on screen, rather than raising a second notice for the same cause and project.
- **FR-037a**: Where the notice for that cause is no longer on screen — dismissed, timed out, or never
  displayed — a fresh notice MUST be raised listing the newly discovered panels. It MUST NOT repeat
  panels the earlier notice already reported.
- **FR-038**: Panel-level banners MUST be unaffected by consolidation — a panel still states its own
  condition; only the number of notices changes.

#### Group 4 — One shared failure banner (#236, US4)

- **FR-039**: Every panel type's **failure** banner MUST be rendered by one shared component — same
  layout, same tokens, same spacing, same controls in the same order — with per-type wording confined
  to the sentence that names what could not be done.
- **FR-039a**: The terminal's non-failure strips — "starting…" and the remembered-cwd fallback — are
  **not** failure banners and stay as they are. They report progress and a substitution, neither of
  which offers Retry, Cancel or a cause; folding them into a failure component would make them look
  like failures. They are out of scope, and SC-009 counts failure banners only.
- **FR-040**: The banner MUST state what could not be done in that panel type's terms, followed by a
  consistent pointer to where the detail is, and MUST NOT repeat the cause and affected-panel list the
  consolidated notice carries.
- **FR-040a**: The banner MUST keep naming the path it could not read, where it has one. This is not
  duplicated detail: 027 (#161) FR-011 makes the visible path load-bearing, because an editor holding
  a recovered buffer over a path throng could not open looks entirely ordinary, and a Ctrl+S would
  write the remembered text back over that path. Removing it to "delegate detail to the notice" would
  regress that feature.
- **FR-041**: FR-005a is the rule that the banner is never hidden by the notification preferences;
  what this requirement adds is the consequence for its wording. The pointer MUST NOT promise a notice
  that may not exist: where the relevant severity is set to Never display, or the notice has already
  gone, the banner MUST still lead the user to the detail through its own copy control (FR-051) and
  the diagnostic log.
- **FR-042**: Every banner MUST offer Retry and Cancel, in that order, with the same icons, titles and
  accessible names in every panel type.
- **FR-042a**: Every banner control — Retry, Cancel and the copy control of FR-051 — MUST be reachable
  and operable by keyboard, in the order they are displayed.
- **FR-042b**: Every banner control MUST be a themeable icon with a hover title, resolved through the
  theme's icon tokens rather than a literal glyph — the constitution's non-negotiable rule for action
  controls, restated by 029 FR-004b. The tokens are the ones the theme already ships: `retry`, `copy`
  and `dismiss`.
- **FR-042c**: Every command the banner offers — Retry, Copy **and** Cancel — MUST also appear in the
  panel's own menu, for every panel type that shows the banner. A discrete command acting on a Panel
  that exists only as a banner button is unreachable from the place users look for panel commands; 029
  FR-004d set this precedent for the terminal's Clear panel type, and each of the three is new work in
  at least one panel type, which binds it immediately.
- **FR-042d**: The labels MUST be the ones 029 already ships — **Try again** and **Clear panel type**
  — in every panel type, plus **Copy details**. This is what makes FR-042's "same titles and
  accessible names everywhere" true without regressing 029 FR-004a/FR-004d or churning the five test
  ids that depend on them. "Clear panel type" is accurate for the editor too: returning a panel to its
  panel-type selection screen *is* clearing its type, which is why
  `packages/core/src/editor/panel-type.ts` records that `clearPanelType` is simply not wired for
  editors yet. Where this spec says "Cancel" it names the concept; the label is *Clear panel type*.
- **FR-043**: ✕ Cancel on an editor MUST return the panel to the panel-type selection screen, keeping
  the panel, its position in the layout and its title. It MUST NOT delete the panel.
- **FR-044**: ✕ Cancel on a terminal MUST behave as Clear panel type does today, with no regression to
  029 FR-004a.
- **FR-045**: ↻ Retry MUST re-attempt the operation that failed. On success the banner MUST disappear
  with the condition; on failure it MUST remain and say that the retry failed.
- **FR-046**: The banner MUST NOT be dismissible while its condition holds, and MUST disappear when the
  condition clears, whether or not the panel is visible at the time.
- **FR-047**: The banner MUST render legibly in every shipped theme, taking its colours from the
  active theme rather than carrying any of its own.

#### Group 5 — Copy the whole of any error (#238, US5)

- **FR-048**: Copying a notice MUST place every rendered part of it on the clipboard — heading,
  message, affected-panel list, and raw system detail — in reading order.
- **FR-048a**: Where affected panels carry their own raw errors — two different unclassified failures
  in one operation — each panel's error MUST reach the clipboard with its row. It is never rendered
  (FR-034); copy is where it becomes reachable.
- **FR-049**: A notice's copy text MUST be derived from what the notice renders, so that a rendered
  part added later is included without anyone remembering to mirror it. A check MUST compare copied
  text against rendered content so that omission fails rather than passes silently.
- **FR-050**: The copied affected-panel list MUST carry every panel the notice currently holds, with its
  tab groups, in displayed order — regardless of how far the list is scrolled. "Every panel it holds"
  is what is known at the moment of copying (FR-030); a copy taken before the user visits Tab 3 does
  not contain Tab 3.
- **FR-051**: The shared failure banner MUST carry a copy control alongside Retry and Cancel, added
  once to the shared component rather than per panel type, and resolved through the theme's `copy`
  icon token per FR-042b.
- **FR-052**: Copying from a banner MUST yield the banner's message, its subject in the form of FR-022,
  the path involved, and the underlying system error.
- **FR-053**: Banner copy MUST work with no notice on screen — dismissed, timed out, or never
  displayed.
- **FR-054**: Copied text MUST reach the clipboard verbatim, so that pasting it into an editor panel
  reproduces it unchanged.
- **FR-055**: A failure to copy MUST itself be reported through the notice model rather than failing
  silently.

#### Group 6 — Keeping it true (#195 remainder, US6)

- **FR-056**: The work MUST produce an inventory of every user-facing notice and banner string,
  recording for each whether it names its subject and — where it does not — that the subject was
  unavailable.
- **FR-057**: The project MUST enforce FR-019 automatically, so that a notice which neither names a
  subject nor declares that none is available cannot be added.
- **FR-058**: The project MUST additionally fail a check when a notice's text uses a generic stand-in
  for its subject — "this item", "the item", "this file" and the like.
- **FR-059**: Documentation stating that severity alone governs persistence — or that a particular
  severity always auto-dismisses — MUST be updated to describe the configurable behaviour, so that no
  stated description of the product contradicts it.

### Key Entities

- **Notice**: The transient report of an event — the toast — carrying a severity, a subject, a message,
  an optional affected-panel list and optional supporting detail. Whether it is shown, and for how
  long, is decided by its severity's preference at the moment it is raised. It is the only surface the
  notification preferences govern.
- **Severity**: One of exactly four values — error, warning, info, success. The set is unchanged by
  this feature.
- **Display mode**: One of exactly three values — Never display, Display for, Dismiss only. Held per
  severity.
- **Notification preference**: Per severity, a display mode and a timeout in milliseconds (1500–60000).
  Part of the user's application settings, editable in Preferences, and tolerant of older or damaged
  files.
- **Notice subject**: The concrete thing a notice is about — a file, folder, pane, tab, panel, panel
  type, project, sub-workspace or terminal flavour — identified by the name the interface displays for
  it. The set is closed: every one of those kinds is expressible, Pane included, and there is no
  free-text kind. A stated part of every notice, or an explicit "none available". A panel subject is written
  `Project — Tab — Panel`.
- **Cause**: What went wrong once, however many panels it defeated. The unit a notice reports where
  the failure was classified.
- **Originating operation**: The single action a failure arose from — opening a project, restoring a
  tab, deleting a selection. The grouping key when no cause was identified.
- **Affected-panel list**: The panels of one project that a single cause defeated, grouped under their
  tabs in tab order, each row carrying the panel name alone. Spans the whole project, bounded in height
  and scrollable.
- **Failure banner**: The in-panel statement that this panel could not open its thing, carrying a
  short message, a pointer to the detail, and the controls Retry, Cancel and Copy. One component, every
  panel type. It is not a notice: it persists while its condition holds and the notification
  preferences do not reach it.
- **Copy text**: The plain-text rendering of a notice or banner, derived from what is displayed, placed
  on the clipboard verbatim.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can set any of the four notice severities to never appear, to appear for a chosen
  duration, or to stay until dismissed, and see the change take effect on the next notice — without
  editing a file by hand and without restarting.
- **SC-002**: 100% of notices raised by the application are governed by the notification preferences —
  none has display behaviour the user cannot change. **Read this narrowly, because it is narrow**: a
  "notice" is the toast, and the surfaces a user would most want to control — the panel failure
  banners — are exempt *by requirement* (FR-005a, and SC-004a positively requires the exemption). The
  audit behind FR-017 found no second reporting channel at all — no `showMessageBox`, no Electron
  `Notification`, no tray, no badge — which is what makes this true by construction rather than by
  enumeration. It does **not** mean "the user controls how failures appear".
- **SC-003**: Every notice **raised** appears in the diagnostic log exactly once, whatever its display
  mode — an event set to Never display appears zero times on screen and exactly as often in the log as
  the same event does when displayed, repeats included (FR-005b). A notice that grows adds one further
  record per growth (FR-006a); those are additional to the raise, not duplicates of it.
- **SC-004**: No user silences errors or warnings without being told, at that moment, that those
  events will thereafter reach only the log.
- **SC-004a**: With every severity set to Never display, a user can still see that a panel failed and
  copy the full detail from it — silencing removes the toasts and nothing else.
- **SC-005**: On a fresh installation, a notice reporting something the user did not ask for (a
  warning) waits to be acknowledged, and an informational notice stays twice as long as it does today.
- **SC-006**: A reader who sees a notice without having watched the action that caused it can identify
  which file, panel, tab, pane or project it refers to from the notice alone.
- **SC-007**: Any two notices about the same kind of subject name it identically, so a user reading one
  notice learns how every other notice will refer to that kind of thing.
- **SC-008**: Opening a project whose root folder is missing produces exactly one notice, down from
  three plus one per affected panel — and that notice names every affected panel, grouped under the
  tab it sits in, in the order the workspace shows them.
- **SC-009**: The number of distinct **failure**-banner designs in the application is one, down from
  two, and adding a new panel type adds none. The terminal's progress and cwd-fallback strips are not
  failure banners and are not counted (FR-039a).
- **SC-009a**: Everything a mouse user can do with a failure — read the list, scroll it, retry, cancel,
  copy — a keyboard user can do too, and a screen-reader user learns that a failure has spread without
  having the whole list read to them again.
- **SC-010**: A user can return a failed editor panel to panel-type selection without losing the panel,
  its position or its title — something not possible today.
- **SC-011**: Everything a user can see about a failure can be put on the clipboard in one action, from
  either the notice or the panel, and pastes unchanged.
- **SC-012**: Every user-facing notice and banner string is accounted for in the inventory, and 100% of
  those with an available subject name it.
- **SC-013**: Attempting to add a notice that states no subject at all, or that refers to its subject
  with a generic stand-in, is rejected by the project's own checks before it can be merged.
- **SC-014**: A settings file from any earlier version opens without error and without the user losing
  any preference they had already set.

## Assumptions

- The four severities are the complete set; no `fatal` or other new severity is introduced.
- The three display modes are the complete set; there is no fifth state such as "show only when the
  window is focused" or "show in the status bar instead".
- Preferences are per severity only. There are no per-notice or per-call-site overrides.
- No notice history or "show me what I missed" surface is part of this feature. Persistence is the only
  in-app mechanism by which a missed notice is recovered; the diagnostic log is the record for anything
  that was never displayed.
- Timeout is expressed in milliseconds, matching the value the application already uses and the way its
  other duration settings are already presented — a bounded number field, not a slider or a list of
  presets.
- The diagnostic log the application already writes is the destination for FR-006; this feature does
  not introduce a second log or a new log location. Its level threshold is the one thing this feature
  overrides (FR-006b), because a threshold that silently dropped notice records would falsify the
  guarantee FR-008 asks the user to accept.
- Notification preferences are application-wide, shared by the main window and any sub-workspace
  windows, rather than per project or per window.
- Preferences already renders settings categories generically, so the **Notifications** category needs
  no bespoke *surface* — but it does need two new capabilities in that generic renderer: a control
  disabled by a sibling's value (FR-011) and a confirmation before a value is committed (FR-008).
  Verified: the settings metadata has no `enabledWhen`/`dependsOn` today, and `settings-tab.tsx`
  carries only a single bespoke case (`terminals.disabledBuiltins`).
- The subject sweep adjusts wording, carries an already-known subject through to the place the notice
  is raised, and changes the shape of a notice so the subject is stated rather than implied. Every
  place that raises a notice today is therefore touched.
- Consolidation is by cause where one exists, reusing the classification 029 already established for
  cause suppression rather than introducing a second notion of sameness — and by the originating
  operation where it does not. 029's classified set is closed by design and stays closed.
- "The originating operation" means the single user- or system-initiated action a failure arose from —
  opening a project, restoring a tab, deleting a selection. It is known at the point of failure without
  classifying anything.
- The bound on the affected-panel list's height is a presentation decision to be settled during
  planning; the requirement is that a bound exists and the list scrolls within it.
- "Retry" means re-attempting the same operation with the same inputs, not re-deriving what the panel
  should have been.
- Existing behaviour this feature must not regress: notice routing to the correct window, severity
  colours, notice stacking (no replacement), cause suppression as specified by feature 029, and the
  terminal's Clear panel type behaviour from 029 FR-004a.

## Dependencies

- Feature 029 (failure-path integrity) is complete and defines cause suppression, raw-detail demotion
  and the terminal's start-failure controls; this feature must not alter any of them.
- The existing settings model, its tolerant parsing of older configuration files, and the generic
  rendering of settings categories in Preferences.
- The existing durable diagnostic log, which FR-006 depends on as the record for undisplayed events.
- The existing verbatim clipboard behaviour used by notice copy today.
- Issue #197 (re-entering a project after a folder rename errors on the folder's old path) describes
  the condition that produces the notice storm US3 consolidates. It is not a prerequisite — US3 must
  work whatever produced the cause — but it is the most convenient way to reproduce it.

## Out of Scope

- A new `fatal` severity, or any change to the set of four.
- Per-notice or per-call-site persistence overrides.
- A notice history, notification centre, or replay of dismissed notices.
- A clickable or navigable affected-panel list — it reports, and the panel's banner acts.
- An affected-panel list on a notice that is not about particular panels — a stopped daemon reports
  itself, not an inventory of everything it broke. No cross-project list exists.
- Eagerly rendering or scanning unvisited tabs so a notice can list panels before they are known.
- A "copy all notices" or notification-history export.
- Rich or HTML clipboard formats.
- Re-timing or retracting notices already on screen when a preference changes.
- A persistent indicator anywhere in the interface that a severity is currently silenced.
- Any in-app viewer for the diagnostic log.
- Changes to notice stacking, cause suppression, the severity colours or the toast layout beyond the
  affected-panel list FR-032 introduces.
- Reclassifying which severity an existing notice uses, beyond confirming every notice has one.
- Terminals reconnecting by themselves when their path comes back (#237) — related, separately tracked.
- Operating-system-level or background notifications.
