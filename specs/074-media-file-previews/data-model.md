# Data model: Media File Previews (074)

Shapes only; behaviour is in the contracts.

## 1. `DefaultOpenAction` (core `preview/settings-types.ts`)

`'editor' | 'preview' | 'os'` — widened. Stored at `editor.previews.providers.<id>.defaultOpenAction`
for every provider. Validation: a value outside the provider's offered set
(`offeredOpenActions(provider)`) parses to the provider's shipped value.

## 2. `PreviewProviderDescriptor` additions (core `preview/provider.ts`)

| Field | Type | Meaning |
|---|---|---|
| `filesNoun` | `string?` | plural for the Open … in label; default `"<displayName> files"` |
| `previewOptionLabel` | `string?` | label of the `preview` option; default "Throng Preview" |
| `maxFileBytesSetting` | `string?` | names an own `number` leaf that caps what the preview reads |
| `assetMimeTypes` | `readonly string[]?` | extra MIME types the asset route serves this provider's runs |
| `revealsMatches` | `boolean?` | `false` sends a Find in Files result to an editor at the match (HTML, FR-084) |
| `defaultOpenAction` | now valid on a binary provider (`'preview'` or `'os'`) |

## 3. `ProviderSettings` (per provider)

| Leaf | Providers | Type | Shipped |
|---|---|---|---|
| `enabled` | all | boolean | `true` |
| `defaultOpenAction` | all | `DefaultOpenAction` | per descriptor |
| `openTarget` | all (was text only) | `'lastActive' \| 'new'` | `'lastActive'` |
| `maxFileBytes` | image, svg, pdf, html | number (bytes) | 52,428,800 / 10,485,760 / 104,857,600 / 10,485,760 |

## 4. `PreviewNotice` (core `preview/wire-types.ts`)

`{ kind: 'too-large'; size?: number; limit?: number }` — `size` and `limit` in bytes when known.
New: `{ kind: 'scripts-not-run' }` is **not** a main notice; FR-081's notice is the HTML body's own
inline, dismissible line, local to the body (one per preview).

## 5. View state

- Image / SVG: the diagram frame's `{ mode, scale, x, y }` — frame-local, never persisted
  (054 FR-046g). `initialMode` is `open` for Image and SVG (FR-020a): 100%, or Fit when larger than the panel.
- PDF: `{ page: number; offset: number }` (page index and fraction into it) via
  `onViewStateCapture`, restored on history steps and re-renders (FR-064).
- HTML: none (the frame's scroll is not readable from outside, R6).

## 6. IPC

- `preview.readSource(panelId)` → `{ ok: true; bytes: Uint8Array; mime: string } | { ok: false;
  status: 403 | 404 | 413 | 415 }`.
- Event `preview:frameLink` → `{ panelId: string; href: string }`.

## 7. Fixtures (`packages/ui/tests/fixtures/preview/`)

`hostile.svg`, `hostile.html` (+ `hostile-style.css`), `hostile.pdf` (JavaScript, OpenAction, URI
link, SubmitForm), `polyglot.png` (PNG header + HTML/script trailer), `encrypted.pdf`, `pages-3.pdf`.
