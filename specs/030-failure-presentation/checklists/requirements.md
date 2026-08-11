# Specification Quality Checklist: Failure Presentation

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

### Scope history

- **2026-08-11 (initial)** — #224 and #195. Three prioritised stories, 24 requirements.
- **2026-08-11 (clarification)** — 5 questions answered. The display model changed from a persistent
  boolean to three modes; the subject became a structural part of a notice, which widened #195 from a
  copy sweep to a change touching every notice call site.
- **2026-08-11 (adoption)** — #235, #236 and #238 adopted. Six stories, 59 requirements, renumbered in
  dependency order.
- **2026-08-11 (fourth clarification)** — 1 decision, closing the one taxonomy category twelve earlier
  clarifications had never touched: assistive technology and the keyboard. A growing notice announces
  only its delta rather than re-reading the list, and the list is keyboard-scrollable without trapping
  focus. FR-032a/032b, FR-042a, SC-009a. 72 requirements.
- **2026-08-11 (third clarification)** — 4 more decisions, all on US3: unclassified failures group by
  the originating operation (029's closed set stays closed); a live notice grows while a gone one
  raises a fresh notice; the notice is per project with the list grouped by tab in layout order; the
  list is a report, not a control, and holds only the panels known so far. 68 requirements. The last
  of these **overrides #235's own acceptance criterion** asking for unrendered tabs to be included —
  recorded on the issue.
- **2026-08-11 (second clarification)** — 2 more decisions: display modes govern the toast only (a
  panel's failure banner and terminal output are untouched), and per-tab batching is removed outright
  rather than only for causes the consolidated notice covers. 61 requirements. All five issue bodies
  updated and a decision comment posted on each.

### Ordering

Requirement groups follow the *Delivery order and why* section, which derives its order from
dependencies the issues themselves state:

`#224 (independent)` → `#195 subject format` → `#235 consolidated notice` → `#236 shared banner` →
`#238 copy` → `inventory, phrase check, docs`

Nothing in a later group is a prerequisite of an earlier one. Numbering was reassigned rather than
appended because no plan or tasks exist yet, so no downstream artefact references the old ids.

### Deliberate defaults recorded rather than raised as clarifications

- Milliseconds as the timeout unit, entered in a bounded number field (matching the app's six existing
  `*Ms` settings).
- Application-wide preference scope rather than per project.
- No re-timing of already-visible notices (#224 states this is not required).
- Consolidation keys on the cause classification 029 already established, rather than a second notion
  of sameness.
- The affected-panel list's height bound is left to planning; the requirement is that a bound exists.

### Open items for planning, not blockers

- Where the FR-056 inventory lives and whether it is maintained after this feature. Structural
  enforcement (FR-057) makes it evidence rather than a live guard.
- The exact height cap on the affected-panel list.

### Cross-issue conflicts resolved in the spec rather than left implicit

- FR-028 (subjects change no layout) vs FR-032 (the list is a new bounded, scrollable element) — the
  list is named as a deliberate exception.
- #236's banner points at a notice that #224 may have silenced — resolved by FR-005a: the preferences
  govern the toast only, so the banner is never hidden. FR-041 additionally forbids the pointer from
  promising a notice that may not exist and routes the user to banner copy and the log.
- #235 said it "replaces" per-tab batching without saying whether the old path survives for causes it
  does not cover — FR-035 now removes batching by tab outright, leaving one grouping rule.
- Removing per-tab batching outright then collided with 029's *closed* classification set: an
  unclassified failure has no cause to group by, so six defeated panels would have raised six notices.
  FR-029a adds the originating operation as the fallback key; FR-029b forbids widening 029's set.
- FR-022 required `Project — Tab — Panel` on every surface, which would print the project on all forty
  rows of a per-project notice — FR-022a lets context remove parts of the name while forbidding it from
  re-spelling them.
