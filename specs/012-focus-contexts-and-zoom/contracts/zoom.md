# Contract: Per-Type Zoom (`@throng/core` `config/zoom.ts` + `workspace/operations.ts`)

Pure, DOM-free. Consumed by the renderer (apply) and `main.ts` (global-zoom range, DRY).

## Constants & mapping (`config/zoom.ts`)

| Symbol | Value | Note |
|---|---|---|
| `ZOOM_STEP` | `0.5` | one keypress step; **identical** to the global-zoom step (FR-011) |
| `ZOOM_MIN_LEVEL` / `ZOOM_MAX_LEVEL` | `-5` / `+5` | == `∓ZOOM_LIMIT` of global zoom |
| `clampZoomLevel(level)` | → `[MIN,MAX]` | out-of-range (incl. hand-edited JSON) is clamped |
| `zoomFactor(level)` | `1.2 ** level` | effective font px = `baseFontPx × zoomFactor(level)` |
| `stepZoomLevel(level, presses)` | `clamp(level + presses*STEP)` | at a bound returns the same level → caller no-ops |

**Composition (FR-008, D2)**: per-type zoom only sets content font size. The app-wide global zoom
(`webContents.setZoomLevel`, unchanged) rescales the whole page, so on-screen size =
`globalPageScale × baseFontPx × zoomFactor(typeLevel)` **with no coupling code**.

## Per-type reducer (`workspace/operations.ts`)

| Function | Behaviour |
|---|---|
| `zoomBucketOf(kind)` | `'terminal'` for terminal kind; `'editor'` for editor/text kinds (the two spec buckets) |
| `bumpZoom(layout, activeKind, presses)` | new layout with the active panel's **type** level stepped+clamped; other type & chrome untouched |
| `resetZoom(layout, activeKind)` | active panel's **type** → level 0; **idempotent** at 0 (FR-009) |
| `zoomLevelOf(layout, bucket)` | effective level (absent `zoom` → 0) |

## Behavioural assertions (unit)

1. `stepZoomLevel(ZOOM_MAX_LEVEL, +1) === ZOOM_MAX_LEVEL` and `stepZoomLevel(ZOOM_MIN_LEVEL, -1) ===
   ZOOM_MIN_LEVEL` (bound = no-op, FR-011).
2. `zoomFactor(0) === 1` (inherited); `zoomFactor` strictly increases with level.
3. `bumpZoom` on a terminal-kind active panel changes only `layout.zoom.terminal`; `editor` is unchanged
   (FR-007/008 — per type, other type + chrome unaffected).
4. `resetZoom` applied twice equals once (idempotent).
5. Reducer output is a new object (immutability); input is not mutated.

## Renderer apply (not part of the pure contract, but the required effect)

- **Terminal**: `fontSize = round(baseTerminalPx × zoomFactor(zoomLevelOf(layout,'terminal')))`; on change
  update `term.options.fontSize`, then `FitAddon.fit()` and `bridge.resize(panelId, term.cols, term.rows)`
  **only if cols/rows changed** (FR-012, SC-004/005).
- **Editor**: set `--throng-zoom-editor = zoomFactor(zoomLevelOf(layout,'editor'))` on the workspace root;
  editor font-size = `calc(var(--throng-font-editor-size) * var(--throng-zoom-editor,1))`. File content
  untouched (FR-013).
- **Assertion (FR-013)**: an E2E asserts that after zooming an editor its buffer **content, encoding, and
  line endings are unchanged** (zoom is presentation-only) — verified by tasks.md T014.
