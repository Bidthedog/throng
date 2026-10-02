# Feature Specification: Match and Selection Highlighting

**Feature Branch**: `feature/S049-I455-I456-I457-I324-I325-match-and-selection-highlighting`

**Created**: 2026-10-01

**Status**: Draft

**Input**: User description: "Spec 049 — match and selection highlighting. Issues #455 (find does not expand a collapsed section to show a match, previews and editors), #456 (preview find loses highlights after a tab switch, then Next reports No results), #457 (keep a soft inactive-selection highlight in previews and editors after focus moves away), #324 (highlight other instances of the selected text in editors), #325 (one highlight vocabulary for search matches and selection occurrences; existing find-bar appearance must not change)."

**Issues**: #455, #456 (defects), #457, #324 (enhancements), #325 (tweak).

**Governing requirements this spec builds on, and does not supersede**:

- 013 FR-019 — match-highlight colours come from theme tokens, exposed in the Themes editor.
- 016 FR-007a — a match highlight composes beneath the syntax layer, so highlighted code keeps its colours,
  proven by a contrast guard over every bundled theme.
- 033 Clarifications — *"A find bar closes only when the user closes it or its editor closes"*; it keeps its
  query, match count and highlights until then.
- 044 FR-035 — a preview body allows selecting and copying text.
- 047 User Story 1 scenario 7 and the *Find across a fold* edge case — a current match inside a folded preview
  section expands that section.

## Clarifications

### Session 2026-10-01

- Q: Should previews also tint other occurrences of selected text, or only editors? → A: **Editors and Markdown
  previews** — both panel types tint occurrences of their own selection (FR-014).
- Q: Which other text should count as an occurrence of the selection? → A: **Whole-word matches when the selection
  is a whole word, otherwise any literal match; case-sensitive.** Word boundaries are any character that is not a
  letter, digit or underscore, so selecting `id` tints `id`, `-id`, `id.` and `some-id-word`, but not `width` or
  `valid` (FR-015).
- Q: How should each theme get its inactive-selection colour? → A: **Derived from the theme's own selection colour
  by one function**, the way the search-match surfaces are derived, and stored as an editable token the user can
  override (FR-025).
- Q: Should occurrence tinting have its own on/off setting, and what should the default be? → A: **One setting
  covering editors and previews, on by default** (FR-019).
- Q: Where a word is both a search match and an occurrence of the selected text, which highlight should show? → A:
  **The search highlight wins; the occurrence tint is not painted on that range** (FR-013).
- Q: When a panel with a selection is hidden by a tab switch and then shown again, should its selection still be
  there? → A: **Yes — kept across a tab switch, unless the text under it changed** (FR-022, FR-026).
- Q: When a panel loses focus and its selection turns inactive, should the tints on other occurrences of that text
  stay? → A: **They stay, but fade to a weaker inactive-occurrence tint while the panel is unfocused**, and return
  to full strength when it regains focus (FR-018a).
- Q: In a preview, should a word count as an occurrence when its letters are split across formatting? → A: **Yes —
  match the rendered text as read, across formatting boundaries**, the same text preview find searches (FR-014a).
- Q: When the user presses Replace All and some matches are inside folded sections, should those sections be
  expanded? → A: **Ask first.** Before replacing, the user chooses to replace and unfold, replace and keep the
  sections folded, or cancel (FR-007a).
- Q: When the same file is open in an editor and a preview side by side, should selecting text in one also tint its
  occurrences in the other? → A: **No — each panel tints only occurrences of its own selection** (FR-014b).
- Q: How quickly must occurrence tints appear after a selection changes, in a large document? → A: **Within 100 ms
  in a 10,000-line document, with typing no slower than with tinting off** (SC-005, FR-020).
- Q: Should a panel's open search and its kept selection also survive the panel being moved — dragged to another
  tab or split, or into another window? → A: **Yes, every move.** A panel's state does not change as it is dragged,
  resized, synced into a sub-workspace or moved to another tab or window; it survives everything while the panel
  is loaded, and is lost only when the panel is unloaded (FR-000).

### Session 2026-10-02

Iterate round 1, from manual testing of MT-01.

- Q: When a panel is dragged and dropped — into another tab, a split, or a new position in its own tab — should
  it take keyboard focus? → A: **Yes.** The dropped panel becomes its tab's active panel and receives keyboard focus,
  as a keyboard route into it would give it (FR-000b). *(The maintainer's words: "when I drag any panel into another
  tab, the panel I am dropping should get focus.")*

Iterate round 2, from manual testing of MT-04 and the note on MT-06 (the maintainer's answers, 13:50).

- Q: The current search match is not distinct enough from the other matches on English Garden, Matrix, Snake and
  VI-VIM (good on VSCode, Claude, Cyberpunk, Debian). How should it stand out more? → A: **Both fill and outline.**
  The current-match fill is held at least as far from the ordinary-match fill as the weakest theme the maintainer
  judged good (Claude, ΔE00 9.47 → a floor of 9.0) on every bundled theme, and the current match carries a stronger
  outline everywhere (FR-009a, FR-009b). This supersedes FR-009 and SC-003's "unchanged" for those surfaces.
- Q: Some themes make it hard to tell what is still selected after focus moves away. Raise the inactive selection's
  distance from the page too? → A: **Yes** (FR-025a). *(Floor value derived, not heard: the same 9.0 ΔE00, the level
  the maintainer accepted for the current match.)*
- Q: Collapse All in a Markdown editor leaves the root H1 showing `−`. Fix here or file it? → A: **Fix in this
  branch.** A defect against 047 FR-037a ("Collapse All on a document with one H1 therefore leaves only the H1
  showing"); no 049 requirement changes.

Iterate round 3 (14:46), from the maintainer's report that scrolling an editor or a preview feels laggy and highlighted
text trails a little behind.

- Q: Improve scrolling now, and how? → A: **Now, as round 3**: a preview's find outlines move with the text natively
  rather than being repositioned after each scroll, and an editor's occurrence tints do no work while scrolling;
  measured before and after (FR-029, FR-030, SC-008).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find survives a tab switch (Priority: P1)

A user searches a Markdown preview, switches to another tab to check something, and comes back. The search is
exactly as they left it: the same matches are highlighted, the count names the match that is marked as current,
and Next / Previous keep stepping through them.

**Why this priority**: Today the find bar misreports the document after every tab switch — it claims a current
match that is not shown, then says the text does not exist. A user who trusts "No results" wrongly concludes the
text is absent. It is a correctness defect in a shipped feature (#456).

**Independent Test**: Search a preview for a word with several matches, switch tabs and back, press Next; the
highlights are present and Next advances to the following match.

**Acceptance Scenarios**:

1. **Given** a preview with an open find bar showing `2 of 5` with matches highlighted, **When** the user switches
   to another tab and back, **Then** all five matches are highlighted, the second is marked current, and the bar
   still reads `2 of 5`.
2. **Given** the same restored search, **When** the user presses Next, **Then** the third match becomes current
   and the bar reads `3 of 5`; it never reports "No results" while matches exist in the document.
3. **Given** an editor panel with an open find bar, **When** the user switches tabs and back, **Then** the editor's
   search is restored in the same way.
4. **Given** a preview whose source file changed while its tab was hidden, **When** the user returns, **Then** the
   search is re-run against the new content and the count and highlights describe the document as it now is.
5. **Given** a preview or editor with an open find bar showing `2 of 5`, **When** the user drags the panel to another
   tab, into a split, or into a sub-workspace window, **Then** in its new place the bar still reads `2 of 5` with all
   five matches highlighted and the second current.
6. **Given** any panel, **When** the user drags it into another tab, into a split, or to a new position in its own
   tab, **Then** that tab shows, the dropped panel is its active panel, and keyboard focus is inside the dropped
   panel — typing goes to it (FR-000b).

---

### User Story 2 - Find reveals a match inside a collapsed section (Priority: P1)

A user searches a long Markdown document in which most sections are collapsed. When a match inside a collapsed
section becomes the current match — while typing, or on Next / Previous — the section opens so the match is
visible and marked.

**Why this priority**: The find bar counts a match the user cannot see, so on a mostly-collapsed document find is
effectively unusable. Required already for previews by 047 and not delivered; the editor must behave the same
way (#455).

**Independent Test**: Collapse a section, search for a word that occurs only inside it; the section expands and
the match is highlighted, in both a preview and an editor.

**Acceptance Scenarios**:

1. **Given** a preview with a collapsed section containing the only match for a query, **When** the user types the
   query, **Then** the section expands and the match is visible and marked current.
2. **Given** a match inside a collapsed section that is itself nested in a collapsed section, **When** it becomes
   current, **Then** every collapsed ancestor containing it expands too.
3. **Given** several matches, some in collapsed sections, **When** the user presses Next / Previous, **Then** each
   section expands at the moment its match becomes current, and not before.
4. **Given** a Markdown editor with a folded range containing a match, **When** that match becomes current,
   **Then** the folded range unfolds so the match is visible.
5. **Given** a section expanded by find, **When** the user moves on to a match elsewhere, **Then** the section stays
   expanded; find never collapses a section.
6. **Given** an editor in which some matches lie inside folded ranges, **When** the user presses Replace All,
   **Then** they are asked whether to replace and unfold, replace and keep folded, or cancel, and the outcome
   matches the choice; with no folded matches, Replace All runs without asking.

---

### User Story 3 - Shared vocabulary for "this text matches" (Priority: P2)

Search matches and selection occurrences (User Story 4) read as one visual language: a soft tint means *another
instance*, and the strong tint with an outline means *the one in question*. The find bar's current appearance is
unchanged on every bundled theme.

**Why this priority**: It is the precondition for User Story 4 shipping without introducing a second,
independently-invented soft tint that a user cannot tell apart from search matches (#325). It changes nothing the
user can see on its own, so it ranks below the defects.

**Independent Test**: On every bundled theme, the find bar's ordinary-match, current-match and current-match
outline colours are identical before and after the change, and the selection-occurrence tint is produced by the
same derivation.

**Acceptance Scenarios**:

1. **Given** any bundled theme, **When** a search runs, **Then** the ordinary-match, current-match and outline
   colours are exactly the values shipped before this feature.
2. **Given** a range that is both a search match and a selection occurrence, **When** both are live, **Then** the
   search-match treatment is the one painted, as the rule in FR-013 states.
3. **Given** any bundled theme, including English Garden, Matrix, Snake and VI-VIM, **When** a search runs, **Then**
   the current match is told apart from the other matches at a glance by its fill and by a 2 px outline
   (FR-009a, FR-009b).
4. **Given** any bundled theme, **When** focus leaves a panel holding a selection, **Then** the inactive selection is
   clearly visible against the page (FR-025a).
5. **Given** a long preview with find open, **When** the user scrolls it quickly, **Then** every match outline stays
   on its text throughout the scroll (FR-029).
6. **Given** a long editor with a selection's occurrences tinted and find open, **When** the user scrolls it,
   **Then** scrolling is as smooth as with no selection and find closed, and the tints and outlines move with their
   text (FR-030, SC-008).

---

### User Story 4 - See other instances of the selected text (Priority: P2)

A user selects a word in an editor or a Markdown preview. Every other instance of that text in the document is
softly tinted, so they
can see where else it appears without opening a search. The tint is a visual aid only: nothing else is selected,
and no keystroke acts on the tinted text.

**Why this priority**: A standard editor affordance whose absence is noticed daily, but not a defect (#324).

**Independent Test**: Select a word that occurs four times; the other three are tinted more softly than the
selection, syntax colours remain visible through the tint, and clearing the selection removes it.

**Acceptance Scenarios**:

1. **Given** an editor, **When** the user selects a run of text that occurs elsewhere in the document, **Then** every
   other occurrence is tinted.
2. **Given** a tinted occurrence, **When** the user compares it with the selection, **Then** the tint is visibly
   weaker than the selection highlight.
3. **Given** a tinted keyword, **When** the user looks at it, **Then** its syntax colour is still visible through the
   tint.
4. **Given** tinted occurrences, **When** the user clears the selection or selects something else, **Then** the old
   tints disappear (and are replaced by the new selection's, if any).
5. **Given** tinted occurrences, **When** the user types, deletes or presses any editing key, **Then** only the
   selection is affected; the tinted occurrences are not.
6. **Given** the occurrence-highlighting setting is turned off, **When** the user selects text, **Then** no
   occurrences are tinted.
7. **Given** a Markdown preview, **When** the user selects a word that occurs elsewhere in the rendered document,
   **Then** every other occurrence in the rendered text is tinted, in the same colour an editor uses.

---

### User Story 5 - Keep a selection visible after focus moves away (Priority: P3)

A user selects text in a preview or an editor, then clicks into a terminal to type a command about it. The
selection stays visible in a muted *inactive* colour until they change the selection in that panel. Returning
focus without changing anything makes it the active selection again, and Copy copies it.

**Why this priority**: Improves orientation when moving between panels, but users can work without it (#457).

**Independent Test**: Select a word in a preview, click into a terminal; the word stays highlighted in the inactive
colour. Click back without moving the caret, press Copy; the word is on the clipboard.

**Acceptance Scenarios**:

1. **Given** a word selected in a preview, **When** focus moves to another panel, **Then** the word stays highlighted
   in the inactive-selection colour.
2. **Given** a word selected in an editor, **When** focus moves to another panel, **Then** the word stays highlighted
   in the inactive-selection colour rather than the active one.
3. **Given** a retained inactive selection, **When** the user returns focus to that panel without clicking inside
   its content or moving the caret, **Then** the selection is active again and Copy copies exactly that text.
4. **Given** a retained inactive selection, **When** the user clicks or selects elsewhere inside that panel, **Then**
   the retained highlight is replaced by the new caret or selection.
5. **Given** two panels each holding a selection, **When** either has focus, **Then** only the focused one renders at
   active strength; the other renders its selection inactive and its occurrence tints at the weaker inactive
   strength.
6. **Given** a retained selection in a preview, **When** the user selects text in a different panel, **Then** the
   preview's retained selection is still shown.
7. **Given** a selection in a preview or editor, **When** the user switches to another tab and back without the
   document changing, **Then** the same text is still selected, shown inactive until the panel takes focus.

---

### User Story 6 - A panel moved to another window keeps its place (Priority: P2)

A user is halfway down a long file in an editor, with a few lines selected, and a terminal scrolled back to read
earlier output. They tear both panels off into a sub-workspace window. In the new window the editor shows the same
caret, selection and scroll position, and the terminal is still scrolled back to the same output with the same
text selected.

**Why this priority**: Today both panels jump back to the top (or to the live end of the terminal) when they change
window, so a tear-off costs the user their place. It is the same rule as User Stories 1 and 5 — a loaded panel
keeps its state — applied to state this feature does not otherwise touch (constitution XI, v5.9.0).

**Independent Test**: Scroll an editor and a terminal, select text in each, move both into a sub-workspace window;
each shows the same position and selection as before.

**Acceptance Scenarios**:

1. **Given** an editor scrolled to line 500 with a caret and selection, **When** the panel is moved into a
   sub-workspace window, **Then** it shows line 500 with the same caret and selection.
2. **Given** a terminal scrolled back through its output with some text selected, **When** the panel is moved into
   a sub-workspace window, **Then** it shows the same output at the same scroll position with the same text
   selected.
3. **Given** either panel moved back from the sub-workspace window into the main window, **Then** the same holds.

### Edge Cases

- **Tab switch with a closed find bar**: nothing is restored or re-run; a closed find bar stays closed.
- **Content changed under a hidden search** (preview re-render or external edit): the search re-runs on return;
  if the previously current match no longer exists, the nearest following match becomes current, or the count
  reads zero.
- **Find across a fold with no matches outside folds**: the count includes folded matches (047), and the first one
  expands only when it becomes current.
- **Replace inside a collapsed section** (editor): a single Replace reveals the match before replacing it, so the
  user sees what changes; Replace All asks first (FR-007a).
- **Occurrence highlighting on noise**: no tint for an empty selection, a whitespace-only selection, a selection
  spanning more than one line, or a selection shorter than two characters.
- **Very large documents**: the occurrences on screen are tinted within 100 ms (SC-005); occurrences off screen are
  tinted by the time they are scrolled into view. Tinting never blocks typing or scrolling.
- **Find bar focused**: focusing the editor's own find bar makes the editor's selection inactive; the search's own
  current-match treatment is unaffected.
- **Retained preview selection after a re-render that changes the text under it**: the retained selection may be
  dropped; a stale highlight over different text is never shown.
- **Terminal panels**: excluded from inactive-selection and occurrence highlighting; the terminal keeps its own
  selection model, which FR-000a carries across a window move unchanged.
- **Terminal output arriving during a move**: output that arrives while the panel moves windows MUST NOT be lost,
  and MUST NOT pull a scrolled-back terminal to the live end.

## Requirements *(mandatory)*

### Functional Requirements

**Panel state lifetime**

- **FR-000**: A loaded panel's state — for this feature, its find session (query, options, current match and
  highlights) and its retained selection with that selection's occurrence tints — MUST NOT change when the panel is
  hidden by a tab switch, dragged, resized, split, moved to another tab, synced into a sub-workspace, or moved to
  another window, even where the move rebuilds the panel's content. That state is lost only when the panel is
  unloaded: closed or destroyed, its project unloaded, or the app quit. Wherever this spec says "tab switch", every
  event listed here is meant.
- **FR-000a**: FR-000 MUST also hold for two kinds of view state this feature does not otherwise change, which today
  survive a move within a window but are lost on a move to another window: an editor panel's caret, selection and
  scroll position, and a terminal panel's scroll position (how far back the user has scrolled) and its selection.
  After any move to another window, an editor MUST show the same caret, selection and scroll position, and a
  terminal the same scroll position and selection, as before the move. (Constitution XI, "A loaded Panel keeps its
  state", v5.9.0.)
- **FR-000b**: A panel dropped by a drag — into another tab, into a split, or at a new position in its own tab — MUST
  become its tab's active panel, and keyboard focus MUST move into it: to the control inside it that last held focus,
  else its first focusable control, as constitution XI's "Focus follows the active Panel" gives a keyboard route. The
  dropped panel's tab is the one shown. (Clarification 2026-10-02.)

**Find state across tab switches (#456)**

- **FR-001**: A preview's or editor's open find bar MUST, when its panel becomes visible again after a tab switch or
  any other event in FR-000, present the same query, the same current match and highlights for every match in the
  document as displayed.
- **FR-002**: The match count and current-match position the find bar shows MUST always describe the document as it
  is displayed; it MUST NOT report "No results" while the displayed document contains a match for the query.
- **FR-003**: If the panel's content changed while it was hidden, the search MUST re-run against the new content on
  return, keeping the current match where it still exists and otherwise moving to the nearest following match.

**Find across folds (#455)**

- **FR-004**: When a match inside a collapsed preview section becomes the current match — while the query is typed or
  on Next / Previous — the section containing it and every collapsed ancestor MUST expand so the match is visible.
  (Restates 047 US1 scenario 7, which this feature delivers.)
- **FR-005**: The same MUST hold for a folded range in an editor panel, including a range folded by section folding
  (047 US3).
- **FR-006**: Find MUST expand only the sections needed to show the current match, at the moment it becomes current,
  and MUST NEVER collapse a section.
- **FR-007**: A single Replace acting on a match inside a folded range MUST reveal that match before replacing it.
- **FR-007a**: When Replace All would change at least one match inside a folded range, the user MUST first be asked
  to choose one of: **replace and unfold** (every folded range containing a replaced match is expanded),
  **replace and keep folded** (all matches are replaced and every fold is left as it was), or **cancel** (nothing is
  replaced and nothing is unfolded). The prompt MUST be modal and fully operable from the keyboard. When no match
  is folded, Replace All MUST proceed without asking.

**One match vocabulary (#325)**

- **FR-008**: Search matches and selection occurrences MUST be coloured from a single derivation of match surfaces
  per theme, rather than from two independent derivations.
- **FR-009**: The existing search surfaces — ordinary match, current match and current-match outline — MUST keep
  their exact shipped values on every bundled theme. *(Superseded 2026-10-02 by FR-009a and FR-009b for the
  current-match fill, the ordinary-match fill where the floor needs it to move, and the outline; it still holds for
  every theme whose surfaces already meet FR-009a.)*
- **FR-009a**: On every bundled theme, the current-match fill MUST sit at least ΔE00 9.0 from the ordinary-match
  fill, while every other match-surface requirement (FR-011's syntax contrast, 043 FR-067's surface-from-page
  floor) still holds. A theme already clearing 9.0 keeps its shipped values. This raises 043 FR-067's 3.0 floor for
  that one pair; its two surface-to-page pairs keep 3.0. (Clarification 2026-10-02.)
- **FR-009b**: The current search match's outline MUST be drawn 2 px wide, in editors and previews, and MUST
  contrast at least 3:1 with both the page and the current-match fill on every bundled theme. The ordinary-match
  outline is unchanged. (Clarification 2026-10-02.)
- **FR-010**: A soft tint MUST mean *another instance* on every surface that uses it; the strong tint with an outline
  MUST be reserved for the current search match.
- **FR-011**: Every match surface MUST compose beneath the syntax layer and satisfy 016 FR-007a's contrast guard on
  every bundled theme.
- **FR-012**: Any new colour token this feature introduces MUST be exposed in the Themes editor (013 FR-019,
  configuration-editor completeness), with a value on every bundled theme.
- **FR-013**: Where one range is both a search match and a selection occurrence, the search-match treatment MUST be
  painted and the occurrence tint MUST NOT be painted on that range — the two are never layered. This precedence MUST be stated once and asserted by a test, not left to the order in which surfaces are
  applied.

**Selection occurrences (#324)**

- **FR-014**: In an editor panel or a Markdown preview panel, a non-empty selection MUST softly tint every other
  occurrence of the selected text in that panel's document — the source text in an editor, the rendered text in a
  preview — using the same selection-occurrence surface in both.
- **FR-014a**: In a preview, occurrences MUST be matched against the same rendered text that preview find searches
  (047): text is read continuously across formatting boundaries, so a word whose letters are split across inline
  formatting (a bold "i" followed by "d") is one occurrence of "id", and anything preview find excludes as not
  content is excluded here too.
- **FR-014b**: A panel MUST tint occurrences of its own selection only. A selection in one panel MUST NOT tint
  anything in another panel, including another editor or preview showing the same file.
- **FR-015**: Occurrence matching MUST be literal and case-sensitive. When the selection is a whole word — it starts
  and ends at a word boundary — only occurrences that also start and end at a word boundary MUST be tinted;
  otherwise every literal occurrence MUST be tinted. A word character is a letter, digit or underscore; every
  other character, and the start or end of a line, is a word boundary (so `-` and `.` are boundaries). Selecting
  `id` therefore tints `id`, `-id`, `id.` and `some-id-word`, and does not tint `width`, `valid` or `id_x`. Nothing
  MUST be tinted for a selection that is whitespace-only, spans more than one line, or is shorter than two
  characters.
- **FR-016**: The occurrence tint MUST be visibly weaker than the selection highlight.
- **FR-017**: Occurrences MUST be a visual aid only: they MUST NOT be selected, navigated to or acted on by any
  keystroke or command.
- **FR-018**: Clearing or changing the selection MUST clear the previous selection's occurrence tints at once.
- **FR-018a**: While a panel holding a retained selection is unfocused, its occurrence tints MUST remain but be
  painted with an inactive-occurrence tint that is visibly weaker than the focused panel's occurrence tint; when the
  panel regains focus they MUST return to full strength. The inactive-occurrence tint MUST come from the same match
  derivation as every other match surface (FR-008), compose beneath the syntax layer (FR-011) and be exposed as a
  token (FR-012). It follows the same precedence as the occurrence tint (FR-013).
- **FR-019**: Occurrence highlighting MUST be governed by a single user setting that covers both editor and Markdown
  preview panels, on by default, editable in Preferences, and MUST take effect in every open editor and preview
  without a reload.
- **FR-020**: Occurrence tinting MUST NOT delay typing, caret movement or scrolling in any document an editor or
  preview accepts, and MUST meet SC-005's 100 ms target for the occurrences on screen.

**Inactive selection (#457)**

- **FR-021**: When focus leaves a preview or editor panel that holds a non-empty selection, the selection MUST stay
  visible in an inactive-selection colour.
- **FR-022**: A retained selection MUST persist until the user changes the caret or selection inside that panel,
  and MUST survive a selection made in another panel and every event in FR-000 — in previews as well as editors,
  even where the event rebuilds the panel's content. FR-026 governs the case where the text under it changed.
- **FR-023**: Returning focus to the panel without changing the caret or selection MUST make the retained selection
  active again, and Copy MUST then copy exactly its text.
- **FR-024**: Only the focused panel MAY show a selection at active strength; every other panel holding a selection
  MUST show it inactive.
- **FR-025**: The inactive-selection colour MUST be a theme token whose value on every bundled theme is produced by
  one derivation from that theme's active selection colour — never hand-listed per theme — and which the user can
  override in the Themes editor. The derived value MUST be distinct from the active selection and from every match
  surface, and MUST pass the theme contrast and distinctness guards on every bundled theme.
- **FR-025a**: The derived inactive-selection colour MUST sit at least ΔE00 9.0 from the page on every bundled
  theme, with FR-025 still holding (distinct from the active selection and every match surface, guards passed).
  (Clarification 2026-10-02.)
- **FR-026**: A retained preview selection whose underlying text changes on re-render MAY be dropped, but MUST NOT be
  shown over text other than what was selected.
- **FR-027**: Terminal panels are out of scope for FR-014–FR-026; they are in scope only for FR-000a.

**Documentation**

- **FR-028**: The occurrence-highlighting setting and every new theme token MUST be documented in their home docs in
  the same change (`docs/preferences.md`), per the documentation-currency gate.

**Scrolling (iterate round 3)**

- **FR-029**: A preview's find-match outlines MUST stay on their text during a scroll: no frame may show an outline
  away from the match it frames. Scrolling MUST NOT re-measure or re-position the outlines; they are redrawn only
  when the layout under them changes (a draw, a fold, a resize, a zoom). (Clarification 2026-10-02.) *[derived,
  research R14: outlines are drawn for a band three viewports either side of the visible area, and a scroll that
  leaves the band redraws it once — about once per three viewports, never per frame — so a one-letter query on a
  long document does not create an outline for every match up front. Within the band, scrolling does no work.]*
- **FR-030**: Scrolling an editor MUST NOT recompute or rebuild its occurrence tints; they are recomputed only when
  the selection, the document, the find matches or the focus change. (Clarification 2026-10-02.)

### Key Entities

- **Match surface**: a named highlight treatment (ordinary match, current match, current-match outline, selection
  occurrence, inactive selection occurrence) with a colour derived per theme from one function and a fixed meaning.
- **Find session**: a panel's open find bar — its query, options, match set and current-match index — which outlives
  a tab switch and is reconciled with the displayed content.
- **Retained selection**: a panel's last selection, kept while the panel is unfocused, cleared by any caret or
  selection change in that panel.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After any number of tab switches, a preview or editor find bar's count, current match and highlights
  agree with the displayed document in 100% of trials; "No results" is never shown while a match exists.
- **SC-002**: A current match inside any number of nested collapsed sections is visible on screen in 100% of cases,
  in both previews and editors, without the user expanding anything by hand.
- **SC-003**: On every bundled theme, the three existing search-surface colours are byte-identical to their values
  before this feature.
- **SC-004**: On every bundled theme, syntax tokens painted over every match surface and the inactive selection meet
  the existing contrast floor.
- **SC-005**: In a 10,000-line document, in an editor or a preview, the occurrence tints on screen appear within
  100 ms of the selection changing, and keystroke-to-screen latency while typing is no greater with occurrence
  highlighting on than with it off.
- **SC-006**: A user can select text in a preview, work in a terminal, return and copy the same text without
  reselecting it.
- **SC-007**: After a move to another window, editors and terminals show the same scroll position and selection
  (and an editor the same caret) as before the move in 100% of trials.
- **SC-003a**: On every bundled theme, the current-match fill measures at least ΔE00 9.0 from the ordinary-match
  fill, and the inactive selection at least ΔE00 9.0 from the page. Supersedes SC-003 wherever a theme had to move
  to meet it.
- **SC-008**: Scrolling a 10,000-line editor and a 10,000-line preview with find open and a selection's occurrence
  tints showing spends no scripting time on outlines or tints, and its frame times are no worse than with find
  closed and occurrence highlighting off — measured in the real app before and after the change.

## Assumptions

- The occurrence-match rules in FR-015 are fixed, not configurable.
- The Replace All prompt in FR-007a is a choice, not a destructive-action confirmation, so it has no
  `confirmations.*` setting and no "don't ask again" option.
- Editor panels share #456's defect: an audit on 2026-10-01 found both the editor and preview find engines start
  with an empty query when their view is rebuilt, while the stored session still shows the old query and count.
  FR-001–FR-003 cover both panel types.
- The contrast of the active `editorSelection` colour against syntax tokens (#105) stays out of scope, as 019 C5
  decided; the new inactive-selection token is guarded because this feature introduces it.
- Panel state in FR-000 is transient: it is not persisted, so it does not survive the panel being unloaded or the
  app restarting.
