---
description: "Task list for spec 080, stage 1 — online help and the user guide"
---

# Tasks: Online help and the user guide (stage 1)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md), [page-plan.md](page-plan.md)

**Scope**: stage 1 of FR-024. Stage 2 (descriptions, the (?) audit) and stages 3+ (page content,
screenshots) are separate branches — [plan.md](plan.md) § *Later stages*.

**Tests**: test-first (constitution V). Every behaviour gets a failing unit or component test before its
code. No E2E is added: every observable here is provable below E2E (plan, Technical Context).

**Paths** are from the repository root. `[P]` tasks touch no file another `[P]` task in the same run
touches.

## Phase 1: Setup

- [x] T001 Create `guide/` with `guide/images/.gitkeep` and nothing else (FR-001)
- [x] T002 [P] Create the `throng-guide` skill: `.claude/skills/throng-guide/SKILL.md` (its job: the guide's voice, page structure, where a new feature's task goes, the guide map, the marker; load it whenever a user-visible feature is added or changed) and `.claude/skills/throng-guide/references/style.md` (FR-022: second person; one task per `##` section headed by the task in the user's words; numbered imperative steps naming the exact control or chord; a "why you'd use this" line; tips and callouts; platform differences inline in the step they change; a task that changed in a release names that version; outline pages per research R12; a page links to `docs/preferences.md` and `docs/key-bindings.md` sections and never copies their tables, FR-006)

## Phase 2: Foundational (blocks every story)

- [x] T003 Write failing tests for the guide map's shape in `packages/core/tests/unit/guide-map.test.ts`: `GUIDE_PAGES` lists every page in `specs/080-help-and-wiki/page-plan.md` in order (`index`, `quick-start`, then the rest); every `GUIDE_MAP` entry's `page` is in `GUIDE_PAGES`; `(page, anchor)` is unique; every `GUIDE_EXCLUSIONS` entry has a non-empty `reason`
- [x] T004 Implement `packages/core/src/help/guide-map.ts` with the types in `data-model.md` (`GuidePageSlug`, `GuideTask`, `GuideExclusion`), `GUIDE_PAGES` (slug + title for all 20 pages; the start page's slug is `index`, the second page is `quick-start`), and empty `GUIDE_MAP` / `GUIDE_EXCLUSIONS`; export through `packages/core/src/help/index.ts` and `packages/core/src/index.ts`
- [x] T005 Write failing tests in `packages/core/tests/unit/help-urls.test.ts` per `contracts/help-urls.md`: `startPageUrl()` is `https://throng-ide.com/guide/`; `helpUrl({page:'terminals',anchor:'x'})` is `…/guide/terminals/#x` and throws for a pair not in `GUIDE_MAP` (use a test map seam); `settingHelpUrl('window.nativeWayland')` is `…/guide/reference/preferences/#window.nativeWayland` and throws for an unknown key; a passed `base` replaces the default and must end in `/`
- [x] T006 Implement `packages/core/src/help/help-urls.ts` (`HELP_BASE_URL`, `startPageUrl`, `helpUrl`, `settingHelpUrl`), exported via `packages/core/src/help/index.ts`
- [x] T007 Write a failing test in `packages/ui/tests/unit/help-url-single-home.test.ts` that greps `packages/*/src` (excluding `packages/core/src/help/help-urls.ts`) and fails on any `throng-ide.com/guide` literal (FR-009)
- [x] T008 Reuse the existing `help` icon key (055, the Resource Monitor's guide button) for the (?) and the Help row: widen its description in `packages/core/src/icons/icon-keys.ts` and `icon-sets-README.txt`, regenerate `default-icon-set.generated.ts` (`npm run generate:icons`); the icon suites stay green [derived]

**Checkpoint**: core help module and icon exist; stories can start.

## Phase 3: User Story 1 — Learn a feature from a page written to teach (P1) 🎯 MVP

**Goal**: the guide and both references build into the site with the site's look, search and version.

**Independent test**: `npm run site:preview`, open `/guide/`, follow the nav to Terminals (quickstart §2).

### Tests first

- [x] T009 [P] [US1] Write failing tests in `packages/ui/tests/unit/guide-build.test.ts` for `scripts/guide-build.mjs` over fixture Markdown in `packages/ui/tests/fixtures/guide/`: each `guide/<page>.md` builds to `<out>/guide/<page>/index.html` (`index.md` to `<out>/guide/index.html`); headings get GitHub-style slug ids; a duplicate id, a broken internal link or anchor, and a page missing `title` or `order` front matter each fail the build naming the file; `status: outline` adds the outline notice; relative links to unpublished repo files become `https://github.com/Bidthedog/throng/blob/<tag>/<path>`; links to `docs/preferences.md` / `docs/key-bindings.md` become `/guide/reference/preferences/` / `/guide/reference/key-bindings/`; a `docs/` page's first (breadcrumb) line is dropped; a setting section's heading id is the key from the code span on the line after it (research R5)
- [x] T010 [P] [US1] Write failing tests in `packages/ui/tests/unit/guide-template.test.ts`: the built page's `<header class="top">` and `<footer>` equal `site/index.html`'s apart from same-page anchors made absolute (`#features` → `/#features`) and the added search field and version label; the page links `/assets/site.css`; `<main>` carries `data-pagefind-body`; the nav lists every page's front-matter `title` in front-matter `order` (the builder reads `guide/*.md`, never the TypeScript map; a docs-currency assertion keeps that list equal to `GUIDE_PAGES`, research R1) then the two reference pages; the page shows "This guide describes throng {version}." (FR-002a, FR-002b, FR-002c, US1 AC5–AC6)
- [x] T011 [US1] Extend `packages/ui/tests/unit/site-assemble.test.ts` (failing first): `assembleSite({ version })` writes the guide and reference pages, stamps the version into `index.html`'s version label, adds the **Guide** nav link target, and leaves the existing files and repositories unchanged (FR-002); `latestReleaseTag()` over an injected release list returns the newest published `v*` tag, prereleases included, ignoring drafts, and throws "no published release to build the site from" on an empty list (the CLI exits non-zero; never a fallback to master) (FR-002b, constitution XIII); every assembled `.html` outside `apt/` and `rpm/` carries the same version (SC-006)

### Implementation

- [x] T012 [US1] Implement `scripts/guide-template.mjs`: read `site/index.html`, lift `<header class="top">…</header>` and `<footer…>…</footer>`, absolutise same-page anchors, insert the Pagefind search field (`<div id="search" class="guide-search"></div>` plus Pagefind UI's CSS/JS from `/pagefind/`) and the version label, and wrap a page body with the nav and version line (contracts/site-build.md § Page template)
- [x] T013 [US1] Implement `scripts/guide-build.mjs` with markdown-it (HTML off, linkify on, typographer off): front matter, slugs, key-anchored setting headings, link rewriting, failure rules, outline notice (contracts/site-build.md § Rendering rules); export `buildGuide({ guideSource, docsSource, out, version, tag })`
- [x] T014 [US1] Extend `scripts/site.mjs`: `assembleSite` takes `version`, `guideSource`, `docsSource` and calls `buildGuide`; stamps the version into `index.html`; add `latestReleaseTag(listReleases)` and the `latest-tag` and `--version` CLI; `preview` builds into a temp dir and serves it, running Pagefind when `npx pagefind` is available and saying so when not
- [x] T015 [US1] Add guide styles to `site/assets/site.css` (side nav, version line, outline notice, search field, reference tables, setting sections) using the existing tokens only; phone width with a 16px gutter and no horizontal scroll
- [x] T016 [US1] Edit `site/index.html`: a **Guide** link in the header nav (`/guide/`), a version label element the assembler fills, same-page nav anchors made absolute (`/#features`, …); the privacy line unchanged
- [x] T017 [US1] Write `guide/index.md` (front matter `title: Start here`, `order: 0`, the title `GUIDE_PAGES` gives it) [derived]: what throng is for, then each main feature in one line linking to its page, and a prominent link to Quick start (FR-003, US1 AC2); voice per `.claude/skills/throng-guide/references/style.md`
- [x] T018 [US1] Write `guide/quick-start.md` (`order: 1`) from `docs/quick-start.md`, restructured as the page-plan § 2 tasks with numbered steps, correcting the two quick-start rows of page-plan § *Docs that contradict the code* (windows raise one at a time; CSV menus insert, no delete) (FR-003a, FR-022a)
- [x] T019 [US1] Create every other page in `specs/080-help-and-wiki/page-plan.md` (§ 3–20) as `guide/<slug>.md` with `title`, `order`, `status: outline`, an intro line, and one `##` heading per task in the page plan with a one-line "why you'd use this" under each and links to the reference sections the task uses (research R12)
- [x] T020 [US1] Restructure `docs/preferences.md` with a throwaway script kept outside the repo (scratchpad; Node, never Python): each setting row → a section headed by its label, the key in a code span on the next line, the metadata `description` verbatim as the lead paragraph, then default and values, then any table text that said more than the description as detail; keep group headings, the window/folding/resetting sections and the breadcrumb (research R5, FR-007, FR-016)
- [x] T021 [US1] Fix `docs/preferences.md` § Resetting and `docs/key-bindings.md` § Rebinding (Revert, Reset and Clear always show, disabled with a reason) and § Where the files live / § Logging (add the Linux and macOS paths from the install guides) (FR-022a)
- [x] T022 [US1] Update `.github/workflows/pages.yml` per contracts/site-build.md § pages.yml: resolve the tag with `node scripts/site.mjs latest-tag`, check out that tag, `npm ci --ignore-scripts`, assemble with `--version "$TAG"`, minify, then `npx --yes pagefind@1.3.0 --site _site`; log the tag; a failed tag lookup fails the job (Pages keeps serving what it had); update the header comment (064 user story 4 superseded by 080 FR-002b)

**Checkpoint**: the guide builds locally with every page, both references, search and the version.

## Phase 4: User Story 2 — Get to the help from inside throng (P1)

**Goal**: cog menu → **Help** and F1 outside a terminal open the guide's start page in the OS browser.

**Independent test**: quickstart §3.

### Tests first

- [x] T023 [P] [US2] Write failing tests in `packages/core/tests/unit/keybindings-080.test.ts`: `help.open` exists with default `['F1']`; its scope contains `editor`, `explorer`, `findInFiles`, `preview`, `projects` and not `terminal`; F1 in a terminal resolves to no action; F1 collides with no other default; the metadata row exists in the Application group with label "Help"
- [x] T024 [P] [US2] Extend `packages/ui/tests/unit/menu-sections.test.ts` (failing first): the cog menu has a **Help** item (`testId: 'cog-menu-help'`, icon `help`, section `application`) whose click calls `actions.openHelp()`
- [x] T025 [P] [US2] Write failing tests in `packages/ui/tests/unit/help-opener.test.ts`: `openHelp(url)` calls `window.throng.openExternal` with the URL and never `linkUri.openExternal` or any preview opener, whatever the HTML open action is; with no `openExternal` it does nothing and throws nothing (FR-011)
- [x] T026 [P] [US2] Write failing component tests in `packages/ui/tests/component/use-help-key.test.ts`: in a window mounting `useHelpKey`, pressing the live `help.open` chord opens the start page URL once; a rebound chord is honoured; a key the binding does not match does nothing

### Implementation

- [x] T027 [US2] Add `help.open` to `packages/core/src/config/keybindings.ts` (ActionId, `NOT_TERMINAL` scope set beside `EVERYWHERE` with a comment citing 080 FR-010 and research R9, default `['F1']`, the ordered action list) and its row to `packages/core/src/config/keybindings-metadata.ts`
- [x] T028 [US2] Implement `packages/ui/src/renderer/help/help-opener.ts`: `openHelp(url)` over `window.throng.openExternal`, and `effectiveHelpBase()` reading the injected base (T029)
- [x] T029 [US2] Read `THRONG_HELP_BASE_URL` once in main (validated `http(s)`, trailing `/` enforced; invalid → ignored with a log line), add `helpBaseUrl` to main's preload boot payload (the object `applyBootstrapTheme` in `packages/ui/src/preload/preload.cts` reads, as `testPanelThrow` is carried) and expose it as `window.throng.helpBaseUrl` (`packages/ui/src/renderer/global.d.ts`); document it in `docs/environment.md` (Principle X, research R7)
- [x] T052 [US2] Make a failed open on `throng:openExternal` leave a trace (FR-011, constitution XIII; load `throng-failure-notices`): failing test first in `packages/ui/tests/unit/external-url.test.ts` — when `shell.openExternal` rejects, `registerOpenExternalIpc` logs `open-external failed: <url>: <reason>` and asks the sending window to raise one notice naming the URL with a **Copy** action; a repeat for the same URL while it shows flashes it instead; then implement in `packages/ui/src/main/external-url.ts` and the notice's renderer side
- [x] T030 [US2] Add the **Help** item to `packages/ui/src/renderer/title-bar/cog-menu-items.ts` (`openHelp` on `CogMenuActions`, item before **About throng**) and wire `openHelp: () => openHelp(startPageUrl(effectiveHelpBase()))` in the cog menu's caller
- [x] T031 [US2] Handle `help.open` in `packages/ui/src/renderer/keybindings/window-dispatcher.tsx` (main and sub-workspace windows)
- [x] T032 [US2] Implement `packages/ui/src/renderer/help/use-help-key.ts` and mount it in `packages/ui/src/renderer/preferences/preferences-app.tsx`, `packages/ui/src/renderer/resources/monitor-app.tsx` and `packages/ui/src/renderer/about/about-app.tsx` (US2 AC3)
- [x] T033 [US2] Add `help.open` to `docs/key-bindings.md` (Application group: chord F1, scope "Everywhere except a terminal", what it does) and the F1/Fn note to `docs/macos.md` (research R9)

**Checkpoint**: Help opens from every window, by menu and by F1; F1 reaches terminal programs.

## Phase 5: User Story 3 — Short descriptions, with (?) for the full story (P2)

**Goal (stage 1 part)**: every setting row has a (?) that opens its own section; the 100-character limit is
enforced by a ratchet. Cutting descriptions and the audit are stage 2.

**Independent test**: quickstart §3, last bullet.

- [x] T034 [P] [US3] Write failing component tests in `packages/ui/tests/component/preferences/help-link.test.ts`: `HelpLink` renders an icon button with the `help` icon, hover title "Help: {label}" in the popup style (no `title` attribute), is reachable by Tab and activates on Enter and Space, and calls `openHelp(settingHelpUrl(key, base))` (FR-014, US3 AC4)
- [x] T035 [P] [US3] Write a failing test in `packages/ui/tests/unit/description-length.test.ts` with `packages/ui/tests/unit/description-length-ratchet.json` (the keys whose description exceeds 100 characters today, generated once): fails when an unlisted key exceeds 100 characters and when a listed key no longer does, naming the key (FR-013, research R13)
- [x] T036 [US3] Implement `packages/ui/src/renderer/common/help-link.tsx` and add it to each setting row's meta block in `packages/ui/src/renderer/preferences/settings-tab.tsx`, after the description (and unit note); a component test in `packages/ui/tests/component/preferences/` asserts one (?) per drawn row with the right key
- [x] T037 [US3] Generate `packages/ui/tests/unit/description-length-ratchet.json` from today's metadata and make T035 pass

**Checkpoint**: every drawn setting row has a working (?); new long descriptions fail CI.

## Phase 6: User Story 4 — The guide cannot fall behind the product (P2)

**Goal**: PR CI and the release refuse uncovered features.

**Independent test**: quickstart §4.

### Tests first

- [x] T038 [P] [US4] Extend `packages/ui/tests/unit/docs-currency.test.ts` (failing first) per contracts/guide-map.md § Checks: map ↔ `guide/` headings both ways; every `ActionId` (the keybindings action list), every panel-type registry kind and every `SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS` id is in a `GUIDE_MAP` entry or `GUIDE_EXCLUSIONS`; every setting key has a key-anchored section in `docs/preferences.md` whose lead paragraph equals its metadata `description`; `guide/*.md` front-matter `title`/`order` list equals `GUIDE_PAGES` in order; each failure names the item
- [x] T039 [P] [US4] Write failing tests in `packages/ui/tests/unit/guide-built-anchors.test.ts`: build the real `guide/` and `docs/` with `buildGuide` into a temp dir; every `GUIDE_MAP` `(page, anchor)`, every `settingHelpUrl(key)` for every setting, the start page and every internal link resolve to an existing page and id; the nav lists every `GUIDE_PAGES` page (FR-015, SC-005)
- [x] T040 [P] [US4] Write failing tests in `packages/ui/tests/unit/guide-pr-check.test.ts` for `scripts/guide-pr-check.mjs` with injected changed files and body: source change without guide/reference change and no marker → fails listing the files and the marker line; with `No user-facing change: refactor` → passes; source change with a `guide/` change → passes; tests-only change → passes (contracts/guide-map.md § PR marker)
- [x] T041 [P] [US4] Extend `packages/core/tests/unit/release-notes.test.ts` (failing first): an `### Added` or `### Changed` entry without a `https://throng-ide.com/guide/<page>/#<anchor>` link, or with a link whose pair is not in `GUIDE_MAP`, refuses naming the entry; `### Fixed` entries and the no-change line are exempt (FR-019, research R11)

### Implementation

- [x] T042 [US4] Fill `GUIDE_MAP` in `packages/core/src/help/guide-map.ts` from `guide/*.md`'s task headings and `page-plan.md`'s *Covers* column (commands, panel types, preview types, settings per task), and `GUIDE_EXCLUSIONS` with the developer-only items and their reasons (page-plan § *Excluded from the guide*) — none is a command, panel type or preview type, so it stays empty [derived] — until T003, T038 and T039 pass
- [x] T043 [US4] Implement `scripts/guide-pr-check.mjs` (reusing `scripts/ci-changes.mjs`'s changed-file list; body from `PR_BODY`) and add a step to `.github/workflows/ci.yml` that runs it on pull requests with `PR_BODY: ${{ github.event.pull_request.body }}`
- [x] T044 [US4] Add `parseHelpUrl(url): { page, anchor } | null` to `packages/core/src/help/help-urls.ts` (built from `HELP_BASE_URL`, test-first in `help-urls.test.ts`) and implement the guide-link rule in `packages/core/src/config/release-notes.ts` with it and `GUIDE_MAP` — no guide URL literal outside `help-urls.ts` (T007)
- [x] T045 [US4] Update `.github/PULL_REQUEST_TEMPLATE.md`: a Documentation checkbox for the guide (task sections and the guide map updated, or the marker), the marker line documented, and the quick-start link pointed at `guide/quick-start.md` (FR-021)
- [x] T046 [US4] Route to the new skill: `CLAUDE.md` § Documentation and `.claude/skills/README.md`'s routing table name `throng-guide`; `.claude/skills/throng-docs/SKILL.md`'s file table gains `guide/` (its job and its boundary with `docs/`) and drops `docs/quick-start.md`; the `throng-release` skill's pre-tag steps name the guide-link refusal (FR-008, FR-019, FR-020)

**Checkpoint**: an uncovered feature fails PR CI; an unlinked CHANGELOG entry refuses the release.

## Phase 7: Polish & cross-cutting

- [x] T047 Retire `docs/quick-start.md` (FR-003a): delete it; point every link at `guide/quick-start.md` or the site (`README.md`, `docs/README.md`, `docs/installation.md`, `docs/install-*.md`, `docs/key-bindings.md`, `docs/preferences.md`, `docs/macos.md`); `git grep -n "quick-start.md" -- ':!specs' ':!CHANGELOG.md'` returns only guide paths
- [x] T048 Retarget `docs-currency.test.ts`'s "macOS coverage of the quick start (070 SC-007)" test at `guide/quick-start.md`'s task headings and rename `docs/macos.md`'s section to match; retarget the README-links test from the quick start to the guide (research R14)
- [x] T049 [P] `docs/README.md` names the guide and its job (FR-008); `README.md` links to the guide on throng-ide.com (US1 AC4) and stays under its line limit
- [x] T050 [P] Add a `## Unreleased` → `### Added` entry to `CHANGELOG.md` for the guide and Help, linking `https://throng-ide.com/guide/#…` and a Quick start anchor (it must satisfy T041's rule)
- [x] T051 Run the `throng-docs` audit and the quickstart §1 commands; run a local `node scripts/site.mjs assemble` with injected releases into a temp dir plus `npx --yes pagefind@1.3.0 --site <dir>`, and confirm the index finds a setting key (`window.nativeWayland`) and a task word (`split`) (FR-002c); record the results in the PR body's Documentation and Testing sections

## Dependencies

- Phase 1 → Phase 2 → stories. US1 and US2 are independent of each other; US3 needs T008 (icon) and T006
  (URLs); US4's T038/T039/T042 need US1's pages (T017–T020) and the builder (T013).
- Within a story: tests before implementation; T020 (preferences restructure) before T038's lead-line check.
- Phase 7 after US1 (T018 must exist before the quick start is retired).

## Parallel examples

- Phase 3 tests: T009 ∥ T010 (different test files).
- Phase 4 tests: T023 ∥ T024 ∥ T025 ∥ T026.
- Phase 6 tests: T038 ∥ T039 ∥ T040 ∥ T041.
- Across stories, by boundary: core (T023, T027, T041, T044) ∥ renderer (T024–T026, T028–T036) ∥ site and
  scripts (T009–T016, T022, T040, T043) ∥ content and docs (T017–T021, T033, T047–T050).

## Implementation strategy

MVP is US1 + US2: the guide on the site and Help opening it. US3's (?) and US4's checks complete stage 1.
Each checkpoint leaves the branch green at unit level.

## Phase 8: Convergence

- [x] T053 Mount `useHelpKey` in `packages/ui/src/renderer/print-preview/print-preview-app.tsx` so F1 opens the guide from the Print Preview window, with a component test that F1 there calls the opener per FR-010, SC-001 (partial)
- [x] T054 Raise the failed-open notice in the About and Print Preview windows (each gains a `NotificationProvider` with `OpenExternalFailedNotice`), with a component test per FR-011 (partial)

## Phase 9: Iteration 1 (FR-025 to FR-033, defects D1–D3)

Boundaries: **site** (`scripts/guide-*.mjs`, `scripts/site.mjs`, `site/**`, their unit tests); **core**
(`packages/core/src/help/**`, metadata descriptions, their tests); **renderer** (`packages/ui/src/renderer/**`,
component tests); **content** (orchestrator: `docs/*.md`, `guide/**`, skills, screenshot generator).

### Site (D1, D2, D3, FR-026, FR-029, FR-033)

- [x] T055 [P] Failing tests in `packages/ui/tests/unit/guide-template.test.ts`: the header holds brand, then the search slot, then the home page's nav, then the version, in that order (FR-029, D3); a page with `status: outline` refuses the build naming the file (FR-033)
- [x] T056 Make T055 pass in `scripts/guide-template.mjs` and `scripts/guide-build.mjs`: search slot before `<nav`; drop the outline notice; refuse `status: outline`
- [x] T057 [P] Failing tests in `packages/ui/tests/unit/guide-build.test.ts`: callouts — `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]` render as `<aside class="callout callout--…">` with a title and without the marker; a plain blockquote stays a quote (D2, R21)
- [x] T058 Make T057 pass in `scripts/guide-build.mjs`
- [x] T059 Failing tests in `packages/ui/tests/unit/guide-build.test.ts` for the reference split (FR-026, R17): each `##` of a reference builds `/guide/reference/<ref>/<slug>/` holding only that section; the reference URL holds the intro and a list of section links; a link to `docs/<ref>.md#<id>` resolves to the section page holding the id; an id on no page refuses; the nav renders each reference as a `<details>` item, `open` with `aria-current` on its own pages; `theme-settings.md` is a third keyed reference
- [x] T060 Make T059 pass in `scripts/guide-build.mjs`, `scripts/guide-template.mjs`, using `referenceSlug` from core (T063) for section slugs
- [x] T061 Style the header group, the fixed Pagefind results panel (own scroll, content-wide, readable input), the `<details>` nav and the three callout kinds in `site/assets/site.css`; remove `.guide-outline` (D1, D2, FR-029); keep phone width without sideways scroll
- [x] T062 Update `packages/ui/tests/unit/guide-built-anchors.test.ts` and `site-assemble.test.ts` for the section URLs and the third reference

### Core (FR-026, FR-028, FR-013, FR-016)

- [x] T063 [P] Failing tests in `packages/core/tests/unit/help-urls.test.ts`: `referenceSlug` is GitHub's slug; `settingHelpUrl` includes `reference/preferences/<slug(group)>/`; `keyBindingHelpUrl` and `themeTokenHelpUrl` build their section URLs and throw on unknown ids
- [x] T064 Make T063 pass in `packages/core/src/help/help-urls.ts` (+ `help/slug.ts`, `help/index.ts` exports); `scripts/guide-build.mjs`'s `slug` delegates to the same rule
- [x] T065 Extend `packages/ui/tests/unit/description-length.test.ts` to key bindings and theme tokens; failing until T066 (FR-028)
- [x] T066 Cut every setting, key binding and theme token description to ≤ 100 characters in `settings-metadata.ts`, `keybindings-metadata.ts`, `theme-metadata.ts` (keeping what it does and its one essential qualifier); hand the cut detail to the content boundary for the reference sections; empty and delete `description-length-ratchet.json` (FR-013, FR-016, FR-028); update every test asserting an old description string

### Renderer (FR-027, FR-028, FR-017)

- [x] T067 [P] Failing component tests: on a setting row the (?) sits inside the title line after the label (FR-027); every Key Bindings row and every Themes row has a (?) beside its label opening `keyBindingHelpUrl` / `themeTokenHelpUrl` (FR-028); the FR-017 surfaces in research R20 each carry their (?) to the named task
- [x] T068 Make T067 pass: `HelpLink` takes `url` and `label`; move it in `settings-tab.tsx`; add it to `keybindings-tab.tsx`, `themes-tab.tsx`, the panel-type picker, the terminal settings form, the projects list header and Find in Files options; CSS for alignment beside the title

### Content and references (orchestrator)

- [x] T069 Rewrite `docs/key-bindings.md` group tables into one `###` per command (label heading, action id code span, description lead, **Default**, **Scope**, detail), and create `docs/theme-settings.md` (one `##` per theme area, one `###` per token); link it from `docs/preferences.md` § Themes and icon sets, `docs/README.md` and the `throng-docs` table (FR-028, R18)
- [x] T070 Move each description's cut detail into its reference section in `docs/preferences.md`, `docs/key-bindings.md`, `docs/theme-settings.md` (FR-016)
- [x] T071 Extend `docs-currency.test.ts`: every key binding and theme token has its keyed section with its description as lead; every metadata group of the three registries is a `##` in its reference; every task section of a guide page (all pages but `index`, `faq`) has a `**Where:**` line, a "Why you'd use this" line and a numbered list; no page has `status: outline`; every page but `index` and `faq` shows at least one existing `images/<page>/…` screenshot; `docs/theme-settings.md` is in the docs index and counts as a reference change in `scripts/guide-pr-check.mjs` (FR-016, FR-026, FR-028, FR-030, FR-031, FR-033, FR-034)
- [x] T072 Rewrite `.claude/skills/throng-guide/references/style.md` and `SKILL.md` for FR-030: the maintainer's voice, British English, the task layout with **Where:**, GitHub-alert callouts, screenshots; drop the outline section (R21, R22)
- [x] T073 Create `.claude/skills/throng-guide-upkeep/SKILL.md` (FR-032, R25); route to it from `CLAUDE.md` § Documentation and `.claude/skills/README.md`
- [x] T074 Screenshot generator: `packages/ui/tests/guide-screenshots/guide-screenshots.spec.ts`, `packages/ui/playwright.guide-screenshots.config.ts`, `npm run guide:screenshots`; seeds a demo project and writes `guide/images/<page>/<task>.png` in the **throng** theme (FR-023, FR-031, R24)
- [x] T075 Write `guide/projects.md`, `guide/layout.md`, `guide/terminals.md`, `guide/sub-workspaces.md` in full to the T072 layout and voice, with screenshots (FR-004, FR-030, FR-031)
- [x] T076 Write `guide/files.md`, `guide/editing.md`, `guide/finding.md`, `guide/attention.md` in full, with screenshots
- [x] T077 Write `guide/previews.md`, `guide/markdown.md`, `guide/csv-and-spreadsheets.md`, `guide/images-pdfs-svg-html.md` in full, with screenshots
- [x] T078 Write `guide/preferences.md`, `guide/themes-and-icons.md`, `guide/key-bindings.md`, `guide/resources.md`, `guide/troubleshooting.md`, `guide/faq.md` in full; bring `guide/index.md` and `guide/quick-start.md` to the same layout and voice
- [x] T079 Update `GUIDE_MAP` in `packages/core/src/help/guide-map.ts` for any task heading T075–T078 changed; `CHANGELOG.md` Unreleased entries for the split references, the (?) on key bindings and themes, and the screenshots
- [x] T080 Update `docs/releasing.md`/`docs/testing.md` for `npm run guide:screenshots`; run the `throng-docs` audit

## Phase 9 dependencies

T063/T064 before T060 and T068. T066, T069 and T070 land as one commit (the lead-line check goes red between them). T068's audit targets are existing map anchors (R20). T069 before T059's real-file assertions and T071. T072 before T075–T078. T074 before the screenshots in T075–T078. Site, core and renderer boundaries run in parallel with T069/T072–T074.

## Phase 10: Iteration 2 (FR-035 to FR-040)

- [x] T081 Failing tests in `packages/ui/tests/unit/guide-build.test.ts`: a guide image renders inside `<a class="zoom" href="<src>">` (FR-036); then make it pass in `scripts/guide-build.mjs`
- [x] T082 `site/assets/site.css`: the search clear button as a small themed icon button inside the field (FR-035); guide images at full column width; on wide guide pages the navigation fixed below the header with its own scroll and the page scrolling independently, the footer with the page (FR-039); phone width unchanged
- [x] T083 `packages/core/src/help/guide-map.ts` and `guide/index.md`: the start page is titled **Intro** (FR-038); update every test asserting "Start here"
- [x] T084 Screenshot generator: every shot landscape, a panel or pane shot taken with it filling the window (Focus Mode); regenerate `guide/images/**` (FR-037)
- [x] T085 `docs-currency.test.ts`: every guide image is landscape, read from its PNG header, naming any portrait one (FR-037)
- [x] T086 `docs/releasing.md`: how the version reaches each page (FR-040); `throng-guide-upkeep` and `throng-guide` style: the screenshot rules (landscape, full width, enlargeable) and the start page name

## Phase 11: Iteration 3 (FR-041 to FR-044)

- [x] T087 Failing tests in `guide-build.test.ts` for each page's description, Open Graph, Twitter, icons and JSON-LD breadcrumbs (FR-041); then `scripts/guide-template.mjs` and `scripts/guide-build.mjs`
- [x] T088 Failing tests for `sitemap.xml` and the `/sitemap/` page, outside the search index (FR-042); then the builder
- [x] T089 `site/index.html` footer links the sitemap page; `site/llms.txt` links the three references and the sitemap (FR-042, FR-043); `site-files.test.ts`
- [x] T090 Move `guide/` to `site/guide/`; `assembleSite` skips it when copying `site/`, with a test; repoint every link, check, script and skill (FR-044)
- [x] T091 `throng-guide-upkeep` and the `throng-guide` style: a page's opening paragraph is its search description; the sitemap builds itself

## Phase 12: Iteration 4 (FR-045)

- [x] T092 Failing tests in `help-urls.test.ts` and `help-base-url.test.ts`: the guide root by build type, the override in either build (FR-045); then `helpBaseUrlForBuild` in core and `helpBaseUrlFrom(env, packaged, log)` in main
- [x] T093 `docs/environment.md`, MT-02, `throng-guide-upkeep`: a development build opens the local site preview

## Phase 13: Iteration 5 (FR-046)

- [x] T094 Failing `monitor-help-links.test.ts`: the general "?" and every helper open their guide task, at the help link size, with no popover (FR-046); then `helper-targets.ts`, `InfoHelper` and `HelpControl` as `HelpLink`s; delete `help-panel.tsx`, `helper-copy.ts` and the panel CSS; update the tests that knew the popovers and `.monitor-help`
- [x] T095 `site/guide/resources.md`: *Find your way around the Resource Monitor* and *Choose what the list shows*, holding the popovers' words; *Read the figures* gains the Total row; both new tasks in `GUIDE_MAP`; MT-05 steps 8–9
- [x] T096 Remove the guide pages' "This guide describes throng <version>" line and its CSS; the header's version label is the one (FR-047); `guide-template.test.ts`, `docs/releasing.md`

## Phase 14: Iteration 6 — the Help window (FR-048 to FR-052)

- [x] T097 Failing unit tests, then core: `HELP_APP_BASE_URL`, `websiteUrlFor`, `decideHelpNavigation` in `packages/core/src/help/` (FR-049, FR-050, FR-051); remove `helpBaseUrlForBuild` and its tests (FR-045 superseded)
- [x] T098 Failing unit test, then `scripts/site.mjs help --out <dir>`: the guide, its assets and a Pagefind index (Node API, `pagefind@1.3.0` devDependency); `npm run build` runs it into `packages/ui/dist/help` (FR-049)
- [x] T099 Failing unit test, then `packages/ui/src/main/help-protocol.ts`: read-only `throng-help:` handler over the bundle, contained, typed, CSP on every response, the FR-052 page when the bundle is missing
- [x] T100 `packages/ui/src/main/help-window.ts` and its wiring in `main.ts`: one window, `index.html?help=1` plus a sandboxed `WebContentsView` on partition `help`; reuse and bring to front, never on top; session-remembered bounds; navigation per `decideHelpNavigation`; Back/Forward/Open in browser IPC; Alt+Left/Right and mouse buttons (FR-048, FR-050, FR-051)
- [x] T101 Renderer: `openHelp` sends `throng:help:open`; `effectiveHelpBase` returns `HELP_APP_BASE_URL`; preload exposes `openHelp` and the Help window's controls; `help/help-app.tsx` (title bar, Back, Forward, Open in browser icon buttons); retire `THRONG_HELP_BASE_URL` (`help-base-url.ts`, preload `helpBaseUrl`, `docs/environment.md`); update tests that expected `openExternal` for help (FR-048, FR-049)
- [x] T102 One E2E spec: F1 opens a single Help window on the start page; a (?) reuses it (`parallel-plan.json`, `e2e-budget.json`) (FR-048)
- [x] T103 Docs and skills: guide pages and MT-02/MT-03/MT-05 steps say the Help window, not the browser; `throng-guide-upkeep` rule; `docs/architecture.md` names the Help window and its scheme; widen MT-07 Paths

## Phase 15: Iteration 7 (FR-053 to FR-056)

- [x] T104 [P] Failing `help-surfaces.test.ts` case: the Projects pane header has no (?); then remove its `HelpLink` from `packages/ui/src/renderer/sidebar/projects-panel.tsx` (FR-056, supersedes FR-017's project list)
- [x] T105 [P] Failing unit check on `packages/ui/src/renderer/theme.css`: `button.icon-button.help-link .icon` is a fixed size of at most 12px; then the rule (FR-055)
- [x] T106 Failing source guard in `window-parent-tdz.test.ts`; then `closeHelpWindow()` in `help-window.ts`, called on the main window's `closed` in `main.ts` (FR-054)
- [x] T107 `site/assets/site.js`: on load, scroll `.guide-nav` so the current page's entry is in view (FR-053)
- [x] T108 `help-window.e2e.ts`: the navigation shows the last page's entry when that page opens (FR-053), and closing the main window with Help open ends the app (FR-054); re-seed `e2e-budget.json`

## Phase 16: Iteration 8 (FR-057 to FR-063)

- [x] T109 [P] Failing `help-surfaces.test.ts` case, then Find in Files' (?) targets `finding#search-the-whole-project` in `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx` (FR-061)
- [x] T110 Failing unit test on the built guide page, then `scripts/guide-build.mjs` writes `loading="lazy"`, `width` and `height` on every screenshot (FR-060)
- [x] T111 Failing `docs-currency.test.ts` cases: the banned phrases (FR-058), and the new section layout replacing the **Where:**/why check (FR-059, supersedes FR-022/FR-030 lines); update `packages/ui/tests/fixtures/guide/**`; `guide-build.mjs` draws an `<hr>` between sections, none after the last
- [x] T112 Rewrite every `site/guide/*.md` page to FR-059's layout by the `stop-slop` rules (FR-057, FR-059)
- [x] T113 Rewrite `docs/preferences.md`, `docs/key-bindings.md`, `docs/theme-settings.md`: breadcrumbs, `stop-slop` prose, lead paragraphs copied from the in-app descriptions, so it runs after T114 (FR-057, FR-059, FR-016)
- [x] T114 Rewrite the in-app descriptions in `settings-metadata.ts`, `keybindings-metadata.ts`, `theme-metadata.ts`/`theme-copy.ts` by `stop-slop`, still at most 100 characters (FR-057, FR-013)
- [x] T115 `.claude/skills/throng-guide/SKILL.md` and `references/style.md`: the FR-059 layout, pointing at `stop-slop`; `throng-guide-upkeep` names the layout check (FR-057, FR-059)
- [x] T116 `site/assets/site.js` and `site.css`: the Help window's link popover (FR-062)
- [x] T117 Failing unit test, then the `confirmations.openExternalLink` setting (metadata, normalisation, default `true`), its `docs/preferences.md` section with breadcrumb, a guide task in the FR-059 layout and its `GUIDE_MAP` entry, after T111 (FR-063)
- [x] T118 Failing unit test, then `packages/ui/src/main/external-link-prompt.ts` `withExternalLinkPrompt`, wired once where `createAppShellIntegration` builds the shell integration in `main.ts`, so every consumer gets the wrapped one; a source guard fails on a direct `shell.openExternal` outside the seam (FR-063)
- [x] T119 Failing component test, then the prompt: `link-prompt-window.ts`, preload `linkPrompt`, `renderer/link-prompt/link-prompt-app.tsx`, the `?linkPrompt=` route in `main.tsx`; Change in Preferences opens the Confirmations group; `docs/architecture.md` names the prompt window and route (FR-063)
- [x] T120 E2E: the harness seeds the prompt off in every config root it creates (`launchApp` and `runOwnApp`) unless a spec asks for it; `help-window.e2e.ts` checks the popover (FR-062) and the prompt's Cancel and Open (FR-063); re-seed `e2e-budget.json`
- [x] T121 [derived] Tidy FR-061 leftovers: the help-surfaces test title, the comment in `find-in-files-panel.tsx`, `research.md`'s Find in Files row
- [x] T122 [derived] Widen MT-05, MT-06, MT-07 `Paths:` to the files iteration 8 touches

## Phase 17: Iteration 9 (FR-064)

- [x] T123 Failing `preferences-row-reveal.test.ts`, then `packages/ui/src/renderer/preferences/use-reveal-row.ts`: one reveal (unfold group, subgroup, subsection; scroll the row) used by the Settings, Key Bindings and Themes tabs; `preferences-app.tsx` hands the target to whichever tab opens (FR-064, extends 068)
- [x] T124 The link prompt's Change in Preferences opens at `confirmations.openExternalLink` (FR-064, corrects FR-063's derived group target); `docs/preferences.md`, MT-07 step 16
- [x] T125 `throng-config-preferences` names `openPreferences(tab, key)` as the one way to send the user to a setting, binding or theme setting
