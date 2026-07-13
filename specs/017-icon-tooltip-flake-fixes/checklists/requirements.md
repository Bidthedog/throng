# Specification Quality Checklist: Defect Sweep — Icon Packs, Header Tooltips & a Flaky Pane Test

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-12
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

**Validation pass 1 — issues found and fixed inline:**

1. *Success criteria were not measurable.* An early draft asserted the flaky test "no longer flakes",
   which is unfalsifiable. Replaced with **SC-004** (passes 20 consecutive runs with retries
   disabled) and **SC-005** (one unfiltered full run, zero failures and zero flaky results) — both
   directly observable.
2. *Scope boundary with Set A was implicit.* Made explicit in **Out of Scope**, with the reason
   stated: every excluded issue requires new theme tokens across the fourteen bundled themes, which
   is precisely what keeps this batch independent.
3. *#57's premise was overstated for tabs.* The panel title is truncated; the tab title is not.
   Rather than assert a false justification, **FR-008** now scopes the tab tooltip as a
   reachability/consistency fix and the Clarifications section records why.

**Decisions taken as informed defaults rather than clarification questions:**

- **Retries.** The constitution (Principle V, v3.14.0) already settles this: a flake must never be
  "absorbed into a green bar by repetition". FR-014 therefore requires a retried-then-passed test to
  be reported as flaky and not treated as a clean pass, while allowing retries to remain configured
  for genuinely transient infrastructure faults. Recorded in Assumptions; a decision to set retries
  to zero outright would be a one-line amendment there. No [NEEDS CLARIFICATION] marker was spent on
  a question the constitution answers.

**Validation pass 2 — after `/speckit-clarify` (2026-07-12), 3 questions asked and answered:**

Status held at 16/16. The three answers *tightened* existing requirements rather than adding new
ambiguity, and one previously-hedged assumption is now a decision:

1. **Flake audit scope** (FR-013a, new). "Every instance of this pattern in the suite" was
   ambiguous between one file and the whole suite — a large difference in effort. Now explicitly the
   shared harness plus every E2E spec, in both its forms (unguarded raw read; unconditional sleep),
   with anything deliberately left required to be reported. Measurable as SC-008.
2. **Flake enforcement** (FR-014 rewritten, FR-014a new). The spec previously said a flake "MUST NOT
   be treated as a clean pass" without saying what enforced it — and the runner exits 0 on flaky
   results, which is exactly how #66 hid. Now: a flaky result **fails the run**, locally and in CI.
   The Assumptions entry that hedged toward a possible reversal is replaced by the decision.
   Measurable as SC-007.
3. **Icon load cost** (FR-006a/FR-006b, new). Non-functional performance was **Missing** — a genuine
   omission, since making pack icons theme-coloured means inlining SVG markup, and the explorer
   resolves an icon *per row*. Now: loaded once, served from memory, zero disk reads on the render
   path, no perceptible regression, no progressive "pop in". Measurable as SC-009.

Consistency swept after each write: the User Story 3 acceptance scenario that still read "does not
present the run as a clean pass" was replaced with the stronger "the run fails", leaving no
contradictory statement behind.

**Validation pass 3 — second `/speckit-clarify` (2026-07-12), 2 questions asked and answered:**

Status held at 16/16. Two categories that were still **Missing** are now closed. Only two questions
were asked, of a permitted five — the remaining candidates were low-impact and are listed as
Outstanding below rather than padded into the session.

4. **Accessibility semantics** (FR-006c/006d, new). Was **Missing**, and would have been expensive to
   retrofit: FR-004 replaces text glyphs with inlined graphics across 14 call sites at once, so
   the assistive-technology contract had to be settled before implementation, not after. Icons are
   **decorative**, hidden from assistive technology; the accessible name comes from the enclosing
   control (which the constitution already requires to carry a hover title naming its action). This
   also fixes today's latent defect, where a raw glyph character is read aloud. Measurable as SC-010.
5. **Failed-pack surfacing** (FR-004a, new; Edge Cases tightened). Was **Partial** — the spec said to
   fall back, but not whether the user is told. A silent fallback would have reproduced the exact
   confusion this feature exists to remove (a chosen setting that appears to do nothing). Resolved as:
   fall back, and show the pack as unavailable **with its reason** in the Preferences → Icons picker
   — no global notice, which would have meant building a notification surface that overlaps #48.
   Measurable as SC-011.

**Outstanding (low impact, no question spent):**

- ~~The term "quarantine" … left undefined.~~ **SUPERSEDED (pass 4).** The baseline found 10 first-run
  failures, which promoted quarantine from a governance escape hatch to **real work on real tests**.
  It is now specified: **FR-013b** + `contracts/e2e-harness.md` §4a — a `@quarantine` tag on its own
  independent `grepInvert` toggle, so lost coverage is enumerable by command.
- Whether the Preferences → Icons grid keeps its present preview layout. FR-004 already binds its
  colours; the layout itself is untouched by this feature and is a plan-level detail.

**Deliberately deferred to `/speckit-plan`:**

- The verified technical diagnosis (call sites, the exact race, the retry configuration) is
  summarised in the Clarifications section as provenance, but the file-level detail belongs in
  `research.md` at plan time, not in a spec that must stay free of implementation detail.
