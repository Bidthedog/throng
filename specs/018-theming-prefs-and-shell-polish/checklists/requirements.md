# Specification Quality Checklist: Theming, Preferences & Shell Polish

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-13
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

**All items pass.** FR-001 → FR-067, contiguous; SC-001 → SC-013; nine user stories, one per in-scope issue.

## Notes

### The three escalated decisions — all resolved (2026-07-13)

Three questions changed scope, contradicted shipped code, or reinterpreted a source issue, and had no defensible default. All three were put to the user and are now written into the requirements, with the reasoning recorded in the spec's *Resolved Decisions* section:

1. **Sub-workspace open scope (FR-058 – FR-060)** — keep feature 006's confinement rule and apply it on the **load** path too. A sub-workspace editor may open files from anywhere *except* inside a loaded project, and may neither open nor save into a project folder. Read scope now equals write scope. This rejects issue #60's literal "any file from anywhere", and in doing so **fixes a live defect** neither the issue nor 006 noticed: the load path never applied that rule at all, so a sub-workspace editor could already open a file it would silently refuse to save.
2. **Project settings (FR-040 – FR-047)** — project-scoped values do **not** go in the Preferences window. They get their own dialog, opened from an options icon on the File & Folders pane. This reverses issue #58's proposal and, in doing so, **deletes the hardest design problem in the feature**: no scope concept in the settings registry, no surgery on the completeness audit, no meaningless "reset to shipped default" on a value that has none.
3. **Notice models (FR-048 – FR-054)** — **two** models, not the one issue #48 asked for: a modal confirmation and a transient notification. A confirmation is blocking and its buttons must keep text labels (constitution); a toast is not. The complete sweep also retires the fifth idiom, the non-dismissable restore notice.

Every other open detail in the source issues was resolved with an informed default and recorded in **Assumptions** rather than escalated.

### Grounding

This spec was written against the code as it exists on `master`, **not** against the source issues' description of it. A parallel survey of the theming, preferences and shell subsystems produced five material corrections, recorded in the spec's *Corrections to the source issues* section. The two that most change the work:

- **The `panelSurface` token named in issue #62 does not exist.** The real token is `surface` — the issue's name comes from its copy label, "Panel surface". Its overuse is *worse* than reported (~30 call sites, not 8), its sibling `surfaceActive` is overloaded in the same way, and four of the files the issue names as offenders do not reference it at all.
- **Issue #56 is substantially cheaper than it claims.** It assumes the preferences window is a separate renderer that cannot reach the shared menu provider. There is one renderer bundle, routed by query string: the provider is already importable and its stylesheet already loaded. It is simply never mounted.

### Hazards deliberately surfaced as requirements, not left to be discovered

- Adding colour tokens **will** move feature 009's theme-distinctness calibration constant, which is asserted to two decimal places. Re-deriving it is a required task (FR-006), not a test failure to work around.
- The token-copy test bans a list of abbreviations and rejects machine-derivable descriptions, constraining how new tokens may be named and described (FR-004).
- The theme has **no settings/cog icon token** — which is precisely why the cog menu draws a hard-coded inline vector (the #56 defect). Both the cog menu and the new project-settings options icon need one, so a single new token serves both (FR-015).
- `step` is already declared on every numeric descriptor and **never read**. FR-035 makes it load-bearing.
- The typed numeric field commits on blur/Enter and reads from the live input — a deliberate fix for a CI flake. A slider streams values continuously; FR-036 requires the two be reconciled without reintroducing that defect.

### This feature stands alone

No requirement here waits on unmerged work, and the spec references no in-flight feature. That is enforced, not incidental. The one cross-feature obligation that would otherwise have lived inside FR-032 — reconciling feature 007's *exhaustive* control-vocabulary declaration, which more than one feature extends — is pushed out to **#79** and is explicitly out of scope. A requirement whose correct wording depends on another feature's landing order does not belong in this spec, because it makes this spec's correctness contingent on someone else's schedule.

Likewise, the one backlog issue that genuinely needs a control this feature does not build is scheduled independently on its own issue, and is not part of this scope.

### Next

Ready for `/speckit-plan`. `/speckit-clarify` is **not** required — its three questions were asked and answered during specification.
