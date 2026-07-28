# Specification Quality Checklist: Terminal Startup Commands & Command Memory

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-27
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

**Validation pass 4 — after the second `/speckit-clarify` (Session 2026-07-27 (b)). All 16 items still pass; no regressions.**

Four questions asked. The fourth ended the session by changing scope.

| # | Question | Outcome |
|---|---|---|
| 1 | Track commands while no UI is attached? | No — freeze the last value; **FR-019f–h** added, **SC-012** qualified. Author chose this over a slower background cadence, accepting the stated defect. |
| 2 | Is directory memory gated on the memory checkbox? | No, always on and independent — **FR-027a**, FR-015 scoped, US3 scenario 6. |
| 3 | How is a failed capture made diagnosable? | Log every decision, **plus** a toast only when the failure is not already visible in terminal output — new **FR group C2** (FR-026a–e), **SC-014/015**. |
| 4 | How does a panel identify its Claude session? | **Void — scope change.** Claude integration dropped entirely; agents deferred to their own feature. |

**Scope reduction (Q4)**: User Story 4, FR-033–041, SC-006, the "AI Agents → Claude"
settings section and the Claude Session Reference entity were **removed**. FR group E was
rewritten from *"Claude Code session resume"* into *"Agent-agnostic treatment of agent
CLIs"* — five requirements that now **forbid** agent awareness (FR-033–037), so the
exclusion is enforceable rather than merely absent. Assumptions 2 and 8 were replaced;
Out of Scope and Dependencies updated. The spec dropped from 4 user stories to 3.

The feature no longer depends on any other application's internals, which removes its
only external-integration risk.

**Grounding correction found while scanning** (recorded in Dependencies): throng *already*
reads each terminal's live working directory by pid via an OS seam, batched, on a
repeating daemon poll. US3 needs persistence, not a new observation mechanism — it is
substantially cheaper than the first draft implied.

**Deferred, low impact**: FR-023's "bounded in length" is still unquantified. Left for
planning to pick a concrete limit; it does not block design.

**Validation pass 3 — after `/speckit-clarify` (Session 2026-07-27). All 16 items still pass; no regressions.**

Five clarifications were asked and integrated. Two closed real gaps the spec never
addressed; three confirmed decisions that had been recorded as assumptions:

| # | Question | Outcome |
|---|---|---|
| 1 | Does a memory-captured command auto-run? | Yes, no prompt — **FR-047a** added; Assumption 5 confirmed. |
| 2 | Which command wins when several run? | Most recent direct child — **FR-022** hardened, **FR-022a** added for the grandchild case; Assumption 4 confirmed with its trade-off recorded. |
| 3 | Where is the post-creation edit surface? | *(gap)* Pre-filled empty-panel form only — **FR-007a–d** added, US1 scenarios 4–6 added, Assumptions 10–11. |
| 4 | What may live tracking cost? | *(gap)* One shared bounded observation — **FR-019a–e**, **SC-011**, **SC-012** added. |
| 5 | How are the two fields labelled? | "Shell Arguments" + "Startup Command" — **FR-002**, **FR-002b–f**, **SC-013**; Assumption 3 confirmed. |

**Scope change arising from Q5**: the author subsequently directed that the rename reach
the backing variables and persisted settings keys, not just the label. That converts a
cosmetic relabel into a **data migration** (FR-002d–f, SC-013). Accepted deliberately —
v1.0.0 has not shipped, so the cost is lowest now. Planning must treat the migration as
real work with its own tests, not a find-and-replace.

Two earlier statements were **replaced** rather than duplicated, so no contradiction
remains: Assumption 3 and the Q5 clarification bullet both previously asserted "the
stored configuration key is unchanged", which the rename directive overturned.

**Validation pass 2 — all items pass.**

Issues found in pass 1 and fixed before this pass:

1. *No implementation details* — the first draft named specific shell switches (`/K`,
   `-NoExit -Command`, `-i -l -c`), file paths under `~/.claude/projects/`, and source
   symbols (`listChildPids`, `isBusy`). All moved out of the requirements: FR-013 now
   requires the recipes be *determined and proven during planning*, FR-035 refers to
   "Claude Code's own on-disk session records", and the source-level foundation is
   described behaviourally in Dependencies. The concrete invocations belong in plan.md.
2. *Success criteria technology-agnostic* — an early SC quoted a process-snapshot
   interval. Replaced with user-facing outcomes (SC-001 … SC-010).
3. *Testable and unambiguous* — the memory rule was originally prose. It is now stated
   as the three-way rule in FR-016/FR-017/FR-018 and pinned by the user's six worked
   examples as US2 acceptance scenarios, so "still running" vs "already stopped" is
   directly testable (FR-045).
4. *Scope clearly bounded* — an explicit **Out of Scope** section was added naming each
   related issue that is deliberately not being done (#104, #17, #18, #133, #14, #67,
   #106, #107) rather than leaving the boundary implied.

**Three recorded decisions the author should confirm or overturn** (Assumptions 3, 4, 5).
They are recorded as decisions rather than `[NEEDS CLARIFICATION]` markers because the
author explicitly delegated scoping, and each has a defensible default — but each is a
genuine fork:

- **A3** renames a shipped UI label ("Startup Params" → shell arguments wording).
- **A4** picks *most recently started direct child* as the captured command when several
  are running.
- **A5** lets a memory-captured command auto-run with no confirmation on next start.

*All three were settled by `/speckit-clarify` — see pass 3 above.*
