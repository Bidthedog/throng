# Data Model: Icon Values, Assets & the Resolution Chain

**Feature**: 017 | **Date**: 2026-07-12

This feature adds no persisted entity and no new configurable key. It changes the **shape of an icon
in flight** — from a bare `string` that cannot express an image, into a value that can.

---

## The core problem, in one type

```ts
// TODAY — packages/core/src/config/theme.ts:227
function resolveIcon(theme: Theme, token: string): string
//                                                 ^^^^^^ cannot express an image. Ever.
```

Everything else follows from that return type. A pack icon is a *file*; a `string` return has nowhere
to put one, so 14 call sites render a glyph and the pack is silently discarded.

---

## Entities

### `IconValue` — what a token *resolves to* (exists today, unchanged)

```ts
// packages/core/src/config/theme.ts:51
export type IconValue = { glyph: string } | { image: string };
```

`image` is a **pack-relative filename** (e.g. `folder.svg`), never a path and never markup.
`isSafeAssetFilename()` already rejects `/`, `\`, `..` and drive letters — path-traversal
confinement that must be preserved.

**Key limitation**: an `{ image }` alone is *not renderable*. You also need the pack it came from, to
know what that filename means.

### `IconAsset` — what a token *renders as* (NEW)

The renderer must never touch the disk (FR-006a), so a filename is useless to it. The main process
resolves each `{ image }` into one of these, **once**, at pack-load time:

```ts
export type IconAsset =
  | { kind: 'glyph';  glyph: string }        // text — rendered as a character
  | { kind: 'svg';    markup: string }       // SANITISED inline markup — takes the theme's colour
  | { kind: 'raster'; dataUri: string }      // .png — rendered as <img>, keeps its own colours
  | { kind: 'missing' };                     // file absent/unreadable/not an SVG → caller falls back
```

**Why `markup` and not a path**: an SVG inside an `<img>` is an isolated document whose
`currentColor` resolves to black, not to the page's colour. Inlining is the *only* way a pack icon can
take the theme's colour (research §1). This is the whole reason `IconAsset` exists.

**Why sanitised in main**: the markup comes from a user-writable directory and is injected into the
DOM. Sanitising once, in main, before it crosses IPC means the renderer only ever holds safe strings,
and the sanitiser stays a pure function testable in the node-only test layer we actually have.

### `IconPackInfo` — a loaded pack (EXTENDED)

```ts
export interface IconPackInfo {
  name: string;                          // pack id, e.g. 'throng-svg'
  tokens: Record<string, IconValue>;     // from pack.json — unchanged
  assets: Record<string, IconAsset>;     // NEW — every token pre-resolved and ready to render
  error?: string;                        // NEW — why the pack could not be loaded (FR-004a)
}
```

`assetBase` (an absolute directory path) is **removed from the renderer-facing shape**. The renderer
has no business knowing where on disk a pack lives once its assets are in memory, and shipping an
absolute path into the renderer is exactly the kind of leak that invites a `file://` read on the
render path.

`error` is what the Preferences → Icons picker shows when a pack is unavailable (FR-004a). Its
presence is how "this pack is broken" travels from the filesystem to the user, instead of being
swallowed.

### `ConfigPayload` — the hot-reload channel (EXTENDED)

```ts
// packages/ui/src/main/config-watcher.ts:23
export interface ConfigPayload {
  settings: Settings;
  theme: Theme;
  keybindings: Keybindings;
  iconPacks: IconPackInfo[];   // NEW
}
```

**Why here and not a second channel**: a theme selects a pack (`theme.iconPack`). If packs arrived on
a *different* channel from the theme, the two would race, and there would be a frame in which the new
theme is paired with the old pack's icons. One payload, one render, no mismatch. (FR-005 requires the
change to be live; this is what makes it *atomically* live.)

---

## Resolution chain (unchanged in logic, newly actually used)

```
resolveIconValue(theme, packs, token)          // packages/core/src/config/icon-pack.ts:68
  1. theme.iconOverrides[token]                // an explicit per-icon override wins
  2. packs[theme.iconPack].tokens[token]       // then the selected pack
  3. theme.icons[token]                        // then the active theme's glyph
  4. THRONG_THEME.icons[token]                 // then the default glyph
  5. ''                                        // never undefined
```

Then, for rendering:

```
IconValue → IconAsset
  { glyph } ................................. { kind: 'glyph' }
  { image: '*.svg' } → pack.assets[token] ... { kind: 'svg' }     if loaded & sanitised OK
  { image: '*.png' } → pack.assets[token] ... { kind: 'raster' }
  anything unreadable ....................... { kind: 'missing' } → fall back down the chain (FR-003)
```

**Invariant**: a token **always** produces something renderable. A `missing` asset does not render a
hole — it re-enters the chain at step 3 (the theme's glyph). A partial pack yields a partly-packed,
fully-populated interface, never a half-empty one.

---

## Where each requirement lands

| Requirement | Model element |
|---|---|
| FR-002 (one resolver) | `resolveIcon` **deleted**; `resolveIconValue` is the only path |
| FR-003 (precedence, always renderable) | the chain above + the `missing` invariant |
| FR-004 (colour from theme) | `IconAsset.kind === 'svg'` → inline markup → `currentColor` binds |
| FR-004a (failed pack is surfaced) | `IconPackInfo.error` → Preferences → Icons picker |
| FR-005 (live update) | `iconPacks` on `ConfigPayload` — same channel as the theme |
| FR-006a (no disk read on render) | `assets` pre-resolved in main; `assetBase` not exposed |
| FR-006c (decorative) | rendering concern, not a data concern — the `<Icon>` contract |

---

## Non-entities (deliberately)

- **No icon-colour token.** That is #55, and it is out of scope. Pack SVGs inherit `currentColor` from
  the surrounding text colour, which is already a theme token.
- **No new persisted state.** `theme.iconPack` already exists, is already persisted, and already has
  an editor descriptor. This feature makes it *work*; it does not add configuration.
