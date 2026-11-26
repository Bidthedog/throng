# Quickstart: validating stage 1

**Feature**: [spec.md](spec.md) · **Contracts**: [contracts/](contracts/)

## Prerequisites

The worktree bootstrapped (`node_modules` present). No network needed except for the last step.

## 1. The checks

```bash
npx vitest run --project unit packages/ui/tests/unit/docs-currency.test.ts
npx vitest run --project unit packages/ui/tests/unit/guide-*.test.ts packages/ui/tests/unit/site-assemble.test.ts
npx vitest run --project unit packages/core/tests/unit/help-urls.test.ts packages/core/tests/unit/guide-map.test.ts packages/core/tests/unit/release-notes.test.ts
```

Expected: green. Each check in [contracts/guide-map.md](contracts/guide-map.md) has a failing-case test
beside its passing one.

## 2. Build and look at the guide

```bash
npm run site:preview            # builds site/ plus the guide, serves http://127.0.0.1:8080/
```

- `/` shows a **Guide** link in the nav and a version label.
- `/guide/` introduces throng, links each main feature and **Quick start** (US1 AC2).
- Every page has the home page's header, footer and fonts (US1 AC5), and the version line.
- Typing `split` in the search field lists sections; choosing one opens it (US1 AC6). Pagefind's index
  exists only in a real assemble, so the preview command runs Pagefind when it is installed and says so
  when it is not.
- `/guide/reference/preferences/#window.nativeWayland` scrolls to that setting.

## 3. Help from the app

Start throng with `THRONG_HELP_BASE_URL=http://127.0.0.1:8080/guide/`.

- Cog menu → **Help**, and F1 in an editor, File Explorer, the Projects pane, a sub-workspace window,
  Preferences and the Resource Monitor: the browser opens `/guide/` (US2 AC1–AC3).
- F1 in a terminal running `mc`: `mc` shows its help, no browser opens (US2 AC4).
- Preferences → Settings: each row has a (?) after its description; it opens that setting's section
  (US3 AC2), and follows the theme and icon set (US3 AC4).

## 4. The PR and release checks

- Add a setting with no `docs/preferences.md` section → `docs-currency.test.ts` fails naming it.
- `node scripts/guide-pr-check.mjs` with a fixture diff touching `packages/core/src` and a body without the
  marker → exits non-zero naming the files; with the marker → exits 0.
- A CHANGELOG fixture whose `### Added` entry has no guide link → `release-notes` refuses, naming the entry.

## 5. Deploy (after the first release that contains stage 1)

`gh workflow run pages.yml --ref master` → the run's log names the tag it built; every page shows that
version (SC-006).

## Iteration 1

- `npm run site:preview` with Pagefind installed: the header matches the home page; typing in search opens a results panel below the header; expand **Preferences reference** and open a section page.
- `npm run guide:screenshots` (after `npm run build`, no throng running from the worktree): refreshes `guide/images/**`.
- `npx vitest run --project unit packages/ui/tests/unit/docs-currency.test.ts packages/ui/tests/unit/description-length.test.ts packages/ui/tests/unit/site-assemble.test.ts`: the layout, outline, length and section checks.
