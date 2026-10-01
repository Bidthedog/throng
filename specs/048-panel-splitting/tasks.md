---

description: "Task list for 048 Panel Splitting and Content-Derived Panel Titles"
---

# Tasks: Panel Splitting and Content-Derived Panel Titles

**Input**: Design documents from `specs/048-panel-splitting/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R11), data-model.md, contracts/menus-commands-controls.md

**Tests**: Mandatory — constitution Principle V (test-first, lowest layer). Every implementation task is
preceded by its failing test task; run it, read why it fails, then implement. New E2E specs are
`@extended` plus a category tag, each names the Principle V reserve entry that makes it irreducible (a
real OS ghost window, a real shell, a restart, a second window), and each commit that adds or removes a
spec re-seeds `ui/tests/e2e/e2e-budget.json`. Menus, rename surfaces and preview scroll are asserted at
the component layer: Principle V reserves E2E for what no lower layer can observe.

**Organization**: grouped by user story (spec.md). Paths are repository-relative. `core` =
`packages/core`, `ui` = `packages/ui`, `daemon` = `packages/daemon`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task
- **[Story]**: US1–US6 as in spec.md

---

## Phase 1: Setup

- [x] T001 Confirm the baseline before any change: `npm run build`, `npm run lint`, `npm run typecheck`, `npm run test:unit` green at the branch base (recorded in the autopilot ledger); no code change

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: the split tree op, the four commands, the terminal-tier validator, the shared Split menu
builder and the one window dispatcher (#275) every story leans on.

### Split operation (R1)

- [x] T002 [P] Write failing unit tests for `splitPanel(layout, tabId, targetPanelId, direction, title)` in `core/tests/unit/workspace-operations-048.test.ts`: each of `down｜up｜right｜left` replaces only the target leaf with a 2-child split (column for down/up, row for right/left), new placeholder on the named side, sizes `[0.5, 0.5]`; the other three panels of a 2x2 keep identical nodes and sizes (SC-002); nested and single-row layouts; the new panel has no `zoom` while a zoomed target keeps its own (FR-004); the tab's `activePanelId` becomes the new panel; unknown tab or panel → layout unchanged; the target keeps its `kind` and `config` unchanged (a parented preview stays parented, Find in Files stays Find in Files — Edge Cases)
- [x] T003 Implement `splitPanel` over the private `insertAtEdge`/`makePanel` in `core/src/workspace/operations.ts`; export it from `core/src/index.ts`

### Commands and tier validation (R4, data-model *Keybinding actions*)

- [x] T004 Write failing core tests in `core/tests/unit/keybindings-048.test.ts`: actions `panel.splitDown｜Up｜Right｜Left` exist with scope `EVERYWHERE` and Windows defaults exactly `Ctrl+Shift+Alt+End,ArrowDown`, `Ctrl+Shift+Alt+End,ArrowUp`, `Ctrl+Shift+Alt+End,ArrowRight`, `Ctrl+Shift+Alt+End,ArrowLeft`; each has a metadata label ("Split Down" …) and description; no default collides with another; `twoStrokeTerminalViolations` accepts them (first stroke tier 1, not reserved) and still rejects a terminal-live `Ctrl+E,W`-style token whose first stroke is reserved; `parseKeybindings` keeps a user's multi-stroke override of `panel.splitDown` and still drops one whose first stroke is reserved
- [x] T005 Add the four actions to the `ActionId` union, `COMMAND_SCOPES` and `WINDOWS_BINDINGS`, and narrow `twoStrokeTerminalViolations` and `parseKeybindings`'s multi-stroke rule to one shared "first stroke in the reserved tier" predicate, in `core/src/config/keybindings.ts`; add metadata rows in the panel-commands group of `core/src/config/keybindings-metadata.ts`
- [x] T006 Extend `ACTION_TIER` (tier 1, multi-stroke) in `core/tests/unit/keybindings-tiers.test.ts`, the new-commands pin in `core/tests/unit/keybindings-scope.test.ts`, and the split rows in `core/tests/unit/terminal-reserved-keys.test.ts`; bump `SHIPPED_DEFAULTS_VERSION` in `core/src/config/shipped-defaults.ts` only if its tests require an entry for the added defaults

### ChordEngine modifier policy (R4)

- [x] T007 Write failing unit tests in `ui/tests/unit/chord-engine-policy.test.ts`: with `modifierPolicy: 'released-ok'` a released first-stroke modifier does NOT end the prefix and `matchNext` receives the key; with the default `'carried'` behaviour is unchanged (existing `chord-engine` tests stay green)
- [x] T008 Add `modifierPolicy?: 'carried' | 'released-ok'` (default `'carried'`) to `ChordEngine` in `ui/src/renderer/keybindings/chord-engine.ts`, gating `holdsCarried`/`keyup` release handling; add the `'unavailable'` member to `ChordIndicator.kind`

### One window dispatcher (R5, #275, FR-090–FR-093)

- [x] T009 Write failing component tests in `ui/tests/component/window-dispatcher.test.ts`: mounted with `kind: 'main'` it resolves every `WINDOW_HANDLED_ACTIONS` chord as `app.tsx`'s `KeybindingsHandler` does today (reuse `tests/shared/window-chords.ts`); mounted with `kind: 'sub-workspace'` the same chords resolve to the same commands (SC-012), Quick Open / Go To Line / Back-Forward act as today (FR-093), and each unavailable command (exactly `project.next`, `project.previous`, `focus.projects`, `focus.explorer`, `view.toggleProjects`, `view.toggleExplorer`, `file.undo`, `file.redo`, `search.findInFiles`, `search.replaceInFiles`, `focus.notice` — every other `WINDOW_HANDLED_ACTIONS` member acts in a sub-workspace window) is consumed (`defaultPrevented`, never reaches a terminal) and raises the `unavailable` indicator "*Label* is not available in a sub-workspace window." (FR-092)
- [x] T010 Extract `KeybindingsHandler` from `ui/src/renderer/app.tsx` into `ui/src/renderer/keybindings/window-dispatcher.tsx` taking `WindowCapabilities { kind; has(action) }`; move Quick Open / Go To Line / Back-Forward handling into it; mount it in `app.tsx` (main) and `ui/src/renderer/subworkspace-app.tsx` (sub-workspace); delete the sub-workspace `keydown` listener in `ui/src/renderer/navigate/navigation-chrome.tsx:245-304`
- [x] T011 Render the `unavailable` indicator text in `ui/src/renderer/editor/pending-chord.tsx` (store + copy), with `UNBOUND_NOTICE_MS` lifetime; update `ui/tests/component/window-handled-actions.test.ts` for the moved module

### Shared Split menu (R3)

- [x] T012 [P] Write failing unit tests in `ui/tests/unit/split-menu.test.ts`: `splitSubmenu(panelId, keybindings, run)` returns one `MenuAction` labelled "Split", `section: 'create'`, children Split Down, Split Up, Split Right, Split Left in that order, each with `shortcut` naming its command and the rebound chord when rebound (US2 scenario 3); `splitMenuItems(...)` returns the four children alone for the **+** menu
- [x] T013 Implement `splitSubmenu` and `splitMenuItems` in `ui/src/renderer/workspace/split-menu.ts`
- [x] T014 Add `splitPanel(tabId, panelId, direction)` to the workspace store in `ui/src/renderer/state/workspace-store.tsx` (title from the existing `Panel ${totalPanels + 1}` formula, made unique by `panel-name-sync.tsx` as for every added panel; after apply, `requestPanelFocus(newId)`), with a component test in `ui/tests/component/workspace-store-split.test.ts` that the new panel is active and receives focus (FR-002)

**Checkpoint**: split op, commands, dispatcher and menu builder exist; no user-facing surface changed yet.

---

## Phase 3: User Story 1 — Split a panel from its **+** button (P1) 🎯 MVP

**Goal**: **+** opens a four-way split menu that splits its own panel.

**Independent Test**: 2x2 layout; bottom-left **+** → each direction (undo between); new panel on that side
inside the quadrant, focused; other three untouched.

- [x] T015 [US1] Write failing component tests in `ui/tests/component/panel-split-menu.test.ts`: clicking `panel-add-<id>` opens a menu of Split Down/Up/Right/Left with chords and adds nothing (FR-010); choosing Split Right divides that panel left/right with the new panel right and focused; Escape and outside click close it with the layout unchanged; clicking **+** on an inactive panel in a non-active context makes that panel active in **its own tab** before the split (FR-011); Enter/Space on the focused button opens it and arrow keys + Enter choose (FR-012); hover title "Split panel…" and `aria-haspopup="menu"` (FR-014); no rename box appears (FR-002)
- [x] T016 [US1] Replace the **+** handler in `ui/src/renderer/workspace/panel-placeholder.tsx:1066-1072`: `ws.setActivePanel(tabId, panel.id)` with the header's own `tabId`, then open `ContextMenu` anchored to the button with `splitMenuItems`; title "Split panel…"
- [x] T017 [US1] Remove rename-on-add: `lastAddedPanelId`/`clearLastAddedPanel` from `ui/src/renderer/state/workspace-store.tsx` and their callers `ui/src/renderer/explorer/file-tree.tsx`, `ui/src/renderer/find-in-files/open-find-in-files.ts`, `ui/src/renderer/preview/open-preview.ts`, `ui/src/renderer/editor/open-in-editor.ts`, `ui/src/renderer/editor/open-into-panel.ts`, and the effect at `panel-placeholder.tsx:314-320`; update affected component tests (`new-tab-rename-focus.test.ts` panel cases)
- [x] T018 [US1] Close an open **+** menu when a panel drag starts (`onDragStart` in `ui/src/renderer/workspace/tab-group.tsx`), with a component case in `panel-split-menu.test.ts`
- [x] T019 [US1] Rewrite the E2E helper `addPanels` in `ui/tests/e2e/harness.ts:1209` to click **+** then choose Split Right (leave `commitPanelRename`/`commitInlineRename` in place until T048 removes their last callers); run the specs that call `addPanels` narrowly to confirm the helper change
- [x] T020 [US1] Write `ui/tests/e2e/panel-split.e2e.ts` (`@extended @window`): **+** → each direction in a 2x2 keeps the other three panels' boxes unchanged (SC-001, SC-002), the split survives a restart (SC-009); a **+** split in a sub-workspace window changes only that window (FR-004); add it to `ui/tests/e2e/parallel-plan.json` (menu spec) and re-seed `e2e-budget.json`

---

## Phase 4: User Story 2 — Split from the right-click menus (P1)

**Goal**: a **Split ▸** submenu on the header menu and every content menu.

**Independent Test**: header menu and a content right-click each offer Split ▸ with four directions and
chords; each matches the **+** menu's result.

- [x] T021 [US2] Write failing tests: `ui/tests/unit/menu-sections.test.ts` pins Split in *create* in the panel header menu and the editor, terminal, preview, Find in Files and placeholder content menus; `ui/tests/component/panel-content-split.test.ts` right-clicks each panel kind (placeholder included) and splits through the submenu, and opens the header menu with Shift+F10 and splits by keyboard (US2 scenario 2)
- [x] T022 [P] [US2] Add `splitSubmenu` to `panelHeaderMenu` in `ui/src/renderer/workspace/panel-header-menu.ts` (new action `split(direction)` in `PanelHeaderMenuActions`, wired in `panel-placeholder.tsx`)
- [x] T023 [P] [US2] Add `splitSubmenu` to `ui/src/renderer/editor/content-menu.ts`
- [x] T024 [P] [US2] Add `splitSubmenu` to `ui/src/renderer/terminal/terminal-content-menu.ts`
- [x] T025 [P] [US2] Add `splitSubmenu` to `ui/src/renderer/preview/content-menu.ts`
- [x] T026 [P] [US2] Add `splitSubmenu` to `ui/src/renderer/find-in-files/content-menu.ts`
- [x] T027 [P] [US2] Give the untyped placeholder its first content menu (Split alone, no divider) in `ui/src/renderer/workspace/panel-body.tsx`

---

## Phase 5: User Story 3 — Split mode from the keyboard (P1)

**Goal**: `Ctrl+Shift+Alt+End`, then an arrow, splits the active panel, with a visible split mode.

**Independent Test**: terminal focused; first stroke → pulse + pending text; ↓ (held or released) splits
below; Escape instead → nothing, shell received neither key.

- [x] T028 [P] [US3] Write failing unit tests for the split-mode store in `ui/tests/unit/split-mode.test.ts`: `startSplitMode(panelId)`, `endSplitMode()`, `useSplitMode(panelId)` true only for that panel; a restart on the same panel does not stack
- [x] T029 [US3] Implement `ui/src/renderer/workspace/split-mode.ts` (the `panel-flash.ts` pattern)
- [x] T030 [US3] Write failing component tests in `ui/tests/component/split-mode.test.ts` against the window dispatcher: first stroke on the active panel starts split mode, moves focus to that panel from the File Explorer / a find bar (FR-021), shows `panel-box__split-mode` and the text "(Ctrl+Shift+Alt+End) was pressed. Waiting for the next key of the chord…" on a panel with a shown status bar and the pulse alone on one without; ArrowDown with Ctrl+Shift+Alt still held splits down and does NOT run `focus.down` (FR-020a); ArrowDown with modifiers released splits down; Escape ends it, is `defaultPrevented`, closes no find bar, focus stays on the panel; another key ends it with "The key combination (Ctrl+Shift+Alt+End,X) is not bound."; timeout (fake timers, advancing by the imported `TWO_STROKE_TIMEOUT_MS`), window blur, active-panel change, a menu opening, and a drag starting each end it with no split (FR-022); a second first stroke re-arms the timeout (FR-025); both strokes are `defaultPrevented` + `stopPropagation`ed so a terminal receives neither (FR-023); pulse and text appear and clear synchronously with the key event (SC-004)
- [x] T031 [US3] Add the window-scope `ChordEngine` host (`modifierPolicy: 'released-ok'`; `matchFirst` over the first strokes of window-scope multi-stroke bindings live in the current scope; `matchNext` with the first stroke's modifiers stripped) to `ui/src/renderer/keybindings/window-dispatcher.tsx`, running before single-stroke resolution; on start call `startSplitMode` and focus the panel via the `goToPanel` route; on completion call `ws.splitPanel` for the active panel
- [x] T032 [US3] Wire the split-mode endings: `onMenuOpen` subscription in `ui/src/renderer/workspace/context-menu.tsx`, `onDragStart` in `ui/src/renderer/workspace/tab-group.tsx`, window blur and active-panel change in the dispatcher
- [x] T033 [US3] Render the pulse overlay in `ui/src/renderer/workspace/panel-placeholder.tsx` beside `panel-box__flash`, and portal `PendingChord` into the panel box for kinds with a shown status bar; CSS in `ui/src/renderer/theme.css`: `.panel-box__split-mode` with `var(--accent)` border animating **opacity only**, and a `prefers-reduced-motion: reduce` rule showing a steady border (FR-026); a component case asserts the reduced-motion class/rule is present
- [x] T034 [US3] Write `ui/tests/e2e/split-mode.e2e.ts` (`@extended @terminal`): in a real shell, type a sentinel, run the split chord (held and released variants) and Escape; the shell's line holds only the sentinel (SC-003), and a sub-workspace window splits by chord too (FR-091); add to `parallel-plan.json` (real shell) and re-seed the budget

---

## Phase 6: User Story 4 — Drop along a whole edge (P2)

**Goal**: four outer-edge bands during a panel drag place the panel along a whole edge at one third.

**Independent Test**: 2x2 + a fifth panel dragged to the left band: full-height preview, full-height column
at a third, 2x2 untouched, survives restart.

- [x] T035 [P] [US4] Write failing unit tests for `movePanelToOuterEdge(layout, panelId, tabId, edge)` in `core/tests/unit/workspace-operations-048.test.ts`: from a 2x2 (column root) a left drop wraps the root in a row `[panel, root]` sizes `[1/3, 2/3]`; bottom drop on a row root wraps in a column `[root, panel]`; a root already along the axis gains the panel as first/last member at 1/3 with the others scaled ×2/3 and their relative proportions kept (FR-063); the moved panel keeps id, title, kind, config (FR-067); its old split collapses; a panel already the first member of a row root dropped on left → identical layout object (no-op); a panel from another tab moves across and an emptied source tab is dropped
- [x] T036 [US4] Implement `movePanelToOuterEdge` in `core/src/workspace/operations.ts`; export it; add the store wrapper in `ui/src/renderer/state/workspace-store.tsx` that skips the save on a no-op
- [x] T037 [US4] Write failing component tests in `ui/tests/component/outer-edge-zones.test.ts`: the four bands (`outer-edge-<edge>`) render only during a panel drag in a tab with ≥ 2 panels and never with one (FR-060); the collision wrapper returns an outer-edge collision ahead of a panel edge zone under the same point, and at a corner left/right beats top/bottom (FR-064); the preview `outer-edge-preview` covers the full edge at one third and carries a class distinct from `.edge-zone--over` (FR-065); a drop calls `movePanelToOuterEdge`; the bands add no `getBoundingClientRect` call on pointermove (FR-066)
- [x] T038 [US4] Implement `ui/src/renderer/workspace/outer-edge-zones.tsx`, the `outer|<edge>` ids in `ui/src/renderer/workspace/drag-state.ts`, the collision wrapper and drop branch in `ui/src/renderer/workspace/tab-group.tsx`, and CSS in `ui/src/renderer/theme.css` (`.tab-body { position: relative }`, `--outer-edge-band: 16px`, band and dashed preview styles)
- [x] T039 [US4] Write `ui/tests/e2e/outer-edge-drop.e2e.ts` (`@extended @window`): 2x2 + fifth panel dropped on the left band → full-height column at ~1/3 beside the unchanged 2x2 (SC-005); bottom band → full-width row; restart restores it (FR-068); the same drop in a sub-workspace window leaves the main window's layout unchanged (SC-009); a per-panel edge drop outside the band behaves as today; add to `parallel-plan.json` if it drives a context menu, re-seed the budget

---

## Phase 7: User Story 5 — A panel is always named by what it holds (P2)

**Goal**: no surface renames a panel; old custom titles migrate away.

**Independent Test**: no Rename / Reset Name, double-click and F2 inert on a panel, Key Bindings has no
"rename panel"; an alpha8 layout with custom titles loads with derived titles.

- [x] T040 [P] [US5] Write failing unit tests for `dropCustomPanelTitles(layout)` in `core/tests/unit/panel-title-migration.test.ts`: a panel with `titleIsCustom: true, defaultTitle: 'Panel 3', title: 'Build'` → `title: 'Panel 3'` with both fields gone; `titleIsCustom` without `defaultTitle` keeps `title`; ids, sizes, tree shape, kinds and configs byte-identical (FR-034, SC-008); running it twice equals running it once (idempotent); sub-workspace layouts too
- [x] T041 [US5] Implement `core/src/workspace/panel-title-migration.ts`; remove `titleIsCustom`/`defaultTitle` from `Panel` in `core/src/workspace/model.ts`; apply the migration on load in `daemon/src/workspace-service.ts` (before `validateMainLayout`) and in the sub-workspace layout load in `core/src/workspace/sub-workspace.ts` (tear-offs are sub-workspaces); afterwards `git grep -n "titleIsCustom|defaultTitle" -- packages/*/src` returns only comments, which are reworded
- [x] T042 [US5] Write a failing integration test in `daemon/tests/integration/panel-title-migration.integration.test.ts`: a persisted alpha8 layout with custom titles loads through the daemon path without error, shows derived titles, and re-saves without the two fields
- [x] T043 [US5] Write failing core tests: `panel.rename` is not an `ActionId`, has no default and no metadata; a user override `{"panel.rename": ["F2"]}` parses without error and F2 still resolves to `file.rename` in the explorer scope and to nothing in panel scopes (FR-037) — in `core/tests/unit/keybindings-048.test.ts`; `resolveTitle` ignores any leftover custom flag, and the header, tab strip, tooltip and the unsaved-editor default save name (006 FR-083) all use the derived title (FR-032) — in `core/tests/unit/panel-display-title.test.ts`
- [x] T044 [US5] Remove `panel.rename` from `core/src/config/keybindings.ts` and `core/src/config/keybindings-metadata.ts`; remove `renameInNode`, `resetNameInNode`, `renamePanel`, `resetPanelName` from `core/src/workspace/operations.ts` and the barrel; remove the custom-title branches in `core/src/workspace/panel-title.ts`; remove panel use of `core/src/workspace/rename-commit.ts` (delete the module if tabs do not use it); remove the `resetName` icon token from `core/src/config/theme.ts` and `core/src/config/theme-copy.ts`; if T043's save-name case fails, route the unsaved-editor default save name through the derived title (message `ui` if the path is in the renderer); delete the core tests that pin removed behaviour (`panel-reset-name`, `panel-custom-title-invariant`, panel cases of `rename-commit`, `workspace-operations` renamePanel)
- [x] T045 [US5] Write failing component tests in `ui/tests/component/panel-no-rename.test.ts`: the header menu has no Rename / Reset Name (FR-030, FR-031); double-clicking the title opens no text box (US5 scenario 2); F2 with a terminal focused reaches the terminal (not consumed); tab, project and sub-workspace rename still work (FR-038)
- [x] T046 [US5] Remove panel rename from the renderer: header edit mode, `NameLimitField` use, double-click and `beginRename`/`resetName` actions in `ui/src/renderer/workspace/panel-placeholder.tsx` and `ui/src/renderer/workspace/panel-header-menu.ts`; delete `ui/src/renderer/workspace/panel-rename.ts`; drop the `panel.rename` case and `WINDOW_HANDLED_ACTIONS` entry in `ui/src/renderer/keybindings/window-dispatcher.tsx`; drop it from `ALWAYS_OURS` in `ui/src/renderer/search/search-actions.ts` and the comment in `ui/src/renderer/keybindings/scope.ts:205`
- [x] T047 [US5] Remove cross-window rename sync (FR-036): `throng:panel:rename`/`renamed` in `ui/src/preload/preload.cts`, `ui/src/renderer/global.d.ts`, `ui/src/main/main.ts:2135-2144` and the rename half of `ui/src/renderer/workspace/panel-rename-sync.tsx` (keep `retitle`); update `ui/tests/component/subworkspace-sync.test.ts` to keep the retitle case
- [x] T048 [US5] Delete the E2E specs that pin removed behaviour — `ui/tests/e2e/panel-rename-key.e2e.ts`, `panel-reset-name.e2e.ts`, `subworkspace-rename-sync.e2e.ts` — and the rename cases in `panel-auto-naming.e2e.ts` and `window-chord-resolution.e2e.ts`; fix any other spec using `panel-rename-input` to identify panels by derived title; remove `panelRenameCounter` from `ui/tests/e2e/helpers/tab-settings.ts` and `commitPanelRename`/`commitInlineRename` from `ui/tests/e2e/harness.ts`; update `parallel-plan.json`/`launch-sharing.md` references; re-seed `e2e-budget.json`
- [x] T049 [US5] Update remaining unit/component tests that referenced rename (`menu-sections`, `redraw-menu-parity`, `scope`, `menu-icon-tokens`, `panel-box`, `tab-strip`, `panel-header-zoom-menu`, `editor-title-publisher`, `dormant-terminal`, `panel-display-names`, `explorer-open-in-*`, `tests/shared/window-chords.ts`) so each pins the post-048 behaviour

---

## Phase 8: User Story 6 — An abandoned drag changes nothing (P2)

**Goal**: Escape cancels a drag cleanly (#458); a preview keeps its own scroll place across tab hides (#459).

**Independent Test**: drag + Escape + release: no ghost, no highlight, layout unchanged; a preview dragged
across another tab and back keeps its place.

- [x] T050 [US6] Write failing component tests in `ui/tests/component/drag-cancel.test.ts` (panel and tab-strip drags share the one `DndContext` in `tab-group.tsx:1450`): a panel drag and a tab drag each cancelled through dnd-kit's cancel path call `dragGhost.stop()`, clear edge/outer-edge/tab highlights and `draggingPanelId`, and leave the layout and saves untouched (FR-080, SC-010); a drag that hover-switched tabs leaves the new tab active after cancel (FR-081); the next drag starts one ghost with no stale hover (FR-082); cancel also ends split mode and closes a **+** menu
- [x] T051 [US6] Add `onDragCancel={reset}` and `autoScroll={false}` to the `DndContext` in `ui/src/renderer/workspace/tab-group.tsx`, plus an unmount cleanup calling `reset()`; `reset()` ends split mode
- [x] T052 [US6] Add the Escape case to `ui/tests/e2e/drag-ghost.e2e.ts`: start a panel drag, press Escape, release — the ghost window is hidden and the layout unchanged; same for a tab drag
- [x] T053 [US6] Write a failing reproduction of #459 in `ui/tests/component/preview-remount-place.test.ts`: a standalone Markdown preview with collapsed sections and tables, scrolled to the middle, unmounted and remounted through the real attach path with fold state re-seeded late and the table pass deferred, returns at its captured anchor line; a parented preview with sync on returns to its **own** place, not the editor's line (FR-084); a 20-cycle loop of detach/remount keeps the place every time (SC-011). Record in the ledger which hypothesis (R9) the failure confirms
- [x] T054 [US6] Fix #459 per the confirmed cause: make the attach restore settle-aware (pending place re-applied after the fold seed and the deferred table pass, then cleared; a detach during a pending restore stores the pending place) in `ui/src/renderer/preview/providers/markdown/markdown-body.tsx` and `ui/src/renderer/preview/preview-panel.tsx`; use the panel's own captured place on attach when history holds one (`preview-panel.tsx:1614-1622`)

---

## Phase 9: Polish & Cross-Cutting

- [x] T055 [P] Update `docs/key-bindings.md` (four split rows with two-stroke chords, a split-mode paragraph, drop the Rename panel row and F2's panel meaning) and `docs/quick-start.md` (the **+** menu, Split submenu, split mode, outer-edge drops with the corner rule; drop "F2 or a double-click gives one a name of its own") (FR-050); `CHANGELOG.md` unreleased section; run `ui/tests/unit/docs-currency.test.ts`
- [x] T056 [P] Update `specs/033-open-and-navigate/contracts/menu-sections.md`: remove panel Rename (Content) and Reset Name (View & state), add Split (Create) (FR-016, FR-043)
- [x] T057 [P] Add the FR-046 one-line italic back-notes naming the superseding 048 FR at each superseded requirement in `specs/002-*/spec.md` (FR-017, FR-012a, FR-037, FR-041), `specs/024-*/spec.md` (FR-016, FR-017, FR-017a, SC-005, US5 scenarios 3–6), `specs/031-*/spec.md` (FR-033, FR-035, FR-035g, US4 scenario 2), `specs/033-*/spec.md` (FR-033), `specs/043-*/spec.md` (FR-061), `specs/044-*/spec.md` (FR-030, FR-031, FR-121h), `specs/046-*/spec.md` (`panel.rename` rows, FR-091/092/126)
- [x] T058 Run `/speckit-constitution` for the FR-045 PATCH amendment: remove `panel.rename` from Principle IV's F2 recorded exception, replace panel Rename / Reset Name as Principle VI's section-vocabulary examples, and note the window-scope split chords' first stroke is tier 1 in `.specify/memory/constitution.md`
- [x] T059 Run the `throng-docs` audit and the quickstart's automated commands narrowly; fix any finding

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 (T002–T014) → user stories.
- US1 (T015–T020) needs T003, T013, T014. US2 needs T013, T014. US3 needs T005, T008, T010, T014.
- US4 is independent of US1–US3 after Phase 2. US5's T046 edits `window-dispatcher.tsx` (after T010) and
  `panel-placeholder.tsx` (after T016). US6's T051 edits `tab-group.tsx` (after T018, T032, T038).
- Polish after all stories.
- Shared files, edited in task order by one owner: `tab-group.tsx` (T018 → T032 → T038 → T051), `panel-placeholder.tsx` (T016 → T017 → T022 → T033 → T046), `workspace-store.tsx` (T014 → T017 → T036), `window-dispatcher.tsx` (T010 → T031 → T046).
- The `@extended` E2E suite compiles after every task: T019 keeps the rename helpers until T048 removes their last callers.

## Parallel Opportunities

- Phase 2: T002, T004, T007, T012 (distinct test files) in parallel; T003, T005, T008, T013 after their tests.
- US2: T022–T027 each touch a different menu file.
- US4's core op (T035–T036) and US5's migration (T040–T041) run alongside the renderer work.

## Implementation Strategy

MVP is Phase 2 + US1 + US5's rename-on-add removal (T017) — the **+** split menu with no rename box. Then
US2 and US3 (the other P1 routes), US5 in full, US4, US6, polish.

## Phase 10: Convergence

- [x] T060 Run every window-handled command's multi-stroke binding through the window chord engine (not only `panel.split*`), dispatching the matched command through the dispatcher's own switch, and widen core's `WINDOW_MULTI_STROKE_ACTIONS` / `terminalMultiStrokeAllowed` to those commands (first stroke not reserved), in `packages/core/src/config/keybindings.ts` and `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`, test-first (a `panel.zoomIn` rebound to `Ctrl+Shift+Alt+Home,Z` zooms from a terminal and neither stroke reaches it) per FR-024 (partial)
- [x] T061 Show the sub-workspace "not available" notice on the active panel even when it has no shown status bar, in `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`, test-first in `packages/ui/tests/component/window-dispatcher.test.ts` per SC-012 / FR-092 (partial)
- [x] T062 Give a dormant terminal's body a content menu carrying the Split submenu, in `packages/ui/src/renderer/terminal/dormant-terminal.tsx` (or its host), test-first in `packages/ui/tests/component/panel-content-split.test.ts` per FR-015 / US2 AC1 (partial)
- [x] T063 Add the FR-043 italic back-note under 033's acceptance scenario 2a in `specs/033-open-and-navigate/spec.md` per FR-046 (partial)
- [x] T064 Record the outer-edge preview test id as `outer-edge-preview-<edge>` in `specs/048-panel-splitting/contracts/menus-commands-controls.md` per contract (contradicts — the code's per-edge id is the better contract; the artifact is amended)
- [x] T065 Reword the stale rename comments at `packages/ui/src/renderer/workspace/panel-placeholder.tsx:204` and `packages/ui/src/renderer/editor/use-editor.ts:1137` to describe derived titles only per FR-030 / FR-041 (contradicts — comments)

## Phase 11: Convergence

- [x] T066 Reword the multi-key chord rule in `docs/key-bindings.md` (multi-key chords section): a command live in a terminal may carry a multi-key chord when the window handles it and its first key is not a reserved terminal key; otherwise the capture box refuses it and a hand-written one is ignored on load, per FR-050 / FR-024 (contradicts)
- [x] T067 Make the capture box's refusal for a window-handled command say the first key is reserved for the terminal when that is the only reason, in `packages/ui/src/renderer/preferences/capture-modal.tsx`, test-first in `packages/ui/tests/component/preferences-capture-modal.test.ts`, per FR-024 (partial)
- [x] T068 Reword the stale comments at `packages/ui/src/renderer/preferences/capture-modal.tsx:128-130` (every window-handled command is the exception, not only `panel.split*`) and `packages/ui/src/renderer/workspace/panel-placeholder.tsx:209` (no user override among panel-name sources), per FR-024 / FR-030 (contradicts — comments)

## Phase 12: Iterate round 1 — Blank Panel, open-route ownership, sub-workspace defects

**Input**: spec FR-127–FR-129 (Session 2026-09-30, iterate 1) and research R12; defects D1 and D2 from
manual test MT-08. Test-first throughout: write the test, run it, read why it fails, then implement.

- [x] T069 [P] [US5] Failing core unit tests in `packages/core/tests/unit/unique-panel-name.test.ts`: `nextDefaultPanelName` returns "Blank Panel" when free, then "Blank Panel 2", "Blank Panel 3" by lowest free number; `isDefaultPanelName` accepts "Blank Panel", "Blank Panel 4" and the legacy "Panel 3", and rejects "Blank Panel (2)" and "My Blank Panel"; `uniquePanelName("Blank Panel", …)` rejoins the sequence rather than taking "(2)", per FR-127 / FR-033
- [x] T070 [US5] Implement the Blank Panel sequence in `packages/core/src/workspace/unique-name.ts` so T069 passes, per FR-127
- [x] T071 [US5] Failing core unit tests in `packages/core/tests/unit/workspace-operations-048.test.ts` (and the neighbouring operations tests that assert generated names), then make every fallback-title site in `packages/core/src/workspace/operations.ts` (`:122`, `:154`, `:174`, `:438`) take its title from `nextDefaultPanelName` over the layout's existing titles, per FR-127
- [x] T072 [US5] Failing component test in `packages/ui/tests/component/workspace-store-split.test.ts`: a **+** add and a split each produce "Blank Panel" / "Blank Panel 2"; then replace the `Panel ${count + 1}` templates in `packages/ui/src/renderer/state/workspace-store.tsx:446,458` with `nextDefaultPanelName`, per FR-127
- [x] T073 [P] [US5] Failing core unit tests in `packages/core/tests/unit/panel-title-migration.test.ts` for `renameLegacyDefaultTitles`: every `^Panel \d+$` title becomes "Blank Panel"; other titles, ids, tree shape, kinds and configs are unchanged; a second pass returns the document by identity; a malformed document passes through, per FR-128
- [x] T074 [US5] Implement and export `renameLegacyDefaultTitles` in `packages/core/src/workspace/panel-title-migration.ts` and `packages/core/src/index.ts` so T073 passes, per FR-128
- [x] T075 [US5] Failing daemon tests in `packages/daemon/tests/unit/panel-name-service.test.ts` and `packages/daemon/tests/integration/panel-title-migration.integration.test.ts`: reconcile turns saved "Panel 1" / "Panel 2" across two projects and a sub-workspace into a unique Blank Panel sequence and persists it; a re-run renames nothing; the workspace load path shows the migrated titles before reconcile. Then apply `renameLegacyDefaultTitles` in `packages/daemon/src/panel-name-service.ts` (`loadLayout`, `loadSubs`) and in the load path `packages/daemon/src/workspace-service.ts` (every place it applies `dropCustomPanelTitles`), per FR-128
- [x] T076 [US5] Update the E2E specs that assert generated names ("Panel N") to the Blank Panel sequence: `packages/ui/tests/e2e/panel-auto-naming.e2e.ts`, `status-bar-deduped.e2e.ts`, `ux-refinements.e2e.ts`, `tab-presentation.e2e.ts` (only assertions on generated names; fixture titles stay), per FR-127
- [x] T077 Failing component test in `packages/ui/tests/component/editor-open-routing.test.ts` for the open route: in a sub-workspace window, `openFileInTab` with an `ownerProjectId` creates an editor whose `originProjectId` is that project, and reuses a last-active editor only when it is owned by that project, per FR-129
- [x] T078 Implement `ownerProjectId` in `packages/ui/src/renderer/editor/editor-open.tsx` and `packages/ui/src/renderer/editor/open-into-panel.ts` (`createDedicatedEditor`, `openFileInNewEditor`), and pass it from Quick Open (`packages/ui/src/renderer/navigate/quick-open.tsx` / `navigation-chrome.tsx`). So that no route can be missed, when no `ownerProjectId` is passed in a sub-workspace window `openFileInTab` derives it from the active panel's origin project (when that is a project, not the sub-workspace); this covers every other caller — `find-in-files/result-open.ts`, `links/link-open-in-perform.ts`, `editor/open-in-perform.ts`, `preview/preview-panel.tsx`, `editor/use-editor.ts`, `terminal/terminal-panel.tsx`, `workspace/tab-group.tsx` — and T077 asserts the derived case too, so T077 passes, per FR-129 / research R12 [derived: the reuse rule for a last-active editor]
- [x] T079 Failing component test for defect D1, in a new `packages/ui/tests/component/subworkspace-scrim.test.ts`: in the sub-workspace app, `TransientScrim` renders inside `.throng-root` (the same stacking context as the tab picker); then move the mount in `packages/ui/src/renderer/subworkspace-app.tsx:149`, per FR-091 (the chord acts identically in both windows) and 033 FR-071 (the tab picker is a transient overlay above the scrim)
- [x] T080 Failing component test for defect D2 in `packages/ui/tests/component/window-dispatcher.test.ts`: with sub-workspace capabilities and `requestQuickOpen()` returning false, `navigate.quickOpen` is consumed and raises the "not available in a sub-workspace window" notice; in the main window it stays silent (033 FR-018). Then fix `packages/ui/src/renderer/keybindings/window-dispatcher.tsx:666-668`, per FR-092 / SC-012
- [x] T081 Add the Blank Panel naming to `CHANGELOG.md` (Unreleased, beside the #453 entry) to `docs/quick-start.md` where empty panels are introduced, and correct the fallback-title description in `specs/048-panel-splitting/data-model.md:8`; run `packages/ui/tests/unit/docs-currency.test.ts`, per docs currency

## Phase 13: Iterate round 2 — Blank Panel shows no number

**Input**: spec FR-130 (Session 2026-09-30, iterate 2).

- [x] T082 [US5] Failing core unit tests in `packages/core/tests/unit/panel-display-title.test.ts`: `panelDisplayTitle` shows an empty panel stored as "Blank Panel 2" (and a legacy "Panel 3") as "Blank Panel"; a user-visible content title is unaffected; then implement in `packages/core/src/workspace/panel-title.ts` (a generated fallback resolves to `BLANK_PANEL_NAME`), per FR-130
- [x] T083 [US5] Update the tests and docs that expect a NUMBERED display name to expect "Blank Panel": `packages/ui/tests/e2e/panel-auto-naming.e2e.ts`, `status-bar-deduped.e2e.ts`, `ux-refinements.e2e.ts`, any component test asserting a shown name, `CHANGELOG.md`, `docs/quick-start.md` and `data-model.md:8`, per FR-130

## Phase 14: Gate fixes (CI run 36831707156 and the branch's changed E2E specs)

- [x] T086 Root `drag-ghost.e2e.ts`'s terminal drag-cancel spec in a real temp folder: a non-existent project root raised a "could not be found" notice over the Confirm button (test defect, found on CI)
- [x] T084 Failing component/unit tests, then make every failure surface name a panel by its content-derived title (`panelDisplayTitle`, with the editor's file from live state or persisted config, the terminal's live title or flavour), never the raw stored `title`: the consolidated panel-failure notice (`packages/ui/src/renderer/workspace/panel-failure-notice.ts:216`), the failure banner's copied subject, the missing-file notice (`editor/missing-file-watcher.tsx:109`) and the editor's load-failure entries (`editor/use-editor.ts` `metaRef.current.title`), per FR-032 / FR-130 (contradicts — found by `notice-a11y.e2e.ts:99`, `notice-consolidation.e2e.ts:155`, `failure-copy.e2e.ts:257`)
- [x] T085 Fix `outer-edge-drop.e2e.ts:189`'s width expectation: p4 regains the column width p5 was split from, so compare p1–p3 to their own widths and p4 to the column (p2's) width (test defect)

## Phase 15: Destroy Panel from the keyboard (#461)

**Input**: spec FR-131 (Session 2026-10-01, iterate 3); constitution v5.8.0 Principle IV.

- [x] T087 Failing core unit tests, then register `panel.destroy` in `packages/core/src/config/keybindings.ts` (action id, default `['Ctrl+Shift+Alt+F4']`, a scope covering every panel kind including the placeholder's), its descriptor in `keybindings-metadata.ts` ("Destroy Panel"), and add it to `WINDOW_HANDLED_ACTIONS` so it is consumed before a terminal sees it; assert no shipped binding collides with it, per FR-131
- [x] T088 Failing component tests, then make the window dispatcher (`packages/ui/src/renderer/keybindings/window-dispatcher.tsx`) run `panel.destroy` on the panel that holds focus through that panel's own destroy flow (one shared opener, as `requestPanelFocus` / `requestTabPicker` are — never a second copy of the flow in `panel-placeholder.tsx`), do nothing when focus is in a side pane, and show the chord on every panel menu's Destroy/Close item, per FR-131
- [x] T089 Document `panel.destroy` in `docs/key-bindings.md` and `CHANGELOG.md`; run `packages/ui/tests/unit/docs-currency.test.ts`, per docs currency
- [x] T090 Add manual test group MT-09 (Destroy Panel from the keyboard) to the branch's plan, per FR-131

## Phase 16: Keyboard focus between and into panels (iterate 4)

- [x] T091 Failing component test, then make Confirm on an empty panel's type form move keyboard focus into a new editor's caret (as a terminal already gets it), whether clicked or keyboard-activated, per FR-132
- [x] T092 Failing component test, then make every keyboard focus move between panels close the transient controls open in the panel being left (an expanded native drop-down such as "Choose a type", an open menu) the way a mouse click on another panel does, leaving find bars open, per FR-133
- [x] T093 Add manual test group MT-10 for FR-132 / FR-133
