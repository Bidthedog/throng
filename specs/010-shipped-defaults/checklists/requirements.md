# Specification Quality Checklist: Shipped Defaults

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

## Result

**16 / 16 passed.** All five open decisions were resolved authoritatively by the human and are encoded
as `Q: … → A: …` bullets under `## Clarifications` → `### Session 2026-07-10`; no
[NEEDS CLARIFICATION] markers remain and no assumption raised for confirmation is still open. Every
contradicting assumption in the original draft (chiefly the assumption that upgrade seeding could
re-source values, and the name-collision hazard under name-based identity) was corrected **in place**,
not layered over.

## Notes

- **Content Quality — "no implementation details" / "non-technical stakeholders":** this feature is
  infrastructure that deliberately ships no UI, so its "users" are the end-user (through the recover/
  reset/upgrade outcomes) and two downstream features that consume the API. The spec is kept at the
  capability level — *what* must be restorable/seeded and from *where* — and avoids code-level detail
  (no signatures, file layouts, or module names). Names of existing artefacts (config directory, the
  sibling features, the `throng` base theme) appear only in Clarifications/Dependencies/Assumptions for
  accuracy, not inside the functional requirements, which stay behaviour-focused.
- **Upgrade-never-overwrites is the governing rule.** The single most important correction from the
  clarification pass: an application upgrade performs only two purely-additive operations (add missing
  themes; materialise missing properties) and never changes a value the user already has — on any
  theme, built-in or custom. Adopting new shipped *values* is reserved to the explicit "Restore All
  Themes to Default". Encoded in FR-015/FR-015a, User Story 6, and SC-012.
- **Name-based identity is safe only under name reservation (FR-007a).** Built-in theme names are
  reserved from the shipped record (independent of what is currently present in user config, so a
  deleted built-in's name stays reserved). This feature exposes the reserved-name set and relies on
  `014-theme-editor` enforcing it at creation; it does not police theme creation itself.
- **Whole-operation rollback (FR-012a).** Restore-all-themes stages all writes and, on any failure
  (realistically a locked file on Windows), discards the staging and leaves configuration untouched,
  reporting which file failed. The rollback/locked-file path is a required test.
- **Materialisation location is intentionally deferred to planning.** The spec fixes only the
  invariants: immutable, versioned, distributed with the build, held separately from the user's config.
- **Generated-not-copied (FR-004 / SC-007).** Because feature 009 concurrently rewrites theme palettes
  and adds two editor-gutter colour tokens, the record MUST be generated from the theme definitions and
  a verification MUST fail on divergence, so 009's changes flow through without this feature editing
  palettes. 009 handles the load-time fallback for the new tokens; this feature's upgrade step writes
  them into user files (complementary, not conflicting).
