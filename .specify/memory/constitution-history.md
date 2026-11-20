# throng Constitution — amendment history

The written record of how every amendment to [the constitution](constitution.md) was argued: each
amendment's Sync Impact Report, newest first, then the standalone amendment notes that once trailed
the constitution. Moved here verbatim at v7.2.1; the constitution itself carries only the Sync Impact
Report of its latest amendment, which moves here, newest first, when the next one is made.

Each record is an HTML comment, so read this file as source rather than rendered.

## Sync Impact Reports, newest first

<!--
SYNC IMPACT REPORT
==================
Version change: 7.3.0 → 7.4.0 (supersedes 8.0.0, which was never released: it existed only as an unpushed commit on
                feature/S073-S074-S075-file-previews, and nothing in the repository cites it)
Bump rationale: MINOR. The maintainer's "Yes" (2026-11-20 12:17) answered a question framed around the modifier tiers
                and the redundant editor.toggleWordWrap exception entry. 8.0.0 read it more widely and withdrew a
                terminal guarantee the maintainer was not shown. This amendment keeps the guarantee, pending their
                confirmation, and encodes only the narrower rule:
                - Multi-stroke chords are categorically outside the three modifier tiers (the Ctrl/Shift/Alt
                  placement tiers) and need no recorded exception for their modifiers, so the word-wrap entry
                  stays removed.
                - Restored verbatim: a multi-stroke chord's first stroke is judged by the terminal tiers, and a
                  multi-stroke chord whose first stroke is reserved MUST NOT be live in any scope that includes a
                  terminal. "The tiers never override the terminal tiers" is restored to its 7.3.0 wording.
                Argued against the project's own test. It is not MAJOR, because measured from 7.3.0 no
                guarantee is withdrawn and no compliant work becomes non-compliant. It is not PATCH, because it
                removes an obligation conforming work had: under 7.3.0 a multi-stroke default was entered in IV's
                exhaustive exception list, justified by its spec (word wrap by 046, the markdown.* fold commands by
                047 research R5); from 7.4.0 none is. A materially changed rule that adds no obligation and
                withdraws no guarantee sits with MINOR, beside 7.1.0's bounded CI exception.
Why 7.4.0 and not 8.0.1: renumbering is safe. 8.0.0 was never pushed, released or tagged, and `git grep` finds no
                citation of it outside the constitution. A PATCH on top of 8.0.0 would leave a MAJOR in the record
                that the published constitution never had. The 8.0.0 report stays in constitution-history.md,
                marked superseded before release.
Modified principles: IV (Outside the tiers: multi-stroke chords outside the modifier tiers, first-stroke terminal
                rule kept; Recorded exceptions: no editor.toggleWordWrap entry; the 8.0.0 bullet placing
                multi-stroke chords outside the terminal tiers removed).
Modified sections: none outside IV. Added sections: none. Removed sections: none.
Enforcement: the code and docs already agree with 7.4.0. packages/core/src/config/keybindings.ts (firstStrokeIsReserved,
                terminalMultiStrokeAllowed; 048 FR-024) and docs/key-bindings.md › Multi-key chords refuse a
                multi-key chord on a terminal-live command whose first key is reserved.
                ⚠ packages/core/tests/unit/keybindings-tiers.test.ts, not edited: its modifier-tier check
                exempts a two-stroke token only for the seven actions in TWO_STROKE_EXEMPT_ACTIONS
                (editor.toggleWordWrap and the six markdown.* fold commands). Under 7.4.0 the exemption is
                categorical, so a future multi-stroke default on any other action is compliant but would fail
                the test until it is added to that set.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ spec-template.md, tasks-template.md, checklist-template.md — no chord rules; no edit.
           ✅ .specify/extensions.yml — no constitution hooks registered.
           ✅ docs/key-bindings.md — consistent with 7.4.0; no edit.
Deferred: (1) the maintainer's confirmation that the terminal guarantee stays; (2) whether
          TWO_STROKE_EXEMPT_ACTIONS becomes a categorical isTwoStrokeToken exemption.
-->
<!--
SYNC IMPACT REPORT — SUPERSEDED BEFORE RELEASE by 7.4.0 (see the 7.4.0 report, which the constitution carries
or which sits above this one). 8.0.0 was never pushed or released; the constitution went from 7.3.0 to 7.4.0.
==================
Version change: 7.3.0 → 8.0.0
Bump rationale: MAJOR — the maintainer's answer (2026-11-20 12:17) to "should multi-stroke chords (the markdown.*
                Ctrl+M,* two-stroke defaults, editor.toggleWordWrap Ctrl+E,W) be exempt from the key tiers
                altogether?": "Yes". Principle IV now puts multi-stroke chords categorically outside both the
                three modifier tiers and the terminal tiers (reserved and shadowable). Argued against the
                project's own test:
                - For MINOR: no shipped default changes and nothing compliant becomes non-compliant; every
                  multi-stroke default ships editor- or Markdown-only, never live in a terminal, and the
                  modifier-tier half only states for every multi-stroke chord what IV already said
                  ("Outside the tiers: multi-stroke chords") and the tier test already allows for the
                  named actions.
                - For MAJOR, which decides it: IV stated a guarantee that is now withdrawn — "A multi-stroke
                  chord whose first stroke is in the reserved tier (Ctrl+E, Ctrl+K, …) MUST NOT be live in any
                  scope that includes a terminal", and that a multi-stroke chord's first stroke is judged by the
                  terminal tiers. After this amendment a future multi-stroke default MAY be live in a terminal
                  on a reserved first stroke and consume it. A relaxation that withdraws a stated guarantee is
                  MAJOR whether or not any shipped code exercises it.
Modified principles: IV (Terminal keys belong to the terminal: a bullet placing multi-stroke chords outside both
                tiers; Outside the tiers: the multi-stroke bullet restated categorically, the first-stroke rule
                removed; Recorded exceptions: the editor.toggleWordWrap entry removed as redundant; "The tiers
                never override the terminal tiers" excludes multi-stroke chords).
Modified sections: none outside IV. Added sections: none. Removed sections: none.
Enforcement (packages/core/tests/unit/keybindings-tiers.test.ts, read 2026-11-20, not edited): the modifier-tier
                check exempts a two-stroke token only for the seven actions named in TWO_STROKE_EXEMPT_ACTIONS
                (editor.toggleWordWrap and the six markdown.* fold commands), deliberately not categorically,
                so a future two-stroke default on another action still fails it; no test applies the terminal
                tiers to any chord's first stroke. The rule is therefore broader than the test: categorical
                where the test names actions.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ spec-template.md, tasks-template.md, checklist-template.md — no chord rules; no edit.
           ✅ .specify/extensions.yml — no constitution hooks registered.
           ⚠ packages/core/tests/unit/keybindings-tiers.test.ts — exempts by named action, not
              categorically (above); left as is, for the maintainer to decide.
           ⚠ packages/core/src/config/keybindings.ts (firstStrokeIsReserved, terminalMultiStrokeAllowed;
              048 FR-024) and docs/key-bindings.md › Multi-key chords still apply the withdrawn rule: the
              capture box refuses, and a load ignores, a multi-key chord on a terminal-live command whose
              first key is reserved. Stricter than the constitution now requires, so still compliant; left
              as is, for a spec to relax or keep.
Deferred: whether the tier test's named-action exemption becomes categorical, and whether 048 FR-024's
          first-key refusal is relaxed to match.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 7.2.1 → 7.3.0
Bump rationale: MINOR — one additive rule from the maintainer (2026-11-20): "Any reference to a setting should use
                the setting value, rather than a estimate / default. This should be a constitution rule."
                Principle X gains "Settings are quoted by value": user-facing text about a quantity a setting
                governs states the setting's current value, in the unit its Preferences control displays,
                digit-grouped. A new constraint the shipped code partly fails, so MINOR by the project's own
                test; no guarantee is withdrawn.
Modified principles: X (new rule before its rationale; one rationale sentence added).
Modified sections: none outside X. Added sections: none. Removed sections: none.
Audit (2026-11-20, at 064b34de): user-facing strings across packages/*/src stating a number with a unit, every
                "too large" text, and every setting description carrying a number. Six known violations, listed
                in the rule: the preview too-large notice (bytes for an MB-displayed spreadsheet limit); the
                editor's "too large to open" notice (names the limit, states no value); the drop refusal
                (ungrouped); the capture-interval description (copies the minimum-interval bands); and the
                editor and media Maximum file size descriptions (hard-code "5 MB steps"). The numeric-settings
                work on this branch fixes them. Not counted: a log line (machine-read), and the embedded-diagram
                "too large" refusal in packages/core/src/preview/embeds.ts, which states no quantity and whose
                governing setting, if any, was not established.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ spec-template.md, tasks-template.md, checklist-template.md — name no setting copy; no edit.
           ✅ .specify/extensions.yml — no constitution hooks registered.
           ✅ docs/preferences.md — lists defaults as defaults, which the rule permits; no edit.
Deferred: the six known violations, fixed by the numeric-settings work on this branch.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 7.2.0 → 7.2.1
Bump rationale: PATCH — a consolidation the maintainer asked for (2026-11-20: "removing fluff or obsolete
                statements"). No guarantee in force is withdrawn and no new obligation is added. What goes:
                amendment history (every Sync Impact Report and the trailing amendment notes, moved verbatim
                to constitution-history.md, the 5.0.0 note given the closing marker it lacked); inline
                version tags and dated Records; worked examples and origin stories; and known-violation lists
                whose violations are fixed, each checked against the code at 28539543. Every MUST that
                still binds is kept, restated once where it was stated twice.
Modified principles: I (explorer empty-shell and deferred-Markdown-preview clauses, both delivered); II (version
                tags; the "no seam has a macOS implementation" violation, closed by packages/platform-macos;
                the pipeline sentence, now a reference to the CI gate); III ("Terminal and Panel are
                separate" stated once, in XI; the Unload exception's tag and justification); IV (one
                exhaustive list of terminal-tier exceptions, each one line with its spec and FR; the v4.3.1
                retirement and its Records; the tier heading's attribution; the keypad rule, its named
                exceptions and its correction collapsed into one statement matching keybindings.ts, so the
                AltGr check's keypad note names `+` and `-` only, `Numpad0` being a key of its own; the
                v5.7.1 split-command Record; xterm byte-level detail, keeping the normative sentence; the
                fixed "Known violations at v5.6.0" list; `Ctrl+E W` written `Ctrl+E,W`); V (the E2E reserve as
                a nine-row table keyed by the @reserve ids e2e-tags.test.ts enforces; anecdotes and the
                inline rationale folded into the principle's rationale; test-run hygiene and temp-file
                prose cut, every MUST kept); VI (project colour moved into the opening list; "Name a
                setting for its behaviour" its own rule; cog-menu audit history and Records; the Ctrl+Enter
                history; "Conforming today" and "Conforming since" inventories; version tags); X (version
                tag); XI (explorer empty-shell clause; the fixed focus-follows-panel and loaded-panel-state
                violation lists, closed by 046 FR-125 and 049's panel-state-capture.ts); XII, XIII (origin
                stories; XIII keeps all four things failure-logging-guard.test.ts enforces).
Modified sections: Technology & Architecture Constraints (sub-workspaces-on-demand, a repeat of XI); Development
                Workflow & Quality Gates (plan-evaluation bullet merged into Governance; version tags; the
                find-bar digit-grouping gap, closed by formatGrouped in find-bar.tsx, and the quick-open
                evidence sentence; the sync-scroll-button.tsx setting-toggle gap, closed by 073; the code-review
                bullet now cites the gates rather than restating them); Governance (the plan-evaluation rule,
                and a pointer to constitution-history.md).
Added sections: none. Removed sections: none. Every ## and ### heading is byte-identical, so the anchors
                docs/architecture.md resolves still resolve.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ spec-template.md, tasks-template.md, checklist-template.md — cite no removed text; no edit.
           ✅ .specify/extensions.yml — no constitution hooks registered.
           ✅ .claude/skills/throng-spec-governance/SKILL.md — pointed at constitution-history.md for the
              record of past bumps.
           ✅ CONTRIBUTING.md — "11 principles" corrected to 13; the "UI-needs-E2E" summary of V, withdrawn
              at 5.0.0, corrected to the lowest-layer rule.
           ✅ .github/PULL_REQUEST_TEMPLATE.md — the "user-facing UI change ships passing E2E coverage
              (Principle V)" box, withdrawn at 5.0.0, reworded to today's V.
           ⚠ throng-terminal-pty skill — not edited here; the xterm byte-level detail dropped from IV
              (what tier 1 and tier 2 cost a terminal) is not recorded there. Its last statement is in
              constitution-history.md and 046 research R22.
Deferred: six maintainer questions, left untouched by this amendment — III's presets bullet; VII and the
          edit-list constraints; IV's editor.columnSelect* parenthetical; IV's R22 live-check sentence; IV's
          multi-stroke chord list (only its notation changed, to `Ctrl+E,W`); XI's sub-workspaces pinned
          bottom.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 7.1.0 → 7.2.0
Bump rationale: MINOR — one additive rule from the maintainer (2026-11-20): "default actions in any dialog or modal
                should be highlighted in a different colour". Development Workflow & Quality Gates › Action controls
                gains "Default dialog actions", beside the existing dialog-decision-buttons exception. No guarantee is
                withdrawn.
Modified principles: none.
Modified sections: Development Workflow & Quality Gates › Action controls (new "Default dialog actions" sub-rule).
Added sections: none. Removed sections: none.
Audit (2026-11-20): the confirmation model (confirm-dialog.tsx, `.modal__confirm`), the Preferences name dialog and
                the key-capture modal (`capture-modal__btn--primary`) already comply. One known gap, the CSV cell
                dialog's Save (packages/ui/src/renderer/grid/cell-dialog.tsx), drawn as a Cancel-type button, is
                fixed by spec 073 in the same change.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ spec-template.md, tasks-template.md, checklist-template.md — name no control styling; no edit.
           ✅ .specify/extensions.yml — no constitution hooks registered.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 7.0.0 → 7.1.0
Bump rationale: MINOR — two additive rules from the maintainer's spec 076 review (2026-11-19), and one bounded exception
                to the PR-CI gate (Static analysis & linting): a pull request whose every changed file is one no gate reads
                skips the runs and passes the verdict (072 FR-004a; maintainer: "If the build can't fail, we shouldn't have
                to wait"). No guarantee is withdrawn: a run skipped this way is one whose result could only be green. Development Workflow
                & Quality Gates › Action controls gains "Setting toggles": on is the full-contrast text colour on the
                pressed background, off is the muted text colour with a diagonal line struck through a plain glyph,
                titled "<setting>: enabled|disabled". Principle VI gains "A setting MUST be named for the behaviour it
                turns on" (076 replaced "Ignore terminal notifications" with "Terminal notifications", on by default).
                Both expand existing guidance; no guarantee is withdrawn.
Modified principles: VI (new bullet before its rationale).
Modified sections: Development Workflow & Quality Gates › Action controls (new "Setting toggles" sub-rule); Static
                analysis & linting (the inert-change exception).
Added sections: none. Removed sections: none.
Audit (2026-11-19): the terminal status bar's three toggles (076) already comply. Four setting toggles do not and are
                listed in the rule as known gaps: View Whitespace and Word Wrap on the editor status bar, and
                Synchronise Scrolling on the editor and preview status bars. One setting is negatively named, "Quick
                Open hides excluded files", listed in Principle VI. Search modes (Match Case, Whole Word, the Find in
                Files exclusion switch), the Resource Monitor's view filters and order choice, and disclosures are
                outside the toggle rule by its own terms.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ spec-template.md, tasks-template.md, checklist-template.md — name no control styling; no edit.
           ✅ .specify/extensions.yml — no constitution hooks registered.
Deferred: the five known gaps, each fixed before its control's or setting's next change.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 6.9.0 → 7.0.0
Bump rationale: MAJOR — the quality gates no longer run every Principle V layer on every pull request. Pull requests
                run lint, type-check, unit, component, contract and a declared critical-path integration subset, on
                Linux, with no E2E; every layer on every platform runs in the full pipeline (nightly, an agent's
                dispatch, and inside every release before anything publishes). A guarantee is withdrawn ("every
                layer, including @core E2E, gates every pull request"), so the bump is MAJOR. From spec 072
                (maintainer, 2026-11-17: PR CI must answer in about five minutes; alpha17 spent hours in a 13-minute
                PR lane and a 61-minute gate).
Modified principles: II ("macOS is proved by CI" names the full pipeline as where the proof runs);
                V (significance tags classify a test and no longer select a pull-request lane).
Modified sections: Development Workflow & Quality Gates (Static analysis & linting; the code-review bullet names the
                `CI verdict` check).
Added sections: none. Removed sections: none.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ spec-template.md, tasks-template.md, checklist-template.md — name no CI lane; no edit.
           ✅ .specify/extensions.yml — no constitution hooks registered.
           ⏳ CLAUDE.md, docs/testing.md, docs/releasing.md, CONTRIBUTING.md, the throng-testing and throng-release
              skills — updated by spec 072 tasks T030–T034 in the same branch.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 6.8.0 → 6.9.0
Bump rationale: MINOR — Principle X gains "Every theme setting belongs to its theme": everything a theme governs is
                stored in that theme's file, activating a theme restores all of it, and a token added to the shipped
                themes moves SHIPPED_DEFAULTS_VERSION so that every existing theme file receives it. From the
                maintainer's spec 069 review (2026-11-17: "Every theme setting should be saved / restored with each
                theme. This should be a constitution statement."). Additive guidance within an existing principle; no
                guarantee is withdrawn.
Modified principles: X (new sub-rule after its bullets).
Added sections: none. Removed sections: none.
Audit (2026-11-17): every theme value — colours, fonts, sizes, typography, the icon set and the icon colour — is
                already a key of the theme document; no settings key holds one. One violation, found because the
                maintainer saw it: 069 added `fileIconOther` to every shipped theme after version 34 was on disk, so
                no install at 34 received it and each theme drew none of its own. Fixed in the same change (version
                35, 069 FR-070), with `packages/core/tests/unit/theme-leaves-version.test.ts` failing the build for a
                theme leaf added or removed under an unchanged version. A second, found while writing the rule: a
                theme file missing a token (the Themes JSON tab can delete one) drew throng's value, because main
                read every theme over `THRONG_THEME`. Fixed in the same change (#643, 069 FR-071): the read takes
                a missing token from the theme's own record (`completeTheme`), the same source the upgrade uses.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — no constitution hooks registered.
           ✅ .claude/skills/throng-config-preferences/SKILL.md — its theme-token checklist gains the version step.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 6.7.0 → 6.8.0
Bump rationale: MINOR — the "Action controls" quality gate gains "Toast controls": every button a notice offers
                sits in the card's one control group at its top-right, to the left of Copy and Dismiss, never in
                the notice's content. From the maintainer's spec 069 review (2026-11-16). Additive guidance within
                an existing gate; no guarantee is withdrawn.
Modified sections: Development Workflow & Quality Gates › Action controls (new "Toast controls" sub-rule).
Added sections: none. Removed sections: none.
Audit (2026-11-16): four notices put their button in `body` — the icon set backups notice (Open folder), the
                installed-version notice (Restart), the paste progress card (Cancel, 050 FR-039) and the throng
                command notice (Install, 070). All four move to `controls` in spec 069 (FR-050), and `packages/ui/tests/unit/toast-controls-guard.test.ts`
                fails the build for a button passed in a notice's body. The attention toast's go-to-panel (057
                FR-122) and the Notifications panel's entries already comply.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — no constitution hooks registered.
           ✅ .claude/skills/throng-failure-notices/SKILL.md — reviewed; it describes notice content and
              de-duplication, not control placement, so no change.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 6.6.0 → 6.7.0
Bump rationale: MINOR — Principle VI gains "One popup style": every popup (tooltip, hover popover, hint, indicator,
                confirmation) is drawn in one shared style, and the OS's own `title` tooltip is never shown. From the
                maintainer's #637 manual testing (2026-11-16: "lots of title hover / popups with different styles;
                they should all be consistent in style. This should be a constitution rule."). Additive guidance
                within an existing principle; no guarantee is withdrawn. Existing code failed it — the ordinary MINOR
                case — and the same change brings it into line.
Modified principles: VI (new subsection after "Name the OS generically").
Added sections: none. Removed sections: none.
Audit (2026-11-16, at bdf6f8b1): thirteen floating surfaces in two style families — eight on `surfaceActive` with
                radii of 4 or 6 px, paddings from 2px 8px to 8px 12px and four different shadows; two (the pending
                chord, the preview's copy confirmation) on the status strip's colours with no shadow; the zoom
                indicator on `sidebarBg`. Only the zoom indicator faded. About 290 controls (206 `title=` sites, 87
                `IconButton`s) showed the OS's native tooltip. All fixed in the same change: `.throng-popup` in
                `theme.css`, the title tooltip in `common/title-tooltips.tsx`, and
                `packages/ui/tests/unit/popup-style.test.ts`. The link hint's three colour tokens (045 FR-165g) become
                the popup tokens; their keys are unchanged, so no theme file needs migrating.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — no constitution hooks registered.
           ✅ .claude/skills/throng-renderer-ui/SKILL.md — reviewed; it lists floating-surface helpers to reuse and
              names no popup style, so no change.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 6.5.0 → 6.6.0
Bump rationale: MINOR — Principle II makes macOS a supported target and extends the v6.1.0 delivery rule to it: a
                feature with per-OS code ships Windows, Linux and macOS together, each passing the shared contract.
                New: macOS is proved by CI on hosted runners only, no feature may require a manual test on a Mac,
                and what no test can show goes in the macOS known differences. From spec 070 FR-002 and the
                maintainer's clarification of 2026-11-15 ("Ship all three"). Additive obligation within an existing
                principle; no stated guarantee is withdrawn — the removed "macOS implementations are not required"
                was a waiver, not a guarantee. Existing code fails the new rule (no macOS implementations) — the
                ordinary MINOR case (v6.1.0, v6.3.0); spec 070 closes the gap in the same change.
Modified principles: II (supported targets; delivery rule names all three; new "macOS is proved by CI"; known
                violations replaced: 062's Linux gap is closed, 070's macOS gap recorded); VI ("Name the OS
                generically" example list gains macOS — PATCH-level, carried in this bump).
Added sections: none. Removed sections: none.
Audit (2026-11-15, at 9a39a482): `selectPlatform('darwin')` throws `UnsupportedPlatformError`; 26 PlatformServices
                entries have no macOS implementation; the renderer configures Windows traits on macOS. Spec 070 fixes
                each (specs/070-macos-support/tasks.md T004–T062).
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — no hooks registered.
           ⚠ .claude/skills/throng-spec-governance/SKILL.md — its one-line summary of II names "Windows and Linux
              together"; brought current in the same change (spec 070 T001).
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 6.4.0 → 6.5.0
Bump rationale: MINOR — Principle VI gains "Name the OS generically", a SHOULD: user-visible text calls the operating
                system "the OS", never "Windows" or "Linux"; product and format names containing the word are kept.
                From the maintainer's spec 068 manual testing (2026-11-13). Additive; nothing compliant becomes
                non-compliant under a MUST.
Modified principles: VI (new subsection after "A preference picks the default").
Added sections: none. Removed sections: none.
Audit (2026-11-13): user-visible strings naming the OS today — settings-metadata (`notifications.*.osNotify`
                descriptions, the OS-notifications master toggle), the elevated-drop notice, the Properties-dialog
                and file-manager-registration reasons, the conhost description. Fixed by spec 068 (FR-034g).
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — no constitution hooks registered.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 6.3.0 → 6.4.0
Bump rationale: MINOR — Principle IV's exhaustive exception lists gain one entry, `Ctrl+Shift+Alt+F2` (`tabs.rename`), from spec
                067 FR-075 and FR-080 (#609), in the form v5.8.0 used for `Ctrl+Shift+Alt+F4`. Additive; no guarantee is withdrawn
                and nothing compliant becomes non-compliant.
Modified principles: IV (the terminal-tier exceptions and the recorded function keys).
Added sections: none. Removed sections: none.
Audit (2026-11-08): no shipped binding held `Ctrl+Shift+Alt+F2` or any other modified `F2`
                (`packages/core/src/config/keybindings.ts`); `chordCollisions` over the defaults stays empty for it.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — no hooks registered.
           ✅ .claude/skills/throng-config-preferences/SKILL.md — reviewed; it cites the tiers and lists no exceptions.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 6.2.0 → 6.3.0
Bump rationale: MINOR — a new principle, XIII "Every Failure Leaves a Trace", from spec 066 (#543) and its
                clarifications of 2026-11-06 (the fatal level and what counts as a component crash). Nothing is
                withdrawn and no existing principle is redefined. It is a new constraint that the codebase
                failed when it was written — the ordinary MINOR case (v6.1.0, v5.9.0, v3.15.0) — and spec 066
                closes the gap in the same change: its audit (specs/066-failure-logging/audit.md) classifies every
                site, and a build guard keeps it closed.
Modified principles: none. Development Workflow "all eleven principles" → "every principle" (a count that
                was already stale at twelve).
Added sections: Core Principles › XIII. Every Failure Leaves a Trace.
Removed sections: none.
Audit (2026-11-06, at 661a08e2): 85 empty or comment-only catches, ~90 silent promise catches and ~190
                catches returning a fallback without logging across packages/*/src; 21 child-process start
                sites, 9 recording nothing on failure; no fatal level; the renderer recorded no error of its own;
                the de-elevated PTY agent logged to the desktop user's %TEMP%. Spec 066 fixes each.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — no hooks registered.
           ✅ .claude/skills/throng-spec-governance/SKILL.md — principle list brought current in the same change.
           ✅ .claude/skills/throng-failure-notices/SKILL.md — reviewed; notices and logs stay separate (a log
              never replaces a notice), so no rule changes.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 6.1.0 → 6.2.0
Bump rationale: MINOR — Principle IV gains one additive rule, settled by the maintainer in 062's manual
                test on 2026-11-03: a default key chord is the same on every platform wherever it can be.
                Nothing is withdrawn, and the codebase already meets it.
Modified principles: IV — new rule "A default chord is the same on every platform wherever it can be (v6.2.0)".
Added sections: none. Removed sections: none.
Audit (2026-11-03, at the 062 branch's head): Windows and Linux share every shipped default. The four focus
                moves reach Linux through the keypad, because GNOME reserves the arrow keys, and docs/linux.md
                records it.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — no hooks registered.
           ✅ constitution-template.md — resolved earlier in this session's amendment; no placeholder in play.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 6.0.0 → 6.1.0
Bump rationale: MINOR — Principle II gains one rule, on the maintainer's instruction of 2026-11-02:
                a feature that requires distinct code for Linux and Windows delivers both. Linux also
                becomes a supported target beside Windows. Nothing is withdrawn: Windows stays supported
                and "no design decision may foreclose" still holds for macOS. It is a new constraint that
                shipped code fails, which is the ordinary MINOR case (v5.9.0, v5.6.0, v3.15.0); the
                failures are stated in the rule as an end-state requirement under Incremental Delivery.
Modified principles: II — "Windows is the first supported target" → Windows and Linux are the
                supported targets; new rule "A feature that needs distinct code per OS delivers both
                (v6.1.0)"; rationale extended.
Added sections: none. Removed sections: none.
Audit (2026-11-02, static reading plus a Linux install and build at 992f0635): no abstraction implemented
                in packages/platform-windows has a Linux implementation; the core offers no-op defaults
                for foreground hand-off, system notification and taskbar badge only. Every gating CI job
                runs on Windows. Spec 062 (#23, #499) is the closing work and its FR-046 adds the Linux lane.
In-flight: all other feature work is on hold until 062 lands (maintainer, 2026-11-02). Spec 061 (PR #549)
                is specified but not planned, so its plan is bound by this rule when it resumes.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — no hooks registered.
           ✅ constitution-template.md — resolved with .specify/scripts/bash/resolve-template.sh; the
              constitution is fully populated and no placeholder was in play.
           ✅ .claude/skills/throng-spec-governance/SKILL.md — brought current in the same change.
Follow-up (outside this command's scope):
           ⚠ README.md, docs/installation.md, docs/quick-start.md — still say Windows-only; 062 FR-047
             changes them when Linux works, since they describe what runs today.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 5.10.0 → 6.0.0
Bump rationale: MAJOR — a previously-stated guarantee is withdrawn: "every panel action has a menu
                item" no longer holds. Principle VI now requires every panel action to be REACHABLE by
                a mouse-click or a keyboard command, the route chosen per command. Maintainer's wording
                and intent, 2026-10-25 (spec 060 clarification, FR-022): "Every discrete command or
                state toggle that acts on a Panel or its content MUST be accessible via a mouse-click
                or keyboard command… Some commands need to be reachable via a menu item, status bar
                AND a shortcut, or any combination of those things. Most commands need to be reachable
                via a keyboard shortcut, but not all." Considered and rejected: a narrow MINOR-shaped
                exemption for form controls (run, cancel, focus a field) — offered first, replaced by
                the maintainer with this broader rule.
Modified principles: VI — "Every panel action has a menu item" → "Every panel action is reachable
                (v6.0.0)"; its Exempt bullet and the v4.3.0 gap list are removed (every listed gap has
                a chord, so none is a gap under the new rule); "A chord MAY stand without a menu item
                (v5.6.0)" is absorbed into it, keeping its Key Bindings editor listing requirement;
                rationale paragraph rewritten. A hideable route still may not be a command's only route.
                IV — the `panel.destroy`, `panel.toggleMaximise` and `Ctrl+F5` notes no longer call the
                menu "canonical"; a v6.0.0 reading is appended to the `Ctrl+F5` record (v5.6.0's kept).
Added sections: none. Removed sections: "A chord MAY stand without a menu item" as a separate block
                (content absorbed into VI's new rule; historical references to it in earlier reports
                and records are left as written).
Shipped specs: requirements naming a menu item (e.g. 043 FR-025a) stay binding until a later spec
                supersedes them — stated in the rule. Spec 060 FR-022 is the first such supersession.
Process: `resolve-template.ps1` could not run — the session's worktree-isolation guard refuses every
                pwsh command. The constitution is fully populated and no template placeholder was in
                play; the edit was made directly on the maintainer's instruction (2026-10-25).
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — no hooks registered.
Follow-up (outside this command's scope — comments and docs citing the old rule by name):
           ⚠ .claude/skills/throng-renderer-ui/SKILL.md (description and body)
           ⚠ packages/ui/src/renderer/workspace/panel-header-menu.ts, editor/content-menu.ts,
             preview/preview-status-bar.tsx — comments
           ⚠ packages/ui/tests: find-in-files-menu, editor-content-menu-reset, panel-header-zoom-menu,
             panel-header-flag-menu, explorer-open-in-target — comments; the menu items they assert
             remain required by their own specs.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 5.9.0 → 5.10.0
Bump rationale: MINOR — Principle IV's exhaustive recorded-exceptions lists gain one entry,
                `panel.toggleMaximise` `Alt+Shift+Enter` (spec 054 FR-071a, issue #467), chosen by the
                maintainer in 054's clarification of 2026-10-10. Same shape and grade as v5.8.0's
                `panel.destroy`: additive, nothing withdrawn or redefined, the reserved tier untouched.
Modified principles: IV — the terminal-tier recorded exceptions gain the entry and its
                justification; the modifier-tier recorded exceptions list it beside `editor.columnSelect*`,
                the other `Shift+Alt` chord outside the tiers.
Added sections: none. Removed sections: none.
Audit: no shipped binding holds `Alt+Shift+Enter` (`packages/core/src/config/keybindings.ts`); in a
                terminal the chord is encoded by `encodeEnterKey` (`CSI 13;4 u` under kitty, LF otherwise)
                and is not in `RESERVED_TERMINAL_CHORDS`.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — no hooks registered.
Noted, out of scope: the Development Workflow text says "eleven principles"; there are twelve since XII.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 5.8.0 → 5.9.0
Bump rationale: MINOR — Principle XI gains one rule, "A loaded Panel keeps its state", in the
                maintainer's words from spec 049's clarification of 2026-10-01 (049 FR-000).
                Additive: nothing is withdrawn or redefined. It is a new constraint that shipped
                code fails, which is the ordinary MINOR case (v5.6.0's focus rule, v3.15.0); the
                failures are enumerated in the rule as an end-state requirement under Incremental
                Delivery. It does not touch "One document, one state": that rule governs content
                state and lets view state differ per Panel; this one says view state, once a Panel
                has it, survives the Panel being moved.
Modified principles: XI — new bullet after "Focus follows the active Panel".
Added sections: none. Removed sections: none.
Audit (2026-10-01, renderer read for nine state kinds): survives remount AND window move —
                preview scroll (main's history), Markdown folds (main's editor coordinator),
                per-panel zoom (layout model), terminal scrollback (daemon). Survives a same-window
                remount only — find sessions, editor caret/selection/scroll, terminal viewport and
                selection (renderer-local module maps). Lost on a same-window remount — editor and
                preview find engines (#456) and preview text selection. All enumerated in the rule.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — no hooks registered.
Deferred: none. Every violation is owned by spec 049 (FR-000, FR-000a); the editor-caret and
                terminal-viewport window-move cases were rolled into 049 at the maintainer's direction
                rather than filed separately.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 5.7.1 → 5.8.0
Bump rationale: MINOR — Principle IV's exhaustive recorded-exceptions lists gain one entry,
                `panel.destroy` `Ctrl+Shift+Alt+F4` (spec 048 FR-131, issue #461), taken by the
                maintainer's decision on 2026-10-01: "It should work in all panels", terminals
                included. Precedent: `Ctrl+F5` joined the same list as a MINOR at v4.4.0. Additive:
                no principle is removed or redefined, no shipped design becomes non-compliant, and
                the reserved tier is untouched.
Modified principles: IV — the terminal-tier recorded exceptions gain the entry and its
                justification; the modifier-tier recorded exceptions list it beside the other
                function keys.
Added sections: none. Removed sections: none.
Audit: no shipped binding holds `Ctrl+Shift+Alt+F4` or any other `F4` chord
                (`packages/core/src/config/keybindings.ts`); `Alt+F4` stays in `RESERVED_CHORDS` and
                is matched exactly, so the four-modifier chord is not refused by it.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — no hooks registered.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 5.7.0 → 5.7.1
Bump rationale: PATCH — spec 048 FR-045. Panel renaming is removed by 048 (FR-030, FR-040), so
                Principle IV's `F2` recorded exception loses `panel.rename` and Principle VI's
                View & state examples lose Reset Name. Neither withdraws a guarantee or adds an
                obligation: the exception list shrinks by a command that no longer exists, and an
                example is dropped. A Record line notes that 048's `panel.split*` window-scope
                two-stroke defaults fall under the existing multi-stroke rule with no new exception.
Modified principles: IV (recorded exceptions: `F2`; multi-stroke Record line); VI (section table
                example).
Added sections: none. Removed sections: none.
Audit: `panel.rename` removed from `packages/core/src/config/keybindings.ts` by 048 T044; the split
                chords' first stroke `Ctrl+Shift+Alt+End` is not in the reserved tier.
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — absent; no hooks.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 5.6.0 → 5.7.0
Bump rationale: MINOR — a new principle, XII "Responsive UI (NON-NEGOTIABLE)", approved by the
                maintainer on 2026-09-29 during 047's manual testing ("Performance of the UI is a
                non-negotiable"; "I would prefer to delay rendering / debounce updates (and only
                update when layout changes) than delay UI responsiveness").
Modified principles: none.
Added sections: Core Principles › XII. Responsive UI (NON-NEGOTIABLE).
Removed sections: none.
Existing work flagged: 047's preview table layout (re-measures on every resize frame; being fixed
                on the 047 branch under this principle).
Templates: ✅ plan-template.md — Constitution Check reads the constitution dynamically; no edit.
           ✅ .specify/extensions.yml — no before/after_constitution hooks registered.
Deferred: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 5.5.2 → 5.6.0
Bump rationale: MINOR — three rules the maintainer approved on 2026-09-23 while hand-testing spec 046
                (iterate round 1), each argued against the project's own test.

                (1) VI "A chord MAY stand without a menu item". Considered MAJOR and rejected. MAJOR
                is a previously-STATED guarantee withdrawn. VI's only menu MUST is "every panel
                action has a menu item", and it stands verbatim: the new rule is scoped to commands
                that are NOT panel actions, which no rule ever required to have a menu item. What
                changes is a READING — the rationale's "the keyboard [is an] accelerator over
                [the menu]" and IV's Ctrl+F5 "never a substitute" — from which spec 046 FR-019
                DERIVED a cog-menu route for four window commands. A derivation in one feature's
                spec is not a constitutional guarantee; both source sentences stay and are
                annotated as true of the panel actions they describe. The maintainer's words were
                broader ("keyboard shortcuts can exist without a corresponding menu item"); read at
                full breadth they would withdraw the panel-action rule, which WOULD be MAJOR. They
                were given about the cog menu's Navigate rows, not about panel menus, so the rule is
                written at the narrower reading and the checkpoint is told so.

                (2) IV "Modifier families". A new constraint that shipped code fails — eleven
                commands, enumerated in the rule — which is the ordinary MINOR case (v3.15.0,
                v4.2.0, v4.3.0 precedent): nothing previously guaranteed is withdrawn, and the rule
                is written as an end-state requirement under Incremental Delivery with its known
                violations listed IN the principle. It adds one shadowable exception (`Ctrl+Shift+-`,
                readline `undo`), the same MINOR shape as v4.4.0's `Ctrl+F5`.

                (3) III "Stated exception" for Unload with Keep Terminals Running. Considered MAJOR
                and rejected. The idle-shell rule ("closed when its project or the application is
                closed") is kept for EVERY path it was written for — application close and project
                close — and a new, explicitly user-instructed action is carved out beside it. No
                shipped release contains Unload (it exists only on the unmerged 046 branch), so no
                released behaviour becomes non-compliant; the 046 branch's own Unload, which closes
                idle shells on Keep running, is non-compliant and is re-specified by 046 FR-086 in
                the same round. The exception widens what the user may keep, it does not reduce what
                the application guarantees to clean up: every kept terminal is still reaped by
                project deletion and by "terminate all".

Modified sections:
  - Principle III → "Terminal lifecycle on close/reopen": ADDED a "Stated exception (v5.6.0)"
    sub-bullet. The two existing rules are unchanged.
  - Principle IV → recorded-exceptions bullet annotated (extended by one); ADDED the
    `Ctrl+Shift+-` exception bullet; the Ctrl+F5 paragraph's "never a substitute" annotated (still
    true, panel action); ADDED the "Modifier families" rule block with its known-violation list.
  - Principle VI → ADDED "A chord MAY stand without a menu item (v5.6.0)"; the 2026-09-09 audit
    sentence on the cog menu's "single Application section" annotated with a record (046 added a
    Navigate section; iterate round 1 removes it, which makes the sentence true again — it is not
    rewritten); rationale extended by one sentence.

Added sections: none (three rule blocks inside existing principles). Removed: nothing.

Audited against the code on 2026-09-23 before writing, not inferred from the specs:
  (a) `packages/core/src/config/keybindings.ts` WINDOWS_BINDINGS + COMMAND_SCOPES, every default:
      the eleven violations listed in IV are the complete set. `focus.cycleBack` (`Ctrl+Shift+``)
      is the direction-reversal carve-out, not a violation; `terminal.scrollLineUp/Down`
      (`Ctrl+Shift+ArrowUp/Down`) and every `Ctrl+Alt` window command already conform.
  (b) `zoom.reset` reaches `webContents.setZoomLevel(0)` (main.ts `resetZoom`) — the WINDOW zoom —
      and `panel.zoomReset` resets the active panel (app.tsx). The maintainer's report that
      Ctrl+Shift+0 "reset a panel's zoom" is not explained by this reading; it is a hypothesis-level
      observation recorded in 046 research, and the remap gives the window reset `Ctrl+Alt+0`.
  (c) xterm.js (`@xterm/xterm/src/common/input/Keyboard.ts`) sends `^_` (C0.US) for a Ctrl keydown
      whose key is `_` — the basis of the `Ctrl+Shift+-` exception. `Ctrl+Shift+=`, `Ctrl+Shift+0`,
      `Ctrl+Shift+S`, `Ctrl+Shift+W` and `Ctrl+Shift+Enter` send nothing a line editor reads.
  (d) `unload-project.ts` Keep running calls `terminal.closeIdle` — the behaviour (3) changes.
  (e) `title-bar/cog-menu-items.ts` carries the 046 `navigate` section — the sentence in (VI) above.

Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md      — no change needed (Constitution Check reads this file)
  ✅ .specify/templates/spec-template.md      — no change needed (no principle enumerated)
  ✅ .specify/templates/tasks-template.md     — no change needed
  ✅ .specify/extensions.yml                  — no before/after_constitution hooks registered
  ✅ .claude/agents/*.md, CLAUDE.md            — grep for "never a substitute", "Ctrl+Alt family",
                                                "idle shell": no agent file restates the changed
                                                sentences; no edit needed
  ⚠ specs/046-side-panes-and-project-list/    — amended in the same round (iterate round 1):
                                                FR-072 – FR-088 and their supersessions
  ⚠ README.md:305, docs/testing.md:383         — describe Keep running closing an idle shell; they
                                                change with the code (docs currency, 046 FR-088)
  ⚠ packages/core/src/config/keybindings.ts    — the eleven known violations; remapped by 046
                                                iterate round 1, not by this amendment
  ✅ specs/024, 026, 028, 033, 043             — shipped records of the chords they chose; not
                                                rewritten (046 records the supersession)

Follow-up TODOs: none deferred beyond the known-violation list, which 046 iterate round 1 owns and
                 which is tracked in the rule itself.

Revised before publication (2026-09-24), still 5.6.0:
  The maintainer reviewed 046's remap and kept five chords as exceptions to the new families. IV
  gains a "Recorded exceptions to the families" bullet (Quick Open Ctrl+Shift+T, Find / Replace in
  Files Ctrl+Shift+F / Ctrl+Shift+H, Save All Ctrl+Shift+S, Save As Ctrl+Alt+S). It also gains a
  "multi-stroke chord" bullet: the first stroke is judged by the terminal tiers, so a reserved first
  stroke is never live in a terminal. That bullet exists because 046 FR-091 ships word wrap on
  Ctrl+E W, editor-only.

  Why not a separate 5.6.1 / 5.7.0: 5.6.0 has never left this branch (commit e2939e9f, unpushed,
  unmerged, unreleased), so no reader, spec or plan has cited a 5.6.0 without these bullets. A
  second number would record a version that existed for one day on one machine. Measured against
  5.5.2, the whole amendment is still MINOR: the exception list is additive guidance of the v4.4.0
  shape, and the multi-stroke bullet restates the reserved-tier rule for a chord form that did not
  exist. The known-violation sentence is left as written, and the new bullet reclassifies five of
  its entries, so the record of what the first audit found survives.

  Audited 2026-09-24: throng has no multi-stroke chords today (core keybindings.ts eventToToken /
  resolveAction / chordCollisions, ui capture-modal.tsx). CodeMirror's keymap has a native prefix
  engine. Ctrl+E is unbound in the Windows editor (CodeMirror maps its emacs Ctrl-e to macOS only).
  `editor.toggleWordWrap` is EDITOR_ONLY.

Revised again before publication (2026-09-24, second review), still 5.6.0:
  The maintainer rejected the "Ctrl+Shift acts on the panel, Ctrl+Alt acts on the application" families
  and REDEFINED the convention as three tiers, in their words: "What I'd like is to be able to navigate to
  any surface pane / panel with CTRL+SHIFT (move between panes, panels, activate panels, tabs etc), then
  use CTRL+ALT to do things that affect the pane or panel when inside a panel or pane. Actions that
  affect the pane content itself should be bound to CTRL+, SHIFT+ or ALT+. So, three hierarchies (with a
  few noted exceptions)." Also: "zoom in / out / reset need to use the same chord combinations for each
  action within a group. Mixing them does not make any sense". In an addendum they kept the "Ctrl++"
  notation and ruled that the keypad + and - are the same binding as the main-row keys, not separate
  tokens.

  Principle IV:
  - "Modifier families" is REPLACED by "Three modifier tiers", with its noted-exception list, the
    group-consistency rule, the terminal-cost statement and the one-binding rule for the keypad
    + and -.
  - The `Ctrl+Shift+-` terminal exception is WITHDRAWN: panel zoom returns to Ctrl+Alt, so nothing
    takes readline's `^_`. The terminal-tier exception list is back to its four v4.4.0 entries.
  - The multi-stroke bullet is kept, moved inside the tier block.

  Still 5.6.0, for the reason given above: nothing has cited this version. Measured against 5.5.2 the
  amendment is still MINOR — an additive keyboard convention inside an existing principle, with known
  violations enumerated as an end-state requirement; no stated guarantee is withdrawn.

  Audited 2026-09-24 for the new tier 1:
  - xterm.js 6.0.0 sends nothing for Ctrl+Shift+letter or punctuation (`Keyboard.ts` default branch).
  - CodeMirror claims on Windows: Ctrl+Shift+Arrow / Home / End (selection), Shift-Mod-k (deleteLine),
    Shift-Mod-\ (matching bracket), and throng's own Mod-Shift-z (redo, use-editor.ts).
  - PSReadLine binds Ctrl+Shift+Left/Right (select by word), which xterm delivers as CSI 1;6 C/D.

  The superseded draft text, kept as a record (the full draft is in commit b396d233,
  `git show b396d233:.specify/memory/constitution.md`):

  | Modifier families: `Ctrl+Shift` acts on the active panel or pane, `Ctrl+Alt` acts on the
  | application. `Ctrl+Shift+<key>` MUST be used only for a command that acts on the active panel or
  | pane; `Ctrl+Alt+<key>` MUST be used only for a global command. Known violations at v5.6.0: global
  | commands on Ctrl+Shift — zoom.reset, navigate.quickOpen, search.findInFiles,
  | search.replaceInFiles, editor.saveAll; panel commands on Ctrl+Alt — panel.zoomIn/Out/Reset,
  | editor.saveAs, editor.toggleWordWrap, search.replaceAll. Recorded exceptions to the families (first
  | review): Ctrl+Shift+T / F / H, Ctrl+Shift+S / Ctrl+Alt+S.
  |
  | `Ctrl+Shift+-`, added at v5.6.0 (`panel.zoomOut`): xterm sends it as `^_` (readline `undo`);
  | justified by the families putting panel zoom on Ctrl+Shift; readline's undo stays on
  | Ctrl+X Ctrl+U and PSReadLine's on Ctrl+Z.

Revised a third time before publication (2026-09-24, iterate-round-1 checkpoint), still 5.6.0:
  The maintainer hand-tested the second-review tiers and agreed the FINAL convention at the
  speckit-iterate round 1 checkpoint. Their decisions, in substance:
  1. Ctrl+Shift+Alt is navigation and global / application actions, and every Ctrl+Shift+Alt
     chord is matched on the PHYSICAL key (KeyboardEvent.code), never on the produced character,
     so it works on every layout (Ctrl+Alt is AltGr in Europe; AltGr+Shift produces characters on
     e.g. Polish). The renderer's existing physical matching for Ctrl+digit and the backtick
     (`chord-key.ts`) extends to the whole family.
  2. Ctrl+Alt and Ctrl+Shift are commands on the active panel or pane.
  3. A single modifier (Ctrl, Alt, Shift), or none, is content.
  4. One keyboard chord per command, plus at most one mouse gesture. The keypad +, - and 0 are the
     SAME binding as the main-row key, not a second chord. Written `Ctrl++`, `Ctrl+Alt++`,
     `Ctrl+Shift+Alt++` ("Ctrl plus the + key"), never `Ctrl+Num+` or `Ctrl+Plus`.
  5. Recorded exceptions, kept as they are: Ctrl+F, Ctrl+H, Ctrl+S, Ctrl+F5; Quick Open
     Ctrl+Shift+T; Find / Replace in Files Ctrl+Shift+F / H; Save All Ctrl+Shift+S; Save As
     Ctrl+Alt+S; Replace All Ctrl+Alt+Enter; F2, F3, F11, Shift+F10; focus cycle Ctrl+` /
     Ctrl+Shift+` (Shift reverses); menu.open keeps both Shift+F10 and the Menu key ("fine as it
     is": a single-purpose hardware key, not a second chord).
  6. Multi-stroke chords are a new capability: word wrap is `Ctrl+E W`.

  Principle IV:
  - "Three modifier tiers" is REPLACED, in place, by the agreed rule: tier 1 `Ctrl+Shift+Alt`
    (navigation and the application), tier 2 `Ctrl+Alt` / `Ctrl+Shift` (the active panel or pane),
    tier 3 one modifier or none (content).
  - ADDED: physical-key matching for all of tier 1, with a disclosure duty for the AltGr+Shift
    characters a tier-1 letter can take; the one-keyboard-chord-per-command rule and its single
    exception (`menu.open`); the keypad `0` beside `+` and `-`; the written form of `+` chords; the
    exhaustive exception list above; the tier-1 terminal-cost statement.
  - WITHDRAWN: "Three-modifier chords SHOULD NOT be shipped", which tier 1 now contradicts by
    design. It stood only in unpublished drafts of this version.
  - Retained unchanged: group consistency, the multi-stroke bullet, "the tiers never override the
    terminal tiers", the AltGr check (extended by one sentence on the keypad), the upgrade rule.
  - The known-violation list is re-audited against the new rule (below).
  - The "Retired at v4.3.1" bullet gains a one-line record of the pane toggles' second move.

  Principle VI: the 2026-09-09 cog-menu audit clause gains a second record. The cog menu now has a
  View & state section with a Zoom row for the window zoom (046 FR-107), because AltGr and mouse
  users need a route that is not a chord. "A chord MAY stand without a menu item" is unchanged:
  it removes an obligation, and this is the option it keeps.

  Still 5.6.0, for the reason given in the first revision: the version has never left this branch
  (unmerged, unreleased), so no reader, spec or plan outside 046 has cited it. Measured against
  5.5.2 the whole amendment is still MINOR. A keyboard convention is ADDED inside an existing
  principle, and existing code fails it — the ordinary MINOR case, with the violations enumerated
  in the principle as an end-state requirement under Incremental Delivery. No guarantee stated in
  a published version is withdrawn. The one withdrawn sentence (three-modifier chords) never
  appeared in a published version.

  Audited 2026-09-24 before writing, against the code at `3b04ec33`, not inferred from the specs:
  - `keybindings.ts` WINDOWS_BINDINGS: the known-violation list in IV is the complete set under
    the new rule. `terminal.scrollLineUp/Down` (`Ctrl+Shift+ArrowUp/Down`) acts on the pane's
    viewport and now CONFORMS as tier 2; it is no longer an exception. `editor.columnSelect*`
    (`Shift+Alt+Arrow`) fits no tier and is recorded by derivation, flagged for the maintainer.
  - Canonical token order is `Ctrl+Shift+Alt+<key>` (`eventToToken`); tokens are shown as
    written, so the display form is `Ctrl+Shift+Alt++`.
  - xterm.js 6.0.0 `CoreBrowserTerminal._isThirdLevelShift`: on Windows, Ctrl+Alt with a key
    code above 47 is a third-level shift and sends nothing on keydown. Arrows (37–40) and
    PageUp / PageDown (33 / 34) are below it: arrows send `CSI 1;8 A`–`D`; Shift+PageUp / PageDown
    scroll xterm's viewport (`Keyboard.ts`).
  - `chord-key.ts` `chordCandidates` / `resolveKeydown`: physical matching exists for
    `Digit0`–`Digit9` with Ctrl held and Alt NOT held, and for the backtick. Tier 1 needs it with
    Alt held, which R2's AltGr reason excluded; Shift held is what makes it safe (046 research R22).
  - `keybindings/scope.ts` `isPanelScoped`: `tabs.openPicker` was missing from the window-command
    exemptions until `3b04ec33`, which is why the tab picker chord was dead in a terminal.

Modified sections (this revision): Principle IV ("Three modifier tiers" block replaced; "Retired
  at v4.3.1" bullet gains a record); Principle VI (cog-menu audit clause gains a record).
Added sections: none. Removed sections: none.

Templates / artifacts reviewed (this revision):
  ✅ .specify/templates/plan-template.md      — no change (the Constitution Check reads this file)
  ✅ .specify/templates/spec-template.md      — no change (no principle enumerated)
  ✅ .specify/templates/tasks-template.md     — no change
  ✅ .claude/agents/*.md, CLAUDE.md            — no agent file restates the tier text
  ⚠ specs/046-side-panes-and-project-list/    — amended in the same change: FR-101 – FR-112,
                                                SC-014 – SC-016, supersessions S15 – S23,
                                                research R22, data-model §3 / §4 / §8 notes
  ✅ specs/046-side-panes-and-project-list/plan.md — described the second-review tiers when this
                                                revision was written; the round-1 plan now carries
                                                the agreed tiers, the second-review section marked
                                                superseded (checked 2026-09-25)
  ⚠ packages/core/src/config/keybindings.ts    — the known violations; remapped by 046, not by
                                                this amendment
  ⚠ README.md, docs/quick-start.md             — the keyboard reference changes with the code
                                                (docs currency, 046 FR-088 / FR-112)
  ✅ specs/003, 012, 024, 026, 031, 041        — shipped records of the chords they chose; not
                                                rewritten (046 records each supersession)

Follow-up TODOs (deferred, and honest about it):
  - The live line-editor check of tier 1's `CSI 1;8` arrow sequences in every hosted flavour
    (bash readline `bind -p`, PSReadLine `Get-PSReadLineKeyHandler`) is owed at implementation.
  - Whether Chromium on Windows reports `AltGraph` for the right-hand AltGr key but not for left
    Ctrl+Alt is a HYPOTHESIS (046 research R22). If it holds, tier 1 can decline AltGr+Shift and
    take no character; if not, the disclosure duty in IV is the whole answer.
  - `editor.columnSelect*` is an exception by derivation, awaiting the maintainer.

Corrected before publication (2026-09-25), still 5.6.0 — two claims in this report were wrong:
  - Bump rationale (3) says the idle-shell rule "is kept for EVERY path it was written for —
    application close and project close". That was asserted, not audited. 046 T124 / T153 read the
    code and found that no production path closes an idle shell at application close, and none ever
    has: the app-close prompt (`main.ts`) is raised for idle sessions too, *Leave running* keeps
    every session, and the daemon runs no idle sweep at shutdown. Rule III's app-close clause is
    therefore a PRE-EXISTING known violation, not something this amendment preserves. It is recorded
    as an end-state requirement in 046 plan.md's Complexity Tracking (commit d34a0502) with an open
    tracking issue. The MINOR argument is unaffected — the stated exception still withdraws no
    guarantee — but the sentence overstated what the code does.
  - The first report's "Follow-up TODOs: none deferred" is wrong for the same reason: the app-close
    idle sweep IS deferred, to the tracking issue named in 046's Complexity Tracking.
  Also: the ⚠ on README.md:305 above is cleared (it now says Keep terminals running keeps idle
  shells); docs/testing.md:383 follows 046 T129. The rule text of Principle III is not changed.

The superseded second-review tier text, kept as a record (full text in commit 62cff579,
`git show 62cff579:.specify/memory/constitution.md`):

  | Three modifier tiers: `Ctrl+Shift` navigates, `Ctrl+Alt` acts on the container, one modifier
  | acts on the content. Tier 1 navigation `Ctrl+Shift+<key>`; tier 2 container `Ctrl+Alt+<key>`
  | (a panel's zoom); tier 3 content, one modifier or none. Three-modifier chords SHOULD NOT be
  | shipped. Noted exceptions: the window zoom group `Ctrl+=` / `Ctrl++` / `Ctrl+-` / `Ctrl+0`;
  | Ctrl+Shift+T / F / H; Ctrl+Shift+S / Ctrl+Alt+S; Ctrl+Alt+Enter; `focus.*` Ctrl+Alt+Arrow;
  | `terminal.scrollLine*` Ctrl+Shift+ArrowUp/Down; `editor.columnSelect*` Shift+Alt+Arrow;
  | Ctrl+E W. Known violations: focus.cycle / cycleBack, project.next / previous,
  | focus.explorer / projects, view.toggleProjects / toggleExplorer, focus.notice,
  | tabs.openPicker, and zoom.reset's Ctrl+Shift+0.

Revised a fourth time before publication (2026-09-25, maintainer mid-build decisions), still 5.6.0:
  The maintainer reviewed the in-progress build and gave two decisions, verbatim: "Remove the new
  "Zoom" options from the menu." and "The "Zoom Reset" key bindings need to use the numpad zero, NOT
  the 0 key."

  Principle VI: the iterate-round-1-checkpoint record above (the cog menu gaining a View & state
  section with a Zoom row) gains a THIRD record: the row is WITHDRAWN. The cog menu returns to the
  single Application section the 2026-09-09 audit describes, this time for good rather than as an
  intermediate state (046 FR-113). "A chord MAY stand without a menu item" is unaffected: the window
  zoom chords were already reachable without a menu item, and losing the row's mouse route is a
  narrowing this maintainer decision accepts, not a principle change.

  Principle IV: the "keypad `+`, `-` and `0` are the SAME binding as the main-row key" bullet gains a
  named, narrow exception. For `zoom.reset` and `panel.zoomReset` ONLY, the keypad `0` (`Numpad0`) is
  now a SEPARATE, physical-only match — the main-row key no longer resets either zoom at all (046
  FR-114). Every other command's `+` / `-` / `0` same-binding rule is unchanged; this is not a
  reversal of the rule, only a second, narrower rule for the two commands the maintainer named.
  Written as `Ctrl+Alt+Numpad0` / `Ctrl+Shift+Alt+Numpad0` — WITH the `Numpad0` name, unlike the
  bare-symbol form the `+` / `-` bullet still requires — because these two chords no longer have a
  main-row form to write instead.

  Why not a separate 5.6.1 / 5.7.0: as the first three revisions of this report note, 5.6.0 has never
  left the 046 branch (unmerged, unreleased), so no reader, spec or plan outside 046 has cited it
  without this note. The change is MINOR, measured the same way as the third revision: an existing,
  additive rule (the keypad same-binding rule) gets a narrower carve-out for two commands, and a
  shipped-but-unreleased UI element (the Zoom row, shipped only on this branch, never released) is
  withdrawn before anyone outside the branch could rely on it — withdrawing something never published
  guarantees nothing, so it is not MAJOR.

  Audited 2026-09-25 before writing, against the code on the branch as it stood:
  - `packages/ui/src/renderer/title-bar/cog-menu-items.ts` builds the `viewState` Zoom row
    (`zoomControls`, test ids `cog-menu-zoom-in/out/reset`) and `cog-menu.tsx:50` reads
    `window.throng.zoomLevel()` to show its percentage — both to be removed by 046, not by this
    amendment; the amendment records the rule, the spec's tasks do the removal.
  - `packages/core/src/config/keybindings.ts` ships `zoom.reset: ['Ctrl+Shift+Alt+0']` and
    `panel.zoomReset: ['Ctrl+Alt+0', 'Ctrl+MiddleClick']` — both to be remapped to `Numpad0` by 046.
  - `packages/ui/src/renderer/config/chord-key.ts`'s `digitCandidate` today aliases `Numpad0` to the
    bare `'0'` for EVERY Ctrl+digit command (no `Numpad…` token is ever emitted) — the general FR-105
    rule this amendment carves its two-command exception into.

Modified sections (this revision): Principle IV (keypad same-binding bullet gains a named exception);
  Principle VI (cog-menu record gains a third, withdrawing entry).
Added sections: none. Removed sections: none.

Templates / artifacts reviewed (this revision):
  ✅ .specify/templates/plan-template.md      — no change (the Constitution Check reads this file)
  ✅ .specify/templates/spec-template.md      — no change
  ✅ .specify/templates/tasks-template.md     — no change
  ✅ .claude/agents/*.md, CLAUDE.md            — no agent file restates the Zoom-row or keypad-0 text
  ⚠ specs/046-side-panes-and-project-list/    — amended in the same change: FR-113 – FR-115, SC-017,
                                                supersessions S24 – S25, a new Clarifications session,
                                                tasks.md Phase 11 (T154 – T167)
  ⚠ specs/046-side-panes-and-project-list/plan.md — NOT amended in this change; it still names the
                                                cog Zoom row from the iterate-round-1 checkpoint and
                                                goes stale until a future round updates it
  ⚠ packages/core/src/config/keybindings.ts,
    packages/ui/src/renderer/title-bar/cog-menu-items.ts,
    packages/ui/src/renderer/config/chord-key.ts — the two commands this amendment names; remapped
                                                by 046 tasks T154 – T164, not by this amendment
  ⚠ README.md, docs/quick-start.md, CHANGELOG.md — the keyboard reference and the cog menu's shape
                                                change with the code (docs currency, 046 T165 – T167)

Follow-up TODOs (deferred, and honest about it):
  - T154 – T167 are written, not yet executed, as of this revision.
  - plan.md's iterate-round-1 section is stale until a future round reconciles it; tracked in
    tasks.md's Phase 11 preamble, not as a separate issue (it is 046's own plan, still open).

Revised a fifth time before publication (2026-09-25, convergence T168, still 5.6.0):
  Convergence (046 T168) found the fourth revision's "named, narrow exception for these two
  commands only" reading did not match the code it audited. `chord-capture.ts`'s
  `sameBindingSymbolOfCode` returns `Numpad0` unconditionally, for every command, not only
  `zoom.reset` / `panel.zoomReset` (`packages/core/src/config/chord-capture.ts:91-92`), and
  `chord-key.ts`'s `chordCandidates` never folds a `Numpad0` press into the `0` / `Digit0`
  candidate for ANY command (`packages/ui/src/renderer/config/chord-key.ts:121-122`, `:91`) —
  commit `b67029fa` removed the fold from binding identity generally, not only for the two zoom
  commands the fourth revision named.

  Principle IV: the keypad `0` bullet's named exception (fourth revision) is corrected. The keypad
  `0` (`Numpad0`) is a SEPARATE, physical-only match from the main-row `0` for EVERY command, not
  only `zoom.reset` and `panel.zoomReset` — those two remain the only commands that SHIP a default
  using it. A user who binds any other command to `Ctrl+Alt+0` in Key Bindings fires it only from
  the main-row `0`; the keypad press does not fire it and instead records its own `Ctrl+Alt+Numpad0`
  capture. The keypad `+` and `-` bullet is unaffected: they remain the same binding as the main-row
  key for every command, including `zoom.reset` and `panel.zoomReset`'s own `+` / `-` siblings
  (`zoom.in` / `zoom.out` / `panel.zoomIn` / `panel.zoomOut`).

  Why this reading, not the fourth revision's: the maintainer's instruction, verbatim, "The 'Zoom
  Reset' key bindings need to use the numpad zero, NOT the 0 key," named the two zoom commands
  because those were the only ones with a shipped `0`-family default at the time; it did not say the
  resolver's behaviour should be scoped to only those two, and no other shipped default binds `0` at
  all. The fourth revision's "two-command exception" was a derived narrowing of an instruction that
  was never that narrow — the earlier keypad-0 equivalence for all commands was itself a derived
  extension of the maintainer's separate `+` / `-` request, never a maintainer decision about `0`.

  Why not a separate 5.6.1 / 5.7.0: unchanged reasoning from the fourth revision — 5.6.0 has never
  left the 046 branch (unmerged, unreleased). This correction narrows what the RULE claims to be
  exceptional (from two commands to the general case); it changes no shipped or planned default:
  `zoom.reset` and `panel.zoomReset` still ship `Numpad0`, and no other command ships or plans a
  `0`-family default before or after this correction, so nothing compliant becomes non-compliant.
  Not MAJOR; the ordinary MINOR case of a clarification the code already satisfied.

  Consequence recorded, stated plainly: a user who binds another command to `Ctrl+Alt+0` fires it
  only from the main-row `0`; the keypad zero does not fire it.

  Modified sections (this revision): Principle IV (keypad `0` bullet's named exception widened from
    two commands to general).
  Added sections: none. Removed sections: none.

  Templates / artifacts reviewed (this revision):
    ✅ .specify/templates/plan-template.md, spec-template.md, tasks-template.md — no change
    ✅ .claude/agents/*.md, CLAUDE.md — no agent file restates the two-command scoping
    ⚠ specs/046-side-panes-and-project-list/spec.md — amended in the same change (FR-105's note,
                                                  FR-114, convergence task T168)
    ⚠ specs/046-side-panes-and-project-list/tasks.md — T162 / T163's wording notes corrected in the
                                                  same change (T168)

  Follow-up TODOs: none deferred by this revision.

Revised an eighth time before publication (2026-09-26, 046 iterate round 7), still 5.6.0:
  The maintainer: "Add Ctrl+Alt+0 as a secondary default keybinding for "reset panel zoom"", and,
  asked how it meets the one-keyboard-chord rule, chose "Second chord, new exception".
  Principle IV: a named exception under the one-chord rule: `panel.zoomReset` ships `Ctrl+Alt+0`
  beside `Ctrl+Alt+Numpad0`, matched on the produced `0`. Bump reasoning: a narrowed obligation
  for one command, folded into the unreleased 5.6.0 as every revision above is.
  Modified sections: Principle IV (one named exception). Added / removed sections: none.
  ⚠ specs/046-side-panes-and-project-list/spec.md: FR-127, S31, in the same change.

Revised a seventh time before publication (2026-09-26, 046 iterate round 5), still 5.6.0:
  The maintainer, hand-testing: "Focus should move to either the first control on those panels,
  or the last active control e.g. empty panels should have the panel type drop-down focussed if
  no other controls were previously active, and the find in files panel should have the search
  text box active if none of its other controls were previously active. Any future panels we
  create should have the same behaviour - I expect this is a constitution amendment." The rule's
  wording was put to the maintainer and approved as written.

  Principle XI: a new rule, "Focus follows the active Panel" (every Panel type has a keyboard
  focus target; a keyboard route into a Panel moves DOM focus to its last-focused control, else
  its first; the Projects-list switch is the exception, 046 FR-082). Known violations at
  adoption: the untyped Panel and Find in Files (046 FR-125 fixes them).
  Principle IV: a third v5.6.0 record under "Retired at v4.3.1", factual only: 046 FR-124 writes
  a two-stroke chord `Mods+K1,K2` and word wrap as `Ctrl+E,W`. No rule changes.

  Bump reasoning: the XI rule is a new obligation, MINOR by this file's own test. It is folded
  into 5.6.0 rather than a 5.7.0 for the reason every revision above gives: 5.6.0 has never left
  the 046 branch (unmerged, unreleased), so nothing outside 046 has cited it.

  Modified sections (this revision): Principle XI (one rule added), Principle IV (a record).
  Added sections: none. Removed sections: none.

  Templates / artifacts reviewed (this revision):
    ✅ .specify/templates/plan-template.md, spec-template.md, tasks-template.md: no change
    ✅ .claude/agents/*.md, CLAUDE.md: no file states a panel focus rule
    ⚠ specs/046-side-panes-and-project-list/spec.md: amended in the same change (FR-124,
       FR-125, a round-5 clarification session)
    ⚠ packages/ui/src/renderer: the untyped Panel and Find in Files change with the code

  Clerical: the footer "Last Amended" date is 2026-09-26.

Revised a sixth time before publication (2026-09-25, 046 iterate round 3), still 5.6.0:
  The maintainer, hand-testing: "There does not seem to be a way to get back to the center pane
  from the keyboard." and "all shortcuts use Ctrl+Shift+Alt. Focus should be B, N and M (from left
  to right). Collapse / expand side panes should be J and K, from left to right. V for notices if it
  is not already reserved."

  Principle IV: the "Retired at v4.3.1" paragraph's v5.6.0 record, which says spec 046 moves the pane
  toggles to `Ctrl+Shift+Alt+B` / `Ctrl+Shift+Alt+N`, gains a second record. They move again, to
  `Ctrl+Shift+Alt+J` / `Ctrl+Shift+Alt+K`, and B / N / M become the three focus chords (046 FR-117).
  No rule changes. Every new chord is tier 1 and matched physically. None is in the reserved or
  shadowable tier. The group rule holds, with three focus commands and two toggles each on one
  modifier set. The seven-layout disclosure the tier-1 cost bullet requires is in 046 research R22
  (J, K and V lose nothing; Polish `Ń` stays on N). The "Known violations at v5.6.0" list is not
  touched. It records the pre-046 audit, and none of its entries is re-opened.

  Principle VI: nothing is amended. 046's new `focus.workspace` (FR-116) moves the user between
  surfaces and acts on no panel, so "A chord MAY stand without a menu item" already covers it as
  written. The spec says it stands on its chord alone, as that rule requires.

  Bump reasoning, against this file's own test: PATCH-level. The change is a factual record of where
  a spec moved two defaults, with no new obligation and no guarantee withdrawn. It is folded into
  5.6.0 rather than a 5.6.1, for the reason every revision above gives: 5.6.0 has never left the 046
  branch (unmerged, unreleased), so nothing outside 046 has cited it.

  Audited 2026-09-25 before writing, against the branch at `69127230`:
  - `packages/core/src/config/keybindings.ts` ships `view.toggleProjects` `Ctrl+Shift+Alt+B`,
    `view.toggleExplorer` `Ctrl+Shift+Alt+N`, `focus.notice` `Ctrl+Shift+Alt+M`, `focus.explorer`
    `Ctrl+Shift+Alt+F` and `focus.projects` `Ctrl+Shift+Alt+P`. No `focus.workspace` exists, and no
    shipped default binds J, K or V with any modifier. The record above is written for the state
    046 T173 produces, not for what is on disk now. Until T173 lands, the code still matches the
    first record.
  - `packages/ui/src/renderer/keybindings/scope.ts` exempts every `focus.*` action as a window
    command by prefix, so `focus.workspace` needs no new exemption for Principle IV's "window command
    survives a focused terminal" reading (046 FR-110).

  Modified sections (this revision): Principle IV ("Retired at v4.3.1" paragraph, a second v5.6.0
  record).
  Added sections: none. Removed sections: none.

  Templates / artifacts reviewed (this revision):
    ✅ .specify/templates/plan-template.md, spec-template.md, tasks-template.md: no change
    ✅ .claude/agents/*.md, CLAUDE.md: no agent file names the 046 pane-toggle or focus chords
       (`grep -rn "Ctrl+Shift+Alt+[BNMFP]" .claude CLAUDE.md` found nothing)
    ⚠ specs/046-side-panes-and-project-list/spec.md: amended in the same change (FR-116 – FR-120,
       SC-018, S27, a round-3 clarification session)
    ⚠ specs/046-side-panes-and-project-list/tasks.md: Phase 13 (T172 – T190) appended
    ⚠ specs/046-side-panes-and-project-list/research.md, quickstart.md: R22 round-3 check and
       NumLock result; quickstart §5b
    ⚠ specs/046-side-panes-and-project-list/plan.md, data-model.md, contracts/: NOT amended in this
       change. They still name F / P / B / N / M under their round-1 owners, and 046 T186 reconciles
       them
    ⚠ README.md, docs/quick-start.md, docs/testing.md, CHANGELOG.md: change with the code (046
       T182 – T185)

  Follow-up TODOs (deferred, and honest about it):
    - 046 T172 – T190 are written, not executed, as of this revision.
    - 046 FR-120 (the Numpad0 / NumLock defect) is recorded but not specified. It may bear on
      Principle IV's Numpad0 named exception, and that is not decided here.

  Clerical correction (2026-09-26): the footer "Last Amended" date still read 2026-09-23 after this
  sixth revision; it is corrected to 2026-09-25. Metadata-only: no principle text and no version
  number changes.

---- previous report ----

Version change: 5.5.1 → 5.5.2
Bump rationale: PATCH — the maintainer's decision of 2026-09-19 for PR #408: the link menu's copy
                item is labelled "Copy Link to Clipboard", not "Copy Link Address". Checked
                against the project's own test for the three sizes: the obligation is unchanged
                (every link menu offers Open Link and an item that copies the link) and only the
                label the rule names changes. No guarantee is withdrawn, so it is not MAJOR. It adds
                no new constraint, only a new name for an existing one, so it is not MINOR either
                (MINOR's "a new constraint that existing code fails" does not apply). The
                shipped menus still use the old label; that is a gap in the code, recorded
                below, not a change in what the rule asks for.

Modified sections:
  - Principle VI → "One gesture follows a link, everywhere": the menu-route sentence now names
    **Copy Link to Clipboard**. The historical reports below keep the old label as it was then; they
    are a record and are not rewritten.

Added: nothing. Removed: nothing.

Known code not yet matching the label (verified 2026-09-19, to be relabelled by spec 045 round four,
FR-170 / its label supersession, in the same increment as the Link menu):
  packages/core/src/links/menu.ts:80, packages/ui/src/renderer/links/link-menu-items.ts:105,
  packages/ui/src/renderer/preview/content-menu.ts:109, and the matching `menu-item-Copy Link
  Address` test ids and tests.

Record update 2026-09-19 (spec 045 round four, T277/T278) — a record, not an amendment: all three
sites above now read **Copy Link to Clipboard**. `menu.ts`'s copy item moved into `buildLinkMenu`
(T275, T277); `link-menu-items.ts` is deleted; `preview/content-menu.ts`'s Contextual section (T277)
is gone entirely, folded into the one Link menu every surface now shares. The gap this report
recorded is closed.

Templates requiring updates:
  ✅ .specify/templates/plan-template.md      — no change needed (Constitution Check reads this file)
  ✅ .specify/templates/spec-template.md      — no change needed (no menu label enumerated)
  ✅ .specify/templates/tasks-template.md     — no change needed
  ✅ .specify/extensions.yml                  — no before/after_constitution hooks registered.
  ⚠ .claude/agents/throng-renderer-ui.md     — not edited here (constitution-only change); check it
                                                for the old label when the code is relabelled
  ⚠ specs/045-clickable-file-links/spec.md   — FR-170's label is superseded to match, in the same
                                                amendment round; specs 024 and 044 are not edited
                                                in place (045 records the supersession)
  ⚠ README.md, docs/                          — any user-facing mention of the label changes with
                                                the code (docs currency)

Follow-up TODOs: none deferred beyond the relabelling above.

---- previous report ----

Version change: 5.5.0 → 5.5.1
Bump rationale: PATCH. A factual correction to a recorded audit, on the project's own test for the
                three bump sizes: the rule requires exactly what it required before, no surface
                that conformed stops conforming, and no new obligation is created. What changes is
                the statement of which surfaces currently satisfy it — the same shape as the
                5.4.0 → 5.4.1 correction recorded below.

Modified sections:
  - Principle VI → "One gesture follows a link, everywhere", the *Known gaps* sentence. It named
    TWO gaps and corrects TWO statements:
      (a) "no surface yet implements Ctrl+Enter" — WRONG WHEN IT WAS WRITTEN, not merely overtaken.
          Spec 044 shipped `preview.followLink` bound to Ctrl+Enter (core/src/config/keybindings.ts,
          dispatched at renderer/preview/preview-commands.tsx) four days before this rule was
          added on 2026-09-14, and the rule's own "Why now" paragraph cites 044 FR-094–FR-096 as
          evidence for the rule while the gap list says nothing implements it. Saying so plainly is
          the point of this amendment: the premise was stale before the feature that corrects it.
      (b) editors do not implement it — TRUE UNTIL NOW, and false as of spec 045 FR-044/FR-045,
          which widens the same command's scope to editors rather than adding a second one.
    The About window's plain-click links remain a gap and stay named, re-verified on 2026-09-18.

Added: nothing. Removed: nothing — one sentence of the gap list is restated, and the surviving gap
       keeps its wording and its file reference.

Why now: Incremental Delivery forbids amending ahead of the behaviour, so this lands in the same
         change as the editor's Ctrl+Enter (045 US3) rather than before it.

Verified against the code on 2026-09-18, not inferred from the specs:
  (1) `preview.followLink` ships bound to Ctrl+Enter and its scope now contains `editor` and
      `preview` (core/src/config/keybindings.ts); `COMMAND_SCOPES[...].has('terminal')` is still
      false, so a shell keeps the chord (045 FR-046).
  (2) The editor dispatches it at the window, in capture phase, and takes the key ONLY when a link
      holds the caret (renderer/app.tsx); everywhere else CodeMirror's `defaultKeymap` still
      inserts a blank line, which is this rule's "MUST NOT take Ctrl+Enter where no link holds
      that position".
  (3) `about/about-app.tsx` still follows its links on a plain click — the gap is real and stays.

Templates requiring updates:
  ✅ .specify/templates/plan-template.md      — no change needed (Constitution Check reads this file)
  ✅ .specify/templates/spec-template.md      — no change needed (no UX rule enumerated)
  ✅ .specify/templates/tasks-template.md     — no change needed
  ✅ .claude/agents/throng-renderer-ui.md     — no change needed: it cites the rule and the
                                                About-window gap, both of which survive this
                                                correction unchanged
  ⚠ specs/045-clickable-file-links/spec.md   — FR-091 is the requirement this amendment satisfies;
                                                it already records both statements (amended T005)

Follow-up TODOs: none deferred. The one surviving gap is tracked in the rule itself.

---- previous report ----

Version change: 5.4.1 → 5.5.0
Bump rationale: MINOR, two rules added to an existing principle. Nothing is removed and no rule
                is redefined; every surface that conformed before still conforms.

Modified sections:
  - Principle VI → ADDED "One gesture follows a link, everywhere": a link inside content is
    followed by Ctrl+click (Cmd+click on macOS) or, where it holds a keyboard position,
    Ctrl+Enter; a plain click never navigates; hover names the gesture; a panel's menu over a link
    offers Open Link and Copy Link Address. Scoped by definition to references inside content, so
    tree, list and result rows, tabs, buttons and menu items keep their own click behaviour.
  - Principle VI → ADDED "A preference picks the default; the menu offers every variant": where a
    preference chooses an action's variant, the menu names every variant, and a plain item beside
    them runs the preference's choice under the action's own label.
  - Principle VI → Rationale extended by one sentence covering both.

Added: nothing beyond the two rules. Removed: nothing.

Why now: the same decision was made three times in three places without a rule to point at —
         024 FR-019c for terminal links, spec 044 FR-094/FR-096 for preview links, and #394 for
         file links in editors and terminals — and the default-plus-variants shape twice, in 044
         FR-035a–c (copy formats) and #394 (link targets), with the maintainer citing #394 as the
         pattern while clarifying 044. A convention re-derived per feature is one feature away
         from being derived differently.

Verified against the code on 2026-09-14, not inferred from the specs:
  (1) Terminal OSC 8 and plain-text URL links already require Ctrl/Cmd+click
      (terminal/use-terminal.ts, openTerminalLink), and the terminal content menu already offers
      Open Link / Copy Link Address (terminal/terminal-content-menu.ts).
  (2) KNOWN GAP: the About window follows its licence, repository and third-party links on a
      plain click (about/about-app.tsx). 020 FR-003a requires the licence link but names no
      gesture, so no shipped requirement is contradicted — the gap is recorded IN the rule, per
      the 4.6.0 / 5.4.0 precedent for a rule the shipped app does not yet fully satisfy.
  (3) KNOWN GAP: nothing implements Ctrl+Enter on a link yet.
  (4) The variants rule was checked against the one-row-per-command rule (006 FR-030, and 043's
      clarification moving Find in Files under Open In → Search). A plain item labelled for the
      action is a different command from each variant row, and the rule says so explicitly.
      Open In ▸ on a Files & Folders row and on a Find in Files result already conform; no menu
      carries a plain item beside named variants today, so nothing shipped is non-compliant.

Templates requiring updates:
  ✅ .specify/templates/plan-template.md      — no change needed (Constitution Check reads this file)
  ✅ .specify/templates/spec-template.md      — no change needed (no UX rule enumerated)
  ✅ .specify/templates/tasks-template.md     — no change needed
  ✅ .claude/agents/throng-renderer-ui.md     — updated: both rules added to "Rules a UI change must
                                                satisfy", citing 5.5.0 and the About-window gap

Not updated, deliberately: specs/024 and specs/044 already state these behaviours for their own
                           surfaces; they are the evidence for the rule, not text it rewrites.

Follow-up TODOs: none deferred. The two gaps are tracked in the rule itself.

---- previous report ----

Version change: 5.4.0 → 5.4.1
Bump rationale: PATCH. A factual correction to a recorded audit. The rule itself is unchanged in
                what it requires; only the statement of which menus currently satisfy it moves.

Modified sections:
  - Principle VI → "One section vocabulary for every menu". The pre-existing-gaps sentence recorded
    the editor content menu, the panel header menu, the tab context menu and the cog menu as drawing
    their items in one undivided run. All four were sectioned by feature 033 US5. The gap list is
    replaced by a statement that the gaps are closed, plus the reason there is no longer a list to
    keep: `section` is a REQUIRED field on `MenuAction`, so an unsectioned item is a compile error.

Added: nothing. Removed: nothing.

Why now: found while implementing feature 043, whose plan reported the discrepancy rather than
         working around it. A constitution that records a gap which no longer exists is worse than
         one that records nothing: the next feature to touch those menus either does redundant work
         or, having found the record wrong once, stops trusting the rest of the audit.

Verified against the code on 2026-09-09, not inferred from the 033 spec: editor/content-menu.ts
declares 9 sections, workspace/panel-header-menu.ts 30, workspace/tab-menu.ts 6, and
title-bar/cog-menu-items.ts 3 — the last being a single Application section, which is why it
correctly draws no divider. packages/ui/tests/unit/menu-sections.test.ts pins the shape of each.

Templates requiring updates: none. The Constitution Check gate is dynamic (read from this file at
plan time), and no template names the gap list.

Follow-up TODOs: none.

---- previous report ----

Version change: 5.3.0 → 5.4.0
Bump rationale: MINOR, materially expanded guidance. Nothing is removed and nothing is redefined
                incompatibly — the digit-grouping obligation is unchanged in what it requires. What
                changed is HOW FAR it reaches, plus an explicit statement of what it does not cover.

Modified sections:
  - Development Workflow & Quality Gates → "Displayed numbers MUST be digit-grouped…"
    RENAMED to "Displayed QUANTITIES MUST be digit-grouped…". Scope widened from "every number a
    preference editor displays" to every surface the application shows a user. Adds the
    quantity/not-a-quantity distinction with three named exclusions, and enumerates four known gaps.

Added: nothing (no new principle, no new section).
Removed: nothing.

Why now: spec 040 adds a character count to the editor status bar. The strip is not a preference
         editor, so on a literal reading of 4.5.0 an ungrouped `1048576` was permissible on a
         surface whose entire purpose is being read at a glance — while the rule's own rationale,
         "eight digits nobody can scan", described that surface exactly.

Two things the code settled that the principle could not:

  (1) THE PRACTICE WAS ALREADY WIDER THAN THE TEXT. `navigate/quick-open.tsx` groups "Showing N of
      M matches" and predates this amendment; nothing in the constitution asked it to. Meanwhile
      `search/find-bar.tsx` renders `N of M` ungrouped, and a find in a large file passes a thousand
      matches routinely. One rule, two surfaces of the same kind, opposite answers.

  (2) THE OBVIOUS WORDING WOULD HAVE BEEN HARMFUL. "Any surface displaying a number" mandates
      `Panel 1,024` (`workspace/unique-name.ts`) and `report copy 1,024.txt` (`explorer/naming.ts`),
      and it breaks Go To Line, whose seeded field takes bare digits — `navigate/goto-line.tsx`
      already carries a source comment reasoning its way to that boundary. Hence "quantities", with
      identifiers, editable seeds and machine-read fields excluded by name.

Known gaps: enumerated IN the rule rather than fixed here, per 4.6.0's precedent that a widened rule
            the shipped app does not satisfy is recorded as an end-state requirement with its gaps
            listed, never as a rule the codebase quietly violates. Four, all in packages/ui:
            find-bar.tsx (the only one whose magnitude routinely passes 1,000), app-close-prompt.tsx,
            subworkspaces-panel.tsx, subworkspace-app.tsx.

Templates requiring updates:
  ✅ .specify/templates/plan-template.md      — no change needed (no grouping reference)
  ✅ .specify/templates/spec-template.md      — no change needed (no grouping reference)
  ✅ .specify/templates/tasks-template.md     — no change needed (no grouping reference)
  ✅ .claude/agents/throng-renderer-ui.md     — updated: cites 5.4.0, adds the three exclusions and
                                                the gap list
  ✅ .claude/agents/throng-config-preferences.md — updated: cites 5.4.0, adds the exclusions
  ✅ .specify/memory/constitution.md          — 4.5.0's amendment note marked SUPERSEDED IN PART, so
                                                a reader who lands on it is sent to 5.4.0

Not updated, deliberately: specs/018, specs/030, specs/032 reference the rule as it stood when they
                           shipped. Shipped specs are a record of what was decided then; they are not
                           rewritten by a later amendment.

Follow-up TODOs: none deferred. The four gaps are tracked in the rule itself, not as TODOs.
-->

<!--
SYNC IMPACT REPORT
==================
Version change: 5.2.0 → 5.3.0
Bump rationale: MINOR, three changes to Principle V, all additive to the rule set.

                (1) The enumerated E2E reserve gains a NINTH entry — real application-runtime
                identity. (2) The "real layout and text rendering" entry is REWORDED to cover
                resolved colour and cascaded style. (3) Every E2E test MUST now name the reserve
                entry that makes it irreducible.

                All three come out of spec 035's census, which read every one of the 229 E2E spec
                files and 687 tagged tests — the first time the whole suite has been assessed for
                LAYER rather than for cost. Each is argued from what that census measured, not from
                a principle applied forward.

                ── (1) THE NINTH ENTRY ──

                Three of the five independent assessors proposed the same new entry in different
                words: "real end-to-end wiring through the app's own backend". It was the single
                largest keep-at-E2E bucket in the census, and it does NOT survive measurement, so
                it is NOT what is being added here. 98 channels are registered in the main process;
                every one is reachable from the preload; and `config-write-patch.contract.test.ts`
                already drives a real registered handler against real state on disk. The wiring is
                provable below E2E today — the contract layer had simply been built exactly once.

                What DOES survive is narrower and is genuinely unreachable from any lower layer:
                behaviour whose correctness depends on a true property of the real runtime that a
                substitute either lacks or satisfies by coincidence. Two worked examples, both from
                the census:

                  - `quick-open-perf.e2e.ts:234` asserts that typing performs no IPC. The renderer's
                    bridge object is frozen by `contextBridge`, so a page-level instrument
                    literally cannot install itself to count calls. A fake bridge would be
                    instrumentable, which is precisely why it cannot make this assertion.
                  - `daemon-selfspawn.e2e.ts:13` asserts the app spawns its daemon via the host Node
                    runtime rather than `process.execPath`. `daemon-lifecycle.test.ts` runs AS host
                    Node, so the two paths coincide and the regression is invisible there BY
                    CONSTRUCTION — not for want of effort.

                The distinction that keeps this entry narrow: it is about a property of the running
                process being unfakeable, never about a chain of components being connected. The
                latter is what the contract and component layers are for, and conflating them is
                what produced the rejected broad entry above.

                ── (2) THE REWORDING ──

                The layout entry named only geometry — a caret against a gutter, what is scrolled
                into view, a wrapped line's height, a measured rectangle. Four assessors
                independently proposed a COLOUR entry, and three separate test files
                (`colour-field.test.ts:25-26`, `projects-panel-form.test.ts:47`, and the FR-049
                sites throughout the explorer and preferences specs) had each re-derived the same
                justification from scratch because the enumeration did not cover it.

                Three authors re-deriving one justification is the tell that an entry is worded too
                narrowly, not that a new entry is needed — so this is a REWORD rather than a tenth
                item. Adding it as its own entry would have inflated the reserve while leaving the
                original entry still wrong.

                ── (3) NAMING THE ENTRY ──

                This is the one that changes daily practice. The constitution already required a
                significance tag, a category tag, and a downward-only budget; NONE of those can
                detect a test whose JUSTIFICATION has decayed, and the census found that class
                repeatedly. `tree-drop-open.e2e.ts` justified all five of its tests by the OS
                drag-and-drop reserve while dispatching a synthetic in-page CustomEvent — a
                mechanism jsdom reproduces identically. `subtree-expand-collapse.e2e.ts` claimed the
                native-menu reserve for an in-document React menu. In both the justification was
                true when written and rotted in silence, because nothing ever re-checked it.

                Naming the entry per test makes the claim checkable by a reviewer in seconds and by
                a guard in milliseconds. The identifier is stable rather than prose, which is what
                makes change (2) possible without invalidating every test that named the entry.

                DELIBERATELY NOT ADDED: a test-count ceiling. The E2E budget ratchet below already
                requires exactly that and has since 5.0.0. Writing it again would have duplicated a
                shipped rule — the failure mode this project has already paid for once, when a new
                requirement was reasoned forward without checking which existing one governed the
                same behaviour.

                On the bump: a new MUST does make every existing test non-compliant until it is
                tagged, which reads at first like a strengthening rather than an addition. It is
                MINOR on the precedent set at v3.14.0 and v4.2.0, both of which strengthened
                Principle V with an additive rule — and the repository is brought into compliance in
                the same change, so no commit leaves a test in violation.

Templates requiring updates: none — `docs/testing.md` restates the reserve and the tag vocabulary
                and is updated in the same commit.
Follow-up TODOs: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 5.1.0 → 5.2.0
Bump rationale: MINOR. Principle V’s enumerated E2E reserve gains a SEVENTH entry — real keyboard
                and input dispatch. Additive: nothing is removed or redefined, and no previously-
                compliant test becomes non-compliant. As with the last amendment, it makes legal a
                category of test the enumeration had accidentally outlawed.

                Found the same way, one item along, at the end of spec 034’s sweep of the whole
                suite. Five `window-chord-resolution.e2e.ts` tests are legitimately end-to-end and
                classify under NONE of the seven: what `e.key` a real engine reports for a chord,
                and whether a real keystroke reaches the real dispatcher, is not window lifecycle,
                focus, a native menu, an OS drop, PTY fidelity, process-tree hygiene or layout.

                They cannot go down a layer either, and the reason is sharper than "jsdom is
                limited": a synthesised KeyboardEvent asserts the shape the TEST chose. Only a real
                keystroke asserts what the browser decides — which is exactly where modifier
                handling, dead keys and layout-dependent chords go wrong. A component test here
                would assert its own premise.

                The reasoning is the same as 5.1.0’s and is worth stating twice: an enumeration
                that reads as exhaustive is worse than a vague one, because a reader holding a
                legitimate case with no matching entry concludes the case is illegitimate — and
                either writes a component test that asserts its own premise, or leaves the
                behaviour untested. Two amendments in two days say the enumeration should be read
                as a growing list of worked examples rather than a closed set.

Templates requiring updates: none — `docs/testing.md` restates the reserve and is updated in the
                same commit.
Follow-up TODOs: none.
-->
<!--
SYNC IMPACT REPORT
==================
Version change: 5.0.0 → 5.1.0
Bump rationale: MINOR. Principle V's enumerated E2E reserve gains a sixth entry — real layout and
                text rendering. Additive: nothing is removed or redefined, and no previously-
                compliant test becomes non-compliant. It makes legal a category of test that 5.0.0
                had accidentally outlawed.

                Found by applying 5.0.0 to somebody else's feature. Spec 033 shipped two Go To Line
                tests that assert the caret lands beside a gutter element reading the right number,
                in view, in a WRAPPED document. Classifying them under 5.0.0 put them nowhere: they
                are not windows, focus, native menus, drag-and-drop, PTY fidelity or the process
                tree — and they are not component tests either, because the component layer renders
                into a document with no layout engine. It can say what the markup is; it cannot say
                where it ended up.

                An incomplete enumeration is worse than a vague rule, because it reads as
                exhaustive. A developer applying 5.0.0 faithfully to those two tests would have
                concluded they must be deleted or forced into a layer that cannot hold them, and
                the honest answer — "a real layout engine is the only thing that can see this" —
                had no name in the list.

                The wording is deliberately about the QUESTION rather than the API: "anything whose
                truth depends on how the engine actually laid the text out". Naming
                getBoundingClientRect would invite the next person to route around it.
Modified principles: V "Test-First Quality Discipline (NON-NEGOTIABLE)" — one clause added to the
                E2E reservation. Every other rule, including the budget and the tag vocabulary,
                unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/*                 — Constitution Check is dynamic; no edit needed.
  ✅ specs/034-e2e-harness-integrity/spec.md — FR-048/FR-049 already carry the reservation and the
       compositing caveat; this generalises the same idea to layout. Recorded there.
  ✅ packages/ui/tests/e2e/goto-line.e2e.ts — the two tests this legalises. No change made.
Deferred TODOs: none.

                ---- superseded amendment (historical) ----
Version change: 4.7.0 → 5.0.0
Bump rationale: MAJOR. Principle V's "Every user-facing UI change MUST ship with E2E test coverage"
                rule is REMOVED and replaced by a proportionality rule. That is a backward-
                incompatible redefinition on the strict reading the versioning policy asks for:
                work that was compliant yesterday — a UI change carrying an E2E for something a
                unit or component test could assert — is non-compliant today, and the removed
                backfill clause means a deferral that was mandatory is now forbidden. The bar for
                MAJOR is "removal or backward-incompatible redefinition", and this is both.

                Why the rule is being removed rather than tuned. It was added in good faith to stop
                UI shipping unproven, and it worked — but it is a ONE-WAY RATCHET with no ceiling.
                It mandated an E2E per UI change, required uncovered UI to be backfilled, and was
                enforced at /speckit-tasks time, so every feature added tests to the most expensive
                layer and none could ever be removed. Measured outcome: 235 E2E spec files and ~791
                tests taking 46.9 minutes locally (specs/034-e2e-harness-integrity/baseline.md),
                against 250 unit, 85 integration and 19 contract files — an inverted pyramid, paid
                for on every push by every contributor. A sample of 47 spec files found ~40% of
                those E2E tests asserting things a unit or component test could assert, and ~33%
                asserting persistence or configuration an integration test could assert.

                The replacement keeps the guarantee and drops the layer mandate: a change still
                MUST ship with observed passing coverage, and still MUST NOT be marked done without
                it — but at the LOWEST layer that can prove it. E2E is reserved for what genuinely
                needs the running application, and is enumerated so the reservation is checkable
                rather than arguable.

                Two new enforcement rules exist because the old rule's failure was structural, not
                cultural: a declared E2E budget the build enforces as a downward-only ratchet, and a
                mandatory significance tag per E2E test so continuous integration can gate on the
                critical journeys while the remainder runs at release. Without the budget the suite
                regrows to the same place within a dozen features.

                What is deliberately NOT weakened: test-first Red-Green-Refactor, run-once-in-full
                capture discipline, flaky-is-a-bug, the infrastructure-fault carve-out, contract
                tests for abstractions, the process-lifecycle E2E requirement (Principles III and V
                both keep it — no lower layer can see an orphaned conhost), temp-file cleanup, and
                the @admin elevation-gating rule. Deleting an E2E is now permitted, but only after
                its replacement has been written and observed FAILING against a broken
                implementation. Coverage is never dropped, only relocated.
Modified principles: V "Test-First Quality Discipline (NON-NEGOTIABLE)" — a fourth layer
                (component) added to the layered strategy; the every-UI-change E2E mandate and its
                backfill clause replaced by lowest-layer-that-can-prove-it plus an enumerated E2E
                reservation; three new rules (budget ratchet, significance and category tags, and
                reproduce-a-defect-at-the-lowest-layer); the rationale paragraph extended to say why
                affordability is part of the discipline.

                The reproduce-before-fix rule is NEW to this constitution, not a relocation. It had
                been enforced only by a personal instruction file and a tool hook outside the
                repository, so a contributor working without those had no statement of it at all —
                and the version of it that existed elsewhere named E2E as the layer, which is the
                habit this amendment exists to end.
                XII "Engineering Standards" — the CI clause names the component layer and states
                that E2E gates pull requests at @core and runs in full at release; the code-review
                gate now checks layer choice rather than the presence of all three layers.
Added sections: none. Removed sections: none (the superseded rule's text does not survive in the
                principle, by the constitution's own convention that principles state current law;
                its history is in this report and in git).
Templates / artifacts reviewed:
  ✅ .specify/templates/*                 — Constitution Check is dynamic; no edit needed.
  ⚠ specs/034-e2e-harness-integrity/spec.md — this amendment's origin; its FR-044+ carry the rules
       into the feature, and FR-028, FR-036, FR-042 and SC-013 are superseded there.
  ⚠ docs/testing.md, CLAUDE.md, .claude/agents/*, .claude/skills/throng-testing — carry the removed
       mandate in prose and are rewritten under spec 034.

                Rebased onto 4.7.0. This amendment was authored against 4.5.0 while master
                advanced to 4.7.0 with two additive Principle VI rules (menu section vocabulary,
                disabled-versus-absent). Those are untouched by this one — it redefines Principle
                V and the workflow gates only — so the two stack rather than conflict, and the
                MAJOR bump is taken from 4.7.0 rather than from the 4.5.0 it was written against.
Deferred TODOs: none.

                ---- superseded amendment (historical) ----
Version change: 4.6.0 → 4.7.0
Bump rationale: MINOR. Principle VI gains a second additive rule — "Disabled when unavailable,
                absent when meaningless" — settling when a control that cannot act is greyed out and
                when it is not drawn at all (2026-08-15, settled while clarifying feature 033). No
                principle is removed or redefined; the rule codifies the treatment the explorer menu
                already ships and states the case it does not cover.

                Why it is constitutional: half of it already existed as a comment on two menu items
                (undo/redo, "disabled — not hidden — when the stack is empty"), which meant every
                later control re-decided the question. Feature 033 wrote "absent or disabled" three
                times before anyone noticed an either/or cannot be tested.

                Both blanket answers were rejected. "Always disable" puts two permanently dead rows
                on every file's context menu, because a file can never acquire children. "Always
                hide" contradicts the shipped undo/redo treatment and hides a capability exactly when
                the user is asking whether it exists. The discriminator is whether ANY future state
                of the application would enable the control.
Modified principles: VI "Simple, Modern, Discoverable UX" — one rule block added. Title and every
                existing rule, including v4.6.0's menu section vocabulary, unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/*                 — Constitution Check is dynamic; no edit needed.
  ✅ specs/033-open-and-navigate/spec.md  — FR-018c, FR-035 and FR-038 already state both halves for
       this feature's controls; the amendment generalises them. No edit made (Spec Kit owns it).
  ✅ packages/ui/src/renderer/explorer/context-menu-items.ts — the undo/redo comment this rule
       generalises. No code change is made by this amendment.
Deferred TODOs: none.

                ---- superseded amendment (historical) ----
Version change: 4.5.0 → 4.6.0
Bump rationale: MINOR. Principle VI (Simple, Modern, Discoverable UX) gains one additive rule —
                "One section vocabulary for every menu" — fixing the sections, their order, when a
                divider may be drawn, and the requirement that every item declares its section
                (2026-08-15, settled while specifying feature 033 / issue #160). No principle is
                removed or redefined, and no previously-compliant design becomes non-compliant:
                the rule is recorded as an END-STATE requirement under Incremental Delivery.

                Why it is constitutional rather than 033's own business: dividers have existed in
                the shared menu since feature 023 and the Files & Folders menu has used them ever
                since, but nothing said HOW to group — so the practice never spread. Four menus grew
                without a vocabulary; the panel header menu reached eleven items in one undivided
                run. Feature 033 had to settle an order to place three new items, and an order that
                lives in a feature spec governs that feature alone, which is precisely how the first
                grouping failed to generalise.

                Two rejected alternatives are recorded in the footer note, because both are the
                obvious simplification and both are wrong: making contextual items take their
                natural section (would demote the terminal's link actions, a behaviour regression
                shipped as a grouping pass), and putting Navigate before Content (would re-order the
                one menu already grouped correctly).
Modified principles: VI "Simple, Modern, Discoverable UX" — one rule block added plus a rationale
                sentence. Title and every existing rule unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check is dynamic; picks the rule up
       automatically. No edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; unchanged.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; unchanged.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ specs/033-open-and-navigate/spec.md  — FR-047 to FR-053 already state the vocabulary, the
       divider rule, the keyboard-skip rule and the per-menu audit this amendment enumerates. The
       spec is the source; no edit needed, and none made (Spec Kit owns that file).
  ✅ packages/ui/src/renderer/workspace/context-menu.tsx — `MenuItem.separator` and the
       navigation skip already exist; the amendment adds no new mechanism, only the rule for using
       what shipped in 023.
  ⚠  The audit naming the four non-conforming menus is 033's (2026-08-15) and is owed to that
       feature and issue #160. Nothing in this amendment changes code.
Deferred TODOs: none.

                ---- superseded amendment (historical) ----
Version change: 4.3.1 → 4.4.0
Bump rationale: MINOR. Principle IV's enumerated shadowable exceptions gain `Ctrl+F5`
                (`terminal.redraw`), taken deliberately by feature 028 (issue #163). Additive: no
                principle is removed or redefined, no previously-compliant design becomes
                non-compliant, and the reserved tier is untouched.

                This is the first exception taken UNDER the rule rather than inherited by it, which
                is the point of the rule existing. v4.2.0 recorded five chords the codebase had
                already taken before anyone wrote the constraint down; this one went the other way
                round — the spec named the chord, what it displaces, and why no free chord serves,
                before the binding shipped. The enumerated list is therefore doing its job as a
                gate rather than as an apology.

                Why the chord is takeable at all: `Ctrl+F5` is not in the reserved tier, no shipped
                binding held it, and no hosted flavour's LINE EDITOR reads it — the tier test. What
                it can displace is a full-screen program's function-key handling, which is real but
                secondary, and terminal file managers bind the UNMODIFIED function keys, which is
                why bare `F5` was rejected outright rather than merely avoided.
Modified principles: IV "Native Terminal Support & Auto-Detection" — the recorded-exceptions list
                gains one entry, plus a paragraph stating its justification in the form the rule
                demands. Every existing rule, tier and retirement is unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/*                 — Constitution Check is dynamic; no edit needed.
  ✅ packages/core/src/config/keybindings.ts — `terminal.redraw` is TERMINAL_ONLY with default
       `Ctrl+F5`; bare `F5` is deliberately not taken.
  ✅ packages/core/src/config/keybindings-metadata.ts — descriptor added, so the preferences editor
       exposes it (configuration-editor completeness).
  ✅ specs/028-terminal-render-input-fidelity/spec.md — FR-008 requires this amendment in the same
       increment as the binding; FR-049a–d state the chord, its scope and the bare-F5 refusal.
Deferred TODOs: none.

                ---- superseded amendment (historical) ----
Version change: 4.2.0 → 4.3.0
Bump rationale: MINOR. Principle VI (Simple, Modern, Discoverable UX) gains an additive rule —
                "Every panel action has a menu item" — making a Panel's menu the canonical index of
                its actions, with a status bar or chord as an accelerator over it rather than a
                substitute for it (2026-07-23, raised while clarifying spec 024 / issue #152). No
                principle is removed or redefined.

                The rule was requested in the broad form "all panel level actions need menu items,
                even if they are displayed on the status bar also". AN AUDIT OF THE SHIPPED MENUS
                SHOWED THE BROAD FORM WOULD BE UNSERVICEABLE AS WRITTEN. The editor content menu
                offers seven items (Cut/Copy/Paste/Select All/Undo/Redo/Set Language…) and the
                terminal's offers two (Copy/Paste), while roughly two dozen commands are live in a
                panel scope. Taken literally the rule would demand menu items for
                `editor.columnSelectUp`, `search.findNext` and `terminal.scrollLineDown` — entries
                no user would ever choose from a menu — so the rule DISTINGUISHES discrete commands
                and state toggles (which MUST have items) from continuous or navigational input
                (exempt, but still rebindable and documented).

                Even so scoped, the shipped app does NOT satisfy it today: per-panel zoom, save,
                find/replace and the editor's line commands reach no menu. Rather than write a rule
                the codebase quietly violates, or weaken it to whatever currently ships, it is an
                END-STATE requirement under the Incremental Delivery rule — binding on new work
                immediately (a feature adding a panel action adds its menu item in the same
                increment) with the pre-existing gaps ENUMERATED in the principle and owed to
                tracked work. This is the same treatment v4.2.0 gave cross-flavour key parity.

                What prompted it: spec 024 makes both panel status bars hideable, at which point a
                status-bar-only control would become unreachable — the rule generalises the fix
                (a checkable "Word Wrap" content-menu item) into the standard that produced it.
Modified principles: VI "Simple, Modern, Discoverable UX" (one rule block added — "Every panel
                action has a menu item" — plus an extended rationale). Title and every existing
                rule unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check is dynamic; picks the rule up
       automatically. No edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; unchanged.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; unchanged.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ packages/ui/src/renderer/editor/content-menu.ts , terminal/terminal-panel.tsx — audited; the
       gap list in the principle comes from this audit. No code change is made by this amendment.
  ✅ specs/024-editor-terminal-enhancements/spec.md — already conforms: FR-003d requires the
       checkable "Word Wrap" content-menu item in both panel types, and FR-001c requires the
       command to survive a hidden status bar.
Deferred TODOs: the enumerated pre-existing gaps (per-panel zoom, save, find/replace, editor line
                commands) have no issue yet. They are owed to tracked work under the Incremental
                Delivery rule and MUST be filed before compliance can be claimed.

                ---- superseded amendment (historical) ----
Version change: 4.1.0 → 4.2.0
Bump rationale: MINOR. Principle IV (Native Terminal Support & Auto-Detection) gains three additive
                sub-rules governing the keyboard: reserved terminal keys, one chord per command
                across panel types, and key parity across shell flavours (2026-07-23, raised while
                clarifying spec 024 / issue #152). No principle is removed or redefined.

                Considered MAJOR and rejected on the project's own test: MAJOR is the withdrawal or
                backward-incompatible redefinition of a stated guarantee. Nothing previously
                guaranteed is withdrawn — Principle IV's existing rules (support any installed
                shell, auto-detect, project-root cwd, list and switch running terminals) stand
                verbatim. What is ADDED is a contract the principle implied but never stated: that
                "hosting a real terminal" includes hosting its keyboard. Materially expanded
                guidance within an existing principle → MINOR, in the lineage of v3.13.0 → v3.14.0
                and v4.0.0 → v4.1.0.

                THE SHIPPED BINDINGS WERE AUDITED, AND THE FIRST DRAFT OF THIS RULE WAS WRONG. A
                flat "never shadow a line-editor key" would have declared throng non-compliant on
                five counts the moment it was ratified: `Ctrl+B` (readline `backward-char`) is
                `view.toggleProjects`, `Ctrl+F` (`forward-char`) is `search.find`, `Ctrl+N`
                (`next-history`) is `view.toggleExplorer`, `Ctrl+H` (`backward-delete-char`) is
                `search.replace`, and `Ctrl+S` (XOFF / `forward-search-history`) is `editor.save`
                — all live in a terminal via the EVERYWHERE or PANELS scope, as
                `keybindings.ts` already notes ("a terminal's shell never sees them"). Writing the
                rule flat and calling the code clean would have been false. The rule is therefore
                TWO-TIERED: a reserved set no command may take, and a shadowable set that MAY be
                taken only as a recorded exception. The five above are enumerated in the principle
                as exactly those exceptions — the constitution documents what ships rather than
                contradicting it, and the reserved tier (`Ctrl+C/D/Z/A/E/W/U/K/R/L/Q`) is clean
                today and stays clean.

                The rules close a real hole found in practice. Spec 024 proposed `Ctrl+E+W` as the
                word-wrap chord; because a chord throng consumes never reaches the shell, a `Ctrl+E`
                prefix would have silently removed `end-of-line` from every Git Bash terminal and
                scroll-down from `vim`/`less` — a capability loss invisible until a user's reflex
                stopped working. The constitution had no rule to catch that at the Constitution
                Check gate, and the near-miss was caught only by manual inspection. The parity
                clause records the converse gap the same review surfaced: `Ctrl+E` works in Git Bash
                but not in PowerShell, so today the same throng terminal answers to different keys
                depending on the flavour behind it.

                The parity clause is an END-STATE requirement delivered incrementally (the pattern
                Principle I already uses for the project workspace folder structure): it binds new
                work immediately — no feature may widen the gap — while the normalisation itself is
                tracked as its own feature. It is deliberately NOT a demand that unshipped
                behaviour be treated as shipped.
Modified principles: IV "Native Terminal Support & Auto-Detection" (three sub-rule blocks added —
                "Terminal keys belong to the terminal" with its reserved / shadowable tiers and the
                enumerated exceptions, "One command, one chord across panel types", and "Parity
                across flavours" — plus an extended rationale). Title and every existing rule
                unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check is dynamic ("[Gates determined based
       on constitution file]"); the new sub-rules are picked up automatically. No edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic (no principle references); unchanged.
  ✅ .specify/templates/tasks-template.md — principle-agnostic (no principle references); unchanged.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ docs/ , README.md , CLAUDE.md        — no references to Principle IV or its title; unchanged.
  ✅ packages/core/src/config/keybindings.ts — audited command-by-command against COMMAND_SCOPES.
       RESERVED tier: clean — no shipped default binds `Ctrl+C/D/Z/A/E/W/U/K/R/L/Q` in a scope live
       in a terminal (`file.copy`'s `Ctrl+C` and `editor.cutLine`'s `Ctrl+X` are EXPLORER_ONLY /
       EDITOR_ONLY, so they never apply there). SHADOWABLE tier: five pre-existing bindings, now
       enumerated in the principle as recorded exceptions. No code change is required by this
       amendment; the five are flagged for review, not broken.
  ✅ specs/024-editor-terminal-enhancements/spec.md — already conforms: FR-003c states the
       don't-shadow rule and the shipped chord was moved from `Ctrl+E+W` to `Ctrl+Alt+W` before this
       amendment. No spec edit needed.
Deferred TODOs:
  - Cross-flavour key parity has no feature or issue yet — it is an end-state obligation under the
    Incremental Delivery rule and MUST be filed and tracked before it can be claimed. Recorded
    here, not silently assumed.
  - The recorded shadowable exceptions were five at v4.2.0 and are THREE from v4.3.1 (`Ctrl+F`,
    `Ctrl+H`, `Ctrl+S`); `Ctrl+B` and `Ctrl+N` were retired by feature 026 (issue #165). Those
    remaining are retained, not endorsed. `Ctrl+S` in particular still means XOFF wherever flow control is on,
    where a user who hits it sees a frozen terminal with no feedback. Whether to rebind any of the
    five is a product decision this amendment deliberately does NOT make.

                ---- superseded amendment (historical) ----
Version change: 4.0.0 → 4.1.0
Bump rationale: MINOR. Strengthens Principle V (Test-First Quality Discipline) with an additive
                sub-rule that distinguishes an INFRASTRUCTURE fault (owned by no test) from a test
                FLAKE (2026-07-22, issue #75). No principle is removed or redefined; the strict
                flaky-test gate is untouched.

                Considered MAJOR and rejected, on the project's own test: MAJOR is the removal or
                backward-incompatible redefinition of a principle or governance rule — the case
                where a PREVIOUSLY-STATED guarantee is withdrawn or reversed. Nothing here is
                withdrawn. "A test that fails and then passes on re-run is flaky, not fixed" stands
                verbatim and still governs every TEST. What is ADDED is a rule for a case that rule
                never named: a fault that belongs to no test at all (a worker/global-teardown crash,
                a wedged app blowing the teardown budget) — zero failed, zero flaky, yet non-zero
                exit, which no test-level retry can absorb. Naming and bounding that class is
                materially expanded, additive guidance → MINOR, in the exact lineage of v3.13.0 →
                v3.14.0, which likewise strengthened Principle V with a rule for how a test RUN is
                conducted. A run compliant under v4.0.0 remains compliant under v4.1.0.

                The rule closes a real hole: run 29909576080 reddened master with 121 passed / 1
                flaky and a "Worker teardown timeout … 1 error was not a part of any test", where a
                wedged Electron app blew Playwright's worker-teardown budget. The strict gate had no
                vocabulary for a non-test fault, so an infra crash and a genuine defect were
                indistinguishable — both simply "red", inviting the very re-run-until-green habit the
                flaky rule forbids. The sub-rule gives the harness a bounded, auditable path for the
                infra class WITHOUT loosening the gate for tests.
Modified principles: V "Test-First Quality Discipline" (added the infrastructure-fault sub-rule to
                the "A test run MUST be executed once" block, and requires the harness to bound its
                own teardown). Title and every existing rule unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check is dynamic ("[Gates determined based
       on constitution file]"); the new sub-rule is picked up automatically. No edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no change required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; no change required.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ playwright.config.ts                 — the strict gate (failOnFlakyTests, retries-for-diagnosis)
       is unchanged; a machine-classifiable `json` reporter is added in sharded mode so CI can
       evidence the zero-unexpected/zero-flaky condition the sub-rule gates the retry on.
  ✅ .github/workflows/ci.yml + scripts/ci-e2e-shard.ps1 — implement the sub-rule: retry a shard
       once ONLY when its report shows 0 unexpected AND 0 flaky, comment the retry on the tracking
       issue (#75), and stay red otherwise.
  ✅ packages/ui/tests/e2e/harness.ts     — bounds its own teardown (force-kills a wedged app tree),
       satisfying the "prevent at source" clause; covered by harness-shutdown.e2e.ts.
  ✅ specs/*                              — historical records; not rewritten. No spec is the source
       of this amendment, so no spec version citation advances.
Deferred TODOs: none.

                ---- superseded amendment (historical) ----
Version change: 3.15.0 → 4.0.0
Bump rationale: MAJOR. The Documentation-currency rule's mandated artifact `ROADMAP.md` is REMOVED,
                and the forward-looking list moves to the issue tracker (2026-07-17).

                MINOR was proposed when this amendment was requested, considered, and REJECTED.
                The versioning policy makes MAJOR "removal or backward-incompatible redefinition of
                a principle OR GOVERNANCE RULE", and v3.15.0 set the test: a bump is MAJOR when a
                PREVIOUSLY-STATED guarantee is withdrawn or reversed, the v2.0.0 → v3.0.0 case being
                one where previously-compliant LAYOUTS became non-compliant. Both limbs are met here,
                and not marginally:

                  - WITHDRAWN. "`ROADMAP.md` — the single forward-looking list" was a standing
                    obligation of the Documentation-currency rule (NON-NEGOTIABLE). It is deleted,
                    not reworded. A rule is removed.
                  - REVERSED. What was MANDATORY is now FORBIDDEN: the rule newly states the project
                    MUST NOT maintain a second forward-looking list in a tracked file. A repository
                    that was compliant under v3.15.0 — one carrying a current ROADMAP.md — is
                    non-compliant under this version. That is precisely the v3.0.0 shape, with
                    "repository" in the place of "layout".

                This is the ordinary reading of the project's own policy, and calling it MINOR would
                make the version line untrustworthy in the one case the policy was written for.
                Nothing about the APPLICATION changes: no code becomes non-compliant, the eleven
                principles are untouched in number, name and substance, and every shipped behaviour
                is unaffected. The blast radius is documentation governance alone — which is why it
                is MAJOR-by-rule rather than MAJOR-by-consequence.

                The change: two forward-looking lists drift, and a drifted list is worse than none.
                throng already tracks planned work as labelled issues grouped into milestones — a
                list that cannot silently rot, because closing the work closes the entry. ROADMAP.md
                duplicated that list by hand and had already drifted from it (issues #9 and #29 were
                delivered and closed while the milestone that mirrored them still showed unchecked;
                WSL support was listed in the v1.0.0 milestone's scope while its issue sat in vNext).
                The intent the rule protected is PRESERVED and now stated more strongly: future
                scope MUST NOT live in the README — and now, MUST NOT live in any tracked file.

Modified principles: none. All eleven are untouched — this amendment is confined to Development
                Workflow & Quality Gates.
Added sections: none. The Documentation-currency rule gains a `docs/` bullet (the standing user and
                contributor guides) and an issue-tracker bullet replacing the ROADMAP.md bullet.
Removed sections: the `ROADMAP.md` artifact requirement, in all three places it was binding —
                the Documentation-currency rule, the Incremental (staged) delivery rule (deferrals
                are now surfaced as open labelled issues), and the code-review gate's document list.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check is dynamic ("[Gates determined based
       on constitution file]") and names no document; picks this up automatically. Verified by
       reading it, not assumed.
  ✅ .specify/templates/spec-template.md  — zero roadmap/constitution references; no change required.
  ✅ .specify/templates/tasks-template.md — zero roadmap/constitution references; no change required.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ ROADMAP.md                           — DELETED in this change; the file this amendment retires.
  ✅ README.md                            — the two ROADMAP.md links repointed at the issue tracker
       and milestones; macOS/Linux now cite issues #22/#23; a new docs/ pointer added.
  ✅ CONTRIBUTING.md                      — Docs-are-current non-negotiable and lifecycle step 5 now
       name README / docs/ / CONTRIBUTING; a Labelling section is added (type + area + milestone).
  ✅ .github/PULL_REQUEST_TEMPLATE.md     — the "ROADMAP.md updated" checklist row is replaced by a
       docs/ row noting planned work lives in issues, so there is nothing to tick off.
  ✅ docs/                                — quick-start.md (user guide) and README.md (index) added;
       the index states where forward-looking work lives, so no reader re-invents a roadmap.
  ✅ specs/*                              — historical feature records; they cite the constitution
       version current at their time and are deliberately NOT rewritten. No spec is the source of
       this amendment, so no spec version citation advances (contrast v3.15.0, which came out of
       feature 016 and advanced that feature's citations).
Deferred TODOs: none.

                ---- superseded amendment (historical) ----
Version change: 3.14.0 → 3.15.0
Bump rationale: MINOR. Principle XI (Dockable Workspace: Panes, Tabs & Panels) gains an additive
                "One document, one state" rule (2026-07-13, issue #68, feature 016 FR-028/FR-028d).

                Considered MAJOR and rejected. MAJOR is reserved for the removal or backward-
                incompatible REDEFINITION of a principle — as in v2.0.0 → v3.0.0, where Principle
                XI's three-Pane model was REPLACED by the two-Pane model and previously-compliant
                LAYOUTS became non-compliant. Nothing in XI's docking model (Panes, Tabs, Panels,
                splitting, tear-off, sub-workspaces, persistence) is changed or contradicted here:
                every layout compliant under v3.14.0 remains compliant. What is added is a rule
                about the STATE of the content a Panel presents — an area XI previously left
                undefined. That is materially expanded, additive guidance → MINOR.

                It is true that the rule makes a piece of SHIPPED code non-compliant (see the
                known violation below). That does not make the amendment MAJOR: the same was true
                of v3.11.0 → v3.12.0 (themeable icon controls), which was likewise recorded as
                MINOR and forward-looking, with its known violations named and scheduled. A new
                constraint that existing code fails is the ordinary case for an additive rule; a
                bump is MAJOR only when a PREVIOUSLY-STATED guarantee is withdrawn or reversed.

                The rule: a Panel is a VIEW; the artefact it presents is a DOCUMENT. When one
                artefact is presented by more than one Panel — same Tab, different Tabs, or
                different windows — it MUST be ONE document in every respect. Every Panel showing
                it shares, as a SINGLE VALUE: the content buffer and its dirty state, the
                undo/redo history, the effective language (including any manual override), and the
                effective indentation. Only VIEW state — cursor, selection, scroll, per-panel zoom
                — MAY differ per Panel. The test is AUTHORITY, not mechanism: exactly ONE component
                owns the document state and every other copy is a DERIVED REPLICA driven by that
                authority's ORDERED CHANGE STREAM. Peer-to-peer reconciliation between co-equal
                copies is FORBIDDEN, and a change based on a superseded version MUST be REBASED onto
                the authority's current version rather than applied at the position it first named.
                The rule deliberately does NOT demand one literally-shared in-memory object: views
                may live in different processes, where that is impossible. What it forbids is TWO
                ORIGINALS. (Wording sharpened during the same-day /speckit-clarify pass: an earlier
                draft said "shared, not synchronised" and declared any relay non-compliant, which —
                read literally — forbade EVERY implementable cross-process design, including the one
                feature 016 adopts. A rule that no design can satisfy governs nothing.)

                Why it is constitutional rather than a rule of one feature: it was arrived at by
                finding a CONTENT-CORRUPTION path the previous (unstated) model permitted — one
                file, open in two Panels, with a different effective indentation in each, writes
                BOTH indentation styles into the ONE buffer that is saved to disk. That hazard is
                not a property of editors; it belongs to ANY panel type that can present the same
                artefact twice — a diff view, a document preview, a notebook view, a plugin-
                supplied Panel. Left as a local decision of feature 016, the next panel type
                re-derives it, or doesn't, and reintroduces the corruption path.

Modified principles: XI "Dockable Workspace: Panes, Tabs & Panels" (added the "One document, one
                state" rule and a matching clause in the principle rationale). Title unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check is dynamic ("[Gates determined based
       on constitution file]"); the new rule is picked up automatically. No edit needed (verified,
       not assumed).
  ✅ .specify/templates/spec-template.md  — principle-agnostic (zero principle/constitution
       references); no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic (zero references); no changes required.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ Development Workflow & Quality Gates — the particular-scrutiny review bullet is extended to
       cover changes to the state of a document presented in more than one Panel, and to name
       Principle XI alongside II, III, V and VII.
  ✅ specs/016-advanced-editor/*          — plan.md's Constitution Check row for XI is corrected
       (it read "PASS (untouched)", which this amendment falsifies: XI is now the principle 016
       most directly serves). Version citations in plan.md, research.md, quickstart.md and
       tasks.md advanced 3.14.0 → 3.15.0.
  ⚠ packages/ui/src/renderer/editor/     — KNOWN VIOLATION at time of amendment: a file mirrored
       into a second Editor Panel is rendered by a SEPARATE CodeMirror EditorView with its OWN
       history(), the two kept in step by relaying {text, dirty}. That is synchronised state, not
       shared state, so undo/redo is per-view today and diverges at the first unrelayed update.
       This amendment is forward-looking and does not break existing behaviour by itself; the
       violation is remediated by feature 016 (FR-026c, the document-level undo history), which
       is the feature this rule was extracted from. Tracked by #68.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.13.0 → 3.14.0
Bump rationale: MINOR. Strengthens Principle V (Test-First Quality Discipline) with an explicit
                rule for how a test RUN is conducted (2026-07-12), additive; no principle removed
                or redefined.

                The suites here are expensive — E2E alone runs for minutes — and the failure mode
                being closed is a real one, observed during feature 015: a suite was run with its
                output piped through `grep` so that only the summary line survived, the failure
                detail was discarded, and the suite was then re-run repeatedly at several minutes
                a time purely to recover the name of the test that had already failed. Worse, a
                flaky test that passed on one of those re-runs would have been silently absorbed
                into a green bar.

                The rule: run a suite ONCE, UNFILTERED, and capture its COMPLETE output; parse that
                captured output as many times as needed rather than re-running. After a failure,
                re-run ONLY the failing tests until they pass; then re-run the FULL suite once to
                prove nothing else broke. A test that fails and then passes with no code change is
                flaky, not fixed, and MUST be investigated or tracked — never absorbed by
                repetition.

Impact: ✅ Principle V — new sub-rule on conducting a test run.
        No template, plan or spec artifact changes required (this governs execution, not authoring).
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.12.0 → 3.13.0
Bump rationale: MINOR. One additive governance rule (2026-07-11), no principle removed
                or redefined: Development Workflow & Quality Gates gains a "Static analysis &
                linting" quality gate — the codebase MUST pass an automated linter (ESLint with
                the typescript-eslint rule set) with ZERO errors, in addition to strict TypeScript
                type-checking (`tsc`), before a change is complete and before a PR merges; a lint
                error is a build failure, not a suggestion. Lint rules MAY be scoped/tuned in the
                shared lint configuration where a rule is genuinely inapplicable, but MUST NOT be
                disabled ad hoc to paper over a real defect (a line-level suppression MUST be
                justified). The lint + type-check gates, together with the Principle V test layers
                (unit/integration/contract/E2E), MUST run in continuous integration on every pull
                request so a red gate blocks merge automatically rather than relying on local
                discipline. The code-review gate is extended with a matching lint/type-check check.
                Materially expanded, additive workflow guidance → MINOR.
Modified principles: none (rule added under Development Workflow & Quality Gates; the code-review
                gate is extended to verify lint + type-check pass with zero errors). Titles unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check references the constitution
       dynamically; the new rule is picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; no changes required.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ eslint.config.js + package.json (`lint` / `typecheck` scripts) + .github/workflows/ci.yml —
       implement and enforce this rule: a flat ESLint config (typescript-eslint) across the
       workspace, and a CI workflow that runs lint, type-check, the vitest layers, and the
       Playwright-Electron E2E suite on `windows-latest` for every push / pull request.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.11.0 → 3.12.0
Bump rationale: MINOR. One additive governance rule (2026-07-10), no principle removed
                or redefined: Development Workflow & Quality Gates gains a "Themeable icon controls"
                rule — every interactive control that performs an action MUST be presented as an icon
                drawn from the active theme's icon set, carrying a hover title that names the action,
                in place of a text label; icon colours MUST derive from theme tokens and MUST NOT be
                hardcoded CSS or inline SVG. A narrow exception is stated for decision buttons inside
                dialogs (confirm / cancel / save-as), which remain text-labelled because their label
                IS the statement of consequence the user is consenting to. The code-review gate is
                extended with a matching themeable-icon-control check. Materially expanded, additive
                workflow guidance → MINOR.
Modified principles: none (rule added under Development Workflow & Quality Gates; the code-review gate
                is extended to verify themeable icon controls). Titles unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check references the constitution
       dynamically; the new rule is picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; a feature that adds an action control
       MUST include the icon-token + hover-title tasks; enforced at /speckit-tasks time.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ⚠ packages/ui/src/renderer/preferences/  — KNOWN VIOLATIONS at time of amendment: preferences-app.tsx
       (ResetIcon / RevertAllIcon inline SVG), settings-tab.tsx (ClearIcon inline SVG), and themes-tab.tsx
       (text-labelled .prefs-toolbtn controls). This amendment is forward-looking: the rule binds every
       change from this point on, and the pre-existing violations above are remediated by the next change
       that touches those controls. No existing behaviour is broken by the amendment itself.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.10.1 → 3.11.0
Bump rationale: MINOR. One additive governance rule (2026-07-08, feature 007 FR-048), no
                principle removed or redefined: Development Workflow & Quality Gates gains a
                "Configuration-editor completeness" rule — every configurable application setting,
                key binding, and theme token MUST be exposed and editable through the visual
                preference editors, and when new configuration is added the corresponding editor
                MUST be updated to expose it (no configuration editable only by hand-editing JSON).
                The rule is enforced by a declarative editor-metadata registry (one descriptor per
                configurable key, in @throng/core) plus a completeness test asserting every
                configurable key/action/token has a descriptor — a newly added config key without an
                editor descriptor fails the test. The code-review gate is extended with a matching
                configuration-editor-completeness check. Materially expanded, additive workflow
                guidance → MINOR.
Modified principles: none (rule added under Development Workflow & Quality Gates; the code-review
                gate is extended to verify configuration-editor completeness). Titles unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check references the constitution
       dynamically; the new rule is picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; a feature that adds configuration
       MUST include the editor-descriptor + completeness-test tasks; enforced at /speckit-tasks time.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ specs/007-preferences-editor/*       — the FR-025a editor-metadata registry + FR-047 completeness
       tests (settings/keybindings/theme) already implement and verify this rule; spec FR-048 records it.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.10.0 → 3.10.1
Bump rationale: PATCH. Clarification only — no new obligation and no principle changed (2026-07-03):
                the Incremental Delivery rule now explicitly cross-references ROADMAP.md as the
                project-level home for deferred / end-state capabilities, connecting it to the
                Documentation-currency rule (v3.10.0) that already makes ROADMAP.md the single
                forward-looking list. No meaning change: deferrals were already required to be tracked
                (per-plan Complexity Tracking) and planned capabilities already had to appear in
                ROADMAP.md — this simply names the link. Net: PATCH.
Modified principles: none. (Development Workflow & Quality Gates — the Incremental Delivery clause gains
                a cross-reference to ROADMAP.md.)
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ ROADMAP.md — the forward-looking list; extended with newly planned items (enhanced project list,
       rich editors, native-folder-view panels, Markdown preview, terminal presets, additional
       terminal integrations, change review, diff tool, git worktrees, agents & multi-agent handoff,
       plugin system, backup/restore, macOS/Linux) and delivered items (theming, lazy loading) marked
       done. Existing principles already accommodate these (e.g. IV native-terminal/auto-detect covers
       the extra terminals; agents are existing future scope; import/export sits under Per-user local
       storage), so no per-feature principle changes are warranted.
  ✅ .specify/templates/*, .specify/extensions.yml — unaffected by a cross-reference clarification.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.9.0 → 3.10.0
Bump rationale: MINOR. One additive rule (2026-07-03), no principle removed or redefined:
                Development Workflow & Quality Gates gains an explicit "Documentation MUST be kept
                current as part of the lifecycle" rule — every change that alters user-facing
                behaviour, setup/commands, architecture, or the delivered/roadmap capability set MUST
                update the affected project docs in the SAME change: at minimum README.md (which
                describes only the current shipped finite state, with no per-feature narration),
                CONTRIBUTING.md, and ROADMAP.md (delivered items marked done, newly planned items
                added). Documentation reconciliation is part of /speckit-converge and the definition
                of done — a change MUST NOT be complete, and a PR MUST NOT merge, while these docs
                disagree with shipped behaviour. The code-review gate is extended with a matching
                doc-currency check. Materially expanded, additive workflow guidance → MINOR.
Modified principles: none (rule added under Development Workflow & Quality Gates; the code-review gate
                is extended to verify documentation currency). Titles unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check references the constitution dynamically;
       the new workflow rule is picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; a feature that changes user-facing
       behaviour MUST include a doc-update task; enforced at /speckit-tasks time, not in the template.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ README.md / CONTRIBUTING.md / ROADMAP.md — README rewritten to the current finite state; ROADMAP.md
       created (delivered vs planned); PR template gains a documentation-currency checkbox.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.8.0 → 3.9.0
Bump rationale: MINOR. Two additive rules (2026-07-03), no principle removed or redefined:
                (1) Principle V (Test-First Quality Discipline) gains an explicit "Generated test
                artifacts & temporary files MUST be cleaned up" rule — files created by/for a test
                run and any scratch/temp files (fixtures, temp scripts, throwaway `tmp.*` sources,
                generated output) MUST be removed once they have served their purpose, MUST NOT be
                committed or left lingering, tests MUST self-clean the artifacts they create, and a
                green bar MUST NOT leave orphaned generated files behind.
                (2) Principle III (Detached, Tagged & Persistent Terminals) gains an explicit "No
                orphaned terminal windows/views on user-instructed destruction" rule — when the user
                instructs the app to destroy a terminal by ANY path (close/kill, panel-destroy,
                project-delete, app-close terminate-all), the terminal's on-screen surface (window or
                Panel view) MUST be fully torn down together with its process (complementing the
                existing resource-hygiene / no-orphaned-process rule); no window, view, or ghost
                surface may linger after a commanded destroy.
                Both are materially expanded guidance within existing principles → MINOR.
Modified principles: V "Test-First Quality Discipline" (added test-artifact / temp-file cleanup rule);
                III "Detached, Tagged & Persistent Terminals" (added no-orphaned-window / view rule on
                user-instructed destruction). Titles unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check gate references the constitution
       dynamically; both new rules are picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; no changes required.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ specs/005-terminal-panel-type/*      — destroy/terminate-all + resource-hygiene work already
       covers the terminal-window teardown; test-artifact cleanup applies to the e2e suite (e.g. the
       stray tmp.ts) and is enforced at review time, not in a template.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.7.0 → 3.8.0
Bump rationale: MINOR. Strengthens Principle III (Detached, Tagged & Persistent Terminals) with an
                explicit "No orphaned OS processes (resource hygiene)" rule (2026-07-02): when a terminal
                ends by ANY path — user close/kill, panel-destroy, project-delete, app-close terminate-all,
                self-exit, or daemon shutdown — every OS resource it created (including the per-terminal
                Windows/ConPTY `conhost.exe` host) MUST be released; a terminal host MUST reap its terminals
                before exiting and a detached helper MUST self-terminate when its server is gone; and this
                MUST be verified by a process-level E2E asserting the host's terminal child-processes return
                to baseline after each end path. Additive; no principle removed or redefined. Net: MINOR.
Modified principles: III "Detached, Tagged & Persistent Terminals" (added the resource-hygiene / no-orphaned-
                process rule + its process-level-E2E verification requirement). Title unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ specs/005-terminal-panel-type/*      — FR-015b/018/022 + the T134 convergence task and
       terminal-no-orphans.e2e.ts implement and verify the new rule; spec Release Status records it.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.6.0 → 3.7.0
Bump rationale: MINOR. Strengthens Principle V (Test-First Quality Discipline) with an explicit,
                non-negotiable rule for privilege-dependent tests (2026-07-02): behaviour that only
                manifests when running elevated (the run-as-admin terminal path + OS de-elevation,
                Principle III / FR-025) MUST be tagged `@admin`, skipped when the test process is not
                elevated (no hollow non-elevated baseline), and verified only under an elevated run —
                and every E2E run MUST emit a reminder that the `@admin` suite is elevation-gated so a
                green non-elevated bar never implies admin coverage. Additive testing discipline; no
                principle removed or redefined. Net: MINOR.
Modified principles: V "Test-First Quality Discipline" (added the privilege-dependent / `@admin`
                elevation-gating + per-run reminder rule). Title unchanged.
Added sections: none. Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/*                 — principle-agnostic / dynamic Constitution Check; no edit needed.
  ✅ specs/005-terminal-panel-type/*      — FR-025/025a-d + the de-elevation convergence task already
       document the elevated-verification requirement; the `@admin` tag + reminder implement it.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.5.0 → 3.6.0
Bump rationale: MINOR. Two additive/relaxing changes for the 005 batch-2 refinements (2026-07-01):
                (1) Principle XI — the Sidebar Pane no longer requires a stacked *Terminals* Panel; it now
                hosts the Projects and Sub-workspaces panels only (Sub-workspaces pinned to the bottom).
                This REMOVES a specific sub-requirement (the Terminals list Panel) but does not remove or
                redefine a principle — the docking model, project-first isolation, and the Projects /
                Sub-workspaces panels are unchanged; a terminal *list* was never a load-bearing guarantee
                (terminals live in workspace Panels, Principle III/VI). Every other prior-compliant design
                stays compliant. (2) Principle III — adds an explicit "terminal elevation follows the
                application" clause: terminals inherit the integrity level of the app/daemon, so running a
                terminal as administrator requires launching throng elevated; there is no separate
                elevation broker. Additive clarification of existing behaviour. Net: MINOR.
Modified principles: XI "Dockable Workspace: Panes, Tabs & Panels" (Sidebar no longer lists a Terminals
                Panel; Sub-workspaces pinned to the bottom); III "Detached, Tagged & Persistent Terminals"
                (added the elevation-follows-the-app clause). Titles unchanged.
Added sections: none. Removed sections: none (a sub-requirement within Principle XI was dropped).
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check gate references the constitution
       dynamically; both changes are picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; no changes required.
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
  ✅ specs/005-terminal-panel-type/spec.md — batch-2 clarifications (2026-07-01) + FR-023 (sidebar) and
       FR-025/025a-d (elevation) written to match this amendment.
  ✅ specs/003-layout-and-app-tweaks/*     — Terminals-Panel-in-sidebar references to be scrubbed with FR-023.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.4.0 → 3.5.0
Bump rationale: MINOR. Adds a new "Idempotent data migrations" constraint under Technology &
                Architecture Constraints: any schema/data migration MUST be safe to re-run and safe
                to run against an already-migrated store, always converging on the same end state
                without erroring or duplicating/corrupting data. This is materially expanded,
                additive guidance (a new constraint), not the removal or redefinition of an existing
                principle, so it is a MINOR bump. Every prior-compliant design remains compliant.
Modified principles: none (constraint added under Technology & Architecture Constraints).
Added sections: none (one new bullet under Technology & Architecture Constraints: Idempotent data
                migrations). Removed sections: none.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check gate references the constitution
       dynamically; the new constraint is picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; no changes required. (Features that
       add a migration MUST include a task asserting idempotent re-run; enforced at /speckit-tasks
       time, not in the template.)
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.3.0 → 3.4.0
Bump rationale: MINOR. Strengthens Principle V (Test-First Quality Discipline) with an explicit,
                non-negotiable rule: every user-facing UI change MUST ship with passing E2E test
                coverage, and a UI change MUST NOT be marked complete on build/unit evidence alone.
                This materially expands existing testing guidance (the E2E layer was already
                mandated for critical journeys) rather than removing or redefining a principle, so
                it is additive. Templates reviewed below; no principle removed or redefined.
Modified principles: V "Test-First Quality Discipline" (added the UI-changes-require-E2E rule;
                title unchanged).
Added sections: none. Removed sections: none.
Clerical correction (2026-06-29): the footer "Last Amended" date for v3.4.0 was recorded as
                2026-06-27 (carried over unchanged from the v3.3.0 amendment) even though v3.4.0
                post-dates it; it is corrected to 2026-06-29, the date v3.4.0 actually landed
                (the feature 004 artifacts that cite v3.4.0 are dated 2026-06-29). Metadata-only:
                no principle text and no version number changes.
Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md  — Constitution Check gate references the constitution
       dynamically; the new V rule is picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md  — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md — principle-agnostic; no changes required. (Per-feature
       tasks for UI stories MUST now include an E2E task; enforced at /speckit-tasks time, not in
       the template.)
  ✅ .specify/extensions.yml              — no before/after_constitution hooks registered.
Deferred TODOs: none.
                ---- prior amendment (historical) ----
Version change: 3.2.0 → 3.3.0
Bump rationale: MINOR. Reconciles the constitution with the 003 "Layout and app tweaks" feature
                (clarify session 2026-06-27). Principle I: adds project root-folder exclusivity as
                a fundamental restriction (no shared/ancestor/descendant roots; enforced on create
                and edit). Principle XI: the Sidebar Pane stays shown by default when no project is
                active (so a project can be selected) while the File Explorer Pane defaults to
                collapsed; adds a Sub-workspaces Panel to the sidebar and makes sub-workspaces
                first-class named/coloured/listed/managed entities (close = keep, delete = destroy,
                lazy reopen); windows form a focus/raise group with independent minimise, and
                closing the main window closes all sub-workspaces. Architecture: adds single-instance
                and lazy-project-loading constraints and a user-scoped config-files (settings /
                keybindings / themes) constraint. Refinements within an existing principle and new
                additive constraints — no principle removed or fundamentally redefined.
                ---- prior amendment (historical) ----
Version change: 3.1.0 → 3.2.0
Bump rationale: MINOR. Adds an "Incremental (staged) delivery" rule to Development Workflow &
                Quality Gates and relaxes (without removing) the timing of two Principle I
                requirements and one Principle XI requirement, so a capability mandated by the
                constitution MAY be delivered across features — e.g. the File Explorer Pane
                introduced as an empty shell ahead of its file-tree content and Markdown preview
                (feature 003 scope reduction, 2026-06-27). Backward-compatible: every
                previously-compliant design remains compliant (this is a relaxation that adds an
                allowance, not a redefinition). End-state requirements are UNCHANGED and MUST
                remain tracked as deferrals until delivered. Also relaxes Principle XI's no-project
                wording so a hidden pane MAY collapse to a slim reveal affordance the user can
                expand to an empty pane.
                ---- prior amendment (historical) ----
Version change: 2.0.0 → 3.0.0
Bump rationale: MAJOR. Backward-incompatible redefinition (and rename) of Principle XI
                to match the redesigned specs/002-panes-and-panels (second /speckit-clarify
                session, 2026-06-26). The previous three-Pane / Middle-tabbed model
                (Left=project list, Right=terminal list, Middle=tabbed terminals; every
                non-Middle Pane stacks) is REPLACED by a three-entity, two-Pane model:
                  - Panes (TWO by default): a stacked Sidebar Pane (Projects + Terminals
                    Panels) and a Workspace Pane (the active project's tab group).
                  - Tabs (new entity): live only in the Workspace Pane; each Tab is a
                    split tree of Panels.
                  - Panels: tiled within a Tab; reattach only to their original project;
                    the main workspace never mixes projects.
                Tear-off now detaches Tabs/Panels into "sub-workspaces" that may mix
                projects. Designs compliant under v2.0.0 (three Panes, Middle-tabbed) are
                non-compliant now — hence MAJOR. Also adds a "Per-user local storage"
                architecture constraint (no login; local profile; owner/user key for future
                multi-user + import/export) and minor terminology tweaks in Principle VI.

Principles (still 11):
  I.    Project-First Context Isolation          (unchanged; now actively built by 002)
  II.   Platform-Abstracted Core (OS-Agnostic)   (unchanged)
  III.  Detached, Tagged & Persistent Terminals  (unchanged; terminal-Panel wording still valid)
  IV.   Native Terminal Support & Auto-Detection (unchanged)
  V.    Test-First Quality Discipline            (unchanged)
  VI.   Simple, Modern, Discoverable UX          (TWEAKED: terminology — tabs hold multi-Panel
                                                  split layouts; Panels tiled within Tabs in
                                                  the workspace Pane beside a stacked sidebar)
  VII.  Change Review & Approval                 (unchanged)
  VIII. SOLID, DRY & YAGNI Engineering Discipline (unchanged)
  IX.   Dependency Injection & Composition Root  (unchanged)
  X.    Externalised Configuration               (unchanged)
  XI.   Dockable Panel & Pane Workspace          (RENAMED → "Dockable Workspace: Panes, Tabs &
                                                  Panels"; REDEFINED to the two-Pane / tab-group /
                                                  split-Panel / sub-workspace model above)

Renamed principles: XI "Dockable Panel & Pane Workspace" → "Dockable Workspace: Panes, Tabs & Panels"
Added sections: none (one new bullet under Technology & Architecture Constraints: Per-user local storage)
Removed sections: none

Templates / artifacts reviewed:
  ✅ .specify/templates/plan-template.md   — "Constitution Check" gate references the
       constitution dynamically ("Gates determined based on constitution file"); the
       redefined Principle XI is picked up automatically, no edit needed.
  ✅ .specify/templates/spec-template.md    — principle-agnostic; no changes required.
  ✅ .specify/templates/tasks-template.md    — principle-agnostic; no changes required.
  ✅ .specify/extensions.yml                 — no before/after_constitution hooks registered.
  ✅ specs/002-panes-and-panels/spec.md      — already written to this model (two Panes, tab
       groups, split Panels, real projects, sub-workspaces, local-profile storage); now
       consistent with this constitution (supersedes the v2.0.0 alignment).
  ✅ specs/001-app-bootstrap/*               — bootstrap feature; no Panel/Pane/Tab behaviour,
       unaffected by this amendment.

Deferred TODOs: none.
-->

## Amendment notes

Standalone rationale notes, newest first. The 4.5.0 note is the only record of that amendment.

<!--
  5.4.0 — MINOR. Widens 4.5.0's digit-grouping gate from preference editors to every surface, and
  names the three things that are NOT quantities.

  Rationale: 4.5.0 promoted the rule out of 018's spec because "a per-feature spec is the wrong home
  for a constraint that governs every numeric control added afterwards". It then scoped itself to
  "every number a PREFERENCE EDITOR displays" — which reproduced the same defect one level up. Spec
  040 hit it exactly: the editor status bar is about to display a character count, it is not a
  preference editor, and on a literal reading `1048576` was permissible on a surface whose whole
  purpose is being read at a glance. The rule's own rationale — "eight digits nobody can scan" —
  described the new surface better than its scope line did.

  Two things settled the wording, and both came from reading the code rather than from the principle.

  FIRST, the practice was ALREADY wider than the text. `quick-open.tsx` groups "Showing N of M
  matches" and has since 033; nothing in the constitution asked it to. Meanwhile `find-bar.tsx`
  renders `N of M` ungrouped, and a find in a large file passes a thousand matches routinely. One
  rule, two surfaces of the same kind, opposite answers — the signature of a scope line nobody can
  apply.

  SECOND, and the reason this is not a one-word edit: "any surface displaying a number" would have
  been ACTIVELY HARMFUL. `unique-name.ts` builds `Panel ${n}` and `${base} (${n})`; `naming.ts`
  builds `${stem} copy ${n}`. Widened naively, the rule mandates `Panel 1,024` and a filename with a
  comma in it. `goto-line.tsx` already carries a comment reasoning its way to the same boundary from
  the other side — it seeds an editable field whose parser takes bare digits, so a grouped seed makes
  the field's own starting value invalid and Enter on an untouched `1,024` moves nothing.

  Hence the rule is about QUANTITIES — amounts a user reads — with identifiers, editable seeds and
  machine-read fields named as exclusions. That a contributor had already written the goto-line
  carve-out into a source comment is the evidence that the boundary needed stating here instead.

  The four known gaps are enumerated in the rule rather than fixed in this amendment, following
  4.6.0's precedent: a widened rule the shipped app does not satisfy is recorded as an end-state
  requirement with its gaps listed, never as a rule the codebase quietly violates.
-->

<!--
  5.0.0 — MAJOR. Principle V no longer mandates an E2E per user-facing UI change. Full rationale is
  in the Sync Impact Report at the top of this file; the short version is that the rule was a
  one-way ratchet with no ceiling, and it produced an inverted pyramid — 235 E2E spec files and 46.9
  measured minutes against 250 unit files — that every contributor paid for on every push.

  The guarantee is unchanged: a change still ships with observed passing coverage. What changed is
  which layer owes it. Coverage now goes to the lowest layer that can prove the behaviour, E2E is
  reserved for what only a running application can show, and an existing E2E may be deleted only
  once its replacement has been observed FAILING against a broken implementation.
-->

<!--
  4.7.0 — MINOR. Principle VI gains "Disabled when unavailable, absent when meaningless".

  Rationale: the codebase already held one half of this. The explorer's undo/redo items carry an
  explicit comment — "Disabled, not hidden, when the stack is empty: an action that exists and is
  unavailable teaches what the menu can do; one that vanishes teaches nothing" — but it was a note on
  two menu items, so every later control re-decided the question from scratch. Spec 033 wrote
  "absent or disabled" three times before anyone noticed that an either/or is not a requirement,
  which is what prompted this.

  The distinction is the useful part, and it is what a single blanket rule would have lost. Blanket
  "always disable" puts two permanently dead rows on every file's context menu, since a file cannot
  acquire children. Blanket "always hide" contradicts the shipped undo/redo treatment and makes a
  capability invisible exactly when the user is wondering whether it exists. The discriminator —
  would ANY future state of the application enable this control? — is cheap to apply and gives one
  answer per control rather than one answer per author.
-->

<!--
  4.6.0 — MINOR. Principle VI gains "One section vocabulary for every menu".

  Rationale: the shared ContextMenu has supported dividers since feature 023, and the Files & Folders
  menu has been grouped ever since — but nothing said HOW to group, so the grouping stopped at the
  one menu that did it. Four menus grew without a vocabulary, and the panel header menu reached
  ELEVEN items in one undivided run with Save sitting between Zoom and Revert. Spec 033 had to settle
  the order to place three new items, and an order settled inside a feature spec governs that feature
  and nothing after it — which is exactly how the first grouping failed to spread.

  Two decisions worth recording because both alternatives were considered and rejected. The
  **Contextual** section leads the menu, rather than contextual items taking whichever section they
  naturally belong to: the terminal's link actions are deliberately placed above Copy/Paste (024 US7),
  and a "grouping pass" that demoted them would have shipped a behaviour regression under the banner
  of consistency. And the vocabulary keeps **Content first** rather than Navigate first, which would
  have made the terminal menu conform without an exception but re-ordered the one menu that is already
  grouped correctly.

  Like the "every panel action has a menu item" rule it sits beside, the shipped app does NOT satisfy
  this yet, so it is recorded as an end-state requirement with its four gaps enumerated rather than
  written as a rule the codebase quietly violates.
-->

<!--
  4.5.0 — MINOR. Adds the digit-grouping gate above.

  Rationale: the rule already existed as 018 FR-037/FR-038 and was implemented, but a per-feature
  spec is the wrong home for a constraint that governs every numeric control added afterwards — it
  was discoverable only by reading a shipped feature's spec, and 030 nearly re-litigated it from
  scratch. Promoted so a plan's Constitution Check has to answer for it.

  One substantive change on promotion, decided by the maintainer: 018's five-digit floor is removed.
  Its stated reason was that `5,000` "reads as a typo rather than a kindness" — a defensible
  judgement, reversed because a threshold makes a *column* inconsistent, and 030's own timeout rows
  would have shown `5000` beside `10,000`.

  SUPERSEDED IN PART by 5.4.0 (2026-08-25). The gate's SCOPE — "every number a preference editor
  displays" — was widened to every surface, for the same reason this note gives for promoting it out
  of 018: a scope drawn around one kind of surface is the wrong home for a constraint governing every
  surface added afterwards. The grouping rule itself, the removal of the five-digit floor, and the
  storage prohibition are unchanged. Read 5.4.0's note before citing this one.
-->

<!--
  Amendment note for 4.4.0 and earlier is recorded in git history rather than inline.
-->
