# Implementation Plan: Theme contrast gate

**Branch**: `feature/S078-I61-theme-contrast-gate` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/078-theme-contrast-gate/spec.md`

## Summary

Widen the existing build-time contrast gate from three named themes to every bundled theme, with no exemption list
(round 2, spec Clarifications); add accent text on accent as a measured pairing and retune `accentText` in the three themes that miss
it, carrying the new values to existing installs through the guarded value upgrade; and show a derived "Meets WCAG AA
contrast" mark in the Themes tab — a themeable icon beside the picker for the selected theme (round 3 dropped the
per-option text label). All three halves read one measurement, `contrastFailures()` in `theme-quality.ts`.

## Technical Context

**Language/Version**: TypeScript 6 (strict), React 19, Electron
**Primary Dependencies**: `@throng/core` (theme model, theme-quality, shipped defaults, icon keys), `@throng/ui`
renderer (Preferences window)
**Storage**: theme JSON files under the config root; shipped-defaults version marker (38 → 39)
**Testing**: vitest `unit` (core) and `component` (renderer, jsdom); no E2E — nothing here needs a real window
**Target Platform**: Windows, Linux, macOS (no per-OS code)
**Project Type**: desktop app, npm-workspaces monorepo
**Performance Goals**: measuring every listed theme on opening the Themes tab is imperceptible (15 themes × ~100
pairings of pure arithmetic)
**Constraints**: v1.0.0 feature freeze — scope exactly as the spec, approved by the maintainer 2026-11-24
**Scale/Scope**: 15 bundled themes plus user themes; one new icon key; one new pairing; three colour values

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / gate | Verdict |
|---|---|
| V Test-first | ✅ Each FR gets a failing unit or component test before its code (tasks). |
| VI Simple, discoverable UX | ✅ Positive mark only (FR-010); hover title explains it. |
| VIII SOLID/DRY/YAGNI | ✅ One measurement function feeds the gate and the icon (FR-007); the gated set is derived, not listed (FR-003). |
| X Externalised configuration — *Every theme setting belongs to its theme* | ✅ The retuned `accentText` values reach existing theme files through the guarded value upgrade (version 39), moving a value only where the file still holds what 38 wrote (research R2). |
| Configuration-editor completeness | ✅ No new setting or theme token; `accentText` is already editable. The new icon key appears in the Icons area like every other key (icon-keys registry). |
| Themeable icon controls | ✅ The mark is a named icon key from the active icon set, coloured from a theme token, with a hover title (FR-009, FR-013). It is a status indicator rather than an action, so the rule is applied by analogy. |
| Documentation currency | ✅ `docs/preferences.md` themes section updated in the same change (FR-014). |
| Incremental delivery | ✅ Closes 009's tracked deferral (FR-018's "known issues"); nothing new deferred. |
| Supersession | ✅ 009 FR-017/FR-018 superseded, stated in the spec. |

No violations; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/078-theme-contrast-gate/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── theme-quality-api.md
│   └── themes-tab-mark.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/src/config/
├── theme-quality.ts          # gate scope, accent pairing, meetsWcagAa()
├── default-themes/index.ts   # accentText for VSCode, English Garden, Debian
└── shipped-defaults.ts       # version 39, V38_MOVED_COLOURS, upgrade wiring
packages/core/src/icons/
├── icon-keys.ts              # new key wcagConformant + description
├── default-set/wcagConformant.svg, SOURCES.json
└── default-icon-set.generated.ts, icon-sets-README.txt   # regenerated
packages/core/src/index.ts    # exports
packages/core/tests/unit/
├── theme-quality.test.ts, default-themes.test.ts, shipped-defaults*.test.ts
packages/ui/src/renderer/preferences/
├── themes-tab.tsx            # mark beside the picker
└── preferences.css           # mark styling from theme tokens
packages/ui/tests/component/
└── preferences-themes-tab.test.ts (or a new themes-tab-wcag-mark.test.ts)
docs/preferences.md
```

**Structure Decision**: existing monorepo layout; the measurement stays in `@throng/core` and the renderer only calls it.

## Complexity Tracking

None.
