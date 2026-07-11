# Quickstart: Focus Contexts & Per-Panel Zoom — Validation Guide

**Feature**: 012-focus-contexts-and-zoom

Phased validation. Each phase lands green (unit + integration + E2E) before the next. Build/test with the
existing scripts.

## Prerequisites

```bash
npm install
npm run build           # builds all workspaces (pretest for e2e)
npm run test:unit       # core unit (zoom, focus-move, reducer, migration, completeness)
npm run test:integration# persistence v2->v3 round-trip + idempotent re-run
npm run test:e2e        # Playwright-Electron per-phase specs
```

Config lives per-user (`%USERPROFILE%\.throng`); keybindings are in `keybindings.json` and themes under
`themes\`. Per-type zoom is per-project layout state (restored with the project).

## Phase A — Focus context (US1)

1. Open a window with ≥ 2 panels of different types (a terminal + an editor). Click one, then the other →
   **exactly one** panel shows the active indicator at a time.
2. Apply several bundled themes → the active indicator is legible in both its **active** and
   **dimmed-inactive** states (colours from `activePanelBorder` / `activePanelBorderInactive`).
3. Bring another OS window to the foreground → the active-panel indicator **persists but dims**; refocus the
   throng window → it brightens. The active panel does not change.
4. Close/destroy the active panel → focus falls back to the deterministic FR-005 target (the preceding
   panel in layout order); the window is never left with input routed nowhere.

**E2E**: `packages/ui/tests/e2e/focus-context.e2e.ts`.

## Phase B — Per-type zoom (US2)

1. Open two terminals and two editors. Focus a terminal, press `Ctrl+Alt+=` several times → **every**
   terminal grows together; **both editors and the chrome are unchanged**. Focus an editor, `Ctrl+Alt+=` →
   both editors grow; terminals unchanged.
2. `Ctrl+Alt+0` on a terminal → all terminals return to default (idempotent if already default).
3. Confirm the terminal grid re-computes: zoomed terminals stay legible and report a sensible cols×rows (no
   garbled view).
4. Restart throng / reopen the project → each **type** reopens at its last level (persisted in the layout).
5. Global zoom still works (`Ctrl+=`) and **composes**: a per-type-zoomed editor scales further under global
   zoom, and both are well-defined.
6. Open the Key Bindings editor → `panel.zoomIn/out/reset` appear under **Focus & Zoom**, rebindable, and
   **distinct** from the global `zoom.*` rows.

**E2E**: `packages/ui/tests/e2e/panel-zoom.e2e.ts`.

## Phase C — Keyboard move-focus (US3)

1. With several panels split across the tab, press `Ctrl+Alt+Right/Left/Up/Down` → the active indicator and
   input routing move to the adjacent panel in that direction.
2. At a layout edge, a directional move with no panel that way → focus **stays put**, no error.
3. ``Ctrl+` `` / ``Ctrl+Shift+` `` cycle forward/backward through panels in **layout order** (independent of
   which panel was focused before); a full cycle visits each panel once.
4. Key Bindings editor lists `focus.left/right/up/down/cycle/cycleBack`, rebindable.

**E2E**: `packages/ui/tests/e2e/move-focus.e2e.ts`.

## Phase D — Survive layout changes (US4)

1. Zoom a type, then switch tabs and back → zoom unchanged, a sensible panel active in each tab.
2. Split / join panes → exactly one panel active, no type's zoom lost or altered.
3. Tear a panel into a sub-workspace and merge it back → it shows its **type's** zoom level; a sensible
   panel is active in each window (the per-project zoom is the same in both).
4. Close the active panel mid-layout → focus moves to a neighbour, never inputless.

**E2E**: `packages/ui/tests/e2e/focus-zoom-layout.e2e.ts`.

## Acceptance cross-reference

| Success criterion | Verified by |
|---|---|
| SC-001 / SC-001a (one active; legible both states; dims on blur) | Phase A E2E |
| SC-002 / SC-003 (per-type zoom isolation; persisted) | Phase B E2E + persistence integration |
| SC-004 (focus change → 0 terminal resizes) | Phase A/C E2E (resize-count probe, per 008 SC-003) |
| SC-005 (zoomed terminal legible grid) | Phase B E2E |
| SC-006 (fallback on destroy) | Phase A/D E2E |
| SC-007 (commands discoverable + rebindable, distinct from global) | Phase B/C E2E + keybindings completeness unit |
| SC-008 / SC-008a (keyboard focus+zoom; stable cycle) | Phase C E2E + focus-move unit |
