---
name: throng-guide-upkeep
description: Keep throng's help current as the product changes — the user guide, the guide map, the three reference pages, the one-line descriptions and the (?) links. USE THIS EVERY TIME a change adds, changes, renames or removes anything a user can see — a setting, key binding, command, menu item, panel type, preview type, theme setting (token), icon, dialog or workflow — before the pull request is opened, and when CI fails "No user-facing change", a description-length check, a guide-coverage check or a release-notes guide-link refusal. It says WHAT must change in the same pull request; throng-guide says how to write guide pages and throng-docs owns the reference pages. Not for spec artifacts.
---

# Keeping the help current

Help that lags the product is worse than none: it tells the user something false with confidence. So
every user-visible change carries its help in the **same pull request**, and the checks below refuse
one that does not (080 FR-018, FR-019, FR-032).

## What each change needs

| The change | In the same pull request |
|---|---|
| **New setting** | ≤ 100-character `description` in `settings-metadata.ts`; a `###` section in `docs/preferences.md` under its group's `##` (heading = label, key code span, the description as lead, **Default**/**Values**, then the detail); the task that teaches it links it |
| **New command / key binding** | ≤ 100-character description in `keybindings-metadata.ts`; its `###` in `docs/key-bindings.md` under its group; its id in a `GUIDE_MAP` task's `commands` (or `GUIDE_EXCLUSIONS` with a reason) |
| **New theme setting (token)** | ≤ 100-character description in `theme-metadata.ts`; its `###` in `docs/theme-settings.md` under its area |
| **New panel or preview type** | A task (or tasks) on the page for that area; the type in the task's `panelTypes` / `previewTypes` |
| **New feature or workflow** | A task section on the right page (or a new page in `GUIDE_PAGES` and `site/guide/`), a map entry with the same heading, a screenshot if it teaches part of the window |
| **Changed behaviour** | The task's steps, its screenshot (re-run the generator), its reference section; "Changed in <version>: …" only when users must relearn it |
| **Renamed control, menu item or chord** | Every step and breadcrumb naming it (`git grep -n "<old>" -- guide docs`) |
| **Removed anything** | Its reference section, its map coverage, the steps that use it; a task heading that dies is removed from `GUIDE_MAP` too, and anything linking its anchor is repointed |
| **New metadata group or theme area** | A `##` of exactly that text in its reference — the (?) URLs are built from it |
| **Any `### Added` / `### Changed` CHANGELOG entry** | A link to its guide task, `https://throng-ide.com/guide/<page>/#<anchor>` |
| **Nothing a user can see** | The PR body line `No user-facing change: <reason>` |

How to write the guide text, the layout and the screenshots: **throng-guide**. Reference-page house
style and the docs audit: **throng-docs**. Setting, binding and token mechanics: **throng-config-preferences**.

## Rules that hold for every change

- **Screenshots are landscape and fill the page column**, a panel shot taken with the panel in Focus Mode, never a
  tall crop; every one enlarges in the home page's modal by itself. How to take them: **throng-guide**,
  `references/style.md` § *Screenshots*. A change to a pictured surface re-runs the generator in the same PR; `npm run guide:screens-stale -- --since
  origin/master` names the images it affects (`site/guide/images/screens.json`).
- **The start page is "Intro"** (`GUIDE_PAGES` in `guide-map.ts` and `site/guide/index.md`'s front matter, together).
- **One header on every page**: the home page's, lifted at build time; the nav stays where the home page puts it,
  search to its left on guide pages. Change `site/index.html`'s header and every page follows; never fork it.
- **The page list stays put** and scrolls on its own beside the page; the footer belongs to the page column. Keep
  both when changing the guide's layout (`scripts/guide-template.mjs`, `site/assets/site.css`).
- **The version is never written by hand**: the deployment stamps the release tag into every page
  (`docs/releasing.md`, *How the version reaches each page*).
- **A page's opening paragraph is its search description** (the first 160 characters, cut at a word): make it say
  what the page is for. `sitemap.xml`, the `/sitemap/` page, the canonical, link-preview and breadcrumb tags are
  built from the pages; never edit them by hand. `site/llms.txt` is hand-written: update it when a reference or a
  top-level page is added or removed.
- **The guide's source is `site/guide/`**; the build renders it and never serves the Markdown.
- **Every "?" in the app is a `HelpLink`** to a guide task or reference entry, at its one size (`help-link`),
  opening throng's Help window: no popover of explanation, except Print Preview's placeholder list (`HelpTip`). A new
  "?" gets its words into the guide and a `GUIDE_MAP` task first.
- **Help shows the guide shipped with the build**, in throng's one Help window: `npm run build` builds `site/guide/`
  and the references into `packages/ui/dist/help` (`scripts/help-build.mjs`, with search), served read-only by the
  `throng-help:` scheme. So a guide change reaches Help in the same build, with no network; a page renamed or moved
  must still land every (?) (`guide-built-anchors.test.ts`). Links that leave the guide open the OS browser.

## The checks that hold it

Run before pushing: `npx vitest run --project unit packages/ui/tests/unit/docs-currency.test.ts
packages/ui/tests/unit/description-length.test.ts packages/ui/tests/unit/guide-built-anchors.test.ts`.

| Check | Fails when |
|---|---|
| `description-length.test.ts` | A setting, command or theme-setting description exceeds 100 characters |
| `docs-currency.test.ts` | Something has no reference section or guide coverage; a lead line differs from its metadata; a task breaks the layout; a page is an outline, has no screenshot, or has a portrait one |
| `guide-built-anchors.test.ts` | A (?) or Help URL lands on no id in the built site |
| `scripts/guide-pr-check.mjs` (CI verdict) | Source changed with no guide or reference change and no marker line |
| `release-notes.mjs --guide-links` (release) | An Added or Changed entry links no guide task |
