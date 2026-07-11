# Phase 0 Research: Focus Contexts & Per-Panel Zoom

**Feature**: 012-focus-contexts-and-zoom | **Date**: 2026-07-11

All spec clarifications were resolved in the two 2026-07-11 `/speckit-clarify` sessions (see spec.md
§Clarifications). This document records the **technical** decisions that turn those answers into an
implementable design, grounded in the existing 001–008 codebase.

---

## D1 — Per-*type* zoom state lives on `WorkspaceLayout` (2 levels/project), schema v2→v3

**Decision**: Model per-type zoom as **two integer-stepped levels per project** —
`zoom?: { terminal: number; editor: number }` added to `WorkspaceLayout`
(`packages/core/src/workspace/model.ts`). Bump `LAYOUT_SCHEMA_VERSION` **2 → 3**; migrate v2 docs by
defaulting `zoom` absent → both levels `0` (inherited). The layout is already persisted **whole as a JSON
blob** via `WorkspaceRepository` (SQLite `workspace_layout` doc), so this is an **in-JSON migration only —
no SQLite DDL and `user_version` is untouched**.

**Rationale**: The clarified persistence granularity is **per panel type** (one level for all terminals,
one for all editors), persisted per project. That is exactly two numbers per project — far too coarse to
sit on individual `Panel.config`, and naturally the same scope as `WorkspaceLayout` (already keyed by
`projectId`). Riding the existing blob reuses the whole save/load/migrate path (`migrateLayout`,
persistence `:145`) with zero new persistence surface.

**Alternatives rejected**:
- *Per-panel-instance zoom on `Panel.config`* — rejected: the user explicitly chose per-type over
  per-instance; storing per instance would contradict the spec and multiply state pointlessly.
- *A separate settings/keybindings-style config file* — rejected: zoom is per-*project* layout state, not
  user-global config; it belongs with the layout it travels with (detach/reattach, restart).

## D2 — Zoom is an orthogonal font-scale; it **composes** with Electron global zoom for free

**Decision**: Keep the **app-wide global zoom exactly as-is** (`webContents.setZoomLevel`, whole-window,
`main.ts:108-142`). Per-type zoom is a **separate content-font-scale**: for each type, the *effective*
font size = `baseFontPx × zoomFactor(typeLevel)`. Because `setZoomLevel` rescales the entire rendered page
(including the already-scaled content font), the **composition is automatic and multiplicative** —
effective on-screen size = `globalPageScale × (baseFontPx × zoomFactor(typeLevel))` — with **no explicit
coupling code**. This is precisely the "compose on top" model the spec fixed.

**Rationale**: Global zoom and per-type zoom act on different layers (page transform vs. content font
size), so multiplying is what the browser already does. Retaining `setZoomLevel` untouched keeps chrome +
all panels scaling under global zoom while per-type only nudges one content type.

**Alternatives rejected**: *Retire global zoom / make per-type replace it* — rejected by clarification
(global zoom is retained). *Have per-type zoom bypass global for its panel* — rejected by clarification.

## D3 — Reuse global zoom's step & bounds; convert level→factor with the standard ratio

**Decision**: Extract the global zoom constants into a **pure core module** `packages/core/src/config/zoom.ts`:
`ZOOM_STEP = 0.5`, `ZOOM_MIN_LEVEL = -5`, `ZOOM_MAX_LEVEL = +5` (identical to `main.ts` `ZOOM_STEP` /
`±ZOOM_LIMIT`), plus `clampZoomLevel(level)` and `zoomFactor(level) = 1.2 ** level` (Electron's own
zoom-level→scale ratio). The global-zoom `main.ts` path is refactored to import these constants (DRY);
per-type zoom uses the **same** step/bounds and stores an integer-stepped **level** (default 0).

**Rationale**: The clarification fixed per-type bounds/step as "the same as the app-wide global zoom". Both
mechanisms now share one authoritative range and the standard `1.2^level` mapping, so a per-type zoom step
is perceptually identical to a global zoom step, and a bound hit is a no-op (FR-011).

**Alternatives rejected**: *Independent ±10%/50–300% range* or *discrete point sizes* — rejected by
clarification (parity with global zoom chosen).

## D4 — Move-focus is pure core geometry over the split tree (deterministic, DOM-free)

**Decision**: Add a pure module `packages/core/src/workspace/focus-move.ts`:
- `panelRects(root: LayoutNode): Map<string, Rect>` — walk the split tree assigning each Panel a
  normalized `[0,1]²` rectangle (a `row` split divides **x** by its fractional `sizes`; a `column` split
  divides **y**).
- `moveFocus(root, activeId, dir): string | null` — pick the **nearest** Panel on the `dir` side whose
  rectangle overlaps the active Panel on the perpendicular axis; return `null` when there is none (→ the
  caller keeps focus put — the clarified "stay put, no wrap").
- `cycleOrder(root): string[]` — in-order DFS leaf sequence = **layout order** (panes L→R, T→B; tabs in
  order); `nextInCycle(order, activeId, +1|-1)` steps forward/backward.

**Rationale**: The clarified cycle order is a **stable layout order independent of focus history**, and
directional moves must be deterministic and unit-testable. Deriving rectangles from the tree's own
orientation + `sizes` gives both directional and cycle traversal from one pure structure — no DOM
measurement, no `Date`/random, fully testable in core (Principle II/V). Edge behaviour ("stay put") is just
`moveFocus` returning `null`.

**Alternatives rejected**: *Measure DOM rects in the renderer* — rejected: non-deterministic, untestable in
core, and unnecessary since the split tree already encodes geometry. *MRU cycle order* — rejected by
clarification. **Scope note**: move-focus operates over the **active Tab's workspace split tree** (the US3
subject); it does not traverse into the sidebar/File-Explorer pane (a separate `ActivePane` concern) — kept
distinct to stay bounded (YAGNI) and recorded as an Assumption.

## D5 — Focus context builds on the **existing** window-local active-Panel infra

**Decision**: US1 **extends** what already ships rather than introducing a parallel model. The core ops
`effectiveActivePanelId(tab)` / `setActivePanel(layout, tabId, panelId)` (`operations.ts`) and the
renderer's `.panel-box--active` indicator (`panel-placeholder.tsx`) already provide a **per-window**,
self-healing active Panel (window-local by design — `workspace-store.tsx:62-65`). 012 adds: (a) the
**two-state (active/dimmed-inactive) indicator** driven by window focus/blur; (b) **keyboard activation**
via the move-focus commands (FR-003/US3); (c) explicit **fallback-on-destroy** coverage (FR-005). It stays
strictly distinct from the OS-level **focus/raise group** (`main/window-manager.ts`), which governs window
Z-order, not the active Panel.

**Rationale**: Reuse over reinvention (DRY/YAGNI); the existing model is already the "focus context" the
spec describes, and keeping it per-window matches FR-006. Distinctness from `window-manager.ts` is called
out so the two "focus" concepts never conflate (spec Out-of-Scope).

## D6 — Two-state indicator = window focus/blur + two auto-exposed theme colour tokens

**Decision**: Add **two colour tokens** to `THRONG_THEME.colours` (`packages/core/src/config/theme.ts`):
`activePanelBorder` (active-window treatment) and `activePanelBorderInactive` (dimmed treatment). The
renderer detects the panel's window losing OS foreground via the DOM `window` `blur`/`focus` events and
swaps which token the active-panel indicator draws from. Because `THEME_METADATA` is **derived** from the
theme and `toCssVariables` emits `--throng-colour-*` for every colour, **both tokens are automatically
exposed in the Themes editor and covered by the completeness test with no metadata edit** (constitution
v3.11.0).

**Rationale**: The clarified behaviour is "persist dimmed" with a distinct inactive token. DOM window
focus/blur is a renderer-only signal (no new OS seam, Principle II). The derived-metadata pipeline makes
adding tokens a one-file change that stays governance-complete.

**Alternatives rejected**: *Hide indicator on blur* / *keep identical on blur* — rejected by clarification.
*A new IPC focus signal from main* — rejected (YAGNI): the DOM already fires window blur/focus in the
renderer.

## D7 — Apply per-type zoom: terminal via re-`fit()`+PTY resize; editor via a root CSS scale var

**Decision**:
- **Terminal**: pass `fontSize = round(baseTerminalPx × zoomFactor(terminalLevel))` into xterm; on a level
  change, update `term.options.fontSize` **and re-run `FitAddon.fit()` then `bridge.resize(panelId, cols,
  rows)`** (today `use-terminal.ts` hot-reloads font size but does **not** re-fit on font change — this is
  the one real gap to close). Honours FR-012: the grid derives from the view's pixel size **and** the
  terminal type's effective size.
- **Editor**: expose a single root-level CSS custom property `--throng-zoom-editor` (= `zoomFactor(editorLevel)`)
  on the workspace container; the editor font-size becomes `calc(var(--throng-font-editor-size) ×
  var(--throng-zoom-editor))`. One variable → **all editors scale together** (per-type), and file content
  is untouched (FR-013).

**Rationale**: Terminals need a real grid recompute (cols/rows) so output stays legible (SC-005); editors
are CSS-font-driven already, so a single shared scale var is the minimal, per-type-correct lever.

## D8 — New commands, defaults, and the three registration touch-points

**Decision**: Add command IDs to `ActionId` (`keybindings.ts`): `panel.zoomIn` / `panel.zoomOut` /
`panel.zoomReset` and `focus.left` / `focus.right` / `focus.up` / `focus.down` / `focus.cycle` /
`focus.cycleBack`. Shipped **defaults** (all rebindable, all **distinct** from global `zoom.*`):

| Command | Default chord |
|---|---|
| `panel.zoomIn` / `panel.zoomOut` / `panel.zoomReset` | `Ctrl+Alt+=` / `Ctrl+Alt+-` / `Ctrl+Alt+0` |
| `focus.left/right/up/down` | `Ctrl+Alt+Left/Right/Up/Down` |
| `focus.cycle` / `focus.cycleBack` | ``Ctrl+` `` / ``Ctrl+Shift+` `` |

Each new command is registered in **three places** (the same discipline the codebase already uses):
`keybindings.ts` (`ActionId` + `DEFAULT_KEYBINDINGS`), `keybindings-metadata.ts` (a `chord(...)` descriptor
in a new **"Focus & Zoom"** group — this registry is **hand-authored**, so the completeness test fails
without it), and a **renderer keydown dispatch** (extend the `app.tsx` `KeybindingsHandler`, routing to the
workspace store / new zoom+focus actions).

**Rationale**: Mirrors the existing `zoom.*` wiring; the move-focus defaults are the clarified chords and
the panel-zoom defaults are a sensible `Ctrl+Alt+…` family kept distinct from the global `Ctrl+…` zoom.
`Ctrl+Alt+=`/`-`/`0` for zoom and `Ctrl+Alt+Arrow` for focus share the modifier but never the key.

**Known conflict (K1)**: `Ctrl+Alt+Arrow` is bound by some Intel/AMD Windows graphics drivers to **display
rotation**, which can intercept the combo before throng sees it. Since all chords are rebindable, an
affected user reassigns the move-focus commands (or disables the driver hotkey); throng does not override
OS/driver hotkeys. The clarified default is kept for the common case where the driver hotkey is absent —
recorded in spec Assumptions so it is not a surprise.

**FR-017 (themeable icon controls, v3.12.0)**: this feature adds **no pointer-operable action control** —
zoom and move-focus are command/keybinding-driven only. The rule is therefore satisfied with nothing to
build; *were* a visible affordance added later it MUST be a themeable icon with a hover title. Recorded so
the reviewer can confirm no text-labelled control was introduced.
