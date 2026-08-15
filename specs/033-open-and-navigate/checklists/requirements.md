# Specification Quality Checklist: Open and navigate

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-15
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

**Validation pass 1 (2026-08-15) — two items failed and were fixed before this file was written.**

1. *No implementation details* — the Dependencies section named the shared control and its matching
   functions by their source identifiers. Replaced with a description of what the control and its
   matching rule **do**, which is what a reader needs in order to judge "seed it, don't fork it".
2. *Requirements are testable* — #219 requires "cap the rendered result list" and "keeps the input
   responsive"; #234 requires nothing measurable at all. Neither is testable as written, so the spec
   supplies the numbers (200 rendered rows, a 50,000-file scale target, a 100 ms per-keystroke bound)
   and records them as Assumptions 2 rather than leaving them to the implementer.

**Chord tiers were checked against the constitution, not assumed.** `Ctrl+Shift+T` and `Ctrl+G` are
both absent from the reserved terminal tier (`Ctrl+C/D/Z/A/E/W/U/K/R/L/Q`) and from the shadowable
list, and neither is held by a shipped binding — so neither needs a recorded exception under
Principle IV. `Ctrl+G` is additionally editor-scoped, so a terminal still receives it as `^G`
(FR-025, SC-007).

**Deliberately decided rather than deferred.** Ten open questions the five issues left unanswered
are settled in the Assumptions section with the reasoning for each. The two most consequential —
the shape of Quick Open's editor-target choice (Assumption 3) and the existence of a "Contextual"
menu section (Assumption 8) — are the ones worth challenging at `/speckit-clarify`, because
Assumption 8 is the difference between conforming to the vocabulary and regressing the terminal's
link menu.

**One requirement is a constitutional addition the issue did not ask for.** FR-027 puts Go To Line on
the editor's content menu: Principle VI makes a panel's menu the canonical index of its discrete
commands, so a new editor command that reached only a chord would ship the app further out of
compliance. #234 does not mention it.

**Re-validated after `/speckit-clarify`, 2026-08-15 — 16/16 → 16/16, no item changed state.** Five
questions were asked and answered; the spec grew from 57 to 65 functional requirements and from 12 to
13 success criteria. Three of the items above were resolved rather than merely re-checked:

- The two assumptions flagged as "worth challenging" are now decisions, not assumptions. Assumption 3
  (the target control) was answered with a shape the spec did not propose — the control sits **above**
  the input, its second option is a new editor panel **in the current tab**, and Shift+Tab reaches it
  as the first control in the tab order (it renders above the input, which is why Shift+Tab from the input reaches it — mechanism corrected 2026-08-15, see FR-010a) (FR-010 – FR-010b). Assumption 8 (the Contextual section) was
  confirmed, and now carries the test that decides membership.
- Assumption 4 was **overturned**: Quick Open gains a Files & Folders toolbar button (FR-018a –
  FR-018c) rather than staying chord-only.
- FR-026 was the weakest requirement in the first draft — "MUST NOT both hold focus at once" is true
  of almost any implementation. It is now two requirements stating what happens to the find bar and
  what may close one.

One new ordering requirement was added that no issue asked for: FR-007a/FR-007b extend the shared
picker with a ranking hook, because a 200-row cap over an unranked list puts the wanted file off
screen in a deep repository — the exact case Quick Open exists to serve.

**Second clarify pass, 2026-08-15 — 16/16 → 16/16, no item changed state.** Three further questions,
stopped there because nothing of comparable impact remained. 65 → 73 functional requirements, 13 → 15
success criteria.

- **The spec's own weakest wording was the first target.** Three requirements said an inapplicable
  control is "absent or disabled" — an either/or that no test can assert. Now two rules with a stated
  distinction: temporarily unavailable is drawn and disabled, structurally meaningless is not drawn
  (FR-018c, FR-035, FR-038).
- **Two settings were added at the user's direction** (FR-057 – FR-063): both modals open empty, and
  `editor.navigation.rememberQuickOpenQuery` / `editor.navigation.rememberGotoLineNumber` — a new
  `Editor · Navigation` group, both **off** by default — let a user opt into the last accepted value
  being restored. SC-014 requires each to be asserted in **both** states, because a rendered setting
  nothing reads is exactly the defect #108 exists to catch.
- **FR-033 was tightened from the code, not from a question.** "Follow the existing add-a-panel flow"
  named a flow that does not exist for this entry point; the real precedent is the sequence
  `Open In → New Editor` uses, which is now stated, plus FR-033a giving the new terminal keyboard
  focus.

Two low-impact gaps were closed by editing rather than asking, since each had one defensible answer:
the ranking tie-break falls back to seeded order (FR-007a), and the Quick Open chord does not open
the modal at all when no project is open, matching its disabled button (FR-018).

**#244 adopted, 2026-08-15 — 16/16 → 16/16, no item changed state.** A branch sync swept the backlog
and the maintainer adopted #244 (the menu-keyboard guard that always passes). It is in scope because
US5 restructures every context menu and FR-051 asserts keyboard navigation skips dividers, which is
asserted in exactly the tests that guard sits in — so this feature either fixes it or builds new
assertions on a guard already known to be vacuous. FR-053a and FR-053b state the requirement and the
evidence it demands; SC-016 requires every such guard to be shown failing when its precondition is
removed. **Nothing is implemented**: the requirement exists, the fix does not.
