# Specification Quality Checklist: Notice-Model Integrity

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-26
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — **all four clarifications resolved 2026-08-26**
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

## Spec-governance checks (throng)

- [x] **The requirement that already governs each behaviour was searched for before writing a new
      one.** Four of five behaviours were found to be governed already — 029 FR-016/018/019 and
      030 FR-034/037a/060a — and are restored rather than restated. Recorded in *What this feature
      is, and what it is not*.
- [x] **No requirement contradicts a shipped one.** Nothing here supersedes 029 or 030; the
      Dependencies section names every requirement relied on.
- [x] **Nothing is silently renumbered.** Restored requirements keep their original 029/030 numbers
      in the prose; this spec's own FR-001…FR-030 govern how conformance is proven and the two
      genuinely new decisions.
- [x] **Every restored requirement gains a guard** (FR-028, FR-029, FR-030, FR-030a, FR-030b), because
      all three stopped holding without anything failing.

## Notes

- **All clarifications resolved — 16/16 items passing. Ready for `/speckit-plan`.**
- **Third pass (same day) added five more, and the first of them was a contradiction the previous two
  passes had written into the spec themselves.** FR-007a said "a refused open does" carry an
  affected-panel list while FR-013 said a refused open creates no panel — and `affected.ts` requires a
  `panelId` on every row and de-duplicates on it, so #328 would have stayed unfixable for exactly the
  case #327 creates. The lesson is that the two genuinely new decisions (#327, #314) had knock-on
  effects on the three restored ones, and a pass that treats "restored" as "already settled" misses
  them.
  9. **Notice shape** — the affected-panel list generalises to a **casualty list** whose panel is
     optional, keyed on the casualty identity FR-007 already stated. Panel rows render unchanged;
     panel-less rows render ungrouped and deterministically. → FR-007b, FR-007c, FR-007d, SC-003a.
  10. **Focus, with several notices live** — `focus.notice` is idempotent, never cycles, and an
      arriving notice never steals focus; Escape returns to the element focused before the binding
      was pressed, wherever Tab has since taken the user, with a real fallback if that element is
      gone. → FR-020d, FR-020e, FR-022a, FR-022b.
  11. **Announcement storms** — one announcement per pulse, with repeats absorbed into a running
      pulse. Bounds FR-011a against SC-003's ten repeats without inventing a timing constant.
      → FR-008e, FR-011c, SC-006e.
  12. **Arrival order** — suppression is decided per event by an upward absence check, never by
      buffering, and a notice is never amended to name a different subject. Resolves the tension
      between FR-001 and FR-003b for the case that actually occurs. → FR-003c, FR-003d, SC-006f.
  13. **What SC-006 asks for** — a one-off sensitivity proof recorded in the PR, not a mutation
      harness or a gate stage. → FR-030a, FR-030b; SC-006 tightened.
- **Second pass (same day) added four more**, all found by scanning rather than pre-flagged. Three of
  them were about what suppression must *not* suppress, which is where this feature could most easily
  have lost something silently:
  5. **The log** — suppression is presentation only; every casualty is logged at the cause's own
     level. One removal, one notice, five log entries. → FR-005a, FR-005b.
  6. **Assistive technology** — a pure repeat is announced politely, naming the subject, without
     re-reading the list. The pulse is visual-only, so silence would have been the default.
     → FR-011a, FR-011b.
  7. **Entry points** — FR-013 binds every path that would create a panel, not just the tree; a drop
     onto an existing panel is unaffected. → FR-013a, FR-013b, FR-013c.
  8. **Cause granularity** — one notice per removed folder whose parent survives; co-incident
     removals are explicitly not merged, since 030 FR-036 forbids grouping by time. → FR-003a,
     FR-003b.
- First pass, four questions:
  1. **Notice shape** — de-duplication is keyed on the **cause** and is independent of whether a
     notice carries an affected-panel list. This was **not** one of the two questions the spec
     shipped with; it surfaced during the ambiguity scan and was the highest-impact of the four,
     because it decides whether #278 and #328 are one mechanism or two. → FR-007, FR-007a.
  2. **Path in a row** — yes, but only the path **relative to the project root**, since the notice
     already names the project. The source comment is the part that was wrong, not the rendering.
     → FR-018, FR-018a, FR-018b, FR-018c.
  3. **The binding** — a dedicated `focus.notice`, scoped EVERYWHERE, default `Ctrl+Alt+M`; notices
     stay out of the `focus.cycle` ring. → FR-020, FR-020a, FR-020b, FR-020c.
  4. **The flash** — pulse the card and restart its dismissal timer; no repeat count.
     → FR-008a, FR-008b, FR-008c, FR-008d.
- Answer 2 came from the maintainer rather than the offered options and is better than all three:
  it removes the length problem at source instead of mitigating it, and matches 030 FR-022a's
  existing eliding principle.
