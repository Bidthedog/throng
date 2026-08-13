# Feature Specification: Tab strip overflow, name limits, and bounded configuration

**Feature Branch**: `feature/S031-I225-I226-I227-tab-strip-and-config-bounds`

**Created**: 2026-08-11

**Status**: Draft

**Input**: User description: "Let's implement #225, #226 and any other related issues you find in a new spec."

**Issues**: [#225](https://github.com/Bidthedog/throng/issues/225) (tab strip overflow), [#226](https://github.com/Bidthedog/throng/issues/226) (tab and panel name limits), [#227](https://github.com/Bidthedog/throng/issues/227) (clamp every bounded config value on read)

## Why these three together

The user named #225 and #226. #227 is the third because both of the others depend on it and say
so in their own text: #225 adds a smooth-scroll duration bounded 0–3000, #226 adds a name limit
bounded 10–128, and each states that its bound must hold against a hand-edited configuration file,
not only against the Settings form. Today there is no general guard — fifteen settings declare a
range and two of them are clamped by hand, one of those to the wrong range. Shipping #225 and #226
without #227 would add two more unguarded bounds and two more places for a range to be written
twice and drift.

#219 (Quick Open) is adjacent — its file picker and this feature's all-tabs list are both "list a
set of targets, filter, pick one, go there". They share one picker, and **this** feature builds it:
a filtering typeahead list seeded with tabs. #219 later seeds the same picker with files. The
dependency therefore runs from #219 to this feature and not the other way round — nothing here
waits on Quick Open, and #219 inherits a picker rather than inventing a second one. Opening a
project's files is not in this feature's scope.

---

## Clarifications

### Session 2026-08-11

- Q: Does the strip scroll to the active tab only on creation, or whenever the active tab changes? → A: Whenever the active tab changes, by any route — creation, click, chord, picker, dwell-activate, layout restore. FR-029 is one case of it.
- Q: What counts as a match when typing into the picker? → A: Split the query on whitespace into terms; an entry matches when **every** term appears as a case-insensitive substring somewhere in its text, **in any order**. "find file" matches "file find.txt", "find any file.md" and "prefix file any find.pdf".
- Q: Is the tab picker reachable by keyboard, and if so on which chord? → A: Yes — one new command that opens the tab picker, bound to `Ctrl+Alt+T` and rebindable. Stepping left/right stays mouse-only.
- Q: Does the read-side clamp cover bounds declared inside keyed tables (e.g. `editor.indentByLanguage`'s `indentWidth`, 1–16), or only top-level leaves? → A: Every declared bound, wherever it is declared — leaves and table columns alike. And it MUST be **one generic guard used across the application**, not a settings-only mechanism reimplemented per site.
- Q: What is the shipped default for the smooth-scroll duration? → A: **300 ms** (revised down from 500 when the supersede rule below was settled), and the scroll MUST be **eased in and out** — accelerating from rest and decelerating to a stop, never a constant-speed slide.
- Q: Is a tab's close affordance always visible, or revealed on hover? → A: Visible on the **active** tab always and on any tab **under the pointer**, with its space reserved on every tab so nothing reflows. A hover-revealed X MUST additionally be **inert for a short arming delay** (default 300 ms, configurable under Tabs) so that sweeping the pointer across the strip cannot close a tab by accident.
- Q: A malformed entry in a keyed table is dropped — but what about a table declared to have no valid empty state, like `editor.indentByLanguage`? → A: **Per-entry restore.** A dropped entry is replaced by the shipped default **for that key** where one exists; an entry for a key with no shipped default is simply dropped. Other entries are untouched, so every shipped key always has an entry and the empty state cannot arise.
- Q: When does the corrected configuration get written back — once at startup, or on every read? → A: **Correct on every read, in every process; write back from exactly one process** — the one that already owns settings writes. A correction found on a reload is written back too, not only one found at startup. Every other reader corrects in memory and never writes.
- Q: What exactly is a shortened name — does it carry an ellipsis? → A: **A hard cut to exactly the limit.** The stored value never contains an ellipsis; the ellipsis is drawn at render time only. Truncation is therefore idempotent, and successive limit reductions cannot accumulate ellipses in the data.
- Q: Does anything acknowledge a keystroke the rename field refuses at the limit? → A: **A character counter appears in the rename field as the name nears the limit** (the last 10 characters), showing used against total and reading as at-limit when full. Nothing is shown otherwise, and a refused keystroke is not an error state.
- Q: Does the animated scroll honour the operating system's "reduce motion" preference? → A: **Yes — it forces instant scrolling**, exactly as a duration of 0 does, whatever the configured duration says. The setting is unchanged; it simply has no effect while the preference is on. This matches the three places throng already honours the preference.
- Q: What happens when a scroll begins while another is still running? → A: **The new one supersedes the old.** It starts from wherever the strip currently is and eases to the new target over the full duration. Scrolls never queue, and the strip settles once at the most recent target.
- Q: `/speckit-analyze` found that **three more** settings parse a wider range than they declare — and one documents the gap as deliberate (`diagnostics.maxFileSizeKb` declares 64–4096 "so the slider stays aimable" while stating "a larger cap is still settable by hand — the parser accepts up to 64 MB"). Does the declaration simply win everywhere? → A: **No, not blindly.** A declared `min`/`max` remains the **hard bound** and the guard's universal contract, so `terminals.linkHoverDelayMs`, `diagnostics.keepFiles` and `search.asYouTypeDebounceMs` — none of which justify their wider parse — resolve to their declaration. Where a wider hard bound is genuinely intended, the descriptor MUST say so **explicitly** with `hardMin`/`hardMax`, rather than leaving it in a comment the guard cannot read. `diagnostics.maxFileSizeKb` takes `hardMax: 65536`, preserving a shipped capability that FR-008 would otherwise have silently revoked — a user's deliberate 64 MB log cap would have been rewritten to 4 MB on next start.
- Q: A hard cut can leave a trailing space, which is invisible and makes two names look identical. What happens? → A: **Trim trailing whitespace after the cut.** The limit governs the name's length, not its final character, and a name ending in an invisible space is a name the user cannot distinguish or retype.
- Q: What counts as one "character" for the limit? → A: **Grapheme clusters** — what the user perceives as one character. Truncation MUST cut only on a cluster boundary, so a name never ends in a broken encoding: no split surrogate pair, no emoji cut in half, no combining accent separated from the letter it belongs to. Whatever the cut produces must render as whole characters. (This does **not** change FR-040 — the stored value is still replaced at the next ordinary layout save.)

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The tab strip stops mangling its own tabs (Priority: P1)

A user with more than a handful of tabs — or a few tabs with long names — finds that the strip
sprouts a horizontal scrollbar *inside* itself. The scrollbar takes vertical space from the tabs,
which shift up and are clipped. The "+" button drifts off with the tabs instead of staying put.

After this story, a strip that overflows looks exactly like one that does not: same tab height,
same vertical position, no scrollbar. Overflow is signalled by a soft fade over the edge of the
outermost visible tab, and the "+" button is pinned to the right-hand edge where the user left it.

**Why this priority**: This is the defect the user actually hits, it is reachable with a handful of
tabs, and it makes the strip unusable rather than merely inconvenient. It needs no new settings, so
it can ship on its own ahead of everything else here.

**Independent Test**: Open a project, create tabs with long names until the strip overflows, and
compare a tab's height and vertical position against the same tab before overflow. Confirm no
scrollbar occupies the strip and the "+" button has not moved.

**Acceptance Scenarios**:

1. **Given** a project whose tabs fit the strip, **When** enough tabs are added that they no longer
   fit, **Then** no horizontal scrollbar appears in the strip and every tab keeps the height and
   vertical position it had before.
2. **Given** an overflowing strip, **When** the user looks at the right-hand edge of the tab pane,
   **Then** the "+" button is visible, vertically centred, and square.
3. **Given** an overflowing strip scrolled so tabs are hidden on both sides, **When** the user
   looks at the outermost visible tabs, **Then** a fade appears over the leading edge of the
   left-most tab and the trailing edge of the right-most tab.
4. **Given** a strip showing a fade, **When** the left offset of each tab is compared with the same
   strip rendered without a fade, **Then** every offset is identical — the fade never displaces a
   tab.
5. **Given** an overflowing strip, **When** the user drags a tab to reorder it, **Then** reordering
   still works and the insertion indicator lands on the boundary under the pointer.

---

### User Story 2 - A hand-edited setting can no longer break the app (Priority: P2)

Settings are a plain file the user can edit. Every bounded setting already declares its range in
one place, but that range is enforced only by the Settings form. A value typed straight into the
file is read back verbatim, so a pane can be told to be wider than the window, a poll interval can
be set to peg a core, and a diagnostics cap can be set so high it defeats the rotation it exists to
drive.

After this story every declared range is enforced on read, from that one declaration, and the
corrected value is written back so the file agrees with what the app is using.

**Why this priority**: It is invisible until it bites, but Stories 3 and 4 each add a new bounded
setting and both require this guard to exist. Doing it second means those two inherit it rather
than each hand-rolling a clamp.

**Independent Test**: Write out-of-range values into the configuration file for several bounded
settings, start the application, and confirm each loads at its nearest bound and that the file has
been rewritten to match.

**Acceptance Scenarios**:

1. **Given** a bounded setting declared 200–1200, **When** the configuration file contains 50,
   **Then** the application uses 200.
2. **Given** the same setting, **When** the configuration file contains 5000, **Then** the
   application uses 1200.
3. **Given** any value was corrected on load, **When** the user next opens the configuration file,
   **Then** it contains the corrected value.
4. **Given** a configuration file every one of whose values is already in range, **When** the
   application loads, **Then** the file is left untouched.
5. **Given** a setting that accepts one of a fixed set of choices, **When** the file contains a
   value outside that set, **Then** the shipped default is used and written back.
6. **Given** a bounded setting, **When** the file contains text, `null`, or nothing at all where a
   number belongs, **Then** the shipped default is used and the application starts normally.
7. **Given** the terminal link-hover delay, whose declared range is 0–2000, **When** the file
   contains 4000, **Then** the application uses 2000 — the declared range, not the larger range a
   hand-written guard used to apply.
8. **Given** a new bounded setting is added to the declared set, **When** an out-of-range value for
   it is put in the file, **Then** it is clamped with no guarding code written for it specifically.
9. **Given** the per-language indentation table, whose width columns are declared 1–16, **When** the
   file contains an entry with a width of 500, **Then** that entry loads with a width of 16.
10. **Given** the same table, **When** one entry is malformed beyond correcting, **Then** that entry
    is dropped and every other entry loads normally — the table is not discarded.
10a. **Given** a malformed entry for a language the shipped defaults carry, **When** the file loads,
     **Then** that language's shipped default entry is used, and the user's other entries — including
     ones they customised — are unchanged.
10b. **Given** a malformed entry for a language the shipped defaults do **not** carry, **When** the
     file loads, **Then** the entry is dropped and nothing is invented in its place.
10c. **Given** every entry in the per-language indentation table is malformed, **When** the file
     loads, **Then** the table holds exactly the shipped defaults — never nothing.
11. **Given** the guard, **When** a second part of the application needs to enforce a declared
    bound, **Then** it uses the same mechanism rather than a copy of it.
12. **Given** the application is running, **When** the user hand-edits a value out of range in the
    file, **Then** the reload takes effect corrected, and the file is written back with the
    corrected value.
13. **Given** a correction is written back, **When** that write causes the file to be re-read,
    **Then** nothing further is corrected and nothing further is written — the sequence settles
    after one write.
14. **Given** the user saves settings from the Settings editor while a correction is pending,
    **When** both complete, **Then** the file contains the user's save with the correction applied
    to it — neither write is lost and neither is interleaved with the other.

---

### User Story 3 - Reaching a tab you cannot see (Priority: P3)

With the strip overflowing, there is no way to step through the tabs that are out of view and no
way to list them. The user has to guess, or resize the window.

After this story, an overflowing strip grows a small group of controls at its right-hand end, just
left of "+": step left, step right, and show all. Each carries a live count — how many tabs are
hidden to the left, how many to the right, and how many there are in total — so the user can see
what is out of view without hunting for it. And the strip follows the active tab: whenever the
active tab changes — created, clicked, chosen from the list, reached by a chord — it is brought
into view, so the tab the user is working in is never the one they cannot see.

**Why this priority**: It turns a legible strip (Story 1) into a navigable one. It introduces the
first new setting, so it follows Story 2.

**Independent Test**: With more tabs than fit, use the step controls to walk the strip end to end,
then use the show-all list to jump straight to a tab at the far end; confirm the counts track the
strip at every point.

**Acceptance Scenarios**:

1. **Given** tabs that all fit the strip, **When** the user looks at the tab pane, **Then** no
   tab-action controls are shown.
2. **Given** tabs that overflow, **When** the user looks at the tab pane, **Then** the tab-action
   controls appear inside the pane, between the tabs and the "+" button.
3. **Given** a strip with 3 tabs hidden left, 1 hidden right and 6 in total, **When** the user
   reads the controls, **Then** they show 3, 1 and 6 respectively.
4. **Given** those counts, **When** the strip is scrolled, a tab is created or destroyed, tabs are
   reordered, or the window is resized, **Then** the counts update to match.
5. **Given** an overflowing strip, **When** the user activates step-right, **Then** the strip moves
   by exactly one tab.
6. **Given** a step in either direction has settled, **When** the user looks at the newly revealed
   tab, **Then** it is flush with the left edge of the tab pane.
7. **Given** the show-all control, **When** the user opens it, **Then** every tab in the project is
   listed in strip order, whether visible or not, each showing its name and panel count, with the
   active tab marked.
8. **Given** the show-all list is open, **When** the user types, **Then** the list narrows to tabs
   matching what was typed; the arrow keys move through what remains, Enter chooses, Escape
   dismisses.
8a. **Given** tabs named `file find`, `find any file` and `prefix file any find`, **When** the user
    types `find file`, **Then** all three match — every term is found, in any order.
8b. **Given** those same tabs, **When** the user types `FIND FILE`, **Then** the same three match —
    matching is case-insensitive.
8c. **Given** a matching row, **When** the user reads it, **Then** the matched terms are visibly
    marked within the name.
8d. **Given** several matches, **When** the user reads the list, **Then** they appear in strip
    order, not in a relevance order.
8e. **Given** the picker is open, **When** the user types text no tab matches, **Then** the picker
    stays open and says nothing matched.
9. **Given** the show-all list is open, **When** the user chooses a tab, **Then** the strip scrolls
   until that tab is visible and that tab becomes the active tab.
10. **Given** a smooth-scroll duration is configured, **When** a new tab is created, **Then** the
    strip scrolls to it over that duration.
10a. **Given** an out-of-view tab, **When** it becomes active by any route — clicked in the picker,
     activated by a keyboard chord, dwell-activated during a panel drag, or made active by a
     restored layout — **Then** the strip brings it into view.
10b. **Given** an active tab that is already fully visible, **When** it becomes active again or the
     strip re-evaluates, **Then** the strip does not move.
10c. **Given** the active tab is destroyed and a neighbour becomes active, **When** the strip
     settles, **Then** the newly active tab is in view and no gap is left where the destroyed tab
     was.
11. **Given** the smooth-scroll duration is 0, **When** any scroll occurs, **Then** the strip jumps
    with no animation and no easing.
11a. **Given** the shipped default, **When** the user first opens Settings, **Then** the smooth-scroll
     duration reads 300 ms.
11b. **Given** any non-zero duration, **When** the strip scrolls, **Then** the movement accelerates
     from rest and decelerates to a stop rather than travelling at a constant speed.
11c. **Given** a scroll in flight, **When** the user presses step-right again, **Then** the strip
     continues from where it currently is to a target one further on, and settles once.
11d. **Given** several step presses in rapid succession, **When** the user stops pressing, **Then**
     the strip settles at the last target and stops moving — it does not carry on working through a
     queue.
11e. **Given** a scroll toward a tab, **When** that tab is destroyed before the scroll settles,
     **Then** the strip settles at a valid position rather than at a gap or past the end.
11f. **Given** the OS reduce-motion preference is on and a duration of 300 ms is configured, **When**
     the strip scrolls, **Then** it moves instantly, and the configured 300 ms is still what the
     Settings editor shows.
11g. **Given** reduce-motion is turned on while a scroll is in flight, **When** it takes effect,
     **Then** the scroll settles immediately at its target rather than continuing to animate.
11h. **Given** reduce-motion is then turned off, **When** the strip next scrolls, **Then** it
     animates over the configured duration again — the setting was never overwritten.
12. **Given** the Settings editor, **When** the user opens it, **Then** a Tabs section exposes the
    smooth-scroll duration with a range of 0–3000 ms.
13. **Given** any tab count, including one where the tabs all fit, **When** the user presses
    `Ctrl+Alt+T`, **Then** the tab picker opens, behaving exactly as it does when opened by
    clicking the show-all control.
14. **Given** the picker was opened by chord from an editor or a terminal, **When** the user
    dismisses it with Escape, **Then** keyboard focus returns to where it was.
15. **Given** the Key Bindings editor, **When** the user opens it, **Then** the open-tab-picker
    command is listed and can be rebound.

---

### User Story 4 - Names that cannot run away (Priority: P4)

Tab and panel names are unbounded. A pasted path, a long branch name, or a stray paste into a
rename field produces a name that overruns the strip, dominates every menu that lists tabs or
panels, and bloats the saved layout.

After this story both are capped by one setting, defaulting to 64 characters and adjustable between
10 and 128. The rename field simply stops accepting characters at the cap, and a name arriving from
anywhere else — a saved layout, a drag into a new tab, a name derived from a file or a running
command — is brought within the cap when it is read.

**Why this priority**: It is the root cause that makes the strip overflow in the first place, but
the strip is already legible and navigable by this point, so it is a containment measure rather
than a fix. It needs Story 2's guard for its own 10–128 bound.

**Independent Test**: Set the limit, attempt to rename a tab and a panel beyond it, then load a
saved layout containing an over-long name and confirm it opens with the name brought within the
cap.

**Acceptance Scenarios**:

1. **Given** the default limit of 64, **When** the user types into a tab's rename field, **Then**
   input stops being accepted at 64 characters.
1a. **Given** a rename field holding fewer than 54 characters at the default limit, **When** the user
    looks at it, **Then** no character counter is shown.
1b. **Given** the name reaches 54 characters, **When** the user keeps typing, **Then** a counter
    appears showing how many of the 64 are used, and updates as they type.
1c. **Given** the name reaches 64, **When** the user presses another key, **Then** nothing is added,
    the counter reads as at-limit, and no error styling or notice appears.
1d. **Given** a rename field open near the limit, **When** the limit is lowered in Settings, **Then**
    the counter immediately shows the new total.
2. **Given** the same limit, **When** the user renames a panel, **Then** it behaves identically —
   one setting governs both.
3. **Given** a rename field at or near the limit, **When** the user pastes text longer than the
   remaining room, **Then** as much as fits is inserted rather than the paste being refused
   outright, and the counter reads as at-limit so the user can see the paste was cut short.
4. **Given** a saved layout containing a 300-character tab name, **When** the project is opened,
   **Then** it opens successfully with the name brought within the current limit.
4a. **Given** a limit of 64 and a 300-character name, **When** it is read, **Then** the value is
    the first 64 characters, with no ellipsis in it.
4b. **Given** that truncated name, **When** it is read again at the same limit, **Then** it is
    unchanged — truncating twice is the same as truncating once.
4c. **Given** a name that was cut, **When** the user looks at the tab, **Then** an ellipsis shows
    that it was cut; **and** the stored value still contains no ellipsis.
4d. **Given** a name exactly at the limit that was never cut, **When** the user looks at the tab,
    **Then** no ellipsis is shown.
4e. **Given** a name whose 64th and 65th characters are halves of one emoji, **When** it is
    truncated, **Then** the cut falls before that emoji rather than through it — the result renders
    as whole characters and contains no broken encoding.
4f. **Given** a name containing a letter followed by a combining accent at the limit boundary,
    **When** it is truncated, **Then** the letter and its accent are kept together or dropped
    together, never separated.
4g. **Given** a limit of 10 and a name of ten emoji, **When** the user types into the rename field,
    **Then** all ten are accepted — the cap counts what the user sees, not what it costs to encode.
4h. **Given** a name whose cut lands immediately after a space, **When** it is truncated, **Then**
    the trailing space is trimmed, so two names that differ only past the cut cannot render
    identically.
5. **Given** a panel whose name is derived automatically from a file or a running command, **When**
   that derived name exceeds the limit, **Then** the displayed name is brought within it.
6. **Given** names longer than a newly lowered limit, **When** those names are next read, **Then**
   they come back within the new limit without an error.
7. **Given** the limit was lowered and nothing else has changed, **When** the user raises it again,
   **Then** the full original names come back — shortening a name for display does not, by itself,
   rewrite what is stored.
8. **Given** the limit was lowered and the layout has since been saved for another reason, **When**
   the user raises the limit again, **Then** the shortened names remain shortened.
9. **Given** the Settings editor, **When** the user opens it, **Then** the limit is exposed with a
   range of 10–128.
10. **Given** a configuration file containing a limit of `0`, `9`, `129` or `9999`, **When** the
    application loads, **Then** the limit is 10, 10, 128 and 128 respectively and the file is
    corrected.

---

### User Story 5 - A tab says what is inside it (Priority: P5)

A tab shows its panel count as bare square brackets — `Issues [3]` — its hover title repeats the
name and says nothing about the contents, and closing it requires a right-click into a context
menu.

After this story the count is a pill, hovering a tab lists the panels it holds, and a close
affordance running the same Destroy Tab action sits on the active tab and on whichever tab the
pointer is over — its space always reserved so the strip never reflows, and briefly inert when it
appears so a pointer sweeping the strip cannot destroy a tab on the way past.

**Why this priority**: Presentation and convenience. Every other story here fixes something broken;
this one polishes something that works.

**Independent Test**: Hover a tab holding several panels and read the listed panel names; then
close a tab from the strip and confirm the same confirmation and the same side effects as the
context menu's Destroy Tab.

**Acceptance Scenarios**:

1. **Given** a tab containing 3 panels, **When** the user looks at it, **Then** the count is shown
   as a pill and no square-bracket form appears anywhere in the strip.
2. **Given** a tab containing panels named A, B and C, **When** the user hovers it, **Then** the
   hover title gives the tab name, the panel count, and each panel's name on its own line.
3. **Given** any tab, **When** the user activates its close affordance, **Then** the existing
   Destroy Tab action runs, with the same confirmations and the same side effects as the context
   menu item.
4. **Given** a tab that is not active, **When** the user activates its close affordance, **Then**
   the tab is not activated and no rename begins.
5. **Given** the main window's last remaining tab, where Destroy Tab is unavailable, **When** the
   user looks at that tab, **Then** its close affordance is unavailable too.
6. **Given** several tabs, **When** the user looks at the strip with the pointer away from it,
   **Then** only the active tab shows a close affordance.
7. **Given** an inactive tab, **When** the pointer moves over it, **Then** its close affordance
   appears and the tab's width and label position do not change.
8. **Given** the default 300 ms arming delay, **When** the user clicks the close affordance within
   300 ms of it appearing, **Then** nothing happens — the tab is not destroyed, not activated, and
   no rename begins, and nothing fires once the delay elapses.
9. **Given** the same delay, **When** the user waits past it and then clicks, **Then** Destroy Tab
   runs normally.
10. **Given** a tab whose affordance has armed, **When** the pointer leaves and returns, **Then**
    the delay applies again from scratch.
11. **Given** the active tab's always-visible affordance, **When** the user clicks it at any time,
    **Then** it works immediately — no arming delay applies.
12. **Given** the arming delay is set to 0, **When** the affordance appears under the pointer,
    **Then** a click works immediately.
13. **Given** the Settings editor, **When** the user opens the Tabs section, **Then** the arming
    delay is exposed with a range of 0–2000 ms and a default of 300.

---

### Edge Cases

- **A single tab wider than the pane.** One tab whose name alone overruns the strip: the strip
  overflows with nothing to step to on one side. The counts must read 0 on that side and the step
  control must be inert rather than scrolling to a position that reveals nothing.
- **Overflow disappears while scrolled.** The window is widened, or tabs are destroyed, until
  everything fits while the strip is scrolled away from the start. The strip must return to the
  start, the tab-action controls must disappear, and no fade may be left showing.
- **The anchor tab is destroyed.** The tab the strip is scrolled to is closed by another route
  (Destroy other tabs, a sub-workspace teardown). The strip must settle on a valid position.
- **A scroll interrupted by another scroll.** Step pressed twice quickly, a tab created while the
  picker's scroll is still running, or the active tab changing mid-flight (FR-030c–f).
- **A scroll interrupted by a resize.** The window is resized while a scroll is in flight, changing
  both the target's position and whether the strip overflows at all.
- **Renaming changes overflow.** A rename makes a tab long enough to push the strip into overflow,
  or short enough to take it out of overflow, while the rename field is still open.
- **Reordering while scrolled.** A tab dragged from a scrolled position, including onto a boundary
  that is itself partly out of view.
- **A limit lowered mid-rename.** The Settings editor lowers the name limit while a rename field is
  open holding a longer value — below what the field already contains, so the counter reads over its
  own total until the user deletes down to it.
- **A limit of 10 and a counter that is always on.** The approach threshold is 10, so at the minimum
  limit the counter is visible from the first character. That is correct, not a bug.
- **A limit lowered below an existing name.** Every existing name longer than the new limit is
  affected at once, across every project's saved layout — for display immediately, in storage only
  at the next ordinary layout save (FR-040).
- **A name that is nothing but the truncated part.** A limit of 10 against several names sharing a
  long common prefix leaves tabs that are indistinguishable in the strip. The show-all picker's
  entries (FR-028b) are what keeps them tellable apart.
- **Matching against a truncated name.** The picker matches the name as it is (FR-028d), so a term
  that appeared only in the cut-off tail no longer finds the tab. That is the cost of the limit, not
  a defect in the picker.
- **A truncated name that ends in whitespace.** A hard cut can leave a trailing space, which is
  invisible and would make two names look identical. **Resolved by FR-037e**: trailing whitespace is
  trimmed after the cut.
- **A cut that lands inside an encoded character.** A multi-code-point emoji, a flag, a
  skin-tone-modified emoji, a letter plus combining accent, or a surrogate pair straddling the limit
  (FR-033b). The cut moves back to the cluster boundary, so the result may be one character shorter
  than the limit — which is correct, not a rounding error.
- **A name made entirely of characters that cost more than one unit to encode.** Ten emoji at a
  limit of 10 must be accepted in full.
- **Every tab filtered out.** The show-all picker is opened and the user types text no tab matches
  (FR-028g), or types a term that matches nothing *in combination* with an earlier one that matched
  plenty.
- **A query of only whitespace**, or a query the user has cleared back to empty — both are the
  unfiltered list (FR-028c).
- **Configuration that cannot be written back.** The file is read-only or the write fails. The
  application must still start, and keep running, on the corrected values rather than refusing to
  load — and must not retry the write in a loop.
- **A correction and a user save arriving together.** The Settings editor saves while a reload has
  just found something to correct (FR-013c).
- **A non-writing process reads first.** A reader that is not the write owner sees an out-of-range
  file and corrects it in memory; the file is not touched until the owner reads it too.
- **A bounded value of the wrong type.** `"300"` as text where a number belongs, an array, an
  object, `null`, or the key missing entirely.
- **A bound whose declared range is itself degenerate** (minimum equal to maximum).
- **A keyed table where every entry is malformed.** Per-entry restore (FR-008c) rebuilds it from the
  shipped defaults rather than leaving it empty, which is what `editor.indentByLanguage`'s
  "no valid empty state" requires.
- **A user's own table entry that is malformed.** No shipped default exists to restore it from, so
  it goes — and the user sees it gone in the written-back file rather than silently ignored.
- **A clearable table the user deliberately emptied.** Empty is a legitimate value there
  (`editor.languageByExtension` ships empty), so per-entry restore MUST NOT repopulate it.
- **Sub-workspace windows.** They render the same tab strip; every behaviour here applies there
  too.

---

## Requirements *(mandatory)*

### Functional Requirements — tab strip layout (US1)

- **FR-001**: The tab strip MUST NOT render a native horizontal scrollbar at any tab count.
- **FR-002**: A tab's height and vertical position MUST be identical whether or not the tabs
  overflow the strip.
- **FR-003**: The New Tab control MUST remain visible at every tab count, pinned to the right-hand
  edge of the tab pane, vertically centred, and square (equal width and height).
- **FR-004**: When tabs are fully hidden to the left, a fade MUST be shown over the leading edge of
  the left-most visible tab; when tabs are fully hidden to the right, over the trailing edge of the
  right-most visible tab.
- **FR-005**: A fade MUST be an overlay only: every tab's horizontal offset MUST be identical with
  and without it. Nothing may be inserted into the strip that displaces tabs when others are hidden.
- **FR-006**: The strip's scroll position is view state and MUST NOT be written into the persisted
  layout.
- **FR-007**: Tab reordering by drag MUST continue to work from a scrolled position, with the
  insertion indicator landing on the boundary under the pointer.

### Functional Requirements — bounded configuration (US2)

- **FR-008**: On load, every value that declares a minimum and a maximum MUST be clamped to that
  range: a value below the minimum becomes the minimum, a value above the maximum becomes the
  maximum.
- **FR-008a**: This MUST apply **wherever a bound is declared**, not only to top-level leaves. A
  keyed table or record list whose *columns* declare bounds — `editor.indentByLanguage` declares
  `indentWidth` and `tabWidth` as 1–16 — MUST have every entry's column value clamped to the
  column's declared range. A declaration means the same thing whatever depth it sits at.
- **FR-008b**: Within such a table, a **single malformed entry MUST NOT invalidate the table**. An
  entry whose value can be corrected is corrected; one that cannot be (a missing key, an
  unrecognisable shape) is dropped, and the remaining entries load normally.
- **FR-008c**: **A dropped entry is restored from the shipped default for its own key**, where the
  shipped defaults contain that key. An entry for a key the shipped defaults do not carry — a
  mapping the user added themselves — is simply dropped. Entries that loaded correctly MUST be left
  exactly as the user set them; correcting one entry MUST NOT revert another.
- **FR-008d**: This is what makes a table declared to have **no valid empty state** safe. Every key
  the shipped defaults carry always ends up with an entry, so the empty state cannot be reached by
  correction, and no special case is needed for the moment a table happens to reach zero entries.
  (`editor.indentByLanguage` is the live instance: its descriptor states there is no valid empty
  state, because emptying it would silently indent Go with spaces and Python with two.)
- **FR-008e**: Any entry that was corrected, dropped or restored counts as a change for the purposes
  of the write-back rule (FR-013), so the file ends up stating what is actually in use.
- **FR-008f**: Restoration applies only to an entry that was **present and malformed**, never to one
  that is simply **absent**. A table the user deliberately emptied MUST stay empty where empty is a
  legitimate value for it — `editor.languageByExtension` ships empty and is marked clearable, and
  repopulating it would undo the user's explicit choice. Absence is an answer; malformation is not.
- **FR-009**: The guard MUST be **one generic mechanism used across the application**, driven by the
  declared range, not a settings-only routine and not a rule reimplemented at each site that reads a
  bounded value. No second copy of any range may exist anywhere.
- **FR-009a**: That mechanism MUST be usable by any future consumer of a declared bound without
  being rewritten or forked. Applying it beyond the settings file — to layout or workspace files —
  is out of scope here (per #227), but the guard MUST NOT be shaped so that doing so later requires
  a second implementation.
- **FR-010**: A newly added bounded value MUST be guarded automatically, with no clamping code
  written for it specifically — whether it is a new leaf or a new bounded column on an existing
  table.
- **FR-011**: A bounded leaf whose value is absent, of the wrong type, or not a finite number MUST
  fall back to its shipped default rather than throwing or being used as-is.
- **FR-012**: A leaf whose value lies outside its declared set of allowed values, and a leaf that
  should be a true/false choice but is not, MUST fall back to its shipped default.
- **FR-013**: Where any value was clamped or fell back on load, the corrected configuration MUST be
  written back, so the file states what the application is actually using.
- **FR-013a**: **Correction happens on every read, in every process that reads settings** — the
  startup read and every subsequent reload alike. A value hand-edited out of range while the
  application is running takes effect corrected, not verbatim.
- **FR-013b**: **Write-back happens from exactly one process** — the one that already owns settings
  writes, the same one the Settings editor's saves go through. Every other reader corrects in memory
  and MUST NOT write. Two processes correcting the same file independently is the race this rule
  exists to prevent.
- **FR-013c**: The write-back MUST be serialised with that owner's other settings writes, so a
  correction can never land on top of, or interleave with, a save the user just made.
- **FR-013d**: A write-back MUST NOT trigger a further correction cycle. The file the owner writes
  is by definition already correct, so re-reading it finds nothing to change and nothing more is
  written. The sequence must converge after one write, never oscillate.
- **FR-014**: A configuration whose every value is already valid MUST NOT be rewritten — not at
  startup and not on any reload.
- **FR-015**: **Four** settings currently parse a wider range than they declare. Three of them have
  no stated reason and MUST resolve to their declaration:

  | Setting | Declared | Parsed today | Resolves to |
  |---|---|---|---|
  | `terminals.linkHoverDelayMs` | 0–2000 | 0–5000 | **0–2000** |
  | `diagnostics.keepFiles` | 1–20 | 1–50 | **1–20** |
  | `search.asYouTypeDebounceMs` | 0–1000 | 0–unbounded | **0–1000** |

- **FR-015a**: The fourth, `diagnostics.maxFileSizeKb`, is **deliberate** — it declares 64–4096 so
  its slider stays aimable while the parser accepts up to 64 MB, and says so in the descriptor. That
  intent MUST be preserved: a user's hand-set 64 MB log cap MUST NOT be silently rewritten to 4 MB.
- **FR-015b**: A descriptor MAY therefore declare **`hardMin` / `hardMax`** — the bound the guard
  enforces — separately from `min`/`max`, which remain the control's range. When absent, the hard
  bound **is** `min`/`max`, so every existing descriptor is unaffected and the guard's contract stays
  universal. `diagnostics.maxFileSizeKb` MUST declare `hardMax: 65536`.
- **FR-015c**: A wider hard bound MUST be **declared, never implied**. A comment explaining that a
  parser accepts more than the control offers is not a declaration — the guard cannot read it, which
  is exactly how this divergence went unnoticed.
- **FR-016**: The existing hand-written per-setting clamps MUST be removed in favour of the generic
  guard — `terminals.commandPollMs`, `terminals.linkHoverDelayMs`, and the range checks inside the
  diagnostics and search parsers.
- **FR-017**: Clamping and write-back MUST NOT interfere with resetting a setting to its shipped
  default, and MUST NOT churn the file when nothing needed correcting.
- **FR-018**: If the corrected configuration cannot be written back, the application MUST still
  start on the corrected values.

### Functional Requirements — tab actions (US3)

- **FR-019**: When, and only when, tabs overflow the strip, a tab-actions group MUST be shown
  inside the tab pane, positioned between the tabs and the New Tab control.
- **FR-020**: The group MUST offer three actions: step one tab left, step one tab right, and show
  all tabs.
- **FR-021**: The step-left action MUST show the number of tabs fully hidden to the left, step-right
  the number fully hidden to the right, and show-all the total number of tabs.
- **FR-022**: Those counts MUST update as the strip scrolls, as tabs are created, destroyed or
  reordered, and as the window or pane is resized.
- **FR-023**: Activating step-left or step-right MUST move the strip by exactly one tab.
- **FR-024**: After a step settles, the newly revealed tab MUST be flush with the left edge of the
  tab pane.
- **FR-025**: A step action MUST be unavailable when no tab is hidden in that direction.
- **FR-026**: Show-all MUST list every tab in the strip, visible or not, in strip order.
- **FR-027**: Choosing a tab from the show-all list MUST scroll the strip until that tab is visible
  and make it the active tab.
- **FR-028**: The show-all list MUST be a **typeahead picker**: typing narrows the list to matching
  tabs, the arrow keys move through what remains, Enter chooses, and Escape dismisses. A user with
  dozens of tabs must be able to reach one by name rather than by scanning.
- **FR-028c**: **What counts as a match.** The query is split on whitespace into terms. An entry
  matches when **every** term appears as a **case-insensitive substring** somewhere in that entry's
  searchable text, **in any order**. Worked example: `find file` matches `file find.txt`,
  `find any file.md` and `prefix file any find.pdf`.
  - Order-independence is the point — a user who remembers two words about a target should not have
    to remember which came first.
  - An empty query matches everything; a query of only whitespace is an empty query.
  - Terms are matched against the whole text including separators, so `find file` also matches
    `src/find/file.ts` when a path is the corpus.
- **FR-028d**: The **searchable text** is whatever the picker was seeded with for that entry. For
  the tab picker it is the tab's name. (#219 will seed the same picker with a file's full path,
  which is why FR-028c matches across separators.)
- **FR-028e**: Matched terms MUST be visibly marked in each row, so the user can see why an entry
  matched — which matters most when the terms matched in an order the user did not type them in.
- **FR-028f**: When more than one entry matches, the order MUST be the underlying set's own order
  (strip order for tabs, FR-026) rather than a relevance score. Matching is a filter here, not a
  ranking; a stable, predictable order is worth more than a guessed one.
- **FR-028g**: When no entry matches, the picker MUST stay open and say so, rather than closing or
  showing an empty box with no explanation.
- **FR-028a**: That picker MUST be built as a **general list-and-choose control**, seeded with the
  set of targets it is given — tabs here — so that #219 (Quick Open) can seed the same control with
  project files rather than building a second picker with its own keyboard semantics. Nothing in
  this feature waits on #219.
- **FR-028b**: Each entry in the tab picker MUST identify its tab well enough to choose between
  similarly-named tabs — at minimum the tab's name and its panel count — and MUST indicate which
  tab is currently active.
- **FR-029**: Whenever the active tab changes, by **any** route, the strip MUST scroll that tab into
  view over the configured smooth-scroll duration. This covers creating a tab (so the user can see
  the one they are about to name), clicking a tab, choosing one from the picker, activating one via
  a keyboard chord, a panel drag dwelling on a tab, and restoring a saved layout.
- **FR-029a**: A tab that is **already fully visible** MUST NOT cause the strip to move. The rule is
  "bring it into view", not "scroll to it" — a strip that jumps when nothing was hidden is worse
  than one that never moves.
- **FR-029b**: Where the active tab changes as a *consequence* of another action rather than a
  navigation — the active tab being destroyed, so its neighbour becomes active — the strip MUST
  still bring the newly active tab into view, and MUST NOT be left showing a gap where the
  destroyed tab was.
- **FR-030**: A new Tabs section in Settings MUST expose a smooth-scroll duration in milliseconds,
  bounded 0–3000, defaulting to **300**.
- **FR-030a**: The scroll MUST be **eased in and out**: it accelerates from rest, reaches its
  greatest speed around the middle of the travel, and decelerates to a stop. A constant-speed slide
  does not satisfy this — the start and the stop are what make the movement readable as one tab
  arriving rather than the strip jerking.
- **FR-030b**: The easing MUST hold across the whole configured range, so a duration near either
  end of 0–3000 is the same motion at a different speed, not a different motion.
- **FR-030c**: **A scroll that begins while another is running supersedes it.** The new scroll
  starts from wherever the strip currently is — not from where the interrupted one began, and not
  from where it was heading — and eases to the new target over the full configured duration.
- **FR-030d**: Scrolls MUST NOT queue. Two quick presses of step-right move the strip two tabs and
  settle once; they MUST NOT play two animations back to back, and the strip MUST NOT keep moving
  after the user has stopped pressing.
- **FR-030e**: A superseded scroll MUST leave no residue: no jump back to its start, no continuing
  toward its old target, and no callback that fires later and moves the strip again.
- **FR-030f**: Whatever the sequence of interruptions, the strip MUST come to rest at the target of
  the **most recent** scroll, and that target MUST still be valid — a superseding scroll recomputes
  against the strip's current contents, so a tab destroyed mid-flight cannot be scrolled to.
- **FR-031**: A duration of 0 MUST scroll instantly, with no animation and no easing — the strip is
  simply at its new position on the next frame.
- **FR-031a**: When the operating system's **reduce-motion** preference is on, every scroll MUST be
  instant, exactly as a duration of 0 is, whatever the configured duration says. throng already
  honours this preference elsewhere; an animated tab strip would be the one moving thing that
  ignores it.
- **FR-031b**: The preference MUST NOT change the stored setting. A user who configured 800 ms and
  then turns reduce-motion on still has 800 ms configured, and gets it back when they turn the
  preference off — the preference suppresses the motion, it does not rewrite the choice.
- **FR-031c**: The preference MUST be honoured **live**. Turning it on while the application is
  running MUST take effect without a restart, and MUST also cancel any scroll in flight by settling
  it immediately at its target.
- **FR-031d**: Everything a scroll accomplishes MUST still happen when it is instant — the strip
  still ends at the same place, the active tab is still brought into view, and the counts still
  update. Only the motion is removed, never the outcome.
- **FR-032**: The step and show-all controls MUST be presented as icons drawn from the active
  theme's icon set, each with a hover title naming its action; the chevron icons they need MUST be
  added to every shipped icon set.
- **FR-032a**: One new command MUST open the tab picker, bound by default to **`Ctrl+Alt+T`**. It
  MUST work at any tab count, not only when the strip overflows — a user with six visible tabs may
  still prefer to type a name than to aim at one.
- **FR-032b**: That binding MUST appear in the Key Bindings editor and be rebindable, like every
  other command.
- **FR-032c**: **Principle IV compliance, stated rather than assumed.** `Ctrl+Alt+T` is in neither
  the reserved tier (`Ctrl+C/D/Z/A/E/W/U/K/R/L/Q`) nor the shadowable tier (the emacs-style aliases
  and `Ctrl+S`). It displaces no line-editor binding in any hosted flavour, so it needs no recorded
  exception, and the constitution's enumerated exception list is unchanged by this feature. It sits
  in the `Ctrl+Alt` family throng already owns (`panel.zoom*`, `focus.*`, `view.toggle*`,
  `editor.saveAs`, `editor.toggleWordWrap`).
- **FR-032d**: Opening the picker by chord MUST behave identically to opening it by clicking the
  show-all control — same list, same matching, same choose-and-go.
- **FR-032e**: Dismissing the picker MUST return keyboard focus to wherever it was before the
  picker opened.

### Functional Requirements — name limits (US4)

- **FR-033**: One setting MUST bound the maximum character count of both tab names and panel names.
- **FR-033a**: A "character" is a **grapheme cluster** — what the user perceives as one character —
  not a code point and not a UTF-16 unit. A limit of 10 permits ten things the user would point at
  and call characters, whatever they cost to encode.
- **FR-033b**: Every cut MUST fall on a **grapheme-cluster boundary**, so a truncated name never
  ends in a broken encoding: no split surrogate pair, no emoji cut in half, no combining accent
  separated from its base letter, no zero-width joiner left dangling. Whatever a cut produces MUST
  render as whole characters.
- **FR-033c**: The same counting rule MUST apply everywhere the limit is enforced — the rename
  field's live cap and the truncation of names from every other source — so a name the user could
  type is never one the application would then shorten.
- **FR-034**: That setting MUST default to 64 characters and be adjustable between 10 and 128.
- **FR-035**: A rename field for a tab or a panel MUST stop accepting characters at the limit,
  rather than accepting more and truncating when the rename is committed.
- **FR-035a**: **The refusal MUST be explained before it happens, not after.** A character counter
  MUST appear in the rename field once the name comes within **10 characters** of the limit, showing
  how many are used against the total, and MUST read as at-limit when the cap is reached. A field
  that silently swallows keystrokes leaves the user unable to tell a rejected input from a broken
  application.
- **FR-035b**: The counter MUST NOT be shown while the name is further than 10 characters from the
  limit — it is an approach warning, not a permanent ornament on every rename.
- **FR-035c**: Reaching the limit MUST NOT be presented as an **error**. No error styling, no
  notice, no blocked-commit state: the name is valid, it is simply as long as it may be.
- **FR-035d**: The counter MUST count in the same units the limit does — grapheme clusters
  (FR-033a) — so what it reports and what the field permits can never disagree.
- **FR-035e**: The counter MUST track the limit changing while the field is open, so lowering the
  limit mid-rename immediately shows the new total.
- **FR-035f**: A rename field opened on a name that **already exceeds** the limit — which happens
  whenever the stored name is longer than a limit lowered since (FR-040) — MUST show the full name
  and MUST NOT silently discard the excess as the field opens. The counter reads over its total
  until the user deletes down to it, and **committing applies the limit** (FR-037a), so the rename
  cannot be used to reintroduce an over-long name.
- **FR-035g**: Everything in FR-035a–f applies to **panel** rename fields exactly as it does to tab
  ones — one setting, one counter, one behaviour.
- **FR-036**: A paste into a rename field that would exceed the limit MUST insert as much as fits
  rather than being refused.
- **FR-036a**: A paste that is cut short MUST leave the counter reading at-limit, so the user can
  see that not all of what they pasted arrived.
- **FR-037**: A name arriving from any other source — a persisted layout, a drag into a new tab, a
  panel name derived from a file or a running command — MUST be brought within the limit when read.
- **FR-037a**: Bringing a name within the limit means a **hard cut to at most the limit**, on a
  grapheme-cluster boundary (FR-033b). The resulting value MUST NOT contain an ellipsis or any other
  marker — it is the first N characters of the original and nothing else.
- **FR-037b**: Truncation MUST therefore be **idempotent**: applying the same limit to an
  already-truncated name MUST leave it unchanged. Successive reductions of the limit MUST NOT
  accumulate markers in the data.
- **FR-037c**: A name that *was* cut MUST be **visibly marked as cut where it is displayed** — an
  ellipsis drawn at render time — so the user can tell a short name from a shortened one. That
  marker is presentation only and MUST NOT enter the stored value, MUST NOT count toward the limit,
  and MUST NOT appear in any value the application persists or compares.
- **FR-037d**: A name that happens to be exactly the limit and was not cut MUST NOT be marked.
- **FR-037e**: **Trailing whitespace left by a cut MUST be trimmed.** A hard cut can land after a
  space, and a name ending in an invisible character is one the user can neither distinguish from its
  neighbour nor retype. The limit governs the name's length, not its final character, so trimming
  never makes a name exceed it. Leading whitespace is left alone — the user typed that.
- **FR-038**: A persisted layout containing an over-long name MUST load successfully, with the name
  brought within the limit; it MUST NOT be rejected and MUST NOT error.
- **FR-039**: Lowering the limit MUST bring longer names within it the next time they are read,
  without error.
- **FR-040**: Shortening a name on read MUST NOT, by itself, rewrite the stored name. The stored
  name is replaced with the shortened form only when that layout is next written for some other
  reason (a rename, a tab or panel created or destroyed, a split resized — any ordinary layout
  save). Lowering the limit therefore does not, on its own, destroy the original text: raising it
  again before anything else writes the layout restores the full names, while an ordinary save at
  the lower limit makes the shortening permanent.
- **FR-040a**: Loading a layout MUST NOT be treated as a reason to write one. A project opened and
  closed with no other change MUST leave its stored names as they were.
- **FR-041**: The name-limit setting's own 10–128 bound MUST be enforced by the generic guard of
  FR-008, not by code written for it.

### Functional Requirements — per-tab presentation (US5)

- **FR-042**: A tab's panel count MUST be rendered as a pill; the square-bracket form MUST no
  longer appear.
- **FR-043**: Hovering a tab MUST show its name, its panel count, and the name of each panel it
  contains, one per line.
- **FR-044**: Each tab MUST carry a close affordance on its right-hand side that runs the existing
  Destroy Tab action, with the same confirmations and the same side effects as the context-menu
  item.
- **FR-044a**: The close affordance MUST be **visible on the active tab at all times**, and on any
  other tab **while the pointer is over it**. It MUST NOT be permanently visible on every tab — in a
  strip whose defining problem is width, twenty always-on buttons spend roughly a tab's worth of
  space on controls nobody is reaching for.
- **FR-044b**: Its space MUST be **reserved on every tab**, so the affordance appearing or
  disappearing never reflows the strip and never resizes the tab under the pointer. A tab's width
  and its label's position MUST be identical with the affordance shown and hidden.
- **FR-044c**: **Arming delay.** A close affordance revealed by hover MUST be **inert for a
  configurable delay after it appears** — a click within that window does nothing at all. Sweeping
  the pointer across a strip of tabs must not be able to destroy one, and the affordance appearing
  directly under a pointer that is already moving is exactly when an accidental click happens.
- **FR-044d**: The arming delay MUST restart each time the affordance appears — leaving a tab and
  returning re-arms it. It MUST NOT accumulate across tabs, and a click during the window MUST be
  **ignored, not queued**: nothing may fire when the delay elapses.
- **FR-044e**: A click during the arming window MUST also not activate the tab or start a rename —
  it is inert in every respect, exactly as FR-045 requires of a click that lands on the affordance.
- **FR-044f**: The affordance **MUST** be shown in a subdued state while inert, so the user can see
  it is not yet live rather than being puzzled by a dead click. (Raised from MAY to MUST during the
  analyze pass: a deliberately dead control with no visible difference is the confusion the arming
  delay was added to avoid, and the styling costs nothing.)
- **FR-044g**: The **active** tab's close affordance, which is always present, MUST NOT be subject
  to the arming delay — there is no moment at which it appears, so there is no accidental click to
  guard against.
- **FR-044h**: The Tabs settings section MUST expose the arming delay in milliseconds, bounded
  **0–2000**, defaulting to **300**. A value of 0 means the affordance is live immediately.
- **FR-045**: Activating a tab's close affordance MUST NOT activate the tab and MUST NOT start a
  rename.
- **FR-046**: A tab's close affordance MUST be unavailable wherever Destroy Tab is itself
  unavailable.

### Cross-cutting requirements

- **FR-047**: Every setting this feature adds MUST be editable through the Settings editor, with a
  label and a description — no setting reachable only by hand-editing the file.
- **FR-048**: Every behaviour this feature adds or changes in the interface MUST ship with
  automated end-to-end coverage that exercises it through the running application, and that
  coverage MUST be registered so it actually runs in continuous integration.
- **FR-049**: User-facing documentation MUST be brought into agreement with the shipped behaviour
  in the same change.

### Key Entities

- **Tab**: a named workspace view holding one or more panels. Carries a name (bounded by FR-033), a
  panel count, and a position in the strip.
- **Panel**: the atomic content unit inside a tab. Carries a name, bounded by the same setting as a
  tab's.
- **Tab strip view state**: the strip's scroll offset and, derived from it, the number of tabs
  fully hidden to each side. View state only — never persisted (FR-006).
- **Setting descriptor**: the single existing declaration of a setting's label, control, default
  and — where bounded — its minimum and maximum or its set of allowed values. The authority the
  read-side guard works from.
- **Name limit setting**: one bounded value, 10–128, default 64, governing both tab and panel names.
- **Smooth-scroll duration setting**: one bounded value, 0–3000 ms, default 300, governing how long
  the strip takes to scroll; 0 means no animation.
- **Close-affordance arming delay setting**: one bounded value, 0–2000 ms, default 300, governing
  how long a hover-revealed close affordance stays inert; 0 means live immediately.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With 30 tabs open in a project, every visible tab is fully drawn — none is clipped,
  and no scrollbar occupies any part of the strip.
- **SC-002**: From any scroll position, a user can reach any tab in the project without scanning
  the strip: open the tab list, type part of the name, choose it.
- **SC-002a**: The tab list stays usable at dozens of tabs — narrowing by name reaches a single
  candidate in a few keystrokes, rather than requiring the user to read a list that no longer fits
  the screen.
- **SC-002b**: A user who remembers two words from a tab's name reaches it regardless of the order
  they type them in.
- **SC-003**: Without scrolling, a user can read how many tabs are out of view to each side and how
  many there are in total.
- **SC-004**: 100% of values that declare a range load within that range — top-level settings and
  the columns of keyed tables alike — whatever the configuration file contains, verified against the
  declared set rather than a hand-written list.
- **SC-004a**: Exactly one implementation of the bounds guard exists in the codebase, and every
  declared bound is enforced through it.
- **SC-004b**: Exactly one process ever writes a correction back, and a correction never costs the
  user a setting they had just saved.
- **SC-005**: No value that can be written into the configuration file puts the application into a
  state it cannot render or recover from — no pane wider than its window, no interval that pegs a
  core, no limit that defeats the protection it exists to provide.
- **SC-006**: No tab or panel name exceeds the configured limit, whatever its origin, and no
  truncated name ever renders as a broken or partial character.
- **SC-007**: A tab can be closed from the strip in a single action, without opening a menu.
- **SC-007a**: Sweeping the pointer across the whole strip, clicking nothing deliberately, destroys
  no tab.
- **SC-007b**: Showing and hiding a tab's close affordance never changes any tab's width or any
  label's position.
- **SC-008**: Adding a new bounded setting requires zero additional guarding work for that setting
  to be protected on read.
- **SC-009**: A project whose saved layout contains an over-long name opens successfully every
  time.
- **SC-010**: The active tab is visible in the strip 100% of the time, at any tab count, however it
  became active — and the strip never moves when the active tab was already fully visible.
- **SC-011**: Lowering the name limit and raising it again, with no other change in between,
  returns every name to what it was.
- **SC-012**: #219 (Quick Open) can be built by seeding the picker this feature delivers, with no
  second list widget and no second set of keyboard semantics.

---

## Assumptions

- **Scope of the tab strip changes.** Everything here applies wherever a tab strip is rendered,
  including sub-workspace windows, because they render the same strip. #225's exclusion of
  "sub-workspace / detached-window title bars" is read as excluding those windows' *title bars*,
  not their tab strips.
- **Panel-level tabs are untouched.** Panels tiled inside a split do not have a strip of this kind;
  nothing here changes them.
- **Drag-to-reorder is unchanged** beyond continuing to work from a scrolled position (FR-007).
- **Destroy Tab itself is unchanged.** Story 5 adds a second route to the existing action; it does
  not alter what the action does.
- **Choosing a tab from the show-all list activates it** as well as scrolling to it (FR-027). #225
  says only that the strip scrolls to it, but a user picking a tab from a list of tabs means to go
  to it.
- **The picker lists its own window's tabs.** Opened in a sub-workspace window, it lists that
  window's tabs, not the main window's — it is the strip's picker, and each window has its own strip.
- **The picker follows the tabs while it is open.** A tab created or destroyed by another route
  while the picker is showing updates the list in place; the picker does not close, and the
  highlighted entry stays on the same tab where that tab still exists.
- **The fade sits under the tab-action controls and the New Tab button**, not over them. It marks
  the edge of the scrolling tabs, and the controls are pinned outside that region.
- **Tab-strip navigation controls are exempt from "every panel action has a menu item"**
  (Principle VI). Stepping the strip left or right is *navigational input*, which the principle
  explicitly distinguishes from discrete commands and state toggles. Destroy Tab, which is a
  discrete command, already has its menu item and keeps it (FR-044 adds a second route, not a
  replacement).
- **Panel names derived automatically are display names**, and are subject to the limit like any
  other panel name (FR-037). The underlying file path or command string that a name is derived from
  is not itself truncated — only the name a panel wears. #218 (landed) already resolves that name
  in one place; see Dependencies.
- **Write-back applies to the settings file only.** Layout and workspace files are out of scope for
  #227's guard, per that issue.
- **Terminal titles, project names and explorer file names** keep their own rules and are not
  governed by the name limit.
- **The picker is shared, and this feature builds it.** #219 (Quick Open) is a *consumer* of the
  control FR-028a describes, not a prerequisite of it. This feature delivers the picker and the tab
  seeding only; opening project files remains entirely #219's work.
- **Shortening for display is not a layout change.** FR-040 turns on there being an existing notion
  of "the layout was written because something changed"; this feature does not introduce one.

## User Story 6 - The strip, as the maintainer actually wants it (Priority: P6)

**Added 2026-08-12** from hands-on feedback after US1–US5 landed. This is the first story written
from *using* the strip rather than from reading the issues, which is why several of its items
contradict choices US3 and US5 made in good faith.

**Independent test**: open a project with long tab names, and check each item below against the
running app.

### Functional requirements

- **FR-050**: A new **`tabs.maxWidth`** setting MUST bound how wide the widest tab may be. Range
  **10–128**, default **32**. (Units follow the existing name limit — characters, not pixels — so
  the two settings are comparable.)
- **FR-050a**: A title that would exceed it MUST be **ellipsised in the view**. This is a *width*
  cap on rendering and is distinct from `tabs.maxNameLength`, which bounds the NAME. A tab may
  therefore be ellipsised without its name being truncated.
- **FR-050b**: Hovering such a tab MUST show the **full** tab name — not the ellipsised form.
- **FR-051**: The tab hover MUST be **properly formatted and indented** rather than a flat run of
  text. A native `title` attribute cannot do this, so it MUST become an **HTML popover** with its
  own style.
  - This **supersedes FR-043**'s "one per line" phrasing, which assumed the `title` attribute.
- **FR-052**: The tab-action controls MUST read, left to right:
  `[ ‹  <hidden-left> ]  [ <hidden-right>  › ]  [ ⌄  <total> ]`
  — the left chevron BEFORE its count, the right chevron AFTER its count, and the show-all chevron
  before its total.
- **FR-052a**: The show-all chevron MUST be **vertically centred** within its control.
- **FR-052b**: Every count MUST render in a **pill**, styled exactly as the per-tab panel-count pill
  (FR-042), so one visual vocabulary covers both.
- **FR-053**: Creating a tab with **+** MUST insert it **immediately to the right of the active
  tab**, not at the end of the strip.
- **FR-053a**: A new **`tabs.newTabPosition`** setting MUST offer both behaviours — beside the
  active tab, or at the end — defaulting to **beside the active tab**.
- **FR-054**: **Press-and-hold** on either chevron MUST scroll the strip **continuously** after a
  short delay, rather than requiring one click per tab.
- **FR-054a**: A new **`tabs.chevronRepeatDelayMs`** setting MUST control that delay. Range
  **100–3000**, default **500**, in **50 ms** increments.
  - The 50 ms step also satisfies the aimable-slider rule: 50 across a 2900 range is 1.72%, and the
    default is reachable (100 + 50×8 = 500).
- **FR-054b**: Releasing the pointer, or leaving the control, MUST stop the repeat immediately.
- **FR-054c**: The repeat MUST respect the same supersede rule as every other scroll (FR-030c–f) —
  it may not queue movements that continue after the user lets go.

### Notes for planning

- `tabs.maxWidth` and `tabs.chevronRepeatDelayMs` are bounded, so they inherit US2's guard for free
  (FR-008); `tabs.newTabPosition` is an enum and inherits FR-012's allowed-values handling.
- FR-053 changes `addTab`, which is pure core (`packages/core/src/workspace/`) and has existing
  tests — the insertion index is the whole change.
- FR-051's popover is a new floating surface, so it must be registered in
  `floating-surfaces.test.ts` (that guard is an enumeration and will fail otherwise).

## User Story 7 - A second pass over the strip in use (Priority: P7)

**Added 2026-08-12**, from the maintainer using US6. Two of these are defects this feature
introduced; the rest are ranges and behaviours that only reveal themselves in use.

### Functional requirements

- **FR-055**: `tabs.smoothScrollMs`'s maximum MUST be **1500**, not 3000. Three seconds to move one
  tab is not a preference anyone holds; the range was invented, not chosen.
- **FR-056**: `tabs.closeArmingDelayMs`'s maximum MUST likewise be **1500**.
- **FR-057**: The arming delay MUST apply to **every** tab, **including the active one**.
  - **This supersedes FR-044g**, which exempted the active tab on the reasoning that its affordance
    is always present, so there is no moment at which it appears and therefore no accidental click
    to guard against. In use that is wrong: the active tab's X is the one most often adjacent to
    where the pointer already is, and "the rule depends on which tab you are over" is harder to hold
    than "the X arms after you rest on it".
- **FR-058**: A new **`tabs.popoverDelayMs`** setting MUST control how long the pointer rests on a
  tab before its info popover appears. Range **0–1500**, default **300**.
- **FR-059**: While a **drag is in progress** — a tab being reordered, or a panel being dragged over
  a tab — the close affordance MUST NOT activate at all, and its arming delay MUST NOT even begin
  counting.
  - A drag passes the pointer over tabs by definition, so an arming delay alone is not protection:
    a long drag would arm it in passing and the drop would land on a destroy.
- **FR-060**: A tab MUST render its **top border**. The chips are currently clipped along the top —
  the corner radius shows and the border line does not.
  - Cause, to be confirmed by measurement rather than assumed: the track clips vertically (CSS
    forces `overflow-y` to a non-visible value once `overflow-x` is one), so a chip even a pixel
    taller than the track's content box loses its top edge. The **active** chip is exactly one pixel
    taller than an inactive one, because `.tab-chip--active` carries a 2px accent border where the
    others carry 1px.
- **FR-061**: **Right-clicking a tab MUST hide its popover**, which otherwise obscures the context
  menu it just opened.
- **FR-061a**: Once hidden that way, the popover MUST NOT reappear until the pointer **leaves the
  tab and returns**. Re-showing it while the menu is still open would restore the obstruction.

### Notes for planning

- FR-055/FR-056 narrow an existing range. Both are already guarded, so a user whose stored value is
  above the new maximum is clamped on read — no migration, and FR-013's write-back records it.
- FR-058's step must satisfy the aimable-slider rule (≥1% of range) **and** land on its default:
  across 0–1500 a step of 25 is 1.67% and reaches 300 exactly.
- FR-060 is a regression from US1's restructure and needs a **measured** diagnosis; the cause above
  is a hypothesis with supporting evidence, not a finding.

## Dependencies

- **#218 (panel auto-naming) has landed** (on `origin/master` as of 2026-08-11; this branch is
  based on it). It resolved "which name does a panel wear" into one pure rule, so the derived names
  FR-037 speaks of now arrive from a single place rather than from a ternary in the panel header.
  That is where the limit applies for panels — a resolved *display* name, whatever its source
  (typed override, shell window title, terminal flavour label, file path). Nothing about this
  feature needs to re-derive the rule.
- **Spec 030 (notification preferences and notice subjects)** is in flight and adds new bounded
  settings. Those settings inherit US2's guard automatically once both have landed; neither needs
  the other to ship first.
- **#219 (Quick Open)** depends on *this* feature, not the reverse: User Story 3 delivers the
  typeahead picker (FR-028a) that #219 will seed with project files. #219 has been updated to say
  so. Its `Ctrl+Shift+T` and this feature's `Ctrl+Alt+T` are deliberately distinct chords for
  distinct corpora.
- **#164 (global shortcuts fire in a focused terminal)** applies to `Ctrl+Alt+T` exactly as it does
  to #219's binding: the chord must reach the application from a focused terminal panel. If #164
  lands first this feature inherits the fix; if not, this feature MUST NOT paper over it with a
  terminal-only special case.
