# Specification Quality Checklist: E2E Harness Integrity and Speed

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

Three items needed a deliberate reading, and the reasoning is recorded here so a reviewer can
disagree with it rather than have to reconstruct it.

**"No implementation details" in a feature whose subject is the test suite.** The product here *is*
the harness, so naming what the tests do is naming the requirement, not leaking a design. The line
drawn: the spec names the four affected spec files (they are the reported defects — #245, #246,
#251, #252 — and a requirement that would not let a reader find them is useless), and it names
observable properties such as "waits for a condition" or "shares one application across a file's
tests". It does **not** name the test framework, the helper functions, the environment variables,
the plan files, or the API of the shared mechanism required by FR-013. Those are the plan's job.

**"Technology-agnostic success criteria."** SC-005, SC-007 and SC-008 are stated as percentage
reductions against measured baselines rather than against named functions, and SC-003, SC-006 and
SC-010 are stated as counts of declared, recorded or executed things. None names a tool. The
baseline figures they reduce from (222 sites, 233s, 681 launches, 235 files) are measurements of
this suite, not implementation choices.

**"Written for non-technical stakeholders."** Interpreted as: a reader who does not know this
codebase can follow what is wrong and what "fixed" means. The *Why this feature exists* section
carries that load, and every user story states its value before its mechanism. It is not
interpreted as pretending the audience is not an engineer — the stakeholder for a test suite is the
person who runs it.

**One requirement is deliberately conditional.** FR-005 through FR-008 branch on a measurement that
has not been taken yet (#251: contention or product defect). This is not an unresolved
clarification — it is a question the spec correctly refuses to answer from a chair, and both
branches carry their own requirements so neither outcome is unspecified. The user has already
decided the policy for that branch: fix the product where root cause demands it, and say so
plainly.

**No target is satisfiable by removing coverage.** SC-010 exists specifically so that SC-005,
SC-007 and SC-008 cannot be met by deleting, skipping or quarantining tests.

---

## Re-validated 2026-08-16 (Stories 6-8)

All sixteen items were re-evaluated against the widened spec and all sixteen remain satisfied:
16/16 before, 16/16 after. Three needed a second look, and the reasoning is recorded here for the
same reason as above.

**The paragraph immediately above is now narrower than it reads.** Stories 6-8 delete end-to-end
tests deliberately, so "no target is satisfiable by removing coverage" is no longer true as a
blanket statement — and it is left in place rather than rewritten, because it is exactly what
Stories 1-5 were held to. What replaces it is stricter about the thing that actually matters: a
test may be deleted only once a lower-layer replacement has been observed FAILING against a broken
implementation (FR-046) and every assertion it made is accounted for (FR-047), while skipping and
quarantining to hit a target stay forbidden outright (FR-035, SC-017). Coverage still cannot be
removed to meet a target. It can be moved to the layer that should always have owned it.

**"No implementation details" across the new requirements.** FR-044 through FR-063 name a component
test layer, two selections, a significance marking and a budget — all of them properties of the
suite rather than of a tool. They do not name the test framework, the document-environment library,
the tag syntax, the runner flag that selects a marking, the workflow files, or the plan files. The
Clarifications block does reach further, and deliberately: it records how a decision was reached,
including the measured cost figures behind removing the split across machines, because a decision
whose evidence is not written down gets re-litigated.

**"Technology-agnostic success criteria."** SC-016 through SC-023 are stated as counts, ceilings and
observable outcomes — ten minutes of machine time, fifty tests, two consecutive clean runs, every
deletion naming its replacement. The one number that is not a measurement of this suite is the
fifty-test ceiling, which is a decision rather than an observation, and it is recorded as one in the
Clarifications block.
