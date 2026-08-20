# Specification Quality Checklist: E2E Layer Migration

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-18
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

**On "non-technical stakeholders"** — this feature's user IS a contributor to this repository, and
its value is delivered in contributor minutes rather than in end-user capability. The requirements
and success criteria are written in behavioural terms ("without launching the application", "the
build fails and names the channel") rather than naming tools, so the *shape* of the rule is legible
without knowing the stack. Concrete file paths appear only in the **Explicit non-assertions**
section, where the whole purpose is to let a later reader find the exact tests that were left open.

**On the projection in SC-001** — the range 500 rather than a single number is deliberate. Five
assessors produced 68/74/67/~70/71% KEEP; the projection follows that spread. FR-021 requires the
achieved figure to be reported against the range and the shortfall named if missed, so the estimate
cannot quietly become a claim.

**On what was deliberately NOT specified** — a test-count ceiling was requested and is not here,
because the constitution already mandates a declared, downward-only E2E budget and the repository
already implements it. This is recorded in the spec's amendment section rather than silently dropped.

**One open question carried into planning** — whether a static check can prove payload shapes agree
across the bridge, not only channel names. Name agreement was demonstrated during the census; shape
agreement was not, and the spec lists it as Out of Scope rather than assuming it.

---

## Re-validation after clarification (2026-08-18)

**16/16 → 16/16 items passing.** No item changed state; five clarifications tightened requirements
that already passed rather than repairing ones that failed.

What changed: FR-014/014a bound Phase B to channels the migrations actually need; FR-016/016a/016b
fix the naming mechanism as a stable third tag class; FR-020/020a turn the unresolved list into a
work queue with a deadline; FR-022 and SC-001/001a make "every verdict applied" the finish line
instead of a number; SC-009 names the worker sweep that establishes it.

**One item passes with a caveat worth recording — "Success criteria are technology-agnostic".**
SC-009 now names three worker counts, which is a test-runner concept rather than a pure user
outcome. It is kept because the alternative wording ("no new intermittent failures") is not
verifiable, and because 034's measurement established that this suite's instability *is*
worker-contention instability — so a criterion that omits the worker count would not be measuring
the thing that goes wrong. Recorded as a deliberate trade, not an oversight.

**One tension worth watching in planning** — SC-001 (every verdict applied) and the Out of Scope
deferral of non-blocking channels can pull against each other: a verdict whose migration depends on
a deferred channel cannot be applied. FR-022's "declined with a recorded reason" is the intended
resolution, and planning should confirm that path is used rather than the verdict being quietly
dropped.
