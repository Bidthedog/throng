# Quickstart: Validating Feature 017

**Feature**: 017 | **Date**: 2026-07-12

How to prove the three defects are fixed — by machine, then by hand.

## Prerequisites

```bash
npm install          # if the worktree is fresh
npm run build        # REQUIRED before E2E: the suite launches packages/ui/dist/main/main.js
```

## The gates

```bash
npm run lint         # must be ZERO errors (constitution v3.13.0 — a lint error is a build failure)
npm run typecheck
npm test             # unit + integration + contract
npm run test:e2e     # Playwright-Electron — gated by failOnFlakyTests in playwright.config.ts
```

## Proving each fix

### #66 — the flake is actually gone (do this first)

A single pass proves nothing about a flake; the whole point is that it passes *sometimes*. Run it
repeatedly with **retries off**, so nothing can absorb a failure:

```bash
# 20 consecutive runs, retries disabled (SC-004). Any single failure = not fixed.
for i in $(seq 1 20); do
  THRONG_E2E_RETRIES=0 npx playwright test panes.e2e.ts || { echo "FAILED on run $i"; break; }
done
```

Then prove the **gate** works — that a flake can no longer buy a green bar (SC-007). Follow **T006**:
add a throwaway probe spec that fails on its first attempt and passes on retry, run the suite, and
confirm it exits **non-zero** instead of reporting "flaky" and exiting 0. Delete the probe afterwards.

```bash
npm run test:e2e; echo "exit=$?"    # MUST be non-zero while the probe exists
```

The gate lives in `playwright.config.ts` (`failOnFlakyTests: true`), not in the npm script — so it
also covers `npm run test:e2e:admin` and any bare `npx playwright test`, both of which bypass the
script entirely.

### #54 — icon packs

```bash
npx vitest run --project unit packages/core/tests/unit/svg-sanitise.test.ts   # sanitiser
npx vitest run --project unit packages/ui/tests/unit/icon-call-sites.test.ts  # no call site bypasses <Icon>
npx playwright test icon-packs.e2e.ts
```

The **source guard** is the one that matters most: it scans the whole renderer directory, so it fails
if *any* file still reaches for `resolveIcon` — including one nobody remembered.

### #57 — tooltips

```bash
npx playwright test panel-tooltips.e2e.ts
```

## By hand, in the real app

```bash
npm start
```

1. **Icons change the app, not just a grid.** Open **Preferences → Themes → Icons**, switch the icon
   pack from `throng` to `throng-svg`. The file-explorer icons, panel headers, tab chrome, toolbar
   buttons and context menus should **all** change — with no restart. *(Before this feature: nothing
   outside the Preferences grid changed at all.)*
2. **Icons follow the theme.** With `throng-svg` selected, switch between a dark theme and **Light**.
   The icons must remain legible in both — they take the theme's colour. *(Before: fixed black,
   invisible on dark.)*
3. **A broken pack tells you.** Close the app. Delete
   `%USERPROFILE%\.throng\icon-packs\throng-svg\pack.json`. Relaunch. The app must **start normally**,
   icons must fall back to the theme's glyphs, and **Preferences → Themes → Icons** must show
   `throng-svg` as **unavailable, with a reason** — not fail silently.
4. **Read a truncated panel title.** Rename a panel to something long enough to be cut off with an
   ellipsis. Hover its header: you should see **the full title**, not
   `Click: Activate · Drag: Move · …`. Right-click still offers the actions.
5. **Same for a tab.** Hover a tab: its full title.

## What "done" looks like

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` all green
- E2E green means **every test passed on its first attempt** — `failOnFlakyTests: true` in
  `playwright.config.ts` guarantees it at *every* entry point, including `test:e2e:admin` and a bare
  `npx playwright test`, both of which bypass the npm script
- `specs/017-icon-tooltip-flake-fixes/e2e-audit.md` lists every sleep deliberately left in the suite,
  with its justification (FR-013a: what was not fixed must be visible)
- **"What are we not testing?"** — one command answers it. This is the whole point of FR-013b:
  ```bash
  THRONG_E2E_INCLUDE_QUARANTINE=1 npx playwright test --grep @quarantine --list
  ```
  (A bare `--grep @quarantine` lists nothing: a CLI `--grep` does not clear a config `grepInvert`.)
