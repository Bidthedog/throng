# Specification Quality Checklist: Bugfix & Tweak Pass

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-10
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

### Validation history

**Iteration 1 (2026-07-10)** — three items initially failed; all resolved before sign-off.

1. *Requirements testable and unambiguous* — FAILED. Six of the user's twenty-four items were
   underspecified: the terminal grid-arbitration rule, the focus-scoping model (which chords
   survive focus, and how focus is entered and released), the exact terminal- and editor-context
   binding sets, and whether "Save As" retained an in-place rename. Resolved by seven clarification
   questions answered on 2026-07-10 and recorded in the Clarifications section; the resulting
   decisions are encoded in FR-008 through FR-023 and FR-031 through FR-033.

2. *No implementation details* — FAILED. Two of the user's items were framed as questions about the
   codebase ("Custom terminal flavours doesn't seem to work — is it implemented?" and "I assume the
   terminal instance resizes rather than each panel"). Resolved by researching the codebase before
   writing, then expressing the findings as user-facing behaviour: the flavour defect is confined to
   the configuration surface (User Story 10, Assumptions), and the resize defect is expressed as a
   grid-arbitration rule (User Story 2) rather than as a description of the resize call path.

3. *Success criteria technology-agnostic* — FAILED on first draft. An early SC referred to a
   remote-procedure-call timeout constant. Rewritten as SC-001, which measures the user-visible
   outcome (the running program survives the move) rather than the mechanism.

**Iteration 2 (2026-07-10, `/speckit-clarify`)** — five questions asked and answered; all 16 items
still pass (16/16 → 16/16, no state changes). The clarifications materially enlarged the spec
(FR-029 → FR-030d, FR-032a, FR-036a → FR-036e, FR-066a → FR-066c) and **reversed one earlier
decision**:

- *Escape no longer releases panel focus.* The specify-phase decision made Escape the focus-release
  key. The user reversed it during clarification because Escape is a valid, frequently-used key in
  terminal-hosted programs. Focus release is now a rebindable `panel.releaseFocus` action defaulting
  to `F6` (FR-019, FR-020). The superseded statements in User Story 3, the Edge Cases and the
  Assumptions were rewritten rather than duplicated, and the Clarifications entry records the
  supersession explicitly.
- *A stated fact in the spec was wrong and was corrected against the code.* The draft assumed one
  chord per action. `Keybindings.bindings` is `Record<string, string[]>` and mouse gestures
  (`Ctrl+WheelUp`, `Ctrl+MiddleClick`) are already binding tokens. FR-016/FR-017 were simplified
  accordingly and FR-066c records the real model.
- *Scope of the theme-quality assertions was bounded* (FR-039, FR-042). Pairwise distinctness is
  enforced across all bundled themes; contrast is enforced only for the three themes in scope and
  reported for the rest. Without this, a strict contrast rule would have pulled roughly nine
  unrelated themes into a "tweak" pass.

**Iteration 3 (2026-07-10, second `/speckit-clarify`)** — five questions asked and answered; all 16
items still pass (16/16 → 16/16, no state changes). This pass closed the categories the previous one
had left Partial or Missing, and uncovered two defects the user had not reported:

- *Hidden scope was made explicit.* FR-016/FR-017 named `terminal.find`, `editor.find`,
  `editor.replace` and `editor.gotoLine`, none of which have a surface in the product. Rather than
  discovering this during implementation, it is now **User Story 14** with FR-066d–h. The user chose
  to build the widgets. This is the largest single addition to the pass and should be weighed at
  `/speckit-plan` — it is a feature wearing a bugfix's clothes.
- *Terminology became testable.* FR-060 previously demanded consistency without naming the verbs.
  FR-059 now fixes exactly four (Close, Destroy, Remove, Delete) and FR-059a gives a per-target
  matrix, because the same control has different consequences depending on whether its target is
  project-owned or sub-workspace-owned. "Remove" replaces "Destroy" for projects so the label stops
  implying source code is deleted.
- *Two unreported defects surfaced while clarifying the error bar.* The terminal-exit notice does not
  clear until the panel loses focus, and the "Clear" control is wired to the error state rather than
  to the form. FR-057a and FR-057b separate the two concerns.
- *Accessibility entered the spec for the first time.* FR-058 said "animate continuously", which is
  neither testable nor safe. FR-058a–c define a non-vanishing opacity pulse, synchronised across the
  three indicator sites, that honours the reduced-motion preference.
- *A data-model gap was filled.* FR-018 said zoom affects "the focused panel" without saying where it
  is stored. FR-018a–c place it on the panel: persisted across restarts, shared by every view, and
  outliving whichever terminal or editor the panel currently hosts.

### Scope notes

- FR-037 amends the project constitution. It is a governance change and should be landed via
  `/speckit-constitution` before the code-review gate is asked to enforce it on the remaining work.
- The user's item "the buttons in the theme editor do not seem to be themeable" and the item
  "all buttons for saving, renaming, restoring should be themeable icons" are covered together by
  FR-034 and FR-037; the underlying cause is that the preferences toolbars use hardcoded inline
  graphics rather than the theme's icon set.
- The user's item "the rename theme buttons need aligning" is partly superseded by FR-031 (Save As
  replaces Rename), but the toolbar alignment defect is retained independently as FR-035.
- FR-068 records the user's explicit instruction that every item be delivered test-first.
- The user's item "the rename theme buttons need aligning" now sits alongside a much larger theme-editor
  change than originally scoped: four theme-level actions (FR-029), a working restore (FR-030a), a new
  revert (FR-030b), shipped-default artifacts spanning themes, settings and key bindings (FR-030c), and
  preferences chrome that honours the font settings (FR-036a/b). This is the largest single growth in
  the pass and should be watched at `/speckit-plan`.
- FR-030c (shipped defaults as immutable build artifacts) is the only requirement in this pass that
  changes how configuration is distributed. It is a prerequisite for FR-030 and for the existing
  preferences-level reset, and it touches settings and key bindings as well as themes.
- Deferred to planning, deliberately: the session-establishment time budget (FR-004) and the perceptual
  distance / contrast constants (FR-039, FR-042) are numeric constants, not behaviours. The spec fixes
  the requirement; the plan fixes the value.
- **Scope has grown materially across three clarification passes.** The spec now carries 14 user
  stories, 98 functional requirements and 19 success criteria, against the 13 / 68 / 12 it began with.
  Three items are no longer "tweaks": User Story 14 (find and replace surfaces), FR-030c (shipped
  defaults distributed as build artifacts, spanning themes *and* settings *and* key bindings), and the
  theme-editor action set (FR-029 through FR-030d). Recommend splitting at `/speckit-plan` rather than
  attempting a single delivery.
