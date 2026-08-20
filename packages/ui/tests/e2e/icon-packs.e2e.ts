import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp, settle, createProject, cleanupTemp} from './harness.js';

/**
 * US4 (007 Phase F): icon packs — a pack dropped under icon-packs\ is selectable
 * and re-skins tokens; a per-token override wins; a token missing from the pack
 * falls back to the throng glyph. Uses glyph tokens (no file:// images) so the
 * sandboxed renderer needs no external resources. The pack-format README is seeded.
 */
const cfgRoots: string[] = [];
/** A truly empty config root so the app seeds the bundled packs on first run. */
function bareCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-icons-'));
  cfgRoots.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) cleanupTemp(dir);
});

async function openThemes(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-themes').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('themes-tab')).toBeVisible();
  return prefs;
}

/*
 * TWO TESTS REMOVED (035) — now `packages/ui/tests/component/preferences-themes-tab.test.ts`.
 *
 * Each seeded a pack on disk, launched Electron with THRONG_CONFIG_ROOT, clicked the cog menu,
 * waited for a SECOND WINDOW, waited for it to load, chose the pack from a dropdown — and then read
 * the text of three `<span>`s. The second window is how they REACHED the Themes tab, not what they
 * asserted, and that file already renders the tab and its icon grid.
 *
 * THE MIGRATION FOUND THREE THINGS, in the order it hit them:
 *
 *   - `iconPacks` crosses the bridge as an ARRAY. `toPackMap` returns {} for anything else, so a
 *     map reaches the grid as no packs at all.
 *   - A `LoadedIconPack` needs BOTH `tokens` and `assets`, and `tokens` holds `IconValue` objects
 *     rather than the bare strings a pack.json on disk carries — the loader normalises them.
 *   - An override belongs in `theme.iconOverrides`, not `theme.icons`. Those are rungs 1 and 3 of
 *     the same chain, and a draft that used the wrong one made both override tests pass through the
 *     third rung, with the pack silently beating the override. A green bar for the opposite of the
 *     requirement.
 *
 * And the red step found a fourth: written against the shipped theme, the FALLBACK test could not
 * tell rung 3 (the active theme's glyph) from rung 4 (throng's default), because they are the same
 * character when the active theme is throng's. It now gives the theme a glyph of its own.
 *
 * Four assertions are new: the dropdown offers a way BACK to the default glyphs; deselecting a pack
 * restores them; an override applies with no pack selected; and the override leaves the pack's other
 * tokens alone, which is the three-way precedence rather than a single cell.
 *
 * WHAT STAYS. `:167` — editing the pack in the preferences window re-skins the MAIN window live.
 * Two real windows and an IPC broadcast between them, which one render cannot make. `:253` — a
 * malformed pack.json ON DISK still lets the app start: the loader reading a real file.
 */


test('a fresh install seeds the throng glyph pack + an SVG image pack (H6, FR-040b)', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  const cfgRoot = bareCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      const select = prefs.getByTestId('icon-pack-select');
      // Both bundled packs are discovered + selectable (≥2, incl. throng + throng-svg).
      await expect.poll(() => select.locator('option[value="throng"]').count()).toBe(1);
      await expect.poll(() => select.locator('option[value="throng-svg"]').count()).toBe(1);
      // The throng glyph pack is selected by default (FR-040b).
      await expect(select).toHaveValue('throng');
      // Its files are on disk under icon-packs/.
      expect(existsSync(join(cfgRoot, 'icon-packs', 'throng', 'pack.json'))).toBe(true);
      expect(existsSync(join(cfgRoot, 'icon-packs', 'throng-svg', 'folder.svg'))).toBe(true);

      /*
       * 017 / #54 — this assertion used to pin `<img src="file://…/throng-svg/folder.svg">`.
       *
       * That rendering IS the bug. An SVG inside an `<img>` is an isolated document, so its
       * `stroke="currentColor"` resolved against the image's own black default instead of the
       * page's theme colour — which is why the SVG pack was black-on-dark and unusable. The pack
       * icon is now INLINED, so `currentColor` binds to the theme.
       *
       * The old test is rewritten, not preserved. A test that asserts the defect is not coverage
       * worth keeping — and honouring "no existing test may change" here would have forced the
       * `<img>` to stay and defeated the fix.
       */
      await select.selectOption('throng-svg');
      const svg = prefs.getByTestId('icon-cell-folder').locator('svg');
      await expect(svg).toBeVisible();
      // Inline, in the page's own document — so it can inherit the theme's colour.
      await expect(svg).toHaveAttribute('stroke', 'currentColor');
      await expect(prefs.getByTestId('icon-cell-folder').locator('img')).toHaveCount(0);
      const box = await svg.boundingBox();
      expect(box).not.toBeNull();
      expect(Math.round(box!.width)).toBe(24);
      expect(Math.round(box!.height)).toBe(24);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/*
 * MOVED to `packages/ui/tests/unit/icon-pack-seeding.test.ts` (034 FR-045): "the pack-format README
 * is seeded under icon-packs/" (FR-040a).
 *
 * It launched Electron, opened the Preferences window through the cog menu and waited for the Themes
 * tab — in order to assert `existsSync(join(cfgRoot, 'icon-packs', 'README.md'))`. The window was
 * not the mechanism either: `ensureReadme()` runs on the main-process startup path (main.ts:694),
 * long before a preferences window exists, so opening one was a way of WAITING rather than a way of
 * testing. The README is a file that a method with a directory argument writes.
 *
 * THE REPLACEMENT CARRIES BOTH HALVES (FR-047) and goes further than the E2E on each:
 *   1. the method writes it — and the README is asserted to DOCUMENT the manifest the loader
 *      actually parses (`pack.json`, `tokens`, `.svg`), not merely to exist. A README that exists
 *      and says nothing useful is the failure this requirement is about.
 *   2. a SECOND call never overwrites a user’s edit — a branch no automated run had ever taken,
 *      because a fresh temp config root is by definition a first run.
 *   3. startup CALLS it, into the config root’s own `icon-packs/` — a source guard over main.ts,
 *      the same shape as `tests/unit/icon-call-sites.test.ts`, because no temp directory can report
 *      the presence of a call in another module.
 *
 * WHAT STAYS BELOW: that a fresh install’s bundled packs are selectable and draw at the theme’s
 * measured 24px box (FR-049 — real layout), that a selected pack re-skins the MAIN window live with
 * no restart, that pack art takes its colour from the theme rather than rendering black (an SVG
 * inside an <img> is an isolated document — that is the bug, and it needs real style resolution),
 * that a user pack re-skins its tokens with the missing ones falling back, that a single-token
 * override wins, and that a broken pack degrades without stopping the app.
 *
 * Anti-vacuity control: making `ensureReadme()` a no-op fails the three behavioural tests. The other
 * two are independent BY DESIGN and each has its own mutation — the fixture precondition (which no
 * production change can redden, and which is what stops the other three passing for free) and the
 * main.ts source guard (reddened by removing the call). Red-proved as three separate mutations.
 */

/**
 * 017 / #54 — the assertions that were MISSING, and whose absence is why the bug shipped.
 *
 * Every pre-017 test in this file exercised the Preferences → Icons grid and nothing else. The grid
 * was the one place a pack was honoured, so the suite was green while the setting did nothing
 * whatsoever in the application the user was actually looking at. These tests assert the MAIN
 * WINDOW.
 */
test('selecting a pack changes the icons in the MAIN WINDOW, live, with no restart (FR-001/005)', { tag: ['@extended', '@prefs'] }, async () => {
  const cfgRoot = bareCfgRoot();
  await runApp(
    async (app, win) => {
      await settle(win);
      await createProject(win, 'Icons', 'C:/c/icons'); // an empty shell has no icon controls to inspect

      // The default `throng` pack is a glyph pack, so nothing in the chrome is an inline SVG yet.
      await expect(win.locator('.icon > svg')).toHaveCount(0);
      const glyphsBefore = await win.locator('.icon').count();
      expect(glyphsBefore).toBeGreaterThan(0);

      const prefs = await openThemes(app, win);
      await prefs.getByTestId('icon-pack-select').selectOption('throng-svg');

      // The MAIN window re-skins itself — no restart, no reopening a panel. Before 017 this count
      // stayed at zero forever, which was the entire bug.
      await expect(win.locator('.icon > svg').first()).toBeVisible();
      expect(await win.locator('.icon > svg').count()).toBeGreaterThan(0);

      // Reverting restores the glyphs, also live.
      await prefs.getByTestId('icon-pack-select').selectOption('throng');
      await expect(win.locator('.icon > svg')).toHaveCount(0);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('pack icons take their colour from the THEME, not a fixed black (FR-004)', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  const cfgRoot = bareCfgRoot();
  await runApp(
    async (app, win) => {
      await settle(win);
      await createProject(win, 'Icons', 'C:/c/icons');
      const prefs = await openThemes(app, win);
      await prefs.getByTestId('icon-pack-select').selectOption('throng-svg');

      const svg = win.locator('.icon > svg').first();
      await expect(svg).toBeVisible();

      /*
       * `stroke="currentColor"` is the whole mechanism. Inside an <img> it resolved against the
       * image's own document (black); inlined, it resolves against the page — so the icon is
       * whatever colour the theme's text is. The computed stroke must therefore NOT be black,
       * because the default theme's text is not black.
       */
      await expect(svg).toHaveAttribute('stroke', 'currentColor');
      const stroke = await svg.evaluate((el) => getComputedStyle(el).stroke);
      expect(stroke).not.toBe('rgb(0, 0, 0)');
      expect(stroke).toBeTruthy();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/*
 * MOVED to `packages/ui/tests/component/icon.test.ts` (034 FR-045): "icons are DECORATIVE to
 * assistive technology (FR-006c / SC-010)".
 *
 * It launched Electron, created a project, then swept the whole window for `.icon` and required
 * every one to carry `aria-hidden="true"`. A sweep of a real DOM is the only way to make an app-wide
 * claim — unless the claim reduces, and this one does, into two halves that are each cheaper AND
 * stronger than the sweep:
 *
 *   1. `<Icon>` marks what it draws as decorative — now asserted by RENDERING it, on the fallback
 *      branch as well as the ordinary one, where an attribute is likeliest to be forgotten. The
 *      sweep could only ever see whichever branch the running theme happened to take.
 *   2. Nothing else in the renderer draws an icon — already a source guard,
 *      `tests/unit/icon-call-sites.test.ts`, which fails the build if any renderer module reaches
 *      for the deleted `resolveIcon`. That is a stronger statement than the sweep made, because a
 *      sweep only sees the icons that were ON SCREEN in one window at one moment.
 *
 * The decorativeness half of that guard was a grep of the component's SOURCE for the string
 * `aria-hidden`, which would pass on a file that merely mentioned it in a comment. It now names the
 * render test instead of pretending to be one.
 *
 * Red-proved: removing `aria-hidden` from the glyph branch reddens 2; dropping the base `icon`
 * class when a custom one is given reddens 1 — which is the mutation that would have made the old
 * sweep silently find fewer icons and still pass.
 *
 * WHAT STAYS BELOW: that a selected pack re-skins the MAIN window live with no restart, that pack
 * art takes its colour from the theme rather than rendering black (an SVG inside an `<img>` is an
 * isolated document — that is the bug, and it needs real style resolution to see), that a fresh
 * install seeds the packs and the README, and that a broken pack degrades without stopping the app.
 */

test('a BROKEN pack degrades: the app starts, icons fall back, and the picker says why (FR-004a / SC-011)', { tag: ['@extended', '@prefs'] }, async () => {
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-icons-'));
  cfgRoots.push(cfgRoot);
  // A pack directory whose manifest is unreadable. Silently dropping it would recreate the exact
  // confusion this feature exists to remove: a setting that appears to do nothing.
  const brokenDir = join(cfgRoot, 'icon-packs', 'brokenpack');
  mkdirSync(brokenDir, { recursive: true });
  writeFileSync(join(brokenDir, 'pack.json'), '{ this is not json', 'utf8');

  await runApp(
    async (app, win) => {
      // 1. The app STARTS. A broken pack must never be fatal.
      await settle(win);
      await createProject(win, 'Icons', 'C:/c/icons');

      // 2. Icons still render — they fall back to the theme's glyphs rather than leaving holes.
      expect(await win.locator('.icon').count()).toBeGreaterThan(0);

      // 3. The picker shows the pack as unavailable, WITH the reason — it does not vanish.
      const prefs = await openThemes(app, win);
      const option = prefs.getByTestId('icon-pack-option-brokenpack');
      await expect(option).toHaveCount(1);
      await expect(option).toBeDisabled();
      await expect(option).toHaveAttribute('title', /pack\.json/i);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
