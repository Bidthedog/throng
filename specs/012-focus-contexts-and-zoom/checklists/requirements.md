# Specification Quality Checklist: Focus Contexts & Per-Panel Zoom

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-11
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

- **All clarifications resolved** in the `/speckit-clarify` session of 2026-07-11 (see spec §Clarifications → Session 2026-07-11):
  1. Zoom **composes on top** of the app-wide global zoom (effective size = global × per-type factor); global zoom retained.
  2. Zoom level is tracked **per panel type** (one for terminals, one for editors), persisted per project — same-type panels zoom together.
  3. Move-focus defaults: `Ctrl+Alt+Arrow` directional + `Ctrl+`` ` / `Ctrl+Shift+`` ` cycle; directional move at a layout edge **stays put** (no wrap). All rebindable.
- **Second `/speckit-clarify` pass (2026-07-11)** resolved three residual details that would otherwise be silently defaulted during planning:
  1. Per-type zoom reuses the **same step & min/max bounds as the app-wide global zoom** (FR-011).
  2. The cycle binding traverses panels in a stable **layout order** (panes L→R, T→B; tabs in order), not MRU (FR-015, US3 scenario 2).
  3. The active-panel indicator **persists dimmed** when its window is not the OS foreground window, via a distinct inactive theme token (FR-002, US1 scenario 4).
- All quality items pass. The spec is ready to proceed to `/speckit-plan`.
