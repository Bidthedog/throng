# Implementation Plan: Defect Sweep — Icon Packs, Header Tooltips & a Flaky Pane Test

**Branch**: `017-icon-tooltip-flake-fixes` | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-icon-tooltip-flake-fixes/spec.md`

## Summary

Three self-contained defects, no new theme tokens, no change to the fourteen bundled theme files.

**#54 (icon packs)** is the substantial one. The correct, pack-aware resolver (`resolveIconValue`)
already exists and is unit-tested — but nothing in the app calls it, and its `IconValue` result cannot
be rendered by any existing component. The fix is therefore not "write a resolver" but "give the
renderer the packs, and give it a component that can render an image": add `iconPacks` to the
hot-reloaded config payload, introduce a single shared `<Icon>` component that renders a glyph as text
or a pack SVG **inlined** (so `currentColor` binds to the theme), migrate every call site onto it, and **delete** `resolveIcon` so the pack-blind path cannot come back. Because inlining puts
user-supplied markup into the DOM, the SVG is **sanitised once in the main process** at load time.

**#57 (tooltips)** replaces the interaction-instruction `title` on panel headers and tab chips with the
title being hovered.

**#66 (flaky pane test)** is fixed at the level of its defect *class*: three new harness helpers — a
positive `settle()`, an auto-waiting `geom()`, and a `viewport()` (without which the pane tests, which
measure a control against the **window edge**, would have no legal way to express themselves) — replace
the unguarded raw geometry reads and vacuous negative-assertion settles across the E2E suite, and `failOnFlakyTests: true` in `playwright.config.ts`
makes a retried pass fail the run so this cannot hide again. The gate goes in the **config**, not the
npm script, because `test:e2e:admin` and any bare `npx playwright test` bypass the script entirely.

## Technical Context

**Language/Version**: TypeScript 5.x (strict), Node 24, React 19

**Primary Dependencies**: Electron, React, Playwright (1.61.1), Vitest, ESLint (typescript-eslint)

**Storage**: SQLite (projects); human-editable JSON in `%USERPROFILE%\.throng\` (settings, keybindings,
themes); icon packs as directories under `.throng/icon-packs/<pack>/pack.json` + asset files

**Testing**: Vitest projects `unit` / `integration` / `contract` (all `environment: 'node'`);
Playwright-Electron for E2E. **There is no jsdom/component-test layer** — see research §5. All
UI-visible behaviour is asserted in E2E or via pure functions + source-text guards.

**Target Platform**: Windows first (Electron desktop); macOS/Linux must not be foreclosed

**Project Type**: Desktop application (Electron main + preload + React renderer, plus a detached daemon)

**Performance Goals**: Stated structurally, because that is what is provable. **Zero disk reads on the
render path** (FR-006a): every pack asset is resolved once in main, and `assetBase` never reaches the
renderer. The icon component renders **synchronously** — no `fetch`, no `file://`, no load-on-mount
effect (FR-006b). The file explorer resolves an icon **per row**, so a component that *cannot reach the
disk* is what guarantees a large tree cannot be slowed by it, and cannot pop in after its rows.

**Constraints**: Pack SVG markup originates from a user-writable directory and is injected into the
DOM — it MUST be sanitised before it crosses IPC. Icons must be **decorative** to assistive technology
(FR-006c). No new theme tokens (keeps this feature off the fourteen bundled theme files).

**Scale/Scope**: 43 icon tokens; `resolveIcon` call sites across **8 renderer modules** (the exact
invocation count is deliberately not quoted — the directory-wide source guard, not a hand-counted
list, is the contract); 2 bundled packs; 120 E2E specs (106 `waitForTimeout`, 205 `.evaluate(`
occurrences to triage); **10 tests failing on their first attempt at baseline**.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| **II. Platform-Abstracted Core** | PASS. Pack discovery and file reads stay in the main process (`icon-pack-service`); `@throng/core` gains only pure functions (resolution, sanitisation). No OS calls added to core. |
| **V. Test-First Quality Discipline** | PASS, and central to this feature. Every change is Red-Green-Refactor. Every user-facing change ships E2E (the constitution requires it; here it is also the *only* layer that can see the DOM). The flake rules (v3.14.0) are the subject of User Story 3 — and FR-014 makes them enforceable rather than aspirational. |
| **VI. Simple, Modern, Discoverable UX** | PASS. #57 restores the tooltip's purpose; the interactions stay discoverable via the context menu. |
| **VIII. SOLID / DRY / YAGNI** | PASS. DRY is the *point*: two rival resolvers collapse to one, and every bespoke icon render collapses to one `<Icon>`. YAGNI: no icon-colour token (that is #55), no new notification surface (that is #48). |
| **IX. DI & Composition Root** | PASS. The pack service is constructed in main's existing composition root and injected; the renderer receives packs through the existing `ConfigProvider` context rather than importing a singleton. |
| **X. Externalised Configuration** | PASS. Icon packs *are* externalised configuration; this feature is what makes that configuration actually take effect. |
| **Themeable icon controls (v3.12.0)** | PASS — and strengthened. The rule forbids a component hardcoding an inline SVG literal, bypassing the theme. We do the opposite: markup comes *from* the theming system and takes its colour *from* a theme token. The existing guard test (`preferences-icons.test.ts`), which forbids `<svg>` literals in component source, is **kept and must keep passing**. See research §1. |
| **Themeable icon controls — reconciled against FR-009 (US2)** | PASS, stated explicitly because the rule names this surface verbatim. The rule requires every **action control** — "toolbar buttons, row affordances, dismiss and clear controls, **panel and tab chrome**" — to carry "a hover title that names the action". FR-009 removes the instruction `title` from `.panel-box__header` and `.tab-chip`. This is **not** a violation: those elements are **title-bearing surfaces, not icon action controls**. The action controls *within* them (panel add/close, the unsaved dot, the panel-type marker) keep their action-naming titles untouched — FR-010 requires it. The displaced interactions remain discoverable via the right-click menu (Principle VI). Recorded here so a reviewer meets the reasoning rather than the apparent conflict. |
| **Configuration-editor completeness (v3.11.0)** | PASS. No new configurable key is introduced. `theme.iconPack` already has its descriptor and editor. |
| **Documentation currency (v3.10.0)** | ACTION REQUIRED. Icon packs go from decorative-only to actually working — a user-facing capability change. README and ROADMAP must be updated in this change (task included). |
| **Static analysis & linting (v3.13.0)** | PASS. Lint + typecheck must be zero-error; both green at baseline. |

**No violations requiring justification.** One item (Documentation currency) is an obligation, not a
violation, and is discharged by a task.

## Project Structure

### Documentation (this feature)

```text
specs/017-icon-tooltip-flake-fixes/
├── plan.md              # This file
├── spec.md              # Clarified specification
├── research.md          # Phase 0 — decisions and rejected alternatives
├── data-model.md        # Phase 1 — icon value/asset types and the resolution chain
├── quickstart.md        # Phase 1 — how to validate the feature by hand
├── contracts/
│   ├── icon-assets.md   # core ↔ main ↔ renderer icon contract
│   └── e2e-harness.md   # settle()/geom() harness contract + the flake gate
├── checklists/
│   └── requirements.md  # Spec quality checklist (16/16)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/core/src/config/
├── theme.ts                    # DELETE resolveIcon(); keep IconValue, Theme, THRONG_THEME
├── icon-pack.ts                # resolveIconValue() stays — the single authoritative resolver
└── svg-sanitise.ts             # NEW — pure allowlist sanitiser (unit-tested)

packages/ui/src/main/
├── icon-pack-service.ts        # load pack assets ONCE into memory; sanitise SVG; report load errors
├── config-watcher.ts           # ConfigPayload gains `iconPacks`
└── config-write-ipc.ts         # listIconPacks returns the loaded assets

packages/ui/src/renderer/
├── config/config-store.tsx     # ConfigProvider carries packs; new useIconPacks()
├── common/icon.tsx             # NEW — the single <Icon> component (glyph | inline svg | img)
├── common/icon-button.tsx      # renders <Icon>, no longer resolveIcon
├── explorer/toolbar.tsx        # ─┐
├── explorer/tree-node.tsx      #  │
├── search/find-bar.tsx         #  ├─ every resolveIcon call site migrates to <Icon>
├── terminal/terminal-panel.tsx #  │
├── workspace/context-menu.tsx  #  │
├── common/folder-picker.tsx    #  │   (8 modules, 14 invocations — the guard, not this
├── workspace/panel-placeholder.tsx  # ─┘   list, is the contract) …and the panel header title (#57)
├── workspace/tab-group.tsx     # tooltip ONLY (#57) — contains no resolveIcon call
└── preferences/icon-section.tsx     # uses the shared <Icon>; shows unavailable packs (FR-004a)

packages/core/tests/unit/
├── icon-pack.test.ts           # existing — extended for asset resolution
└── svg-sanitise.test.ts        # NEW

packages/ui/tests/unit/
└── icon-call-sites.test.ts     # NEW source-guard: no renderer file may bypass <Icon>

packages/ui/tests/e2e/
├── harness.ts                  # MODIFIED (file exists) — add settle(win), geom(locator), viewport(win)
├── panes.e2e.ts                # the #66 flake — rewritten onto the helpers
├── icon-packs.e2e.ts           # extended: packs affect the APP, not just the grid
├── panel-tooltips.e2e.ts       # NEW (#57)
└── (audit sweep across the suite — FR-013a)

playwright.config.ts            # failOnFlakyTests: true + @quarantine grepInvert (FR-014, FR-013b)
                                #   — in the CONFIG, not the npm script: test:e2e:admin and any bare
                                #     `npx playwright test` bypass the script entirely (FR-014a)
.github/workflows/ci.yml        # retry comments + the de-elevation retry dependency
docs/testing.md                 # §Flaky-under-load retries teaches the policy FR-014 abolishes
CONTRIBUTING.md                 # the testing bar changed
README.md / ROADMAP.md          # icon packs now actually work
specs/017-…/e2e-audit.md        # NEW — what was NOT fixed, and why (FR-013a)
```

**Structure Decision**: No new packages or layers. The feature deliberately reuses the existing
core/main/renderer split: pure logic in `@throng/core`, all disk and OS work in `main`, and a single
React context feeding the renderer. The one new *component* (`<Icon>`) exists precisely so that
every call site stops solving this for itself.

## Phase Ordering

Implementation order **inverts** user-value priority, as the spec's sequencing clarification records:

1. **US3 first (the flaky suite).** US1 and US2 must ship E2E coverage, and that coverage would
   otherwise land in a suite that can hide its own failures. Fix the instrument before trusting its
   readings.
2. **US1 (icon packs)** — the substantial change.
3. **US2 (tooltips)** — small and independent; last because it is the cheapest to land.

## Complexity Tracking

> Recorded deferrals and known conditions. No constitution violations require justification.

| Item | Why it is here | Disposition |
|---|---|---|
| **Pre-existing integration flake**: `terminal-reattach.integration.test.ts:91` ("closeIdle closes an idle shell but keeps a busy one") fails under full parallel load, passes in isolation | Found while recording this feature's baseline. **Not caused by 017** — this branch contained only markdown at the time. Constitution v3.14.0 requires a flake be investigated or **explicitly tracked**; this is the tracking. | **Out of scope** for 017: it is an *integration* test, and FR-013a scopes the audit to the **end-to-end** suite. Automatic issue-filing was denied by permission policy; flagged to the user for filing. Recommend widening the audit to the integration layer as follow-up work. |
| **10 E2E tests fail on their first attempt** at baseline (retries disabled): `context-menu:105`, `destroy-cascade:83`, `performance:72`, `persistence-restore:87` & `:137`, `phase9:107` & `:136`, `projects:144`, `terminal-altscreen-parity:104`, `terminal-slow-start:20` | Discovered by the pre-implementation baseline. All are currently laundered green by `retries: 2`. The flake population is **at least eleven**, not the one #66 describes. FR-014's gate cannot be armed until they are dealt with, or the suite is red on arrival. | **In scope.** Each is fixed if it is the race class, or **explicitly quarantined with a written justification** in `e2e-audit.md` (T002/T003). The constitution permits "fixed **or** explicitly tracked" — never silence. Quarantining loses coverage *honestly*; retrying loses it *invisibly*. |
| **CI depends on a retry** — `ci.yml:154-157` records that "the elevated de-elevation path is absorbed by retries" | A code path whose CI coverage relies on a retry converting a failure into a pass. Arming the gate without a disposition turns CI red, and FR-014a forbids exempting CI. | **In scope** (T004): decide before the gate is armed; record in `e2e-audit.md`. |
| **106 `waitForTimeout` / 205 `.evaluate(` occurrences** across the E2E suite | FR-013a requires the *class* to be closed, but not every occurrence is a defect (`app.evaluate()` against the main process is legitimate; a sleep awaiting real PTY output may have no condition to poll). | Fix every unguarded geometry read, every negative-assertion-as-settle, and every sleep with a deterministic condition. Sleeps genuinely awaiting external process output are **kept, annotated, and listed in a report** — FR-013a requires what is *not* fixed to be visible. |
| **PNG icon tokens cannot be themed** | `isImageFilename()` accepts `.png`, but a raster image cannot take a colour from the theme. | `.svg` is inlined and themed; `.png` renders as `<img>` with its own colours. No bundled pack uses PNG. Documented in research §1 rather than silently ignored. |
