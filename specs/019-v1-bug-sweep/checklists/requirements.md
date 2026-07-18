# Specification Quality Checklist: v1.0.0 Bug Sweep

**Purpose**: Validate specification completeness and quality
**Created**: 2026-07-17
**Feature**: [spec.md](../spec.md)

This checklist was validated **against the amended spec** (after US7–US10 were adopted and #67 pulled),
not ticked in advance. Items that do not pass the letter of the standard template are marked and
explained rather than forced green — this feature's whole thesis is that an unchecked claim is the
defect.

## Content Quality

- [~] No implementation details (languages, frameworks, APIs) — **deliberate deviation, whole-spec.**
  This spec is intentionally **code-anchored**: FRs and SCs cite files, functions, line numbers and
  testids (e.g. `pty-agent-host.ts:82`, `.prefs-toolbtn--icon .icon`, `tree-twisty-<path>`). That is the
  established style of the original US1–US6 and the Clarifications, and the adopted US7–US10 match it for
  consistency. It fails the generic "no implementation details" rule by design; it is not an oversight.
- [x] Focused on user value and business needs — every US opens with the user-visible symptom.
- [~] Written for non-technical stakeholders — the User Story narratives are; the FRs/SCs/Clarifications
  are written for implementers. Same deliberate deviation as row 1.
- [x] All mandatory sections completed (User Scenarios, Requirements, Success Criteria present).

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — **verified: 0 occurrences** across the spec.
- [x] Requirements are testable and unambiguous — each new FR-030…FR-037 and FR-020a maps to a named
  assertion (`explorer-tree-state.e2e.ts` tests (1)/(1b)/(2)/(3); `preferences-themes.e2e.ts`;
  `preferences-terminal-flavours.e2e.ts`).
- [x] Success criteria are measurable — SC-015…SC-018 and SC-011a state counts/percentages/line-box
  counts.
- [~] Success criteria are technology-agnostic — **no**, by the same deliberate deviation: SCs reference
  testids, CSS properties and test files. Consistent with SC-001…SC-014.
- [x] All acceptance scenarios are defined — US7–US10 each carry numbered Given/When/Then that match the
  real test assertions.
- [x] Edge cases are identified — the existing Edge Cases section stands; the adopted items' own edge
  case (stale open-map entry from a restored `expanded` list) is captured in FR-031 / US7 AC3.
- [x] Scope is clearly bounded — #67 is explicitly pulled to vNext (FR-020a, C33), its FRs/SCs marked
  `[vNext]`, and the four adopted items are scoped to their tests.
- [x] Dependencies and assumptions identified — Assumptions records the 2026-07-17 scope change and the
  #67 pull; #94's unmet goal is recorded in C34 and SC-007.

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria — FR↔US↔SC↔test traceability holds for
  the new requirements.
- [x] User scenarios cover primary flows — one User Story per adopted issue (US7–US10), matching the
  one-story-per-issue style of US1–US6.
- [~] Feature meets measurable outcomes defined in Success Criteria — **SC-007 does NOT pass** and the
  spec says so plainly (C34): the FR-012 hang→visible-error safety net holds, but an elevated throng does
  not yet open a *working* de-elevated terminal (agent launches, connects, then crashes; under
  diagnosis). This is a **known, recorded gap**, not a silent one. All other SCs (incl. the adopted
  SC-015…SC-018 and SC-011a) are met and green.
- [~] No implementation details leak into specification — same deliberate whole-spec deviation as Content
  Quality row 1.

## Validation result

**Conditional pass, with two honest non-passes recorded rather than ticked:**

1. **SC-007 (#94) is not met.** The safety net (FR-012/FR-013/FR-013a, SC-006/SC-008) is in place; the
   deeper de-elevation outcome (FR-014/SC-007) is not, and is under active diagnosis. The spec must not
   be read as claiming a working elevated→de-elevated terminal.
2. **The "no implementation details / technology-agnostic" template items do not pass** and are not made
   to. This spec is deliberately code-anchored end to end; forcing those green would itself be the
   unmeasured-claim failure this feature exists to close.

Everything else passes: no clarification markers, contiguous FR-001…FR-037 (+FR-013a, FR-020a), SC-001…
SC-018 (+SC-011a), C1…C34, US1…US10, and full FR↔SC↔test traceability for the adopted work.

## Notes

- **#67 pulled (C33).** FR-016…FR-020 and SC-009…SC-011 are retained and marked `[vNext]` — they are
  vNext's acceptance criteria and the design of record described by C9–C17. The live v1.0.0 requirement
  is FR-020a / SC-011a: the three controls do not render (hide, not revert). C14's incidental
  `defaultParams` fix is hidden with them and its regression test removed.
- **Feature 004 FR-028 superseded** by 019 FR-032 (#121). 004's spec carries the pointer; the toggle
  half is struck, the "MUST NOT raise an open-file intent" half is unchanged.
- **A reasonable reviewer might differ on** grouping: US7–US10 are four separate stories (matching the
  one-issue-one-story house style). #121 and #124 are both Tweaks and could have been grouped into one
  story; they were kept separate because they touch different subsystems (explorer vs preferences/themes)
  and trace to different tests. C33 (the #67 pull) and C34 (#94's honest state) are the two decisions
  flagged for deliberate re-opening if the developer disagrees.
