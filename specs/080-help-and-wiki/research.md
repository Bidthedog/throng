# Research: Online help and the user guide

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-11-25

Each entry: the decision, why, and what else was weighed. Code references are to the tree at the
branch point (`bec9fb43`).

## R1. The site generator: a Node `.mjs` builder over markdown-it

**Decision**: Extend `scripts/site.mjs` with a guide build step (`scripts/guide-build.mjs`, imported by
`assembleSite`) that renders `guide/*.md`, `docs/preferences.md` and `docs/key-bindings.md` with
**markdown-it** (already a root dependency, `package.json`) into HTML pages wrapped in one page
template. The template's header and footer are **read from `site/index.html` at build time**, so the
home page and the guide share one header and one footer by construction (FR-002a), and both load
`site/assets/site.css`.

**Navigation source**: the builder is plain `.mjs` with no TypeScript step, so it builds the nav from
`guide/*.md` front matter (`title`, `order`), never from `GUIDE_PAGES`. A docs-currency assertion keeps
the two equal, so the TypeScript map (which the app and checks read) and the built nav cannot disagree.

**Rationale**:

- FR-002a demands the site's existing look. Every packaged generator (VitePress, Starlight, Docusaurus,
  MkDocs) ships its own theme, layout and CSS pipeline; matching `site.css` means overriding the theme,
  and two looks drift. A template that reuses the home page's own header and footer cannot drift.
- `site.mjs` already assembles the site with Node built-ins and is unit-tested
  (`packages/ui/tests/unit/site-assemble.test.ts` drives `assembleSite` with injected release listers). The builder joins
  the same seam and is testable the same way, with fixture Markdown, no network.
- markdown-it is the parser throng's own Markdown preview uses, so tables, fences and links render the
  way contributors already see them in the app.
- The output is plain static files; GitHub Pages serves them with no server (spec Assumptions).

**Alternatives considered**: VitePress or Astro Starlight (own theme; a second design system to keep in
step with `site.css`; a large dependency tree for 22 pages); Eleventy (layout-agnostic, but one more
toolchain where a 200-line module does the job); Jekyll on Pages (Ruby; `.nojekyll` is already written
deliberately).

## R2. Search: Pagefind, pinned and fetched the way esbuild is

**Decision**: After assembly, `pages.yml` runs `npx --yes pagefind@1.3.0 --site _site`, pinned exactly,
fetched alone like the existing esbuild step. Only guide and reference page bodies carry
`data-pagefind-body`, so the home page and the package repositories stay out of the index. The header's
search field is Pagefind's default UI, styled with `site.css` tokens (FR-002c).

**Rationale**: Pagefind builds a static, chunked index at deploy time, needs no server and loads only
the chunks a query needs. It indexes headings with their anchors, so a result opens the matching section
(US1 AC6). Pinning keeps the deploy reproducible; the job still installs none of the workspace.

**Alternatives considered**: Lunr or MiniSearch with a hand-built JSON index (more code, the whole index
downloaded per visit); Algolia DocSearch (external service, a crawler, and it contradicts "collects
nothing").

## R3. Every deployment builds from the latest release tag

**Decision**: `pages.yml` keeps its triggers (072 FR-010: release, manual dispatch) and still runs on
master. Its first step resolves the newest published `v*` release, prereleases included
(`latestReleaseTag()` in `site.mjs`, over the same release list `selectBundles` already reads), then
checks out **that tag** and runs **that tag's** `scripts/site.mjs assemble --version <tag>`. The tag
name is stamped into every page (FR-002b).

**Rationale**: Building the whole tree from the tag, assembler included, means the site is exactly what
that release shipped. A guide fix merged between releases goes live with the next release, as the spec
accepts. The first release that contains stage 1 is the first deployment with a guide; until then a
dispatch rebuilds the previous release's site, which is correct by FR-002b.

**When the guide first goes live**: the release that first contains stage 1 is the one whose deployment
first carries the guide. The same release is the first app build with Help and the (?) links, and its
publish dispatches `pages.yml` (`release.yml`), so a released build never points at a missing guide. A
build between releases (a development build) may; the spec's edge case covers it. No lookup failure
falls back to master: an empty release list or a failed `gh` call fails the job and Pages keeps serving
what it had.

**Supersession**: 064 user story 4 (a static-file change deployed from master by hand) — recorded in the
spec's FR-002b. 072 FR-010's triggers are unchanged.

**Alternatives considered**: build tooling from master and content from the tag (two trees in one
build; a master-only assembler change could publish pages the tag never had); build from master and
filter unreleased pages (requires per-page release metadata nobody would keep).

## R4. Where things live

| Thing | Path | Why |
|---|---|---|
| Guide pages and images | `guide/` (repo root): `index.md`, `quick-start.md`, one `.md` per page in [page-plan.md](page-plan.md), `images/` | FR-001: one directory holding only guide pages and their images |
| Builder | `scripts/guide-build.mjs`, called by `scripts/site.mjs assemble` | R1 |
| Page template | `scripts/guide-template.mjs` (header/footer lifted from `site/index.html`) | FR-002a |
| Guide map | `packages/core/src/help/guide-map.ts` | R6 |
| Help URLs | `packages/core/src/help/help-urls.ts` | R7 |
| (?) control | `packages/ui/src/renderer/common/help-link.tsx` | R8 |
| Style guide and skill | `.claude/skills/throng-guide/SKILL.md`, `references/style.md` | FR-020, FR-022; the guide directory holds pages only |
| Site URLs | `/guide/` (start page), `/guide/<page>/`, `/guide/reference/preferences/`, `/guide/reference/key-bindings/` | Directory URLs; Pages serves `index.html` |

## R5. Reference pages get one section per setting, anchored by key

**Decision**: `docs/preferences.md` is restructured once, by a throwaway conversion script run in stage 1:
each setting's table row becomes a `####` section headed by the setting's label, whose first line is the
key in a code span and whose first paragraph is the setting's in-app description **verbatim** (FR-016),
followed by the default, the values and any further detail. The builder gives each such heading the id
**`<setting key>`** (e.g. `#window.nativeWayland`) by reading the key line, not the heading text, so a
reworded heading never moves the anchor (FR-007, spec Edge Cases). Group headings keep their slugs.
Relative links to unpublished `docs/` pages are rewritten to GitHub blob URLs at the release tag.

**Rationale**: A table row cannot carry paragraphs, examples or platform notes, which is exactly what
stage 2 moves out of Preferences. A key-derived id is stable and is what `settingHelpUrl(key)` builds.
Reading the key from the line after the heading keeps the Markdown clean on GitHub (no `{#id}`
attribute text).

**Alternatives considered**: anchors inside table rows (`<a id>` in a cell — no room for detail);
`{#id}` heading attributes (render literally on GitHub, where `docs/` is also read).

`docs/key-bindings.md` keeps its tables and its per-group anchors (spec Assumptions).

## R6. The guide map is typed TypeScript in core

**Decision**: `packages/core/src/help/guide-map.ts` exports `GUIDE_MAP: readonly GuideTask[]` and
`GUIDE_EXCLUSIONS`, authored in stage 1 from [page-plan.md](page-plan.md). Command ids are typed
`ActionId`, preview types are the ids of `SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS`, panel types are the
panel-type registry's kinds, settings are typed setting keys. See [data-model.md](data-model.md) and
[contracts/guide-map.md](contracts/guide-map.md).

**Rationale**: A typo'd id fails `tsc`, not a review. The app imports it for help URLs (FR-009), unit
tests read it for coverage (FR-015, FR-018), and the release check reads it (FR-019) — one file, three
readers, all TypeScript.

**Alternatives considered**: JSON or YAML in `guide/` (untyped; would need a loader in core and a schema;
and FR-001 keeps `guide/` to pages and images).

## R7. Help URLs and the opener

**Decision**: `help-urls.ts` defines `HELP_BASE_URL = 'https://throng-ide.com/guide/'` once, and
`helpUrl(task)`, `startPageUrl()`, `settingHelpUrl(key)`. Main reads an optional
`THRONG_HELP_BASE_URL` (documented in `docs/environment.md`) so a developer can point the app at
`npm run site:preview`; the value reaches each renderer in main's preload boot payload (the object
`applyBootstrapTheme` in `preload/preload.cts` reads, as `testPanelThrow` does), never `process.env` in a
component (Principle X). Opening uses `window.throng.openExternal`, the `http(s)`-only channel main
already guards (`main/external-url.ts`, `isSafeExternalUrl`). That channel drops a failed open today
(`void shell.openExternal(url)`), so this feature adds the log line and the one notice with a Copy action
(FR-011, constitution XIII). It never goes through `openWebLink`'s preview routing,
and never through any preview: the browser is the only target, whatever `Open HTML in` says.

## R8. The (?) control

**Decision**: one `HelpLink` component, an `IconButton` with the existing `help` icon key (a circled question
mark), added to every bundled icon pack and to the fallback set, with the hover title
"Help: <setting label>" in the one popup style, keyboard-focusable, and placed in the settings row's
meta block after the description. Clicking opens `settingHelpUrl(key)` (FR-014). It is not drawn on rows
the platform hides, because those rows are not drawn (spec Edge Cases).

## R9. F1, outside a terminal

**Decision**: new action id `help.open`, default chord `F1`, scope **every scope except `terminal`**
(a new `NOT_TERMINAL` scope set beside `EVERYWHERE` in `keybindings.ts`). The main window and
sub-workspace windows dispatch it through `window-dispatcher.tsx`. The Preferences, Resource Monitor and
About windows do not mount that dispatcher, so each gets the same handler through a small shared hook,
`useHelpKey()`, which reads the live binding. No Principle IV terminal exception is needed: the chord is
never live in a terminal, so F1 reaches the program (US2 AC4).

On macOS, F1 needs Fn on keyboards whose top row defaults to media keys; the Key Bindings editor lets the
user rebind it. `docs/macos.md` says so.

## R10. Keeping the guide current (FR-018) and the marker

**Decision**:

- **Coverage** — `docs-currency.test.ts` gains: every `ActionId`, panel type and preview type appears in
  a guide-map task or an exclusion; every setting key has a section in `docs/preferences.md`; every map
  entry's page and anchor exist in `guide/`; every `guide/` task heading is in the map. These run in PR CI
  as unit tests.
- **The marker** — the PR body line `No user-facing change: <reason>`. A small CI step,
  `scripts/guide-pr-check.mjs`, runs in `ci.yml`: when the PR changes production source (`packages/*/src`,
  non-test) and touches neither `guide/`, `docs/preferences.md` nor `docs/key-bindings.md`, the body must
  carry the marker. It reuses `scripts/ci-changes.mjs`'s changed-file list.
- **Built-site links** (FR-015, SC-005) — a unit test builds the guide into a temp directory with the real
  builder and checks every internal link, every map anchor and every `settingHelpUrl(key)` against the
  built HTML ids.

## R11. Release coverage (FR-019)

**Decision**: `release-notes.ts` (which already refuses a malformed CHANGELOG section, 042 FR-005) gains
one rule: each `### Added` and `### Changed` entry in the section being released must carry a link to
`https://throng-ide.com/guide/<page>/#<anchor>` whose page and anchor are a task in `GUIDE_MAP`.
`### Fixed`, `### Removed` and `### Known issues` are exempt. The refusal names the entry. The
`throng-release` skill already runs the release notes check before tagging, so it refuses there.

**Rationale**: A CHANGELOG entry is prose; mapping prose to a task by keyword would be guesswork. A link
is mechanical, is useful in the release body, and points users at the guide.

## R12. Pages that are not written yet

**Decision**: stage 1 creates **every** page in the page plan, each with all of its task headings (so
every anchor, map entry and (?) target exists from the first release that carries the guide) and a
one-line "why you'd use this" under each. A page whose steps are not yet written carries
`status: outline` in its front matter, and the builder shows a one-line notice at its top: "This page is
being written. Each task below links to its reference." Stages 3 onward replace outlines with directions
and drop the status.

**Rationale**: Releases continue while the content stages land. Without the headings, help URLs, the
release check and the nav (US1 AC2) would all point at nothing between releases.

## R13. Description length ratchet (FR-013)

**Decision**: stage 1 adds the 100-character check with a **ratchet list** of the setting keys that
exceed it today (`packages/ui/tests/unit/description-length-ratchet.json`). The test fails when a key not
on the list exceeds 100, and when a listed key no longer exceeds it (so the list only shrinks). Stage 2
empties the list.

*Superseded by R19 (iteration 1): every description was cut in this pull request, so the ratchet list and its
file are gone.*

## R14. Quick start retirement (FR-003a) and 070 SC-007

**Decision**: `guide/quick-start.md` replaces `docs/quick-start.md`. `docs-currency.test.ts`'s "macOS
coverage of the quick start (070 SC-007)" test is retargeted at `guide/quick-start.md`'s headings, and
`docs/macos.md`'s coverage section names the guide page. 070 SC-007's intent (every quick-start section
says what proves it on macOS) is unchanged; only the file moves. The README test that requires a link to
the quick start is retargeted at the guide.

## R15. Delivery staging and this branch

**Decision**: this branch (PR #726) delivers **stage 1** (FR-024). `tasks.md` carries stage 1 as its
phases; stages 2 and onward are listed in [plan.md](plan.md) § *Later stages* and get their own branches,
each with its own `tasks.md` phase appended on this spec.

*R15 is superseded by FR-025 (iteration 1): every stage lands on this branch.*

## R16. One header on every page, and where search results go (FR-029; defects D1, D3)

**Decision**: the guide template inserts the search slot **before** the home page's `<nav>`, and the
header's `nav`, search and version label sit in one group pushed right (`margin-left: auto` on the first
of them), so the nav's right edge and links land where the home page draws them. Pagefind UI's
`.pagefind-ui__drawer` is drawn `position: fixed` just below the header, as wide as `.wrap`, with
`max-height` to the viewport's bottom and `overflow-y: auto`, on the site's surface colour. The input
gets `color: var(--text)` explicitly; Pagefind's own input rule ignores `--pagefind-ui-text`.

**Rationale**: the results rendered inside the sticky header's flex row, which squeezed the nav and made
the header taller than the viewport — so the page scrolled while the sticky header (holding everything
visible) did not move. A fixed drawer leaves the page's scroll alone.

**Alternatives**: a dedicated search page (one more click; loses inline results); moving search out of
the header (FR-029 puts it there).

## R17. References split per section (FR-026)

**Decision**: the builder splits each reference at its `##` headings. Each section becomes
`/guide/reference/<ref>/<slug(heading)>/`; whatever precedes the first `##` stays at the reference's own
URL, followed by a generated list of its sections. Anchor ids are assigned across the whole file first
(so keyed ids stay unique), then each section page is rendered from its tokens. A link to
`docs/preferences.md#<id>` resolves to the section page holding `<id>`; a link to the file alone goes to
the reference's own page. The nav draws each reference as `<details><summary>` with its section links,
`open` on its own pages.

`help-urls.ts` derives the section from metadata: `settingHelpUrl(key)` →
`reference/preferences/<slug(group)>/#<key>`. `slug` moves to core (`help/slug.ts`, GitHub's rule) and the
builder imports the same rule, so the two agree by construction. A unit test proves every settings group
and every key-binding group has a `##` of the same text in its reference.

**Alternatives**: splitting at `###` (hundreds of pages; settings lose their neighbours); separate
Markdown files per section (breaks GitHub reading and the one-home rule).

## R18. Key bindings and theme settings references keyed by id (FR-028)

**Decision**: `docs/key-bindings.md`'s group tables become one `###` per command: heading = label,
next line the action id in a code span, then the one-line description, then `**Default:**` chord(s) and
`**Scope:**`, then any extra detail. Explanatory sections (*How the defaults are laid out*, *On macOS*,
*Multi-key chords*, …) stay prose. A new `docs/theme-settings.md` holds every theme token in the same
shape, one `##` per theme area (the metadata group), keyed by its token key (`colours.appBg`). The
builder's keyed rule applies to all three references; its key pattern accepts these ids. The conversion
is a one-off script outside the repository.

**Rationale**: a binding or token needs a section of its own to be the target of a (?); the preferences
shape is already proven and checked.

## R19. Descriptions at most 100 characters, all three registries (FR-013, FR-016, FR-028)

**Decision**: every description over 100 characters is cut to what the thing does plus one essential
qualifier; everything cut moves, verbatim where it still reads, into the item's reference section after
its lead line. The ratchet list empties and the length test covers settings, key bindings and theme
tokens with no ratchet. The FR-016 lead-line check extends to the two new keyed references.

## R20. (?) placement and the FR-017 audit (FR-017, FR-027, FR-028)

**Decision**: `HelpLink` takes the URL (built by the caller from `settingHelpUrl`, `keyBindingHelpUrl`,
`themeTokenHelpUrl` or `helpUrl(task)`) and the label for its title. On setting rows it moves into the
label line, after the label. Key Bindings and Themes rows get one beside the command or token label.

FR-017 audit outcome:

| Surface | (?) target |
|---|---|
| Themes tab rows | the token's section (FR-028) |
| Key Bindings tab rows | the command's section (FR-028) |
| New panel: **Panel Type** picker | the guide task for the chosen panel type (`helpUrl`) |
| Terminal settings form (flavour, shell, folder) | Terminals › *Change how a terminal is set up* |
| Projects list header | Projects › *Add a project* |
| Find in Files options | Finding › *Search the whole project* (FR-061; was *Narrow a search*) |

Notices get none: a notice says what is wrong and carries its own action (CLAUDE.md, *One condition, one
notice*).

## R21. Callouts (FR-022, FR-030; defect D2)

**Decision**: GitHub's alert syntax — `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]` — which GitHub renders as
callouts when the Markdown is read in the repository. The builder rewrites such a blockquote to
`<aside class="callout callout--tip"><p class="callout__title">Tip</p>…</aside>`; the site styles each kind
with its own accent. A blockquote without a marker stays a quote.

**Alternatives**: `**Tip:**` bold prefixes (no box on GitHub); a markdown-it container plugin (`:::tip`,
unreadable on GitHub; a new dependency).

## R22. One page layout, and the maintainer's voice (FR-030)

**Decision**: every page: front matter, a short introduction, then one `##` per task. Each task opens
with `**Where:** <route>` — the path through the UI as the user meets it, separated by ` › ` (for example
**Where:** cog menu › **Settings** › **Editor**; *anywhere in throng* for global chords) — then
`*Why you'd use this:* …`, then numbered steps, then callouts. `index.md` and `faq.md` are exempt (no
tasks). A docs-currency check refuses a task section missing the Where line or the numbered list.

Voice: the maintainer's writing profile adapted to instructions — direct "you", imperatives, short
punchy sentences between longer ones, the odd dry aside in brackets, British spelling, no swearing, no
history. `throng-guide`'s `references/style.md` owns it.

## R23. No page ships as an outline (FR-033)

**Decision**: the builder throws on `status: outline`, naming the file, and docs-currency fails the same
way. The outline notice and `.guide-outline` go.

## R24. Screenshots from a set-up throng (FR-023, FR-031)

**Decision**: `packages/ui/tests/guide-screenshots/guide-screenshots.spec.ts` with
`playwright.guide-screenshots.config.ts`, run by `npm run guide:screenshots` (built app, one worker). It
reuses the E2E harness's app launch with a seeded config root: a demo project over a generated sample
folder (source files, a Markdown file, a CSV, an image), the **throng** theme, panels split with a
terminal and editor tabs open. Each shot is named after its page and task and written to
`guide/images/<page>/<task>.png`, cropped to the region the task is about. It is not in the E2E suite
(not under `tests/e2e`), so the tag, budget and tier checks do not apply; re-running it refreshes every
image.

**Alternatives**: an `@extended` E2E (would write files on every CI run); hand captures (FR-023 forbids).

## R25. A skill that keeps the help current (FR-032)

**Decision**: `.claude/skills/throng-guide-upkeep/SKILL.md`. Trigger: any change that adds, changes or
removes a user-visible feature, setting, binding, command, panel or preview type, or theme token. It
holds the checklist — which guide task, map entry, reference section, description and screenshot each
kind of change touches, and which check fails when one is missed — and points at `throng-guide` (voice,
page shape) and `throng-docs` (references) rather than restating them. `CLAUDE.md`'s *Documentation*
section and `.claude/skills/README.md` route to it.
