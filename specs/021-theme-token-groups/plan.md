# Implementation Plan: Theme token grouping, naming conventions & consolidation

**Branch**: `feature/S021-I84-theme-token-groups` | **Date**: 2026-07-19 | **Spec**: [spec.md](./spec.md)

**Input**: Rewritten `spec.md` (US1–US11). US1–US4 (area grouping + section search) already shipped; this plan covers the fold-in refactor (US5–US11) and the migration that replaces the old byte-identical contract.

## Summary

Six workstreams, mostly in `@throng/core` (the token registry + theme model) with matching renderer/main-process edits and tests at the layer that owns each change:

1. **Naming/description convention (US5).** A single fixed `<Property>` vocabulary; every token's `{label, description}` in `theme-copy.ts` rewritten to `<Context> <Property>` self-describing labels + element-naming descriptions. Enforced by extending `theme-copy.test.ts` with a convention guard (label shape + non-self-referential description).

2. **Surface consolidation (US6).** Remove `menuSurface` and `dialogSurface` from the theme model (`theme.ts`), repoint their CSS consumers: menu cards → `--throng-colour-surfaceActive`, dialog/modal/notice cards → `--throng-colour-surface`. Repoint the File Explorer pane (`.pane--explorer`) from `surface` → the sidebar token (relabelled **Side Panel Background**). Repoint every `.ctl` field + theme dropdown from `--bg` → `--throng-colour-inputSurface` (Field Surface).

3. **Three-type button model (US7).** Replace the 4 legacy button tokens with **18** (`{confirm,cancel,destroy}Button{Bg,HoverBg,Border,HoverBorder,Text,HoverText}`) in `theme.ts`; add a `Buttons` sub-area (`General · Buttons · Confirm|Cancel|Destroy`) in `theme-metadata.ts`; rewrite the button CSS (`theme.css` `--btn-*`, `confirm-dialog` classes, and every raw `<button>` in dialogs/forms) to consume only its type's tokens; stop borrowing `accent`/`danger`/`border`/`accentText`.

4. **Migration (FR-031/032).** A pure `migrateTheme(raw)` in core applies the old→new key map (drop `menuSurface`/`dialogSurface`/legacy `button*`; seed the 18 button tokens per the derivation rules in data-model §4) on **load** of any user theme, and the 15 bundled themes in `theme.ts`/defaults are updated at source through the same derivation so bundled and migrated user themes agree.

5. **Windows (US9).** One shared `windowTitle(middle)` helper → `` `${middle} — throng` ``, routed through every OS `setTitle` and the in-app titlebar identity. Add `showMinimise` prop to `WindowControls`→`TitleBar`; Preferences passes `false` and its `BrowserWindow` gets `minimizable:false`.

6. **Bugs (US10/US11).** (A) Suppress hover visuals when the main window is blurred / a child window or menu is open — a `body[data-window-blurred]` (or focus-driven) gate on hover backgrounds, cleared on real pointer movement. (B) Extract the context-menu viewport flip+clamp (`context-menu.tsx:313-324`) into a shared `clampToViewport(anchor, size)` helper and have `colour-picker.tsx` use it.

7. **Standing usage guard (US8).** Extend the completeness/quality suite so every token resolves to ≥1 live consumer (a referenced CSS var or a listed TS consumer) AND ≥1 assertion test; failing either fails the build, naming the token.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 24, React 18, Electron 40+
**Primary Dependencies**: React, Vitest (unit/integration/contract), Playwright-Electron (E2E), ESLint
**Storage**: Human-editable JSON theme files in `%USERPROFILE%\.throng\` — **now migrated on load** (FR-031); bundled themes updated at source (FR-032).
**Testing**: Vitest `unit` (pure core: convention guard, migration, area map, button-type map, usage guard), `contract`, `integration` (theme load→migrate→apply); Playwright-Electron E2E for window titles, Preferences minimise, hover suppression, colour-picker on-screen, field surface, button rendering.
**Target Platform**: Windows-first Electron desktop.
**Project Type**: Desktop app — Electron main + preload + React renderer + core packages.
**Performance Goals**: None new. Migration runs once per theme load; grouping/metadata are module constants.

**Constraints**:
- **Byte-identical is withdrawn** (FR-011 revised, FR-012 removed). The replacement guarantee is **lossless migration** (SC-004'): every still-existing token keeps its value; new tokens are seeded deterministically.
- Migration must be **idempotent** — migrating an already-migrated theme is a no-op.
- The completeness guards (`assertEveryKeyDescribed`, `assertThemeAreaGroups`, new convention + usage guards) must all stay green.
- `accent` is overwritten at runtime by the active project colour — button tokens must be **explicit** so button appearance no longer tracks the project colour (a token previously following `accent`, e.g. the old confirm hover, gets a real `confirmButtonHoverBg`).

**Scale/Scope**: Token count moves from ~57 colours to ~57 − 2 (removed surfaces) − 4 (legacy buttons) + 18 (button model) ≈ **69 colour tokens**. 15 bundled themes updated. Production files: `packages/core/src/config/{theme.ts, theme-copy.ts, theme-metadata.ts, theme-ops.ts (migrate), theme-reset.ts}`, `packages/ui/src/renderer/**/*.css` (surface/button/field repoints), `packages/ui/src/renderer/**` (title helper, window-controls prop, hover gate, colour-picker positioner, context-menu helper extraction), `packages/ui/src/main/{main.ts, preferences-window.ts}`. Tests across unit/integration/contract/e2e.

## Constitution Check

*GATE: re-checked after design.* Constitution **v4.0.0**.

| Principle | Assessment |
|---|---|
| **VI. Simple, Modern, Discoverable UX** | PASS, directly served. Self-describing names, one-place-per-thing grouping, buttons grouped by type, fields consistently themed, two real UX bugs fixed, consistent window titles. |
| **VIII. SOLID / DRY / YAGNI** | PASS. One naming vocabulary, one migration function, one `windowTitle` helper, one shared viewport-clamp helper (colour picker reuses the context menu's — no second positioner). Buttons get one token set per type instead of five borrowed tokens. Surfaces consolidated (menu→active, dialog→panel) — fewer concepts. |
| **X. Externalised Configuration / editor completeness** | PASS, strengthened. Every token (incl. 18 buttons) editable and grouped; new guards enforce one-consumer + one-test + naming convention. Removed tokens leave the model cleanly (migration), not as dead keys. |
| **XI. One document, one state** | PASS. Theme values are the only persisted state; grouping/labels/migration are model/view logic. |
| **Test-First (NON-NEGOTIABLE)** | PASS. Each workstream lands Red-first at its owning layer (pure guards/migration in unit; window/hover/picker/field/button behaviour in E2E). |
| **Documentation currency (v4.0.0)** | Minor — README/`docs/` mention of theme keys/Themes editor reconciled by a task (T051), not a waiver. (Rule introduced v3.10.0, amended v4.0.0 — no ROADMAP obligation.) |

**Verdict: PASS.** No Complexity Tracking entries. Withdrawing byte-identical is a spec-level decision recorded in the 2026-07-19 clarifications, not a constitution violation.

## Project Structure

```text
specs/021-theme-token-groups/
├── plan.md              # This file (superset)
├── spec.md              # US1–US11 + 2 clarification sessions
├── research.md          # decisions (updated: migration strategy, hover mechanism, button derivation)
├── data-model.md        # area model + naming vocabulary + token change table + button model + migration map
├── contracts/
│   ├── theme-area-groups.md   # (existing) area group contract
│   ├── section-search.md      # (existing) section-search contract
│   ├── naming-convention.md   # NEW — label/description convention + guard
│   ├── surface-tokens.md      # NEW — post-consolidation surface set + repoint map
│   ├── button-model.md        # NEW — 18-token 3-type contract + classification + icon-button exclusion
│   ├── theme-migration.md     # NEW — migrateTheme(): old→new map, derivations, idempotence
│   └── window-chrome.md       # NEW — windowTitle() suffix + Preferences minimise removal
├── quickstart.md        # validation guide (updated)
└── tasks.md             # /speckit-tasks output
```

### Source Code

```text
packages/core/src/config/
  theme.ts            # remove menuSurface/dialogSurface + legacy button*; add 18 button tokens;
                      #   update TOKEN_PARENT / OPTIONAL sets; update all 15 bundled themes (button derivations)
  theme-copy.ts       # rewrite every {label,description} to the convention (fixed vocabulary)
  theme-metadata.ts   # naming vocabulary + convention; General · Buttons · <Type> sub-groups;
                      #   areaForToken updated for new/removed tokens
  theme-ops.ts        # migrateTheme(raw): drop removed keys, seed 18 button tokens, idempotent
  theme-reset.ts      # reset/restore paths honour the new token set
packages/ui/src/renderer/
  theme/tokens.css, theme.css, preferences.css, panes.css, explorer.css, editor.css, find-bar.css, terminal.css, panel-type.css
                      # surface repoints (menu→active, dialog→panel, explorer→sidebar); field surface on all .ctl;
                      #   button CSS rewrite to 3 types × 6; hover-gate rule
  title-bar/{title-bar.tsx, window-controls.tsx}   # showMinimise prop
  common/colour-picker.tsx                          # use shared clampToViewport
  workspace/context-menu.tsx                        # extract clampToViewport helper (shared)
  common/window-title.ts (NEW)                      # windowTitle(middle) => `${middle} — throng`
  app.tsx, subworkspace-app.tsx, preferences-app.tsx # route titles through windowTitle; prefs showMinimise=false
packages/ui/src/main/
  main.ts, preferences-window.ts                     # suffix titles; prefs minimizable:false
```

## Phase Ordering (TDD, smallest-independent first)

1. **Naming convention guard + copy rewrite (US5)** — Red: convention guard over `theme-copy`; Green: rewrite copy + vocabulary. Pure unit; sets the vocabulary the rest uses. *(A1: the 18 button tokens do not exist until Phase 2/T029, so their copy and naming-guard coverage complete in Phase 2/T032 — the guard passes on the pre-button registry after Phase 1 and again, over the full set incl. buttons, after T033.)*
2. **Migration (FR-031/032) + token model changes (US6/US7 model half)** — Red: `migrateTheme` unit tests (drop removed keys, seed buttons, idempotent, lossless) and `theme.ts` token-set tests; Green: edit `theme.ts` (remove 2 surfaces + 4 buttons, add 18), write `migrateTheme`, update 15 bundled themes via derivation, wire migration into theme load (`theme-ops`/`theme-reset`).
3. **Area map + Buttons sub-group + usage guard (US8)** — Red: `theme-metadata` tests (button tokens → `General · Buttons · <Type>`; removed tokens gone); usage guard test (every token has a consumer + a test); Green: implement.
4. **CSS repoints (US6/US7 render half)** — surface merges, field surface, button CSS. Proven by E2E (fields use inputSurface; menu=active; dialog=panel; explorer=sidebar; each button type uses only its tokens; icon buttons don't).
5. **Windows (US9)** — Red E2E: titles end ` — throng`; Preferences has no minimise + non-minimizable. Green: `windowTitle` helper, prop threading, main-process edits.
6. **Bug A — stranded hover (US10)** — systematic-debugging to pin the mechanism; Red E2E (open Themes from cog → root not hovered while prefs open); Green: focus/overlay hover gate.
7. **Bug B — colour picker clamp (US11)** — Red E2E (picker near edge stays on-screen); Green: extract `clampToViewport`, reuse in colour picker.
8. **Docs** — reconcile README/docs describing theme keys / Themes editor.

Migration + token model (phase 2) is the linchpin: everything downstream references the final token set.
