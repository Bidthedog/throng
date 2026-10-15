# Implementation Plan: Fold and Unfold Preferences Sections

**Branch**: `feature/S056-I479-preferences-folding` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/056-preferences-folding/spec.md`

## Summary

Every section, subgroup and nested subsection in the Settings, Key Bindings and Themes tabs becomes a
foldable disclosure heading (#479). It works as follows:

- **One shared component.** `FoldHeading` replaces the three copied `<section><h3>` blocks, the
  hand-built Icons section, and the heading inside `Subsection`.
- **Display.** Each heading shows a chevron, its name and a digit-grouped count ("N", or "N of M" under
  search). While folded, it also shows a warning marker if any hidden row is invalid.
- **Folded rows stay mounted.** They are hidden with `hidden`, so drafts and invalid entries survive a
  fold.
- **Storage.** Fold state is per tab, keyed by the descriptor's own group, subgroup and subsection names.
  It persists across restarts in renderer `localStorage`.
- **Search.** While a search is active, every shown heading (those with a match) is unfolded and the
  stored state is left alone; clearing the search shows it again.
- **Key Bindings has no invalid-entry state.** Its rows show chords, and chord errors live only in the
  capture modal, so the FR-007 marker can never appear on that tab.
- **Toolbar.** Expand All and Collapse All icon buttons sit beside each search box.
- **Supersession.** This supersedes 040 FR-036a and 040 contract rule 3.

Research: [research.md](research.md). Model: [data-model.md](data-model.md). Contract:
[contracts/folding.md](contracts/folding.md).

**Amendment (Session 2026-10-15; FR-016–FR-018, SC-006)**:
- **Default.** Sections start folded; subgroups and subsections start unfolded.
- **Storage.** The store moves to explicit per-heading choices (`v: 2`, research R9).
- **Tests.** A test-only seam, `THRONG_PREFS_SECTIONS_OPEN`, keeps the existing E2E specs on open
  sections. It reaches the renderer as a query parameter on the Preferences window; the harness sets it
  (research R10).
- **New files touched**: `packages/ui/src/main/main.ts` (`rendererQuery`), `packages/ui/src/main/preferences-window.ts`,
  `packages/ui/src/renderer/preferences/preferences-folds.ts` (reads `foldDefault` from its own URL, so no
  change to `renderer/main.tsx` or `preferences-app.tsx`), `use-preference-folds.ts`,
  `packages/ui/tests/unit/preferences-window-query.test.ts` (new), `packages/ui/tests/e2e/harness.ts` and
  `docs/environment.md`.
- **Constitution re-check**: unchanged. The seam is a test seam with existing precedent, and it is
  documented. No setting is added.

## Technical Context

**Language/Version**: TypeScript 6 (strict), React 19

**Primary Dependencies**: Electron 44 renderer; existing `IconButton`, `Icon`, `formatGrouped`
(`@throng/core`), `groupDescriptors`, `filterFields`

**Storage**: renderer `localStorage`, key `throng.preferences.folds` (research R1); no config, IPC or
daemon change

**Testing**: Vitest — `unit` (pure helpers) and `component` (jsdom) projects; no E2E, no integration
(research R8)

**Target Platform**: Windows desktop (Electron); the renderer code is platform-neutral

**Project Type**: desktop app (npm workspaces monorepo: `packages/core`, `packages/ui`, …)

**Performance Goals**:
- A fold toggle re-renders only its tab, with no layout reads.
- Counts are memoised. Totals are computed once per registry. Matches are computed per debounced
  query (150 ms), never per keystroke.

**Constraints**:
- No row unmounts on fold.
- No inline SVG and no literal colours; every icon comes from a theme token.
- The `MutationObserver` is attached only to folded containers and filtered to `aria-invalid`.

**Scale/Scope**: about 15 Settings sections and about 60 headings across three tabs; registries in the
low hundreds of rows

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / gate | Verdict | Note |
|---|---|---|
| I Project-first | ✅ n/a | Preferences is app-wide, not project-scoped |
| II Platform-abstracted core | ✅ | `groupCounts` is pure, lives beside `groupDescriptors` (renderer) — no OS code |
| V Test-first | ✅ | Every FR has a unit or component test written first; no E2E because nothing needs a real window (R8). The 040 "not collapsible" test is rewritten, not deleted |
| VI UX — discoverable, keyboard | ✅ | Native `<button>` in the heading: Tab, Enter, Space, `aria-expanded`. Not a panel, so "every panel action has a menu item" does not apply; Expand/Collapse All are visible buttons |
| VIII SOLID/DRY/YAGNI | ✅ | One `FoldHeading` replaces four copies of section markup; no new store abstraction, one hook |
| IX DI | ✅ n/a | Renderer view state; no service wired |
| X Externalised configuration | ✅ | Fold state is UI state, not configuration (FR-011); no hardcoded tunable introduced |
| XII Responsive UI | ✅ | No layout reads; counts memoised; observer attribute-filtered and folded-only. Measurement obligation applies to "rendering work on an input path": a fold click re-renders one tab, so the PR records the long-task time of Collapse All on the Settings tab |
| Gate: lint/typecheck zero errors | ✅ | Short gates run before ready |
| Gate: configuration-editor completeness | ✅ n/a | No new setting, binding or theme **colour**; the new `warning` **icon** token is a theme token and joins the Icons grid via `theme-copy.ts` |
| Gate: digit-grouped quantities | ✅ | Counts via `formatGrouped` |
| Gate: themeable icon controls | ✅ | Expand/Collapse All are `IconButton`s with existing tokens and titles; chevron and warning come from tokens, coloured by tokens. The heading button's label is the section name — a disclosure, as 046's category header — not an action control with a text label |
| Gate: documentation currency | ✅ | `docs/preferences.md` gains a "Folding sections" passage (FR-015) |
| Per-user local storage | ⚠ justified | `localStorage` lives in the per-OS-user `userData` profile but carries no owner key — see Complexity Tracking |

Post-design re-check: unchanged — the design adds no setting, IPC, process or dependency.

## Project Structure

### Documentation (this feature)

```text
specs/056-preferences-folding/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/folding.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
packages/core/src/config/
├── theme.ts                         # + `warning` icon token in THRONG_THEME.icons
├── theme-copy.ts                    # + label/description for `warning`
└── shipped-defaults.ts              # shipped-defaults version bump, 056 rationale

packages/ui/src/renderer/preferences/
├── fold-heading.tsx                 # NEW — FoldHeading (F1–F7)
├── preferences-folds.ts             # NEW — foldKey(), read/write/prune of throng.preferences.folds
├── use-preference-folds.ts          # NEW — per-tab hook: persisted + transient search folds, expand/collapse all
├── group-descriptors.ts             # + groupCounts()
├── subsection.tsx                   # heading → FoldHeading; drop the "not collapsible" comment
├── settings-tab.tsx                 # sections → FoldHeading; toolbar buttons; counts
├── keybindings-tab.tsx              # same
├── themes-tab.tsx                   # same
├── icon-section.tsx                 # Icons section → FoldHeading
├── map-control.tsx                  # aria-invalid
└── preferences.css                  # heading button, chevron rotation, count, warning, hidden

# (Number, Text, JsonArray and the colour field already set aria-invalid — pinned by test only)
packages/ui/src/main/icon-pack-service.ts            # optional SVG_SHAPES entry for `warning`

packages/core/tests/unit/default-themes.test.ts      # EXPECTED_ICON_TOKEN_COUNT 81 → 82
packages/ui/tests/unit/preferences-folds.test.ts     # NEW — foldKey, store read/write/prune, corrupt JSON
packages/ui/tests/unit/group-counts.test.ts          # NEW — groupCounts
packages/ui/tests/component/preferences-fold-heading.test.ts   # NEW — FoldHeading in isolation
packages/ui/tests/component/settings-tab-folding.test.ts       # NEW — US1/US2/US3/US5 on Settings
packages/ui/tests/component/keybindings-tab-folding.test.ts    # NEW — US4
packages/ui/tests/component/themes-tab-folding.test.ts         # NEW — US4 incl. Icons
packages/ui/tests/component/settings-tab-subgroups.test.ts     # rewrite the FR-036a case

docs/preferences.md                  # folding passage
```

**Structure Decision**: renderer-only change inside the existing `preferences/` module, plus one icon token
in `@throng/core`. No new package, process or IPC.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Fold state in `localStorage` with no explicit owner key (constitution "Per-user local storage") | FR-011 asks for hidden per-user UI state across restarts; `localStorage` is the established home (explorer expansion, pane widths — spec 019 precedent) and lives in the per-OS-user `userData` profile, so the owner is the profile | A `settings.json` internal key routes every click through the atomic config write and hot reload and puts UI state in a hand-edited document; a daemon table or new main-process file adds IPC and a store for one key |
