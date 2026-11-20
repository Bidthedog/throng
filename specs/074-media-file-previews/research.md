# Research: Media File Previews (074)

Each item: **Decision**, **Rationale**, **Alternatives considered**. Code citations are to the tree at
the branch point (`7e46e0d4`).

## R1 — The Open … in mechanism (FR-016 – FR-019)

**Decision.** Keep the key `editor.previews.providers.<id>.defaultOpenAction` and widen
`DefaultOpenAction` to `'editor' | 'preview' | 'os'`. `preview-settings.ts` generates the row for
**every** provider: text providers offer `editor`, `preview`, `os`; binary providers `preview`, `os`.
Two provider-neutral descriptor fields carry the wording: `filesNoun` (the plural, default
`"<displayName> files"`) and `previewOptionLabel` (default "Throng Preview"; spec 073's CSV sets
"Throng Preview Editor"). `defaultOpenActionFor` answers the three values: `editor` for a disabled or
unclaimed provider (unchanged, 044 FR-062), the stored value when the provider offers it, else the
provider's shipped value. The callers that branch on it are exactly four:
`editor/open-router.ts` (tree and Quick Open), `editor/editor-open.tsx` (a link followed in a preview,
067 FR-131), `find-in-files/find-in-files-chrome.tsx` and `preview/preview-panel.tsx` (link wording).
`os` routes through `osLinkActions().openInOsDefaultProgram` — the route and the one failure notice
File Explorer's Open in OS Default Program already uses (067 FR-018) — injected into `OpenRoute` as
`openInOs`, so the router stays free of the link module. Find in Files treats `os` as `editor`
(FR-019); the link wording treats `os` as "opens in the OS default program".

`openTarget` (Open previews in) is generated for binary providers too: a binary preview is
standalone, and Last Active reuse applies to it exactly as to a standalone text preview.

**Rationale.** The contract (`contracts/open-in-preference.md`) fixes the key, the values and the
labels; keeping the key means every stored value keeps its meaning with no migration. One parse rule —
"a value the provider does not offer reads as the shipped value" — covers a hand-written `editor` on a
binary provider and a later provider that drops an option.

**Alternatives considered.** A new key (`openIn`) with a migration — rejected by the contract; a
separate `os` toggle beside the old select — two settings for one decision; routing `os` through the
`throng:open-in-os` window event the tree listens for — it needs the tree for that project to be
mounted, which Quick Open and a preview link cannot guarantee.

## R2 — One drawing frame for images, SVGs and diagrams (FR-030 – FR-035, FR-054, FR-055)

**Decision.** Draw every picture through the existing 054 `DiagramBlock` → `DiagramFrame`, by making
each picture source a **block renderer** (`blocks/block-renderers.ts`) whose `render()` returns an
`SVGSVGElement` *wrapper*: `<svg viewBox="0 0 w h" width="w" height="h"><image href="…" width="w"
height="h"/></svg>`. The frame already provides Fit, Zoom In, Zoom 100%, Zoom Out, middle-button pan,
Ctrl+wheel about the pointer, Ctrl+middle-click, the panel zoom redirect, the fading percentage, Copy
Image, Focus Mode / Maximise and the right-click actions; the wrapper is all it needs. Three renderers:

| Renderer | Fence / use | `href` |
|---|---|---|
| `svg` | ```` ```svg ```` fence, SVG Preview body | a `blob:` URL of the source, typed `image/svg+xml` |
| `image-url` (internal) | Image Preview body, framed local images in Markdown | the `throng-preview://` URL |

Frame changes, all generic: a `data-diagram-magnified` attribute while scale > 1 so the CSS can switch
an `<image>` to `image-rendering: pixelated` (FR-034); an `initialMode` prop (`fit` | `actual`) for
Image: Default fit (FR-020); and the rasteriser draws a wrapper's single `<image>` straight from its
source bytes rather than serialising the wrapper (an SVG-as-image cannot load a `blob:` inside
itself). A `noun` on the block-renderer entry words the failure notice ("This picture could not be
drawn").

**Rationale.** The maintainer's requirement is "the same controls as Mermaid"; drawing through the same
frame makes divergence impossible rather than tested-against. The `<image>` element in an inline SVG
loads the referenced SVG in **secure static image mode** — Chromium's image mode: no script, no
external resources, no interactivity — which is exactly Q3's option A (R3).

**Alternatives considered.** A second, image-specific frame (duplicates 480 lines of view logic);
inlining the SVG through the diagram DOMPurify profile (option B, rejected by Q3); `<img>` instead of
`<image>` (the frame expects an `SVGSVGElement`; generalising its prop touches every diagram path).

## R3 — SVG isolation (FR-040, FR-044, FR-052, FR-054)

**Decision.** An SVG is never inserted as DOM. Its text is parsed with `DOMParser` (`image/svg+xml`,
inert: a parsed document runs nothing) **only to read** `width`/`height`/`viewBox` and to detect a
`parsererror`; the drawing itself is the source as a `Blob` (`image/svg+xml`) behind a `blob:` URL
referenced from the wrapper's `<image>`. The renderer CSP already lists `blob:` under `img-src`. The
draw is bounded: the image must `decode()` within `SVG_DRAW_TIMEOUT_MS` (5 s, as
`DIAGRAM_RENDER_TIMEOUT_MS`), else FR-045's notice. Blob URLs are revoked when their wrapper is
replaced (a per-renderer map, bounded at 64 entries).

Copy SVG source: the frame's copy path already puts a host's `data-diagram-source` on the clipboard as
text (054 FR-049a), so the file's source is what a text copy carries.

**Rationale.** Image mode is enforced by the engine, not by a sanitiser that must anticipate every
attack (SMIL `set`, `foreignObject`, `xml-stylesheet`, entity tricks): the strongest of Q3's options.

**Alternatives considered.** DOMPurify's SVG profile inline (Q3 option B); an `<iframe sandbox>`
(heavier, and the frame's controls could not zoom it).

## R4 — Binary sources, size limits and Copy Image (FR-011, FR-012, FR-021, FR-028, FR-061, SC-005)

**Decision.**

- A provider declares its size setting by name: `maxFileBytesSetting: 'maxFileBytes'` (provider-neutral,
  as `remoteImagesSetting` is). Each new provider declares an own `number` setting `maxFileBytes`
  (slider 5 MB – 250 MB, step 5 MB, as `editor.maxOpenFileBytes`), and `maxFileBytesFor(registry,
  settings, providerId)` in core answers it, else `editor.maxOpenFileBytes`.
- Main's `PreviewService.readPath` stats a binary file before minting its source URL and answers
  `{ kind: 'too-large', size, limit }` when it is over — no byte read (SC-005). Text providers with the
  setting get the same check on the disk file's size and on a parented buffer's UTF-8 length.
- The protocol's source route and its size cap read the same `maxFileBytesFor` (seam contract §4
  amended).
- `PreviewNotice['too-large']` gains optional `size` and `limit`; the notice text names both,
  digit-grouped, when present.
- **A new IPC `preview.readSource(panelId)`** returns the run's source bytes through the SAME handler
  the protocol uses (main calls its own `(Request) => Response` with the source URL), so confinement,
  realpath re-check, MIME allowlist and size cap are one code path. It serves Copy Image for an Image
  Preview (bytes → `Blob` → `createImageBitmap` → canvas → PNG: a same-origin `blob:` never taints the
  canvas) and the PDF renderer (R5).

**Rationale.** The protocol scheme is registered with `supportFetchAPI: false, corsEnabled: false`
(`main.ts`), so neither pdf.js nor a canvas can read `throng-preview:` bytes; widening those privileges
would widen them for every route and every document. An IPC that reuses the handler keeps one
confinement path and grants nothing to a document.

**Alternatives considered.** `supportFetchAPI`/`corsEnabled` + `connect-src throng-preview://source`
(a scheme-wide privilege change, and a CORS header on preview bytes); reading the file with `fs` in a
new main path (a second confinement implementation).

## R5 — PDF renderer (FR-060 – FR-069, FR-102)

**Decision.** **PDF.js** (`pdfjs-dist` 6.x, **Apache-2.0**, Mozilla, actively maintained). Apache-2.0
is compatible with AGPL-3.0-only (the FSF lists Apache-2.0 as GPLv3-compatible). Loaded on first use
behind a dynamic import (`providers/pdf/pdf-renderer.ts`), its worker a separate same-origin module
script (`new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })`),
which the renderer CSP's `script-src 'self'` already covers (`worker-src` falls back to it). Options:
`enableXfa: false`, `useWasm: false` (PDF.js 6 dropped `isEvalSupported`: it no longer evaluates font
programs), no `cMapUrl`/`standardFontDataUrl` fetch
(`disableFontFace: false`, embedded fonts only), bytes passed as `data` from `preview.readSource` so
pdf.js makes **no request** at all. Only the canvas is rendered (`annotationMode: ENABLE` draws form
fields' static appearance); **no** annotation layer, no scripting, no XFA. Links are drawn by us from
`page.getAnnotations()`: a `Link` with `dest` scrolls to its page; with `url` (`http`/`https`/`mailto`)
it is a Ctrl+click link through the chrome's `onFollow` (044 FR-091); anything else is not drawn.
Pages are placeholders sized from `getViewport()` and render when an `IntersectionObserver` with a
one-viewport margin sees them (FR-065); a zoom change re-renders visible pages at the new scale (the
panel's zoom factor × device pixel ratio). The status readout shows `Page n of m`.

**Rationale.** FR-069 names the two candidates. Chromium's built-in viewer is an out-of-process plugin
(`plugins: true`, an `<embed>`/`<iframe>` of `application/pdf`) that runs the PDF's JavaScript through
its own PDFium/V8 sandbox and follows links itself — it cannot be held to FR-066 or to FR-091's
independent-layers rule, and it needs `object-src`/`frame-src` grants. PDF.js renders to a canvas in
our process with scripting absent from the core API.

**Alternatives considered.** Chromium's PDF viewer (above); `pdfium` WASM builds (less maintained, need
`wasm-unsafe-eval`).

## R6 — HTML isolation (FR-070 – FR-088)

*(Frame origin, input path, scroll, find and fonts superseded by R6a – R6e, 2026-11-20.)*

**Decision.** A **sandboxed `srcdoc` iframe** holding a **renderer-sanitised** copy of the page.

1. **Sanitise** (`providers/html/html-sanitise.ts`, DOMPurify `WHOLE_DOCUMENT`, its own profile, never
   the Markdown one): remove `script`, `noscript`, `iframe`, `frame`, `frameset`, `object`, `embed`,
   `applet`, `portal`, `base`, `meta`, every `link` but `rel=stylesheet`, form `action`/`formaction`,
   `target`, `ping`, `srcdoc`, `autofocus`, every `on*` attribute and `javascript:` URL. Count what was
   removed for FR-081.
2. **Rewrite every resource URL** (`src`, `srcset`, `poster`, `href` of a stylesheet, SVG `href`, and
   `url()`/`@import` in `<style>` and `style=""`): a relative URL resolves against the file's folder to
   `throng-preview://asset/<panelId>/<root-relative path>`; anything absolute (`http:`, `https:`,
   `//host`, `data:`, `file:`) is dropped. Relative `url()` and `@import` inside a served stylesheet
   resolve against the stylesheet's own asset URL, so they reach the same route with no rewrite.
3. **Rewrite every link** except `#fragment` to `throng-preview://follow/<panelId>?href=<original>`,
   with a `title` naming the target and the gesture (FR-079). A `#fragment` link is left alone: it
   scrolls the `about:srcdoc` document natively.
4. **Inject** a `<meta http-equiv="Content-Security-Policy">` as the head's first child:
   `default-src 'none'; img-src throng-preview:; style-src 'unsafe-inline' throng-preview:; font-src
   throng-preview:; media-src throng-preview:` — layered on the policy the `srcdoc` document inherits
   from the renderer.
5. **Frame**: `<iframe sandbox="allow-popups" srcdoc=…>` — no `allow-scripts`, no `allow-same-origin`
   (unique opaque origin, FR-074), no `allow-forms`, no `allow-top-navigation`, no
   `allow-popups-to-escape-sandbox`. `allow-popups` exists only so a **Ctrl+click** (Chromium's
   background-tab disposition) reaches main's window-open handler: a frame with no script can open a
   popup only by a user's click.
6. **Following**: main's `setWindowOpenHandler` (`window-open-guard.ts`) already denies every window.
   A denied request whose URL is `throng-preview://follow/<panelId>?href=…` with disposition
   `background-tab` is sent to that window as `preview:frameLink { panelId, href }`; the preview chrome
   resolves `href` as it resolves a Markdown link and follows it (044 FR-090/FR-091). Every other
   disposition (a plain click on `target=_blank`, Shift+click) is denied and dropped. A **plain** click
   navigates the frame to the follow URL, which the protocol answers `204 No Content` — Chromium does
   not commit a 204, so the page stays. The renderer CSP grants `frame-src throng-preview://follow`
   for exactly that navigation (FR-092).
7. **Asset types**: a provider-neutral descriptor field `assetMimeTypes` widens the asset route's MIME
   allowlist for that provider's runs only — HTML declares `text/css`, `font/woff2`, `font/woff`,
   `font/ttf`, `font/otf`, `image/svg+xml`. A cross-origin web font needs CORS, which the scheme does
   not grant (R4), so `@font-face` from the asset route does **not** apply in the opaque frame: recorded
   in Complexity Tracking with a follow-up, the page falling back to its next font.
8. **Request filter** (Layer 4): a request from a **sub-frame** is never allowed off the machine, image
   or not (`decideRendererRequest` gains `fromSubFrame`; the filter reads `details.frame?.parent`).
   throng's own documents have no other sub-frames, so this is the HTML frame's rule alone (FR-093).
9. Zoom (FR-083): the frame's content scales by CSS `zoom` on its root, re-applied with the panel zoom
   through the sanitised document's injected style. Parented updates replace `srcdoc` (the frame's
   scroll is not readable from outside; FR-071's "keeps its scroll" is not claimed — Complexity
   Tracking).

**Rationale.** Every layer is independent: the sanitiser removes script and remote URLs; the sandbox
attribute alone disables script, forms, top navigation and same-origin access; the injected CSP alone
refuses remote loads; the request filter alone refuses sub-frame network requests; the protocol alone
confines asset reads. A defect in any one leaves the others standing (FR-091).

**Alternatives considered.** Serving the page as a protocol document with a response CSP (relative
URLs resolve for free, but main would need an HTML sanitiser with no DOM, and the parent CSP a
`frame-src throng-preview://html` grant serving whole documents); `allow-same-origin` to reach into the
frame for clicks and selection (the frame would share the renderer's origin and its preload bridge —
FR-074 forbids it); a shadow-DOM render (page CSS is not isolated from `:root`, and a page's
`position: fixed` escapes the body).

## R7 — Markdown: the `svg` fence and framed local images (FR-050 – FR-055)

**Decision.** The `svg` fence is one more `registerBlockRenderer` call, from a new module
`blocks/svg-block.ts` imported for its side effect by the block-renderer registry's index line — no
change to `pipeline.ts` or `sanitise.ts`: the pipeline already emits `pre > code[data-lang="svg"]`
and the body already replaces claimed blocks with `DiagramBlock`s. Framed local images: a post-render
pass in a new `providers/markdown/framed-images.ts`, called from `markdown-body.tsx` beside
`claimRenderedBlocks`, finds `p > img[src^="throng-preview://asset/"]` where the image is the
paragraph's only content, and claims it as an `image-url` block (its `src` the source, its `alt` kept
on the wrapper's `<title>`, its embed width `|200` the box height per 068 FR-056/054 FR-046m). Raw
`<svg>` stays in `ADD_FORBID_CONTENTS` (FR-053) — untouched.

**Rationale.** Additive modules; spec 075 edits `pipeline.ts` and `sanitise.ts` for callouts and maths,
and this keeps both files unchanged here.

**Alternatives considered.** A markdown-it rule turning an image paragraph into a host element (edits
`pipeline.ts`, conflicts with 075).

## R8 — Status readouts for pictures and pages (FR-022, FR-062)

**Decision.** A provider-neutral optional body prop `onStatusReadout?(text: string | null)`; the chrome
shows it in the status bar's existing `readout` slot when the body reports one. The Image body reports
`1,920 × 1,080 px · 2,345,678 bytes` (digit-grouped, `formatGrouped`); the PDF body `Page 3 of 120`.

**Rationale.** One generic slot, named by no provider (FR-005).

## R9 — Reduced motion and huge images (FR-025, FR-026)

**Decision.** `MAX_IMAGE_PIXELS = 100_000_000` (a plan constant: 10,000 × 10,000, about twelve 4K frames;
a 400 MB bitmap at most). The `image-url` renderer loads the image in a detached
`Image` (`decoding="async"`), reads `naturalWidth × naturalHeight`, and rejects with FR-025's notice
before the wrapper is returned. With `prefers-reduced-motion: reduce`, the renderer draws the loaded
image to a canvas once and hands the wrapper a `blob:` PNG of that first frame (the bytes are read via
`preview.readSource` so the canvas is not tainted).

## R10 — Tests

**Decision.** Lowest layer first (Principle V):

- **Unit (core)**: Open … in descriptors, parse and `defaultOpenActionFor` over every shipped
  provider; `maxFileBytesFor`; `decideRendererRequest` sub-frame rows; asset MIME widening.
- **Unit/component (ui)**: router `os` routes; Find in Files `os` → editor; the `svg` and `image-url`
  renderers (wrapper shape, image-mode only, timeout, parse error); HTML sanitiser against the hostile
  fixture (every removal and rewrite asserted); PDF body with a fake pdf.js; framed-image claiming.
- **Integration**: protocol per-provider size cap, asset MIME widening, `follow` 204, `readSource`
  confinement; preview-service `too-large` with size and limit.
- **E2E** (`@extended @failure`, one spec, `preview-media-hostile.e2e.ts`): the four hostile fixtures
  and a hostile `svg` fence in the real engine — no request off the machine (request log), no window,
  no navigation, no script side effect. One more (`@core @editor`, `preview-media.e2e.ts`): an image,
  an SVG, a PDF and an HTML file open from Files & Folders into their panel types. Both opened by
  `openApp()`; neither opens Preferences, a context menu or a long-lived shell, so neither enters
  `parallel-plan.json`. The budget ratchet is re-seeded in the same commit.

## R6a — Same-origin, script-less HTML frame (FR-074a, 2026-11-20)

**Decision.** `<iframe sandbox="allow-same-origin allow-popups" srcdoc name="throng-html-<panelId>">`. Script stays
refused by the sanitiser, the absent `allow-scripts` and the frame CSP (no `script-src`). The renderer listens on
`contentDocument` for keydown, Ctrl+wheel, Ctrl+middle-click, focusin and contextmenu, replacing
`frame-input-relay` (main and renderer) and its three IPC channels. **Alternatives:** opaque frame with a
double-buffered swap (no flash, but scroll lost and Find window-wide) — rejected by the maintainer.

## R6b — Update in place (FR-071b)

**Decision.** First page: `srcdoc`. Every later update while the frame has loaded and the safe sources are unchanged:
parse the sanitised page with `DOMParser`, keep head nodes whose serialisation is unchanged and replace the rest,
then `body.replaceChildren(...imported)` and copy body/html attributes — all in one task, so no frame is painted
between versions. Scroll (x and y) read before, restored after, clamped to the new scroll extent. A change of safe
sources or theme defaults reloads the frame (new `srcdoc`). **Alternatives:** `document.write` (re-fetches every
stylesheet → flash); a morph library (new dependency for a two-level reconcile).

## R6c — Safe HTML preview sources (FR-072a, FR-093a)

**Decision.**
1. `safe-sources.ts`: a source is `https://host[:port]` or `https://*.host`; normalise trims, lower-cases, drops
   path; `http:` and anything else is invalid (rejected by the setting's normaliser and the dialog).
2. The body's sources = global setting ∪ the panel's project list. The sanitiser keeps an absolute `https:` URL in
   `img src`, `srcset`, `link rel=stylesheet href`, `@import` and `url()` when its origin matches; every other
   absolute URL is dropped **and recorded** in `page.blocked: {url, kind, source, allowable}` (`allowable` false for
   `http:`, scripts and anything not https).
3. Frame CSP gains the matching origins on `img-src`, `style-src`, `font-src`; never `script-src`.
4. Renderer → main `preview:setFrameSources(panelId, origins)`; the filter allows a sub-frame `https:` request only
   for `image`, `stylesheet` or `font` from a frame named `throng-html-<panelId>` whose registered origins
   match. Everything else from a sub-frame stays cancelled (FR-093 for SVG/PDF: they register nothing).
5. Requests refused at run time (a font inside a remote stylesheet) arrive as `securitypolicyviolation` events on the
   frame document and join `blocked`.
6. One inline notice lists `blocked` grouped by source; **Allow this source** appends to the project's list (Project
   Settings) and reloads; the notice names **HTML: Safe preview sources** with an action opening Preferences there.

## R6d — Find in HTML and PDF (FR-086b, FR-086c, FR-086d)

**Decision.** The existing `createPreviewSearchController` and `FindBar` — no second implementation. The text model
descends into a same-origin preview iframe's body; highlights register in that document's own `CSS.highlights`
with the `::highlight()` rules injected into it; match outlines translate frame rects by the iframe's box and zoom;
`scrollIntoView` scrolls the frame. PDF: while the find bar is open with a query, the body builds the text layer of
every page (text only, no canvas) in idle batches and the controller re-searches as layers land. If any of this
cannot reach parity with the Markdown preview's Find, the view sets `findable: false` — Find absent, the chord consumed — rather than `searchable: false`, which shows it disabled (FR-086d).

## R6e — HTML body menu (FR-085a)

**Decision.** A `contextmenu` on the frame document opens `previewContentMenu` at the translated point with Find…,
Copy, Copy as Rich Text, Copy as Plain Text, Select All and Split (the shared rows). The selection is captured from
the frame's `getSelection()`; rich copy uses the HTML provider's `exportHtml` (the selection's sanitised HTML).

## R7a — Size cap on a parented buffer (FR-012)

**Decision.** `preview-service` applies `overProviderLimit` to the UTF-8 byte length of the parented document's text
at attach and on every `changed()`; over the limit, the run emits the `too-large` content instead of the text, and
recovers on the next change under it.

## R8a — Wiki image embeds framed (FR-055)

**Decision.** `claimFramedImages` is the one claim path: it also claims a `<p>` whose only child is a held wiki
image (`img[data-throng-wiki-index]`), and the picture block draws it once `applyImageEmbedResolution` sets its
asset URL (width/height from `|200` / `|200x100` carried into the frame). A blocked target keeps its alt text.

## R9a — SC-003 / SC-004 measured

**Decision.** `preview-media-performance.e2e.ts` in the serial TIMING tier, through `expectWithinSla` (asserts on
reference hardware only, records an `sla-not-measured` reading on CI). Fixtures generated at run time into the
test's temp root: a 10 MB PNG, a 5 MB SVG, a 500-page PDF. Freeze: `longtask` entries during a scripted scroll
through the PDF, longest under 100 ms.
