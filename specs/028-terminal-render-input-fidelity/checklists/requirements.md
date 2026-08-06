# Specification Quality Checklist: Terminal Render & Input Fidelity

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-31
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

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.

### Validation notes (2026-07-31)

- **No implementation details**: the spec deliberately names no library, addon, module or function.
  Where it must be concrete about prior evidence it cites an issue number, a commit hash and one
  committed test file (in the narrative and Assumptions sections only) — the same treatment spec 026
  gives inherited coverage. No requirement (FR-*) or success criterion (SC-*) names a technology.
- **Terminology check**: "alternate screen", "hyperlink", "scrollback", "shell flavour" and "grid"
  are the product's own domain vocabulary as used in the constitution and prior specs, not framework
  names.
- **Clarification markers**: none. Three questions that could have been raised — whether the redraw
  action gets a default chord, what the self-heal interval should be, and what happens if #198 stays
  unreproducible — are resolved as stated Assumptions plus FR-003/FR-014/FR-049/FR-055 rather than
  left open, because each has a defensible default and none changes the feature's scope.
- **Measurability**: SC-003 (≥50 repetitions per flavour, zero losses) and SC-002 (100% of attempts)
  are stated as repetition counts precisely because #200 and #162 are intermittent; a single pass is
  explicitly rejected as evidence in FR-024.
- **Scope boundary**: #164 (global chords swallowed inside a focused terminal) is excluded in the
  header with a stated reason. FR-049 keeps this feature from claiming a terminal key, so the two
  specs cannot collide.

### Amendment (2026-07-31, same day)

Re-validated after the reporter supplied new evidence for #162 — the corruption correlates with
**tab activation** (two tabs of one project, each running an agent session; a resize is needed on
almost every switch) — and required a reproducible E2E per defect.

- User Story 1 is re-anchored on the tab-switch sequence (its Independent Test and first two
  acceptance scenarios), with FR-017/FR-018/FR-019 added for becoming-visible reconciliation and
  SC-011/SC-012 for the switch measurement and its cost.
- FR-006 is split into FR-006/006a/006b/006c: one reproducing E2E per defect, deterministic rather
  than opportunistic, asserting the state that actually diverged, plus separate coverage for new
  behaviour.
- The reporter's proposed remedy (redraw a tab's terminals on open) is recorded as the leading
  candidate in Assumptions, not written in as the requirement — FR-013 still requires the cause to be
  measured first, because an activation-only redraw would mask a stale-grid cause everywhere
  activation is not involved. This is a deliberate spec-level choice, not an omission.
- Still zero [NEEDS CLARIFICATION] markers; all boxes above re-checked against the amended text.

### Amendment 2 (2026-07-31)

Two further refinements from the reporter, both re-validated against the checklist:

- **Differing panel geometry between the tabs** is now a required condition of the #162 reproduction
  (FR-019a) rather than incidental colour, with FR-019b (a terminal wraps at its own width, never
  another panel's) and FR-019c (a manual resize survives hide/re-show), US1 scenarios 1/3/4, and
  SC-011 restated to require deliberately different sizes. This moves the leading hypothesis from
  "stale drawing" to "grid identity across a hidden period" — recorded in the narrative so the plan
  inherits the reasoning, not just the conclusion.
- **The reproduction phase is explicitly a search** (FR-006d): write as many probes as it takes to
  make each defect fail on demand, then delete the ones that never reddened. FR-006e guards the one
  way that rule could destroy value — a test that passes *for a reason* is a fence, not scaffolding,
  and stays — and FR-006f requires ruled-out conditions to be recorded on the issue, since a negative
  result is a measurement and the probe is about to be deleted.
- Scope note: these are method and condition requirements, both testable and both technology-agnostic
  (no framework, tool or file is named in any FR). Checklist items re-verified, no regressions.

### Re-validation after `/speckit-clarify` (2026-07-31)

Five questions asked and answered; all 16 items re-checked against the amended spec and all 16 still
pass (16/16 → 16/16, no state changes). What changed and why it does not break an item:

- **Redraw scope** (FR-017a, FR-040a, FR-049a) — the manual action targets one terminal, activation
  reconciles every terminal in the tab. Removes an ambiguity that would have produced two defensible
  and incompatible implementations.
- **Upstream-cause disposition** (FR-003a–003d) — a maintainer decision checkpoint with hands-on
  verification, plus an upstream-ready report and a minimal reproduction where escalation is chosen.
  Stated as required *outputs and a checkpoint*, which keeps it testable rather than aspirational.
- **Self-heal model** (FR-014, 014a–014c) — event-driven reconciliation with a slow visible-only
  backstop; today's 2s repaint is replaced or removed, never retained unchanged. FR-014b closes the
  loophole where a reproduction passes only because the backstop fired.
- **Intermittent-fix proof** (FR-024a–024c, SC-003 restated) — a fast deterministic gate in the normal
  suite, an opt-in soak for the volume evidence. SC-003 keeps its number and gains its venue, so the
  "measurable" and "testable" items still hold.
- **Hidden views and the shared grid** (FR-004a–004c, FR-019b exception, US1 scenarios 11–12) — the
  agreed grid is the minimum across *visible* views only. This resolved a live contradiction between
  FR-004 and FR-019b that pre-dated the clarify pass, and it makes becoming-visible a grid change
  that must be tested as one — a strong candidate for #162's cause.

Still zero [NEEDS CLARIFICATION] markers. No obsolete text left behind: the self-heal and grid
statements the answers superseded were rewritten in place rather than appended to.

### Second `/speckit-clarify` pass (2026-07-31)

Five further questions, same session heading (same date). 16/16 → 16/16, no state changes.

- **Alt-screen wheel semantics** (FR-035, 035a–035c; US3 scenarios 5–6) — replaced the placeholder
  "a stated, deliberate decision" with the decision itself: wheel notches become arrow key presses
  for a full-screen program that has not claimed mouse reporting. This closes the one requirement in
  the spec that told the implementer to decide something rather than telling them what it was.
  FR-035c adds the safety property that matters — a wheel gesture must never put characters on a
  shell's command line.
- **Delivery shape** (FR-007a/007b) — one branch, staged so each story is independently green and
  mergeable, and a story blocked at the FR-003a checkpoint does not hold the finished ones back.
- **#198 evidence** (FR-055a–055d; US5 scenario 8) — automation is attempted and its gap stated
  plainly; the disposition is gated on the **maintainer's own** hand-verified check, made after being
  briefed well enough to understand the ticket. FR-055d confines the exception so it cannot be read
  as licence to hand-verify anything else.
- **Activation cost** (SC-012 quantified, FR-017b) — ~16ms of main-thread work for up to four
  terminals, never blocking the switch. Converts an unmeasurable "does not regress" into a number a
  test can assert.
- **Observability** (FR-009, 009a–009c; new Key Entity "Reconciliation trigger") — cheap in-memory
  counters, unsurfaced by default, readable by tests. Their real value is enforcement: FR-009b makes
  FR-014b assertable, so a reproduction cannot pass merely because the backstop fired. FR-009c stops
  a counter becoming the acceptance criterion in place of the user-visible outcome.

Ten clarification bullets now stand under Session 2026-07-31 (five per pass), one per accepted answer,
no duplicates.
