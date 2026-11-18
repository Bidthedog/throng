# Specification Quality Checklist: Markdown preview extensions — callouts, math and printing

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-18
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

## Clarifications resolved (session 2026-11-18)

| # | FR | Question | Maintainer's answer |
|---|---|---|---|
| Q1 | FR-072 | Which colours does printed output use? | **B** — throng's own private, fixed print stylesheet, seeded from the shipped Light theme, separate from every theme |
| Q2 | FR-074 | Do collapsed sections and callouts print expanded or as shown? | **A** — always expanded; the full document prints |
| Q3 | FR-071 | Where does print preview open? | **B** — its own throng window, one at a time, modal to the window that opened it |
| Q4 | FR-064 | What does Print… (Ctrl+P) do? | Opens Print Preview; nothing prints before it is shown; its Print button prints with the settings chosen there, no OS dialog |
| Q5 | FR-016 | Keep or disable ` ```ad-<type> ` fences? | **A** — disabled, ordinary fenced code; out of scope |

## Notes

- All five markers resolved in the spec's Clarifications section, with every affected FR, story, edge case and
  success criterion rewritten.
- Maintainer direction in the same session superseded the draft's session-only print settings: they persist
  across sessions in a state file in the data directory (FR-070), still not a preference.
- Defaults recorded in the spec (not asked): Typeset math ships **on**; one **Print…** command, no separate
  Print Preview… command; a second Print… focuses the open Print Preview window; Find skips typeset equations; a
  callout icon is one key per canonical type; callout folding is not touched by Collapse All / Expand All.
