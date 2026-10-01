# Implementation Plan: Panel Splitting and Content-Derived Panel Titles

**Branch**: `feature/S048-I433-I453-panel-splitting` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/048-panel-splitting/spec.md` (6 user stories, FR-001–FR-093,
SC-001–SC-012, two clarification sessions). Refs #433, #453, #458, #459, #275.

## Summary

Six changes around one surface — the panel header, its menus and the drag/chord code under them:

- **Split commands** (R1–R3): a core `splitPanel` op over the existing `insertAtEdge`; the panel **+**
  button opens a four-way split menu on its own panel; a shared **Split** submenu (section *create*) joins
  the header menu and every content menu, and the untyped placeholder gains a content menu.
- **Split mode** (R4): four `panel.split*` commands with two-stroke defaults `Ctrl+Shift+Alt+End,Arrow`,
  run by the 046 `ChordEngine` as its first **window-scope** host, with a `released-ok` modifier policy so
  the arrow completes the chord whether Ctrl+Shift+Alt are held or not. A pulsing border (opacity-only,
  reduced-motion aware) and 046's pending text mark it.
- **One window dispatcher** (R5, #275): `KeybindingsHandler` becomes a shared module mounted in the main
  and sub-workspace windows, parameterised by window capabilities; the sub-workspace's own listener is
  retired; unavailable commands are consumed and reported.
- **Outer-edge drop zones** (R7): four droppable bands inside `.tab-body` during a panel drag, winning over
  panel zones, with a one-third preview; a core `movePanelToOuterEdge` op.
- **Panel rename removed** (R6): model fields, ops, command, menu rows, header edit mode, IPC, and an
  idempotent load-time migration that drops custom titles.
- **Drag and preview fixes** (R8, R9): `onDragCancel={reset}` for #458; a settle-aware attach restore and an
  own-place attach policy for #459, proven by a failing component test first.

## Technical Context

**Language/Version**: TypeScript (repo toolchain, ES2022), Node 24, Electron 44

**Primary Dependencies**: React 18, `@dnd-kit/core` ^6.3.1 (already used), xterm.js 6, InversifyJS,
Vitest, Playwright. **No new dependency.**

**Storage**: the layout JSON blob only — two optional `Panel` fields removed, migrated on load, no schema
version bump. Keybindings gain four actions and lose one. No settings change.

**Testing**: core unit, ui unit, component (jsdom), integration, E2E (`@extended`); see research R10.

**Target Platform**: Windows 11 desktop (Electron); nothing forecloses macOS/Linux.

**Project Type**: desktop application, npm-workspaces monorepo.

**Performance Goals**: SC-004 — pulse and pending text within 100 ms of the first stroke (a store update
and a class, no async). SC-006 — outer-edge feedback within 002 NFR-001; four more droppable rects measured
once at drag start, nothing measured per pointer move.

**Constraints**: no stroke of a split chord reaches a shell (window capture-phase consumption); one chord
dispatcher for both windows; Principle IV tier rules for the new defaults.

**Scale/Scope**: `packages/core` and `packages/ui` (renderer, main, preload), `packages/daemon` (the load
normalisation call only), docs, the constitution (PATCH), back-notes in seven older specs.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.*

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged, satisfied.** A split creates a placeholder in the clicked panel's own tab; an outer-edge drop acts only in the window it is made in. No project crossing is introduced (FR-004, FR-068). |
| **II. Platform-Abstracted Core** | **Engaged, satisfied.** `splitPanel`, `movePanelToOuterEdge` and `dropCustomPanelTitles` are pure core. |
| **III. Detached, Tagged & Persistent Terminals** | **Not engaged.** |
| **IV. Native Terminal Support** | **Engaged, cleared.** The split chords are multi-stroke; their first stroke `Ctrl+Shift+Alt+End` is tier 1 (navigation/application), not reserved, matched on the physical key, reachable on all seven named layouts (R4). The terminal validators narrow to the constitution's actual rule (first stroke not reserved). `panel.rename` leaves F2's recorded exception — F2 returns to terminals (constitution PATCH, FR-045). |
| **V. Test-First (NON-NEGOTIABLE)** | **Engaged, satisfied.** Every task is test-first at the lowest layer (R10); #459 starts from a failing reproduction. Removed tests are removed *because the behaviour they pin is removed by supersession* (FR-040–FR-045); the E2E budget is re-seeded in the same commit. |
| **VI. Simple, Modern, Discoverable UX** | **Engaged; see the rules table.** |
| **VII. Change Review & Approval** | **Not engaged.** |
| **VIII. SOLID, DRY & YAGNI** | **Engaged, and it decided three shapes.** One split builder for six menus (R3); one chord engine, not a window copy (R4); one dispatcher, not two (R5). Rename removal deletes a whole mechanism rather than hiding it. |
| **IX. DI & Composition Root** | **Not engaged** — no new service. |
| **X. Externalised Configuration** | **Engaged.** The four chords are rebindable defaults. The 16px outer-edge band and the one-third drop share are constants (Complexity Tracking). |
| **XI. Dockable Workspace** | **Engaged — the high-risk row.** A split and an outer-edge drop are new tree edits; both go through core ops with collapse/`finalize` rules; persistence is the existing per-window save. "Focus follows the active panel" holds: a split focuses the new panel, split mode focuses its panel. Principle XI's "splittable by dragging" is extended, not replaced, by a command route (002 FR-017 superseded in part, FR-005). |
| **XII. Responsive UI (NON-NEGOTIABLE)** | **Engaged.** The pulse is opacity-only; outer-edge bands add no per-move measurement; #459's re-anchor runs once per settle point, not per frame. |

### Principle VI — its named rules

| Rule | Assessment |
|---|---|
| **Every panel action has a menu item** | Satisfied: Split submenu on the header menu and every content menu; the **+** menu and the chords are accelerators. |
| **One section vocabulary** | Satisfied — Split in *create* ([contracts/menus-commands-controls.md](./contracts/menus-commands-controls.md)); 033's contract updated. |
| **Disabled when unavailable, absent when meaningless** | Split is always available. Rename/Reset Name are removed, not disabled. |
| **Themeable icon controls (NON-NEGOTIABLE)** | The **+** button keeps its `add` token with a new hover title; the `resetName` token is retired. |

### Development Workflow & Quality Gates

| Gate | Assessment |
|---|---|
| **Particular-scrutiny review** | Engaged: keyboard dispatch reaching terminals (FR-023) and a persisted-layout migration (FR-035). |
| **Documentation currency** | Engaged: `docs/key-bindings.md`, `docs/quick-start.md`, `CHANGELOG.md` (FR-050); `docs-currency.test.ts` enforces bindings. |
| **Configuration-editor completeness** | Engaged: four actions with labels and descriptions; `panel.rename` removed from the editor. |
| **Constitution amendment** | PATCH via `/speckit-constitution` (FR-045). |

**Result: PASS**, with two Principle X constants recorded below.

### Re-evaluation after Phase 1

Re-checked against research, data model and contract. Two refinements, verdict unchanged:

- **IV**: the terminal multi-stroke validators were stricter than the constitution (any multi-stroke on a
  terminal-live command refused). Narrowing them to the constitution's reserved-first-stroke rule is
  required for FR-024 and is recorded in R4, not a new exception.
- **VI**: the **+** click's target was the layout's active tab, not the header's own — a latent defect that
  FR-011 now pins; fixed in R2.

## Project Structure

### Documentation (this feature)

```text
specs/048-panel-splitting/
├── spec.md
├── plan.md
├── research.md          # R1–R11
├── data-model.md
├── quickstart.md
├── contracts/menus-commands-controls.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── workspace/model.ts                 # Panel loses titleIsCustom, defaultTitle
├── workspace/operations.ts            # splitPanel, movePanelToOuterEdge (NEW); rename/reset ops removed
├── workspace/panel-title-migration.ts # NEW dropCustomPanelTitles
├── workspace/panel-title.ts           # custom-title branch removed
├── workspace/rename-commit.ts         # panel use removed
├── workspace/sub-workspace.ts         # migration on load
├── config/keybindings.ts, keybindings-metadata.ts   # panel.split*; panel.rename removed; validators
├── config/theme.ts, theme-copy.ts     # resetName token removed
packages/core/tests/unit/

packages/daemon/src/workspace-service.ts   # migration on load

packages/ui/src/main/main.ts, preload/preload.cts, renderer/global.d.ts   # rename IPC removed
packages/ui/src/renderer/
├── app.tsx, subworkspace-app.tsx      # mount the shared dispatcher
├── keybindings/window-dispatcher.tsx  # NEW (extracted KeybindingsHandler + capabilities + split host)
├── keybindings/chord-engine.ts        # modifierPolicy
├── keybindings/scope.ts
├── editor/pending-chord.tsx           # 'unavailable' indicator; portal host for panels
├── navigate/navigation-chrome.tsx     # sub-workspace listener removed
├── search/search-actions.ts           # panel.rename out of ALWAYS_OURS
├── workspace/split-menu.ts            # NEW
├── workspace/split-mode.ts            # NEW store
├── workspace/outer-edge-zones.tsx     # NEW
├── workspace/panel-placeholder.tsx    # + menu, pulse overlay, rename removed
├── workspace/panel-header-menu.ts, panel-body.tsx, context-menu.tsx, drag-state.ts, tab-group.tsx
├── workspace/panel-rename.ts          # removed
├── workspace/panel-rename-sync.tsx    # rename half removed
├── state/workspace-store.tsx          # splitPanel, movePanelToOuterEdge; lastAddedPanelId removed
├── editor/content-menu.ts, terminal/terminal-content-menu.ts, preview/content-menu.ts, find-in-files/content-menu.ts
├── preview/preview-panel.tsx, preview/providers/markdown/markdown-body.tsx   # #459
└── theme.css                          # split-mode pulse, outer-edge bands/preview, .tab-body position
packages/ui/tests/{unit,component,integration,e2e}/

docs/key-bindings.md, docs/quick-start.md, CHANGELOG.md
.specify/memory/constitution.md        # PATCH via /speckit-constitution
specs/{002,024,031,033,043,044,046}/spec.md   # FR-046 back-notes; 033 contracts/menu-sections.md
```

**Structure Decision**: the existing layout. Pure tree edits and migration in core; dispatch, menus and
drag in the renderer; IPC removal in main/preload. No new package, no new service.

### Iterate round 1 (2026-09-30)

FR-127–FR-129 and two MT-08 defects, designed in [research R12](research.md). Touch points:
`core/src/workspace/unique-name.ts`, `operations.ts`, `panel-title-migration.ts` (plus `index.ts`
exports); `daemon/src/panel-name-service.ts` and `daemon/src/workspace-service.ts` (the load path); `ui/src/renderer/state/workspace-store.tsx`,
`editor/editor-open.tsx`, `editor/open-into-panel.ts`, `navigate/quick-open.tsx`,
`keybindings/window-dispatcher.tsx` and `subworkspace-app.tsx`. Test layers: core unit for the name rule
and migration, daemon unit and integration for reconcile, component for the dispatcher notice, the open
route's ownership and the scrim's placement. The existing E2E specs that assert generated names
(`panel-auto-naming.e2e.ts` and neighbours) change their expected strings; no new E2E spec. The
Constitution Check is unchanged: no principle is newly touched.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **Principle X: 16px outer-edge band is a CSS constant** | FR-064 needs a band narrow enough not to steal panel zones and wide enough to hit; it is drag-target geometry like the existing edge-zone percentages | A setting for a drop-target width is a preference nobody asked for (YAGNI) |
| **Principle X: the one-third outer-edge share is a constant** | FR-062 fixes it by clarification | A setting would contradict the clarified requirement |
| **`ChordEngine` gains a modifier policy** | FR-020a lets the second stroke be typed with or without the first stroke's modifiers, at window scope only | A second engine for window scope would duplicate the timeout, Escape and unbound logic (VIII) |
