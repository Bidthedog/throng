# Implementation Plan: Focus Contexts & Per-Panel Zoom

**Branch**: `012-focus-contexts-and-zoom` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-focus-contexts-and-zoom/spec.md`

## Summary

Give each window a first-class, visible **active-panel focus context** and add **per-panel-*type* text
zoom** (one zoom level for all terminals, one for all editors) that **composes on top of** the existing
app-wide global zoom and is persisted with the per-project layout. The feature is **entirely renderer +
core + a one-field layout-schema bump**: no daemon RPC, no `ipc-contract` change, no SQLite DDL
(`user_version` stays put; the layout blob's in-JSON `schemaVersion` goes 2 → 3).

**Headline decisions**

- **Reuse the shipped focus infra.** The per-window active Panel already exists
  (`effectiveActivePanelId`/`setActivePanel` in `@throng/core`, `.panel-box--active` in the renderer,
  window-local by design). 012 **extends** it — a two-state (active / dimmed-inactive) indicator, keyboard
  activation, and explicit fallback-on-destroy — rather than building a parallel model, and keeps it
  distinct from the OS-level focus/raise group (`main/window-manager.ts`).
- **Per-type zoom = two levels per project on `WorkspaceLayout`.** `zoom?: { terminal: number; editor:
  number }`, default `0/0`, riding the existing layout JSON blob; `LAYOUT_SCHEMA_VERSION 2 → 3` with an
  **idempotent** v2→v3 migration (absent → inherited). No persistence surface added.
- **Zoom composes for free.** Global zoom stays exactly as-is (`webContents.setZoomLevel`, whole window).
  Per-type zoom is an orthogonal content-font scale (`baseFontPx × 1.2^level`); because `setZoomLevel`
  rescales the whole page, the effective size multiplies automatically — the clarified "compose on top".
- **Shared zoom range (DRY).** A pure `core/config/zoom.ts` owns `ZOOM_STEP=0.5`, `ZOOM_MIN/MAX_LEVEL=∓5`,
  `clampZoomLevel`, `zoomFactor(level)=1.2**level`; the global-zoom `main.ts` path is refactored onto it so
  per-type zoom reuses the **same step & bounds** (FR-011).
- **Move-focus is pure core geometry.** `core/workspace/focus-move.ts` derives normalized panel rectangles
  from the split tree for deterministic directional moves (stay-put at the edge) and a stable
  **layout-order** cycle — DOM-free and unit-testable.
- **New tokens auto-expose; new commands take three edits.** Two new colour tokens
  (`activePanelBorder`, `activePanelBorderInactive`) are auto-exposed by the derived theme metadata; the
  nine new commands are registered in `keybindings.ts` + `keybindings-metadata.ts` (hand-authored) + a
  renderer dispatch. **No pointer action control is added**, so the v3.12.0 themeable-icon rule has nothing
  to build (FR-017).

Delivery is **strictly phased, each phase independently visible and E2E-verified** (Principle V; Incremental
Delivery). Phases map to the four user stories: **A (US1 focus context) → B (US2 per-type zoom) → C (US3
keyboard move-focus) → D (US4 survive-layout-changes hardening)**. B depends on A (zoom routes to the active
panel's type); C depends on A (activation moves the focus context); D hardens A–C across layout transitions.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 20 LTS (ESM); React 18.3 (renderer).

**Primary Dependencies**: Electron 43 (UI shell; global-zoom IPC + window chrome already present — no new
main-process seam); React 18 + Vite 7; `@xterm/xterm` 6 + `@xterm/addon-fit` (terminal grid — the fit path
is extended to re-fit on effective-font-size change); CodeMirror 6 (editor — font scaled via a CSS var);
InversifyJS + reflect-metadata (unchanged; no new binding); Vitest (unit) + Playwright-Electron (E2E).
**The daemon, `ipc-contract`, node-pty, better-sqlite3, and `persistence` SQL are untouched.**

**Storage**: **No SQLite schema change; `user_version` unchanged.** Per-type zoom is two integers added to
the **existing per-project layout JSON blob** (`WorkspaceLayout.zoom`), persisted through the existing
`WorkspaceRepository.save/load`. The in-JSON `LAYOUT_SCHEMA_VERSION` goes **2 → 3**; `migrateLayout` gains an
**idempotent** v2→v3 step (absent `zoom` → `{terminal:0, editor:0}`). The active-panel focus context is
**runtime/UI state**, not persisted as durable user data (restored to a sensible default on load), per the
existing `Tab.activePanelId` self-heal.

**Testing**: Vitest **unit** (core, pure): `zoom.ts` (clamp at bounds is a no-op; `zoomFactor` monotonic;
reset→0); `focus-move.ts` (`panelRects` partitions the tree; `moveFocus` returns the correct neighbour and
`null` at an edge; `cycleOrder` is stable layout order + reverse); per-type zoom reducer (bump/clamp/reset
by type); the v2→v3 layout **migration is idempotent** (re-run converges). The **derived** theme-metadata
completeness test and the **hand-authored** keybindings-metadata completeness test both cover the new
tokens/commands (a missing descriptor fails them). Vitest **integration** (persistence): a v2 layout loads,
migrates to v3, round-trips zoom through save/load; migration re-run is safe. **E2E per phase**
(Playwright-Electron, every user-facing change ships passing E2E): A — exactly one active panel, indication
legible on themes in active + dimmed states, dims on window blur, restored active panel on close; B — zoom
one type moves all panels of that type together and nothing else, persists across restart, terminal grid
recomputes, distinct from global-zoom bindings; C — directional + cycle move focus in layout order, stay-put
at edge; D — zoom survives tab-switch/split/join/detach-reattach and focus falls back on close. RGR
mandatory; generated temp files self-clean.

**Target Platform**: Windows 11 desktop (first supported). No OS-specific behaviour is added — window
focus/blur is a DOM event and zoom is renderer/CSS + the existing zoom IPC — so macOS/Linux need no new
seam here.

**Project Type**: Desktop application (Electron UI client + headless daemon), npm-workspaces monorepo
(extends 001–008). **This feature touches `core` and `ui` (renderer + a trivial `main.ts` DRY refactor) and
`persistence` (the v2→v3 layout migration only). The daemon and `ipc-contract` are not modified.**

**Performance Goals**: Zoom and focus changes are effectively instant. A per-type zoom change triggers **at
most one** re-fit + PTY `resize` per visible terminal view and a single CSS-var write for editors; changing
focus alone sends **zero** terminal resizes (FR-004/SC-004, consistent with 008). Move-focus resolves from
the in-memory split tree (no I/O).

**Constraints**: No Docker; npm scripts only. `@throng/core` stays **zero OS/DOM imports** (guard test) —
`zoom.ts`, `focus-move.ts`, the per-type-zoom reducer, and the migration are all pure. The renderer stays
sandboxed; no new preload bridge is required (zoom apply is in-renderer + the existing `terminal.resize`
bridge; global-zoom IPC unchanged). **One IoC composition root per process, unchanged in count** (no new
binding). Zoom bounds/step are the injected/shared constants, not magic numbers (Principle X).

**Scale/Scope**: Single user, single machine, local-only. A window holds a handful to a few dozen panels;
per project there are exactly **two** zoom levels; nine new rebindable commands. Packages touched: `core`
(zoom module; focus-move module; per-type-zoom reducer + `WorkspaceLayout.zoom`; schema bump; two theme
tokens; nine `ActionId`s + defaults + metadata descriptors), `ui` (renderer: two-state indicator + window
focus/blur, zoom apply for terminal/editor, the keydown dispatch for the nine commands, wiring zoom through
the workspace store; main: DRY-import shared zoom constants), `persistence` (v2→v3 `migrateLayout`).

## Constitution Check

*GATE: evaluated against all eleven principles of constitution **v3.12.0** before Phase 0 and re-checked
after Phase 1 design.*

| # | Principle | Verdict | How this plan satisfies it |
|---|-----------|---------|----------------------------|
| I | Project-First Context Isolation | ✅ PASS | Per-type zoom is **per-project** layout state (keyed by `projectId` on `WorkspaceLayout`); the focus context is per-window and never crosses projects. No change to project/terminal isolation. |
| II | Platform-Abstracted Core | ✅ PASS | **No new OS seam.** Window focus/blur is a DOM `window` event in the renderer; zoom apply is CSS + xterm + the existing `terminal.resize` bridge; global-zoom IPC is unchanged. All decision logic (`zoom.ts`, `focus-move.ts`, per-type reducer, migration) is **pure in core** (OS/DOM-free guard holds). |
| III | Detached/Persistent Terminals | ✅ PASS | The daemon/PTY layer is untouched. A per-type zoom change issues a normal `resize(cols,rows)` through the existing bridge (same message the ResizeObserver already sends); no lifecycle change. |
| IV | Native Terminal Support & Auto-Detection | ✅ PASS (N/A) | No shells/detection involved. |
| V | Test-First Quality Discipline | ✅ PASS | Unit (pure `zoom`/`focus-move`/reducer/migration) + integration (v2→v3 round-trip + idempotent re-run) + **E2E for every UI change, green per phase (A–D)**. Both completeness tests (derived theme metadata; hand-authored keybindings metadata) gate the new tokens/commands. RGR per task; temp files self-clean. |
| VI | Simple, Modern, Discoverable UX | ✅ PASS | A legible, theme-driven active-panel indicator (active + dimmed states); zoom/focus reachable by discoverable, rebindable keybindings surfaced in the Key Bindings editor; the active project colour stays dominant. |
| VII | Change Review & Approval | ✅ PASS (N/A) | Not the project edit-list; unaffected. |
| VIII | SOLID/DRY/YAGNI | ✅ PASS | **DRY**: one shared `zoom.ts` for global + per-type range; **reuse** the existing active-Panel ops and layout persistence rather than new stores. **YAGNI**: per-*type* (two levels), not per-instance; no daemon/IPC/DB surface; move-focus scoped to workspace panels. **SRP**: pure geometry/zoom logic in core, apply-effects in the renderer. |
| IX | DI & Composition Root | ✅ PASS | Still three roots, unchanged in count; **no new binding** (no OS seam). Renderer stays a client of core + existing bridges. |
| X | Externalised Configuration | ✅ PASS | Zoom **bounds/step are shared named constants** (`core/config/zoom.ts`), not magic numbers; the nine chords are **user config** (keybindings.json) with sensible injected defaults; the two indicator colours are **theme tokens**. |
| XI | Dockable Workspace: Panes, Tabs & Panels | ✅ PASS | The docking model is unchanged. Move-focus **reads** the existing split tree; the active-panel context is per-window (FR-006) and explicitly **distinct from the OS focus/raise group** (`window-manager.ts`), which this feature does not touch. |

**Configuration-editor completeness (v3.11.0)** ✅ — the two new colour tokens are auto-exposed by the
**derived** `THEME_METADATA` + `toCssVariables`; the nine new commands get hand-authored
`keybindings-metadata` descriptors. Both completeness tests fail if a descriptor is missing.

**Themeable icon controls (v3.12.0)** ✅ — **no pointer-operable action control is added** (zoom/focus are
keybinding-driven). FR-017 binds only a *visible* control; none is introduced, so there is nothing to
theme. Recorded for the reviewer.

**Idempotent migrations (v3.5.0)** ✅ — the v2→v3 layout migration guards on `schemaVersion`/absent `zoom`
and converges on re-run; an integration test asserts it.

**Gate result: PASS — no violations.** Deliberate, compliant decisions are recorded under
[Complexity Tracking](#complexity-tracking).

## Phased Delivery

Each phase is an independently shippable, **independently E2E-verified** increment. The user reviews the
running result of each phase before the next starts.

| Phase | Delivers (verify point) | Touches | E2E gate |
|------|--------------------------|---------|----------|
| **A — Focus context (US1)** | Two new theme colour tokens (`activePanelBorder` active + `activePanelBorderInactive` dimmed); the active-panel indicator draws from the **active** token when the window is foreground and the **dimmed** token on window blur (persists, never disappears); keyboard/pointer activation routes input + panel-scoped commands to exactly one panel per window; **deterministic** fallback when the active panel is destroyed (the preceding panel in depth-first layout order, else the following one — FR-005). Distinct from the OS focus/raise group. | `core/config/theme.ts` (2 tokens), `core/workspace/operations.ts` (`panelAfterRemoval` fallback helper), `ui` renderer (`panel-placeholder.tsx` two-state class + window focus/blur hook, `theme.css`) | Exactly one active panel; indication legible (WCAG AA ≥3:1) in active + dimmed states on every bundled theme; dims on window blur & restores on focus; closing the active panel moves focus to the FR-005 deterministic target (never inputless). |
| **B — Per-type zoom (US2)** | `core/config/zoom.ts` (shared step/bounds + `zoomFactor`); `main.ts` refactored onto it (DRY); `WorkspaceLayout.zoom` + schema **v3** + idempotent v2→v3 migration; per-type-zoom reducer (bump/clamp/reset **by the active panel's type**); commands `panel.zoomIn/out/reset` (`Ctrl+Alt+=`/`-`/`0`, distinct from global) + metadata; apply — terminals re-`fit()`+`resize`, editors scale via `--throng-zoom-editor`; **composition on top of global zoom**. | `core` (zoom module, reducer, model+schema, ActionId+defaults+metadata), `ui` main (`main.ts` DRY import), `ui` renderer (zoom store wiring, `use-terminal.ts` re-fit, editor CSS var, keydown dispatch), `persistence` (`migrateLayout` v2→v3) | Zooming a terminal moves **all** terminals together, editors + chrome unchanged (and vice-versa); reset returns a type to default; level persists across restart; terminal grid recomputes legibly; bindings appear in the Key Bindings editor, distinct from global zoom. |
| **C — Keyboard move-focus (US3)** | `core/workspace/focus-move.ts` (`panelRects`, `moveFocus` directional with stay-put-at-edge, `cycleOrder`/`nextInCycle` layout-order); commands `focus.left/right/up/down` (`Ctrl+Alt+Arrow`) + `focus.cycle`/`focus.cycleBack` (``Ctrl+` ``/``Ctrl+Shift+` ``) + metadata; renderer dispatch → `setActivePanel`. | `core` (focus-move module, ActionId+defaults+metadata), `ui` renderer (keydown dispatch → workspace store) | Directional + cycle move the active panel in stable layout order; a directional move at the layout edge stays put (no wrap, no error); bindings appear + rebindable; input routing follows focus. |
| **D — Survive layout changes (US4)** | Hardening + coverage: per-type zoom (project-scoped) is correctly reflected after tab switch, pane split/join, and sub-workspace **detach/reattach**; a sensible panel stays active across every transition (close, split, detach, reattach). Largely test + small fixes on top of A–C. | `ui` renderer (activation on transitions if gaps found), `core` (any op-level fallback), tests | After each layout transition exactly one panel is active on a reasonable panel, and each type's zoom level is retained (unchanged by structural change). |

## Project Structure

### Documentation (this feature)

```text
specs/012-focus-contexts-and-zoom/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 — decisions D1–D8
├── data-model.md        # Phase 1 — WorkspaceLayout.zoom, schema v3, zoom & focus-move types, tokens, commands
├── quickstart.md        # Phase 1 — phased validation/run guide (A → D)
├── contracts/           # Phase 1
│   ├── zoom.md              # core zoom module: constants, clampZoomLevel, zoomFactor; per-type reducer; composition
│   ├── focus-move.md        # core focus-move: panelRects, moveFocus (edge→null), cycleOrder/nextInCycle
│   ├── layout-schema-v3.md  # WorkspaceLayout.zoom + idempotent v2→v3 migrateLayout
│   └── commands-and-tokens.md # 9 ActionIds + default chords + metadata descriptors; 2 theme colour tokens
├── checklists/
│   └── requirements.md  # spec quality checklist (16/16)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Extends the existing monorepo. **New** files marked `(new)`; **extended** marked `(ext)`. Phase tags
`[A]…[D]` show when each lands.

```text
packages/
├── core/
│   ├── src/
│   │   ├── config/
│   │   │   ├── zoom.ts                  # (new)[B] ZOOM_STEP/MIN/MAX, clampZoomLevel, zoomFactor(level)=1.2**level
│   │   │   ├── theme.ts                 # (ext)[A] add colours.activePanelBorder + activePanelBorderInactive (auto-exposed)
│   │   │   ├── keybindings.ts           # (ext)[B/C] add ActionIds panel.zoom* + focus.* and DEFAULT_KEYBINDINGS chords
│   │   │   └── keybindings-metadata.ts  # (ext)[B/C] "Focus & Zoom" group: chord() descriptor per new command
│   │   ├── workspace/
│   │   │   ├── model.ts                 # (ext)[B] WorkspaceLayout.zoom?: {terminal:number;editor:number}; LAYOUT_SCHEMA_VERSION 2→3
│   │   │   ├── operations.ts            # (ext)[A/B] per-type zoom reducer (bumpZoom/resetZoom by type); panelAfterRemoval(root,removedId) deterministic FR-005 fallback
│   │   │   └── focus-move.ts            # (new)[C] panelRects, moveFocus(root,activeId,dir)->id|null, cycleOrder, nextInCycle
│   │   └── index.ts                     # (ext) export zoom.ts, focus-move.ts, new ops
│   └── tests/unit/                       # (ext) zoom.test.ts, focus-move.test.ts, per-type-zoom reducer, migrate-v3 idempotent, metadata completeness (auto)
│
├── persistence/
│   ├── src/workspace-repository.ts       # (ext)[B] migrateLayout: add idempotent v2→v3 (absent zoom -> {0,0})
│   └── tests/integration/                # (ext)[B] workspace-layout-v3.integration.test.ts (load v2 -> v3, round-trip zoom, re-run safe)
│
└── ui/
    ├── src/
    │   ├── main/main.ts                  # (ext)[B] import ZOOM_STEP/limit from @throng/core (DRY); behaviour unchanged
    │   └── renderer/
    │       ├── state/workspace-store.tsx # (ext)[B] expose zoom state + bumpZoom/resetZoom(type); route to save (debounced)
    │       ├── workspace/
    │       │   ├── panel-placeholder.tsx # (ext)[A] two-state active class; consume window focus/blur
    │       │   └── use-window-focus.ts   # (new)[A] tiny hook: subscribe to window 'focus'/'blur' -> boolean
    │       ├── terminal/use-terminal.ts  # (ext)[B] effective fontSize = base×zoomFactor(terminalLevel); re-fit()+resize on change
    │       ├── editor/editor.css         # (ext)[B] font-size: calc(var(--throng-font-editor-size) * var(--throng-zoom-editor,1))
    │       ├── app.tsx                    # (ext)[B/C] KeybindingsHandler: dispatch panel.zoom* + focus.* to the workspace store
    │       ├── workspace/workspace.css    # (ext)[B] set --throng-zoom-editor on the workspace root from editor level
    │       └── theme.css                  # (ext)[A] .panel-box--active uses --throng-colour-activePanelBorder / …Inactive
    ├── tests/unit/                        # (ext) window-focus hook, dispatch mapping
    └── tests/e2e/                         # (ext) focus-context.e2e.ts [A], panel-zoom.e2e.ts [B], move-focus.e2e.ts [C], focus-zoom-layout.e2e.ts [D]
```

**Structure Decision**: Extend the 001–008 monorepo. **All decision logic is pure in `@throng/core`** — the
shared zoom range/mapping, the split-tree focus-move geometry, the per-type-zoom reducer, the layout-schema
bump + idempotent migration, and the two new theme tokens (auto-exposed) + nine command descriptors. The
**renderer owns the apply-effects** — the two-state indicator (window focus/blur), the terminal re-fit + PTY
resize, the editor CSS scale var, and the keydown dispatch — reusing the existing active-Panel ops, layout
persistence, and `terminal.resize` bridge. The **only main-process change is a DRY import** of the shared
zoom constants. **No daemon, `ipc-contract`, or SQLite DDL** is added; the layout blob's `schemaVersion`
goes 2 → 3.

## Complexity Tracking

> No Constitution Check violations. Rows below are deliberate, compliant decisions recorded for reviewer
> scrutiny (Dev Workflow gate). This feature **advances** the ROADMAP "per-panel zoom / keyboard focus"
> items (deferred from 008) to delivered.

| Decision | Why needed | Alternative rejected because |
|----------|------------|------------------------------|
| **Per-type zoom (2 levels/project) on the layout blob, not per Panel** | The clarified granularity is per panel *type*; two project-scoped numbers ride the existing layout persistence with no new surface. | *Per-panel-instance on `Panel.config`* — contradicts the clarified spec and multiplies state; *a new config file* — zoom is per-project layout state, not user-global config. |
| **Keep global zoom untouched; per-type is an orthogonal font scale** | "Compose on top" falls out for free because `setZoomLevel` rescales the whole page over the content font. | *Couple the two explicitly / retire global zoom* — rejected by clarification and adds needless coupling. |
| **Shared `zoom.ts` range reused by global + per-type** | The clarified bounds/step are "same as global zoom"; one authoritative range (DRY) keeps steps perceptually identical and bound-hits a no-op. | *A separate per-type range* — rejected by clarification and duplicates a tuned constant. |
| **Move-focus from tree geometry, not DOM rects** | Deterministic, DOM-free, unit-testable in core; the split tree already encodes orientation + sizes. | *Measure DOM* — non-deterministic and untestable in core. |
| **Extend the existing active-Panel model, not a new focus store** | The per-window active Panel already ships (self-healing, window-local); 012 only adds the dimmed state, keyboard activation, and destroy-fallback. | *A parallel focus subsystem* — duplicates shipped infra (DRY) and risks conflating with the OS focus/raise group. |
| **In-JSON layout migration v2→v3, no SQLite DDL** | Zoom is two fields on the JSON layout doc; the blob already has a `schemaVersion` + `migrateLayout` path. | *A settings/zoom table* — rejected (YAGNI); `user_version` and the DB stay unchanged. |

> **ROADMAP ledger:** the 008-deferred "per-panel text zoom" and "keyboard focus scoping" advance toward
> delivered here; terminal-/editor-specific key-binding **sets** and full keyboard-only accessibility
> (issue #26) remain tracked future scope (spec Out of Scope), not weakened.
