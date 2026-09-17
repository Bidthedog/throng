# Phase 0 Research: File Previews and Panel Navigation History

**Feature**: 044 | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Every decision below is grounded in a citation from this repository or a registry lookup made on
2026-09-14 (`npm view`). No test, lint, build or npm script was run while this was written. Anything
that only a run can settle is listed under **Open items**, with the command that settles it.

Paths are relative to `packages/` unless they start with `specs/`, `docs/` or a root file name.

---

## R1. The Markdown renderer: markdown-it 15

**Decision.** `markdown-it@^15.0.2` (MIT), with `html: true`, `linkify: true`, `typographer: false`,
`breaks: false`. Tables, strikethrough and autolinks are built in. **Task lists are an in-repo core
rule** (~40 lines), not a plugin. **Front matter is split off before parsing** by a pure function
(R4), not by a plugin. Fenced code is emitted as escaped text with a `data-lang` attribute and
highlighted *after* sanitisation (R5).

**Rationale.**

- **CommonMark at least (FR-080).** markdown-it passes the CommonMark spec suite and is the parser
  most editors' previews use. Its output is a **token stream with source line maps** (`token.map`),
  which three requirements need and an HTML string does not give: the scroll anchor that keeps the
  reader's place (FR-024, R11), generated heading slugs (`data-heading-slug`, never ids) for `#fragment` links (FR-090b/f), and link /
  image rewriting at token or node level rather than by regex over HTML.
- **Maintenance and licence (#10's constraints).** `15.0.2`, last modified 2026-09-12, MIT — which is
  AGPL-3.0 compatible. Ships its own `.d.mts`/`.d.cts` types (`exports` checked), so no
  `@types/markdown-it` is needed. Runtime deps: `entities` (already in the lockfile at 8.0.0,
  `package-lock.json:5624`), `linkify-it`, `mdurl`, `uc.micro`, `punycode.js`, `argparse` — all MIT/ISC.
- **Task lists in-repo.** Both task-list plugins were last published in 2022
  (`markdown-it-task-lists@2.1.1`, `@hedgedoc/markdown-it-task-lists@2.0.1`). Owning a 40-line core
  rule that turns a leading `[ ]`/`[x]` in a list item into a **disabled** checkbox is cheaper and
  safer than depending on an unmaintained package in a security-sensitive path.
- **Table alignment.** markdown-it emits `style="text-align:…"` on aligned cells. The sanitiser
  forbids `style` (R2), so the `th_open`/`td_open` render rules are overridden to emit
  `data-align="left|center|right"`, which `preview.css` maps. Recorded because the first render
  would silently lose alignment and every test that did not check a right-aligned column would pass.

**Alternatives rejected.**

| Candidate | Why not |
|---|---|
| `marked@18.0.13` (MIT, very active, GFM task lists built in) | A genuine runner-up. Rejected because it renders straight to an HTML string: heading ids (removed from core in v8), source line anchors and link rewriting all become string post-processing or a custom renderer per token type, and its CommonMark conformance is looser. Its built-in task lists are the one point in its favour. |
| `micromark` + `micromark-extension-gfm` (unified) | Safe by default (drops raw HTML), so FR-081's allowlist then needs `mdast-util-*` → `hast` → `rehype-raw` → `rehype-sanitize` → a stringifier: roughly forty packages. `micromark-extension-gfm@3.0.0` was last published 2023-06. |
| Build on `@lezer/markdown` (already bundled for editor syntax) | It is a *highlighting* tree. It does not resolve reference-style links, decode entities or produce an HTML model, so escaping, entity decoding and reference resolution would be hand-written — precisely the security-sensitive part a library exists to own. |

---

## R2. The sanitiser: DOMPurify 3, allowlist profile, in the renderer

**Decision.** `dompurify@^3.4.15`, used under the **Apache-2.0** option of its
`(MPL-2.0 OR Apache-2.0)` licence (Apache-2.0 is GPLv3/AGPL-3.0 compatible). It runs **in the
renderer**, over markdown-it's HTML string, with an **explicit allowlist profile** (not DOMPurify's
default), returning a `DocumentFragment` that is inserted with `replaceChildren` — never through
`innerHTML` or `dangerouslySetInnerHTML`.

The profile, contracted in [contracts/security-policy.md](./contracts/security-policy.md):

- **Tags**: the Markdown output set (`p h1–h6 em strong del s a img ul ol li input blockquote hr br
  pre code table thead tbody tr th td span div`) plus FR-081's inline HTML floor (`details summary
  kbd sub sup`) and `dl dt dd ins`. Everything else — `script style iframe frame object embed
  form input[type≠checkbox] link meta base svg math template` — is dropped with its content; `mark`
  is dropped with its text kept (its user-agent colours are system colours, not theme tokens, FR-083).
- **Attributes**: `href src alt title start checked disabled type open colspan rowspan`, plus the
  pipeline's own `data-source-line data-lang data-align data-heading-slug`. **No `style`, no `on*`,
  no `class`, no `id` and no `name` from the document**, no `srcset`.
- **No `id` survives at all**, so a document cannot clobber a DOM global the app reads, and heading
  anchors are carried as `data-heading-slug` instead. *(Revised 2026-09-14, analysis: an earlier draft
  kept ids under `SANITIZE_NAMED_PROPS: true`, which prefixes **every** id — the pipeline's own heading
  ids included — with `user-content-`, so a `#install` fragment had no defined target.)*
- **Hooks** (`afterSanitizeAttributes`) do the rewriting that makes links and images safe *by
  construction* rather than by policy: R6 (links lose `href` entirely) and R7 (images get a
  rewritten or removed `src`). `input` is forced to `type=checkbox disabled`.

**FR-081's "a test MUST assert the sanitiser is in the path"** is met twice: a unit test that the
pipeline calls its injected sanitiser (so removing the call fails a test, not a review), and a
component test that renders a hostile fixture through the real provider and asserts the DOM carries
no `script`, no `on*` attribute, no `iframe`/`form`/`object`, and no `javascript:` anywhere.

**Why the renderer.** DOMPurify needs a DOM. The only sanitiser in the repo today,
`core/src/config/svg-sanitise.ts:163`, is a hand-written string allowlist that runs in UI main
(`ui/src/main/icon-pack-service.ts:235`) — adequate for SVG icon packs, and exactly the kind of code
this feature must not reinvent for arbitrary HTML. Running DOMPurify in main would mean bundling
`jsdom` into UI main (`isomorphic-dompurify@4.2.0` depends on `jsdom@^30`) to sanitise text that is
then shipped to a DOM anyway. Component tests already run under jsdom 29 (`package-lock.json:6885`,
`vitest.config.ts` component project), so DOMPurify is testable at the component tier.

**Alternatives rejected.** `sanitize-html@2.17.7` (MIT, active): a string sanitiser built on
`htmlparser2` + `postcss` — it parses HTML *differently from the browser that renders it*, which is
the mutation-XSS class DOMPurify exists to close. Extending `svg-sanitise.ts`: no.

---

## R3. Isolation: in-renderer DOM, with three independent layers behind the sanitiser

**Decision.** The preview body is an ordinary element in the panel's React tree, holding the
sanitised fragment. It is **not** a sandboxed `<iframe>` or `<webview>`. Defence in depth comes from
layers that do not depend on the sanitiser being right:

1. **CSP already forbids inline script.** `ui/src/renderer/index.html:5-8` sets
   `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'`. With no
   `'unsafe-inline'` in `script-src`, an inline `<script>` or an `onerror=` attribute that somehow
   survived sanitisation still does not execute. The policy gains `img-src 'self' https:
   throng-preview:`, `object-src 'none'`, `frame-src 'none'`, `base-uri 'none'`, `form-action
   'none'` (R8).
2. **Links carry no `href`** (R6), so no click, middle-click, drag or Enter can make Chromium
   navigate the app window. The existing `setWindowOpenHandler` guard
   (`ui/src/main/window-open-guard.ts:20-25`) *opens* http(s) targets externally, so an `<a href>`
   middle-click would otherwise have been a route around FR-094's Ctrl+click rule.
3. **A main-process request filter** (R8) cancels every renderer request that is not an app asset,
   a `throng-preview:` URL, or — while permitted — an https image. It is the authority for FR-093,
   independent of anything the renderer does.

Plus a hardening guard: `will-navigate` is prevented for every renderer window
(`ui/src/main/main.ts:303-336`, `:433-456`), which is NOT FOUND today and costs one listener.

**Rationale for not using an iframe.** A sandboxed iframe without `allow-scripts` is a strong
boundary, but every requirement that makes the preview a *panel* has to cross it:

- Theme colours and fonts are CSS custom properties on the app document (`--throng-colour-*`,
  `--throng-font-*`, `core/src/config/theme.ts:712-728`). They do not inherit into an iframe, so every
  token would be copied in and re-synced on theme change (FR-083).
- Keyboard dispatch is a capture-phase window listener (`ui/src/renderer/app.tsx:299-337`); focus
  traversal through links and out of the panel (FR-096b), Ctrl+Enter (FR-096c), Shift+F10 (FR-096d),
  the in-document context menu (FR-095), Ctrl+click (FR-094), selection and copy (FR-035) and zoom
  (FR-034) would all need cross-document plumbing.
- With `allow-same-origin` the parent can reach in, and the sandbox is then weaker than it looks;
  without it, the parent cannot read the selection at all.

A `<webview>` is a separate renderer process with the same problems and Electron's own advice
against it.

---

## R4. Front matter and YAML: split in the pipeline, parse with `yaml`

**Decision.** A pure function `splitFrontMatter(text)` recognises a `---` line as the document's
**first** line closed by a later `---` line (CRLF-tolerant, trailing whitespace allowed) and returns
`{ source, body, bodyLineOffset }`. The source is parsed with **`yaml@^2.9.1`** (ISC, zero runtime
dependencies, bundled types): `parseDocument(source, { uniqueKeys: true, merge: false })`.

- Parse errors, or a top level that is not a mapping, render as a code block of the source (FR-085:
  "never as a notice"). A valid top-level scalar or sequence is not "key/value" data, so it takes
  the code-block branch too — the requirement presupposes a mapping.
- A mapping renders as a two-column table. Scalar values are shown as text. **Nested structures are
  shown as their YAML source**, sliced from the original text by the node's `range` — which is why
  `yaml` is chosen: it keeps source ranges, so the value shown is what the author wrote, comments and
  quoting included.
- The table is built as escaped HTML and joins the same string the sanitiser receives (FR-085:
  "the same sanitisation as everything else").
- `bodyLineOffset` keeps `data-source-line` anchors correct for the body (R11).

**Alternatives rejected.** `js-yaml@5.4.x` (MIT, active, and already resolved in the lockfile at
5.4.1 as a transitive dev dependency, `package-lock.json:6862`): it has no source ranges, so nested
values could only be re-dumped — not "their YAML source" — and it is not currently a runtime
dependency of anything shipped. `markdown-it-front-matter@0.2.4` (last published 2024-04): a
tokenizer rule is more code than the split it replaces.

Neither parser executes code: `yaml`'s default schema has no function or class tags.

---

## R5. Fenced code highlighting: reuse the editor's grammars and highlight style

**Decision.** Highlight fenced code with `@lezer/highlight`'s `highlightCode`
(`node_modules/@lezer/highlight/dist/index.d.ts:176`, version 1.2.3 resolved at
`package-lock.json:2370`) using the **editor's own** `throngHighlightStyle`
(`ui/src/renderer/editor/highlight-style.ts:20`) and grammars loaded through the **editor's own**
`loadLanguage` (`ui/src/renderer/editor/language-loaders.ts:78`). No highlight.js, no shiki.

- **Language from the info string** — a pure core function `languageForFenceInfo(info)` over the
  existing registry (`core/src/editor/languages.ts:137` `languageById`): exact id, then
  case-insensitive name, then `.${info}` as an extension (so `ts`, `py`, `sh` resolve without an
  alias table). Unknown → plain text. `mermaid` → plain text (FR-086).
- **Ordering is the security point.** Highlighting runs **after** sanitisation, on the inserted DOM:
  each `pre > code[data-lang]` is replaced by spans built with `createElement` + `textContent`. No
  HTML string is ever produced by the highlighter, so it cannot bypass the sanitiser.
- **Grammars load asynchronously** (each is its own Vite chunk, `ui/vite.config.ts:38-73`): a block
  renders as plain text first and is highlighted when its grammar arrives. Lines longer than the
  editor's `LONG_LINE_THRESHOLD` (`highlight-style.ts:73`) stay plain, for the same reason.
- **Theme-live for free.** `throngHighlightStyle` is defined in CSS variables, so a theme change
  repaints preview code without re-rendering (FR-083), exactly as it does in the editor.
- `@lezer/highlight` is imported directly and is added to `@throng/ui`'s `dependencies` — it is
  currently transitive only (commit `2d222e49` recorded the declared `@codemirror` set; the same
  discipline applies).

**Alternatives rejected.** highlight.js: a second grammar set that colours the same language
differently from the editor beside it, plus a class vocabulary that would need mapping onto the ten
syntax tokens. shiki: TextMate grammars through an Oniguruma WASM build — needs `'wasm-unsafe-eval'`
in `script-src`, weakening layer 1 of R3.

---

## R6. Links: classified in core, carried without `href`, followed only on purpose

**Decision.** In the sanitiser's `afterSanitizeAttributes` hook, every `<a>` is classified by a pure
core function and **its `href` is removed**:

```text
classifyPreviewLink(href, { docPath, projectRoot }) →
  | { kind: 'external', url }                  // http:, https:, mailto:  (FR-091)
  | { kind: 'file', absPath, fragment? }       // relative/absolute path inside the project (FR-090)
  | { kind: 'heading', fragment }              // '#…' in the same document (FR-090f)
  | { kind: 'outside', target }                // resolves outside the project (FR-090e)
  | { kind: 'inert' }                          // everything else: javascript:, data:, file:, ftp: … (FR-091)
```

The element keeps `data-throng-link` (the classification, JSON), `tabindex="0"`, `role="link"`, and a
`title` of `<target> — Ctrl+click to follow` (FR-094's hover). An inert link keeps its text and gets
none of these, so the link menu is absent over it (FR-095) and it is not a Tab stop.

- **Following** happens on a `click` with `ctrlKey` whose selection is collapsed (so a Ctrl+drag
  selects text, FR-094), or on the `preview.followLink` command (Ctrl+Enter, FR-096c). Plain Enter
  on a `role=link` element without `href` activates nothing natively — FR-096c's "plain Enter MUST
  follow nothing" holds by construction.
- **Containment** uses the shipped predicates: `relPathUnderRoot` (`core/src/explorer/path-rules.ts:27`)
  after percent-decoding and `..` resolution. The project root is the preview panel's
  `originProjectId`, resolved **in main** (R9), never trusted from the renderer.
- **Headings** are matched by a GitHub-style slug (`headingSlug`: lower-case, strip punctuation,
  spaces → `-`, de-duplicate with `-1`, `-2`), emitted on each heading as `data-heading-slug` during
  rendering and looked up with `querySelector('[data-heading-slug="…"]')` (the slug `CSS.escape`d)
  for a fragment — never as an `id`, which the sanitiser removes.
- **FR-090d** (a target with no enabled provider) routes through the Files & Folders open path; a
  fragment places the caret via a pure `markdownHeadingLine(text, fragment)` when the file's language
  is Markdown, and opens at the top otherwise.
- **External** links go through the platform seam — R10.
- **Rich copy** (R12) re-materialises `href` from `data-throng-link` for `external` links only, so
  pasted HTML keeps working links without the live document ever holding one.

---

## R7. Images: relative through a confined protocol, remote only as https and only when on

**Decision.** In the same hook, every `<img src>` is resolved by a pure core function:

```text
resolvePreviewImage(src, { docPath, projectRoot, remoteImages }) →
  | { kind: 'project', relPath }   → src = throng-preview://asset/<previewPanelId>/<encoded relPath>
  | { kind: 'remote', url }        → src kept (https only, only while remoteImages)        (FR-092)
  | { kind: 'blocked' }            → src removed, alt text shown                          (FR-084/FR-092/FR-093)
```

Relative paths resolve against the **document's own folder** (FR-084). `http:`, `file:`, `data:`,
protocol-relative `//host` and anything outside the project are `blocked`.

**The protocol.** A privileged scheme `throng-preview:` registered with
`protocol.registerSchemesAsPrivileged` (before `app.ready`) and served with `protocol.handle` on the
default session. Custom protocols are NOT FOUND today. The handler:

- takes the **preview panel id** from the URL and looks up that preview's project root and document
  folder **in main's own state** (R9). A renderer cannot name an arbitrary root.
- re-checks containment on the **resolved real path** (the `EditorService.resolveEntry` precedent,
  `ui/src/main/editor-service.ts:123-135`: symlinks resolved before the rule sees the path).
- serves only an image MIME allowlist by extension (`png jpg jpeg gif webp avif bmp ico svg`), with
  `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff` on the response. An SVG
  loaded through `<img>` cannot run script in any case.
- caps the size at `editor.maxOpenFileBytes`.

**#388 (PDF) is admitted, not built.** A binary provider's content is the previewed file's bytes,
and the same handler shape serves `throng-preview://source/<previewPanelId>` — the route is
contracted and exercised by the test-only binary provider (SC-003), with its MIME allowlist
declared by the provider. No PDF MIME type ships.

**Alternatives rejected.** Reading images over IPC into `blob:` URLs: every image crosses the
bridge as bytes, object URLs must be revoked on every re-render, and `blob:` would have to join
`img-src`. Leaving `file:` URLs: a `file://` page's `'self'` is the very thing that would let
`<img src="file:///C:/Users/…">` load (Open item O1).

---

## R8. The network rule: CSP plus a main-process request filter

**Decision.**

1. **CSP** (`ui/src/renderer/index.html:5-8`) becomes:
   `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https:
   throng-preview:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`.
   `connect-src`, `font-src` and `media-src` stay on `default-src 'self'`, so remote stylesheets,
   fonts, media and fetches are refused by the engine (FR-093).
2. **A request filter** on the default session:
   `session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, …)`, installed in UI
   main. For a request that **has a `webContents`** (renderer-originated; main's own `net` requests
   pass untouched) it calls a pure core decision:

   ```text
   decideRendererRequest({ url, resourceType }, { rendererDir, remoteImages }) → 'allow' | 'cancel'
     allow  file: under the app's renderer directory
     allow  throng-preview:
     allow  devtools: / chrome-extension: (DevTools)
     allow  https: with resourceType 'image' while remoteImages
     cancel everything else
   ```

   `remoteImages` is **true while any enabled provider declares a remote-images setting that is
   on** (R15) — main does not name Markdown.

**Why both.** CSP is the engine's rule and needs no main-process round trip, but it is one policy
for every window and cannot express a user setting. The filter can, and it is what makes SC-004's
"no request is made" a statement about the network rather than about the markup. The sanitiser (R7)
removes the `src` of a disallowed image first, so with Load remote images off no request is even
attempted; the filter is what guarantees that a sanitiser defect still produces none.

**Risk.** A filter over `<all_urls>` cancels anything the app loads that nobody listed. Nothing in
the renderer loads a non-`file:` resource today (no `img-src`/`connect-src` directive,
`index.html:5-8`), but that is a code reading, not a run — Open item O3.

---

## R9. Where preview state lives: a main-side `PreviewService`, keyed by preview panel id

**Decision.** A new UI-main service, `ui/src/main/preview-service.ts`, is the **single authority**
for every open preview: which file it shows, which project it belongs to, where its content comes
from, and who is watching. It follows the 043 round-two `FileSearchService` shape exactly — a run
keyed by panel id with a **viewer set** of web-contents ids (`ui/src/main/file-search-service.ts:197`,
`:384`, `:613-630`) — for the same two reasons 043 gave:

- **Sync to clones the Panel.** `detachPanel`/`addPanelToSubWorkspace` shallow-copy the Panel
  (`core/src/workspace/sub-workspace.ts:50,138`), and `updatePanelConfig` is **not** relayed between
  windows (`preload.cts:206-252`, `main.ts:1820-1880` relay only rename/retitle/destroy/draft/typed).
  A preview's current file kept only in `Panel.config` would fork the moment it is synced. FR-022
  requires "every view of the same preview shows the same thing"; FR-090a changes the file in place.
- **Delivery to viewers, not a broadcast.** A sub-workspace window may hold a different project
  (043 round-two Principle I row). Preview content is file content; it goes to the preview's viewers
  only.

What the service does, and the requirement each answers:

| Responsibility | How | FR |
|---|---|---|
| Open-preview registry by canonical path | `Map<path, previewPanelId>`, with a *pending* reservation taken at open time so two quick opens cannot make two | FR-012 |
| Parented vs standalone | **Derived** on every registry event: parented exactly while the editor registry holds a document for the path (`core/src/editor/open-registry.ts:11-19`) | FR-013, FR-013a/b |
| Parented content | Snapshots of the document's text from the coordinator, debounced with max-wait (R13); dirty pushed **immediately** | FR-022, FR-040, FR-060/060a |
| Standalone content | `IFileWatcher.watch(dirname)` (`core/src/abstractions/file-watcher.ts:25-40`) and a re-read through `EditorService.load` | FR-023 |
| Read without registering | `EditorService.load` and `resolveEntry` register nothing — only `EditorCoordinator.load` does (`editor-coordinator.ts:276-332`, registration at `:326`). The service calls the **service**, never the coordinator's load | FR-025, SC-006 |
| Refusals | `LoadResult.reason` (`editor-service.ts:43`) mapped to one notice | FR-026 |
| Type change on Save As / move | Follows the document's path change; if the new path has no enabled provider → FR-027's notice | FR-027, FR-031 |
| Refresh | Flush immediately, ignoring the delay | FR-028 |
| Link navigation in place | Records history (R14), re-binds the file, re-derives parented state | FR-090a–c |
| Asset/source protocol lookups | Project root and document folder per preview id | FR-074, FR-084 |
| Reveal confinement | `filesService.setOpenDocumentCheck` (`main.ts:1403`) becomes *editor open **or** preview open*, so Open in OS Explorer on a standalone preview is not refused | FR-033 |

**Content is sent as versioned snapshots, not a change stream.** A preview re-parses the whole text
on every update, so an ordered change stream buys nothing a monotonically increasing `revision`
does not: a snapshot older than the last one applied is dropped. This still satisfies Principle XI
as written — *"a replica driven by an ordered stream from a single authority satisfies this rule"* —
because the authority is the coordinator's `DocumentAuthority` and the preview is a derived view of
it with no content, dirty state, undo, language or indentation of its own.

**The coordinator gains an observer, not a second relay.** Main already mirrors edits with
`relaySync` (`editor-coordinator.ts:194`), but three events the service needs are NOT FOUND on it:
registration (`:326`, `:532`), destruction (`:1220` sends nothing), and a Save-As re-point (`:1168`
relays no `movedTo` — an observed gap). The coordinator gains an injected
`DocumentLifecycleListener { registered, unregistered, repointed, changed, dirtyChanged }`, called
at those sites. `relaySync` is unchanged.

**Parent name across windows.** A parented preview's title is its parent editor's *display* name
(FR-031), which may be custom and is known only to a renderer. The window that mounts an editor
publishes `{ panelId, title }` whenever that title changes; the service forwards the current parent
title in every update. A preview in the same window as its parent reads it the same way — one
mechanism, not a local fast path plus a remote one.

**Alternatives rejected.** A renderer-side follower applying `throng:editor:sync` changes into a
`DocumentReplica` (`ui/src/renderer/editor/document-replica.ts`, which needs no `EditorView`): every
window would derive parented state separately from a broadcast that announces neither document
open nor destroy, and `ResetDocumentMsg` carries no path (`core/src/editor/document-sync.ts:76-81`),
so an in-place open into the parent panel is indistinguishable from an edit. Two windows deriving
the same fact is the "two originals" Principle XI forbids.

---

## R10. External links and the platform seam

**Decision.** `IShellIntegration` (`core/src/abstractions/shell-integration.ts:7-12`) gains
`openExternal(url: string): Promise<void>`, with `ElectronShellIntegration`
(`ui/src/main/electron-shell-integration.ts:16-27`) implementing it and the shell-integration
contract suite (`core/src/testing/shell-integration-contract.ts`) covering it.
`isSafeExternalUrl` (`ui/src/main/external-url.ts:10-12`) widens to accept `mailto:` (FR-091).

Both existing direct calls to Electron's `shell.openExternal` — `main.ts:901-903`
(`throng:openExternal`) and `window-open-guard.ts:22` — move onto the seam **in this change**.

**Rationale.** FR-091 says "through the platform seam (Principle II)", and the seam is missing:
reveal goes through `IShellIntegration`, open-external goes straight to Electron. Unlike 043's
`IFileSystem` DI continuation, this is two call sites in files the feature already edits; adding a
seam for the new caller while leaving two old callers on the concretion would create the "two
conventions" 043 declined to create. Terminal links (`ui/src/renderer/terminal/use-terminal.ts:27-31`)
already pass only http(s), so widening the scheme set changes nothing for them.

---

## R11. Keeping the reader's place, and restoring it

**Decision.** Block-level tokens carry `data-source-line` (markdown-it `token.map[0]` plus the front
matter offset, R4). Before replacing the body, the view records a **scroll anchor**: the first block
whose rect intersects the top of the viewport, as `{ line, offsetRatio }` (how far into that block
the viewport top sits). After `replaceChildren`, it finds the block with the nearest
`data-source-line` at or before `line` and scrolls to the same ratio. An update never scrolls to top
(FR-024).

The **same shape** is the Markdown provider's history view state (FR-101, FR-107): leaving an entry
records the anchor; returning restores it. The history model stores view state as an **opaque,
size-bounded JSON value owned by the provider** (data-model §4), so a PDF provider can store a page
number without the history model knowing what a page is.

**Why not `scrollTop`.** A pixel offset is wrong the moment content above it changes height — which
is every update of a document being typed into. The anchor survives edits above the viewport.

**Testable where.** The anchor *arithmetic* is a pure function (unit). What is actually scrolled into
view after a real layout is `@reserve:layout` — jsdom reports every rect as `0×0`
(`e2e-budget.json` `measuredFrom`, the #382 entry, records the same limit).

---

## R12. Copy: rich text through the clipboard seam

**Decision.** `IClipboard` (`core/src/abstractions/clipboard.ts:15-20`) gains
`writeRich({ text, html }): Promise<void>`; `ElectronClipboard` implements it with Electron's
`clipboard.write({ text, html })`; the memory implementation records both; the clipboard contract
suite (`core/src/testing/clipboard-contract.ts`) covers it. The interface's doc comment — *"Plain text
only, both directions. throng never writes a custom clipboard format"* (`:11-13`) — is amended: HTML
is a **standard** clipboard format, and read stays plain text.

- **What is copied.** Plain text is `Selection.toString()`. HTML is the selection's cloned range,
  re-sanitised with a stricter **export profile** (no `data-*`, no `id`, no `class`, highlight spans
  flattened to text, `href` restored for `external` links only) — FR-035a's "sanitised HTML".
- **Which format.** Copy and the platform copy gesture use `editor.previews.copyFormat` (FR-035b);
  Copy as Rich Text / Copy as Plain Text ignore it (FR-035c). The body's `copy` event is intercepted
  (`preventDefault`) and routed through the same function, so the chord and the menu cannot diverge.
- **Select All** is scoped to the preview body. Chromium's default Ctrl+A selects the whole app
  document.

The renderer never uses `navigator.clipboard` today — every write is IPC to main
(`preload.cts:600-604`, `ui/src/main/clipboard-ipc.ts:21-40`). This keeps that true.

---

## R13. Debounce with a maximum wait, and where it runs

**Decision.** A pure core scheduler `createSettleScheduler({ delayMs, maxWaitMs, clock })` —
trailing debounce of `delayMs`, forced flush no later than `maxWaitMs` after the first unshown change
— runs **in main**, inside `PreviewService`, per preview. `flush()` serves Refresh (FR-028).

- **Effective max wait** is `max(maxWaitMs, delayMs)`, computed at read time by a pure function, so a
  stored value below the delay behaves as equal to it (FR-060a) without rewriting the user's file.
  There is no precedent for a cross-field bound in `bounds-guard.ts:236-286`; a read-time rule is
  the smallest thing that satisfies the requirement.
- **Dirty is never debounced**: FR-040 is "exactly while dirty".
- **Standalone** previews are not debounced beyond the watcher's own coalescing (`NodeFileWatcher(150)`,
  `main.ts:1276`) — FR-060 governs parented previews only.

**Why main.** Debouncing in main means one timer per preview however many windows show it, and a
typing burst sends one snapshot per settle rather than one per keystroke per viewer. It is also the
only place Refresh can bypass it for every viewer at once.

**SC-002** is `delay + render` ≤ 1 s for 1,000 lines: 300 ms of delay leaves 700 ms for IPC, parse,
sanitise and insert. The arithmetic is unit-tested with a fake clock; the render cost is Open item O7.

---

## R14. Navigation history: a core model, a main authority, hooked at the load

**Decision.**

- **Model** — a pure reducer in `core/src/navigation/history.ts`: `recordOpen`, `moveTo`, `canGoBack`,
  `canGoForward`, `applyCap`, `rewritePaths`, `rewriteCurrent`, `setCurrentViewState`, `parseHistory`.
  Invariants in data-model §4.
- **Authority** — `ui/src/main/navigation-history-service.ts`, keyed by panel id, broadcasting every
  change to every window (no viewer set — a detached background-tab panel must still mirror it),
  for the reason R9 gives: a panel shown in two windows has **one** history (FR-110), and a synced
  Panel's config forks. Each window mirrors the authority's state into `Panel.config.history`, which
  is what the layout persists (FR-109). On mount a window **attaches** with its persisted copy; main
  adopts it only if it holds none (the `adoptQuery` precedent, `file-search-service.ts:134,699-711`).
- **Hook point for editors: `EditorCoordinator.load`, in main.** Every in-place load into an editor
  panel ends in `EditorActions.openFile` → `editor.load` → `coordinator.load`
  (`ui/src/renderer/editor/use-editor.ts:775-814`; `editor-coordinator.ts:276-332`) — Files & Folders
  click and Enter, Open In → Last Active Editor, Quick Open, a Find in Files result, a tab drop, a
  drop on the panel, and the unsaved-open prompt's Discard & open / Save & open
  (`ui/src/renderer/editor/editor-open.tsx:128,197-213,256-302`). The load request gains an optional
  `navigation: { kind: 'history', index, filePath }`. Without it, a load that leaves the panel
  showing the path — a successful read, or a missing file the panel holds open (041 FR-015) — calls
  `recordOpen`. With it, the same outcome calls `moveTo(index)`. A refusal calls neither.
- **Why this satisfies FR-106 without per-outcome code.** Cancel never reaches `load`; a failed save
  never reaches `load`; Open in new editor loads a **different** panel, whose first load records its
  own first entry (FR-106a); a file open elsewhere is focused by `openInto` before any load (FR-106b);
  a binary/too-large/out-of-tree file is refused by `openInto` (FR-106c). The position moves exactly
  when the panel's content changed, because that is the only moment `load` runs.
- **FR-106d needs one exception, stated.** `openInto` refuses before any load
  (`ui/src/main/editor-ipc.ts:249-278`), and a missing file must still move the position and show the
  editor's could-not-read state. For a history intent the renderer skips `openInto`'s *missing-file*
  refusal only (`NOT_A_MISSING_FILE`, `core/src/editor/refusal.ts:27`), so `load` runs, the panel
  shows its failure banner, and the position moves.
- **The prompt logic is consolidated.** It is duplicated today in `openFileInTab` (`editor-open.tsx:197-213`)
  and `openFileInPanel` (`:285-301`). Back/Forward would be a third copy. It becomes one
  `openIntoEditorPanel(ws, panelId, absPath, intent)` both callers and history use (Principle VIII).
- **Path following.** The Save-As re-point (`editor-coordinator.ts:1168`) calls the history service's
  `rewriteCurrent` from inside the coordinator, which holds the service for `load` anyway; a move calls
  `rewritePaths` from main's one combined `onMoved` callback, after `markMoved` (contracts/preview-ipc.md
  §3), and the service rewrites every history it holds, not only those of open documents (FR-109).
  *(Revised 2026-09-14, analysis: an earlier wording had `markMoved` call `rewritePaths` and a second
  lifecycle listener subscribe to `repointed`; the setter and the listener each hold one callback.)* A new per-window broadcast of `MovePair[]`
  (`files-service.ts:288,341`) lets each window's mirror follow even for panels whose view is
  unmounted — the `MovedPathSync` precedent (`ui/src/renderer/editor/moved-path-sync.tsx:29-54`).
- **Save As** rewrites the current entry's path rather than appending: the panel still shows the same
  document, now at a new path. FR-103a does not list Save As as an open, and FR-109 says history
  follows a file whose path changes.
- **Preview history** is recorded by `PreviewService`: the file a preview opens with is its first
  entry (FR-103b), a link followed in place records (FR-090a), and a history intent moves. A change
  in parented state touches nothing (FR-103b).
- **Purge.** `destroyPanel` (`ui/src/renderer/workspace/panel-placeholder.tsx:441-467`) and its remote
  twin `panel-destroy-sync.tsx:31-41` call `history.purge`; so does clearing a panel's type
  (`core/src/panel-type/assignment.ts:92-102` deletes `config`, which also removes the persisted copy
  by construction). Send to Tab keeps the Panel object and its id, so history survives (FR-110).
- **Cap.** `editor.navigation.historySize` (ships 10) is applied by the service on settings change to
  every history it holds, dropping oldest entries and never the current one (FR-108).

**Alternatives rejected.** History only in `Panel.config`, written by the renderer: forks on Sync to.
A renderer-side hook in `openFile`: `openFile` returns `void` (`use-editor.ts:775-814`) and does not
see the prompt, so Cancel and failed saves would each need explicit handling that the main-side hook
gets for free.

---

## R15. Settings from a provider's registration

**Decision.** Provider settings are **ordinary leaves generated from the provider registry at module
load**, not a `map` setting:

```text
editor.previews.updateDelayMs             300    (FR-060)
editor.previews.maxWaitMs                 1000   (FR-060a)
editor.previews.copyFormat                'rich' (FR-035b)
editor.previews.providers.<id>.enabled            (FR-061, FR-065)
editor.previews.providers.<id>.defaultOpenAction  (FR-050; absent for binary providers, FR-051)
editor.previews.providers.<id>.<own leaf>         (FR-071; markdown: loadRemoteImages = true, FR-092)
editor.navigation.historySize             10     (FR-108)
```

- **Why not `control: 'map'`.** `leavesOfDeclared` counts a `map` as one leaf
  (`core/src/config/metadata.ts:322`); every row would share one column set, so it could express
  neither "no default open action for binary" nor per-provider settings, and its `keyKind` is
  `language | text` only. Rows would be user data, not schema.
- **Precedent for derivation.** `SHIPPED_INDENT_BY_LANGUAGE` is derived from the language registry
  (`app-settings.ts:617`); `noticeDescriptors()` / `confirmDescriptor()` are generated descriptors
  spread into `SETTINGS_METADATA` (`settings-metadata.ts:67,80`).
- **Shape.** Three pure functions taking the registry as a parameter —
  `previewSettingsDefaults(registry)`, `previewSettingsDescriptors(registry)`,
  `parsePreviewSettings(raw, registry)` — called once at module level with the shipped registry. A
  test passes its own registry (SC-003). The cycle trap (`settings-metadata.ts` imports
  `app-settings.ts`, `app-settings.ts:1222-1226`) is avoided because the registry imports neither.
- **Clone trap.** `cloneEditor` (`app-settings.ts:1093`) re-clones every object member;
  `editor-settings.test.ts` checks it, and it must cover `previews.providers.*`.
- **Grouping.** `group: 'Editor', subgroup: 'Previews'` (FR-061, Finding 7). This **breaks
  `settings-metadata-040.test.ts:167-179`**, which pins the Editor group's subgroup to the three
  status-bar keys. That guard encodes 040's scope, not a constitutional rule, and is amended.
  `editor.navigation.historySize` joins `Editor · Navigation`, which `:191-204` permits.
- **"Shown disabled while the provider is disabled" (FR-061, amended 2026-09-14).** The existing
  `enabledWhen` does exactly this (`settings-tab.tsx:286-290`: a failing test disables, it does not
  hide), so each provider's `defaultOpenAction` and own settings carry
  `enabledWhen: { key: 'editor.previews.providers.<id>.enabled', is: true }`. **No new descriptor
  field.** *(The first draft added `visibleWhen` to hide them; the spec now follows Principle VI and
  that field is dropped.)*
- **Metadata injection.** `settings-tab.tsx:152-156` reads the module constant `SETTINGS_METADATA`.
  It reads it from a context whose default is that constant, so the SC-003 test can render the
  preferences tab with a test registry's descriptors.
- **Inertness.** A `settings-inertness-044.test.ts` following 043's rule (the reading file must also
  name the parent segment, because `enabled` collides everywhere).
- **Shipped defaults.** New setting leaves need no upgrade (the parser supplies absent keys,
  `shipped-defaults.ts:112-115`); new **icon tokens** do (R17).

---

## R16. Key bindings and a fifth dispatch scope

**Decision.**

| Action | Scope | Ships as | FR |
|---|---|---|---|
| `preview.open` | `editor`, `explorer` | unbound (`[]`) | FR-005 |
| `navigate.back` | `editor`, `preview` | `Alt+Left` | FR-105 |
| `navigate.forward` | `editor`, `preview` | `Alt+Right` | FR-105 |
| `preview.followLink` | `preview` | `Ctrl+Enter` | FR-096c |

- **A new `DispatchScope` `'preview'`** (`core/src/config/keybindings.ts:149`), added to `EVERYWHERE`,
  `SCOPE_NAMES` (`:610`) and `SCOPE_ORDER` (`:624`), and mapped in `scopeFromKind`
  (`ui/src/renderer/keybindings/scope.ts:63-78`). Without it an unmapped kind falls back to
  `explorer`, where `file.delete/rename/cut/copy` act on the tree's selection
  (`scope.ts:66-75`) — exactly what FR-021 forbids. Save, find and revert are editor-scoped and are
  therefore inert in a preview by construction.
- **Back/Forward are window-handled.** CodeMirror's `defaultKeymap` binds `Alt-ArrowLeft/Right` to
  `cursorSyntaxLeft/Right` (`use-editor.ts:1131`; `@codemirror/commands` `index.js:1780-1781`). The
  window's capture-phase handler runs first and calls `preventDefault` + `stopPropagation` for actions
  in `WINDOW_HANDLED_ACTIONS` (`app.tsx:204-230,299-337`), which is how FR-105's precedence is met.
- **Terminal tiers.** None of the three chords is in the reserved or shadowable tier
  (`core/tests/unit/terminal-reserved-keys.test.ts`), and none is scoped to `terminal`. No exception
  is recorded. The window-chord manifest guard applies only to backtick, F-key and letter chords
  (`ui/tests/unit/window-chord-manifest.test.ts:100`), so arrows and Enter do not trigger it.
- **Mouse back/forward buttons.** A `mouseup` listener on the panel root for `button === 3 | 4`,
  with `preventDefault` on the matching `mousedown`, performs the same commands (FR-105: "pressed
  over such a panel"). Electron's `BrowserWindow` `app-command` event is window-level, has no hit
  target, and also fires for keyboard media keys — rejected. NOT FOUND anywhere today.
- **Menu chords.** `firstBinding` (`keybindings.ts:548`) is per action, not per scope, so the same
  chord shows on editor and preview menus (Principle IV, one command one chord).

---

## R17. Theme tokens

**Decision.** **Four new icon tokens**: `preview`, `refresh`, `navigateBack`, `navigateForward`.
**No new colour token.** `SHIPPED_DEFAULTS_VERSION` **7 → 8** (`core/src/config/shipped-defaults.ts:133`).

- `preview` is the status-bar button, the Open Preview / Open In → Preview items and the panel type
  icon — one action, one glyph.
- **Open in Editor / Go to Editor reuses `editorPanel`** — the control's meaning is "the editor for
  this file", which is what that token already draws.
- `refresh` is new because `retry` (↻) means *Try again* after a failure (030 FR-042c), and a preview
  offers both at once while its failure banner is up.
- `navigateBack`/`navigateForward` are new because `chevronLeft`/`chevronRight` are the tab strip's
  step controls; reuse is the rule only for the **same** action.
- Each needs label and description copy in `theme-copy.ts` (`assertNamingConvention`,
  `theme-metadata.ts:153`). `EXPECTED_ICON_TOKEN_COUNT` 65 → 69 (`core/tests/unit/default-themes.test.ts:30`).
- **Colours for rendered Markdown** come from existing tokens: body `editorFg` on `editorBg`, prose
  in the `paneText` typography role, code in the `editor` role on the same `editorBg` with a `border`
  outline, links `syntaxFunction` underlined and block quotes `syntaxComment` italic (the colours
  `highlight-style.ts:54,58` already give them in the editor), table rules `border`, focus indicator
  an `accent` outline. No link, code-background, quote or table token exists and none is added: the
  same reasoning `highlight-style.ts:41-44` records for Markdown in the editor. *(Revised 2026-09-14,
  analysis: an earlier draft used `accent` for links, `textMuted` for quotes and `editorGutterBg`
  behind code — three text-on-background pairs `theme-quality.ts` does not measure, so SC-005 would
  have held for body text only. Every text colour now sits on `editorBg` in a pair it does measure.)*
- **SC-005's "same contrast bar"** is the pairing the editor text is held to — `editorFg`/`editorBg`
  at `WCAG_AA_BODY` 4.5 (`theme-quality.ts:519`). Using exactly that pair for body text makes the bar
  the same by construction. A CSS guard in the style of `find-in-files-results.test.ts:253-262` fails
  on any colour literal in `preview.css`.
- **Why the bump.** Without it an installed build never receives the new icon values and draws blank
  controls (`shipped-defaults.ts:25-83`).

---

## R18. The panel kind and what it touches

**Decision.** Kind id `'preview'`, config `PreviewPanelConfig = { filePath?, history? }`, descriptor
with `offered: false` (created only by command, like Find in Files,
`core/src/find-in-files/panel-type.ts:33-52`). The file list 043 touched for its kind (commit
`3c2c9e3c`) is the checklist: descriptor + registration, `panel-body.tsx`, `panel-title.ts`,
`panel-header-menu.ts` (`KINDS_THAT_ZOOM`, `isRenamable`), `panel-placeholder.tsx` (header, destroy
cleanup), `panel-destroy-sync.tsx`, `scope.ts`, `preload.cts`, `global.d.ts`, `main.ts`, `theme.css`.

- **`filePath` reuses the editor's key**, so `CONFIG_PATH_KEYS` (`core/src/workspace/persisted-paths.ts:35`)
  canonicalises a preview's path with no change (FR-068). `canonicalisePanel` (`:37-60`) is extended
  to walk `config.history.entries[].filePath` (FR-109).
- **Placement beside a panel** is `addPanel` then `movePanelToEdge(newId, targetId, 'right'|'left')`
  (`core/src/workspace/operations.ts:162,177`; store `workspace-store.tsx:346-353`). There is no
  single "new panel at edge" operation; one is added to core rather than repeating the pair at three
  call sites (FR-010, FR-015c, and the standalone case which appends at the tab root like
  `createDedicatedEditor`, `editor-open.tsx:319`).
- **Rename is inert** by leaving `isRenamable` false for the kind (`panel-header-menu.ts:80-82`),
  which gates the menu items, the double-click (`panel-placeholder.tsx:526`) and the rename-starter
  registration (`:208-213`); F2 is then a no-op (`panel-rename.ts:14-39`).
- **Zoom** joins `KINDS_THAT_ZOOM` (`panel-header-menu.ts:60`) and sets `--throng-zoom-preview` like
  `editor-panel.tsx:46`.
- **No layout schema change.** `LAYOUT_SCHEMA_VERSION` stays 3 and there is no SQLite migration:
  both new config fields are optional, the 006/043 precedent.

---

## R19. Disabling a provider: closing previews everywhere, including unloaded layouts

**Decision.**

- **Loaded windows** — a once-per-window `PreviewProviderSync` component reacts to the settings
  change and closes that window's preview panels whose file no longer has an enabled provider.
- **Unloaded layouts** — UI main, on the same settings transition, walks every project layout and
  every sub-workspace record through the **existing** RPCs (`workspace.load/save/loadSubWorkspaces/
  persistSubWorkspaces`, `ipc-contract/src/workspace.ts:6-10`), skipping any record that is not
  `restored` and any project a window currently holds, and applies a pure core
  `removePanelsWhere(layout, predicate)`. Precedent for the loop: the daemon's
  `panel-name-service.ts:115-165` `reconcile()`; precedent for the renderer-side sub-workspace strip:
  `detach-context.tsx:216-246`.
- **FR-064 (amended 2026-09-14).** `removePanelsWhere` behaves as closing each panel by hand: it goes
  through `removePanel` (`operations.ts:261-271`), so a split slot collapses and an emptied tab closes
  (`finalize`). Where the preview is the **last panel of the workspace's last tab** — which
  `removePanel` refuses to remove — it is **replaced by a new untyped placeholder panel** (fresh id,
  default title), so the workspace keeps the tab and panel 002 FR-016 requires. In a sub-workspace
  record, the `stripPanelFromSubWorkspaces` precedent applies (`core/src/workspace/sub-workspace.ts:311`).
- **FR-067.** Restore passes each loaded layout through the same predicate, so a preview whose
  provider is disabled or gone is never mounted — which also covers a layout written by a later
  build and read by an earlier one.
- **Idempotent.** Re-running the walk over already-purged layouts changes nothing (an assertion,
  per the Technology & Architecture constraint on migrations).

**No new RPC** and no `ipc-contract` or `daemon` change: the walk is a composition of RPCs that
exist. Which projects "a window currently holds" is Open item O6.

---

## R20. Opening a preview: one command, one router, placement where the parent is

**Decision.**

- **`preview.open`** is the one command (FR-005). The status bar, the editor body and header menus
  and Open In → Preview call it with the file; FR-052's click/Enter/Quick Open route calls it too.
- **The router for the default open action** sits *above* `openFileInTab`, not inside it, because
  `openFileInTab` is also called by Find in Files results (`find-in-files/result-open.ts:95-110`),
  Open In editor targets (`open-in-perform.ts:82-99`) and tab drops (`tab-group.tsx:161`) — all of
  which must keep opening editors (FR-054, FR-055). It is called from `openFileIntoEditor`
  (`editor-open.tsx:99-128`, which covers tree click and Enter) and from Quick Open's `choose`
  (`navigate/quick-open.tsx:158`), preserving the boolean Quick Open uses to remember its query.
- **Open In → Preview is added in the explorer only.** `describeOpenInTargets`/`openInMenuActions`
  (`editor/open-in-targets.ts:99,148`) are shared with Find in Files rows
  (`find-in-files/result-open.ts:192-200`, `find-in-files/content-menu.ts:146`); adding it there
  would leak Preview into Find in Files. It is passed to `buildContextMenuItems`
  (`explorer/context-menu-items.ts:62,148-151`) after the editor targets and before Terminal, with
  `OS File Explorer` kept first (`explorer.e2e.ts` depends on it, `context-menu-items.ts:181-182`).
  Its disabled state is an awaited `preview.isOpen(absPath)` at menu-open time, the
  `editor.isOpen` precedent (`file-tree.tsx:421`).
- **A disabled provider disables, it does not remove (amended 2026-09-14).** The status-bar button,
  Open Preview (body and header) and Open In → Preview are drawn **disabled** while the file's
  provider is disabled; the button's tooltip names the setting (*"Markdown previews are turned off —
  Preferences → Editor → Previews"*). They are **absent** only when no provider claims the extension,
  for folders, outside the project, and for an editor with no file on disk (FR-001, FR-003, FR-004,
  FR-062). While disabled, a default open action of Preview is **suspended**: `defaultOpenActionFor`
  returns `editor` without rewriting the stored value (FR-062).
- **The binding follows the document (FR-013c, added 2026-09-14).** A parented preview whose source
  document changes path — rename, move, or Save As — moves with it: `PreviewService` handles the
  coordinator's `repointed(from, to)` by rebinding the run to `to`, re-registering it under the new
  path, rewriting its history's current entry, re-deriving the title, and re-matching the provider;
  a new path with no enabled provider raises FR-027's notice.
- **The status-bar pressed state is pushed**, not polled: main broadcasts
  `throng:preview:openChanged { path, open }` so FR-014's button and FR-012's disabled items follow a
  preview opened or closed in any window.
- **Placement (FR-010).** The requesting window places the preview beside the parent if **its own**
  layout holds the parent panel. Otherwise main sends a placement request to the **main window**;
  if that window's layout does not hold the parent it declines, and main sends the request to the
  window the registry recorded (`editor-coordinator.ts:494` stores `{ panelId, windowId }`). The
  placing window brings the parent's tab to the front and main focuses that window (the
  `focusEditor` precedent, `main.ts:1322-1328`).
- **Standalone (FR-011)** appends at the active tab's root, which is where `createDedicatedEditor`
  places a new editor.
- **Open in Editor (FR-015c)** runs `editor.openInto` first (so a file opened elsewhere meanwhile is
  focused, not duplicated), then places a new editor to the preview's **left**.

---

## R21. Bundle

**Decision.** The Markdown pipeline (markdown-it, DOMPurify, yaml) is loaded by **dynamic import** on
the first preview mount and given its own `manualChunks` entry in `ui/vite.config.ts:38-73`.
Everything unlisted there lands in the eagerly loaded `vendor` chunk today, which would put ~150 KB
on every window's startup for a panel most sessions never open. Size is Open item O5.

---

## R22. E2E: what genuinely needs a running application

Every E2E test must name exactly one reserve entry from `ui/tests/unit/e2e-tags.test.ts:68-78`.
Four spec files, five declarations, **none `@core`**:

| Spec | Declarations | Reserve | Why nothing cheaper can assert it |
|---|---|---|---|
| `preview-hostile.e2e.ts` | 1 | `@reserve:runtime` | That a real Chromium, under the real CSP and the real request filter, executed nothing and requested nothing for the hostile fixture, and requested no https image from `remote-images.md` once the setting is turned off on disk (SC-004). jsdom neither fetches images nor enforces CSP — the substitute cannot hold the property. |
| `preview-scroll.e2e.ts` | 2 | `@reserve:layout` | What is scrolled into view after an update (FR-024) and after returning with Back (FR-107). jsdom reports every rect as 0×0. |
| `navigation-history-keys.e2e.ts` | 1 | `@reserve:input` | That a real Alt+Left in a focused CodeMirror goes Back rather than `cursorSyntaxLeft` (FR-105). A synthesised event asserts the shape the test chose, not the engine's dispatch order. |
| `preview-subworkspace.e2e.ts` | 1 | `@reserve:window` | That a preview synced into a sub-workspace window follows its parent being typed into in the main window, and that Back in one window moves the other's (FR-022, FR-110). Two windows are the assertion. |

Categories: `@editor` ×4, `@window` ×1. **The budget does not rise**: five existing `@extended`
declarations with no reserve tag and an assertion a lower layer already makes — four `@editor`, one
`@window` — are moved down first (tasks T163a–T163e), so `e2e-budget.json` reads total 569,
`@editor` 117, `@window` 197 and `core` 39 before and after, each step recorded in `measuredFrom`.
*(Revised 2026-09-14, analysis: an earlier draft raised the budget 569 → 574 on the strength of eight
recorded raises, which does not satisfy Principle V's "MUST NOT rise".)* The scroll, key and sub-workspace specs focus windows or open context menus and go in
`parallel-plan.json`'s serial map (`tier-plan.test.ts`).

**Mouse X-buttons are not E2E-testable** — Playwright's mouse supports `left | right | middle` only.
FR-105's buttons are asserted at the component tier (the handler) and in a manual quickstart step.

---

## Open items

Each needs a run or a probe that could not be made during planning. None blocks design; each has a
named task-phase owner.

| # | Question | Why it matters | Settled by |
|---|---|---|---|
| **O1** | Does a `file://` page's CSP `'self'` match `file:///C:/…` images outside the app directory? | Decides whether R7's sanitiser and R8's filter are the *only* guard against a local image load, or one of two. The design assumes they are the only guard. | `npx playwright test packages/ui/tests/e2e/preview-hostile.e2e.ts` with a `file:` image in the fixture |
| **O2** | Does Electron 43 on Windows deliver `mouseup` with `button` 3/4 to the page, with no default navigation? | FR-105's mouse buttons. | Manual step in [quickstart.md](./quickstart.md) §6 |
| **O3** | Does the `<all_urls>` request filter cancel anything the app already loads (fonts, icon packs, DevTools, the drag ghost window's `data:text/html` page)? | A silent regression anywhere in the UI. | Early: `npx playwright test packages/ui/tests/e2e/drag-ghost.e2e.ts packages/ui/tests/e2e/ghost-drag-noise.e2e.ts` (T056a), because `data:` is the one known load outside the allowlist's obvious rows; then `gh workflow run gate.yml --ref feature/S044-I10-I136-file-previews` — the full E2E stage (T176) |
| **O4** | DOMPurify 3.4 under the component project's jsdom 29. | FR-081's component tests. | `npx vitest run --project component packages/ui/tests/component/preview-sanitise.test.ts` |
| **O5** | Size of the preview chunk and whether `vendor` grows. | R21. | `npm run build`, then list `packages/ui/dist/renderer/assets` |
| **O6** | How UI main learns which projects a window currently holds, for R19's skip. | Avoids a daemon write racing a renderer save. | Code reading at task time: `workspace-store.tsx:409-415` (panel identities sent to main) |
| **O7** | Parse + sanitise + insert time for a 1,000-line fixture. | SC-002's 700 ms after the delay. | `npx playwright test packages/ui/tests/e2e/preview-scroll.e2e.ts` with a timing probe, or a manual stopwatch per quickstart §2 |
| **O8** | `@lezer/highlight` and `style-mod` resolve as direct dependencies of `@throng/ui` after declaration. | R5. | `npm ls @lezer/highlight style-mod --workspace @throng/ui` |
| **O9** *(iteration 2026-09-15)* | Why does the browser drop behind throng after a Ctrl+clicked web link — throng re-activating itself (H-a), or the Windows foreground lock (H-b)? | FR-119's remedy differs completely between them (R27). | **Settled 2026-09-16 (T208). H-b.** The probe — run through `terminal-link-once.e2e.ts`'s existing `shell.openExternal` stub as one temporary module, then removed — saw **no** `browser-window-focus`, no `browser-window-blur` and no `WindowManager.raiseOne` after any of four external opens, so **H-a is refuted**; its blur-triggered variant is refuted statically too (main's only `browser-window-blur` consumer sets always-on-top *false*, and no renderer calls `window.focus()`). The remedy shipped in T210, commit `0c741da9`: `handOverAndOpen` calls `foregroundHandoff.allow()` after the scheme check and before `shell.openExternal`, on both channels. What no automated test can settle — whether the grant actually leaves the browser in front, with the browser already running and closed — is the hands-on check in quickstart §8 (**T217, still to run**). Full timeline in R27. *(Cell completed 2026-09-16 by converge: it named only the plan, while R27 already carried the verdict.)* |
| **O10** *(iteration 2026-09-15)* | With FR-114 shipping **on**, does anything in `preview-scroll.e2e.ts` declaration 1 (FR-024 — the preview scrolled by hand, then typing at the top of the editor) scroll the **editor**, which would now move the preview? | If typing scrolls the editor, the declaration would be observing FR-113, not FR-024. | **Settled 2026-09-16.** It does. The declaration failed 3/3 with sync on: its update is typed at the top of a 1000-line file, which scrolls the **editor** to keep the caret visible, and FR-113 then moves the preview to the editor's new top line — so the declaration was observing FR-113, not FR-024. No edit both proves the anchor compensated and leaves the editor's viewport alone, so the declaration now runs on its own app with `editor.previews.syncScroll` seeded **off** on disk (a hot reload would race the first keystroke). Commit `13885910`, with the reasoning in a comment at `preview-scroll.e2e.ts:137-151`; it passed in T216's run |

---

## Iteration 2026-09-15 — R23–R29

*Added by `speckit-iterate` for FR-113–FR-120 and the text-selection defect (plan.md, Iteration
2026-09-15). Additive; nothing above is revised except where a row says "refines".*

## R23. Scroll sync: a per-window store keyed by the editor's panel id

**Decision.** `renderer/editor/editor-scroll-store.ts` holds each mounted editor view's top visible
source line (0-based), written by `use-editor.ts`'s existing scroll listener (rAF-throttled, and once at
view registration) and read by the preview panel for `state.parent.panelId`. The body applies it with
the existing `restoreScrollAnchor(scroller, { line, offsetRatio: 0 })`.

**Rationale.**
- The renderer already knows the parent: `PreviewUpdate.parent.panelId` (`core/src/preview/wire-types.ts:43`),
  filled by `parentOf` (`ui/src/main/preview-service.ts:1094-1098`) with the coordinator's document panel
  id, and updated live as runs re-parent (`:806-870`).
- No scroll channel exists: `EditorSyncMsg` (`editor-coordinator.ts:256-280`) carries content, dirty,
  deleted, moves and wrap — not view state. Scroll is per-view state main does not own, the same line
  `caret-store.ts:5-9` draws.
- The editor view registry (`editor-views.ts:12-24`) has no change notification, so a store the editor
  writes to is what lets a preview that mounted first find out.
- **Top line with `posAtCoords`**, not `lineBlockAtHeight`: `use-editor.ts:492-514` records that the
  latter is inaccurate for wrapped lines, and `standalone-editor.tsx:129-140` already uses the former.
- Source lines line up without translation: `data-source-line = token.map[0] + bodyLineOffset`
  (`pipeline.ts:256-258`, `:291-293`) is a 0-based file line; CodeMirror's `doc.lineAt(pos).number` is
  1-based, so the publisher subtracts 1.

**Alternatives rejected.**
- *An IPC relay through main* so a preview in a sub-workspace window follows an editor scrolled in the
  main window: a high-rate channel through main for a case FR-010's placement rarely produces (a preview
  opens beside its editor), and one that would need a rule for which of several views drives. FR-113 is
  read as same-window (spec note under FR-113). The body API (`syncLine`) does not change if a relay is
  ever added.
- *Re-applying the editor's line on every live update*: would snap a reader who scrolled the preview by
  hand back to the editor on the next keystroke, and break FR-024 and `preview-scroll.e2e.ts`
  declaration 1.

**Testable where.** The store and the top-line helper (over a fake view) are unit; the wiring — the
panel subscribes to its parent, the body restores to the published line, off / standalone / binary do
nothing — is component, with rects stubbed as `markdown-body.test.ts` already does. **No E2E**: the
geometry of `restoreScrollAnchor` in a real engine is already held by `preview-scroll.e2e.ts`
(`@reserve:layout`), and `posAtCoords` is CodeMirror's own contract; a new declaration would assert the
connection, which Principle V assigns to the component layer. What a user sees is checked by hand
(quickstart §8).

## R24. Heading jumps in a preview's history

**Decision.** A new pure reducer `recordJump(h, leaving, arriving, cap)` in `core/src/navigation/history.ts`;
`throng:preview:navigate` gains intent `{ kind: 'heading' }` with `arrivingViewState`; `PreviewService`
calls `NavigationHistoryService.recordJump`, a no-op for editor records. Same-file history steps skip the
re-read. Full design: plan.md, Iteration 2026-09-15, FR-115.

**Rationale.**
- `recordOpen` returns `h` for the current path by identity (`history.ts:81-86`, H2) — correct for editors
  and for FR-103, so jumps get their own function rather than a flag that weakens H2.
- The reducer has no panel-kind discriminator; the service does (`HistoryRecord.panelKind`,
  `navigation-history-service.ts:67-70`) and already restricts `setCurrentViewState` to previews (`:141`).
- Dedupe belongs in core, where the SC-007 property test can hold it, not in a renderer heuristic.
- The renderer is where "the heading was found and the body moved" is known (`scrollToHeading`,
  `preview-panel.tsx:441-456`); routing it through `navigate` keeps navigation-history.md §2's rule that
  no renderer channel records history directly.
- `captureScrollAnchor` returns `null` at the top (`scroll-anchor.ts:77`) and the panel omits a null
  `leavingViewState` (`preview-panel.tsx:522`), so without an explicit top anchor the scenario's "Back
  returns to the top" would be a no-op on a same-file body.
- A same-file history step today runs the cross-file path — re-read, `moveRun` (rebind, re-watch,
  `pathChanged` broadcast) and `emit` (`preview-service.ts:593-645`). It works, but costs a read and a
  broadcast per in-document Back.
- `moveTo`'s stale check compares the path only (`navigation-history-service.ts:130`); with several
  entries for one file, a stale index could match the right file at the wrong position. That was
  already possible for a path recurring in a history (H3), so the check is left as it is.
- `rewriteCurrent` rewrites only the current entry (`history.ts:167-177`); after a jump chain
  `[a@top, a@h]`, a Save As would split it across `a` and `b`.

**Alternatives rejected.** *Recording on scroll*: contradicts FR-101, which FR-115 refines only for a
followed heading link. *A flag on `recordOpen`*: the one function every editor path calls would carry a
preview-only branch. *Deduping in the renderer*: the same position can be reached from two windows.

**Tests superseded, not deleted.** `ui/tests/component/preview-follow.test.ts:93-117` ("same-document
headings never reach main") is rewritten to the heading intent. `ui/tests/integration/preview-service-navigate.integration.test.ts:223-233`
(a same-file `link` records nothing) stays true for `link` and gains the `heading` case.

**Testable where.** Unit, integration and component as plan.md's table; **no E2E** — the one real-layout
property involved, restoring an entry's scroll anchor, is already `preview-scroll.e2e.ts` declaration 2's
claim, and a jump entry restores through the same `restoreScrollAnchor` call.

## R25. What Copy Link Address copies

**Decision.** `linkAddress(link, docPath)`; `heading` → `docPath#fragment`; the other kinds unchanged
(`content-menu.ts:70-83`). `docPath` is the chrome's `stateRef.current.filePath`, the same value
`onFollow` resolves headings against (`preview-panel.tsx:489, 497`).

**Rationale.** A bare `#install` names nothing once pasted outside the preview. The absolute path matches
what a `file` link already copies, so the two link kinds that point into the project copy one form.
**Alternatives rejected.** *Project-relative path*: a second form beside the one `file` links already
copy. *The authored href*: a same-document link has none but the fragment.

## R26. Hiding front matter without moving source lines

**Decision.** `RenderEnvironment.frontMatter: boolean`; `false` skips `renderFrontMatter` in `render()`
(`pipeline.ts:290-300`) and keeps `bodyLineOffset`. The setting is a provider-declared leaf
(`core/src/preview/providers/markdown.ts:16-25`), so `preview-settings.ts` generates its default,
descriptor (`enabledWhen` on Markdown: Enabled) and parse with no edit (`:73-80`, `:93-117`, `:200-205`),
and no `SHIPPED_DEFAULTS_VERSION` bump is needed (`shipped-defaults.ts:134-140`).

**Rationale.** The offset is what keeps `data-source-line`, core's `markdownHeadingLine`
(`core/src/preview/providers/markdown/heading-line.ts:103`), scroll anchors and R23's sync aligned with
the file's own line numbers; dropping the block from the output must not renumber the body.
**Alternative rejected.** *Render the block as Markdown when off*: FR-117 forbids it — FR-085's reason
for the table is that front matter read as Markdown becomes a rule and stray text.

## R27. FR-119: probe before remedy

**Status: probe run, verdict recorded 2026-09-16 (Open item O9).** The *Probe result* at the end of this
entry is the verdict — H-a refuted, H-b standing, its remedy shipped. Everything between here and that
section is the **pre-probe** reasoning, kept because it is what the probe was built to test; at the time
it was written, no test and no probe had observed the behaviour and nothing in it was a root cause.
*(Status line corrected by converge; it still read "Status: hypothesis. No test and no probe has observed
the behaviour".)*

**Status update 2026-09-16: H-b confirmed** by the maintainer's hands-on check — see *Hands-on result*
at the end of this entry.

**What the code shows.** Both open-external handlers (`ui/src/main/external-url.ts:43-52`) validate the
URL and call `shell.openExternal` with the event (and so the sender) ignored and the promise voided.
Nothing on that path focuses a throng window (triage §7). Code that *can* raise throng:
`WindowManager.raiseOne` → `moveTop()` on every window `focus` (`window-manager.ts:34, 42, 84-92`,
002 FR-022's group raise), the preferences window's `setAlwaysOnTop` toggle on
`browser-window-focus`/`blur` (`preferences-window.ts:332-354`), and the drag ghost's `alwaysOnTop`
(`ghost-window.ts:111`).

**Hypotheses.**
- **H-a**: a throng window receives `focus` after the open with no user input, and one of the above acts
  on it.
- **H-b**: the Windows foreground lock. The browser's window is created or re-activated by a process with
  no foreground right; throng, which holds the foreground, never hands it on. #199 met the same lock for
  windows opened from a terminal and answered it with `IForegroundHandoff.allow()` →
  `AllowSetForegroundWindow(ASFW_ANY)` (`platform-windows/src/windows-foreground-handoff.ts:63-91`),
  called today only from `terminal-ipc.ts:371`.

**The probe (T208).** Temporary `diagnostics.log.info` lines, with a monotonic timestamp: immediately
before and after `shell.openExternal` in both handlers; `focus`/`blur` on every `BrowserWindow`; `app`
`browser-window-focus`/`browser-window-blur`; and `WindowManager.raiseOne`. Run hands-on (the
`throng-testing` skill's rules for launching the app): Ctrl+click an `https:` link in a preview, and the
same URL in a terminal, each three times with the default browser already running and three times with it
closed. The maintainer notes which window ends in front each time.
- `focus` (or `raiseOne`) on a throng window **after** the open, with no input in between → **H-a**; the
  log names the trigger.
- No throng `focus`, throng still in front → **H-b**.
- Browser in front every time → not reproduced under those conditions; record them, and ask the
  maintainer what differs.

**Remedies, by outcome — written before the probe; H-b's is the one that shipped (see *Probe result*).**
- H-a: fix the trigger, test-first at the lowest layer that reproduces it (e.g. a `WindowManager` unit
  test with fake windows), keeping 002 FR-022 and 007 FR-013a.
- H-b: `registerOpenExternalIpc(ipc, shell, foregroundHandoff)` calls `allow()` immediately before
  `shell.openExternal` for an accepted URL only; unit-tested for order and for no call on a refused URL
  (`ui/tests/unit/external-url.test.ts`); `IForegroundHandoff`'s doc comment widened from "a command
  running in a terminal" to "a window the user's own action opened". `ASFW_ANY` is what #199 already
  accepted; the grant decays with the next input.
- Neither: no production change; FR-119 reported open with the timeline and a Bug filed through
  `github-issues` carrying steps and a frequency.

**Probe result — 2026-09-16 (T208).** The probe ran through `terminal-link-once.e2e.ts`, which already
stubs `shell.openExternal`, as one temporary module with a settable sink rather than log lines threaded
through `external-url.ts` and `window-manager.ts` (neither takes a logger, and a probe must not change a
production signature). It was removed afterwards. Four external opens produced **no
`browser-window-focus`, no `browser-window-blur` and no `WindowManager.raiseOne`** after any of them; the
only focus and raise in the run are at startup, 2.1 s before the first open. **H-a is refuted** as far as
anything short of a real browser can go: its blur-triggered variant is refuted statically too, because
main's only `browser-window-blur` consumer (`preferences-window.ts:337`) sets always-on-top *false*, and
no `window.focus()` exists in the renderer. **H-b stands as the hypothesis**, and its remedy shipped
(T210, commit `0c741da9`): `handOverAndOpen` calls `foregroundHandoff.allow()` after the scheme check and
before `shell.openExternal`, for both the preview channel and the general one. What no automated test can
settle — whether the grant actually leaves the browser in front, and whether it differs with the browser
already running or closed — is the hands-on check in quickstart §8 (T217). Until that runs, "hypothesis"
is still the right word, and the tests pin only the call and its order.

**Hands-on result — 2026-09-16.** **H-b is confirmed by the maintainer's hands-on check on 2026-09-16**:
with the remedy above in the build, Ctrl+clicking a web link leaves the browser in front — *"The browser
is being activated properly now."* (spec.md, Clarifications → Session 2026-09-16). The check was the
maintainer's own use of the build, not a counted run of quickstart §8 step 7, so it records no split
between the browser already running and closed; T217 still owes those counts. The tests continue to pin
only the call and its order; the outcome itself stays a manual check, for the reasons below.

**Why no E2E for the result.** Which application's window the OS leaves in front is outside the page, and
a hosted runner has no default browser worth asserting against; `@reserve:focus` covers throng's own
windows, not another program's. The seam's behaviour is contract-tested already
(`windows-foreground-handoff.contract.test.ts`); the outcome is a manual check (quickstart §8).

## R28. One display string for the readout and the image tooltip

**Decision.** The link hook sets `data-throng-target` to `displayTarget(target)` — the string the link
title is built from (`sanitise.ts:104-112`, `:151-152`); the image hook builds its title from
`displayTarget(authored src)`. The body reads `data-throng-target` for `onLinkTarget`.

**Rationale.**
- `displayTarget` is not exported and `sanitise.ts` is in the lazily loaded chunk, so the chrome cannot
  compute the string; `linkOf` cannot rebuild a `file` link's authored href. Parsing the title minus
  its hint would couple the readout to the hint's wording.
- A hook-set attribute is added after DOMPurify's attribute checks, exactly like `data-throng-link`
  (security-policy Layer 2, "Outputs a document can never supply"); a document-written
  `data-throng-target` is already removed by `ALLOW_DATA_ATTR: false`.
- The export profile keeps no `data-*`, so the attribute never reaches the clipboard.
- The image hook sees the authored `src` before rewriting it (`sanitise.ts:156`) — the only moment it
  exists; afterwards `src` is `throng-preview://asset/<panelId>/…`, which would expose an internal
  address and the panel id.
- The I3 strip (`sanitise.ts:191-196`) runs before the image hook (`:198`), so it would not remove a
  title the image hook sets — the hook checks `closest('[data-throng-link]')` itself.
- `showAltText` builds a fresh span with class and text only (`markdown-body.tsx:110-121`), so the title
  must be copied explicitly for blocked and failed images.

**Alternative rejected.** *A second, readout-only formatting function*: two strings for one target, which
FR-118's "as FR-094's tooltip names it" rules out.

## R29. The text-selection defect: which test reproduces it

**Decision.** Two failing tests before the fix: a **unit** test that `markdown.css` re-enables
`user-select` over `theme.css`'s app-wide `none`, and an **E2E** declaration (`@extended @editor
@reserve:input`, in `preview-scroll.e2e.ts`) in which a real mouse drag across two paragraphs leaves a
non-empty selection, and a Ctrl+drag that starts on a link selects text and follows nothing (FR-094).
Both are observed failing, then the fix turns both green.

**Two causes, not one *(corrected 2026-09-16 by converge, after the E2E ran)*.** This entry originally
called it "the one-rule fix". The CSS re-enable alone left the Ctrl+drag step failing: Chromium starts no
mouse selection from a press that lands on a **focusable** element, and every followable link is
`tabindex=0` for the keyboard (FR-096b). So the body also lifts a link's `tabindex` for the length of a
primary press and restores it on `mouseup` — a window-capture listener, because the press may end
anywhere (`markdown-body.tsx:368-397`). Pinned by "a primary press on a link lifts its tabindex until the
press ends" in `preview-links.test.ts`; a secondary press is left alone. The attribute is back before any
Tab can reach it, so FR-096b is unaffected. `docs/testing.md` already records both causes; this entry and
`contracts/security-policy.md` Layer 2 did not.

**Rationale.** The project's rule is that a reported defect begins with a test that reproduces **what was
reported**, at the lowest layer that can, and that the test is never re-created higher afterwards for
reassurance. The report is behavioural — a drag does not select — and no layer below the real engine can
show it: jsdom applies no stylesheet, and the Range API that `preview-copy.test.ts:57-60` and
`preview-links.test.ts:64-65` select with ignores `user-select` in both engines. The unit test pins the
hypothesised cause and is cheap to keep; on its own it would stay green if the cause were a different rule
or a pointer handler. Writing the E2E **first** is what keeps it a reproduction rather than reassurance.
*(This orders the tests differently from the triage's suggestion of "CSS test, fix, then E2E"; the rule
above decides it.)*

**Budget *(corrected 2026-09-16 by converge)*.** One declaration added and **nothing moved down**: the
planned demotion (T181) was skipped by ruling, so `e2e-budget.json` rose 569 → 570 and `@editor`
117 → 118, and `reserve-tag-debt.json` is unchanged at 116. This entry previously read "one moved down
first (T181) — Principle V's ratchet does not rise", which is the opposite of what shipped. The ratchet
says a budget MUST NOT rise, so the raise is an **outstanding violation**, not a permitted trade; it is
closed by performing T181's demotion and re-seeding to 569 / `@editor` 117, or by a constitution
amendment — not by this note. `preview-scroll.e2e.ts` is already `serial`/`FOCUS` in
`parallel-plan.json`, so no tier-plan change.

**Closed the same day (T218, commit `96975d66`).** The demotion was performed:
`editor-indicators.e2e.ts`'s auto-save declaration moved down — firing half to
`editor-update-listener.test.ts`, disk half already held by `editor-service-save.integration.test.ts` —
both observed red against deliberate breaks first. `e2e-budget.json` is back to 569 / `@editor` 117 and
`reserve-tag-debt.json` to 115. No constitution amendment was needed.

---

## Iteration 2026-09-16 — R30–R33

*Added by `speckit-iterate` (round 2) for FR-121 (a–h), FR-122 (a–f) and T222 (plan.md, Iteration
2026-09-16). Additive; R23 is refined, not rewritten — its store and its same-window reading stand.*

## R30. Two-way sync: the request direction, in the same window

**Decision.** `editor-scroll-store.ts` gains a request direction — `registerEditorScroller(panelId,
scroller)` and `requestEditorTopLine(panelId, line): boolean` — and its per-panel value becomes
`{ line, fromSync }`. The preview chrome relays the body's top block line to `state.parent.panelId`; the
editor's registered scroller applies it with `EditorView.scrollIntoView(pos, { y: 'start' })` as an
effect with no selection. The editor's publisher and scroller move into a framework-free
`editor/editor-scroll-relay.ts`, and the publisher also runs on `docChanged || geometryChanged`.

**Rationale.**
- FR-121a applies FR-113's same-window reading to the other direction; R23's reasons against a relay
  through main (a high-rate channel, and a rule for which of several views drives) apply unchanged, and
  the store already answers "is there a mounted view of that editor here?".
- The editor view registry (`editor-views.ts`) could be used to reach the view directly, but that would
  put CodeMirror dispatch code in the preview chrome and bypass the echo mark the editor must set on its
  own publishes (R31). A registered scroller keeps each side owning its own scroll.
- **The editor side already covers every cause (item 6 of the brief), verified by reading:** caret moves,
  find/replace, Go to Line, history restores, #144/US8 restores, Find in Files reveals and typing that
  scrolls all end in a `scrollTop` write on `scrollDOM`, whose `scroll` event is the shipped publisher's
  trigger (`use-editor.ts:1277-1285`). The only way the top line changes without that event is a height
  change above the viewport that leaves `scrollTop` where it was (an edit, a reflow at the top), hence the
  update listener. The store de-duplicates, so the extra call costs nothing when nothing moved.
- **Held until ready.** A new editor view registers at construction (`use-editor.ts:1288-1290`) but
  restores its own place afterwards. A sync request applied before that restore would be overwritten by
  it, and the restore's scroll would then look like the reader's — so the scroller registers, or applies
  a held request, only once the initial placement has run. This is what makes FR-121h's adoption rule
  ("the new editor is placed at the preview's position") hold.

**Alternatives rejected.** *A cross-window relay* (R23, unchanged). *Mapping inside the block by
`offsetRatio`* for a finer editor line: FR-121b fixes block granularity, and a finer mapping in one
direction only would make the two directions disagree about "the same place", which is the oscillation
R31 guards against.

**Testable where.** Store and relay: unit over a fake view (the relay's contract is "which spec is
dispatched" and "what is published", both observable without layout). Chrome wiring: component. Real
CodeMirror scrolling in a real engine: the one E2E.

## R31. The loop guard: cause marks and block equality, not timers

**Decision.** Three rules (plan decision 5): a side marks the scroll it makes to follow the other and
never relays a marked scroll; each side acts only when the other's place falls in a **different block**
from its own; a side short of its target publishes its clamped place marked. The editor's mark lapses at
its first publish after the request settles, or one frame after a request that caused no scroll.

**Rationale.**
- The two mappings are both block-granular but not inverse: an editor line inside a block maps to the
  block's first line. Without the block-equality rule, any editor line other than a block's first line
  is an unstable point.
- A timer ("ignore scrolls for N ms after a sync") is a tunable in Principle X's sense and wrong both
  ways: too short and the echo escapes, too long and the reader's own scroll is swallowed. A mark tied to
  the request's own effect is neither.
- The no-scroll lapse matters because a request that changes nothing produces no `scroll` event at all —
  already there (FR-121g) or already at the end (FR-121b); a mark waiting for that event would swallow the
  reader's next real scroll.
  *Converge 2026-09-16 (round 2): lapsing silently was not enough. A side waiting for the request to
  settle (an adoption, FR-121h) never learned it had, so the relay now **answers** an unmoved request with
  its current line marked `fromSync` (R-E5, `b3bfb70b`). And "a side short of its target publishes its
  clamped place marked" needed a preview-side counterpart: a live update's restore at the preview's end is
  treated as the body's own scroll unless the kept block was renumbered (`fe0fff59`). data-model §15.1,
  §15.2.*
- jsdom fires no `scroll` event for a `scrollTop` write and has no layout, so component tests replay
  events in an order they choose; the engine's real order against CodeMirror's measure cycle is why one
  E2E is spent (plan, *Test layers*).

**Alternatives rejected.** *A single global "sync in progress" flag* shared by both sides: one window can
hold several pairs, and a flag shared across them would drop a real scroll in pair B while pair A
settles. *Comparing lines instead of blocks*: re-introduces the unstable point above.

## R32. Where a place comes from: attach, a step with no place, and adoption

**Decision.** (1) On a `history` navigate, main sends the target entry's place **or `null`**, never
omits it. (2) The renderer's preview store tags a place with its source — `attach`, or an update
pushed or answered after it — without a wire field. (3) Pure `placeOnStep` and `pairStart` decide
FR-121e and FR-121h from those, the setting, the parent and whether the editor's line is known here.

**Rationale.**
- **Why `null`.** A cross-file step onto a placeless entry and a followed link arrive identically today
  (no `viewState`, `navigationSeq` moved), and FR-121e and FR-121f want opposite outcomes for them. The
  invoking window knows which request it made, but a panel shown in two windows (Sync to, FR-110) gets the
  step as a push, and its own editor view would be driven to the top. `null` is visible to every viewer.
  `viewState` is `unknown` on the wire and `preview-store.ts:79` already keeps a present `null`.
- **Why the top has two spellings.** A jump chain stores the top explicitly as `{ line: 0, offsetRatio:
  0 }` (R24), and a file entry left at the top stores nothing (`scroll-anchor.ts:77`). Both mean "the very
  top" (main now sends the second as `null`); `restoreScrollAnchor` already treats the first as `scrollTop = 0`, so `isTopOfDocument` treats both
  alike — but **not** an absent value, which is a link or an update, never a step (analysis C2). Which steps
  take the editor's line — cross-file only, or same-file too — is the open question recorded under FR-121e
  (analysis C1). `placeOnStep` treats the two
  alike.
- **Why a renderer tag for attach.** FR-121h says an opening or restoring preview takes the editor's line
  over its saved place, while FR-107 says a step's saved place wins. The attach answer is handled at one
  call site (`preview-panel.tsx`, `attach`), so the renderer can tag it; the wire need not change.
- **Why `navigationSeq` separates adoption from a link.** Main raises it only in `moveRun` (a link or a
  step to another file, `preview-service.ts:748`), so a `parent` that appears while it stands still is
  the same file gaining an editor — Open in Editor or any other route to one — which FR-121h calls
  adoption.

**Alternatives rejected.** *Keep the accident* (no anchor → the draw's fall-through applies the editor's
line): it does not cover the same-file route, and a later change to the fall-through would silently flip
FR-121e. *A new `placeKind` wire field*: two fields for one fact.

## R33. The toggle: one write, reported where it was made; Revert All; the defaults version

**Decision.** Every surface calls one `toggleSyncScroll()` that patches `editor.previews.syncScroll`
alone. The sub-workspace window mounts `useConfigWriteFailureNotices`. Revert All keeps reverting the key.
`SHIPPED_DEFAULTS_VERSION` 8 → 9 for the `syncScroll` icon token.
*Converge 2026-09-16 (round 2): shipped as `toggleSyncScroll(current)`, each surface passing the value it
already renders — the config store is React context only (plan decision 7's note).*

**Rationale.**
- **Governing text, searched.** 032 FR-001 (one key must not revert another) is met by
  `writeConfigPatch`; 032 FR-001a scopes Revert All to descriptor-carrying keys; 032 US3 scenario 2's
  parenthetical rests on *"Exactly two windows write settings"*, which FR-122e makes false for
  sub-workspace windows. `onConfigWriteFailed` is per renderer realm, so mounting the subscriber in the
  sub-workspace window yields one notice, in the window that made the write — CLAUDE.md's *one condition,
  one notice*, with the report owned by the writer that knows it failed.
- **Revert All.** The key is a preference, visible in the Preferences window at the moment the user
  confirms Revert All (FR-122e); 032 FR-001a's exclusion concerns state Preferences does not show.
- **Defaults version.** The 043 precedent (6 → 7 on one branch) for builds that already hold the
  branch's first marker; theme files get new tokens only through the additive upgrade that version gates
  (`shipped-defaults.ts:134-144`).
- **No per-panel state.** FR-122 forbids it, and it would be a second copy of a setting, the Principle XI
  failure applied to configuration.

**Alternatives rejected.** *Route a sub-workspace write through the main window*: the notice would
appear behind the window the user clicked in. *Exclude the key from Revert All*: a second key list beside
the metadata. *Optimistic pressed state*: something to roll back on failure, and a moment where a surface
shows a value that is not stored.
