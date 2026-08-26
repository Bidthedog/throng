# Specification Quality Checklist: Editor Status Bar Readouts and Gutter Visibility

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-25
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

**On "no implementation details" — a deliberate, house-style deviation, and where it applies.**

Two requirements name repository artefacts rather than user-visible behaviour: **FR-035** names
`FieldDescriptor` and its `subgroup` field, and **FR-036** names the settings, keybindings and themes
tabs. This matches the established convention in this repository's shipped specs — 016 FR-010f names
the theme-metadata registry, 009 FR-013 names the completeness test, 039 cites source paths
throughout — and it is load-bearing here rather than incidental: #258's whole decision was *which
mechanism*, and a spec that said only "the settings appear nested" would have left the sibling-string
option open after the maintainer had ruled it out.

Everything in **Success Criteria** is free of it, which is where the template's rule bites hardest.

**All three flagged assumptions were resolved by `/speckit-clarify` on 2026-08-25** and are now
requirements rather than assumptions — see the `## Clarifications` section of the spec:

1. **Column counts characters** — a tab advances the column by 1 (FR-002a).
2. **Line breaks are INCLUDED in character counts**, one each however the file spells them
   (FR-003a — **reversed by the maintainer on 2026-08-25, after implementation**; the original
   answer excluded them, and both are recorded in the spec's Clarifications). The selected count
   follows the same rule so the two are comparable (FR-004a).
3. **A word is a run of non-whitespace**, `wc -w` semantics (FR-003b).

**A second clarification pass on 2026-08-25 closed four more gaps**, three of which the first pass had
not even flagged:

4. **Segment presentation was undefined** — FR-021 required labels to truncate before segments hide,
   but nothing said what a label *was*, so neither FR-021 nor FR-022 could be tested. Now
   `Ln 412` / `Col 7` / `1,204 chars` (FR-012), with readouts left-aligned and the language and wrap
   controls right-aligned (FR-013), which is where 016 FR-010c already puts the language indicator.
5. **The spec had zero accessibility coverage** (FR-015 – FR-018). The readouts are not a live region:
   the caret moves on every keypress and the editor already announces the line, so announcing again
   would interrupt it on every arrow key. Readouts hidden by width or by preference leave the
   accessibility tree rather than lingering in it.
6. **Terminology was split 8/6** between "status strip" and "status bar" — both shipped vocabulary,
   since 016 says *strip* while the setting keys say *bar*. User-facing copy is now "status bar"
   (FR-034a); the two verbatim 016 quotations keep the original wording.
7. **Subgroup rendering was unspecified** (FR-036a – FR-036c) — static subsection, declaration order,
   ungrouped fields first, and an empty subgroup disappears with its heading, all mirroring how a
   group already behaves.

**One checkbox above was ticked optimistically on the first pass and is only now genuinely true.**
"Success criteria are measurable" was marked passing while SC-005 read *"typing in a large file is no
slower than before this feature"* — a comparison against an unmeasured baseline that no test could
assert. It now names 5 MB and 200 ms (FR-008a–c, SC-005). The marker did not change state, so this is
recorded here rather than as a regression.

**Three findings are recorded in the spec body rather than as requirements**, and they are the reason
the spec has the shape it does:

- **Finding 1** narrows #256's proposed hide order so it terminates after `line`. 016 FR-010c requires
  a *persistent* language indicator, and 024 permits it to vanish only with the whole strip. Taken
  literally, #256's "language and the wrap toggle … are the last to go" would have introduced a third
  state that contradicts a shipped requirement. FR-024 is the resolution.
- **Finding 2** establishes that the new readouts need no content-menu items, because the
  constitution's panel-menu rule (from 024) exists to stop a hidden status bar stranding a *command* —
  and a readout is not one. FR-009 states it so the next reader does not re-derive it.
- **Finding 3** (surfaced during clarification) found that constitution 4.5.0's NON-NEGOTIABLE
  digit-grouping rule was scoped to *preference editors* and so did not literally reach the status
  strip, while its rationale described the strip exactly. **This was fixed in the constitution rather
  than worked around in the spec**: amendment **5.4.0** widens the gate to every surface and restates
  it as a rule about *quantities*, since the obvious wording would have mandated `Panel 1,024` and
  `report copy 1,024.txt`. FR-027 is now plain compliance rather than a local decision.
