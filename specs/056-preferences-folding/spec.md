# Feature Specification: Fold and Unfold Preferences Sections

**Feature Branch**: `feature/S056-I479-preferences-folding`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Fold and unfold sections and subsections in Preferences —
[#479](https://github.com/Bidthedog/throng/issues/479). The Settings form in Preferences is one long
page; the Editor section alone holds more than thirty rows plus Status Bar, Links and Previews
subsections, and 054 added a Markdown subsection under Previews. To reach a setting you scroll past
everything above it or search for it by name. Every section and subsection in the Preferences forms
can be folded and unfolded from its heading, by mouse and keyboard; a folded heading still shows its
name and how many settings it holds."

This feature builds on spec **040** (preferences subgroups) and spec **054** (the nested
`subsection` level). It **supersedes** one requirement and one contract rule, each restated where it
is replaced:

| Superseded | By | What changes |
|---|---|---|
| 040 FR-036a — "MUST NOT be collapsible — the sections containing it are not collapsible either" | FR-001, FR-002 | Every section, subgroup and nested subsection folds from its heading. Declaration order (the rest of FR-036a) is unchanged |
| 040 `contracts/metadata.md` rule 3 — "A subsection is **not collapsible**" | FR-002 | Rule 3 inverts: every subsection is collapsible, in all three tabs alike |

040's own reason for FR-036a was consistency — "a subsection that folds inside a section that cannot
would be the odd one out". This feature keeps that reasoning and satisfies it the other way round:
sections and subsections all fold, so none is the odd one out.

040 FR-035 (optional `subgroup`), FR-036 (every grouping tab renders subgroups the same way), FR-036b
(ungrouped fields render first), FR-036c (a subgroup filtered empty by search disappears with its
heading), FR-037a (sibling-string sub-groups left as they are) and 054 FR-050a (the third nesting
level) are **not** changed; this feature must satisfy them.

## Clarifications

### Session 2026-10-14

- Q: When you fold sections in Preferences, how long should they stay folded? → A: **Across app
  restarts**, saved per user as hidden UI state, not a visible setting. A search that matches a
  setting inside a folded section unfolds it; clearing the search folds it again if it was folded
  before. (FR-008, FR-009, FR-011)
- Q: When a section is folded, should its heading show anything about the rows hidden inside it? → A:
  **A warning marker while any hidden row holds an invalid entry**; nothing for rows that are only
  changed. (FR-007)
- Q: Should each Preferences tab have Expand All / Collapse All controls, and if so, where? → A:
  **Two icon buttons beside each tab's search box**, acting on every section and subsection in that
  tab. (User Story 5, FR-011b)
- Q: Should a heading show its count of settings all the time, or only while it is folded? → A:
  **Always**, and under an active search as **matches out of total** ("3 of 34"). (FR-006)

### Session 2026-10-15

Maintainer feedback after MT-01..MT-06 were signed off at `f85e92b5`: "Maybe we should have the sections
collapse by default."

- Q: When nothing is remembered for a heading (first open, or a heading new since the last visit), what
  should start folded? → A: **Top-level sections only**, on all three tabs (Settings, Key Bindings,
  Themes, the Icons section included); subgroups and nested subsections start unfolded, so opening a
  section shows its whole content. Reverses the "all unfolded" default of FR-012 and SC-005, and the
  "new heading opens unfolded" half of FR-011a. (FR-016, FR-017, SC-006)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fold away the sections I am not working in (Priority: P1)

A user tuning terminal settings opens Preferences and folds Editor, which pushes thirty-odd rows and
four subsections out of the way. Terminal's rows are now near the top of the form. Clicking Editor's
heading again brings it all back exactly as it was.

**Why this priority**: This is the whole of #479's intent. Without it the other stories have nothing
to act on.

**Independent Test**: Open the Settings tab, click a section heading, and see its rows disappear while
its heading stays; click it again and see them return.

**Acceptance Scenarios**:

1. **Given** the Settings tab with every section unfolded, **When** the user clicks the Editor
   heading, **Then** every row and subsection under Editor is hidden and the Editor heading stays in
   place.
2. **Given** Editor is folded, **When** the user clicks its heading again, **Then** its rows and
   subsections reappear in their original order.
3. **Given** the Editor section is unfolded, **When** the user clicks the Previews subsection heading,
   **Then** only Previews (including its nested Markdown subsection) folds; the rest of Editor stays
   visible.
4. **Given** a folded section, **When** the user looks at its heading, **Then** it shows the section's
   name and how many settings it holds.
5. *(Session 2026-10-15, FR-016)* **Given** no remembered fold state, **When** the user opens any of the
   three tabs, **Then** only the section headings are shown, each folded with its count.
6. *(FR-016)* **Given** no remembered fold state, **When** the user unfolds Editor, **Then** its rows and
   every subsection (Status Bar, Links, Previews and its Markdown subsection) are shown unfolded.
7. *(FR-017)* **Given** the user unfolded Terminal, **When** they close Preferences, restart throng and
   reopen Preferences, **Then** Terminal is still unfolded and every section they never opened is folded.

---

### User Story 2 - Fold and unfold from the keyboard (Priority: P1)

A keyboard user tabs through Preferences, reaches a section heading, and presses Enter or Space to
fold or unfold it. A screen-reader user hears the heading's name and whether it is expanded or
collapsed.

**Why this priority**: The acceptance criteria in #479 require it, and throng's full-keyboard
ambition (#26) means a mouse-only control would be a regression in kind.

**Independent Test**: With no mouse, Tab to a heading, press Enter, see it fold; press Space, see it
unfold. Query the heading's accessible state and get expanded/collapsed.

**Acceptance Scenarios**:

1. **Given** focus is just before a section heading, **When** the user presses Tab, **Then** the
   heading's fold control receives visible focus.
2. **Given** a focused unfolded heading, **When** the user presses Enter, **Then** it folds; **When**
   they then press Space, **Then** it unfolds.
3. **Given** a heading's fold state changes, **Then** assistive technology is told the new
   expanded/collapsed state.
4. **Given** a folded section, **When** the user presses Tab from its heading, **Then** focus moves to
   the next visible heading or control, never into the hidden rows.

---

### User Story 3 - Search finds settings in folded sections (Priority: P1)

A user has folded most sections, then searches for "wrap". The matching settings appear even though
the sections holding them are folded. When the search is cleared, the sections the user had folded
are folded again.

**Why this priority**: Without it, folding silently hides search results — the user searches, sees
nothing, and concludes the setting does not exist.

**Independent Test**: Fold Editor, search for a setting that lives in Editor, see the match; clear the
search and see Editor folded again.

**Acceptance Scenarios**:

1. **Given** Editor is folded, **When** the user searches for a term matching a setting in Editor,
   **Then** Editor (and any subsection holding the match) is shown unfolded with the match visible, and
   each shown heading's count reads matches out of total (e.g. "2 of 34").
2. **Given** a search is active, **When** the user clears it, **Then** each section and subsection
   returns to the fold state it had before the search began.
3. **Given** a folded section with no matching settings, **When** the user searches, **Then** that
   section disappears entirely, as an empty group does today (040 FR-036c).

---

### User Story 4 - The same folding on Settings, Key Bindings and Themes (Priority: P2)

The Key Bindings and Themes tabs group their rows the same way Settings does, and fold the same way:
same heading control, same keyboard behaviour, same count, same search behaviour.

**Why this priority**: 040 FR-036 already requires the three tabs to render grouping identically;
folding in one tab only would break it. P2 only because Settings is where the length hurts most.

**Independent Test**: Repeat User Stories 1–3 on the Key Bindings and Themes tabs and observe the same
outcomes.

**Acceptance Scenarios**:

1. **Given** the Key Bindings tab, **When** the user clicks a group heading, **Then** it folds exactly
   as a Settings section does, and its heading shows how many bindings it holds.
2. **Given** the Themes tab, **When** the user clicks the Icons section heading or any token group
   heading, **Then** it folds exactly as a Settings section does.
3. **Given** each of the three tabs, **When** a search matches a row inside a folded section,
   **Then** the match is shown, as in User Story 3.

---

### User Story 5 - Fold or unfold the whole form at once (Priority: P3)

A user who folded most of the Settings form last week wants to see everything again. They click
**Expand All** beside the search box and every section and subsection in that tab opens. **Collapse
All** folds them all, leaving only the top-level headings.

**Why this priority**: A convenience on top of per-heading folding; it matters more because fold state
survives restarts (FR-011).

**Independent Test**: Fold some headings, click Expand All and see every heading unfolded; click
Collapse All and see every heading folded; switch tab and see that tab's folds unchanged.

**Acceptance Scenarios**:

1. **Given** some sections and subsections are folded, **When** the user clicks Expand All, **Then**
   every section and subsection in that tab is unfolded.
2. **Given** any fold state, **When** the user clicks Collapse All, **Then** every section and
   subsection in that tab is folded, and only the top-level section headings remain visible.
3. **Given** the user clicks Collapse All on the Settings tab, **When** they switch to Key Bindings,
   **Then** Key Bindings' fold state is unchanged.

---

### Edge Cases

- **Folding a section whose subsections are themselves folded**: unfolding the section restores each
  subsection to the state it had — fold state is per heading, not cascaded.
- **Toggling folds during an active search**: a fold or unfold made while searching applies to what is
  on screen, and is discarded when the search clears; FR-009 restores the pre-search state.
- **Search text changes while a search is active**: sections that now match are shown unfolded;
  sections that no longer match disappear (040 FR-036c). No fold state is recorded from these
  transitions.
- **A section with no subsections and only one row**: it still folds; the count reads 1.
- **A section filtered to zero rows by search**: it disappears with its heading (040 FR-036c); there is
  no folded-but-empty heading.
- **Reset to Defaults / Revert All / per-row revert**: these change values, not fold state; a revert of a
  row in a folded section leaves the section folded.
- **A row in a folded section has an invalid entry**: the folded heading shows a warning marker, and the
  entry is still there on unfold (FR-007). A row that is only changed, not invalid, gets no marker.
- **Switching tabs**: each tab has its own fold state; folding Editor in Settings does not fold anything
  in Key Bindings.
- **The JSON tab** has no sections and is unaffected.
- **The heading is also a label for its group** (`role="group"` + `aria-labelledby`, per
  `subsection.tsx`): the group must keep its accessible name when folding is added.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every **section** (top-level group heading) in the Settings, Key Bindings and Themes tabs
  MUST be foldable and unfoldable from its heading. This includes the Themes tab's Icons section and
  every sibling-string group (`Editor · Navigation`, `General · Buttons · Cancel`, …), which render as
  sections (040 FR-037a). Supersedes 040 FR-036a's "the sections containing it are not collapsible
  either".
- **FR-002**: Every **subgroup** and every **nested subsection** (054 FR-050a) MUST be foldable and
  unfoldable from its heading, independently of its parent and siblings. Supersedes 040 FR-036a's
  "MUST NOT be collapsible" and 040 contract rule 3. Declaration order (the rest of 040 FR-036a) is
  unchanged.
- **FR-003**: Folding a heading MUST hide every row and every descendant subsection beneath it and
  nothing else. The heading itself stays visible in its place. Unfolding MUST restore the contents in
  their original order, with each descendant heading in the fold state it had before.
- **FR-004**: The fold control MUST be operable by mouse (a click anywhere on the heading row) and by
  keyboard: each heading is reachable with Tab, and Enter or Space toggles it. Rows inside a folded
  heading MUST NOT receive focus.
- **FR-005**: Each heading MUST expose its expanded/collapsed state to assistive technology, and MUST
  keep the accessible name it already gives its group (`subsection.tsx`'s `role="group"` +
  `aria-labelledby`).
- **FR-006**: A heading MUST show how many rows it holds — settings on the Settings tab, bindings on Key
  Bindings, values on Themes — counting every row beneath it, including rows in its descendant
  subsections. The count MUST be shown **whether the heading is folded or unfolded**. While a search is
  active it MUST read as **matches out of total** (e.g. "3 of 34"), where both numbers count rows beneath
  that heading; when the search clears it returns to the plain total.
- **FR-007**: A folded heading MUST show a **warning marker** while any row beneath it (including rows
  in its descendant subsections) holds an invalid entry, and MUST NOT show it otherwise. Folding MUST NOT
  discard an invalid entry: unfolding shows the row exactly as it was left. No marker is shown for rows
  that are merely changed since Preferences opened. The marker is announced to assistive technology
  with the heading.
- **FR-008**: While a search is active, every section and subsection containing at least one match
  MUST be shown unfolded, whatever its fold state, so every match is visible. Sections and subgroups
  with no match disappear with their headings, unchanged from 040 FR-036c.
- **FR-009**: When a search is cleared, every section and subsection MUST return to the fold state it
  had immediately before the search began. Fold toggles made during the search are discarded.
- **FR-010**: Fold state MUST be independent per tab: Settings, Key Bindings and Themes each keep their
  own.
- **FR-011**: Fold state MUST persist **across closing and reopening Preferences and across app
  restarts**, stored per user as **hidden UI state** — not a setting, so it has no row in Preferences
  and no entry in the settings documentation. Only the user's own folds are stored; the temporary
  unfolding a search causes (FR-008) is never written.
- **FR-011a**: A stored fold entry naming a heading that no longer exists (a group or subgroup removed or
  renamed by a later release) MUST be ignored without error, and a heading that is new since the state
  was stored MUST open unfolded.
  *Second half superseded by FR-016 (Session 2026-10-15) — a new heading opens at its default: a section
  folded, a subgroup or subsection unfolded. The first half (stale entries ignored) stands.*
- **FR-011b**: Each of the three tabs MUST offer **Expand All** and **Collapse All** as two icon buttons
  beside that tab's search box. Expand All unfolds, and Collapse All folds, **every section and every
  subsection in that tab only**. The result is the user's fold state, persisted like any other fold
  (FR-011). Both buttons follow the themeable-icon-control rule (FR-014), carry a hover title, and are
  keyboard-operable. While a search is active both MUST be disabled, since the search decides what is
  unfolded and toggles made during a search are discarded (FR-008, FR-009).
- **FR-012**: When Preferences opens with no remembered fold state, every section and subsection MUST be
  unfolded — the form looks exactly as it does today.
  *Superseded by FR-016 (Session 2026-10-15) — sections now start folded.*
- **FR-013**: The three tabs MUST fold identically — same control, same keyboard behaviour, same count
  presentation, same search behaviour — through the one shared rendering they already use for
  subsections (040 FR-036), so the rule cannot drift between tabs.
- **FR-014**: The fold indicator on each heading is an icon control and MUST follow the constitution's
  themeable-icon-control rule, matching the disclosure indicator throng already uses elsewhere.
- **FR-015**: User-facing documentation for Preferences MUST describe folding, the count on headings,
  the invalid-entry marker, Expand All / Collapse All, that folds are remembered across restarts, and
  how search interacts with folded sections.
- **FR-016**: A heading the user has never folded or unfolded MUST take its **default**: every
  **section** (top-level heading, the Themes tab's Icons section included) starts **folded**; every
  **subgroup and nested subsection** starts **unfolded**. This holds on all three tabs, on first open and
  for a heading that is new since the state was stored. Supersedes FR-012 and the second half of
  FR-011a.
- **FR-017**: The user's own choice MUST be remembered in both directions: a section the user unfolds
  stays unfolded across closing Preferences and restarting (FR-011), exactly as a subsection the user
  folds stays folded. Expand All and Collapse All (FR-011b) record every heading in the tab as an
  explicit choice. *(derived from FR-011 and FR-016: with folded sections as the default, persisting
  only folds could never remember an opened section; not asked of the user)*
- **FR-018**: User-facing documentation (FR-015) MUST say that sections start folded until opened.

### Key Entities

- **Fold state**: for one tab, the set of section and subsection headings the user has folded. Keyed by
  the heading's identity (group, subgroup, subsection), not by position, so it survives a registry
  gaining or reordering entries. Persisted per user across restarts as hidden UI state (FR-011).
  *Amended by FR-017 (Session 2026-10-15): the state records the user's explicit choice per heading,
  folded or unfolded; a heading with no recorded choice takes its FR-016 default.*
- **Pre-search fold state**: a snapshot of the fold state taken when a search begins and restored when
  it clears.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With every section except the one being worked in folded, the target section's first row
  is visible without scrolling in the Settings tab at the default Preferences window size.
- **SC-002**: Every section and subsection heading in all three tabs can be folded and unfolded with
  the keyboard alone, and announces its state to assistive technology — 100% of headings, 0 exceptions.
- **SC-003**: A search for any setting's name shows that setting regardless of fold state — 0 cases
  where a match is hidden by a fold.
- **SC-004**: After clearing a search, the fold state matches the pre-search state for 100% of headings.
- **SC-005**: Opening Preferences with no remembered fold state shows a form visually identical to the
  pre-feature form, apart from the fold indicator and count on each heading.
  *Superseded by SC-006 (Session 2026-10-15).*
- **SC-006**: Opening Preferences with no remembered fold state shows only the section headings on each
  tab — 100% of sections folded, 0 rows visible — and unfolding any section shows all of its rows and
  subsections with no second click.

## Assumptions

- **Default state is all unfolded** (FR-012), so the feature changes nothing for a user who never
  folds. *Superseded by FR-016 (Session 2026-10-15): sections start folded.*
- **Click target is the whole heading row**, not only the indicator. 019 (#121, superseding 004 FR-028)
  made the explorer tree toggle on the chevron alone because a tree row's name also selects; a Preferences heading has
  no selection meaning, so the whole row is the larger, easier target.
- **Fold toggles during a search are discarded** (FR-009): the pre-search state is the user's chosen
  layout; a search is a temporary view.
- **Fold state does not cascade**: folding a section does not change its subsections' own state (FR-003).
- **Out of scope**: reordering sections; consolidating the two sub-grouping conventions (#319); search
  result ranking (#270); the JSON tab.
- **Related**: #319, #270, and 054's Markdown subsection (#462, #392, #478), which is one of the headings
  this feature folds.
