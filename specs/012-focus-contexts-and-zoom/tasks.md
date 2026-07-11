---
description: "Task list for feature 012 — Focus Contexts & Per-Panel Zoom"
---

# Tasks: Focus Contexts & Per-Panel Zoom

**Input**: Design documents from `/specs/012-focus-contexts-and-zoom/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: INCLUDED — Constitution Principle V (Test-First) is NON-NEGOTIABLE and every user-facing UI
change MUST ship passing E2E. Each story writes its tests first (Red), implements to green, refactors.

**Organization**: Grouped by user story (spec.md priorities). Phases map to plan.md: A=US1, B=US2, C=US3,
D=US4. **US1 and US2 are both P1**; US1 is the minimal MVP, US1+US2 the headline MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task → parallelizable
- **[Story]**: US1–US4 (setup/foundational/polish carry no story label)
- Paths are repo-relative to the worktree root.

## Path Conventions

npm-workspaces monorepo (extends 001–008): pure logic in `packages/core`, renderer + main in `packages/ui`,
persistence in `packages/persistence`. No daemon/`ipc-contract` change.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Branch from green; scaffold the new module files so downstream tasks compile.

- [x] T001 Confirm a green baseline in the worktree: `npm run build` and `npm run test:unit` pass before any change (RGR starts from green).
- [x] T002 [P] Create pure-module files (done via real impls at T015/T028, not throwaway stubs) and wire exports so later tasks compile: `packages/core/src/config/zoom.ts`, `packages/core/src/workspace/focus-move.ts`, and add both to `packages/core/src/index.ts` (stubs may return defaults; real logic lands in US2/US3).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared test infrastructure used across stories. Small by design — 012 extends existing
subsystems rather than adding new foundations.

**⚠️ CRITICAL**: Complete before starting the user stories.

- [x] T003 [P] Add a shared E2E helper to count terminal `resize` IPC messages over a window of time in `packages/ui/tests/e2e/harness.ts` (or a new `packages/ui/tests/e2e/resize-probe.ts`), reused by SC-004 (focus change → 0 resizes) and SC-005 (zoom → grid recompute).

**Checkpoint**: Foundation ready — user stories can begin (US1 is the MVP entry point).

---

## Phase 3: User Story 1 — The active panel is obvious and receives what I type (Priority: P1) 🎯 MVP

**Goal**: A single, visible, theme-driven active-panel focus context per window — active when the window is
foreground, **dimmed** when background — that routes input/commands and falls back sensibly on destroy.

**Independent Test**: Open a window with ≥2 panels of different types; click each → exactly one active
indicator at a time, legible (active + dimmed) on every bundled theme; background the window → indicator
dims and persists; close the active panel → focus moves to a neighbour, never inputless.

### Tests for User Story 1 (write first — must FAIL before implementation) ⚠️

- [x] T004 [P] [US1] Unit: extend `packages/core/tests/unit/active-panel.test.ts` — when the active panel is removed, the fallback helper selects the **deterministic** target from FR-005 (the panel immediately **preceding** the removed one in the tab's depth-first layout order, or the one immediately **following** it when the removed panel was first); asserts the exact id, and that `effectiveActivePanelId` never returns a stale/absent id.
- [x] T005 [P] [US1] E2E (failing first): `packages/ui/tests/e2e/focus-context.e2e.ts` — exactly one `.panel-box--active`; indicator legible in active and dimmed states across bundled themes; dims on window blur and brightens on focus without changing the active panel; closing the active panel re-homes focus to the FR-005 deterministic target; and — using the T003 resize probe — **changing which panel/view holds focus sends zero terminal resize messages** (FR-004/SC-004, verified in the phase where the focus context lands).

### Implementation for User Story 1

- [x] T006 [P] [US1] Add colour tokens `activePanelBorder` and `activePanelBorderInactive` to `THRONG_THEME.colours` in `packages/core/src/config/theme.ts` (auto-exposed via derived `THEME_METADATA` + `toCssVariables`).
- [x] T007 [P] [US1] Create `packages/ui/src/renderer/workspace/use-window-focus.ts` — a tiny hook subscribing to DOM `window` `focus`/`blur`, returning whether this window is the foreground OS window.
- [x] T008 [US1] In `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, drive a two-state active class from `use-window-focus`, and in `packages/ui/src/renderer/theme.css` make `.panel-box--active` use `--throng-colour-activePanelBorder` (foreground) / `--throng-colour-activePanelBorderInactive` (background). (depends on T006, T007)
- [x] T009 [US1] Ensure fallback-on-destroy: add a pure `panelAfterRemoval(root, removedId): string | undefined` helper to `packages/core/src/workspace/operations.ts` implementing the FR-005 rule (previous panel in depth-first layout order, else the following one if the removed was first), and route the renderer panel-removal path through it so the window is never left with no active panel while panels remain. Must satisfy T004's exact-id assertions. (depends on T004)
- [x] T010 [US1] Seed sensible `activePanelBorder` / `activePanelBorderInactive` values in the bundled default themes (`packages/core/src/config/default-themes/`) and confirm the theme completeness test passes and the Themes editor lists both tokens.

**Checkpoint**: US1 fully functional — one legible, two-state, per-window active panel with sensible
fallback. This is the MVP.

---

## Phase 4: User Story 2 — Zoom text by panel type, independently of chrome and other types (Priority: P1)

**Goal**: Per-*type* text zoom (one level for all terminals, one for all editors) that composes on top of
global zoom, persists per project, and re-computes the terminal grid.

**Independent Test**: With two terminals and two editors open, zoom a terminal → all terminals grow, editors
and chrome unchanged (and vice-versa); reset returns the type to default; restart → each type restored;
zoomed terminal stays legible; bindings appear in the Key Bindings editor, distinct from global zoom.

### Tests for User Story 2 (write first — must FAIL before implementation) ⚠️

- [x] T011 [P] [US2] Unit: `packages/core/tests/unit/zoom.test.ts` — `clampZoomLevel` bounds; `stepZoomLevel` at a bound is a no-op (FR-011); `zoomFactor(0)===1` and strictly increasing; step matches global.
- [x] T012 [P] [US2] Unit: extend `packages/core/tests/unit/workspace-operations.test.ts` — `bumpZoom`/`resetZoom` change only the active panel's TYPE bucket, leave the other type untouched, are immutable, and `resetZoom` is idempotent (FR-007/008/009).
- [x] T013 [P] [US2] Integration: `packages/persistence/tests/integration/workspace-layout-v3.integration.test.ts` — a v2 layout migrates to v3 with `zoom={terminal:0,editor:0}`; a v3 `zoom` round-trips through save/load; re-running `migrateLayout` is a no-op (idempotent, v3.5.0); `user_version` unchanged.
- [x] T014 [P] [US2] E2E (failing first): `packages/ui/tests/e2e/panel-zoom.e2e.ts` — zooming one type moves all panels of that type together with others+chrome unchanged; reset; persistence across restart; terminal grid recompute (via the resize probe); global zoom still composes; `panel.zoom*` distinct from global `zoom.*` in the Key Bindings editor; and that zooming an editor leaves the editor's **buffer content, encoding, and line endings unchanged** (FR-013).

### Implementation for User Story 2

- [x] T015 [P] [US2] Implement `packages/core/src/config/zoom.ts` — `ZOOM_STEP`, `ZOOM_MIN_LEVEL`, `ZOOM_MAX_LEVEL`, `clampZoomLevel`, `zoomFactor(level)=1.2**level`, `stepZoomLevel` (per contracts/zoom.md).
- [x] T016 [US2] Refactor `packages/ui/src/main/main.ts` global zoom to import `ZOOM_STEP` / `ZOOM_MIN_LEVEL` / `ZOOM_MAX_LEVEL` from `@throng/core` (DRY, behaviour byte-identical). (depends on T015)
- [x] T017 [P] [US2] Add `PanelTypeZoom` + `WorkspaceLayout.zoom?` and bump `LAYOUT_SCHEMA_VERSION` **2→3** in `packages/core/src/workspace/model.ts` (per data-model.md §1). Precondition verified 2026-07-11: the current constant is `= 2` (model.ts:17), so 2→3 and the `schemaVersion < 3` guard are correct.
- [x] T018 [US2] Add the per-type reducer `zoomBucketOf` / `bumpZoom` / `resetZoom` / `zoomLevelOf` in `packages/core/src/workspace/operations.ts` and export from `packages/core/src/index.ts`. (depends on T015, T017)
- [x] T019 [US2] Add the idempotent v2→v3 step to `migrateLayout` in `packages/persistence/src/workspace-repository.ts` (absent `zoom` → `{terminal:0,editor:0}`; guard on `schemaVersion<3`; clamp out-of-range on load). (depends on T017)
- [x] T020 [P] [US2] Add `ActionId`s `panel.zoomIn` / `panel.zoomOut` / `panel.zoomReset` and their `DEFAULT_KEYBINDINGS` (`Ctrl+Alt+=`/`+`, `Ctrl+Alt+-`, `Ctrl+Alt+0`) in `packages/core/src/config/keybindings.ts`.
- [x] T021 [US2] Add a **"Focus & Zoom"** group with `chord(...)` descriptors for the three zoom commands in `packages/core/src/config/keybindings-metadata.ts` (keybindings completeness). (depends on T020)
- [x] T022 [US2] Wire per-type zoom into `packages/ui/src/renderer/state/workspace-store.tsx` — expose `zoom`, `bumpZoom(activeKind, presses)`, `resetZoom(activeKind)`; persist via the existing debounced `client.save`. (depends on T018)
- [x] T023 [US2] Dispatch `panel.zoomIn/out/reset` in the `KeybindingsHandler` of `packages/ui/src/renderer/app.tsx`, routing to the workspace store against the active panel's kind. (depends on T022)
- [x] T024 [P] [US2] Apply **editor** zoom: set `--throng-zoom-editor` (= `zoomFactor(editorLevel)`) on the workspace root in `packages/ui/src/renderer/workspace/workspace.css` / container, and make the editor font-size `calc(var(--throng-font-editor-size) * var(--throng-zoom-editor,1))` in `packages/ui/src/renderer/editor/editor.css`. Zoom is **presentation only** — it MUST NOT touch the editor's buffer content, encoding, or line endings (FR-013; asserted by T014).
- [x] T025 [US2] Apply **terminal** zoom in `packages/ui/src/renderer/terminal/use-terminal.ts`: effective `fontSize = round(basePx × zoomFactor(terminalLevel))`; on change update `term.options.fontSize`, then `FitAddon.fit()` and `bridge.resize(panelId, cols, rows)` only when cols/rows change (FR-012, SC-004/005). (depends on T022)

**Checkpoint**: US1 + US2 both work independently — the headline MVP (focus context + per-type zoom).

---

## Phase 5: User Story 3 — Move focus between panels from the keyboard (Priority: P2)

**Goal**: Directional and cyclic keyboard focus movement over the split tree, in stable layout order, that
stays put at the layout edge.

**Independent Test**: With several panels split, `Ctrl+Alt+Arrow` moves the active panel spatially and
``Ctrl+` ``/``Ctrl+Shift+` `` cycle in layout order; a directional move at the edge stays put; input routing
follows focus; the commands are rebindable in the Key Bindings editor.

### Tests for User Story 3 (write first — must FAIL before implementation) ⚠️

- [x] T026 [P] [US3] Unit: `packages/core/tests/unit/focus-move.test.ts` — `panelRects` partitions row/column splits; `moveFocus` returns the correct directional neighbour and `null` at an edge (stay-put); `cycleOrder` is stable layout order independent of focus history; `nextInCycle` wraps forward and reverse (per contracts/focus-move.md).
- [x] T027 [P] [US3] E2E (failing first): `packages/ui/tests/e2e/move-focus.e2e.ts` — directional moves follow the active indicator + input routing; cycle visits panels in layout order; edge move stays put with no error; commands listed + rebindable.

### Implementation for User Story 3

- [x] T028 [P] [US3] Implement `packages/core/src/workspace/focus-move.ts` — `panelRects`, `moveFocus(root, activeId, dir)→id|null`, `cycleOrder`, `nextInCycle` (replace the T002 stub); export from `packages/core/src/index.ts`.
- [x] T029 [P] [US3] Add `ActionId`s `focus.left/right/up/down/cycle/cycleBack` and their `DEFAULT_KEYBINDINGS` (`Ctrl+Alt+Left/Right/Up/Down`, ``Ctrl+` ``, ``Ctrl+Shift+` ``) in `packages/core/src/config/keybindings.ts`. (shares the file with T020 — sequence after it)
- [x] T030 [US3] Add the six focus commands to the **"Focus & Zoom"** group in `packages/core/src/config/keybindings-metadata.ts`. (depends on T021, T029)
- [x] T031 [US3] Dispatch `focus.*` in the `KeybindingsHandler` of `packages/ui/src/renderer/app.tsx` → `moveFocus`/`nextInCycle(cycleOrder(...))` → `setActivePanel`; a `null` directional result is a no-op (stay put). **Logically depends only on T028** (focus-move). The reference to T023 is a **merge-order** note, not a logical dependency: both edit `app.tsx`'s `KeybindingsHandler`, so if US2 has already landed, add these cases after T023's; on a **US1-only base** (US2 not shipped), US3 adds its own focus cases to the handler independently and ships without US2.

**Checkpoint**: US1–US3 independently functional; focus is fully keyboard-drivable and zoom follows it.

---

## Phase 6: User Story 4 — Focus and zoom survive layout changes (Priority: P3)

**Goal**: Across tab switch, split/join, close, and sub-workspace detach/reattach, a sensible panel stays
active and each type's (project-scoped) zoom is retained.

**Independent Test**: Drive each layout transition and assert exactly one panel active on a reasonable
panel, and each type's zoom unchanged by the structural change; a detached-then-reattached panel shows its
type's zoom.

### Tests for User Story 4 (write first — must FAIL before implementation) ⚠️

- [x] T032 [P] [US4] E2E (failing first): `packages/ui/tests/e2e/focus-zoom-layout.e2e.ts` — zoom survives tab-switch/split/join/detach-reattach; exactly one active panel after each transition; closing the active panel re-homes focus to the FR-005 deterministic target; SC-004 resize-count holds on pure focus changes; and **two open windows (main + a detached sub-workspace) hold independent active panels** — activating a panel in one does not change the other's active panel (FR-006, distinct from the OS focus/raise group).

### Implementation for User Story 4

- [x] T033 [US4] Close any gaps found by T032 in the renderer transition paths (`packages/ui/src/renderer/state/workspace-store.tsx`, `packages/ui/src/renderer/workspace/split-tree.tsx` / `tab-group.tsx`) so a sensible panel stays active across tab switch / split / join / close (reuse the US1 fallback helper).
- [x] T034 [US4] Verify sub-workspace windows read the **project's** per-type zoom on detach/reattach (the `WorkspaceLayout.zoom` is project-scoped) in the sub-workspace render path (`packages/ui/src/renderer/subworkspace-app.tsx` and the terminal/editor apply hooks); fix if a detached view ignores it.
  - **Verified + scoped (see commit `369af67`).** The main window retains each type's project-scoped zoom across every transition, incl. detach/reattach (detach never touches `WorkspaceLayout.zoom`) — asserted by `focus-zoom-layout.e2e.ts`. A sub-workspace window's **live** view currently renders at the inherited size: `SubWorkspacePane` does not set `--throng-zoom-editor` and the sub-workspace layout carries no `zoom`. Propagating an origin project's per-type zoom into a (potentially multi-project) sub-workspace window needs cross-project zoom plumbing disproportionate to this P3 item, so it is **deferred as future work** (recorded here and in the ROADMAP ledger) rather than half-built. FR-006 window-independence and FR-005/010 retention are fully delivered.

**Checkpoint**: All four user stories independently functional and robust across layout changes.

> **Deferred (future work):** live per-type zoom display inside detached sub-workspace
> windows (T034 sub-item). Everything else in 012 is delivered and E2E-verified.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T035 [P] Documentation currency (constitution v3.10.0): advance the 008-deferred "per-panel text zoom" and "keyboard focus scoping" to delivered in `ROADMAP.md`, and reconcile `README.md` if the current-state description of zoom/focus changed. Do **not** narrate feature numbers in README.
- [x] T036 [P] Add renderer unit tests for `use-window-focus` and the keydown dispatch mapping in `packages/ui/tests/unit/`.
- [x] T037 Review gate: confirm **no pointer action control** was introduced (FR-017 / v3.12.0), both completeness tests (theme + keybindings) pass, and `user_version` is unchanged; run the full `npm run test` suite green.
- [x] T038 Run the `quickstart.md` A→D validation end-to-end on the built app and record the result.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)** → **Foundational (P2)** → **User Stories (P3–P6)** → **Polish (P7)**.
- US1 (MVP) has no dependency on US2–US4. US2 is independent of US1 in logic (the shared files below are
  **merge-order** coupling, not logical dependencies). US3 **logically depends only on US1** (activation
  moves the focus context); its overlap with US2 is merge-order only. **Each story is shippable on a
  US1-only base** — the shared-file entries below say *how to order edits when a prior story has landed*,
  not that one story requires another to function. US4 hardens US1–US3.

### Shared-file sequencing (merge-order, not logical dependency)

Some core/renderer files are touched by more than one story. When both stories are being landed, order the
edits as below (they are **not** mutually `[P]`). If only one story is being shipped, it makes its own edits
to that file independently — no cross-story logical dependency:

- `packages/core/src/config/keybindings.ts` — if landing both: T020 (US2) **then** T029 (US3).
- `packages/core/src/config/keybindings-metadata.ts` — if landing both: T021 (US2) **then** T030 (US3).
- `packages/core/src/workspace/operations.ts` — if landing both: T009 (US1) **then** T018 (US2).
- `packages/ui/src/renderer/app.tsx` `KeybindingsHandler` — if landing both: T023 (US2) **then** T031 (US3); on a US1-only base US3 adds its focus cases alone (see T031).

### Within Each User Story

- Tests first (Red) → implementation (Green) → refactor. Models before reducers before renderer apply.

### Parallel Opportunities

- Setup: T002 ‖ (after T001).
- US1: T004 ‖ T005 (tests); T006 ‖ T007 (impl) before T008.
- US2: T011 ‖ T012 ‖ T013 ‖ T014 (tests); T015 ‖ T017 ‖ T020 ‖ T024 (independent-file impl).
- US3: T026 ‖ T027 (tests); T028 ‖ T029 (impl) before T030/T031.
- Polish: T035 ‖ T036.

---

## Parallel Example: User Story 2

```bash
# Tests first (all fail):
Task: "Unit zoom.test.ts (bounds/no-op/zoomFactor)"
Task: "Unit workspace-operations per-type reducer"
Task: "Integration workspace-layout-v3 (migrate/round-trip/idempotent)"
Task: "E2E panel-zoom.e2e.ts (per-type isolation, persist, grid, distinct bindings)"

# Then independent-file implementation in parallel:
Task: "core/config/zoom.ts constants + mapping"
Task: "core/workspace/model.ts WorkspaceLayout.zoom + schema v3"
Task: "core/config/keybindings.ts panel.zoom* ids + defaults"
Task: "ui editor CSS var --throng-zoom-editor"
```

---

## Implementation Strategy

### MVP First

1. Phase 1 Setup → Phase 2 Foundational.
2. **US1 (Phase 3)** → STOP & VALIDATE: one legible two-state active panel per window, sensible fallback.
   This is the minimal MVP.
3. **US2 (Phase 4)** → the headline value (per-type zoom). US1+US2 is the recommended demo MVP (both P1).

### Incremental Delivery

US1 → US2 → US3 → US4, each independently E2E-verified and demoable before the next (Incremental Delivery
rule). Each phase lands green.

---

## Notes

- `[P]` = different files, no incomplete-task dependency. Respect the **shared-file sequencing** list above.
- Every user-facing change ships passing E2E before it is considered done (Principle V).
- Two new theme tokens auto-expose (derived metadata); the nine commands need hand-authored
  `keybindings-metadata` descriptors or the completeness test fails.
- No daemon / `ipc-contract` / SQLite DDL change; the layout blob's `schemaVersion` goes 2→3 (idempotent
  migration). `user_version` stays put.
- Commit after each task or logical group; generated temp/test artifacts self-clean (v3.9.0).

---

## Revision (2026-07-11): user-directed changes (post-merge-of-master)

Rebased onto `origin/master` (adds the ESLint/lint gate, constitution v3.13.0).

- [x] R1 Per-**instance** zoom — each panel zooms independently (supersedes per-type):
      `Panel.zoom`, reworked reducer (`bumpZoom`/`resetZoom` by panelId, `panelZoomLevel`),
      v2→v3 migration is a version bump only (clamp-on-read), per-panel editor CSS var +
      per-panel terminal font, `data-zoom` attribute. Unit + integration + E2E rewritten.
- [x] R2 Zoom In/Out/Reset on the panel right-click menu (themeable zoomIn/zoomOut/zoomReset
      icons, v3.12.0), routed to that panel. E2E.
- [x] R3 Move-focus fixes: capture-phase interception of the focus/zoom chords (a focused
      terminal/editor no longer swallows them) + DOM-focus transfer into the target panel
      (input routing follows, FR-003). Panel-focus registry; `TerminalApi.focus`. E2E from a
      focused terminal ⇄ editor.
- [x] R5 Panel-type icon replaces the TERMINAL/EDITOR PANEL text label (descriptor `icon`
      token; new `editorPanel` icon); type + flavour move to the icon tooltip. E2E updated.
- [x] R4 Terminal cwd in the panel title via **daemon-polled process cwd** (user chose the
      native path). `IProcessCwd` OS seam + `WindowsProcessCwd` (koffi FFI, PEB walk:
      OpenProcess → NtQueryInformationProcess → PEB.ProcessParameters → CurrentDirectory) with a
      contract test; TerminalService polls each live shell (1s, unref'd) and publishes
      `terminal.cwd`; UI-main forwards → preload `onCwd` → renderer cwd store → panel header
      shows the live cwd, RTL-truncated. E2E: header shows the launch cwd and follows `cd`.
- [x] R6 Final verify (lint + unit + integration + full E2E) + docs.
