# Research: Markdown preview extensions — callouts, maths and printing

## R1 — Callout parsing: the package as a parser only

- **Decision**: `md.use(markdown-it-obsidian-callouts)` for its `obsidian-callouts` core rule (after `block`),
  then a throng core rule `throng_callouts` (after the package's, before `inline`) rewrites each
  `callout_open` token: it reads the package's `data-callout` / `data-callout-fold` / `data-callout-title`
  attributes, resolves the type through core's registry (`resolveCalloutType`), clears every attribute the
  package set, and inserts a `throng_callout_title` inline token for the title so markdown-it's own inline
  pass parses it with this render's `env` (wikilinks register in document order, find sees its text). A first
  paragraph left empty once the marker and title are removed is dropped (FR-003). throng's renderer rules
  replace the package's `callout_open` / `callout_close` rules, so none of the package's markup, icons or
  type list reaches the HTML (FR-013).
- **Admonition fences (FR-016)**: the package converts fences whose info starts `ad-` inside the same rule.
  A throng rule *before* it retypes those fences to `throng_fence_hold`, and one after it types them back to
  `fence`, so they render through the ordinary fence rule. The pin test asserts it.
- **Peer range**: the package declares `markdown-it ^14`; root `package.json` `overrides` sets `markdown-it`
  to `^15.0.3` (the only version in the tree). FR-015's pin test is the guard for an upgrade of either.
- **Behaviour of note** (pinned): the marker must open the blockquote's first paragraph; `[!info]Title`
  (no space) reads "Title"; the type is everything up to `]`, so `[!a b]` is the type `a b` → unknown → note.
- **Alternatives**: our own blockquote rule (rejected: #672 records the maintainer's choice of this
  package); the package's renderer with a post-sanitise rewrite (rejected: its SVG icons and classes would
  have to be admitted by the sanitiser first).

## R2 — Callout markup and sanitiser admission

- **Decision**: throng emits only `div`/`span` with data attributes — the profile already forbids `class`,
  `style` and `aria-*`. New allowlisted attributes: `data-callout` (canonical id, `[a-z]+`),
  `data-callout-fold` (`open` | `closed`), `data-callout-title`, `data-callout-icon`, `data-callout-body`
  (presence). A sanitiser hook drops `data-callout` unless its value is a registry id, and drops the
  presence attributes off any element that is not a `div`/`span` (contract `callout-markup.md`). Raw HTML
  carrying the same attributes can therefore only draw a box styled as a known type — no script, no
  resource, no fold control (the DOM pass only wires callouts the pipeline emitted, recognised by this
  render's nonce, which the hook verifies and removes, as for headings).
- **Icons**: drawn after sanitising into `[data-callout-icon]` by the body through the existing
  `IconResolver` (`fold-gutter.ts`'s pattern), so a user icon set overrides them (FR-024).

## R3 — Callout fold state

- **Decision**: held by the Markdown body in a `Map<calloutKey, boolean>` where the key is
  `<source line>:<fold sign>`. A re-render keeps entries whose key survives (FR-008 "survive a live
  re-render"); changing the sign changes the key, so that callout starts from the new sign; a reopen starts
  empty. Not sent to main, not persisted: FR-008 calls it view state only and 047's `FoldState` is for
  sections. Collapse All / Expand All never touch the map (FR-009).
- **Keyboard**: a foldable callout's title row is `tabindex=0`, `role=button`, `aria-expanded` (set by the
  DOM pass, after sanitising), so Tab reaches it in document order with links (FR-007). Enter/Space toggle.
- **Reveal**: the body's existing reveal path (FR-040 for sections) also opens every collapsed callout that
  is an ancestor of the target element (FR-010); the find controller calls it before scrolling to a match.

## R4 — Callout colours

- **Decision**: seven colour tokens `colours.calloutNeutral … calloutDanger` in a new **Markdown preview**
  area (`Markdown preview · Callouts`), placed after Editor in `THEME_AREA_GROUPS` (FR-021). Background is
  `color-mix(in srgb, var(--role) 12%, var(--preview-bg))` — the tinting already used for find matches
  (`searchMatch*` tokens use `color-mix` in `markdown.css`). Each shipped theme takes values chosen per theme;
  the contrast guard (`theme-quality.ts`) gains a check over the mixed colour (FR-023).
- **Upgrade**: `SHIPPED_DEFAULTS_VERSION` 35 → 36 and the seven leaves appended to
  `theme-leaves-by-version.json`, so existing theme files take their theme's shipped values (edge case
  "User theme created before this feature").

## R5 — Maths delimiters

- **Decision**: an in-repo markdown-it inline rule (`throng_math_inline`, before `escape`) and block rule
  (`throng_math_block`, before `fence`), driven by core's pure `math-delimiters.ts`, implementing GitHub's
  rules: `$` opens when not followed by whitespace, closes when not preceded by whitespace and not followed by
  a digit; `\$` is literal (markdown-it's escape rule runs after ours only for `$`, so the inline rule checks
  the preceding backslash itself); `` $`…`$ `` is a code-span form; `$$` opens a display block on its own
  line or inline as a display span; a ` ```math ` fence is display maths. Code spans and fences are never
  scanned (they are tokenised first). Emitted as `<span data-math="inline">source</span>` or
  `<div data-math="display" data-source-line="N">source</div>` with the source as escaped text.
- **Alternatives**: `markdown-it-texmath` (MIT; its `dollars` rule is close but not GitHub's: it accepts
  `$5 and $10`), `@vscode/markdown-it-katex` (MIT; renders during parse, so its HTML would bypass our
  placeholder design and load KaTeX on every render). Rejected for those reasons.

## R6 — Typesetting

- **Decision**: KaTeX 0.18 (MIT; fonts ship in the package under the same licence — KaTeX's repository
  licenses the font files with the code). `preview/providers/markdown/math-typeset.ts` is a dynamic import that also imports
  `katex/dist/katex.min.css`, so Vite puts KaTeX, its CSS and its font assets in a lazy chunk (FR-046). The
  body imports it only when the inserted DOM holds a `[data-math]` and `typesetMath` is on. Options:
  `throwOnError: false` is NOT used; each call is `try { renderToString(src, { displayMode, trust: false,
  strict: 'ignore', maxExpand: 1000, maxSize: 50, output: 'htmlAndMathml' }) }` and an error becomes the
  inline error form (FR-044). `trust: false` disables `\href`, `\url`, `\includegraphics`, `\htmlClass`,
  `\htmlId`, `\htmlStyle`, `\htmlData` (FR-047). KaTeX's output then passes `math-typeset.ts`'s sanitiser: its own
  DOMPurify instance and profile admitting the `span` / MathML / `svg` / `path` / `line` subset KaTeX emits
  with `class`, `style` (KaTeX positions glyphs with inline styles), `aria-hidden`, `encoding`, `xmlns`,
  `viewBox`, `d`, `width`, `height`, `preserveAspectRatio`; no URI attribute at all, so nothing can load.
- **Batches**: up to 50 expressions per frame, so 500 never block input (SC-006).
- **Setting off**: the placeholders keep their source text, shown as written — 044 FR-086's literal form.
  Because `$` delimiters are removed by the placeholder, the off state re-inserts them (`$…$`, `$$…$$`),
  and a fenced `math` block renders as code (the rule leaves the fence to the fence renderer when off).

## R7 — Find and copy with maths

- **Find** (FR-049): the search model already skips `[data-diagram-host]`-style excluded subtrees; typeset
  equations carry `data-math-typeset` and join that exclusion. With the setting off, placeholders hold plain
  source text and find matches it.
- **Copy** (FR-050): `copy.ts` already swaps a diagram for source or image by copy format; an equation is
  swapped for `data-math-source` with delimiters in plain text, and keeps its KaTeX HTML (MathML included) in
  rich text, re-sanitised by the export profile with KaTeX's tags admitted for that one shape.

## R8 — Print preview display: a PDF from the print engine

- **Decision**: main owns a hidden **print host** (`BrowserWindow`, `show: false`, sandboxed,
  `javascript: false`) that loads the printable document from a temp file. Preview pages are
  `webContents.printToPDF(options)` of that host, written to `userData/print-jobs/<job>.pdf` and shown in a
  `WebContentsView` inside the Print Preview window (Chromium's built-in viewer, `#toolbar=0&view=FitH`),
  sized to the page area the Print Preview app reports. Print is `webContents.print({ silent: true,
  deviceName, … })` of the same host with the same settings, so preview and paper come from one layout.
- **Alternatives**: pdf.js in the renderer (large dependency for one window; spec 074 may add it for PDF
  previews — revisit then); a throng paginator (a second layout engine that would disagree with the printer's).
- **Revisited 2026-11-20 (MT-06)**: Chromium's viewer drew each page at one size and then jumped to its fitted
  one, could not report when a page was ready, and kept the wheel and keys to itself. The window now draws the
  pages with **PDF.js** — the `pdfjs-dist` spec 074 adds, set up as 074's `pdf-renderer.ts` sets it up — from the
  same `printToPDF` of the same host, returned as bytes by `render`. Nothing is written to `print-jobs/<job>/`;
  the view, its session and the page-area reporting are gone, and stepping between pages lays nothing out again.

## R9 — The printable document

- **Decision**: the preview chrome asks the provider view's `printable(body)`; Markdown and Mermaid share
  `print/printable.ts`, which deep-clones the body's DOM, then: removes furniture (fold toggles, diagram view
  controls, link hints, notices except a failed diagram's), opens every collapsed section and callout
  (FR-074), strips link roles and `tabindex` (FR-077), resets diagram zoom/pan wrappers and sizes each SVG to
  the text width (embedded) or the page (standalone, FR-075), and serialises the result. It is wrapped in a
  skeleton holding: a CSP (`default-src 'none'; img-src throng-preview: data: <the remote URLs already
  loaded>; style-src 'unsafe-inline'; font-src file: throng-asset:`), a `<base>` at the renderer bundle (so
  KaTeX's relative font URLs resolve), the preview's stylesheets collected from `document.styleSheets`, then
  `print-stylesheet.ts` with the print palette as custom properties overriding every theme variable it uses.
- **Remote images**: only `img` elements that finished loading keep their `https:` source; their URLs are
  listed in the CSP, so the print host can request those and nothing else.

## R10 — Print settings and their mapping

- **Decision**: core `print.ts` owns `PrintSettings` (data-model), `parsePrintSettings(json, printers)` (every
  fallback in FR-070), and two pure mappings, `toPdfOptions` (inches, `scale` 0.1–2, `pageRanges` string) and
  `toPrintOptions` (`margins: { marginType: 'custom', … }` in points, `scaleFactor` %, `pageRanges`
  0-based, `copies`, `deviceName`). Margins presets are fixed millimetre values (default 10 mm, minimum 5 mm,
  none 0), so the PDF and the job always agree; custom takes four values 0–50 mm.
- **Page sizes**: A3, A4, A5, Letter, Legal, Tabloid — every name both Electron calls accept; no driver query
  (spec Assumptions).
- **Default printer**: `PrinterInfo` carries no reliable default flag on every OS; `pickDefaultPrinter` takes
  `isDefault` where present, else the CUPS `printer-is-default` option, else the first printer.
- **Persistence**: `print-settings.json` in `userData`, beside `window-state.json`, written atomically
  (temp + rename, as `form-history-service.ts`) when the window prints or closes. Not a setting: no
  descriptor, not in `settings.json`, not in SQLite (it belongs to no project). The page range never persists.

## R11 — The Print Preview window

- **Decision**: `print-preview-window.ts`, modelled on `preferences-window.ts` (frame, painted-reveal, window
  open guard), but `modal: true` with `parent` = the window the request came from (FR-071). A module-level
  singleton: a second `print:open` focuses it and returns `{ opened: false }`. It loads `index.html?printPreview=<job>`,
  which mounts `PrintPreviewApp` under the active theme. Closing the parent closes it (Electron closes
  modal children with their parent).

## R12 — The print palette

- **Decision**: `core/preview/print-palette.ts` exports one frozen object, seeded from the shipped default
  Light theme's values at the time of writing (copied, not referenced — editing the Light theme on disk or
  in source never changes it). The print stylesheet's custom properties are generated from it at runtime by
  the printable builder (one `:root { --x: … }` block). A unit test asserts every variable
  `print-stylesheet.ts` and the preview styles read has a palette value (FR-072), and runs the theme
  contrast guards over the palette's text and callout colours.

## R13 — Licences

| Package | Licence | Compatible with AGPL-3.0-only | About window |
|---|---|---|---|
| markdown-it-obsidian-callouts 0.3.5 | Apache-2.0 | yes | listed by `generate-licenses.mjs` from the lockfile |
| katex 0.18.x (code and fonts) | MIT | yes | same |

No vendored art: the callout icons are Lucide (ISC), already credited by 069's vendored entry.
