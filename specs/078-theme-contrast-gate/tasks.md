# Tasks: Theme contrast gate

**Input**: `specs/078-theme-contrast-gate/` — plan.md, spec.md, research.md, data-model.md, contracts/
**Tests**: test-first throughout (constitution Principle V): every story's test task precedes its code and is run red
first.

## Phase 1: Setup

None — existing workspace.

## Phase 2: Foundational

- [x] T001 Add `meetsWcagAa(theme)` (true iff `contrastFailures(theme)` is empty) to `packages/core/src/config/theme-quality.ts` and export it from `packages/core/src/index.ts`, with a failing-first unit test in `packages/core/tests/unit/theme-quality.test.ts` (throng → true; throng with `accentText` = `accent` → false; Matrix → false) — FR-007

## Phase 3: User Story 1 — every everyday theme stays legible (P1)

**Independent test**: lower a pairing in a non-by-design theme → `assertInScopeContrast` throws naming theme, pairing,
ratio, threshold; the same in a by-design theme → no throw, reported by `knownContrastIssues`.

- [x] T002 [US1] Write failing unit tests in `packages/core/tests/unit/theme-quality.test.ts`: (a) throng, Light, Snake, Claude, VSCode and Debian with muted text lowered each make `assertInScopeContrast` throw with `<theme>: <label> = <ratio>:1 (needs <min>:1)` and are absent from `knownContrastIssues`; (b) each by-design theme with the same lowering does not throw and is reported; (c) a theme named in no list (`Some Future Theme`) is gated — FR-001, FR-002, FR-003
- [x] T003 [US1] Remove `IN_SCOPE_THEMES` from `packages/core/src/config/theme-quality.ts` and `packages/core/src/index.ts`; gate `assertInScopeContrast` and report `knownContrastIssues` by `BY_DESIGN_LOW_CONTRAST_THEMES` alone; reword its thrown message to `theme contrast below WCAG 2.1 AA: …`; rewrite the doc comments that cite 009 FR-017/FR-018 or `IN_SCOPE_THEMES` (including `assertSyntaxBodyContrast`'s) to cite 078 — FR-001–FR-003
- [x] T004 [US1] Update every test asserting the three-theme scope: `packages/core/tests/unit/theme-quality.test.ts`, `packages/core/tests/unit/default-themes.test.ts` (test title and the `IN_SCOPE_THEMES` comment at its line 312), and check `packages/core/tests/unit/theme-selection-contrast.test.ts`; `git grep -n -e IN_SCOPE_THEMES -e knownContrastIssues -e "in-scope theme contrast" -- packages` returns no stale hit; run the three files — supersession of 009 FR-017/FR-018

## Phase 4: User Story 2 — text on an accent fill is readable (P1)

**Independent test**: every theme measures accent text on accent at 4.5 and the button and danger text pairs at 3;
every gated theme passes; the three retuned themes and SUBNET differ from version 38 only in their text-on-fill tokens.

- [x] T005 [US2] Write failing unit tests: in `packages/core/tests/unit/theme-quality.test.ts`, `CONTRAST_PAIRINGS` contains `accentText/accent` at `WCAG_AA_BODY` and the seven FR-004a pairs at `WCAG_AA_LARGE_UI`; in `packages/core/tests/unit/default-themes.test.ts`, (a) `assertInScopeContrast(all bundled themes)` passes, (b) for VSCode, English Garden and Debian every colour except `accentText`, `confirmButtonText`, `confirmButtonHoverText`, `cancelButtonHoverText` equals its version-38 value, and those four are equal to each other, (c) for SUBNET every colour except `dangerText`, `destroyButtonText`, `destroyButtonHoverText` equals its version-38 value and those three are `#001B40`, (d) every other bundled theme's colours are unchanged — derive the version-38 values from `V38_MOVED_COLOURS` (T009) plus the current record — FR-004, FR-004a, FR-005, FR-005a, SC-003
- [x] T006 [US2] Append the eight pairings (data-model.md) to `CONTRAST_PAIRINGS` in `packages/core/src/config/theme-quality.ts` — FR-004, FR-004a
- [x] T007 [US2] In `packages/core/src/config/default-themes/index.ts`, add optional palette fields `onAccent` and `onDanger`; derive `accentText`, `confirmButtonText`, `confirmButtonHoverText`, `cancelButtonHoverText` from `p.onAccent ?? p.bg`, and `dangerText`, `destroyButtonText`, `destroyButtonHoverText` from `p.onDanger ?? '#ffffff'`; set `onAccent` for VSCode, English Garden and Debian to a value clearing 4.5:1 on their accent with margin (research R3), and `onDanger: '#001B40'` for SUBNET — FR-005, FR-005a
- [x] T008 [US2] Write a failing unit test for the 38 → 39 upgrade next to the #105 `V37_MOVED_COLOURS` tests (`git grep -n V37_MOVED_COLOURS -- packages/core/tests`): a file holding version 38's value for each moved token moves to the new value; a user-edited value stays; a second pass plans nothing; a theme not in the record is untouched — research R2
- [x] T009 [US2] Bump `SHIPPED_DEFAULTS_VERSION` to 39 in `packages/core/src/config/shipped-defaults.ts` with its history comment; add frozen `V38_MOVED_COLOURS` (VSCode `#1e1e1e`, English Garden `#f0f4e8`, Debian `#1a1a1a` for the four text-on-accent tokens; SUBNET `#ffffff` for the three text-on-danger tokens — confirm each against the version-38 record before freezing); wire it into `planThemeValueUpgrade` as V37 is; export it from `packages/core/src/index.ts`; satisfy `theme-leaves-version.test.ts` / `packages/core/tests/fixtures/theme-leaves-by-version.json` the way #105's value-only bump did — research R2
- [x] T010 [US2] Search every test layer for the moved values and the version literal (`git grep -n -e '#1e1e1e' -e '#f0f4e8' -e '#1a1a1a' -e 'SHIPPED_DEFAULTS_VERSION' -e 'confirmButtonText' -e 'destroyButtonText' -e 'dangerText' -- packages/*/tests`), update the hits that pin this feature's changes, and run the unit and component files among them

## Phase 5: User Story 3 — users can see which themes meet WCAG AA (P2)

**Independent test**: component test of the Themes tab — conforming options labelled, the mark present with its title
only for a conforming selected theme, following an edit and a clone.

- [x] T011 [US3] Add icon key `wcagConformant` to `packages/core/src/icons/icon-keys.ts` with its description ("The mark beside the Themes picker showing that the selected theme meets WCAG AA contrast on every measured pairing."), add Lucide `shield-check` as `packages/core/src/icons/default-set/wcagConformant.svg` with its `SOURCES.json` entry, run `npm run generate:icons`, and run the icon unit tests (`git grep -l -e icon-keys -e ICON_KEYS -- packages/core/tests/unit`) — FR-013
- [x] T012 [US3] Write failing component tests in `packages/ui/tests/component/themes-tab-wcag-mark.test.ts` (harness as in `preferences-themes-tab.test.ts`): (a) options for conforming themes read `<name> — WCAG AA`, others the bare name, `value` always the bare name; (b) `[data-testid="theme-wcag-mark"]` with `title="Meets WCAG AA contrast"` is present for a conforming selected theme and absent otherwise, with no placeholder; (c) a user theme missing tokens is judged after `completeTheme`; (d) a theme whose read fails or whose JSON is invalid is unlabelled and the others still are; (e) changing the active theme's colours across a threshold updates mark and label without remount; (f) a user theme named `Matrix` that passes is labelled; (g) a theme created by Clone is labelled after the tab's refresh, without remount — FR-007–FR-012, spec edge cases, contract themes-tab-mark.md
- [x] T013 [US3] In `packages/ui/src/renderer/preferences/themes-tab.tsx`, on every `refreshThemes()` read the listed themes in parallel with `window.throng.config.readRaw({ kind: 'theme', name })`, parse, `completeTheme`, and keep a `name → conforms` map (a failed read or parse → false, logged through the tab's existing expected-failure logger); use `meetsWcagAa(activeTheme)` for the active theme; render option text and the mark (icon `wcagConformant` via the existing icon component, non-interactive, `data-testid="theme-wcag-mark"`) per contract themes-tab-mark.md — FR-007–FR-012
- [x] T014 [US3] Style the mark in `packages/ui/src/renderer/preferences/preferences.css` from `--throng-colour-text` (research R6), sized and aligned with the toolbar's icon buttons; no hardcoded colour — FR-009
- [x] T015 [US3] Update tests that read theme option TEXT: `packages/ui/tests/e2e/preferences-themes.e2e.ts:317` (`allTextContents()` `toContain('MyTheme')` — match option values instead), and every other hit of `git grep -n -e "theme-select" -- packages/*/tests` that reads option text or selects by label (`selectOption` with a label); run the affected component specs; E2E specs are changed here and run on CI — research R6

## Phase 6: Polish

- [x] T016 Update `docs/preferences.md` themes section: every bundled theme except Matrix, VI-VIM and Gothic is held to WCAG AA by the build, those three are low-contrast on purpose, and what the `— WCAG AA` label and the mark mean — FR-014
- [x] T017 Run the throng-docs audit, `packages/ui/tests/unit/docs-currency.test.ts`, and lint and typecheck for `packages/core` and `packages/ui`

## Dependencies

T001 → T002–T004 (US1) and T012–T013 (US3). US2's T005–T010 depend on T003. T011 → T013. US3's conforming list is
final only after T006–T007.

## Implementation strategy

One boundary (core + one renderer tab), done by the orchestrator in order: Foundational → US1 → US2 → US3 → Polish.

## Phase 7: Round 2 — every theme gated (maintainer, 2026-11-24)

- [x] T018 Rewrite the gate tests for no exemption: Matrix, VI-VIM and Gothic now throw from `assertInScopeContrast`, `assertSyntaxBodyContrast` and `assertSyntaxSelectionContrast` (`packages/core/tests/unit/theme-quality.test.ts`, `theme-selection-contrast.test.ts`, `default-themes.test.ts`) — FR-001–FR-003
- [x] T019 Remove `BY_DESIGN_LOW_CONTRAST_THEMES`, `knownContrastIssues` and `KnownContrastIssue` from `packages/core/src/config/theme-quality.ts` and `packages/core/src/index.ts`; every gate covers every theme — FR-001–FR-003
- [x] T020 In `packages/core/src/config/default-themes/index.ts`, run `readableSelection` for every theme, and set `onAccent` for Gothic (`#d8c8d0`) and VI-VIM (`#000000`) — FR-005, FR-005b
- [x] T021 Extend `V38_MOVED_COLOURS` with Gothic, VI-VIM and Matrix and its test (`theme-text-on-fill-upgrade.test.ts`); re-seed `pre-refactor-theme-colours.json` for the moved values — research R4a
- [x] T022 Update the mark tests for no failing bundled theme: the failing case is a user theme, and all 15 bundled themes are labelled (`packages/ui/tests/component/themes-tab-wcag-mark.test.ts`) — SC-004
- [x] T023 Update `docs/preferences.md` and the manual test plan for every theme gated — FR-014

## Phase 8: Round 3 — no label in the theme list (maintainer, 2026-11-24)

- [x] T024 Drop the per-option label and the listed-theme measurement from `packages/ui/src/renderer/preferences/themes-tab.tsx`, deleting `theme-conformance.ts`; the mark reads the active theme only — FR-008, FR-009
- [x] T025 Rewrite `packages/ui/tests/component/themes-tab-wcag-mark.test.ts` for bare option names and the mark on each bundled theme — FR-008, SC-004
- [x] T026 Update `docs/preferences.md` and the manual test plan — FR-014

## Phase 9: Round 4 — Debian's pink accent (maintainer, 2026-11-24)

- [x] T027 Set Debian's `accent: '#ff5c8f'` and `onAccent: '#000000'` in `packages/core/src/config/default-themes/index.ts` — FR-005c
- [x] T028 Record Debian's accent and its derived tokens in `V38_MOVED_COLOURS` and `theme-text-on-fill-upgrade.test.ts`; re-seed Debian in `pre-refactor-theme-colours.json`; let the v6 and 049 search pins read pre-078 values — FR-005c, SC-003
- [x] T029 Update the manual test plan's Debian step — FR-005c
- [x] T030 Bump shipped defaults to 40 with `V39_MOVED_COLOURS` (Debian's text on the accent at `#ffffff`) so an install an interim 39 build marked still turns pink; move every version pin to 40 — research R4b
