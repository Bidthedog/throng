# Implementation Plan: Tab strip overflow, name limits, and bounded configuration

**Branch**: `feature/S031-I225-I226-I227-tab-strip-and-config-bounds` | **Date**: 2026-08-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/031-tab-strip-and-config-bounds/spec.md`

**Issues**: #225 (tab strip overflow) · #226 (tab and panel name limits) · #227 (clamp every bounded config value on read) · PR [#243](https://github.com/Bidthedog/throng/pull/243)

## Summary

Three cross-referencing issues delivered as one feature, in five dependency-ordered slices.

The **defect** is one CSS rule: `.tab-strip` is a fixed-height flex row with `overflow-x: auto`, so a
native horizontal scrollbar takes its height out of the tabs and clips them. That is fixed by making
the strip a non-scrolling row containing a programmatically-scrolled track, with overlay fades that
occupy no layout space and a pinned New Tab button.

On top of that: a **tab-actions group** with live hidden-left / hidden-right / total counts and a
**typeahead picker** built as a general list-and-choose control (which #219 will seed with files); a
**name limit** for tabs and panels counted in grapheme clusters; and per-tab presentation.

Underneath all of it, **one generic bounds guard** driven by `SETTINGS_METADATA`, replacing four
hand-written clamp sites and covering ranges declared on keyed-table columns as well as top-level
leaves. Analyze found that **four** settings parse wider than they declare, not one — three are drift
and resolve to their declaration, while `diagnostics.maxFileSizeKb`'s wider bound is deliberate and
becomes an explicit `hardMax` rather than a comment the guard cannot read.
The three new settings inherit it rather than each hand-rolling a check — which is the whole reason
#227 is in this feature rather than after it.

## Technical Context

**Language/Version**: TypeScript 5.x (strict), ES modules, Node 24 toolchain

**Primary Dependencies**: Electron 43, React 19, `@dnd-kit/core` (existing tab drag), Vitest, Playwright-Electron. **No new runtime dependency** — grapheme counting uses the platform's `Intl.Segmenter` (R4)

**Storage**: JSON config documents under the user profile (`settings.json`, `keybindings.json`, themes) via `FileConfigStore`; per-project layout persisted through the daemon

**Testing**: Vitest projects `unit` / `integration` / `contract`; Playwright-Electron for E2E, run locally as two tiers and on CI as three planned shards

**Target Platform**: Windows 11 (the 1.0 platform); no OS-specific code added by this feature

**Project Type**: Desktop application — npm workspaces monorepo (`@throng/core` pure logic, `@throng/ui` Electron main + renderer, `@throng/daemon`)

**Performance Goals**: Strip geometry recomputed on scroll/resize without dropping a frame at 30+ tabs; the rename cap runs per keystroke, so the grapheme segmenter is constructed once at module scope, never per call

**Constraints**: Scroll position is view state and must never enter the persisted layout (FR-006). The renderer never touches the filesystem. Corrections must never cost a user a setting they just saved (FR-013c)

**Scale/Scope**: 112 functional requirements, 5 stories, ~30 tabs as the design point for the strip

## Constitution Check

*GATE: passed before Phase 0, re-checked after Phase 1 design. Constitution v4.4.0.*

| Principle | Verdict | Basis |
|---|---|---|
| **I. Project-first isolation** | PASS | The picker lists the active window's own strip only; nothing crosses a project boundary |
| **II. Platform-abstracted core** | PASS | No OS calls added. The guard, the counting and the match predicate are pure and live in `@throng/core` |
| **III. Detached terminals** | PASS (untouched) | No terminal lifecycle change. A panel's *displayed name* is shortened; the shell's own title string is not |
| **IV. Native terminal support / the keyboard** | **PASS, stated** | `Ctrl+Alt+T` is in neither the reserved tier (`Ctrl+C/D/Z/A/E/W/U/K/R/L/Q`) nor the shadowable tier (the emacs aliases and `Ctrl+S`). It displaces no line-editor binding in any hosted flavour, so **no recorded exception is added and the enumerated list at v4.4.0 is unchanged**. Spec FR-032c carries the same statement |
| **V. Test-first quality** | PASS | Every slice is Red→Green→Refactor. Every user-visible behaviour ships E2E coverage (FR-048); new specs are registered in `shard-plan.json`, and picker/preferences specs in `parallel-plan.json`'s serial tier |
| **VI. Simple, modern, discoverable UX** | PASS | *Every panel action has a menu item*: Destroy Tab keeps its context-menu item and gains a second route (FR-044), it does not replace it. The step controls are **navigational input**, which the principle explicitly exempts. The picker's chord is an accelerator over the show-all control, never a substitute (FR-032d) |
| **VII. Change review** | PASS | Draft PR #243; adversarial review before it leaves draft |
| **VIII. SOLID / DRY / YAGNI** | **PASS — improves it** | The guard *removes* duplication: four hand-written clamp sites go, and three ranges that had drifted from their declaration are reconciled (FR-015, FR-016). One picker serves this feature and #219 rather than two |
| **IX. DI / composition root** | PASS | The guard is a pure function taking the registry and defaults as arguments; nothing new is constructed inside a component |
| **X. Externalised configuration** | PASS | Three new settings, each with a shipped default and a descriptor; none reachable only by hand-editing (FR-047) |
| **XI. Dockable workspace** | PASS | Scroll position is view state and is not persisted (FR-006). *One document, one state* is unaffected — truncation shortens a display name, and the same limit applies in every window showing it |
| **Configuration-editor completeness** (governance) | PASS | All three settings get descriptors; `settings-metadata.test.ts` enforces it |
| **Themeable icon controls** (governance) | PASS | Three new theme icon tokens with hover titles naming the action (FR-032). Descriptors are derived automatically (R9) |
| **Static analysis & linting** (governance) | PASS | Lint and typecheck are gates on every commit here |
| **Documentation currency** (governance) | PASS | `docs/quick-start.md` gains the Tabs settings; README checked for the finite-state claim |

**No violations. Complexity Tracking is empty.**

## Project Structure

### Documentation (this feature)

```text
specs/031-tab-strip-and-config-bounds/
├── spec.md                 # 112 FRs, 18 SCs, 15 clarifications
├── checklists/
│   └── requirements.md     # 16/16
├── plan.md                 # this file
├── research.md             # Phase 0 — R1..R10
├── data-model.md           # Phase 1
├── contracts/
│   ├── bounds-guard.md     # the generic clamp
│   ├── name-limit.md       # grapheme counting + truncation
│   └── tab-strip.md        # strip geometry, scrolling, picker
├── quickstart.md           # Phase 1 — how to prove it works
└── tasks.md                # /speckit-tasks output — NOT created here
```

### Source code

```text
packages/core/src/
├── config/
│   ├── bounds-guard.ts          # NEW — applyDeclaredBounds(), the one generic guard (FR-008..FR-010)
│   ├── app-settings.ts          # 3 new leaves; hand-written clamps REMOVED (FR-015, FR-016)
│   ├── settings-metadata.ts     # 3 new descriptors + the "Tabs" group
│   ├── metadata.ts              # gains optional hardMin/hardMax (FR-015b)
│   ├── keybindings.ts           # tabs.openPicker + Ctrl+Alt+T
│   ├── keybindings-metadata.ts  # its descriptor
│   └── theme.ts                 # chevronLeft / chevronRight / chevronDown icon tokens
├── text/
│   └── grapheme.ts              # NEW — countGraphemes(), truncateGraphemes() (FR-033a..c)
├── workspace/
│   ├── panel-title.ts           # the limit applies to panelDisplayTitle()'s result (R8)
│   └── tab-strip.ts             # NEW — pure geometry: hidden counts, step target, ease (FR-021..FR-030)
└── picker/
    └── match.ts                 # NEW — order-independent AND-of-substrings (FR-028c)

packages/ui/src/
├── main/
│   └── config-store.ts          # write-back when the guard corrected something (FR-013)
└── renderer/
    ├── common/
    │   └── picker.tsx           # NEW — the general list-and-choose control (FR-028a); #219 reuses this
    ├── workspace/
    │   ├── tab-group.tsx        # strip restructure, tab actions, close affordance, counter
    │   ├── tab-scroll.ts        # NEW — the single rAF loop and its supersede rule (FR-030c..f)
    │   └── tab-picker.tsx       # NEW — the picker seeded with tabs
    └── theme.css                # .tab-strip restructure; fades as overlays

packages/ui/tests/
├── unit/ · integration/ · e2e/  # per R10
└── e2e/shard-plan.json, parallel-plan.json   # every new spec registered
```

**Structure Decision**: The existing monorepo split is kept and leaned on. Everything decidable
without a DOM — the guard, grapheme counting, the match predicate, the strip's geometry and easing
maths — goes in `@throng/core` as pure functions so it is unit-testable at speed; the renderer holds
only what genuinely needs the DOM (measuring tab rects, driving `scrollLeft`, rendering). This is
what keeps the E2E layer for behaviour rather than for arithmetic.

## Delivery order

The stories are dependency-ordered and each is independently shippable, so implementation follows
them:

1. **US1** — strip restructure. No new settings; the defect fix lands alone.
2. **US2** — the bounds guard. No UI; unblocks every new setting below.
3. **US3** — tab actions, the picker, the chord, the scroll settings.
4. **US4** — the name limit and the rename counter.
5. **US5** — pill, hover title, close affordance and its arming delay.

## Complexity Tracking

> No Constitution Check violations. Nothing to justify.
