import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { openApp, createProject, settle, cleanupTemp, type AppOptions, type OpenApp } from './harness.js';
import {
  configRootSeeded,
  restoreConfigRoot,
  snapshotConfigRoot,
  type ConfigRootSnapshot,
} from './helpers/config-snapshot.js';

// FR-030 (#5/#7/#8/#9): per-section font roles apply to the right elements,
// baseSizePx rescales unset roles, and theme icons hot-reload in menus.

const writeTheme = (cfg: string, theme: object): void =>
  writeFileSync(join(cfg, 'themes', 'throng.json'), JSON.stringify({ name: 'throng', ...theme }, null, 2), 'utf8');

const fontSize = (win: Page, selector: string): Promise<string> =>
  win.evaluate((s) => getComputedStyle(document.querySelector(s)!).fontSize, selector);


/*
 * ONE app for this file, not one per test (034 FR-045, SC-010) — 5 launches -> 1.
 *
 * Nothing here is seeded before launch: every theme document is written THROUGH the running app and
 * hot-reloaded, which is the mechanism these tests are about. The per-test config root was only ever
 * write isolation, and `restoreConfigRoot` provides that between tests without a second process.
 *
 * `cleanupTemp` moved from each test's `finally` to `afterAll` deliberately: with one app for the
 * file, a per-test cleanup would delete the config root out from under a LIVE application, and the
 * failure would surface later, somewhere else, as an app that had lost its state.
 *
 * The shim below REFUSES launch options rather than ignoring them.
 *
 * Serial mode is not optional — one window and one config root, so a failure SKIPS the rest rather
 * than running them against what it left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let cfg: string;
let baseline: ConfigRootSnapshot;

test.beforeAll(async () => {
  cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: cfg } });
  await settle(shared.win);
  // Only once first-run seeding has finished — settings, key bindings and every shipped theme.
  // `writeTheme` writes into `<cfg>/themes/`, which is a directory the APP creates on first run.
  await expect.poll(() => configRootSeeded(cfg), { timeout: 30_000 }).toBe(true);
  baseline = snapshotConfigRoot(cfg);
});

test.afterEach(() => {
  restoreConfigRoot(baseline);
});

test.afterAll(async () => {
  await shared?.close();
  cleanupTemp(cfg);
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

test('baseSizePx rescales tab/panel/inner text; pinned roles stay; per-role override works', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  await runApp(
    async (_app, win) => {
      await createProject(win, 'Fonts', 'C:/c/fonts'); // gives a tab + a panel

      // baseSizePx 13 → 22: tab/panel/inner track it; pane title stays 11px.
      writeTheme(cfg, { fonts: { family: "'Segoe UI', sans-serif", baseSizePx: 22, weights: { normal: 400, bold: 600 } } });
      await expect.poll(() => fontSize(win, '.tab-chip__label'), { timeout: 8000 }).toBe('22px');
      expect(await fontSize(win, '.panel-box__title')).toBe('22px');
      // A default (untyped) panel now shows the type-selection form in its body;
      // the form text uses the same paneText font role the old placeholder did.
      expect(await fontSize(win, '.panel-type-form')).toBe('22px');
      expect(await fontSize(win, '.panel__title')).toBe('11px'); // pinned paneTitle

      // Per-role override: paneTitle 11 → 18.
      writeTheme(cfg, { typography: { paneTitle: { sizePx: 18 } } });
      await expect.poll(() => fontSize(win, '.panel__title'), { timeout: 8000 }).toBe('18px');
    },
  );
});

test('project name and path use separate font roles (#5)', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  await runApp(
    async (_app, win) => {
      await createProject(win, 'Roomy', 'C:/c/roomy');
      writeTheme(cfg, {
        typography: { projectName: { sizePx: 17 }, projectPath: { sizePx: 9 } },
      });
      await expect.poll(() => fontSize(win, '.project-item__name'), { timeout: 8000 }).toBe('17px');
      expect(await fontSize(win, '.project-item__path-text')).toBe('9px');
    },
  );
});

test('per-section case / italic / underline + family override apply', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  await runApp(
    async (_app, win) => {
      await createProject(win, 'Type', 'C:/c/type'); // a tab + a panel exist

      writeTheme(cfg, {
        typography: {
          tab: { case: 'lower', italic: true, underline: true, family: 'Courier New' },
          panel: { family: '   ' }, // blank → falls back to the base family
        },
      });

      const tabStyle = () =>
        win.evaluate(() => {
          const s = getComputedStyle(document.querySelector('.tab-chip__label')!);
          return { transform: s.textTransform, style: s.fontStyle, decoration: s.textDecorationLine, family: s.fontFamily };
        });
      await expect.poll(async () => (await tabStyle()).transform, { timeout: 8000 }).toBe('lowercase');
      const tab = await tabStyle();
      expect(tab.style).toBe('italic');
      expect(tab.decoration).toContain('underline');
      expect(tab.family).toContain('Courier New');

      // Blank family on the panel role → the base family (#6).
      const panelFamily = await win.evaluate(
        () => getComputedStyle(document.querySelector('.panel-box__title')!).fontFamily,
      );
      expect(panelFamily).toContain('Segoe UI');
    },
  );
});

test('top-level fonts case/italic/underline apply app-wide and roles inherit', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  await runApp(
    async (_app, win) => {
      await createProject(win, 'Base', 'C:/c/base'); // a tab exists
      writeTheme(cfg, {
        fonts: {
          family: "'Segoe UI', sans-serif",
          baseSizePx: 13,
          weights: { normal: 400, bold: 600 },
          case: 'upper',
          italic: true,
        },
      });
      // Body picks up the base transform; a role without its own case inherits it.
      await expect
        .poll(() => win.evaluate(() => getComputedStyle(document.body).textTransform), { timeout: 8000 })
        .toBe('uppercase');
      const tab = await win.evaluate(() => {
        const s = getComputedStyle(document.querySelector('.tab-chip__label')!);
        return { transform: s.textTransform, style: s.fontStyle };
      });
      expect(tab.transform).toBe('uppercase');
      expect(tab.style).toBe('italic');
    },
  );
});

test('theme icons hot-reload in context menus (#9)', { tag: ['@extended', '@prefs', '@reserve:runtime'] }, async () => {
  await runApp(
    async (_app, win) => {
      await createProject(win, 'Icons', 'C:/c/icons');
      // Send to Tab is on every panel's menu, an empty one included (048 removed panel Rename).
      // 069: an icon is svg from the theme\'s selected icon SET. Make a user set whose `send` art is a
      // distinctive path, then select it by hot-reloading the theme (a set is read once, not watched).
      const setName = 'HotSwap';
      const marker = 'M2 3L5 10z';
      const created = await win.evaluate(
        async (n) => {
          const w = window as unknown as { throng: { iconSets: Record<string, (...a: unknown[]) => Promise<{ ok: boolean }>> } };
          const a = await w.throng.iconSets.create(n, 'throng');
          const b = await w.throng.iconSets.override(n, 'send', false);
          return a.ok && b.ok;
        },
        setName,
      );
      expect(created, 'the user icon set could not be created through the bridge').toBe(true);
      writeFileSync(
        join(cfg, 'icon-packs', setName, 'send.svg'),
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${marker}" fill="none" stroke="currentColor"/></svg>`,
        'utf8',
      );
      const reloaded = await win.evaluate(
        async (n) =>
          (await (window as unknown as { throng: { iconSets: { reload: (s: string) => Promise<{ ok: boolean }> } } }).throng.iconSets.reload(n)).ok,
        setName,
      );
      expect(reloaded, 'the user icon set could not be reloaded').toBe(true);
      writeTheme(cfg, { iconPack: setName });
      const panelId = await win
        .locator('.panel-box')
        .first()
        .evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
      const handle = win.getByTestId(`panel-handle-${panelId}`);
      const icon = win.getByTestId('menu-item-Send to Tab').locator('.context-menu__icon');
      /*
       * The hot-reload lands in the renderer's config context, not on disk, so there is nothing
       * file-based to poll — and the icon only exists inside a menu that is not open yet. Poll the
       * real behaviour under test instead: open the menu, read the glyph, close it (Escape, so the
       * next attempt reopens fresh) and try again. This is strictly the assertion the sleep was
       * standing in for, just retried until the hot-reload has actually landed.
       */
      await expect
        .poll(
          async () => {
            await handle.click({ button: 'right' });
            const markup = await icon.locator('svg').innerHTML({ timeout: 1000 }).catch(() => null);
            await win.keyboard.press('Escape');
            return markup?.includes(marker) ?? false;
          },
          { timeout: 8000, message: 'the selected icon set never hot-reloaded into the menu' },
        )
        .toBe(true);
      // The icon is svg only — no glyph text beside it (069 FR-009).
      await handle.click({ button: 'right' });
      expect(((await icon.textContent()) ?? '').trim()).toBe('');
      await win.keyboard.press('Escape');
    },
  );
});
