# Phase 1 Data Model: Theme Content

No new persisted entity or schema. This feature extends existing in-memory/config structures.

## Theme (existing — `packages/core/src/config/theme.ts`)

`Theme.colours: Record<string,string>` gains two members:

| Token | Type | Meaning | Default (throng) |
|-------|------|---------|------------------|
| `editorGutterBg` | hex colour | Background of the code editor line-number gutter | subtle offset from `editorBg` |
| `editorGutterFg` | hex colour | Line numbers / fold markers in the gutter | muted foreground, ≥3:1 on `editorGutterBg` |

- Both are ordinary colour tokens: they flow into `toCssVariables` as `--throng-colour-editorGutterBg` / `--throng-colour-editorGutterFg`, into `THEME_METADATA` (derived), and into the per-theme completeness test — no structural special-casing.
- **Fallback / migration**: A theme (bundled or user) that omits either token resolves it from `THRONG_THEME` via the existing `resolveColour` / `toCssVariables` merge. No migration, no version bump.

## Editor-metadata copy catalogue (new — `packages/core/src/config/theme-copy.ts`)

```
THEME_TOKEN_COPY: Record<string, { label: string; description: string }>
```

- One entry per **editable token path** produced by `themeEditableTokens(THRONG_THEME)` — every colour token (incl. the two gutter tokens), every icon token, and every font/typography token/role-family.
- `label`: full-word human label ("Editor gutter background").
- `description`: names the concrete surface(s)/element(s) the token paints; never restates the identifier; contains no banned abbreviation.
- Consumed by `descriptorForThemeToken(key)`: look up the catalogue for `label`/`description`; retain mechanical control-type inference and `group`. If a key is absent (should never happen — asserted), fall back to the mechanical copy so the app never crashes.

### Token inventory (must all be covered)
- **Colours (28)**: appBg, sidebarBg, surface, surfaceActive, text, textMuted, accent, danger, success, railBg, border, statusBarBg, terminalBg, terminalFg, terminalCursor, terminalSelection, editorBg, editorFg, editorCursor, editorSelection, editorGutterBg, editorGutterFg, unsavedDot, activePaneHighlight, buttonBg, buttonText, buttonHoverBg, buttonHoverText.
- **Icons (22)**: destroy, collapse, expand, rename, send, tab, add, detach, folder, folderOpen, chevron, file, fileCode, fileJson, fileMarkdown, fileImage, fileText, symlink, expandAll, collapseAll, newFolder, terminal.
- **Fonts/typography (25)**: fonts.family, fonts.baseSizePx, fonts.weights.normal, fonts.weights.bold; per role {paneTitle,tab,panel,paneText,projectName,projectPath,button,editor,terminal} the family control plus each role's pinned fields (paneTitle.sizePx/weight/case, tab.weight, panel.weight, projectName.weight, projectPath.sizePx, button.weight, editor.sizePx, terminal.sizePx).

*(The exact editable set is whatever `themeEditableTokens(THRONG_THEME)` returns; the completeness test drives coverage.)*

## Theme-quality constants & functions (new — `packages/core/src/config/theme-quality.ts`)

```
DISTINCTNESS_THRESHOLD: number        // calibrated ΔE00-min, below closest legitimate pair
CLOSEST_LEGITIMATE_PAIR_DELTA: number // recorded measured value (audit)
WCAG_AA_BODY = 4.5
WCAG_AA_LARGE_UI = 3.0
CONTRAST_PAIRINGS: readonly { fg: string; bg: string; min: number; label: string }[]
IN_SCOPE_THEMES = ['Bash','SUBNET','Cyberpunk']

hexToRgb(hex) -> {r,g,b}
relativeLuminance(rgb) -> number            // WCAG 2.1
contrastRatio(hexA, hexB) -> number         // (L1+0.05)/(L2+0.05)
rgbToLab(rgb) -> {L,a,b}                     // sRGB→XYZ(D65)→Lab
ciede2000(labA, labB) -> number             // ΔE00
themePairMinDelta(a: Theme, b: Theme) -> number   // min ΔE00 over shared colour tokens
closestPair(themes) -> { a,b,delta }
assertDistinct(themes) -> void              // throws naming the offending pair if any < threshold
measureContrast(theme) -> { pairing,label, ratio, min, pass }[]
contrastFailures(theme) -> failures[]
assertInScopeContrast(themes) -> void       // throws for Bash/SUBNET/Cyberpunk failures
knownContrastIssues(themes) -> report[]     // out-of-scope shortfalls, non-fatal
```

- Pure; no OS/DOM. Exported from `@throng/core` index.

## Validation rules (from requirements)

- Distinctness: `∀ pairs (i<j): themePairMinDelta ≥ DISTINCTNESS_THRESHOLD` (FR-015). Hard, all themes.
- Contrast in-scope: `∀ theme ∈ IN_SCOPE, ∀ pairing: ratio ≥ pairing.min` (FR-017). Hard.
- Contrast out-of-scope: measured, shortfalls reported only (FR-018).
- Copy: `∀ token: label/description present, no banned substring (word-boundary), ≠ machine-generated` (FR-006/007/008/009).
- Gutter: every bundled theme supplies both gutter tokens (FR-012); default gutter bg offset from editor bg and gutter fg ≥3:1 on gutter bg (FR-012); changing gutter token repaints only the gutter (FR-011, E2E).
