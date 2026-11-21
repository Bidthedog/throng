# Contract: the numeric control and `numeric-units.ts`

## `@throng/core` — `config/numeric-units.ts`

```ts
toDisplay(value: number, d: NumericDescriptor): string        // "25 MB", "1.5 s", "40 characters"
formatSetting(value: number, d: NumericDescriptor): string    // display plus stored where they differ: "25 MB (26,214,400 bytes)"
isStop(value: number, d: NumericDescriptor): boolean
nearestStop(value: number, d: NumericDescriptor): number
checkTyped(text: string, d: NumericDescriptor):
  | { ok: true; value: number }
  | { ok: false; message: string; clampTo?: number }          // clampTo absent for not-a-number
clampToHard(value: number, d: NumericDescriptor): number
```

Messages (stored unit, digit-grouped, locale grouping per 4.5.0):

- above: `Up to <hardMax> <unit>` — clampTo = hardMax
- below: `At least <hardMin> <unit>` — clampTo = hardMin
- not a number: `Not a whole number` — no clampTo

## Renderer — `NumberControl`

| Test id | Element |
|---|---|
| `control-<key>-slider` | range input in stored units; `aria-valuetext` = `toDisplay` |
| `control-<key>-value` | the display value with unit |
| `control-<key>` | exact-value box (every numeric setting; the id it already had) |
| `control-<key>-invalid` | the Preferences toast saying what is wrong, present only while invalid; nothing inline — the box keeps its invalid outline and `aria-invalid` (FR-024; amended 2026-11-21, T048) |

- Greyed state: `data-overridden="true"` on the slider, styled by a theme token; the slider stays enabled.
  *(Amended 2026-11-21, convergence T051 — additive.)* No theme token styles it: T008 draws the greyed slider in plain
  CSS, dimmed and greyscale with no colour (`.ctl__slider--overridden` in
  `packages/ui/src/renderer/preferences/preferences.css`), so there is no token and no shipped-defaults bump for it.
- Confirm: Enter or blur. A confirmed non-number stores nothing and stays in the box, its toast flashing (FR-009). Escape restores the stored value. Reset clears the toast and the override.

## Main → renderer — too-large notice

`{ kind: 'too-large', size: number, limit: number, limitKey: string }`; the renderer resolves `limitKey`'s descriptor
and renders `This file is too large to preview: <formatSetting(size)>, over the <formatSetting(limit)> limit set in
Preferences.`
