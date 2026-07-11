# Phase 1 Data Model: Focus Contexts & Per-Panel Zoom

**Feature**: 012-focus-contexts-and-zoom | **Date**: 2026-07-11

No SQLite schema change (`user_version` unchanged). The only persisted change is **two integer fields on the
existing per-project layout JSON blob**, guarded by an in-JSON schema bump. Everything else is pure
runtime/domain logic in `@throng/core`.

---

## 1. Persisted: `WorkspaceLayout.zoom` (layout blob, schema v2 → v3)

`packages/core/src/workspace/model.ts`

```ts
/** Per-panel-TYPE zoom levels for a project (012). One level for all terminals,
 *  one for all editors. A level is an integer-stepped value in the shared zoom
 *  range (see config/zoom.ts); 0 = inherited (no adjustment). */
export interface PanelTypeZoom {
  terminal: number; // zoom level for every terminal panel in this project
  editor: number;   // zoom level for every editor panel in this project
}

export interface WorkspaceLayout {
  projectId: string;
  schemaVersion: number;   // now 3
  tabs: Tab[];
  activeTabId: string;
  zoom?: PanelTypeZoom;     // (new)[012] absent in v2 docs -> treated as {terminal:0, editor:0}
}

export const LAYOUT_SCHEMA_VERSION = 3; // was 2 (008/003); v3 adds WorkspaceLayout.zoom
```

**Validation / invariants**
- `zoom.terminal` and `zoom.editor` are always **clamped** into `[ZOOM_MIN_LEVEL, ZOOM_MAX_LEVEL]` before
  persistence (the reducer clamps; a hand-edited out-of-range JSON is clamped on load).
- Absent `zoom` is **not** an error and needs no migration content beyond the default (FR-010).
- `zoom` is **per project** (rides `WorkspaceLayout`, keyed by `projectId`) — shared across all windows and
  sub-workspaces showing that project's panels (so detach/reattach shows the same level, FR-010/US4).

**Migration (idempotent, v3.5.0)** — `packages/persistence/src/workspace-repository.ts` `migrateLayout`:
```
if doc.schemaVersion < 3:
    doc.zoom = doc.zoom ?? { terminal: 0, editor: 0 }   // additive, guarded
    doc.schemaVersion = 3
# re-running against a v3 doc is a no-op (guard on <3); an already-present zoom is preserved
```

## 2. Pure: shared zoom range & mapping — `config/zoom.ts` (new)

`packages/core/src/config/zoom.ts`

```ts
export const ZOOM_STEP = 0.5;        // one keypress step (identical to main.ts global zoom)
export const ZOOM_MIN_LEVEL = -5;    // == -ZOOM_LIMIT
export const ZOOM_MAX_LEVEL = 5;     // ==  ZOOM_LIMIT

/** Clamp a raw level into the shared bounds. */
export function clampZoomLevel(level: number): number;

/** Electron's zoom-level -> scale ratio; per-type effective font = basePx * zoomFactor(level). */
export function zoomFactor(level: number): number; // = 1.2 ** level

/** Step a level by n presses (n>0 in, n<0 out), clamped; used by global AND per-type. */
export function stepZoomLevel(level: number, presses: number): number; // clamp(level + presses*ZOOM_STEP)
```

- `main.ts` global-zoom (`ZOOM_STEP`/`ZOOM_LIMIT`) is refactored to import `ZOOM_STEP` / `ZOOM_MIN/MAX`
  from here (DRY, D3). Behaviour is byte-identical.
- **Bound behaviour (FR-011)**: `stepZoomLevel` at a bound returns the same level → the caller applies no
  change (no-op / soft signal), never illegible/unbounded.

## 3. Pure: per-type zoom reducer — `workspace/operations.ts` (ext)

Operates on `WorkspaceLayout` given the **active panel's kind**:

> **Terminology (M1)**: the spec's "panel **type**" is the code's `PanelKind` / `kind`. `zoomBucketOf(kind)`
> maps a panel's `kind` to exactly one of the two spec **types** (`'terminal'` | `'editor'`). "type" (spec)
> ⇄ "kind" (code) throughout.

```ts
/** Which per-type bucket a panel maps to. Terminals -> 'terminal'; editor & any
 *  text-content kind -> 'editor' (the two buckets the spec defines). */
export function zoomBucketOf(kind: PanelKind | undefined): 'terminal' | 'editor';

/** Bump the zoom LEVEL of the active panel's type by n presses (clamped). No-op
 *  at a bound. Returns a new layout (immutable). */
export function bumpZoom(layout: WorkspaceLayout, activeKind: PanelKind | undefined, presses: number): WorkspaceLayout;

/** Reset the active panel's TYPE to level 0 (idempotent). */
export function resetZoom(layout: WorkspaceLayout, activeKind: PanelKind | undefined): WorkspaceLayout;

/** Read the effective level for a type (absent zoom -> 0). */
export function zoomLevelOf(layout: WorkspaceLayout, bucket: 'terminal' | 'editor'): number;
```

- **Per-type semantics (FR-007/008)**: `bumpZoom`/`resetZoom` change the whole *type's* level, so every
  panel of that type re-renders together and the other type + chrome are untouched.

### Deterministic focus fallback (FR-005)

```ts
/** The panel that becomes active when `removedId` is removed from the tab: the
 *  panel immediately PRECEDING it in depth-first layout order, or the one
 *  immediately FOLLOWING it when the removed panel was first. undefined only when
 *  no panel remains. Deterministic + testable (no "sensible"). */
export function panelAfterRemoval(root: LayoutNode, removedId: string): string | undefined;
```

- Layout order is the same depth-first leaf order used by focus-cycle (`cycleOrder`, §4), so fallback and
  cycle agree. Self-contained in `operations.ts` (US1) so the MVP does not depend on the US3 focus-move
  module.

## 4. Pure: move-focus geometry — `workspace/focus-move.ts` (new)

`packages/core/src/workspace/focus-move.ts`

```ts
export interface Rect { x: number; y: number; w: number; h: number; } // normalized [0,1]^2
export type Direction = 'left' | 'right' | 'up' | 'down';

/** Assign every Panel in the split tree a normalized rectangle: a 'row' split
 *  divides x by its fractional sizes, a 'column' split divides y. */
export function panelRects(root: LayoutNode): Map<string, Rect>;

/** Nearest panel on the `dir` side of `activeId` overlapping it on the
 *  perpendicular axis, or null when none exists (caller keeps focus put — the
 *  clarified stay-put-at-edge, no wrap). */
export function moveFocus(root: LayoutNode, activeId: string, dir: Direction): string | null;

/** Stable in-order DFS leaf sequence = layout order (panes L->R, T->B; tabs in order). */
export function cycleOrder(root: LayoutNode): string[];

/** Next/prev panel id in the cycle order (wraps within the ordered ring for CYCLE only). */
export function nextInCycle(order: string[], activeId: string, step: 1 | -1): string;
```

- **Directional** never wraps (edge → `null`, FR-015/US3-2). **Cycle** advances through the ordered ring;
  reverse steps back through the same order (US3-2 / SC-008a).
- All functions are deterministic and DOM-free (no `Date`/random), unit-testable in core.

## 5. Theme tokens (auto-exposed) — `config/theme.ts` (ext)

Add to `THRONG_THEME.colours`:

| Token | Meaning | Default (in `throng` theme) |
|---|---|---|
| `activePanelBorder` | active-panel indicator when the window IS the foreground OS window | a legible accent (e.g. reuse the current `#6aa3ff` family); **≥ 3:1** vs the adjacent panel background (WCAG AA non-text, SC-001) |
| `activePanelBorderInactive` | dimmed indicator when the window is background | a muted/desaturated variant; deliberately de-emphasised, held to the **lower ≥ 1.5:1** floor (SC-001), not the full 3:1 |

- Emitted as `--throng-colour-activePanelBorder` / `--throng-colour-activePanelBorderInactive` by
  `toCssVariables`; **automatically** described by the derived `THEME_METADATA` and covered by the theme
  completeness test — no metadata edit (FR-002, v3.11.0). All 14 bundled themes populate them (the derived
  default source seeds sensible values; themes may override). **Contrast targets differ by state**: the
  active token must clear 3:1; the inactive token only the 1.5:1 de-emphasis floor — so "dimmed" and
  "still identifiable" do not conflict (SC-001).

## 6. Commands (config) — `config/keybindings.ts` + `keybindings-metadata.ts` (ext)

New `ActionId`s + `DEFAULT_KEYBINDINGS` (all rebindable; zoom distinct from global `zoom.*`):

| ActionId | Default chord | Group (metadata) |
|---|---|---|
| `panel.zoomIn` | `Ctrl+Alt+=` (+ `Ctrl+Alt++`) | Focus & Zoom |
| `panel.zoomOut` | `Ctrl+Alt+-` | Focus & Zoom |
| `panel.zoomReset` | `Ctrl+Alt+0` | Focus & Zoom |
| `focus.left` / `focus.right` / `focus.up` / `focus.down` | `Ctrl+Alt+Left/Right/Up/Down` | Focus & Zoom |
| `focus.cycle` / `focus.cycleBack` | ``Ctrl+` `` / ``Ctrl+Shift+` `` | Focus & Zoom |

- `keybindings-metadata.ts` is **hand-authored**: each new command needs a `chord(actionId, 'Focus & Zoom',
  label, description)` descriptor or the keybindings completeness test fails.

## 7. Runtime (not persisted): focus-context UI state

- **Active panel** — the existing per-Tab `activePanelId` (`Tab.activePanelId`, self-healed by
  `effectiveActivePanelId`), window-local. 012 does not persist it as durable user data (restored to a
  sensible default on load; FR-001/005/006).
- **Window-foreground flag** — a renderer-only boolean from the DOM `window` `focus`/`blur` events, chosen
  by `use-window-focus.ts`; selects which indicator token the active panel draws from (FR-002 / D6). Not
  persisted.
