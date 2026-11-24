# Feature Specification: Preferences grouping and ranked search

**Feature Branch**: `feature/S079-I270-I319-preferences-grouping-and-search`

**Created**: 2026-11-24

**Status**: Draft

**Input**: Issues [#270](https://github.com/Bidthedog/throng/issues/270) (rank preferences search
results, and require every word to match) and [#319](https://github.com/Bidthedog/throng/issues/319)
(one sub-grouping convention per registry). Both are v1.0.0 Tweaks, in scope under the v1.0.0 feature
freeze: they change how existing preferences behave and add nothing new.

## Clarifications

### Session 2026-11-24

- Q: The Themes registry's button family sits two levels deep (`General · Buttons · Confirm` /
  `· Cancel` / `· Destroy`). How does it move onto the heading fields? → A: **Nest it with the levels
  that already exist.** `General` → subgroup `Buttons` → subsections `Confirm`, `Cancel`, `Destroy`.
  `subsection` (054 FR-050a) is already drawn by all three tabs, so this needs no renderer change and
  keeps today's hierarchy. (The maintainer first picked flattening to four subgroups, when the
  question wrongly said a second level would cost renderer work. They chose again once that was
  corrected.)
- Q: Where does a subgroup match rank? → A: **Between name and value.** From the maintainer's comment on
  #270: a subgroup heading is a weaker signal than a field's own name, and a stronger one than its value.
  It is also the only field that matches a heading the user is looking at.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The best match comes first (Priority: P1)

A user searches Preferences by typing the name of the setting, key binding or theme token they want.
Today extra words widen the results, and the order is registry order, so the full name, which is the
strongest signal a user can give, gives the worst result. After this change, every word must match,
and the closest match is at the top.

**Why this priority**: This is the whole of #270, and it is the change users will notice in all three
tabs.

**Independent Test**: In Key Bindings, type `go to line` and check that **Go To Line** is the first row
of the first section. Unit tests over the shared search module cover the full ladder.

**Acceptance Scenarios**:

1. **Given** the Key Bindings tab, **When** the user types `go to line`, **Then** **Go To Line** is the
   first result in the first group.
2. **Given** fields named **Go To Line**, **To Go Away** and **Go Away**, **When** the user types `Go to`,
   **Then** the first two are shown and **Go Away** is not.
3. **Given** a field whose name partly matches the query and another whose value exactly equals it,
   **When** the user searches, **Then** the name match ranks above the value match.
4. **Given** two fields that match in the same tier, **When** one contains the query as a phrase and the
   other only holds the words apart, **Then** the phrase match ranks first.
5. **Given** a query whose only hit in a field is mid-word (`to` inside `Auto`), **When** the user
   searches, **Then** that field is still shown, but below every field where the words start at word
   boundaries.
6. **Given** two sections whose best results tie, **When** the results show, **Then** the sections are
   listed alphabetically.
7. **Given** an empty search box, **When** the tab shows, **Then** every field is listed in registry
   order, with sections in registry order, exactly as today.

---

### User Story 2 - One way to sub-group a theme (Priority: P2)

A user browsing the Themes tab sees every theme area as one section, with any nested blocks
(`Syntax` under Editor, `Buttons` under General with Confirm, Cancel and Destroy inside it,
`File Icons` under File Explorer, `Callouts` under Markdown preview) drawn as subsections of it. They
are no longer drawn as separate sections that only look adjacent. The registry expresses
sub-grouping one way, so the next feature adding a nested block has one convention to follow.

**Why this priority**: #319. Nothing is broken today. The change removes a second convention, and it
changes which headings the user sees and folds.

**Independent Test**: Open the Themes tab. Editor shows a `Syntax` subgroup, and General shows a
`Buttons` subgroup with `Confirm`, `Cancel` and `Destroy` subsections inside it. The rows appear in
the same order as today.

**Acceptance Scenarios**:

1. **Given** the Themes tab, **When** it opens, **Then** `Editor`, `General`, `File Explorer` and
   `Markdown preview` each appear once as a section, and their nested blocks appear as subgroups of
   that section.
2. **Given** the General section, **When** it is expanded, **Then** the `Buttons` subgroup holds the
   base button tokens followed by the `Confirm`, `Cancel` and `Destroy` subsections, in that order.
3. **Given** any theme, **When** the Themes tab lists its tokens, **Then** the order of token rows from
   top to bottom matches today's order.
4. **Given** the Themes tab, **When** the user searches for `syntax` or `buttons`, **Then** the whole
   matching subgroup is returned.

---

### Edge Cases

- **A query made only of whitespace** is the empty query and lists everything in registry order.
- **Repeated words** (`line line`) count once each for inclusion. Ranking reads the query as typed, so
  `line line` matches no field's text as a phrase.
- **A query that matches only through the combined text of several fields** (one word in the name,
  another in the description) is included and ranks in the lowest tier.
- **A section name typed as the query** returns the whole section (021 FR-015). Its fields rank in the
  group tier, below any field that matches the same words in its name, subgroup, value or description.
- **The Themes tab's icon-pack row** is matched by the same shared rules, so it is included or left out
  by the AND rule like any other field.
- **A fold choice the user made on a theme heading that this feature renames** (for example a folded
  `Editor · Syntax` section) no longer names a heading, so it is ignored (056 FR-011a). The new heading
  opens at its default, and the stale entry is pruned on the next write.
- **A settings file, key bindings file or theme file written before this change** loads with every value
  intact. No key changes.

## Requirements *(mandatory)*

### Functional Requirements

#### Matching (#270)

- **FR-001**: The search shared by the Settings, Key Bindings and Themes tabs MUST include a field only
  when **every** whitespace-separated word of the query appears, case-insensitively, as a substring of
  the field's searchable text. The searchable text is the field's key, name, description, section
  headings (group, subgroup, subsection) and current value, rendered as text.
- **FR-002**: Word order and adjacency MUST NOT affect whether a field is included. They affect only
  its rank (FR-004).
- **FR-003**: An empty query, or one made only of whitespace, MUST list every field in registry order,
  with sections in registry order, unchanged from today.

#### Ranking (#270)

- **FR-004**: For a non-empty query, matching fields MUST be ordered by three keys, applied in turn:
  1. **Field tier**: the highest single field that contains every word. The tiers, best first:
     **name** (the field's label, or its key when the query is exactly the key), **subgroup** (its subgroup or subsection heading),
     **value** (its current value, rendered), **description**, **group** (its full heading path:
     group, subgroup and subsection read together), and **split**, where no single field holds every
     word and the query is satisfied only across fields.
  2. **Exactness** within that field's text, best first: the text **equals** the query; the query is a
     **phrase at the start**; the query is a **phrase anywhere**; every word appears **at a word
     boundary**, not contiguously; at least one word matches **only mid-word**.
  3. **Registry order**, as the tie-break.
- **FR-005**: The field tier MUST dominate exactness. A partial match in a higher tier ranks above an
  exact match in a lower one.
- **FR-006**: Exactness MUST compare case-insensitively, and MUST read runs of whitespace in the query
  and in the field text as one space.

#### Sections (#270)

- **FR-007**: A ranked result MUST stay in its own section. Sections are never split or merged by
  ranking.
- **FR-008**: For a non-empty query, a section's position MUST be set by its best-ranked field, and
  sections whose best fields tie MUST be listed alphabetically by section name. The same rule MUST
  order the subgroups within a section and the subsections within a subgroup.
- **FR-009**: At each level, a heading's own fields MUST come first and then its sub-headings (FR-016).
  Within each heading, fields MUST be listed in FR-004 order. A better-ranked field in a subgroup
  still sits below its section's own fields.
- **FR-010**: Typing a section, subgroup or subsection name MUST still return every field under that
  heading (021 FR-015). Those fields rank in the group tier unless they also match in a higher one.

#### What stays the same (#270)

- **FR-011**: The debounce, the inline reset (×), hidden empty sections and the no-match empty state MUST
  behave exactly as today (007 FR-049).
- **FR-012**: The ranking MUST be implemented once, in the shared search module, and all three tabs and
  the Themes icon-pack row MUST use it. No tab carries its own copy.

#### One sub-grouping convention (#319)

- **FR-013**: The theme registry MUST express every nested block with the heading fields (subgroup and
  subsection), and MUST NOT use a `"<Area> · <Sub>"` section string. After this change, no theme
  descriptor's group contains ` · `.
- **FR-014**: The nested blocks MUST map as follows:

  | Today (section string) | After |
  |---|---|
  | `Editor · Syntax` | section `Editor`, subgroup `Syntax` |
  | `General · Buttons` | section `General`, subgroup `Buttons` |
  | `General · Buttons · Confirm` / `· Cancel` / `· Destroy` | section `General`, subgroup `Buttons`, subsection `Confirm` / `Cancel` / `Destroy` |
  | `File Explorer · File Icons` | section `File Explorer`, subgroup `File Icons` |
  | `Markdown preview · Callouts` | section `Markdown preview`, subgroup `Callouts` |

- **FR-015**: The area order (`General` first, `Icons` last) and the button order (the base button
  tokens, then Confirm, Cancel, Destroy) MUST be unchanged. The theme registry MUST list token rows in
  the same order, top to bottom, as before this change.
- **FR-016**: Within each section, the section's own tokens MUST be drawn before its subgroups (040
  FR-036b), and a subgroup's own tokens before its subsections.
- **FR-017**: No theme token key, setting key, key binding id, default value or shipped default MUST
  change, and no new token or setting is added.
- **FR-018**: The guard that rejects a token with no area (021 SC-003) MUST still reject one, and MUST
  still reject a token whose section is outside `THEME_AREA_GROUPS`. Sub-headings are set only by the
  placement rules, so they form no separate set to guard.
- **FR-019**: Where any registry's source documentation describes the `"<Area> · <Sub>"` form as a way to
  sub-group, it MUST be updated to describe the heading fields.

#### Supersessions

- **FR-020**: This spec **supersedes 007 FR-049's OR semantics**, together with its Clarifications entry
  and the OR-vs-AND decision row in 007's plan. Those artifacts MUST carry a note pointing here.
  **Why the reversal:** 007 reasoned that a user recalling a setting from half-remembered words is
  helped when extra words widen the net. That holds for two loose words and fails at three precise ones:
  typing a setting's full name, the strongest signal a user can give, gave the worst result. Ranking
  meets 007's goal of putting the setting the user means within reach, and does it more directly,
  because a loose query still finds the field and a precise one now puts it first.
- **FR-021**: This spec **supersedes 021 FR-028's `General · Buttons · <Type>` grouping** (the 18
  button tokens and their types are unchanged). It also **closes 040 FR-037a/FR-037b's record of two
  coexisting conventions** for the theme registry. The settings registry closed its half in 069
  FR-068. Those FRs MUST carry a note pointing here. So MUST 056's spec where it describes sibling-string
  groups as headings.
- **FR-022**: 021 FR-015 (a section name returns the whole section) MUST be kept, with a note that
  section matches now rank in the group tier.

### Key Entities

- **Searchable field**: one row in a preferences tab. It has a key, name, description, a section
  (group), an optional subgroup and subsection, and a current value.
- **Field tier**: which of a field's texts holds every query word. There are six tiers, from name down
  to split.
- **Exactness**: how closely the query fits that text. There are five rungs, from equality down to
  mid-word.
- **Heading path**: section, subgroup and subsection, read together. The group tier matches against it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Typing the full name of any key binding puts that binding first in the Key Bindings tab.
  This holds for 100% of the shipped default bindings.
- **SC-002**: Typing the full name of any setting or theme token puts that field (or a field with the
  same name) first under its own heading, for 100% of shipped settings and tokens. The first section
  listed holds an exact name match. A field in a subgroup can still sit below its section's own fields
  (FR-009). For example, `quiet time` shows Terminal's own "Command tracking interval", whose
  description holds those words, above the Attention subgroup's "Quiet time". That is the structural
  order 040 FR-036b fixes, and this tweak does not change the renderer.
- **SC-003**: Adding a word to a query never adds results. The results for `a b` are always a subset of
  the results for `a`.
- **SC-004**: With an empty query, all three tabs list exactly the same rows in the same order as before
  this change.
- **SC-005**: The Themes tab's rows appear in the same top-to-bottom order as before this change, for
  every bundled theme.
- **SC-006**: No theme section heading contains `·`, and each theme area appears exactly once as a
  section.
- **SC-007**: Every settings, key bindings and theme file that loaded before this change loads after it
  with every value intact.

## Assumptions

- The ranking is per query and holds no state. It is recomputed on each debounced query, as filtering
  is today, and costs nothing a user would notice across the few hundred rows the largest tab has.
- A field's **key** ranks in the name tier only when the query **is** the key. #270 names the label only,
  but the key is the field's identifier, and a user who types `editor.wordWrap` means that one field. A
  partial key hit counts only in the split tier. Otherwise every `terminals.*` key would tie with a
  label that really begins "Terminal".
- The **Settings** registry needs no regrouping: 069 FR-068 already moved it onto subgroups. It still
  gets the new search.
- The **Key Bindings** registry declares no sub-grouping today and gains none.
- Ranking does not reorder anything when the query is empty, so the curated registry order stays the
  default view.
- When a theme heading is renamed, its saved fold state is not migrated. The old entry is ignored
  under 056 FR-011a's existing rule.
- Out of scope: new settings or tokens, changes to the search box's controls, fuzzy or typo-tolerant
  matching, and highlighting the matched words.
