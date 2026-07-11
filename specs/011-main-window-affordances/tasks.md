---
description: "Task list for Main Window Affordances"
---

# Tasks: Main Window Affordances

**Input**: Design documents from `/specs/011-main-window-affordances/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included (TDD; Constitution Principle V makes E2E mandatory for every user-visible change). Write tests first, observe them fail (Red), then implement (Green).

## Build-order rule (READ FIRST)

Everything except the **dismiss-icon rendering** is independent of feature `009-theme-content`. Tasks are ordered so all 009-independent work lands and goes green first; the **dismiss-icon rendering + its glyph E2E are the LAST phase (Phase 8)**. At the first Phase 8 task, **STOP and report** for a rebase onto a `master` containing 009. Do NOT add the `dismiss` token, do NOT fall back to `destroy`, do NOT stub the glyph.

Second boundary (research.md B2): the settings-form rendering of the new `folder` control and the unresolvable-override flag live in `preferences/**` (owned by `015-preferences-and-settings`) — **out of scope here**. This feature ships the `folder` ControlKind, the shared component, and the resolve/validate helpers for 015 to consume.

---

## Phase 1: Setup

- [x] T001 Confirm a clean baseline on branch `011-main-window-affordances`: `npm run build` and `npm run test:unit` pass before any change (records the Green baseline for TDD).

---

## Phase 2: Foundational — core config (pure `@throng/core`; blocks US2 label + US3)

**Purpose**: Shared, pure config changes several stories build on. No 009 dependency. No DOM.

- [x] T002 [P] Write failing unit test for the `newProject` settings section (defaults `startingFolder='lastViewed'`, `overridePath=''`, internal `lastProjectFolder=''`; tolerant parse of bad values) in `packages/core/tests/unit/app-settings-newproject.test.ts`.
- [x] T003 [P] Write failing unit test for `resolveStartingFolder` (profile/lastViewed/override candidate + empty-falls-back-to-profileDir) and `isOverrideResolvable` in `packages/core/tests/unit/starting-folder.test.ts`.
- [x] T004 Extend the settings-metadata completeness test for the new leaves + `folder` control + internal `lastProjectFolder` + re-aligned confirmation labels in `packages/core/tests/unit/settings-metadata.test.ts` (make it fail first).
- [x] T005 Implement the `newProject` section (`startingFolder`, `overridePath`, internal `lastProjectFolder`) with tolerant parse/merge/clone in `packages/core/src/config/app-settings.ts`.
- [x] T006 [P] Add the `'folder'` value to `ControlKind` in `packages/core/src/config/metadata.ts`.
- [x] T007 [P] Implement the pure `resolveStartingFolder` + `isOverrideResolvable` helpers in `packages/core/src/config/starting-folder.ts`.
- [x] T008 Add descriptors (`newProject.startingFolder` = select; `newProject.overridePath` = folder) in group "New Project", add `newProject.lastProjectFolder` to `SETTINGS_INTERNAL_KEYS`, and re-align labels `confirmations.destroyProject` -> "Remove a project" and `confirmations.destroySubWorkspace` -> "Destroy a sub-workspace" in `packages/core/src/config/settings-metadata.ts`.
- [x] T009 Export the new helper + any new types from `packages/core/src/index.ts`.
- [x] T010 Run `npm run test:unit`; confirm T002–T004 now pass (core Green).

**Checkpoint**: core config compiles, settings-completeness green, resolution helper covered.

---

## Phase 3: User Story 2 — Removal terminology (Priority: P2)

**Goal**: Every removal control's verb (control/tooltip/menu/confirmation) matches the glossary; a project is "Remove" and its confirmation states no files are deleted. Behaviour unchanged.

**Independent Test**: Walk the verb matrix; project confirmation states no files deleted; no verb outside {Close, Destroy, Remove, Delete}.

- [x] T011 [P] [US2] Write failing E2E `packages/ui/tests/e2e/removal-verbs.e2e.ts`: project = "Remove" (control title, context menu, confirmation) + confirmation states no files deleted; project-owned panel in main = "Destroy" (session terminated); project-owned panel in a sub-workspace = "Close" (session keeps running); sub-workspace-owned panel = "Destroy"; tab = "Destroy"; sub-workspace = "Destroy".
- [x] T012 [US2] Change the project delete control + confirmation to the "Remove" verb and add the "no files on disk are deleted" consequence text in `packages/ui/src/renderer/sidebar/projects-panel.tsx` (tooltip/aria + `confirm({...})` copy; behaviour unchanged).
- [x] T013 [P] [US2] Align sub-workspace removal wording to "Destroy" (control title/aria, confirmation copy) in `packages/ui/src/renderer/sidebar/subworkspaces-panel.tsx`.
- [x] T014 [P] [US2] Align tab removal wording to "Destroy" (menu labels, confirmation titles/copy) in `packages/ui/src/renderer/workspace/tab-group.tsx`.
- [x] T015 [US2] Apply per-ownership panel verbs (project-owned in main = Destroy; project-owned in sub-workspace = Close; sub-workspace-owned = Destroy) across the header control title, context-menu entry, and confirmation copy in `packages/ui/src/renderer/workspace/panel-placeholder.tsx` — MINIMAL diff (012 rebases this file).
- [x] T016 [US2] Run `npm run test:e2e -- removal-verbs`; confirm the matrix passes (Green).

**Checkpoint**: verb matrix consistent; project "no files deleted" shown; settings labels already re-aligned (T008).

---

## Phase 4: User Story 3 — Smarter folder picker + starting-folder setting (Priority: P3)

**Goal**: The new-project picker opens at the resolved starting folder (default last-viewed), persists the last-chosen folder, honours the three options, and falls back to the profile folder when unresolvable. Shared folder-picker component + `folder` ControlKind delivered for 015.

**Independent Test**: Each option opens the picker at the expected folder; unresolvable configured folder falls back to profile; last-chosen persists.

- [x] T017 [P] [US3] Write failing test: UI-main `throng:pickFolder` honours `defaultPath` when it resolves and falls back to the home dir when it does not. (Shipped as `packages/ui/tests/unit/pick-folder.test.ts` — the resolve/fallback logic is a pure UI-main unit, so it is covered there rather than as a separate integration file.)
- [x] T018 [P] [US3] Write failing E2E `packages/ui/tests/e2e/new-project-folder.e2e.ts`: `lastViewed` opens at the last-created folder; `profile` opens at home; `override` opens at the override; an unresolvable configured folder falls back to home; last-chosen persists across a reload.
- [x] T019 [US3] Extend the UI-main handler `throng:pickFolder` to accept `{ defaultPath? }`, validate existence/isDirectory in main, and fall back to `app.getPath('home')` when unresolvable, in `packages/ui/src/main/main.ts` (folder-picker handler ONLY).
- [x] T020 [US3] Add the optional `opts` parameter to the `pickFolder` bridge/preload type (wherever `window.throng.pickFolder` is typed/exposed by the folder-picker handler surface) — keep it backward-compatible.
- [x] T021 [P] [US3] Implement the shared `FolderPicker` component (editable path input + themeable browse icon using an existing folder/`browse` icon token — NOT `dismiss`; hover title; `autoOpenOnMount` for project creation) in `packages/ui/src/renderer/common/folder-picker.tsx`.
- [x] T022 [US3] Wire project creation to compute the candidate via `resolveStartingFolder` and call `pickFolder({ defaultPath })` (auto-pop preserved), replacing the ad-hoc browse input with `FolderPicker`, in `packages/ui/src/renderer/sidebar/projects-panel.tsx`.
- [x] T023 [US3] Persist the chosen folder to `newProject.lastProjectFolder` via the existing `config.write` path on successful project creation, in `packages/ui/src/renderer/sidebar/projects-panel.tsx`.
- [x] T024 [US3] Run `npm run test:integration -- pick-folder-default` and `npm run test:e2e -- new-project-folder`; confirm Green.
- [x] T025 [US3] Document the 015 handoff (settings-form `case 'folder'` + unresolvable-override flag) in `specs/011-main-window-affordances/research.md` B2 (already noted) and ensure `isOverrideResolvable` is exported for 015 (verify T009).

**Checkpoint**: picker opens at the resolved folder; last-viewed persists; component + ControlKind + helpers ready for 015.

---

## Phase 5: User Story 4 — File-changed warning names the file (Priority: P4)

**Goal**: The "file changed on disk" warning names the containing tab, the panel, and the full path.

**Independent Test**: Two editors on different files; modify one on disk; the warning names the correct tab/panel/path.

- [x] T026 [P] [US4] Assert the external-change notice carries a `files` entry with the full path + a note naming the panel and tab. (Shipped as a unit test over the pure `buildFileChangedNotice` helper in `packages/ui/tests/unit/file-changed-notice.test.ts`, plus the end-to-end `editor-external-change-named.e2e.ts`; the generic-notice integration test was left unchanged.)
- [x] T027 [P] [US4] Write failing E2E `packages/ui/tests/e2e/editor-external-change-named.e2e.ts`: with two editors on different files, an external change to one shows a notice naming that tab, panel, and full path (not generic).
- [x] T028 [US4] In the `onSync` `externalChange` branch, build the `EditorNotice.files` entry (split full path -> dir/name; note = panel title + containing tab title, tab resolved locally from `ws.layout.tabs`) instead of the generic message, in `packages/ui/src/renderer/editor/use-editor.ts` (notice call-site ONLY; minimal diff — 012 rebases this file).
- [x] T029 [US4] Run `npm run test:integration -- editor-external-change` and `npm run test:e2e -- editor-external-change-named`; confirm Green.

**Checkpoint**: file-changed warning is specific; `use-editor.ts` diff is a few lines.

---

## Phase 6: User Story 5 — Pulsing unsaved dot (Priority: P5)

**Goal**: The shared unsaved dot pulses ~1.5s (never invisible), in step across all three sites, stops on save, static under reduced motion.

**Independent Test**: Unsaved edit -> dot pulses in all three sites, min opacity > 0; save -> gone; reduced-motion -> static full opacity.

- [x] T030 [P] [US5] Write failing E2E `packages/ui/tests/e2e/unsaved-dot-pulse.e2e.ts`: the dot in projects/tab/panel carries the pulse animation and min opacity > 0; saving removes it; with reduced-motion emulated the dot is static at full opacity (no animation).
- [x] T031 [US5] Add `@keyframes throng-unsaved-pulse` (opacity 1 -> ~0.4 -> 1, ~1.5s infinite) on `.throng-unsaved-dot`, plus a `@media (prefers-reduced-motion: reduce)` block pinning `animation: none; opacity: 1`, in `packages/ui/src/renderer/theme.css`.
- [x] T032 [US5] Run `npm run test:e2e -- unsaved-dot-pulse`; confirm Green.

**Checkpoint**: dot pulses, synchronised, reduced-motion honoured.

---

## Phase 7: User Story 1 (logic slice) — Terminal Clear / exit-notice decoupling (Priority: P1, 009-independent)

**Goal**: Clear resets only the form fields; the exit notice can be dismissed independently at the store level (glyph rendering is Phase 8). Fixes the "Clear also clears the error" and "persists until re-typed" bugs.

**Independent Test (store-level)**: Clear leaves the exit record (notice stays); a dismiss call hides the notice and leaves typed draft values intact; dismissing never blanks the form.

- [x] T033 [P] [US1] Write failing unit test (jsdom) extending `packages/ui/tests/unit/panel-type-form.test.ts`: Clear resets the draft only and LEAVES a visible exit notice visible; dismissing the exit (store `dismissPanelExit`) hides the notice and leaves typed draft values intact; the form stays usable (a type can still be selected + confirmed).
- [x] T034 [US1] Add a per-panel `dismissed` signal + `dismissPanelExit(panelId)` (and reset on a fresh exit record so recurrence re-shows) in `packages/ui/src/renderer/terminal/exit-store.ts`; keep `getPanelExit`/`clearPanelExit` intact.
- [x] T035 [US1] In `packages/ui/src/renderer/panel-type/panel-type-form.tsx`: make the Clear handler reset ONLY the draft (remove the `clearPanelExit` call from Clear), and gate the exit-notice render on `exit exists AND not dismissed`. Leave `onConfirm` clearing the exit record (panel becomes typed). Do NOT yet add the dismiss icon control (Phase 8).
- [x] T036 [US1] Run `npm run test:unit -- panel-type-form`; confirm Clear/dismiss independence passes (Green).

**Checkpoint**: Clear and exit-dismissal are independent at the logic level; notice no longer persists until re-type. Only the rendered dismiss control remains (Phase 8).

---

## Phase 8: User Story 1 (render slice) — Dismiss-icon controls (Priority: P1, ⛔ 009-BLOCKED — STOP HERE)

**Goal**: Render the trailing-edge themeable `dismiss` icon in all four error surfaces; each removes its error immediately; recurrence re-shows.

> ⛔ **STOP at T037 and report.** These tasks render `resolveIcon(theme, 'dismiss')`, whose token is owned by `009-theme-content`. Do not add the token, do not fall back to `destroy`, do not stub. After the coordinator rebases 011 onto a `master` containing 009, resume T037–T042 and run the FULL suite.

- [x] T037 [P] [US1] Write failing E2E `packages/ui/tests/e2e/error-dismiss.e2e.ts`: each of the four surfaces (Projects, File Explorer, terminal exit notice, sub-workspaces) shows a trailing-edge dismiss control; activating it removes the error **immediately** (no focus change / re-render trigger); re-triggering the same error re-shows it. (Expected to fail until the token + controls land.)
- [x] T038 [US1] Render a trailing-edge themeable dismiss icon (`resolveIcon(theme,'dismiss')`, hover title, theme-token colours) on the Projects error and wire its click to clear the error state immediately (add a `clearError` to `packages/ui/src/renderer/state/projects-store.tsx` if absent) — surface in `packages/ui/src/renderer/sidebar/projects-panel.tsx`.
- [x] T039 [US1] Render the trailing-edge themeable dismiss icon on the File Explorer error and wire immediate clear in `packages/ui/src/renderer/explorer/file-tree.tsx`.
- [x] T040 [US1] Render the trailing-edge themeable dismiss icon on the terminal exit notice, wired to `dismissPanelExit`, in `packages/ui/src/renderer/panel-type/panel-type-form.tsx` (leaves typed draft intact; form stays usable).
- [x] T041 [US1] Convert the sub-workspaces error dismiss control from the literal `✕` text glyph to the themeable `dismiss` icon (behaviour unchanged) in `packages/ui/src/renderer/sidebar/subworkspaces-panel.tsx`.
- [x] T042 [US1] Run `npm run test:e2e -- error-dismiss`; confirm all four surfaces dismiss immediately + recur (Green).

---

## Phase 9: Polish & Cross-Cutting (post-009 rebase)

- [x] T043 [P] Documentation currency: reconcile README/CONTRIBUTING/ROADMAP for the new starting-folder setting and the removal-verb wording (Constitution doc-currency rule).
- [x] T044 Run the FULL suite: `npm run test:unit && npm run test:integration && npm run test:e2e`; confirm Green including the `dismiss` glyph E2E.
- [x] T045 Run `quickstart.md` validation + a manual `npm start` smoke of all five defects + the new setting (including reduced-motion and the "Clear does not clear the error" checks).
- [x] T046 Confirm the `use-editor.ts` and `panel-placeholder.tsx` diffs are minimal and well-tested for a clean `012` rebase.

---

## Dependencies & Execution Order

- **Phase 1 (Setup)** -> **Phase 2 (core config)** blocks US2's label reliance and all of US3.
- **Phases 3–6 (US2, US3, US4, US5)** are independent of each other and of 009; run in any order after Phase 2. All go Green before Phase 8.
- **Phase 7 (US1 logic)** is independent of 009 and of Phases 3–6.
- **Phase 8 (US1 render)** depends on `009-theme-content` (the `dismiss` token). ⛔ STOP at T037; resume after rebase.
- **Phase 9 (Polish)** after Phase 8, post-rebase.

### File-conflict notes

- `settings-metadata.ts` is edited once (T008) covering both US2 labels and US3 descriptors — not parallel with itself.
- `projects-panel.tsx` is touched by US2 (T012), US3 (T022/T023), and US1 render (T038) — sequence those, not parallel.
- `panel-type-form.tsx` is touched by US1 logic (T035) then US1 render (T040) — sequential.

### Parallel opportunities

- T002/T003 (different test files), T006/T007 (different core files).
- T011/T013/T014 (different renderer files) within US2.
- T017/T018 and T021 within US3.
- T026/T027 within US4.

---

## Implementation Strategy

**Pre-009 increment (this session).** Complete Phases 1–7 fully and Green: all four non-dismiss defects, the new setting, and the terminal Clear/exit decoupling. This is a shippable, independently-testable slice that fixes four of the five defects and adds the setting. Then reach Phase 8, **STOP at T037**, and report for the 009 rebase.

**Post-009 increment.** After the coordinator rebases onto a `master` with 009: complete Phase 8 (dismiss glyph in all four surfaces) and Phase 9 (docs + full suite + manual smoke). Only then claim the suite Green.

---

## Phase 10: Convergence

Appended by `/speckit-converge` after assessing the implemented code against `spec.md`/`plan.md`.
Everything in the five user stories and FR-001–043, FR-045, FR-051–052 is implemented and
E2E-verified. The items below are the remaining gaps; they are **not** blockers for this feature's
delivered slice.

- [ ] T047 Flag an unresolvable override in the settings editor per FR-044 (partial) — add a main-side path-resolvability check (exists + is-directory), surface the result to the preferences form, and render a warning on the `newProject.overridePath` `folder` control when the current value does not resolve. `isOverrideResolvable` is already implemented/exported. **Documented handoff to feature `015-preferences-and-settings`** (owns `preferences/**`); do here only if 011 is chosen to absorb it.
- [ ] T048 Convert the three reworded main-window removal `✕` text glyphs to themeable `destroy` icons per FR-050 (partial, LOW) — `projects-panel.tsx`, `subworkspaces-panel.tsx`, `panel-placeholder.tsx`. These controls predate this feature (only their tooltips/verbs changed in US2); a strict reading of FR-050 ("new or altered … control") wants themeable icons, code review deemed the current state defensible. Behaviour unchanged.
