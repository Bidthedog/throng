# Specification Quality Checklist: Clickable File Links

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-17
**Updated**: 2026-09-18 (both clarifications answered and folded in)
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

- **Iteration 2 (2026-09-18): every item passes.** The maintainer answered both questions, so the two
  markers are gone:
  - **Executables (Question 1, answer A)** — FR-039 and FR-039a. Ctrl+click, the Open Link chord and
    the plain Open Link item never run an executable; they reveal it in the OS file manager instead.
    Only the explicit Open in OS Default Program item runs it. FR-039a states the classification rule
    (`PATHEXT`, read when the decision is made, plus a declared handler-launched set), places it
    behind the platform abstraction, and puts a contract test on it. Acceptance scenarios: US4.6 and
    US5.6–US5.7. SC-010.
  - **Hyperlink advertising (Question 2, answer A)** — FR-080 – FR-080d. `FORCE_HYPERLINK=1` on a new
    terminal, never over a value the user set in either direction, off through a setting shipped on,
    applying to terminals started afterwards and not to running ones, and still no `WT_SESSION` or
    borrowed `TERM_PROGRAM`. Acceptance scenarios: US7.1–US7.5. SC-011.
- **Implementation details, a deliberate exception.** Requirements name no framework or API. The
  *Background*, *Supersessions* and *Dependencies* sections do cite source and test files by path and
  line (for example `terminal-link-menu.test.ts:20` and `open-router.ts`). The repo's CLAUDE.md
  requires this: a supersession must name the requirement it replaces and the tests it permits to
  change. Spec 044 follows the same practice. FR-039a and FR-080 name environment variables and
  extensions because they are the observable interface to the OS and to third-party programs, not an
  implementation choice — and both requirements say the naming lives behind the platform abstraction,
  not in `@throng/core`.
- **Citations checked against the source text on 2026-09-17:**
  - 024 FR-019, FR-019a–d, FR-018c, and the US7 edge cases;
  - 023 FR-019, FR-022, FR-024, FR-025, FR-026;
  - 033 FR-053, which is a label freeze scoped to 033's own pass, and does not define "Open in OS
    Explorer";
  - 044 FR-005, FR-015, FR-033, FR-050–FR-055, FR-062, FR-071, FR-090–FR-096c, FR-116;
  - 025's live working-directory seam;
  - 031's bounds on the link hover delay;
  - constitution v5.5.0, Principles II, III, IV and VI.
- **Behaviour with no governing requirement, found in code and recorded rather than silently
  shadowed:**
  - Editor Ctrl+click adds a cursor, the editor library's default (FR-041).
  - Editor Ctrl+Enter inserts a blank line, from the editor's default keymap (FR-044).
  - Terminal Ctrl+Enter's modified-Enter encoding comes from the #90 fix, and no spec owns it
    (FR-046).
- **Ready for `/speckit-plan`.** No `/speckit-clarify` pass is outstanding.
