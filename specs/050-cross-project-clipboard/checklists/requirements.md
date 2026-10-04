# Specification Quality Checklist: Cross-Project Clipboard

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-02
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

- 2026-10-02: cut-paste clash → refuse. Superseded 2026-10-03 by the clash prompt (FR-017 – FR-018e), which
  applies to every paste and drag, within or across projects.
- 2026-10-03: partial-paste undo (FR-023), Paste label (FR-025a), progress and cancel (FR-019 – FR-019c).
- 2026-10-03 (second session): replace setting (FR-018f), paste queue (FR-019d), clipboard follows in-app moves
  (FR-009), progress/cancel paste-only (FR-019e).
- 2026-10-03 (third session): unmoved cut items stay on the clipboard (FR-006), progress visible across projects
  (FR-019), quit asks while a paste runs (FR-019f).
- 2026-10-03 (fourth session): clash prompt defaults to Replace and shows size/date (FR-018), pasted items are
  revealed and selected (FR-025b).
- Further supersessions: 004 FR-024 non-clobbering name (paste/drag only), 024 FR-010 copy-not-undoable (when a
  copy replaced something).
- Supersessions are stated narrowly at the top of the spec and at each replacing FR: 004 FR-022 (source
  confinement), 024 FR-010 (cross-project entry).
