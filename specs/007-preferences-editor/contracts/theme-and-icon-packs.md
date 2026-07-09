# Contract: Theme model extension + Icon packs (core, pure) + discovery (UI main)

**Modules**: `packages/core/src/config/theme.ts` (extended), `packages/core/src/config/icon-pack.ts` (new),
`packages/ui/src/main/icon-pack-service.ts` (discovery via `IFileSystem`). Implements FR-039/040/040a and the
select=activate rule (FR-035).

## Theme extension (additive, back-compatible)

```ts
type IconValue = { glyph: string } | { image: string };  // image = filename relative to the pack folder

interface Theme {
  /* existing: name, colours, fonts, typography?, icons: Record<string,string> */
  iconPack?: string;                          // chosen pack name (FR-039)
  iconOverrides?: Record<string, IconValue>;  // per-token overrides over the pack (FR-039)
}
```

Existing themes omit `iconPack`/`iconOverrides` and render exactly as today (glyph `icons`). The parser is
tolerant: unknown/invalid pack refs fall back to the throng glyphs.

## Icon-pack manifest (on disk)

```
%USERPROFILE%\.throng\icon-packs\
  README                     # bundled: format + full token list + 24px/fallback rules (FR-040a)
  <pack>\
    pack.json                # { "name": "<pack>", "tokens": { "<token>": "<glyph>" | "<file.svg|png>" } }
    <file.svg|png>...        # image assets referenced by relative filename
```

```ts
interface IconPackManifest { name: string; tokens: Record<string, IconValue>; }
parseIconPack(raw: unknown): IconPackManifest;   // tolerant: drop malformed tokens
```

- A pack **MAY mix** glyph and image tokens (FR-040). A token maps to a glyph string **or** a relative image
  filename.

## Resolution (pure — FR-040 fallback chain)

```ts
resolveIconValue(theme, packs: Record<string, IconPackManifest>, token: string): IconValue;
// 1. theme.iconOverrides[token]      (per-token override)
// 2. packs[theme.iconPack]?.tokens[token]   (chosen pack)
// 3. { glyph: theme.icons[token] }   (theme glyph default)
// 4. { glyph: THRONG_THEME.icons[token] }   (ultimate throng fallback)
```

- Icons render in a **24px** box: `{glyph}` as text; `{image}` via an asset URL the **UI-main**
  `icon-pack-service.ts` resolves (`listIconPacks()` returns `{ name, assetBase }`) — the sandboxed renderer
  never touches `fs`.

## Discovery (UI main)

```ts
listIconPacks(): Promise<{ name: string; assetBase: string }[]>; // scan icon-packs\ via IFileSystem
```

- Bundled packs and **user-supplied packs** (a folder dropped under `icon-packs\`) are both discovered and
  selectable (FR-040). A user pack missing some tokens falls back per token (resolution step 3/4).

## select = activate (FR-035, theme selector)

- Selecting a theme in the Themes tab sets `settings.appearance.theme` to that name (written via
  `config.write`), so the whole app repaints live and subsequent edits preview immediately.

---

## Delta — 2026-07-08

- **Button style tokens** — `colours.buttonBg`, `colours.buttonText`, `colours.buttonHoverBg`,
  `colours.buttonHoverText` + a `button` typography role, added to `THRONG_THEME` (so generated
  `THEME_METADATA` + completeness test auto-cover them) and populated by every default theme.
- **Font-family = CSS stack** — a font token's value is a comma-separated fallback stack edited via a
  multi-select **pill** control (`parseFontStack`/`serializeFontStack`); every typography role exposes it.
- **Two bundled packs** — `throng` (glyphs, default) + a secondary SVG-image pack, both seeded under
  `icon-packs/` on first run and selectable via the pack picker.
