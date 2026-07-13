# Contract: Icons — core ↔ main ↔ renderer

**Feature**: 017 | Governs FR-001…FR-006d

---

## 1. `@throng/core` — pure, no I/O

### `resolveIconValue(theme, packs, token): IconValue` *(exists — now the ONLY resolver)*

Precedence: override → pack → theme glyph → default glyph → `{ glyph: '' }`. Never returns
`undefined`.

### `sanitiseSvg(markup: string): string | null` *(NEW)*

Allowlist-based. Pure string → string. No DOM, no parser dependency.

**MUST**
- return `null` if the root element is not `<svg>` (a pack file that is not an SVG is not an icon)
- strip `<script>`, `<foreignObject>`, `<style>`, and any element outside the allowlist
- strip **every** `on*` attribute (`onload`, `onclick`, …), case-insensitively
- strip `href` / `xlink:href` whose value is not a bare `#fragment`
- **preserve** `stroke="currentColor"` / `fill="currentColor"` — this is the mechanism by which the
  icon takes the theme's colour, and destroying it would defeat FR-004
- be **idempotent**: `sanitiseSvg(sanitiseSvg(x)) === sanitiseSvg(x)`

**MUST NOT**
- execute or evaluate the markup
- rewrite geometry (paths, viewBox), which would silently corrupt a legitimate icon

### `resolveIcon()` — **DELETED** (FR-002)

Removed from `theme.ts` and from the `@throng/core` barrel. Its continued existence is the defect;
leaving it exported would let a fourteenth call site reintroduce the bug. Enforced by the source-guard
test.

---

## 2. Main process — all disk I/O lives here

### `listIconPacks(): Promise<IconPackInfo[]>` *(EXTEND the existing service — do not create a new one)*

`packages/ui/src/main/icon-pack-service.ts` already exists and already discovers packs and returns
`IconPackInfo { name, assetBase, tokens }`. This feature **extends** it: add `assets` and `error`, and
**stop** exposing `assetBase` to the renderer.

**MUST**
- read every pack **once**, at startup, into memory (FR-006a)
- for each `{ image }` token, read the file and produce an `IconAsset`:
  - `.svg` → `sanitiseSvg(contents)` → `{ kind: 'svg', markup }`, or `{ kind: 'missing' }` if it
    returns `null`
  - `.png` → `{ kind: 'raster', dataUri }`
  - unreadable → `{ kind: 'missing' }`
- set `IconPackInfo.error` when the **pack** cannot be loaded (no `pack.json`, unparseable, directory
  unreadable) — this is what the picker shows (FR-004a)
- **never throw**: a broken pack degrades to `error` + fallback icons; the app still starts (FR-004a)
- preserve the existing filename confinement (`isSafeAssetFilename`) — a pack MUST NOT read outside
  its own directory

**MUST NOT**
- expose `assetBase` (or any absolute path) to the renderer — the renderer must have no way to reach
  the disk on the render path
- re-read a file on any subsequent icon render

### `ConfigPayload.iconPacks: IconPackInfo[]`

Delivered on the **existing** `throng:config` channel, alongside `theme`. A pack change and the theme
that selects it MUST arrive together, so no frame can show a new theme with an old pack's icons.

---

## 3. Renderer — `<Icon>` is the only way to draw an icon

### `<Icon token="folder" />` *(NEW — `renderer/common/icon.tsx`)*

```tsx
interface IconProps { token: string; className?: string; }
```

**MUST**
- resolve via `resolveIconValue(theme, packs, token)` using the theme and packs from `ConfigContext`
- render by asset kind:
  - `glyph` → the character as a text child
  - `svg` → the sanitised markup **inlined into the DOM**, so `currentColor` binds to the inherited
    theme colour (FR-004)
  - `raster` → `<img src={dataUri}>` (cannot be themed — documented limitation)
  - `missing` → fall back down the chain to the theme glyph (FR-003); never render an empty hole
- be **decorative to assistive technology** (FR-006c): `aria-hidden="true"`, and no `alt`/`title` of
  its own. The accessible name comes from the enclosing control, which the constitution already
  requires to carry a hover title naming its action.
- render **synchronously** — no fetch, no `useEffect` load, no suspense. Icons MUST NOT pop in
  after the row that contains them (FR-006b).

**MUST NOT**
- import `resolveIcon` (it will not exist)
- read from the filesystem, or construct a `file://` URL
- carry its own `aria-label` — that would double-announce alongside the button's name (FR-006c)

### Every existing call site

Every `resolveIcon` call site in the renderer — enforced by the directory-wide guard, not by this
list, which is a convenience rather than the contract — `icon-button.tsx`, `explorer/toolbar.tsx`,
`explorer/tree-node.tsx`, `search/find-bar.tsx`, `terminal/terminal-panel.tsx`,
`workspace/context-menu.tsx`, `workspace/panel-placeholder.tsx`, `common/folder-picker.tsx` —
MUST render `<Icon>` instead.

**Enforced by** `packages/ui/tests/unit/icon-call-sites.test.ts`: a source-text guard that **scans the
whole renderer directory** (not a hand-listed set) and fails if any `.tsx` file references the banned
resolver. **The match MUST be word-bounded** — `/\bresolveIcon\b(?!Value)/` — because `resolveIcon` is a
**substring of `resolveIconValue`**, the resolver `<Icon>` is required to call. A naive substring guard
would fail on `<Icon>` itself, and the guard would be unsatisfiable. A guard shaped like the change rather than the requirement would pass while a
fourteenth call site still bypassed the theme — which is exactly how this bug survived.

---

## 4. Preferences → Icons picker

**MUST**
- render previews through the **same** `<Icon>` component — not a private `<img>` path. The grid
  rendering icons differently from the app is the root of #54, and must not survive the fix.
- show a pack whose `error` is set as **unavailable, with the reason** (FR-004a)
- not offer a broken pack as a working selection
