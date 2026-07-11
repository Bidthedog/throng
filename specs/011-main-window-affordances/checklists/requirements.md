# Specification Quality Checklist: Main Window Affordances

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-10
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

- The feature bundles five independent defects and one new setting; each is a separately testable,
  separately shippable user story with its own priority (P1 errors, P2 terminology, P3 folder
  picker, P4 file-changed naming, P5 pulsing dot). None depends on another.
- Two constitution v3.12.0 governance rules are engaged and captured as requirements rather than
  left implicit: Themeable icon controls (FR-006, FR-050) and Configuration-editor completeness
  (FR-045). The dialog-decision-button exception is stated explicitly in FR-050.
- The removal-verb glossary is reproduced verbatim in Key Entities so the per-target verb mapping
  is unambiguous and directly testable; the theme-editor row is marked glossary-only (sibling
  feature owns it) to keep scope bounded.
- A few load-bearing existing artefacts (the per-file notice list, the shared unsaved-dot element,
  the native folder picker, the settings-metadata registry) are named in Assumptions/Dependencies
  for accuracy but kept out of the Functional Requirements, which stay behaviour-focused.
- Deliberately loose thresholds ("approximately 1.5 seconds", "partially opaque") are called out in
  Assumptions with a concrete testable interpretation (fixed ~1.5 s cycle, minimum opacity above
  zero) so they remain verifiable without over-constraining the design.
- All five clarification questions were answered by the human on 2026-07-10 and encoded in the
  `## Clarifications` section, with the FRs and Key Entities updated to match. Note one **reversal**
  (not a refinement): the earlier "override must not be typed" prohibition is withdrawn — the
  override path is now an editable field plus an on-demand browse icon (shared folder-picker
  component; new `folder` control kind). FR-042/042a, US3 scenario 3, Key Entities and Assumptions
  were corrected so no contradictory "no typing" statement remains.
- A hard cross-feature dependency is recorded near the top of the spec: the `dismiss` icon token is
  supplied by `009-theme-content`, so 011 merges after 009. Only the dismiss-control rendering
  depends on it; the other four defects and the new setting are independent.
