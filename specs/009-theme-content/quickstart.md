# Quickstart / Validation Guide: Theme Content

Prerequisites: `npm install` at repo root; Node ≥ 20.

## Automated validation

```bash
npm run test:unit          # theme-quality, theme-copy, default-themes, theme-metadata
npm run test:integration
npm run test:contract
npm run test:e2e           # editor-gutter.e2e + existing theme-tokens.e2e
```

Expected: all green. Key assertions:

- **Distinctness** (`theme-quality.test.ts`): `assertDistinct(ALL_DEFAULT_THEMES)` passes; a theme duplicated onto another throws; the pre-fix Bash-vs-Matrix distance is below threshold while the recoloured Bash-vs-Matrix is above it. The measured closest-legitimate-pair distance and chosen threshold are asserted and printed.
- **Contrast** (`theme-quality.test.ts`): `assertInScopeContrast` passes for Bash/SUBNET/Cyberpunk; `knownContrastIssues` lists any out-of-scope shortfalls without failing.
- **Copy** (`theme-copy.test.ts`): every editable token has a hand-written label+description; none matches the banned-substring blocklist on a word boundary; none equals the machine-generated copy.
- **Gutter tokens** (`default-themes.test.ts` / `theme-metadata.test.ts`): every bundled theme supplies `editorGutterBg`/`editorGutterFg`; both appear in `THEME_METADATA` as colour controls with hand-written copy; the completeness test passes.
- **Gutter isolation** (`editor-gutter.e2e.ts`): setting `editorGutterBg`/`editorGutterFg` repaints the gutter only; the editor body background/foreground are unchanged. A theme document without gutter tokens loads and yields the default gutter CSS variables.

## Manual validation (`npm start`)

1. Open Preferences → Themes. Apply **Bash**: confirm it is obviously multi-hue (green, magenta, yellow, teal, cyan) and clearly NOT Matrix (which stays mono-green).
2. Apply **SUBNET**: confirm a Deep Space Blue base with neon green/cyan accents only (no neon backgrounds), amber callouts, grey chrome.
3. Apply **Cyberpunk**: confirm a near-black base with crimson/maroon structure, yellow highlights, pale-teal accents.
4. Open an editor Panel: confirm the line-number gutter is visibly distinct from the editor body (subtle offset), text still readable.
5. In the theme editor Colours group: confirm **Editor gutter background** and **Editor gutter foreground** appear, are editable, and changing them repaints only the gutter.
6. Read several token descriptions: confirm they describe what the token paints (e.g. surfaces/elements), not "The App bg colour token."
