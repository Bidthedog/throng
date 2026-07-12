# Implementation Plan: Preferences & Settings — Granular Reset Controls

**Branch**: `015-preferences-and-settings` | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-preferences-and-settings/spec.md`

## Summary

Feature 010 shipped the authoritative shipped-defaults record and a complete reset API — and no UI. Its four operations (`resetBinding`, `resetSetting`, `resetEverything`, `restoreTheme`) live on `ShippedDefaultsService` in UI-main, but only the two **theme** operations were ever exposed to the renderer (feature 014). The other two are reachable from nowhere. This feature closes that gap.

The work is four-layered and deliberately thin: **expose** feature 010's remaining operations over 014's existing IPC seam; **add** the row-level reset affordances (shown only on overridden rows, where they double as the "modified" cue); **add** the global "Reset All Preferences" toolbar control behind the window's existing inline confirmation; and **collapse** the app's second, editor-compiled notion of "default" onto feature 010's record so one authoritative answer exists.

Two clean-ups ride along because this is the change that touches those controls: the preferences window's remaining hard-coded icon graphics move onto theme tokens (settling the constitution v3.12.0 violations recorded as known at the time of that amendment), and the misleading `prefs-reset-all` identifier — which today names the *session undo* — is corrected.

No new reset logic is written. `resetBindingValue` / `resetSettingValue` (pure, in core) and `ShippedDefaultsService` (atomic, with rollback) already exist and are already tested; this feature adds only the plumbing, the controls, and the feedback.

### Amendment — 2026-07-12 (FR-015 – FR-018, issues #51 / #52)

Review of the running feature widened the row-affordance model. Four things follow, and none of them adds a new *write* path — they extend the affordance set and correct where it renders:

1. **Placement (FR-015).** The affordances move from **after** the control to a fixed-width gutter **before** it. Today `.settings-row__reset` carries `margin-left: 8px` inside `.settings-row__control`, so the control shifts as the reset icon appears and disappears. The gutter must reserve its width unconditionally, so the row is stable whether or not an item is overridden. This is a CSS + JSX-order change in `settings-tab.tsx`, `keybindings-tab.tsx` and `preferences.css`, plus the E2E assertions that pin the order.
2. **Revert (FR-016).** The per-item counterpart of feature 007's session undo. The machinery already exists — `theme-reset.ts` keeps an `OnEntrySnapshot` and `revertAll` restores from it. A per-item revert is that same snapshot, read at one dotted path (settings) or one action id (bindings). It needs a **pure predicate** alongside `isSettingOverridden` / `isBindingOverridden` in `core/src/config/overridden.ts` — call it *differs-from-entry* — and it writes through the ordinary edit path (`writeConfig`), **not** through a reset IPC channel: reverting is an edit to a remembered value, not a restore from the shipped record.
3. **Clear (FR-016 / FR-016a).** Also an ordinary edit, to an empty value. It needs one additive field on `FieldDescriptor` in `core/src/config/metadata.ts` — `clearable?: boolean` — declared per field in `settings-metadata.ts` / `theme-metadata.ts`. Key bindings are clearable unconditionally (unbound is valid for every action), so they need no declaration. The completeness test grows a companion: every field **declared** clearable must have an empty-valued shipped default and a fallback, so the declaration cannot lie.
4. **Key Bindings typeahead (FR-017).** `filterFields()` already exists in `core/src/config/settings-search.ts` and already backs the Settings tab. Key Bindings gets the same component and the same core filter, extended to match on chords as well as name and description. No second implementation.

**Font stack (FR-018)** falls out of (3): `FontFamilyPills.removeAt` already has no minimum-one guard, so an empty stack is reachable by hand today — what is missing is the one-step clear, a guarantee that the add control survives an empty list, and a fallback that renders. This is mostly a test-and-prove task, not a build task.

**Explicitly not taken here** (issues #53 – #58): sliders and number formatting, app-wide icon-pack rendering and icon colour, the cog / Key Bindings context menus, panel-header tooltips, and the project-scoped hidden-paths row. See spec → Out of Scope.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 22, React 18

**Primary Dependencies**: Electron 40 (main + preload + renderer, `contextIsolation`), React 18 renderer, `@throng/core` (platform-agnostic pure logic), Vitest (unit/integration/contract), Playwright-Electron (E2E)

**Storage**: Human-editable JSON in the per-user config root — `settings.json`, `keybindings.json`, `themes/<name>.json` — written through `FileConfigStore.writeFilesAtomic` (stage → atomic rename → rollback on first failure)

**Testing**: Vitest (`test:unit`, `test:integration`, `test:contract`) + Playwright-Electron (`test:e2e`); ESLint flat config + `tsc --noEmit` as blocking gates (constitution v3.13.0)

**Target Platform**: Windows 11 desktop (Electron); core logic OS-agnostic per Principle II

**Project Type**: Desktop application — npm workspaces monorepo (`packages/core`, `packages/ui`, `packages/platform-windows`, `packages/daemon`)

**Performance Goals**: The overridden-test runs per visible row on every config change. Settings has ~30 leaves and Key Bindings ~34 actions, so a straight comparison against the frozen shipped record is trivially fast; no memoisation is warranted (YAGNI). Reset latency is one atomic file write, hot-applied by the existing config watcher.

**Constraints**: The renderer is sandboxed — no `fs`. Every reset MUST cross IPC. Reset atomicity, rollback and the shipped record are feature 010's, consumed not rebuilt (FR-010). Feature 014's `IconButton` is the only icon primitive. The notice-surface inconsistency is deliberately **not** fixed here (issue #48).

**Scale/Scope**: ~34 key-binding actions, ~30 setting leaves, 14 bundled themes, 4 new theme tokens (plus 2 more for the revert/clear affordances, per the amendment), 5 new IPC channels (3 exposing existing feature-010 operations, 2 backing the per-tab reset), 3 renderer tabs touched. The 2026-07-12 amendment adds no IPC channel — revert and clear are ordinary edits through the existing `writeConfig` path — but does add one additive field to `FieldDescriptor` (`clearable`) and one pure predicate to `overridden.ts` (*differs-from-entry*).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Verdict |
|---|---|---|
| **II. Platform-Abstracted Core** | No OS calls in core; reset logic already pure in `@throng/core`; all I/O behind `FileConfigStore` | **PASS** — this feature adds no OS-specific code at all. The new overridden-test predicate is pure and lives in core. |
| **V. Test-First (NON-NEGOTIABLE)** | Red→Green→Refactor; unit + integration + contract + E2E; **every user-facing UI change ships E2E** | **PASS** — every task below is written test-first. The UI changes (row icons, global reset, renamed controls, tokenised icons) are covered by an updated `preferences-reset.e2e.ts` plus new E2E for the per-item resets. |
| **VI. Simple, Modern, Discoverable UX** | Common actions reachable without instruction | **PASS** — the reset affordance appears exactly where the modified value is, and doubles as the modified cue. |
| **VIII. SOLID/DRY/YAGNI** | Single authoritative representation of knowledge | **PASS — and this feature actively repairs a DRY violation.** The app currently holds *two* notions of "shipped default" (feature 010's record, and `theme-reset.ts`'s `DEFAULT_*` constants). FR-011a retires the second. No speculative generality: no memoisation, no new abstraction layers. |
| **IX. Constructor DI / one composition root per boundary** | No service-locator, no `new` in business logic | **PASS** — `ShippedDefaultsService` is already constructed in `composition-root.ts` and injected into `registerConfigManagementIpc` via `ConfigManagementDeps`. We widen that existing dependency; we do not add a container or reach for a singleton. |
| **X. Externalised Configuration** | No hardcoded values; theming from tokens | **PASS — and this feature repairs the outstanding violations.** The v3.12.0 amendment recorded `preferences-app.tsx` (ResetIcon/RevertAllIcon inline SVG) and `settings-tab.tsx` (ClearIcon inline SVG) as *known violations to be remediated by the next change that touches those controls*. This is that change (FR-009b/FR-009c). |
| **Configuration-editor completeness (v3.11.0)** | Every setting/action/token has a descriptor; completeness test | **PASS** — the two new icon tokens ship with `THEME_TOKEN_COPY` entries, so the existing completeness test stays green. No new settings or actions are added. |
| **Themeable icon controls (v3.12.0)** | Action controls are theme-token icons with hover titles; dialog decision buttons excepted | **PASS** — all new affordances render through `IconButton`. The confirmation strip's Yes/Cancel remain text-labelled under the stated dialog-decision exception. |
| **Static analysis & linting (v3.13.0)** | ESLint zero errors + `tsc` clean, in CI | **PASS** — enforced per task. |
| **Documentation currency (v3.10.0)** | README / ROADMAP current in the same change | **PASS** — a documentation task closes the feature (README's preferences description; ROADMAP marks granular reset delivered). |

**Result: PASS — no violations, nothing to justify in Complexity Tracking.** Two pre-existing constitution violations are *repaired* by this feature rather than introduced.

## Project Structure

### Documentation (this feature)

```text
specs/015-preferences-and-settings/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions grounded in the merged code
├── data-model.md        # Phase 1 — entities & the overridden-test
├── quickstart.md        # Phase 1 — how to validate the feature end to end
├── contracts/
│   └── reset-ipc.md     # Phase 1 — the renderer↔main reset contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (16/16)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/core/src/config/
├── shipped-defaults.ts        # 010's record + resetBindingValue/resetSettingValue (CONSUMED, unchanged)
├── overridden.ts              # NEW — the pure overridden-test (FR-004a/FR-004b)
├── theme-reset.ts             # PARTIALLY RETIRED — defaults helpers deleted (FR-011a);
│                              #   revertAll/OnEntrySnapshot RETAINED (they back the session undo, FR-012)
├── theme.ts                   # +2 icon tokens: editJson, editVisual (FR-009c)
└── theme-copy.ts              # +2 token copy entries (v3.11.0 completeness)

packages/ui/src/main/
├── shipped-defaults-service.ts  # resetBinding/resetSetting/resetEverything CONSUMED unchanged;
│                                #   + resetSettings()/resetKeybindings() — thin per-editor ops (FR-011b)
├── config-write-ipc.ts          # WIDEN ConfigManagementDeps.shippedDefaults + 3 new channels
└── main.ts                      # already injects shippedService — no change expected

packages/ui/src/preload/preload.cts          # +3 bridge entries under `config`
packages/ui/src/renderer/global.d.ts         # +3 typings

packages/ui/src/renderer/preferences/
├── preferences-app.tsx    # toolbar: global reset; rename controls; tokenise icons; retire theme-reset
├── settings-tab.tsx       # per-row reset icon; tokenise ClearIcon
├── keybindings-tab.tsx    # per-row reset icon; tokenise the chord-pill remove glyph
└── preferences.css        # row-affordance styling

packages/ui/tests/
├── unit/                  # overridden-test; toolbar rendering
├── integration/           # the 3 new IPC handlers end-to-end against a temp config root
└── e2e/preferences-reset.e2e.ts   # UPDATED — its current assertions contradict this feature (FR-014)
```

**Structure Decision**: The existing monorepo layout is used unchanged. Pure logic (the overridden-test) goes to `@throng/core` so it is unit-testable without Electron and reusable by both tabs; the IPC widening stays in `config-write-ipc.ts` beside 014's restore channels; the UI work is confined to the three preferences tab components and the shell.

## Phases

Mapped 1:1 onto the phases in [tasks.md](./tasks.md):

| # | Phase | Delivers |
|---|---|---|
| 1 | Setup | A recorded green baseline against the merged 014/013 tree |
| 2 | **Foundational** (blocking) | The pure overridden-test in core; the two thin per-editor operations (`resetSettings` / `resetKeybindings`, FR-011b); the reset API exposed over 014's existing IPC seam (main → preload → typings) |
| 3 | **US1 (P1)** — per-binding reset | Row affordance in Key Bindings, shown only while overridden |
| 4 | **US2 (P1)** — per-setting reset | Row affordance in Settings, addressed by dotted path |
| 5 | **US3 (P2)** — Reset All Preferences | Toolbar control, inline confirmation naming both sides of the blast radius, dismissable failure notice |
| 6 | JSON mode | Row affordances hidden in JSON mode; a reset reaches the JSON editor through feature 007's **existing** external-change path (clean buffer refreshes, dirty buffer prompts — FR-013b) |
| 7 | Collapse the second notion of "default" | Per-tab reset re-pointed at the record; `theme-reset.ts`'s defaults helpers deleted (SC-009) |
| 8 | Completeness | The v3.11.0 completeness test extended to cover resettability (FR-008/SC-005) |
| 9 | Icon tokenisation & naming | Two new tokens; every hard-coded icon migrated; controls, testids and confirmation copy renamed |
| 10 | E2E reconciliation | The four contradicting assertions in `preferences-reset.e2e.ts` brought in line (FR-014) |
| 11 | Polish, gates & docs | Idempotence, scope-distinguishability, README/ROADMAP, full green gate suite |

Phases 3, 4 and 5 are mutually independent once Phase 2 lands. Phases 6–11 are sequential (they converge on `preferences-app.tsx` and the shared E2E suite).

## Complexity Tracking

> No constitution violations. Nothing to justify.

One **tracked deferral** is recorded per the Incremental Delivery rule:

| Deferral | End-state requirement | Feature expected to complete it |
|---|---|---|
| The preferences window will hold **two** confirmation/notice models — feature 007's inline strip (used by this feature) and feature 014's modal dialog (themes surface) | A single, consistent notice surface across the app | **Issue #48** — "Refactor inline and dialog error and confirmation notices into toastr" (milestone v1.0.0), already filed and cross-referenced from the spec |

This deferral is deliberate: unifying the surfaces mid-flight would mean reworking feature 014's already-merged, already-tested renderer code, and the inconsistency is cosmetic rather than behavioural. It is recorded in the spec (FR-006, SC-011, Out of Scope) and in ROADMAP via issue #48.
