# Specification Quality Checklist: Preferences & Settings — Granular Reset Controls

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-11
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

- **All clarifications resolved (2026-07-11 → 2026-07-12).** No `[NEEDS CLARIFICATION]` markers remain. **Twenty-two** decisions are recorded in spec §Clarifications across six sessions. The first eight:
  1. Reset-everything ownership → **015 owns the global reset**; 014 keeps a themes-only restore.
  2. Per-item confirmation → **none**; single-item resets apply immediately (only the global reset confirms).
  3. Affordance visibility → **only when the item is overridden**; the affordance doubles as the "modified" cue.
  4. Feature 007's existing controls → per-tab "Reset to Defaults" **re-pointed at feature 010's record**; "Revert All" (a session undo) **left unchanged**.
  5. Global reset placement → **preferences toolbar**, reachable from every tab.
  6. Themes-tab duplicate → per-tab reset is **hidden on the Themes tab** (014 already restores each built-in theme row).
  7. Confirmation model → ~~014's shared modal dialog~~ **superseded**: unification is deferred to **issue #48** (toast refactor, v1.0.0); 015 reuses the existing inline strip and the two models coexist.
  8. Sequencing → **014 merges first**; it is a hard dependency, not merely a related feature.
- **A sixth session (post-merge verification, 2026-07-12) re-checked every claim this spec makes about feature 014 against the *merged* code**, now that 014 and 013 are on master. Confirmed intact: the shared icon-button, the shipped-defaults IPC seam, single-theme restore — and, critically, that `resetEverything`/`resetBinding`/`resetSetting` are **still unexposed to the renderer**, so 015's core work stands. Four decisions: the session undo's `prefs-reset-all` identifier is renamed `prefs-revert-all` while the global reset takes `prefs-reset-preferences` (FR-012b); resets use `retry` for one-item/one-tab and `restoreAll` for the global (FR-009a); **every** hard-coded icon in the window is tokenised, including the settings-search clear and the chord-pill remove (FR-009b); and the UI⇄JSON toggle becomes a glyph, which adds **exactly two** new theme tokens with copy (FR-009c, superseding the earlier "no new tokens"). Three corrections forced by the merged code: the claim that 014 had migrated the preferences-reset E2E suite was **false**, so updating its four contradicting assertions is 015's work (FR-014); 014 already re-pointed the per-tab reset's *Themes* branch at feature 010's record, leaving 015 to hide it there and re-point Settings/Key Bindings; and no action currently ships unbound, so FR-004b is a correctness rule with no live instance.
- **A third session (planning readiness) settled the five decisions a planner would otherwise have had to guess**, all of which drive test design: ~~no new theme tokens~~ (superseded by FR-009c above); the "clear feedback" on a per-item reset *is* the row's own state change, with no toast or flash (FR-004c); write failures surface in an inline dismissable error that states nothing was changed (FR-006a); a binding is overridden only if its **normalized chord set** differs, so reordering chords is not a modification (FR-004b); and Reset All resets the active-theme *selection* too, while preserving custom theme files (FR-005a).
- **Boundary with feature 014 verified against the implemented code, not just the specs** (014 is complete on its branch, unmerged). 014 owns the entire themes surface *and* the shared infrastructure: the shipped-defaults IPC seam, the themeable icon-button, the modal confirmation dialog, and single-theme restore. 015 consumes all four and builds none of them (FR-009, FR-010). Recorded in Depends on / Assumptions / Out of Scope.
- **A fifth session (naming & the limits of "all") pinned the blast radius and corrected the naming.** The global control resets settings, key bindings and built-in themes — but **not** projects, window layout, workspace state or custom themes (FR-005b), and its confirmation must now say **both** what is reset and what survives (FR-006, SC-015). Because "all configuration" over-claimed, the control is renamed **"Reset All Preferences"**, and the naming rule generalises: every all-preferences control says so ("Revert All Preferences" — a label-only change to feature 007's session undo), while narrower controls must not claim breadth they lack (FR-012a).
- **A fourth session (contradictions & modes) resolved three internal conflicts**: (a) retiring the inline confirm strip would have broken the per-tab reset and Revert All that depend on it, so notice-surface unification is **deferred to issue #48** and 015 reuses the inline strip (SC-011 relaxed accordingly); (b) an action that **ships unbound** has an *empty* shipped chord set — binding it is an override and reset returns it to unbound (FR-004b), so the "no shipped value" carve-out now applies only to entries absent from feature 010's record; (c) per-item resets are **UI-mode only**, while the toolbar controls work in JSON mode too and refresh the visible document (FR-013a).
- Key correction captured during clarification: feature 007 did **not** ship a "coarse reset all". It shipped a per-tab reset (against editor-compiled defaults) and a session-undo. FR-011/FR-011a/FR-012 now describe the real controls, and SC-009 requires collapsing onto feature 010's single notion of "shipped".
- All quality items pass.
