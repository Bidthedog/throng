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
| `control-<key>-invalid` | inline message, `role="alert"`, present only while invalid |

- Greyed state: `data-overridden="true"` on the slider, styled by a theme token; the slider stays enabled.
- Confirm: Enter or blur. Escape restores. Reset clears message and override.

## Main → renderer — too-large notice

`{ kind: 'too-large', size: number, limit: number, limitKey: string }`; the renderer resolves `limitKey`'s descriptor
and renders `This file is too large to preview: <formatSetting(size)>, over the <formatSetting(limit)> limit set in
Preferences.`
