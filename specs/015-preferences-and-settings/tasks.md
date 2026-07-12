# Tasks: Preferences & Settings — Granular Reset Controls

**Feature**: `015-preferences-and-settings` | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md) | **Contract**: [contracts/reset-ipc.md](./contracts/reset-ipc.md)

**Tests are MANDATORY**: constitution Principle V (Test-First Quality Discipline) is NON-NEGOTIABLE — tests are written first, observed failing (Red), then made to pass (Green). Every user-facing UI change ships E2E coverage.

> **Test-layer correction (2026-07-12, during execution).** This repository has **no React component-test stack** — the `unit` vitest project is `environment: 'node'` and includes only `packages/**/tests/unit/**/*.test.ts`; there is no jsdom and no Testing Library, and not one `.tsx` test exists. The established layering is **pure logic → unit tests (core)**, **main-process behaviour → integration tests**, and **UI behaviour → Playwright-Electron E2E** — which is also exactly what constitution Principle V demands ("every user-facing UI change MUST ship with E2E coverage"). Tasks below that originally called for `.tsx` component tests are therefore satisfied by **E2E tests written first (Red) against the running app**, not by importing a new testing stack mid-feature. The RED step is preserved; only its layer changes.

**Key context**: feature 010's `resetBinding`, `resetSetting` and `resetEverything` already exist on `ShippedDefaultsService` and are already tested — they are simply unreachable from the renderer. This feature exposes them, adds two thin per-editor operations (FR-011b), builds the controls, and retires the app's second notion of "default". **No reset logic and no defaults record is written.**

The renderer obtains the shipped record for the overridden-test from `buildShippedDefaults()` in `@throng/core` — pure, importable, already used by the main process.

---

## Phase 1: Setup

- [x] T001 Record a green baseline against the merged 014/013 tree before changing anything: run `npm run build`, `npm run lint`, `npm run typecheck`, `npm run test:unit` from the repository root.

---

## Phase 2: Foundational (blocking — must complete before any user story)

**Purpose**: expose feature 010's reset API to the renderer, and provide the pure predicate that decides when a reset affordance is shown.

### The overridden-test (core, pure)

- [x] T002 [P] Write failing unit tests for the overridden-test in `packages/core/tests/unit/overridden.test.ts`: a setting leaf equal to its shipped value is NOT overridden; a changed leaf IS; a nested leaf resolves by dotted path; a binding matching the shipped chords is NOT overridden; different chords ARE; **chord order is irrelevant** (`["F3","Ctrl+F"]` ≡ `["Ctrl+F","F3"]`); **capitalisation is irrelevant** (`ctrl+f` ≡ `Ctrl+F`); an action with an **empty shipped chord set** (ships unbound) IS overridden once bound and NOT overridden when unbound; an entry **absent from the shipped record entirely** reports not-resettable rather than overridden (FR-004a, FR-004b, SC-013).
- [x] T003 Implement `isSettingOverridden(current, path, shipped)` and `isBindingOverridden(current, action, shipped)` in `packages/core/src/config/overridden.ts` (normalized chord-**set** comparison; an absent shipped entry means not-resettable), and export both from `packages/core/src/index.ts`. Green T002.

### The two thin per-editor operations (FR-011b)

- [x] T004 [P] Write failing integration tests in `packages/ui/tests/integration/shipped-defaults-per-editor.test.ts`: `resetSettings()` restores the whole settings document from the shipped record and leaves keybindings and themes untouched; `resetKeybindings()` likewise; both are atomic (an unwritable target leaves the file unchanged); both are idempotent on a pristine config.
- [x] T005 Add `resetSettings()` and `resetKeybindings()` to `packages/ui/src/main/shipped-defaults-service.ts` — each a single-file `writeFilesAtomic` write sourced from `this.shipped`, mirroring the existing `restoreTheme(name)` (do **not** re-derive defaults; do **not** write from the renderer — FR-010, FR-011b). Green T004.

### Expose the reset API (IPC seam — extends feature 014's, does not duplicate it)

- [x] T006 [P] Write failing integration tests in `packages/ui/tests/integration/reset-ipc.test.ts` against a temp config root, per `contracts/reset-ipc.md`: `resetBinding` restores the **full** shipped chord set leaving other actions byte-identical; `resetSetting` restores exactly one leaf with siblings byte-identical; `resetPreferences` restores settings + keybindings + built-in themes in one operation; a **custom theme survives** `resetPreferences` untouched; an unwritable config root leaves **every** file unchanged and reports `failedPath` (all-or-nothing); an unknown action/path returns `{ ok: false, reason: 'no-default' }` and writes nothing.
- [x] T007 Widen `ConfigManagementDeps.shippedDefaults` with `resetBinding`, `resetSetting`, `resetEverything`, `resetSettings` and `resetKeybindings`, and register the channels `throng:config:resetBinding`, `throng:config:resetSetting`, `throng:config:resetPreferences`, `throng:config:resetSettings` and `throng:config:resetKeybindings` in `packages/ui/src/main/config-write-ipc.ts`. `main.ts` already injects `shippedService` — do not add a second composition root (Principle IX). Green T006.
- [x] T008 [P] Add the five bridge entries to the existing `config` block in `packages/ui/src/preload/preload.cts`.
- [x] T009 [P] Add the matching optional typings to the `config` block in `packages/ui/src/renderer/global.d.ts`, mirroring how feature 014's `restoreTheme` / `restoreAllThemes` are typed.

**Checkpoint**: the reset API is reachable from the renderer and the overridden-test exists. US1, US2 and US3 can now proceed in parallel.

---

## Phase 3: User Story 1 — Reset a single key binding (Priority: P1) 🎯 MVP

**Goal**: from the Key Bindings editor, restore one action's full shipped chord set without disturbing any other binding.

**Independent test**: rebind several actions, reset exactly one, confirm its chords match the shipped binding(s) while every other rebinding is untouched.

- [x] T010 [US1] Write the failing **E2E** (Red) in `packages/ui/tests/e2e/preferences-reset.e2e.ts`: a Key Bindings row at its shipped binding shows **no** reset affordance; rebinding it makes a reset icon appear (hover title naming the action); clicking it restores the shipped chords **with no confirmation** and the icon disappears; no toast or banner appears (FR-001, FR-002, FR-004a, FR-004c).
- [x] T011 [US1] Add the per-row reset affordance to `packages/ui/src/renderer/preferences/keybindings-tab.tsx`: render `IconButton` (token `retry`, hover title, `data-testid={`binding-reset-${d.key}`}`) in the row's control area **only while `isBindingOverridden(current, d.key, buildShippedDefaults())`**, calling `window.throng.config.resetBinding(d.key)`, applied immediately with no confirmation. Green T010.
- [x] T012 [US1] Style the row affordance in `packages/ui/src/renderer/preferences/preferences.css` — colours from theme tokens only, no hardcoded CSS colours (constitution v3.12.0 / Principle X).
- [x] T013 [US1] Extend `packages/ui/tests/e2e/preferences-reset.e2e.ts` with the US1 journey: rebind two actions → both rows show the reset icon → reset one → its chords return to shipped, its icon disappears, the other row is untouched and still shows its icon. Assert an action shipping **multiple** chords restores the **full** set (US1/AC4).

**Checkpoint**: US1 is independently shippable — the headline gap in issue #43 is closed.

---

## Phase 4: User Story 2 — Reset a single setting (Priority: P1)

**Goal**: from the Settings editor, restore one setting leaf by its dotted path, leaving every sibling untouched.

**Independent test**: change several settings under one section, reset exactly one leaf, confirm only that leaf reverts.

- [x] T014 [US2] Write the failing **E2E** (Red) in `packages/ui/tests/e2e/preferences-reset.e2e.ts`: a Settings row at its shipped value shows **no** reset affordance; changing it makes one appear; clicking it restores the shipped value with no confirmation, the icon disappears, and a sibling leaf under the same section keeps the user's value (FR-003, FR-004, FR-004a, FR-004c).
- [x] T015 [US2] Add the per-row reset affordance to `packages/ui/src/renderer/preferences/settings-tab.tsx`, gated on `isSettingOverridden(current, d.key, buildShippedDefaults())`, with `data-testid={`setting-reset-${d.key}`}`, calling `window.throng.config.resetSetting(d.key)`. Green T014.
- [x] T016 [US2] Extend `packages/ui/tests/e2e/preferences-reset.e2e.ts` with the US2 journey: change two settings in one section → reset one → only that leaf reverts, its icon disappears, the sibling keeps the user's value and its icon. Confirm the change hot-applies without restart.

**Checkpoint**: both P1 stories complete — the per-item reset gap is fully closed.

---

## Phase 5: User Story 3 — Reset All Preferences (Priority: P2)

**Goal**: one atomic, confirmed reset of settings, key bindings and built-in themes — truthfully scoped.

**Independent test**: customise all three kinds plus a custom theme, projects and layout; Reset All Preferences; assert the three kinds revert together while the custom theme, projects and layout survive; assert a locked file leaves everything unchanged.

- [x] T017 [US3] Write the failing **E2E** (Red) in `packages/ui/tests/e2e/preferences-reset.e2e.ts`: the toolbar shows a **Reset All Preferences** control (testid `prefs-reset-preferences`) on every tab; clicking it opens the inline confirmation (`prefs-reset-confirm`) whose text names **both** what is reset (settings, key bindings, built-in themes) **and** what survives (projects, window layout, workspace state, custom themes); cancelling changes nothing (FR-005, FR-005b, FR-006, US3/AC3).
- [x] T018 [US3] Add the **Reset All Preferences** control to the toolbar in `packages/ui/src/renderer/preferences/preferences-app.tsx`, wired to the existing inline confirmation strip (`prefs-reset-confirm`) — **not** feature 014's modal dialog (FR-006, issue #48) — invoking `config.resetPreferences()` on confirm. Green T017.
- [x] T019 [US3] Write the failing **E2E** (Red) in `packages/ui/tests/e2e/preferences-reset.e2e.ts` for the notice surface: with the config root made unwritable, a reset surfaces a **dismissable** notice naming the operation and stating that **nothing was changed**, and the notice can be dismissed; on success no toast or banner appears — the confirmation simply closes and the editors show shipped values (FR-006a, FR-007, SC-012).
- [x] T020 [US3] Implement the dismissable failure notice in `packages/ui/src/renderer/preferences/preferences-app.tsx`, used by the global reset **and** by the per-item resets from US1/US2 (a locked file must not make a row reset fail silently). Green T019.
- [x] T021 [US3] Extend `packages/ui/tests/e2e/preferences-reset.e2e.ts` with the US3 journey: customise a setting, a binding and a built-in theme; create and select a custom theme; Reset All Preferences → confirm → all three kinds return to shipped, the confirmation closes and the editors show shipped values (success feedback, FR-007), the **custom theme still exists** but is no longer active, and the **project list and layout are unchanged** (SC-010, SC-015).

**Checkpoint**: all three user stories delivered.

---

## Phase 6: JSON mode (FR-013a, FR-013b)

**Purpose**: the per-item affordances are row affordances and must not appear in JSON mode; a reset performed while JSON mode is active must not leave the editor showing stale text — and must not silently clobber unsaved edits.

- [x] T022 Write the failing **E2E** (Red) in `packages/ui/tests/e2e/preferences-reset.e2e.ts`: in JSON mode the Settings and Key Bindings **row affordances are absent**, while the toolbar controls (per-tab reset, Revert All Preferences, Reset All Preferences) remain **present and enabled** in both modes (FR-013a).
- [x] T023 Ensure the row affordances render only in UI mode and the toolbar controls in both, in `packages/ui/src/renderer/preferences/preferences-app.tsx` / the two tab components. Green T022. A reset while JSON mode is active must reach the JSON editor through the **existing external-change path** shipped by feature 007 (`json-tab.tsx`): a **clean** buffer refreshes to the reset content, a **dirty** buffer surfaces the existing reload prompt rather than overwriting the user's unsaved work (FR-013b) — introduce **no second rule** for resets.
- [x] T024 Add an E2E to `packages/ui/tests/e2e/preferences-reset.e2e.ts`: switch to JSON mode → no row reset icons are present → invoke Reset All Preferences → with a clean buffer the visible JSON document refreshes to the shipped content (FR-013a, FR-013b).

---

## Phase 7: Collapse the second notion of "default" (FR-011, FR-011a, FR-011b, SC-009)

**Purpose**: after this phase, no code path resolves a default from anywhere but feature 010's record.

- [x] T025 Write the failing **E2E** (Red) in `packages/ui/tests/e2e/preferences-reset.e2e.ts`: the per-tab reset is **hidden on the Themes tab** (today it is merely *disabled* for custom themes); on Settings and Key Bindings it restores that editor from the shipped record; its hover title **names the editor** it applies to (FR-011, FR-011b, FR-012a). The main-process side is already covered by the integration tests from T004.
- [x] T026 Re-point the per-tab reset in `packages/ui/src/renderer/preferences/preferences-app.tsx` at the new main-process operations (`config.resetSettings()` / `config.resetKeybindings()`), hide the control on the Themes tab, and replace `isBuiltInTheme` with `isReservedThemeName` wherever a built-in test is still needed. Green T025.
- [x] T027 Delete the superseded editor-compiled defaults from `packages/core/src/config/theme-reset.ts` — `resetCurrentSettings`, `resetCurrentKeybindings`, `resetCurrentTheme` (already dead code since 014) and `isBuiltInTheme` — remove their exports from `packages/core/src/index.ts`, and delete their obsolete unit tests in `packages/core/tests/unit/theme-reset.test.ts`. **Keep `revertAll` / `OnEntrySnapshot`** — they back the session undo, which survives unchanged (FR-012).
- [x] T028 Add a unit test in `packages/core/tests/unit/shipped-defaults.test.ts` asserting **SC-009**: the retired helpers no longer exist and `buildShippedDefaults()` is the single source of defaults — no exported core symbol resolves a "default" from anywhere else.

---

## Phase 8: Completeness (FR-008, SC-005)

**Purpose**: constitution v3.11.0 requires the configuration-editor completeness test to back resettability — "no resettable item is left without a reset path".

- [x] T029 Extend the configuration-editor completeness test (alongside the existing settings/keybindings/theme-token descriptor assertions) so that **every** `SETTINGS_METADATA` leaf and **every** `KEYBINDINGS_METADATA` action that has a shipped default in `buildShippedDefaults()` is resettable — i.e. its dotted path / action id resolves in the record and the editor renders a reset path for it when overridden. A newly added configurable key without a reset path must **fail** the test (FR-008, SC-005).

---

## Phase 9: Icon tokenisation & naming (FR-009a/b/c, FR-012a/b, SC-006, SC-014)

**Purpose**: settle the constitution v3.12.0 violations this window has carried since that amendment, and stop the identifiers and labels from lying.

- [x] T030 [P] Write failing unit tests in `packages/core/tests/unit/theme-copy.test.ts` asserting the two new icon tokens `editJson` and `editVisual` exist in the theme model **and** each has exactly one `THEME_TOKEN_COPY` descriptor, keeping the v3.11.0 token-completeness test green.
- [x] T031 Add the `editJson` and `editVisual` icon tokens to `packages/core/src/config/theme.ts` with sensible default glyphs, and their human-readable copy to `packages/core/src/config/theme-copy.ts`. Green T030. These are the **only** new tokens this feature adds (FR-009c).
- [x] T032 Write the failing **E2E** (Red) in `packages/ui/tests/e2e/preferences-reset.e2e.ts` asserting **no hard-coded icon graphic remains** in the preferences window: the toolbar buttons contain **no inline `<svg>`**; the settings-search clear and the chord-pill remove render themed glyphs; the mode toggle renders a themed glyph rather than the text `{ }` / `UI`; every affordance carries a hover title (SC-006, SC-014). A **source-level** unit guard in `packages/ui/tests/unit/preferences-icons.test.ts` (reading the component sources) asserts no `<svg` remains in the three preferences components — this is a pure-node test, no component stack needed.
- [x] T033 Replace `ResetIcon` and `RevertAllIcon` in `packages/ui/src/renderer/preferences/preferences-app.tsx` with `IconButton` (token `retry` for the per-tab reset, `restoreAll` for the global reset), convert the UI⇄JSON mode toggle to an `IconButton` using the new `editJson` / `editVisual` tokens, and delete both inline-SVG components.
- [x] T034 Replace `ClearIcon` in `packages/ui/src/renderer/preferences/settings-tab.tsx` with the themed `dismiss` token, and the chord-pill remove glyph in `packages/ui/src/renderer/preferences/keybindings-tab.tsx` with the themed `destroy` token — both via `IconButton` with hover titles. Green T032.
- [x] T035 Rename the controls, their identifiers **and the confirmation copy** in `packages/ui/src/renderer/preferences/preferences-app.tsx` (FR-012a, FR-012b): the session undo becomes **"Revert All Preferences"** with `data-testid="prefs-revert-all"`; the global reset is **"Reset All Preferences"** with `data-testid="prefs-reset-preferences"`; the per-tab reset's hover title names its editor. The inline strip's message and its **decision-button labels** must match — in particular the session undo's confirm button currently reads **"Reset all"**, naming a scope it does not have, and must not. No label or identifier may name a scope its control lacks.

---

## Phase 10: Reconcile the existing E2E suite (FR-014)

**Purpose**: `preferences-reset.e2e.ts` has not changed since feature 007 and four of its assertions are the *old* behaviour. Updating them is the Red step for Phases 7–9, not incidental churn.

- [x] T036 Update `packages/ui/tests/e2e/preferences-reset.e2e.ts` so its existing assertions match this feature: the per-tab reset is **hidden** on the Themes tab (it currently asserts *disabled for a custom theme / enabled for a built-in*); the toolbar titles are **"Reset All Preferences"** / **"Revert All Preferences"** (it currently asserts "Reset to Defaults" / "Revert All"); the toolbar buttons render **themed glyphs**, not one inline `<svg>` each; every reference to `prefs-reset-all` becomes `prefs-revert-all` or `prefs-reset-preferences` as appropriate.

---

## Phase 11: Polish, gates & documentation

- [x] T037 Add idempotence assertions to `packages/ui/tests/e2e/preferences-reset.e2e.ts`: resetting an item already at its shipped value is a silent no-op; Reset All Preferences on a pristine config reports success and changes nothing (SC-003).
- [x] T038 Add an assertion to `packages/ui/tests/e2e/preferences-reset.e2e.ts` that the four scopes are distinguishable from their labels and hover titles alone and that **no two controls perform the same write** (SC-008, SC-011, FR-013). *(Same file as T037 — sequential.)*
- [x] T039 [P] Update `README.md` to describe the preferences window's **current** reset behaviour (per-item resets, per-tab reset, Reset All Preferences, Revert All Preferences) — a truthful snapshot, not a changelog (constitution documentation-currency rule).
- [x] T040 [P] Update `ROADMAP.md`: mark granular reset controls delivered, and confirm the notice-surface unification (issue #48) is listed as planned.
- [x] T041 Run the full gate suite and observe it green: `npm run lint` (zero errors), `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:contract`, `npm run test:e2e`. No success may be claimed without observed passing output (Principle V).

---

## Dependencies & execution order

```text
Phase 1 (Setup)
   └─> Phase 2 (Foundational: overridden-test + per-editor ops + IPC seam)  ← BLOCKS everything
          ├─> Phase 3 (US1 — per-binding reset)     [P1, MVP]
          ├─> Phase 4 (US2 — per-setting reset)     [P1]  (parallel with US1)
          └─> Phase 5 (US3 — Reset All Preferences) [P2]  (parallel with US1/US2)
                 └─> Phase 6 (JSON mode)
                        └─> Phase 7 (collapse the second notion of "default")
                               └─> Phase 8 (completeness test)
                                      └─> Phase 9 (icon tokenisation & naming)
                                             └─> Phase 10 (reconcile the existing E2E suite)
                                                    └─> Phase 11 (polish, gates, docs)
```

**Parallelism (`[P]` = different files, no incomplete dependency):**

- T002 (core) ∥ T004 (ui integration) ∥ T006 (ui integration) — different packages/files.
- T008 (preload) ∥ T009 (typings) after T007.
- US1 (Phase 3) ∥ US2 (Phase 4) — different tab components.
- **Shared-file sequences (NOT parallel)**: T017 and T025 both edit `preferences-toolbar.test.tsx`; T013, T016, T021, T024, T036, T037 and T038 all edit `preferences-reset.e2e.ts`; T018, T020, T026, T033 and T035 all edit `preferences-app.tsx`. Within each group, land them in task order.

## Implementation strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1).** That alone closes the gap issue #43 names first — there is no way to reset a single key binding to its shipped value — and is independently shippable and testable.

Add US2 (the settings counterpart), then US3 (the global reset). Phases 6–10 are the correctness and hygiene work that makes the window honest: correct behaviour in JSON mode, one notion of "default", a completeness guarantee, truthful names, and no un-themeable icons. Phase 11 closes the gates and the docs.

**Total: 41 tasks** — 1 setup, 8 foundational, 4 (US1), 3 (US2), 5 (US3), 3 (JSON mode), 4 (collapsing duplicate defaults), 1 (completeness), 6 (icons & naming), 1 (E2E reconciliation), 5 (polish/gates/docs).

---

## Phase 12: Convergence — the amended row-affordance model (2026-07-12)

Appended by `/speckit-converge` after spec amendment **FR-015 – FR-018** / **SC-016 – SC-020** (issues #51, #52). None of this work exists in the code yet.

**Token decision (recorded here because it settles FR-009's icon rule for the two new actions):** *reset* keeps `retry`; *clear* **reuses `destroy`** — it is the same "remove this" semantic the chord pill already uses, applied to the whole value; *revert* needs a **new** token, because no existing one means "undo to where I started".

### Core (pure, blocking — land before the renderer tasks)

- [x] T042 [P] Add the `revert` icon token to `packages/core/src/config/theme.ts` and its human-readable copy to `theme-copy.ts`, so the token-completeness test still passes on all 14 bundled themes per FR-016 + FR-009 (missing)
- [x] T043 [P] Add `clearable?: boolean` to `FieldDescriptor` in `packages/core/src/config/metadata.ts` and declare it on the qualifying fields in `settings-metadata.ts` and `theme-metadata.ts` per FR-016a (missing)
- [x] T044 [P] Add a pure `differsFromEntry` predicate to `packages/core/src/config/overridden.ts` — settings leaf by dotted path, key binding by normalized chord SET against the on-entry snapshot — with unit tests covering the case that decides the feature: an item **already overridden on entry**, edited, then reverted, returns to **that override** and not to the shipped default, per FR-016 + SC-017 (missing)
- [x] T045 Prove `filterFields()` in `packages/core/src/config/settings-search.ts` already serves the Key Bindings editor — it is generic over the value accessor and flattens arrays, so passing an action's chord array as its "value" makes chords searchable with **no core change**. Cover it with unit tests per FR-017, and use it as-is from the tab (T052): one filter in the codebase, not two (partial — the capability exists, the coverage and the caller do not)
- [x] T046 Extend the configuration-editor completeness test so a `clearable` declaration cannot lie: every field declaring it MUST **round-trip an empty value through the tolerant parser without error**, per FR-016a + Constitution v3.11.0. Note this is a test of the value's **validity when empty**, not of the shape of its shipped default — the theme font stack ships populated yet is legitimately clearable (FR-018) (partial)

### Renderer

- [x] T047 Move the per-item affordances into a fixed-width gutter rendered **before** the control in `packages/ui/src/renderer/preferences/settings-tab.tsx`, `keybindings-tab.tsx` and `preferences.css` — the gutter MUST reserve its width while empty, so the control does not move when an item first becomes overridden — per FR-015 + SC-016 (contradicts: `.settings-row__reset` currently carries `margin-left: 8px` after the control)
- [x] T048 Add the per-item **revert** affordance to both tabs, shown only while `differsFromEntry`, restoring from the window's on-entry snapshot and writing through the ordinary `writeConfig` path (NOT a reset IPC channel — reverting is an edit to a remembered value), per FR-016 + SC-017 (missing)
- [x] T049 Add the per-item **clear** affordance in both tabs: remove **all** chords on any key-binding row (unbound is valid for every action, so no declaration is needed), and empty the value on any field declared `clearable`, per FR-016 + FR-016a + SC-018 (missing)
- [x] T050 Hide the per-item **revert** and **clear** affordances in JSON mode alongside the existing reset, per FR-013a — they are row affordances and JSON mode has no rows (partial)
- [x] T051 Give the three row actions distinct tokens (`retry` / `revert` / `destroy`) and hover titles that name their scope, so reset, revert and clear are tellable apart at a glance, per FR-013 + FR-009 + SC-017 (partial)
- [x] T052 Add the typeahead search box to `packages/ui/src/renderer/preferences/keybindings-tab.tsx`, reusing the Settings search component, the core filter of T045 and the `dismiss`-token clear affordance, per FR-017 + SC-019 (missing)
- [x] T053 Make the theme's font-family stack fully emptiable in `pickers.tsx`: the clear action of T049 empties it in one step, removing the last pill by hand stays permitted, the add control survives an empty list, and an empty stack renders through the fallback family, per FR-018 + SC-020 (partial — `removeAt` already has no guard; the one-step clear and the empty-state guarantees do not exist)

### Tests & gates

- [x] T054 Integration test in `packages/ui/tests/integration/` proving revert and clear write through the ordinary config-write path and never invoke the reset IPC channels, per FR-016 (missing)
- [x] T055 E2E in `packages/ui/tests/e2e/preferences-reset.e2e.ts` (and a new spec where it reads better): the control does not move when an affordance appears; revert on an item overridden-on-entry returns it to that override, not to shipped; clearing a binding unbinds the action; the Key Bindings typeahead narrows the list; the font stack can be emptied and re-populated — per SC-016 – SC-020 + FR-014 (missing)
- [x] T056 Amend FR-009c and SC-014, which both state the feature adds **four** new theme tokens: the `revert` token of T042 makes it **five** (contradicts — spec self-consistency)
- [x] T057 Update `quickstart.md` and `data-model.md` for the three-action row model and the `clearable` descriptor field, then close the gates: ESLint, `tsc --noEmit`, and the unit / integration / contract / E2E suites all green, per Constitution v3.13.0 (partial)

---

## Phase 13: Convergence — row layout & the always-visible affordances (2026-07-12, issue #65)

From using the running feature. **FR-015 is amended, not reversed:** its requirement was always *"the control must not move"*. Showing all three affordances at all times (greyed when inapplicable) holds the layout still **and** makes every action discoverable, which reserving empty space never did.

- [x] T058 Add a **disabled** state to the row affordances in `packages/ui/src/renderer/preferences/row-actions.tsx` and `preferences.css`: render **all three** always, right of the control, each greyed + `disabled` while inapplicable, each carrying a hover title saying **why** it does not apply, with the disabled colour from a theme token — per FR-015 + FR-015a + SC-016 (contradicts: they are currently hidden, in a gutter *before* the control)
- [x] T059 Move the affordance container back **after** `.settings-row__control` in `settings-tab.tsx`, `keybindings-tab.tsx` and `themes-tab.tsx`, and drop the reserved left gutter from `preferences.css` — the geometry is now held still by the affordances never disappearing, not by reserving space (FR-015 — contradicts)
- [x] T060 [P] Wrap the key-binding chord pills and render each as **ONE** box containing the chord and its remove control (not a box nested in a box) in `keybindings-tab.tsx` + `preferences.css`, per FR-019 + FR-019a + SC-021 + SC-022 (contradicts)
- [x] T061 [P] Wrap the theme font-family pills so a stack of six does not squash its labels, in `pickers.tsx` + `preferences.css`, per FR-019 + SC-021 (partial)
- [x] T062 [P] Give rows horizontal padding and vertically centre their values — including the *unbound* placeholder — in `preferences.css` + `keybindings-tab.tsx`, so a row-hover highlight never runs edge-to-edge, per FR-019b + SC-022 (partial). Note this makes the `panelSurface` overload (#62) visible but does NOT fix it — that token is not this feature's to change.
- [x] T063 [P] Theme the colour control's **swatch** (background, border, font) from theme tokens in `pickers.tsx` + `preferences.css`, per FR-020 + SC-023. Do **not** claim the native popup is themed — it cannot be (#64) (contradicts: the swatch is the last hard-coded-colour control in a window whose SC-006/SC-014 claim no such control remains)
- [x] T064 Add the typeahead to the **Themes** tab in `themes-tab.tsx`, reusing the same shared `filterFields` the other two tabs use — matching token label, description and current value — per FR-021 + SC-024 (missing)
- [x] T065 E2E in `packages/ui/tests/e2e/preferences-row-actions.e2e.ts`: all three affordances are present and correctly disabled on an untouched row; the control's x-position is **identical** before and after an item becomes overridden; chords and font pills wrap at the window's minimum size; the Themes typeahead narrows its token rows — per SC-016 + SC-021 + SC-024 (missing)
- [x] T066 Close the gates: ESLint, `tsc --noEmit`, unit / integration / contract / E2E all green (Constitution v3.13.0)

---

## Phase 14: Convergence — themes-tab search & gutter sizing (2026-07-12)

From using the running feature. All three are defects in what Phase 13 shipped.

- [x] T067 Size the affordance gutter to the actions the SURFACE offers (`--row-action-slots`), not to the three that exist — a DECLINED action (the Themes tab has no per-token reset) can never light up, so reserving its slot was dead space on every theme row. A DISABLED one still holds its slot: it may light up on the next keystroke, and the row must not move when it does (FR-015 — partial)
- [x] T068 Bring the icon section into the Themes typeahead (`icon-section.tsx`, `themes-tab.tsx`): it sat OUTSIDE the filtered groups, so it neither narrowed nor hid — a search for "terminal" returned two colour rows plus the entire icon grid. A section that ignores the filter is worse than one with no filter, because it looks like a result (FR-021 — partial)
- [x] T069 Tighten the control↔actions gap and widen label↔control, in `preferences.css` — one flex `gap` cannot express two different distances, and the row's actions belong tight to the control they act on (FR-019b — partial)
- [x] T070 Fix the setting description rendering underneath the form controls: `.settings-row__meta` was `flex: 1 1 auto`, so its base size was its own CONTENT width and a long description spilled over the control instead of wrapping. `flex-basis: 0` makes it take the space that is left and wrap inside it. Visible only on the wider-font themes (Cyberpunk, Bash), where the text finally got long enough to notice — it was always broken (FR-019b — contradicts)
- [x] T071 Retire the source-grepping icon guard in favour of an exported `ROW_ACTION_TOKENS` constant: the regex hard-coded `\n`, so on a Windows CI checkout (CRLF) it matched nothing and asserted an empty object against an empty object. It passed locally and could NEVER have passed on CI. Assert the fact, not the source text (Constitution v3.14.0 — contradicts)
