# Specification Quality Checklist: Tab strip overflow, name limits, and bounded configuration

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-11
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- **Iteration 1 (2026-08-11, `/speckit-specify`)**: 49 functional requirements across 5
  dependency-ordered stories; 10 success criteria; 11 edge cases. Two `[NEEDS CLARIFICATION]`
  markers raised, both scope-changing.
- **Iteration 2 (2026-08-11, `/speckit-specify` validation)**: both markers resolved; 0 remain.
  52 FRs, 13 SCs, 14 edge cases.
  - The show-all list is a **typeahead picker**, built here as a general list-and-choose control.
    The dependency with #219 (Quick Open) runs the opposite way to the original issue comment:
    #219 consumes the picker, so nothing in User Story 3 waits on it (SC-012).
  - A name over the limit is shortened **for display on read** without rewriting what is stored;
    the shortened form persists at the next ordinary layout save (SC-011).
- **Iteration 3 (2026-08-11, `/speckit-clarify`)**: 5 questions asked and answered. 69 FRs, 15 SCs,
  17 edge cases. Checklist 16/16 with no regressions.
  - **Q1 → the strip follows the active tab by any route** (FR-029, FR-029a-b). Was creation-only;
    now covers click, chord, picker, dwell-activate, layout restore and destruction-of-the-active-
    tab, and explicitly does *not* move when the tab is already fully visible.
  - **Q2 → match semantics fixed** (FR-028c-g). Whitespace-split terms, every term a
    case-insensitive substring, **order-independent**. Matched terms marked; results in strip order
    rather than a relevance score; a no-match query keeps the picker open and says so.
  - **Q3 → one keyboard route** (FR-032a-e). `Ctrl+Alt+T` opens the tab picker, rebindable, works
    at any tab count. Principle IV compliance stated explicitly: neither reserved nor shadowable, so
    the constitution's exception list is unchanged.
  - **Q4 → the guard covers every declared bound, wherever declared, through one generic mechanism**
    (FR-008a-b, FR-009, FR-009a, FR-010). This caught a live gap: `editor.indentByLanguage` declares
    `indentWidth`/`tabWidth` as 1–16 on its *columns*, which the original FR-008 stepped over
    entirely. A malformed entry is dropped rather than invalidating the whole table (SC-004a).
  - **Q5 → smooth-scroll default 500 ms, eased in and out** (FR-030, FR-030a-b, FR-031). A
    constant-speed slide is explicitly not sufficient; 0 remains instant with no easing.
- File paths and package names are deliberately absent from the requirements; the three source
  issues name them, and they belong in `plan.md`.

- **Iteration 4 (2026-08-11, second `/speckit-clarify` pass)**: 5 further questions asked and
  answered. **92 FRs, 18 SCs, 23 edge cases.** Checklist 16/16 with no regressions. All three items
  the previous pass deferred to planning were answered here instead.
  - **Q1 → the close affordance is not always visible** (FR-044a–h). It shows on the active tab and
    on the tab under the pointer, with its space *reserved* on every tab so nothing reflows. This
    resolved a direct conflict with User Story 1: twenty always-on buttons would have spent roughly
    a tab's worth of width in a strip whose defining problem is width. The maintainer added an
    **arming delay** — a hover-revealed X is inert for a configurable period (0–2000 ms, default
    300) so a pointer sweeping the strip cannot destroy a tab in passing. Second Tabs setting.
  - **Q2 → per-entry restore for keyed tables** (FR-008c–f). Closes the hole the previous pass
    opened: FR-008b's "drop the malformed entry" could empty `editor.indentByLanguage`, which its
    own descriptor says has no valid empty state. A dropped entry is now restored from the shipped
    default *for its key*; an entry the user invented themselves is simply dropped; and a table the
    user deliberately emptied is never repopulated, because absence is an answer and malformation
    is not.
  - **Q3 → one writer, corrections on every read** (FR-013a–d, FR-014). Correction happens in every
    process on every read including reloads; write-back happens only from the process that already
    owns settings writes, serialised with its other writes, and converges after one write rather
    than oscillating.
  - **Q4 → the shortened value is a hard cut, the ellipsis is render-time only** (FR-037a–d). Keeps
    truncation idempotent and stops ellipses accumulating in stored data across successive limit
    reductions.
  - **Q5 → grapheme clusters, cut on cluster boundaries** (FR-033a–c). A limit of 10 permits ten
    things the user would point at and call characters, and a cut never leaves a split surrogate
    pair, a halved emoji or an orphaned combining accent.

### A correction worth recording

Mid-pass, "truncation is display values only" was first read as reversing the
persistence rule from iteration 2, and FR-040 was rewritten to say a shortened name never touches
storage. The maintainer clarified it meant *cut on character boundaries so nothing renders broken*.
FR-040 is restored verbatim to the iteration-2 decision — **the stored value is still replaced at
the next ordinary layout save** — and the grapheme rule lives in FR-033a–c where it belongs. No
trace of the reversed wording remains in the spec.

- **Iteration 5 (2026-08-11, third `/speckit-clarify` pass)**: **3** questions asked and answered —
  the loop stopped early because the remaining candidates all had obvious defaults, which were
  written into Assumptions instead of spending questions on them. **108 FRs, 18 SCs, 26 edge cases.**
  Checklist 16/16 with no regressions.
  - **Q1 → a new scroll supersedes the one in flight** (FR-030c–f), starting from where the strip
    currently is, never queueing, always settling once at the most recent — and still-valid — target.
    The maintainer also **revised the smooth-scroll default from 500 ms down to 300 ms** in the same
    breath; every reference in the spec was updated, and the iteration-3 clarification bullet records
    the revision rather than leaving two defaults in the document.
  - **Q2 → the OS reduce-motion preference forces instant scrolling** (FR-031a–d). throng already
    honours it in `theme.css` (twice) and `loading.css`, and E2E-tests it, so an animated strip would
    have been the one moving thing that ignored it. The preference suppresses the motion without
    rewriting the configured value, takes effect live, and never removes the scroll's *outcome*.
  - **Q3 → a character counter appears as a rename nears the limit** (FR-035a–g). Closes the
    silently-swallowed-keystroke trap: the refusal is explained before it happens rather than after,
    counted in the same grapheme units the limit uses, and explicitly *not* an error state. FR-035f
    also settles what a rename field does when opened on a name already longer than the limit —
    committing applies the limit, so a rename cannot reintroduce an over-long name.

### Settled as assumptions rather than questions (low impact, obvious defaults)

- The picker lists **its own window's** tabs — each window has its own strip.
- The picker **follows the tabs while open**; a tab created or destroyed elsewhere updates the list
  in place rather than closing it.
- The fade sits **under** the tab-action controls and the New Tab button, which are pinned outside
  the scrolling region.

### Deferred to `/speckit-plan`

- **Where the name limit applies for panels.** #218 landed a single resolved display-name rule; the
  plan should confirm that is the one chokepoint FR-037 needs.
- **Which process owns settings writes.** FR-013b requires exactly one and names it by role rather
  than by name; the plan identifies it.
