# Contract: rendering untrusted Markdown safely

**Feature**: 044 | **Requirements**: FR-074, FR-080 – FR-086, FR-091 – FR-096, SC-004; iteration 2026-09-15: FR-117, FR-118, FR-119, FR-120

Four layers, each independent of the others. A defect in one must not be enough to run code or make
a request. Rationale and alternatives are in [research.md](../research.md) R1–R8.

---

## Layer 1 — the pipeline (renderer)

```text
text
 └─ splitFrontMatter ─┬─ front matter → yaml.parseDocument → escaped <table> | escaped <pre><code>   (FR-085)
                      └─ body → markdown-it { html: true, linkify: true, typographer: false }       (FR-080)
                                 + taskList rule   (<input type=checkbox disabled>)
                                 + data-source-line on block opens (line + front-matter offset)
                                 + data-heading-slug from headingSlug on h1–h6 (never an id)
                                 + th/td alignment → data-align
                                 + fence → <pre><code data-lang="…">escaped</code></pre>            (FR-086: mermaid is a fence like any other)
 └─ one HTML string
 └─ DOMPurify.sanitize(html, PROFILE) → DocumentFragment                                            (Layer 2)
 └─ body.replaceChildren(fragment)   with scroll anchor capture → restore                          (FR-024)
 └─ enhance in place: code highlighting via createElement/textContent; img error → alt text          (FR-080, FR-084)
```

Math (`$…$`) is not a markdown-it construct and renders as literal text (FR-086).

*(Iteration 2026-09-15, FR-117.)* With the Markdown provider's **Show front matter** off, the front
matter branch produces nothing — no table, no code block, and the block is never handed to markdown-it —
while the body keeps its front-matter line offset. Hiding the block removes output; it adds no path by
which document text reaches the DOM.

**No step after the sanitiser produces HTML from a string.**

## Layer 2 — the sanitiser profile

```ts
const PROFILE = {
  ALLOWED_TAGS: [
    'p','h1','h2','h3','h4','h5','h6','em','strong','del','s','ins','a','img',   // no 'mark': its UA colours are system yellow/black, not theme tokens (FR-083); its text is kept
    'ul','ol','li','input','blockquote','hr','br','pre','code','span','div',
    'table','thead','tbody','tr','th','td','dl','dt','dd',
    'details','summary','kbd','sub','sup',                        // FR-081 floor
  ],
  ALLOWED_ATTR: [
    'href','src','alt','title','start','checked','disabled','type','open','colspan','rowspan',
    'data-source-line','data-lang','data-align','data-heading-slug',   // no 'id', no 'name': nothing can clobber
    'data-heading-nonce',                                          // amended (US6 review): read and removed by the heading hook
  ],
  ALLOW_DATA_ATTR: false,                                         // only the five named above
  ALLOW_ARIA_ATTR: false,                                         // a document cannot relabel or hide content from assistive tech; the link hook sets role itself
  ADD_FORBID_CONTENTS: ['script','style','template','noscript','iframe','object','embed','svg','math'],   // ADD_: keeps DOMPurify's default list (audio, video, noembed, noframes, xmp, title, …) — FORBID_CONTENTS would replace it
  RETURN_DOM_FRAGMENT: true,
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|[^:]*$)/i,           // relative, fragment, or the three schemes
};
```

**`data:` on media elements.** DOMPurify keeps a `data:` URI in `src` on its data-URI tags (`img`,
`audio`, `video`, `source`, `track`, `image`) regardless of `ALLOWED_URI_REGEXP`, and no option removes
a tag from that list. The sanitiser therefore removes any `src` beginning `data:` in its own hook,
before the image hook runs. *(Amended 2026-09-15 (implementation, u5): the first cut of this contract
said the regexp removed it.)*

**Hooks** (`afterSanitizeAttributes`), in this order:

| Element | Action | FR |
|---|---|---|
| `a` | `classifyPreviewLink(href)`; remove `href`; for non-`inert`: set `data-throng-link`, `tabindex=0`, `role=link`, `title="<target> — Ctrl+click to follow"` | FR-090, FR-091, FR-094, FR-096b |
| `img` | `resolvePreviewImage(src)`: `project` → `throng-preview://asset/…`; `remote` → keep; `blocked` → remove `src`, set `data-throng-alt` | FR-084, FR-092, FR-093 |
| `input` | keep only if `type=checkbox`; force `disabled` | FR-080 |
| `h1`–`h6` | keep `data-heading-slug` only if the element's `data-heading-nonce` equals this render's nonce (64 random bits, made per render by the pipeline); otherwise remove the slug (a raw `<h2 data-heading-slug=… data-heading-nonce=…>` in the document cannot guess it) | FR-090b, FR-090f |
| any element | remove `data-heading-nonce`; remove `data-heading-slug` from anything but `h1`–`h6` | — |
| any element inside a followable `a` | remove `title` — only the link's own title shows over it *(amended 2026-09-15, security review I3)* | FR-094 |
| `a`, followable *(iteration 2026-09-15)* | also set `data-throng-target` = the title's target text (`displayTarget`), without the hint | FR-118 |
| `img` *(iteration 2026-09-15)* | read the **authored** `src` before rewriting it; with **no** followable-link ancestor, set `title` = `displayTarget(authored src)` + ` — ` + authored title (bidi controls stripped) when present; **with** one, leave no `title` | FR-120 |

**Fragment lookup.** A `#fragment` is slugged with `headingSlug` and found with
`body.querySelector('[data-heading-slug="' + CSS.escape(slug) + '"]')`; no match raises
`link-missing-heading` (FR-090e/f). No `id` exists in a rendered preview, so the DOM-clobbering
vector (`<div id="throng">`) has nothing to clobber with.

*(Amended 2026-09-15 (US6 review).)* What shipped in `sanitise.ts`, `pipeline.ts` and `link-dom.ts`, where the
table and the lookup above are looser or different:

- **Every hook is registered once per DOMPurify instance**, when the sanitiser is built. Each render's
  document (`panelId`, `docPath`, `projectRoot`, `remoteImages`) and the pipeline's slugs reach the hooks
  through a context set for one synchronous `sanitize` call. With no document, only `external` and
  `heading` links are followable and every image is blocked (fail closed).
- **`a`**: the author's `title` is removed from every link, inert ones included; a followable link's title is
  always the target as a reader would recognise it — percent escapes decoded, **bidi controls
  (U+202A–U+202E, U+2066–U+2069, U+200E/U+200F) stripped** — followed by " — Ctrl+click to follow".
  `data-throng-link` holds the classification as JSON (`{"kind":"external","url":…}`), which the body,
  the menu and Ctrl+Enter read back (`linkOf`).
- **Inside a followable link** *(amended 2026-09-15, whole-branch security review I3)*: every element that
  is a descendant of a `data-throng-link` element has its `title` removed. Chromium shows the innermost
  element's title, so an image title (`[![x](a.png "forged")](https://real/)`) or a raw `<span title>`
  inside an `<a>` replaced the link's generated title while Ctrl+click still followed the real target.
  DOMPurify visits elements in document order, so the ancestor link has already been classified when a
  descendant is reached. An authored `title` outside any link (an image's own tooltip) is kept.
- **The body lifts a followable link's `tabindex` for the length of a primary press** and restores it on
  `mouseup` — a window-capture listener, since the press may end anywhere
  (`markdown-body.tsx:368-397`). *(Adopted 2026-09-16 by converge; shipped with the iteration's
  text-selection defect and described in no contract until now — the hook table below says the `a` hook
  sets `tabindex=0` and said nothing about anything removing it.)* Chromium starts no mouse selection
  from a press landing on a focusable element, which is why FR-035's drag-to-select needed it. It is the
  only place outside the hooks that touches a hook-set attribute, and it **grants nothing**: a link with
  no `tabindex` is less capable, not more, and the value is back before any Tab can reach it (FR-096b). A
  secondary press is left alone.
- **`img`**: `project` → `throng-preview://asset/<encodeURIComponent(panelId)>/<each segment encoded>`;
  `blocked` → `src` removed and `data-throng-alt=""`, which the body replaces with the alternative text.
- **`input`**: removed from the fragment when not a checkbox; a checkbox gets `disabled` whatever it had.
- **`h1`–`h6`**: the pipeline puts this render's random `data-heading-nonce` on every heading it emits, and
  `PROFILE.ALLOWED_ATTR` admits that one attribute so the hook can read it. A heading keeps
  `data-heading-slug` only when it carries the nonce **and** its slug is the one recorded for its
  `data-source-line`. Raw HTML cannot know the nonce, so a raw heading placed before a real one and copying
  its line and slug claims nothing. The nonce is removed from **every** element; it never reaches the DOM.
- **Outputs a document can never supply**: `data-throng-link`, `data-throng-alt`, `role`, `tabindex` and the
  link `title` are set after DOMPurify's checks on the element; any the document wrote was already removed.
- **Iteration 2026-09-15 (FR-118, FR-120)** — two more hook-set outputs, both after DOMPurify's checks:
  - `data-throng-target` on a followable `a`: the same display string the link's title is built from.
    A document cannot supply it — `ALLOW_DATA_ATTR: false` removes any `data-*` not named in
    `ALLOWED_ATTR`, and it is not named. The export profile keeps no `data-*`.
  - `title` on an `img` outside any followable link: built from the **authored** `src`, never from the
    rewritten `throng-preview://asset/<panelId>/…` address (which would expose the internal scheme and the
    panel id) and never from a remote image's live request; the authored title follows it, bidi controls
    stripped. The I3 descendant strip runs **before** the image hook, so the image hook checks
    `closest('[data-throng-link]')` itself: an image inside a followable link gets **no** title, and the
    link's generated title is still what the pointer shows (I3 is not reopened). When no authored `src`
    survived (removed by `ALLOWED_URI_REGEXP` or the `data:` rule), the title is the authored title alone,
    or nothing. The body's alternative-text span (blocked, or failed to load) copies the image's `title`.
    The export profile replaces an image with its alt text, so no tooltip reaches the clipboard.
- **Fragment lookup** slugs the fragment with `headingSlug` and compares each `[data-heading-slug]`
  element's attribute to it (`findHeading`), rather than building a selector with `CSS.escape` — no text
  from a document or a URL becomes a selector. The chrome scrolls its body host to the heading with
  host-relative `scrollTop` arithmetic, not `scrollIntoView`.

**Export profile** (clipboard HTML, FR-035a): the same tags; attributes `alt title start checked
disabled type open colspan rowspan` plus `href` restored from `data-throng-link` for `external` links
only; no `class` or `data-*` (and, as everywhere, no `id`); highlight spans unwrapped to text. An
`img` in the copied selection is replaced by its alt text (nothing when it has none) — its
`throng-preview:` or remote address means nothing outside the app. The copy is intercepted on the
preview panel's root, not only the body, so a selection starting in a notice above the body still
goes through this profile. *(Amended 2026-09-15 (US3 review).)* A selection reaching into the body is
intercepted whether or not it contains text: an image alone, or a link holding only an image, is copied as
its alt text (or nothing) through this profile and the copy-format setting, never by the browser's own
copy. *(Amended 2026-09-15, whole-branch security review M1.)*

### Required tests

| Test | Layer | Asserts |
|---|---|---|
| `markdown-pipeline.test.ts` | unit (ui, node) | The pipeline calls its injected sanitiser exactly once per render, with markdown-it's output (FR-081 "in the path") |
| `preview-sanitise.test.ts` | component | Hostile fixture: no `script`, no attribute starting `on`, no `iframe`/`frame`/`form`/`object`/`embed`/`link`/`meta`/`base`, no `style` attribute, no element with an `href`, no `src` beginning `javascript:`/`file:` (removed by `ALLOWED_URI_REGEXP`) or `data:` (removed by the sanitiser's own hook); no `aria-*` attribute; no element carries an `id` or `name`; no `mark` element, its text kept; `details/summary/kbd/sub/sup/br/img` survive (FR-081) |
| `preview-images.test.ts` | component | Load remote images off: no `img` has an `https:` `src`; on: badge `src` kept; relative → `throng-preview://asset/…`; `../../outside.png` → no `src`; `http:` → no `src` (the image hook — `ALLOWED_URI_REGEXP` admits `http:` for links) (FR-084, FR-092, FR-093) |
| `preview-links.test.ts` | component | Plain click follows nothing; Ctrl+click follows once; Ctrl+drag with a non-collapsed selection follows nothing; `javascript:` link is not focusable and offers no link menu (FR-091, FR-094, FR-095) |
| `preview-hostile.e2e.ts` | E2E `@reserve:runtime` | SC-004 in the real engine (Layers 3 and 4 included): `hostile.md` with remote images on, then `remote-images.md` with them off |

The hostile fixture lives at `packages/ui/tests/fixtures/preview/hostile.md` and covers: `<script>`,
`<img src=x onerror=…>`, `<svg onload=…>`, `<iframe src=…>`, `<object>`, `<embed>`, `<form action=…>`,
`<link rel=stylesheet href=https://…>`, `<style>@import url(https://…)</style>`, `<meta http-equiv=refresh>`,
`<base href=…>`, `[x](javascript:alert(1))`, `[x](JaVaScRiPt:…)`, `[x](data:text/html,…)`,
`<a href="vbscript:…">`, `<video src=https://…>`, `<audio src=https://…>`, `![](http://…)`,
`![](file:///C:/Windows/win.ini)`, an entity-encoded `javascript&#58;` URL, a `<div id="throng">`
clobbering attempt, a `<form name="throng">`, a raw `<h2 data-heading-slug="spoof">`, a
`<mark>kept text</mark>`, a `<p aria-hidden="true">` and a `<span aria-label="…">` (removed by
`ALLOW_ARIA_ATTR: false`), an `<input type="image" src="//host/x">` network-path reference (no colon,
so the URI regexp admits it; the `input` hook removes every non-checkbox input — T096 asserts it), and a
`<video><img src="//host/y"></video>` (content dropped: `video` is on DOMPurify's default
forbid-contents list, which `ADD_FORBID_CONTENTS` keeps). It deliberately holds **no `https:` image**, so "no network request" holds with
*Load remote images* at its shipped ON.

SC-004's second half — *Load remote images* off, no request for an `https:` image — uses its own
fixture, `packages/ui/tests/fixtures/preview/remote-images.md`: one `https:` badge image with alt text
and one relative image, nothing else. `preview-hostile.e2e.ts` turns the setting off by writing the
settings document on disk (the config store's hot reload), never through the preferences window.

## Layer 3 — CSP (`packages/ui/src/renderer/index.html`)

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' https: throng-preview:; object-src 'none'; frame-src 'none';
base-uri 'none'; form-action 'none'
```

`style-src 'unsafe-inline'` is unchanged (CodeMirror and the theme provider mount style elements);
the sanitiser forbids document `style` attributes and elements, so it is not reachable from a file.

## Layer 4 — the main-process request filter

`session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] })`, installed once in UI
main. For a request with `webContents` it applies `decideRendererRequest` (data-model §6):

| URL | resourceType | Decision |
|---|---|---|
| `file:` under `app.getAppPath()/…/dist/renderer` | any | allow |
| `throng-preview:` | any | allow (the protocol handler confines it) |
| `devtools:`, `chrome-extension:` | any | allow |
| `data:`, `blob:` | any | allow — not a network request; the drag ghost window loads a `data:text/html` page (`ui/src/main/ghost-window.ts`). CSP and the sanitiser (which forbids `data:` URLs in documents) remain the guards. Whether `webRequest` even sees these loads is Open item O3, probed early by T056a |
| `https:` | `image` | allow **iff** `remoteImagesPermitted(registry, settings)` |
| anything else | any | cancel |

Main-process requests (no `webContents`) are not filtered.

`renderer-request-policy.test.ts` (unit) pins every row, including `http:` image → cancel, `https:`
stylesheet → cancel, `https:` `xhr`/`fetch` → cancel, `file:` outside the renderer directory →
cancel, and `data:` / `blob:` → allow.

*(Amended 2026-09-15 (implementation, u6 review).)* The installer is
`installRendererRequestFilter(session, settings, registry, rendererDir)`
(`packages/ui/src/main/renderer-request-filter.ts`). `rendererDir` is the `dist/renderer` directory
every window's `index.html` loads from, resolved by main and passed in — `decideRendererRequest` has no
notion of where the application is installed. `settings` is a getter read on every request, so
`remoteImagesPermitted` follows a settings change without a restart (FR-092). A request is a
renderer's if it carries `webContents` **or** `webContentsId` (a contents destroyed mid-request can
leave the id alone). `renderer-request-filter.test.ts` pins that wiring.

## Navigation guard

`webContents.on('will-navigate', e => e.preventDefault())` on every renderer window — main,
sub-workspace, preferences, about. The app never navigates its own document; a navigation attempt is
always a defect.

*(Amended 2026-09-15 (implementation, u6 review).)* Two corrections from what shipped:

- **A reload is allowed.** `location.reload()` raises `will-navigate` with the document's own URL, and
  refusing it broke every E2E `reloadWindow` (40 call sites). The guard prevents a navigation only when
  its target differs from `webContents.getURL()`. Fragment and History API changes need no rule: they
  never raise `will-navigate`.
- **Installed once, on `app.on('web-contents-created')`**, at module top level in `main.ts`
  (`installNavigationGuards`), not at each window's creation site — so the drag ghost and any window
  kind added later are covered without remembering to be (#263's lesson). Contents Electron reports as
  `remote` (the DevTools frontend) are skipped.

## Links out

`window.throng.preview.openExternal(url)` → `throng:preview:openExternal` → `isSafePreviewLinkUrl`
(http, https, **mailto**) → `IShellIntegration.openExternal` (FR-091, Principle II).

The general `window.throng.openExternal` → `throng:openExternal` (About, terminal links) and the
window-open guard keep `isSafeExternalUrl` — http and https only — because 024 FR-019 forbids a terminal
link opening `mailto:` and 044 does not supersede it. One policy per caller, and the channel is the
caller. *(Amended 2026-09-15 (adversarial review ruling): the first cut widened the one shared check to
`mailto:` for every caller, leaving 024 FR-019 enforced only by the terminal renderer's own filter.)*

*(Iteration 2026-09-15, FR-119; probe settled 2026-09-16, research R27 — H-a refuted, H-b stands.)*
Neither scheme check changes. Both handlers call `IForegroundHandoff.allow()` **after** the scheme check
accepts the URL and immediately before `IShellIntegration.openExternal` (`external-url.ts:71-82`) — a
refused URL grants nothing. *(Amended 2026-09-16 by converge: this paragraph was written as a
conditional, "If the probe … settles on the foreground lock"; the probe ran and the remedy shipped in
T210, commit `0c741da9`.)* The grant
lets any process raise a window until the next user input (`ASFW_ANY`), the same exposure #199 already
accepted for terminal commands; it is requested only in answer to the user's own Ctrl+click, Ctrl+Enter
or *Open Link*.
