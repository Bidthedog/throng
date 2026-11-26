# Contract: the site build

**Modules**: `scripts/site.mjs`, `scripts/guide-build.mjs`, `scripts/guide-template.mjs`,
`.github/workflows/pages.yml` · FR-001, FR-002, FR-002a–c, FR-003, FR-005

## CLI

```text
node scripts/site.mjs assemble --out <dir> [--version <tag>]   # pages.yml; version defaults to the checked-out tag
node scripts/site.mjs preview [--port <n>]                      # builds the guide too, serves locally
node scripts/site.mjs latest-tag                                # prints the newest published v* release tag
```

`assembleSite({ source, out, version, listReleases, fetchBundle, guideSource, docsSource })` — the
existing injectable seam, extended. Unit tests call it with fixtures and no network.

## Page template

- `<head>`: charset, viewport, `<title>{page title} · throng guide</title>`, canonical URL, the font
  preload and `/assets/site.css` (absolute paths, so nested pages resolve).
- Header: the `<header class="top">` element of `site/index.html`, verbatim apart from same-page anchors
  made absolute (`#features` → `/#features`), plus the Pagefind search field and the version label.
- Body: a side navigation listing the guide pages by front-matter `order` and `title` (kept equal to
  `GUIDE_PAGES` by a test) with the two reference pages after them; the
  page's version line ("This guide describes throng {version}."); an outline notice when
  `status: outline`; the rendered Markdown inside `<main data-pagefind-body>`.
- Footer: the `<footer>` element of `site/index.html`, verbatim, with the version.
- No script except Pagefind's UI and the existing `/assets/site.js`.

## Rendering rules

- markdown-it, HTML disabled in source, linkify on, typographer off.
- Every heading gets a GitHub-style slug id, with GitHub's `-1`, `-2` suffixes for a repeated heading (so a link
  that works on GitHub works here); setting sections get the key id (R5), and two sections with one key
  fail the build.
- Links: `guide/` relative links → site paths; links to `docs/preferences.md` and `docs/key-bindings.md`
  → their reference pages; links to any other repo file → `https://github.com/Bidthedog/throng/blob/<tag>/<path>`.
- The first line of a `docs/` page (its breadcrumb) is dropped.
- A build fails on: a broken internal link or anchor, a repeated setting key, a page missing `title` or `order`.

## Home page

`site/index.html` gains a **Guide** link in its nav (FR-003) and a version label filled at assembly.
Its privacy line is unchanged.

## pages.yml

1. Checkout master (as today) → `node scripts/site.mjs latest-tag` → `TAG`.
2. Checkout `TAG`.
3. `npm ci --ignore-scripts` at the root (markdown-it), then `node scripts/site.mjs assemble --out _site --version "$TAG"`.
4. Minify (esbuild, as today), then `npx --yes pagefind@1.3.0 --site _site`.
5. Upload and deploy (as today).

A tag whose tree predates the guide builds the site without one (correct by FR-002b).

## Iteration 1 (FR-026 to FR-029, FR-033)

| Rule | Contract |
|---|---|
| Header | Every page's `header.top` holds, in order: brand, then (guide pages only) `<div class="guide-search" id="search">`, `<nav aria-label="Site">`, the version label. The nav's links and order are the home page's |
| Search results | Pagefind's drawer is `position: fixed` below the header, `.wrap`-wide, scrolling on its own; the input text uses `--text` |
| Reference pages | `/guide/reference/<ref>/` (intro + section list) and `/guide/reference/<ref>/<slug(##)>/` per `##`; `<ref>` ∈ `preferences`, `key-bindings`, `theme-settings` |
| Keyed sections | In each reference, a `###` whose next paragraph is exactly one code span matching the key pattern gets that key as its id; duplicates refuse the build |
| Cross-page anchors | `docs/<ref>.md#<id>` resolves to the section page holding `<id>`; an id held by no page refuses the build |
| Navigation | Guide pages in `order`, then each reference as `<details class="guide-nav__ref"><summary>…</summary><ul>…</ul></details>`, `open` on that reference's pages; the current page carries `aria-current="page"` |
| Callouts | A blockquote whose first line is `[!NOTE]`, `[!TIP]` or `[!WARNING]` renders as `<aside class="callout callout--note|tip|warning">` with a title paragraph; the marker line is not shown |
| Outlines | A page with `status: outline` refuses the build, naming the file |
