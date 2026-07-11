# Tasks: Theme Content

**Input**: Design documents from `specs/009-theme-content/` (plan.md, spec.md, research.md, data-model.md, contracts/)

**Tests**: REQUIRED — the spec mandates automated distinctness, contrast, copy, and gutter assertions (TDD, fail-first).

**Organization**: Grouped by user story. Foundational maths (theme-quality) is a blocking prerequisite for the guard-based stories.

## Format: `[ID] [P?] [Story] Description`

- **[P]** = may run in parallel (different files, no dependency).

## Path Conventions

Monorepo: core = `packages/core/src/config/`, core tests = `packages/core/tests/unit/`, editor CSS = `packages/ui/src/renderer/editor/`, e2e = `packages/ui/tests/e2e/`.

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: The colour maths every guard depends on.

- [x] T001 [P] Write `packages/core/tests/unit/theme-quality.test.ts` (RED): unit tests for `hexToRgb`, `relativeLuminance`, `contrastRatio` (symmetry, [1,21], known WCAG pairs e.g. #000/#fff = 21), `rgbToLab`, `ciede2000` (identity=0, symmetric, a known ΔE00 reference pair). Tests fail (module absent).
- [x] T002 Implement `packages/core/src/config/theme-quality.ts` colour maths (`hexToRgb`, `relativeLuminance`, `contrastRatio`, `rgbToLab`, `ciede2000`) — pure, no OS/DOM. GREEN for T001.
- [x] T003 Export the new theme-quality surfaces from `packages/core/src/index.ts`.

**Checkpoint**: Colour maths verified.

---

## Phase 2: User Story 1 — Distinctness (P1)

- [x] T010 [US1] Extend `theme-quality.test.ts` (RED): `themePairMinDelta`, `closestPair`, `assertDistinct`. Assert (a) duplicating a theme onto another throws; (b) pre-fix Bash-vs-Matrix min-ΔE00 is small (twins); (c) placeholder for calibrated threshold. Fails (functions absent + Bash still twin).
- [x] T011 [US1] Implement `themePairMinDelta` / `closestPair` / `assertDistinct` + `DISTINCTNESS_THRESHOLD` / `CLOSEST_LEGITIMATE_PAIR_DELTA` constants in `theme-quality.ts` (threshold left provisional).
- [x] T012 [US1] Recolour **Bash** in `packages/core/src/config/default-themes/index.ts` to the multi-hue Git Bash palette (green/magenta/yellow/teal/cyan; black base retained). Matrix untouched.
- [x] T013 [US1] Measure the closest legitimate pair over `ALL_DEFAULT_THEMES` after recolour; set `DISTINCTNESS_THRESHOLD` just below it and record `CLOSEST_LEGITIMATE_PAIR_DELTA`. Finalise `assertDistinct(ALL_DEFAULT_THEMES)` test to pass, assert old-Bash-vs-Matrix < threshold, and print both numbers. GREEN.
- [x] T014 [P] [US1] Extend `default-themes.test.ts`: Bash palette uses ≥5 distinct hues and Bash≠Matrix under min-ΔE00.

**Checkpoint**: Bash is distinct; distinctness guard green and calibrated.

---

## Phase 3: User Story 2 — Hand-written token copy (P1)

- [x] T020 [US2] Write `packages/core/tests/unit/theme-copy.test.ts` (RED): every `themeEditableTokens(THRONG_THEME)` key has a catalogue entry; no label/description matches the word-boundary banned-substring blocklist; no description equals the machine-generated copy. Fails (catalogue absent).
- [x] T021 [US2] Create `packages/core/src/config/theme-copy.ts` — `THEME_TOKEN_COPY` with hand-written label+description for every colour (incl. gutter placeholders), icon, and font/typography token; export the blocklist + a `machineGeneratedCopy(key)` helper (or reuse generator). Export from index.
- [x] T022 [US2] Wire `descriptorForThemeToken` in `packages/core/src/config/theme-metadata.ts` to source label/description from `THEME_TOKEN_COPY` (keep control/group inference; mechanical fallback retained for safety). GREEN for T020.
- [x] T023 [P] [US2] Update `theme-metadata.test.ts` expectations that assert on the old mechanical label/description strings.

**Checkpoint**: Every token has meaningful, abbreviation-free copy.

---

## Phase 4: User Story 3 — Themeable editor gutter (P2)

- [x] T030 [US3] Extend `default-themes.test.ts` + `theme-metadata.test.ts` (RED): `editorGutterBg`/`editorGutterFg` present on every bundled theme; both appear in `THEME_METADATA` as `colour` controls with catalogue copy; default gutter bg is offset from editor bg and gutter fg ≥3:1 on gutter bg (throng + in-scope themes). Fails (tokens absent).
- [x] T031 [US3] Add `editorGutterBg`/`editorGutterFg` to `THRONG_THEME.colours` in `packages/core/src/config/theme.ts` with subtle-offset defaults; add their catalogue copy in `theme-copy.ts`.
- [x] T032 [US3] In `default-themes/index.ts`, make `makeTheme` derive per-theme gutter defaults (offset from `editorBg`; muted fg ≥3:1). GREEN for T030.
- [x] T033 [US3] Repoint `.cm-gutters` background/colour in `packages/ui/src/renderer/editor/editor.css` to `var(--throng-colour-editorGutterBg/Fg)`; leave border + active-line rules intact so only the gutter surface/text change.
- [x] T034 [US3] Write `packages/ui/tests/e2e/editor-gutter.e2e.ts` (RED→GREEN): setting `editorGutterBg`/`editorGutterFg` repaints only the gutter (editor body bg/fg unchanged); a theme document without gutter tokens loads and yields the default gutter CSS variables (no migration).

**Checkpoint**: Gutter is independently themeable; pre-token themes still load.

---

## Phase 5: User Story 4 & 5 — SUBNET & Cyberpunk palettes (P2/P3)

- [x] T040 [P] [US4] Recolour **SUBNET** in `default-themes/index.ts` from the brand palette: Deep Space Blue base, Midnight Slate secondary, Gunmetal Grey chrome/border/muted, Neon Green/Cyan accents+active+cursor only, Burnt Amber callouts.
- [x] T041 [P] [US5] Recolour **Cyberpunk** from the reference palette (#000000 base; #c5003c/#880425 structure; #f3e600 highlights; #55ead4 accents; readable text).
- [x] T042 [US4/US5] Extend `default-themes.test.ts`: SUBNET base is Deep Space Blue and every token maps to the SUBNET palette; Cyberpunk every token maps to the reference palette.

**Checkpoint**: Placeholders replaced with real palettes.

---

## Phase 6: User Story 6 — Contrast guard (P2)

- [x] T050 [US6] Extend `theme-quality.test.ts` (RED): `CONTRAST_PAIRINGS`, `measureContrast`, `assertInScopeContrast`, `knownContrastIssues`. Assert in-scope themes pass AA; a deliberately low-contrast fixture theme throws via `assertInScopeContrast`; out-of-scope shortfalls are reported, not thrown.
- [x] T051 [US6] Implement the enumerated pairings + contrast assertions in `theme-quality.ts`. Tune Bash/SUBNET/Cyberpunk token values until `assertInScopeContrast(ALL_DEFAULT_THEMES)` passes. GREEN.
- [x] T052 [US6] Capture `knownContrastIssues(ALL_DEFAULT_THEMES)` output for the report (out-of-scope shortfalls listed as known issues).

**Checkpoint**: Contrast guard green for in-scope; known issues reported for the rest.

---

## Phase 7: Polish, Docs & Verification

- [x] T060 Run full suite with fresh output: `npm run test:unit`, `test:integration`, `test:contract`, `test:e2e`. Apply `superpowers:verification-before-completion`.
- [x] T061 [P] Update `README.md` (gutter now themeable; recoloured/branded themes) and `ROADMAP.md` per the documentation-currency rule.
- [x] T062 Re-run Constitution Check (v3.12.0); confirm configuration-editor-completeness test passes with the gutter tokens and no editor-renderer change.
- [x] T063 Commit to branch `009-theme-content` (no push).

## Dependencies

- T001–T003 block everything.
- US1 (T010–T014) depends on Phase 1. T013 depends on T012 (Bash recolour) + T011.
- US2 (T020–T023) depends on Phase 1 only; independent of US1.
- US3 (T030–T034) depends on US2 (copy for gutter tokens) + Phase 1 (contrast maths for the 3:1 default check).
- US4/US5 (T040–T042) depend on Phase 1; feed the contrast guard.
- US6 (T050–T052) depends on Phase 1 and on the recoloured themes (US1/US4/US5) + gutter tokens (US3) existing.
- Phase 7 depends on all.

---

## Phase 8: Convergence

- [ ] T064 Reconcile the distinctness metric with the specification — the guard computes the MEAN token-pair CIEDE2000 distance (`themePairDistance` in `packages/core/src/config/theme-quality.ts`), whereas FR-015 and the 2026-07-10 clarification require the MINIMUM. Either ratify the mean-ΔE00 deviation by amending FR-015/the clarification with the recorded degeneracy rationale (minimum = 0 for every pair because all bundled pairs share ≥1 identical token), or restore a non-degenerate minimum-based metric. Functional intent (twin-prevention) is already met and the deviation is documented in spec.md and flagged in PR #30. per FR-015 / SC-001 / SC-009 (contradicts)
