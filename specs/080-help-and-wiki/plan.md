# Implementation Plan: Online help and the user guide

**Branch**: `feature/S080-I477-I693-help-and-wiki` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/080-help-and-wiki/spec.md`

## Summary

A user guide, written as task-by-task directions, is built from Markdown in `guide/` into
throng-ide.com alongside the published preferences and key-bindings references, with the site's own
header, footer and stylesheet, a static search index, and the release version on every page. Every
deployment builds from the newest release tag. Inside throng, cog menu → **Help** and F1 (outside a
terminal) open the guide in the OS browser, and each setting row gets a (?) that opens its own section of
the preferences reference. A typed guide map in core drives the help URLs and the PR, CI and release
coverage checks. The guide's Quick start replaces `docs/quick-start.md`.

This branch delivers **stage 1** (FR-024). Stages 2 onward are listed under *Later stages*.

## Technical Context

**Language/Version**: TypeScript 5 (strict) on Node 24 / Electron; Node `.mjs` for build scripts

**Primary Dependencies**: markdown-it 15 (existing root dependency) for the guide build; Pagefind 1.3.0
fetched pinned in the Pages job only; React 19 renderer for the (?) control and Help item

**Storage**: N/A — Markdown files in the repo; no user data changes

**Testing**: Vitest (`unit`, `component` projects); `docs-currency.test.ts` and `site-assemble.test.ts`
extended; no new E2E (every observable is provable below E2E: menu items, key dispatch, the (?) row,
the builder's output)

**Target Platform**: throng on Windows, Linux, macOS; the site on GitHub Pages

**Project Type**: desktop app (Electron monorepo: `packages/core`, `packages/ui`) plus a static site

**Performance Goals**: Help opens the browser in one action (SC-001); the site build adds seconds to
the Pages job

**Constraints**: the site stays static (no server); one stylesheet for the whole site; help links never
open inside throng; Pages job installs only what the build needs

**Scale/Scope**: 20 guide pages and ~150 task sections (page-plan), 122 settings, ~200 commands, 8
preview types

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 — no violations.*

| Principle | How this plan complies |
|---|---|
| II Platform-abstracted core | Help URLs and the guide map are pure core modules; opening goes through the existing `IShellIntegration.openExternal` seam in main |
| IV Terminal keys | F1's scope excludes `terminal`, so it always reaches the program; no exception to record |
| V Test-first | Every check and behaviour lands failing-test-first at unit or component level; no E2E added (each observable is provable lower) |
| VI Discoverable UX | Help is a cog-menu item (section `application`) with a chord and a Key Bindings row; the (?) is a themeable icon control with a popup-style hover title; disabled-never-hidden is unaffected (the (?) is always available) |
| VIII SOLID/DRY/YAGNI | One base URL, one URL builder, one map; the header and footer are read from `site/index.html`, not copied |
| IX DI | The effective help base URL reaches the renderer through the injected settings route; the builder takes its sources and release lister as parameters |
| X Externalised configuration | `HELP_BASE_URL` is a product identity constant (like `REPO_SLUG`), overridable by `THRONG_HELP_BASE_URL` for development, documented in `docs/environment.md` |
| XII Responsive UI | Opening is fire-and-forget over IPC; nothing waits on the browser |
| XIII Every failure leaves a trace | A browser that cannot open is logged and raises one notice with a Copy action; the `throng:openExternal` route gains this (it dropped the failure before) |
| Development workflow: docs currency | `docs-currency.test.ts` grows the guide checks; `throng-docs` gains the guide's row; a new `throng-guide` skill owns the voice |

## Project Structure

### Documentation (this feature)

```text
specs/080-help-and-wiki/
├── spec.md, page-plan.md, plan.md, research.md, data-model.md, quickstart.md
├── contracts/  help-urls.md · guide-map.md · site-build.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source code

```text
guide/                                   # NEW — FR-001: pages and images only
├── index.md, quick-start.md, <page>.md  # every page in page-plan.md (R12: outlines where not written)
└── images/

scripts/
├── site.mjs                             # + latest-tag, --version, guide build, preview builds the guide
├── guide-build.mjs                      # NEW — markdown-it → pages (R1, R5)
├── guide-template.mjs                   # NEW — header/footer lifted from site/index.html
└── guide-pr-check.mjs                   # NEW — the no-user-facing-change marker check (R10)

site/index.html                          # + Guide nav link, version label
.github/workflows/pages.yml              # build from the latest release tag; Pagefind (R2, R3)
.github/workflows/ci.yml                 # + guide-pr-check step
.github/PULL_REQUEST_TEMPLATE.md         # + guide checkbox, marker; quick-start link → guide

packages/core/src/help/
├── guide-map.ts                         # NEW — GUIDE_PAGES, GUIDE_MAP, GUIDE_EXCLUSIONS (R6)
├── help-urls.ts                         # NEW — HELP_BASE_URL and builders (R7)
└── index.ts                             # barrel, exported from @throng/core
packages/core/src/config/keybindings.ts           # + help.open, F1, NOT_TERMINAL scope (R9)
packages/core/src/config/keybindings-metadata.ts  # + help.open's row
packages/core/src/config/release-notes.ts         # + guide-link rule (R11)
packages/core/src/icons/…                         # `help` icon key reused (055); description widened

packages/ui/src/main/                    # THRONG_HELP_BASE_URL read once, injected
packages/ui/src/renderer/common/help-link.tsx               # NEW — the (?) control (R8)
packages/ui/src/renderer/common/use-help-key.ts             # NEW — F1 in windows without the dispatcher
packages/ui/src/renderer/title-bar/cog-menu-items.ts        # + Help item
packages/ui/src/renderer/keybindings/window-dispatcher.tsx  # + help.open
packages/ui/src/renderer/preferences/settings-tab.tsx       # + (?) per row
packages/ui/src/renderer/preferences/preferences-app.tsx    # + useHelpKey
(resource monitor and about apps)                           # + useHelpKey

docs/preferences.md                      # one section per setting, key-anchored (R5); FR-022a fixes
docs/key-bindings.md                     # + help.open; FR-022a fix
docs/quick-start.md                      # REMOVED (FR-003a)
docs/README.md, README.md, docs/macos.md, docs/environment.md, other docs/ links   # repointed / + guide
CHANGELOG.md                             # Unreleased entry for the guide and Help

.claude/skills/throng-guide/             # NEW — SKILL.md, references/style.md (FR-020, FR-022)
.claude/skills/throng-docs/SKILL.md      # + the guide's row (FR-008)
.claude/skills/README.md, CLAUDE.md      # routing to throng-guide

packages/ui/tests/unit/                  # docs-currency (extended), site-assemble (extended),
                                         # guide-build, guide-pr-check, description-length (+ ratchet json),
                                         # cog-menu / menu-sections, help-link (component)
packages/core/tests/unit/                # help-urls, guide-map, release-notes (extended), keybindings
```

**Structure Decision**: the existing two-package monorepo plus the existing `scripts/` and `site/`; the
only new top-level directory is `guide/`, which FR-001 asks for.

## Stage 1 work, in order

1. **Core**: guide map types and `GUIDE_PAGES`; help URLs; `help.open` with F1 and `NOT_TERMINAL`; the
   `help` icon; the release-notes guide-link rule.
2. **Guide content skeleton**: every page from the page plan with all task headings (outline status),
   the start page and Quick start written in full; the guide map filled from them, with exclusions.
3. **Reference restructure**: `docs/preferences.md` to one section per setting with the description as
   its lead line (one-off conversion script, not committed); FR-022a corrections; `help.open` in
   `docs/key-bindings.md`.
4. **Builder**: `guide-build.mjs`, the template, `site.mjs` changes, preview; link and anchor checks.
5. **App**: Help item, dispatcher case, `useHelpKey` in the three other window apps, the (?) on setting
   rows, the base-URL injection.
6. **Checks**: `docs-currency.test.ts` extensions, the description-length ratchet, `guide-pr-check.mjs`
   plus the `ci.yml` step, the built-site anchor test.
7. **Pages job**: latest-tag checkout, `npm ci --ignore-scripts`, Pagefind.
8. **Docs and governance**: Quick start retirement and link repointing (incl. 070 SC-007's test), the
   `throng-guide` skill and style guide, `throng-docs` row, CLAUDE.md routing, PR template, README,
   `docs/README.md`, `docs/environment.md`, `docs/macos.md` (F1 and Fn), CHANGELOG.

## Later stages (separate branches, FR-024)

| Stage | Delivers | Notes |
|---|---|---|
| 2 | Every description ≤ 100 characters, detail moved into `docs/preferences.md` (FR-013, FR-016); the ratchet list emptied; the (?) audit and its (?) controls (FR-017) | The audit outcome is recorded in this feature's research |
| 3+ | Each outline page written as directions, one to three pages per PR, with screenshots from the E2E harness (FR-004, FR-023) | The screenshot generator lands with the first content stage |

The issues close when the last stage merges.
*Superseded by FR-025: every stage lands on this branch — see Iteration 1 below.*

## Iteration 1 (FR-025 to FR-033)

After stage 1's hand test (Session 2026-11-25, iteration 1). Everything that was a later stage now lands
here, plus the hand-test defects. Research R16–R25 records each decision.

**Scale**: settings 191 descriptors (142 over 100 characters, 11 groups); key bindings 104 (37 over, 12
groups); theme tokens 160 (84 over, 9 areas); 18 guide pages still outlines.

| Area | Change | Research |
|---|---|---|
| Site header (D1, D3, FR-029) | The template puts the search slot **before** the nav, and the header's nav, search and version sit in one right-aligned group on every page. Pagefind's results drawer is drawn as a fixed panel below the header, content-wide, with its own scroll; its input gets the site's text colour | R16 |
| References split (FR-026) | The builder splits each reference at `##` into `/guide/reference/<ref>/<section>/`; the reference's own URL keeps the intro and lists its sections. The nav draws each reference as a `<details>` item, open on its pages. Links into a reference resolve the anchor to whichever section page holds it | R17 |
| Help URLs (FR-026, FR-028) | `settingHelpUrl` adds the section path from the setting's group; new `keyBindingHelpUrl(actionId)` and `themeTokenHelpUrl(key)`. A test proves every group has a `##` of the same text in its reference | R17 |
| Key bindings reference (FR-028) | `docs/key-bindings.md` rewritten from tables to one `###` per command, key code span on the next line, description as lead, then **Default** chord and scope — the preferences shape | R18 |
| Theme reference (FR-028) | New `docs/theme-settings.md`: one `##` per theme area, one `###` per token in the same shape; `## Themes and icon sets` in `docs/preferences.md` links to it | R18 |
| Descriptions (FR-013, FR-016, FR-028) | Every setting, command and token description cut to ≤ 100 characters; the cut detail moves into its reference section. The ratchet empties; the length test and the lead-line check cover all three registries | R19 |
| (?) (FR-027, FR-028, FR-017) | `HelpLink` takes a URL; it moves beside the title on setting rows and appears beside the title on Key Bindings and Themes rows. The audit's other surfaces get a (?) to their guide task | R20 |
| Callouts (D2, FR-030) | GitHub alert syntax (`> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`) — rendered by GitHub, and by the builder into styled callout boxes | R21 |
| Page layout and voice (FR-030) | Every task: `**Where:**` breadcrumb, "Why you'd use this" line, numbered steps. A docs-currency check holds every task page to it. `throng-guide`'s style guide carries the maintainer's voice | R22 |
| No outlines (FR-033) | The builder refuses `status: outline`, naming the page; the outline notice and its CSS go | R23 |
| Screenshots (FR-031, FR-023) | `packages/ui/tests/guide-screenshots/` — a Playwright spec on the E2E harness with its own config, run by `npm run guide:screenshots`, seeding a demo project and writing `guide/images/<page>/<name>.png` in the **throng** theme. Not part of the E2E suite | R24 |
| Upkeep skill (FR-032) | `.claude/skills/throng-guide-upkeep/` — when to update which guide task, map entry, reference section and screenshot; points at `throng-guide` and `throng-docs`; routed from `CLAUDE.md` and the skills README | R25 |
| Content (FR-004, FR-030) | All 18 outline pages written in full | R22 |

**Boundaries for implementation**: site (builder, template, CSS, JS); core (help URLs, metadata
descriptions); renderer ((?) placement and new rows); docs/guide content and the screenshot generator
(orchestrator).

**Constitution re-check**: V — every builder behaviour and URL is unit-tested, the (?) rows are component
tests, the screenshot generator is tooling, not a test; VI — the (?) is the shared themeable icon control;
X — no new configuration; docs-currency — extended to three registries. No violations.

## Complexity Tracking

No violations.

## Iteration 6 (FR-048 to FR-052): the Help window

**Shape.** The guide is built a second time, for the app: `node scripts/site.mjs help --out packages/ui/dist/help`
runs the same `buildGuide` over `site/guide/` and `docs/`, copies the site assets the guide pages load
(`assets/site.css`, `assets/site.js`, fonts, `favicon.ico`), and indexes the result with Pagefind's Node API
(`pagefind@1.3.0`, a pinned devDependency, the version `pages.yml` uses). `npm run build` runs it last, so a
development build and a release carry the guide of their own source. `packages/*/dist/**` already ships, so
`electron-builder.yml` needs nothing new. The version stamped is the app's own (`package.json`).

**Serving.** A privileged, read-only scheme `throng-help:` (standard, secure, fetch-capable for Pagefind's
WebAssembly), handled only on the Help window's own session partition. `throng-help://app/<path>` maps to
`packages/ui/dist/help/<path>` (a directory to its `index.html`), contained by spelling and by realpath like
`preview-protocol.ts`. Responses carry a CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'` — nothing remote.

**The window.** `help-window.ts` (main), modelled on `about-window.ts` but neither modal nor parented above:
one window, created on demand, brought to the front with `show()`/`focus()` (never `setAlwaysOnTop`). It loads
the renderer `index.html?help=1` (`help/help-app.tsx`: throng's title bar and a toolbar of icon buttons — Back,
Forward, Open in browser) and hosts the guide in a `WebContentsView` below the toolbar: no preload, sandboxed,
on partition `help`. Bounds are remembered for the session (`[derived]`). Back/Forward and Open in browser
reach main over IPC; Alt+Left/Alt+Right arrive through the view's `before-input-event`, mouse back/forward
through `app-command` (Windows) and the view's `input-event` mouse buttons (Linux, macOS).

**Navigation (FR-050).** A pure core decision, `decideHelpNavigation(url)`: a `throng-help://app/guide/…` or
`/sitemap/` URL stays; any other `throng-help://app/…` path (the home page's header links) is rewritten to
`https://throng-ide.com/…` and opened externally; `http(s)` opens externally; anything else is refused. Wired
on the view's `will-navigate` and `setWindowOpenHandler`. The request filter and navigation guard of 044
install on every other window unchanged.

**Help URLs.** Core gains `HELP_APP_BASE_URL = 'throng-help://app/guide/'` beside `HELP_BASE_URL`
(help-urls.ts stays the one home), and `websiteUrlFor(appUrl)` for Open in browser. The renderer's
`effectiveHelpBase()` returns the app root; `openHelp(url)` sends `throng:help:open` instead of
`openExternal`. FR-045's `helpBaseUrlForBuild` and `THRONG_HELP_BASE_URL` are removed with their tests.

**Missing guide (FR-052).** When `dist/help/guide/index.html` is absent, the view shows a page main generates in
memory naming the folder and `npm run build`, and main logs one warning.

**Tests.** Unit: `decideHelpNavigation`, `websiteUrlFor`, the protocol handler over a temp tree (containment,
types, 404), `site.mjs help` output (pages, assets, the index). Component: `HelpApp` toolbar; `openHelp`
sends the IPC. E2E: one spec — F1 opens one Help window, a (?) reuses it and brings it front (in
`parallel-plan.json`, budget re-seeded). Existing tests that assert the OS browser for help are updated.

**Caveat.** GNOME on Wayland may refuse to raise an existing window and show a "ready" notice instead.

**Constitution.** Secure-by-default (044) holds: the exception is one partition, one scheme, local files only.
Themeable icon controls for the toolbar. Failure presentation for FR-052. No violations.

## Iteration 7 (FR-053 to FR-056)

- **FR-053, navigation follows the page.** `site/assets/site.js` scrolls `.guide-nav` on load so the
  `aria-current="page"` entry is in view. It sets the navigation's own `scrollTop`, never `scrollIntoView`,
  so the page keeps its anchor position. Every guide navigation is a full page load, so the Help window gets it
  for free. Proven in `help-window.e2e.ts`: only a real layout has scroll offsets.
- **FR-054, Help closes with throng.** `help-window.ts` exports `closeHelpWindow()`, and `main.ts` calls it on the
  main window's `closed`, beside `disposeGhost()`. The window stays unparented, so it is never kept on top. A
  source guard in `window-parent-tdz.test.ts` checks the call; an E2E checks that closing the main window with Help
  open ends the app.
- **FR-055, a smaller (?).** `theme.css` sizes `.icon` inside `button.icon-button.help-link` explicitly: a 12px
  glyph in a 16px control. It is not tied to `--throng-size-icon`. A unit check reads the rule.
- **FR-056, no (?) on the Projects pane.** Remove its `HelpLink` from `projects-panel.tsx`. `help-surfaces.test.ts`
  asserts its absence. The other audited surfaces are unchanged.

## Iteration 8 (FR-057 to FR-063)

- **FR-057, plain writing.** The orchestrator rewrites, by the `stop-slop` rules: the descriptions in
  `settings-metadata.ts`, `keybindings-metadata.ts` and `theme-metadata.ts`/`theme-copy.ts`; every page in
  `site/guide/`; `docs/preferences.md`, `docs/key-bindings.md` and `docs/theme-settings.md`. Each reference's
  lead paragraph stays equal to its in-app description (FR-016), so the two change together. Prose dashes go.
  Ranges (`200 – 1,200 px`) stay. `throng-guide`'s style guide points at `stop-slop` and does not copy its rules.
- **FR-058, banned phrases.** A new case in `docs-currency.test.ts` scans those sources for the four phrases,
  case-insensitive, and names each file and phrase it finds.
- **FR-059, section layout.** The guide layout check in `docs-currency.test.ts` changes. Each `##` task now
  opens with a bold breadcrumb paragraph (`**Cog › Settings › …**`, the whole paragraph in bold), then prose,
  and has a numbered list somewhere in its body. No paragraph may start with `**Where:**` or
  `*Why you'd use this:*`. Reference sections get a bold breadcrumb line after their heading. Their lead
  paragraph is still the description, followed by the key and default. `scripts/guide-build.mjs` writes an
  `<hr>` between `##` sections (guide) and between setting, binding and theme-setting sections (references), so
  the Markdown carries no rules of its own. The fixtures in `packages/ui/tests/fixtures/guide` move to the new
  shape.
- **FR-060, lazy screenshots.** The image renderer in `guide-build.mjs` adds `loading="lazy"` plus `width` and
  `height`, read from the PNG's IHDR (or the WebP header) at build time. A unit test checks the built page.
- **FR-061.** In `find-in-files-panel.tsx`, the (?) targets `finding#search-the-whole-project`. The
  help-surfaces test asserts the anchor.
- **FR-062, link popover.** `site/assets/site.js` runs this only when `location.protocol === 'throng-help:'`
  (the website keeps the browser's own status line). One fixed `div.link-status` sits at the bottom left. On
  `pointerover` of an `a[href]` it shows the resolved address and "In the guide" (same scheme) or "External",
  and fades in. On `pointerout` it fades out (opacity transition, `prefers-reduced-motion` gets no transition).
  The styles go in `site.css`. An E2E step in `help-window.e2e.ts` hovers a link and reads the popover.
- **FR-063, ask before opening.**
  - *Setting.* `confirmations.openExternalLink`: boolean toggle in the Confirmations group, default `true`,
    normalised in `app-settings.ts`. It gets a `docs/preferences.md` section and a guide task in
    `troubleshooting.md` or `preferences.md` (throng-guide-upkeep).
  - *One gate.* Every external open reaches `IShellIntegration.openExternal`: `external-url.ts` (both channels
    and `linkUri`), `window-open-guard.ts`, and `help-window.ts` (the guide's external links and Open in
    browser). `main.ts` wraps the shell integration once with `withExternalLinkPrompt(inner, { enabled, ask })`
    from a new `packages/ui/src/main/external-link-prompt.ts`. That covers every route with no change at the
    call sites. `openPath` and reveal are untouched. `enabled` reads `currentSettings` lazily (TDZ guard).
    `ask(url)` resolves `'open' | 'cancel'`. On `'cancel'` the wrapped `openExternal` resolves and opens
    nothing, so no failure notice follows. A request made while a prompt is open focuses that prompt and is
    dropped.
  - *The prompt.* `link-prompt-window.ts` opens `index.html?linkPrompt=<id>`. It is a small modal, frameless,
    themed `BrowserWindow` parented to the focused throng window (else the main window). Preload exposes
    `linkPrompt.get(id)`, which returns the URL, and `linkPrompt.answer(id, 'open' | 'cancel' | 'preferences')`.
    `renderer/link-prompt/link-prompt-app.tsx` shows the full URL (selectable, wrapped), **Cancel** (focused,
    Esc), **Open**, and **Change in Preferences**. That last button cancels the open and calls
    `openPreferences('settings', …, 'Confirmations')`. Closing the window counts as cancel.
  - *Tests.* Unit: the wrapper (off opens, cancel does not, open opens, a second request while pending is
    dropped). Component: the prompt app's buttons and Esc. E2E: the harness seeds
    `confirmations.openExternalLink: false` for every app unless a spec asks for it on, so the link specs keep
    counting opens. `help-window.e2e.ts` turns it on and checks that a header link shows the prompt with its
    URL, that Cancel opens nothing, and that Open opens. Budget re-seeded.
- **Constitution.** The prompt is a themed window with themeable controls (XI). One condition, one prompt.
  The external-link scheme policies (044) are unchanged and run before the prompt is asked. No violations.
