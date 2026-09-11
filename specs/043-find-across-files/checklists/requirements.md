# Specification Quality Checklist: Find / Replace in Files

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-08
**Last revalidated**: 2026-09-09, after the round-two amendment (Session 2026-09-09) added FR-060 to
FR-078a and marked fourteen supersessions. Nothing was deleted or renumbered; every superseded
requirement, assumption, scope line and acceptance scenario keeps its text and carries a marker
naming what replaced it and what survived. The four decisions with no defensible default —
removing per-folder grouping, removing the scope readout, taking the cross-theme contrast rule into
scope, and taking the sub-workspace results gap into scope — were put to the maintainer and answered
directly; every other answer is marked **(derived)** in the clarifications.
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

## Governance checks specific to this repository

- [x] **Existing requirements searched before new ones were written.** `specs/*/spec.md` and the
      search sources were searched for the behaviour this feature changes, per the CLAUDE.md rule.
- [x] **The apparent conflict with 013 was resolved by reading its scope, not by overriding it.** The
      draft had written 013 FR-002 up as two supersessions. That was wrong: 013 FR-001 scopes every
      013 requirement to *the active panel's own content*, so "one shared find bar" and "no separate
      results-list panel" never governed a search over files on disk. The spec now states this
      explicitly and **supersedes nothing**. 033 FR-026a was likewise checked and is untouched.
- [x] **A claimed capability was verified against the code.** The draft asserted regex match modes;
      `search-model.ts:14` carries only `caseSensitive` and `wholeWord` and records "Regex is
      deferred". Confirmed in clarification as out of scope for both surfaces (FR-040) and moved to
      its own vNext issue.
- [x] **A specified chord was verified against the bindings.** `Ctrl+Shift+T` is bound to
      `navigate.quickOpen` (`keybindings.ts:311`, shipped by 033 FR-002). The chords are now
      `Ctrl+Shift+F` and `Ctrl+Shift+H` (FR-029).
- [x] **Constitutional obligations this feature triggers are carried as requirements**:
      every-panel-action-has-a-menu-item (FR-015, closing a named pre-existing gap); digit grouping
      (FR-014, closing a named pre-existing gap on this exact surface); themeable icon controls
      (FR-011); menu section vocabulary (FR-029b); disabled-when-unavailable (FR-029a);
      reachable-without-instruction (FR-029c); one-document-one-state (FR-025, FR-052); project
      isolation (FR-018); externalised configuration (FR-059). **One condition, one notice (FR-045f,
      FR-058) is a CLAUDE.md project convention, not a constitutional rule** — it was cited as
      constitutional in the first draft and corrected on 2026-09-08 after the constitution was
      searched for it and it was not there.
- [x] **Requirements 013 already owns were inherited rather than re-decided**: encoding and
      line-ending preservation (FR-056), single-undoable-step replace (FR-057), rebindable commands in
      the Key Bindings editor (FR-028), themed match-highlight tokens (FR-044), a clear no-results
      state (FR-042).
- [x] **A constitutional obligation the spec had silently skipped was found and closed.** The second
      clarification pass found nothing in the spec about an application restart, while Constitution VI
      and XI both require a Panel to be persisted per project and restored on reopen. Now FR-027a–d,
      including the rule that an uncommitted replace preview is discarded rather than restored.
- [x] **The write path does not depend on the display being correct.** FR-045a marks staleness per
      file for the user's benefit; FR-054 re-checks every match against the file's current content
      immediately before writing, unconditionally. The second does not rely on the first having
      caught up — that separation is deliberate and is asserted by User Story 4, scenario 10.
- [x] **No preference introduced here can be inert.** FR-059 tabulates all **six** with their shipped
      defaults and FR-059a requires each to have a reader outside the config layer — the class of
      defect #108 exists to catch. The sixth, the as-you-type settle interval, was added during
      analysis: it reaches the preference editors, so it is a preference rather than an internal
      constant, and `settings-inertness-043.test.ts` names all six.
- [x] **The one path that could destroy work is bounded and announced.** FR-057 and SC-007 both scoped
      reversibility to open editors, leaving a commit across unopened files irreversible and silent.
      Now FR-057a–d: stated as irreversible, warned before writing with a file count, governed by a
      preference shipping on, and suppressed when every affected file is open and therefore undoable.
- [x] **A commit writes nothing the user did not ask it to write.** FR-053a–c: no editor is saved, so
      unrelated work-in-progress is never persisted as a side effect, and FR-052's undoable edit stays
      undoable. The resulting mixed on-disk/in-buffer state is stated rather than left to be
      discovered.
- [x] **The new panel's own actions reach a menu.** FR-025a puts run, cancel, replace toggle, grouping,
      scope, collapse/expand and each commit granularity in the panel's menu, in the section
      vocabulary. Without it the feature would have added a panel type whose every action was
      chord-or-click only — the gap Constitution VI names.
- [x] **Every listed edge case is resolved by a requirement or by an existing rule, none left open.**
      The two-panels-one-file case resolves through FR-045a and FR-054 with no panel-to-panel
      coordination; the last-panel-in-a-tab case resolves through Constitution XI unchanged.
- [x] **Terminology is single-valued.** The spec opens with a terminology table and uses one name per
      concept throughout; "search panel", "results panel", "global find" and "project-wide find" do
      not appear.

## Notes

- **Twenty-three clarifications**, all recorded in the spec's **Clarifications** section and integrated
  into requirements. Twenty-one came from interactive clarification; the last two are consolidated
  entries recording corrections that **planning and analysis** forced, where the codebase or an older
  requirement said something the spec had assumed otherwise. They are not subdivided by session in the
  spec, so no per-session breakdown is claimed here.
- Session three's questions came from re-reading the *replace* path rather than the search path, which
  is where the two remaining material gaps were: irreversibility of writes to unopened files, and
  whether a commit saves the editors it touches. Both were listed as edge cases from the first draft
  and neither had a requirement answering it.
- Session one's fourth answer changed the design rather than selecting an option: the panel model
  moved from one search per project to many independent Find in Files panels, opened in the current
  tab, governed by a new preference. The spec was rewritten rather than patched, to keep terminology
  consistent.
- Session two's second answer chose per-file staleness marking over a panel-level indicator, with the
  explicit condition that it must not block the user from acting on any row. That split the concern in
  two: staleness informs (FR-045a–d), the pre-write re-check protects (FR-054).
- No `[NEEDS CLARIFICATION]` markers remain. Three decisions are recorded as **Assumptions** rather
  than questions because a defensible default existed: what the three grouping modes look like
  structurally (FR-033); that result rows are keyboard-reachable, with full keyboard-only support left
  to #26 (vNext); and how a Find in Files panel is named. A fourth — how retained results are offered
  back — **no longer exists**: FR-023 now retains nothing, so there is no retrieval surface to design.
- **No match-count ceiling is specified.** SC-004 bounds the file count at 5,000 and requires
  progressive results and a responsive interface, but nothing caps matches. Recorded as an assumption
  for planning to revisit if a limit proves necessary.
