# Implementation Plan: Theme Content

**Branch**: `009-theme-content` | **Date**: 2026-07-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-theme-content/spec.md`

## Summary

Data-and-metadata-only feature. Recolour the **Bash** theme to a multi-hue Git Bash palette (so it is no longer a Matrix twin); replace the **SUBNET** and **Cyberpunk** placeholder palettes with their real reference colours; give **every** theme token a hand-written, abbreviation-free label + description that names the surfaces it paints; add two new themeable **editor gutter** colour tokens (background + foreground) supplied by every bundled theme and exposed automatically in the theme editor; and add automated **theme-quality guards** — pairwise perceptual distinctness (CIEDE2000, minimum token-pair distance, hard failure across all bundled themes) and WCAG 2.1 AA contrast over an enumerated pairing list (hard failure for Bash/SUBNET/Cyberpunk, reported-only for the rest).

Technical approach: all logic lives in the platform-agnostic `@throng/core` as pure functions (no OS/DOM), consistent with the existing theme modules. A new pure `theme-quality.ts` module implements hex→sRGB→Lab conversion, CIEDE2000, WCAG relative-luminance/contrast-ratio, the enumerated contrast pairings, the distinctness/contrast assertions, and the single authoritative threshold + standard constants. A new hand-written copy catalogue keys label/description off each token path; `descriptorForThemeToken` consults it. The editor gutter gains `editorGutterBg`/`editorGutterFg` colour tokens on `THRONG_THEME.colours`, which flow automatically into the derived `THEME_METADATA`, the per-theme completeness test, the CSS-variable map, and the theme editor (no editor-renderer change). `editor.css` repoints the gutter rules at the new variables.

## Technical Context

**Language/Version**: TypeScript 5.9 (ESM, `type: module`), Node ≥ 20

**Primary Dependencies**: none new. Pure TS in `@throng/core`; renderer consumes CSS custom properties. Vitest for unit, Playwright for E2E (existing).

**Storage**: Themes are per-user JSON files under the throng config directory (existing). No schema/migration change — missing tokens already fall back to `THRONG_THEME`.

**Testing**: Vitest (`unit`, `integration`, `contract` projects) + Playwright (`e2e`). New unit tests for theme-quality, copy catalogue, and gutter tokens; new/updated E2E for gutter theming.

**Target Platform**: Electron desktop (Windows first); core is OS-agnostic.

**Project Type**: Desktop application, monorepo (`packages/core`, `packages/ui`, `packages/daemon`).

**Performance Goals**: N/A — assertions run at test time over ~15 themes × ~28 tokens; trivially fast.

**Constraints**: No new UI surface. No changes to files owned by sibling features (preferences renderer, icon-pack service, main process, config store). Pure core (no OS/DOM imports — enforced by `no-os-imports.test.ts`).

**Scale/Scope**: 15 bundled themes (incl. `throng`); ~28 colour tokens, ~22 icon tokens, ~25 font/typography tokens per theme; 3 themes recoloured; 2 new tokens; ~75 hand-written descriptor entries.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.* Evaluated against constitution **v3.12.0**.

- **I. Project-First Context Isolation** — N/A (no project/terminal behaviour). PASS.
- **II. Platform-Abstracted Core** — All new logic is pure TS in `@throng/core` with no OS/DOM calls; enforced by `no-os-imports.test.ts`. PASS.
- **III. Detached/Tagged Terminals** — N/A. PASS.
- **IV. Native Terminal Support** — N/A. PASS.
- **V. Test-First Quality Discipline** — TDD: distinctness + contrast assertions written first and observed failing against today's Bash before recolour; copy assertion written first; gutter-only-repaint covered by E2E (a user-facing theming change → E2E required). PASS by construction.
- **VI. Simple, Modern, Discoverable UX** — Gutter tokens are discoverable in the theme editor generically; no new flow. PASS.
- **VII. Change Review** — N/A. PASS.
- **VIII. SOLID/DRY/YAGNI** — One authoritative constants location; one copy catalogue; colour maths in one module; no speculative generality. PASS.
- **IX. Dependency Injection / Composition Root** — Pure functions, no new services or containers. PASS.
- **X. Externalised Configuration** — Themes remain externalised config files; threshold/standard are named constants in one place, not scattered magic numbers. PASS.
- **XI. Dockable Workspace** — N/A. PASS.
- **Configuration-editor completeness (NON-NEGOTIABLE)** — The two new gutter tokens are added to the theme structure, so they are (a) covered by the derived `THEME_METADATA`, (b) asserted by the existing editor-metadata completeness test, and (c) rendered by the theme editor generically. Hand-written descriptors are supplied. **No editor code change.** PASS.
- **Action controls are themeable icons** — No new action controls. PASS.
- **Documentation currency (NON-NEGOTIABLE)** — Gutter appearance change + recoloured themes are user-facing → `README.md`/`ROADMAP.md` reconciled in the same change. PLANNED.

**Result: PASS. No violations; Complexity Tracking empty.**

## Project Structure

### Documentation (this feature)

```text
specs/009-theme-content/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (theme-quality contract)
├── checklists/
│   └── requirements.md  # Spec quality checklist (16/16)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/src/config/
├── theme.ts                     # + editorGutterBg / editorGutterFg tokens (+CSS var already generic)
├── theme-metadata.ts            # descriptorForThemeToken consults the copy catalogue
├── theme-copy.ts                # NEW — hand-written label/description per token path
├── theme-quality.ts             # NEW — CIEDE2000, WCAG contrast, pairings, constants, assertions
└── default-themes/
    └── index.ts                 # Bash/SUBNET/Cyberpunk recolour; makeTheme supplies gutter defaults

packages/core/src/index.ts       # export new theme-quality + copy surfaces

packages/core/tests/unit/
├── theme-quality.test.ts        # NEW — distinctness + contrast maths & assertions (fail-first vs old Bash)
├── theme-copy.test.ts           # NEW — no abbreviation, not machine-generated, every token covered
├── default-themes.test.ts       # extend — gutter tokens present; Bash≠Matrix; brand palettes
└── theme-metadata.test.ts       # extend — gutter descriptors exposed, hand-written

packages/ui/src/renderer/editor/editor.css   # gutter rules → var(--throng-colour-editorGutter*)

packages/ui/tests/e2e/
└── editor-gutter.e2e.ts         # NEW — gutter tokens apply; changing gutter affects only the gutter
```

**Structure Decision**: Extends the existing `packages/core/src/config` theme module family and the `packages/ui/src/renderer/editor` stylesheet — exactly the files this feature owns. No new package, no new UI surface.

## Complexity Tracking

*No constitution violations. Section intentionally empty.*
