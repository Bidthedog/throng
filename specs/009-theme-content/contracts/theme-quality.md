# Contract: Theme-quality module (`@throng/core`)

Pure functions and constants exposed for the automated theme-quality guards. No OS/DOM.

## Constants

- `DISTINCTNESS_THRESHOLD: number` — minimum acceptable ΔE00 (minimum-token-pair) between any two bundled themes. Calibrated to sit strictly below the closest legitimate pair (after Bash recolour) and strictly above pre-fix Bash-vs-Matrix.
- `CLOSEST_LEGITIMATE_PAIR_DELTA: number` — the measured closest-legitimate-pair distance, retained for audit.
- `WCAG_AA_BODY = 4.5`, `WCAG_AA_LARGE_UI = 3.0`.
- `CONTRAST_PAIRINGS` — the enumerated fg/bg token pairs with their required ratio (see data-model).
- `IN_SCOPE_THEMES = ['Bash','SUBNET','Cyberpunk']`.

## Colour maths

- `hexToRgb(hex: string): { r:number; g:number; b:number }` — accepts `#rrggbb` (case-insensitive).
- `relativeLuminance(rgb): number` — WCAG 2.1 relative luminance in [0,1].
- `contrastRatio(fgHex: string, bgHex: string): number` — WCAG ratio in [1,21].
- `rgbToLab(rgb): { L:number; a:number; b:number }` — sRGB → XYZ (D65) → CIE L*a*b*.
- `ciede2000(a: Lab, b: Lab): number` — CIEDE2000 ΔE00 (≥0).

## Theme-level

- `themePairMinDelta(a: Theme, b: Theme): number` — minimum ΔE00 across colour tokens present in **both** themes.
- `closestPair(themes: Theme[]): { a: string; b: string; delta: number }` — the smallest-distance pair (by name).
- `assertDistinct(themes: Theme[]): void` — throws `Error` naming the pair and distance if any pair `< DISTINCTNESS_THRESHOLD`.
- `measureContrast(theme: Theme): { label: string; ratio: number; min: number; pass: boolean }[]` — one row per pairing.
- `assertInScopeContrast(themes: Theme[]): void` — throws if any Bash/SUBNET/Cyberpunk pairing fails its `min`.
- `knownContrastIssues(themes: Theme[]): { theme: string; label: string; ratio: number; min: number }[]` — non-fatal report of out-of-scope shortfalls.

## Guarantees

1. Deterministic and pure (same inputs → same outputs; no I/O).
2. `contrastRatio(x, y) === contrastRatio(y, x)`; result in [1, 21].
3. `ciede2000(l, l) === 0`; symmetric.
4. `themePairMinDelta` uses only tokens present in both palettes (never throws on differing token sets).
5. `assertDistinct` / `assertInScopeContrast` throw with a message naming the offending theme(s), pairing/label, and measured value.
