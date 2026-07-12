# Contract: Match-Highlight Theme Tokens (`@throng/core/config`)

Match highlights MUST take their colours from **theme tokens** (FR-019, constitution v3.12 externalised
config). The Themes editor metadata is **structurally derived** from `THRONG_THEME`, so a token added to
the theme structure is inherently exposed in the editor; hand-written catalogue copy goes in
`theme-copy.ts` (`THEME_TOKEN_COPY`). The completeness/quality tests then cover it automatically.

## New tokens (added under `THRONG_THEME.colours`, camelCase segments)

| Token key | Role | Applied to |
|-----------|------|-----------|
| `colours.searchMatch` | Ordinary match background | CodeMirror match decoration + xterm match decoration |
| `colours.searchMatchCurrent` | Current match background | current-match decoration (editor + terminal) |
| `colours.searchMatchCurrentBorder` | Current match outline | current-match decoration border (legibility on busy backgrounds) |

Kept to the minimal set (YAGNI). If a foreground override proves necessary for contrast on a bundled theme,
add `colours.searchMatchForeground` under the same rule (descriptor derived, copy in `theme-copy.ts`).

## Catalogue copy (theme-copy.ts → THEME_TOKEN_COPY)

```ts
'colours.searchMatch':              { label: 'Search match', description: 'Background of an ordinary search match.' },
'colours.searchMatchCurrent':       { label: 'Current search match', description: 'Background of the current (selected) search match.' },
'colours.searchMatchCurrentBorder': { label: 'Current match outline', description: 'Outline of the current search match for legibility.' },
```

## Bundled-theme values

Every bundled theme (007/009) gets values for the new tokens that meet the project **contrast bar**
(SC-005), so ordinary and current matches are legible on all of them. Values live with each theme
definition; the theme-quality test (theme-quality.ts) covers legibility/consistency.

## Contract tests

- Metadata completeness (existing) — each new token has exactly one derived descriptor with the colour
  control kind.
- Theme copy test (existing) — hand-written label/description present (not mechanically derived).
- Theme quality test (existing + extended) — new tokens present in every bundled theme and meet contrast.

## Find-bar action-control icon tokens (FR-018)

The find-bar controls (find, next, previous, close, case-sensitive, whole-word, replace, replace-all) are
**themeable icons** whose glyphs MUST come from `THRONG_THEME.icons` tokens (constitution themeable-icon-
controls rule). Reuse existing icon tokens where a suitable glyph exists; register any **missing** icon
token under `THRONG_THEME.icons` with catalogue copy in `theme-copy.ts` (structurally-derived descriptor,
covered by the completeness test). No inline SVG or hardcoded glyph is permitted.

## Renderer usage

- Editor: a CodeMirror decoration theme maps match / current-match decoration classes to CSS custom
  properties fed from these tokens (no hardcoded colour).
- Terminal: `@xterm/addon-search` decoration options (`matchBackground`, `activeMatchBackground`,
  `activeMatchBorder`) are populated from these tokens.
