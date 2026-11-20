# Contract: the four media providers on the preview seam (074)

Amends 044 `contracts/preview-provider-seam.md` (§2 descriptors, §4 binary size limit) and 044
`contracts/security-policy.md` (one row per provider; the grants below). Research R2 – R6 give the
reasons; this file is the shape.

## 1. Descriptors (core, `packages/core/src/preview/providers/`)

| id | displayName | kind | extensions | sourceMimeTypes | filesNoun | own settings |
|---|---|---|---|---|---|---|
| `image` | Image | binary | `.png .apng .jpg .jpeg .gif .webp .avif .bmp .ico` | `image/png image/apng image/jpeg image/gif image/webp image/avif image/bmp image/x-icon` | images | `maxFileBytes` (50 MB), `transparencyHatch` (on) |
| `svg` | SVG | text | `.svg` | — | SVG files | `maxFileBytes` (10 MB) |
| `pdf` | PDF | binary | `.pdf` | `application/pdf` | PDFs | `maxFileBytes` (100 MB) |
| `html` | HTML | text | `.html .htm` | — | HTML files | `maxFileBytes` (10 MB) |

All four: `defaultOpenAction: 'preview'`, `maxFileBytesSetting: 'maxFileBytes'` (the shared
`media-settings.ts` declaration). SVG and HTML: `flowingDocument: false` — no Select All, Go to Heading or
Synchronise Scrolling (FR-046, FR-087); a binary preview is never flowing. HTML: `revealsMatches: false` (FR-084)
and `assetMimeTypes: ['text/css', 'font/woff2', 'font/woff', 'font/ttf', 'font/otf']`.

New provider-neutral descriptor fields: `filesNoun`, `previewOptionLabel` (contract
`open-in-preference.md`), `maxFileBytesSetting`, `assetMimeTypes`, `revealsMatches`. New view field:
`searchable` (`false` shows Find disabled, FR-086).

## 2. Size limit (amends seam §4)

`maxFileBytesFor(registry, settings, providerId)` = the provider's `maxFileBytesSetting` leaf when it
declares one, else `editor.maxOpenFileBytes`. Read by `PreviewService.readPath` (stat before read; a
parented text buffer by UTF-8 length) and by the protocol's source route cap. Over the limit:
`{ kind: 'too-large', size, limit }`.

## 3. Views (renderer, `packages/ui/src/renderer/preview/providers/`)

| id | body | `textSelection` | body menu |
|---|---|---|---|
| `image` | `DiagramBlock` of an `image-url` block, `fillsPanel`, not maximisable | `false` | Copy Image, Focus Mode, Copy Path |
| `svg` | `DiagramBlock` of an `svg` block, `fillsPanel`, not maximisable | `true` (copy = source) | Copy, Copy Image, Focus Mode |
| `pdf` | lazy PDF.js pages | `false` | Copy Path |
| `html` | sandboxed `srcdoc` iframe | `false` (the frame's own Copy chord) | Copy Path |

New optional body prop: `onStatusReadout?(text: string | null)`.

## 4. Main

- `preview.readSource(panelId) → { ok: true; bytes: Uint8Array; mime: string } | { ok: false; status }`
  — invokes the protocol handler on `throng-preview://source/<panelId>`; one confinement path.
- Protocol route `throng-preview://follow/<panelId>?href=…` → `204`, hardened headers.
- `window-open-guard.ts`: a `throng-preview://follow/…` URL with disposition `background-tab` →
  `preview:frameLink { panelId, href }` to the window's renderer; every follow URL is denied.
- Request filter: `fromSubFrame` requests to `http:`/`https:` → cancel.

## 5. Security-policy grants (FR-092)

| Grant | Where | Scope | Pinned by |
|---|---|---|---|
| `frame-src throng-preview://follow` | renderer `index.html` CSP | the 204 route only; no document is ever served there | `renderer-csp.test.ts` |
| `style-src throng-preview://asset` (2026-11-19) | renderer `index.html` CSP | the asset route only; the `srcdoc` frame inherits this policy, so a page's stylesheet loads only if both policies admit it | `renderer-csp.test.ts` |
| HTML frame `sandbox="allow-popups"` | HTML body | user Ctrl+click → window-open handler, which denies every window | `html-frame.test.ts` |
| Injected frame CSP | sanitised `srcdoc` | `default-src 'none'; img-src throng-preview:; style-src 'unsafe-inline' throng-preview:; font-src throng-preview:; media-src throng-preview:` | `html-sanitise.test.ts` |
| Asset MIME widening | protocol, HTML runs only | `assetMimeTypes` | `preview-protocol` integration |

No grant for Image, SVG or PDF: `img-src throng-preview: blob:` and `script-src 'self'` (worker)
already admit them, and PDF bytes arrive by IPC.

## Amendment 2026-11-20 (R6a – R6e)

- HTML frame: `sandbox="allow-same-origin allow-popups"`, `name="throng-html-<panelId>"`; scripts refused by the
  sanitiser, the sandbox and the frame CSP. The view drops `searchable: false`; Find runs through the shared
  controller, or the view sets `findable: false` (FR-086d).
- Frame CSP: `img-src`, `style-src` and `font-src` gain the panel's safe sources (FR-072a); never `script-src`.
- Renderer CSP: `style-src … https:`, `font-src 'self' https: throng-preview:` (FR-092a), narrowed by the request
  filter's per-frame sources (`preview:setFrameSources`).
- `sanitiseHtmlPage` returns `blocked: { url, kind, source, allowable }[]` (FR-093a).
