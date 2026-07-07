import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { runApp, createProject } from './harness.js';

// FR-030 (#5/#7/#8/#9): per-section font roles apply to the right elements,
// baseSizePx rescales unset roles, and theme icons hot-reload in menus.

const writeTheme = (cfg: string, theme: object): void =>
  writeFileSync(join(cfg, 'themes', 'throng.json'), JSON.stringify({ name: 'throng', ...theme }, null, 2), 'utf8');

const fontSize = (win: Page, selector: string): Promise<string> =>
  win.evaluate((s) => getComputedStyle(document.querySelector(s)!).fontSize, selector);

test('baseSizePx rescales tab/panel/inner text; pinned roles stay; per-role override works', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
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
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});

test('project name and path use separate font roles (#5)', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Roomy', 'C:/c/roomy');
        writeTheme(cfg, {
          typography: { projectName: { sizePx: 17 }, projectPath: { sizePx: 9 } },
        });
        await expect.poll(() => fontSize(win, '.project-item__name'), { timeout: 8000 }).toBe('17px');
        expect(await fontSize(win, '.project-item__path-text')).toBe('9px');
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});

test('per-section case / italic / underline + family override apply', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
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
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});

test('top-level fonts case/italic/underline apply app-wide and roles inherit', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
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
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});

test('theme icons hot-reload in context menus (#9)', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Icons', 'C:/c/icons');
        writeTheme(cfg, { icons: { rename: '✗' } });
        // Give the hot-reload a beat, then open the panel menu and check the glyph.
        await win.waitForTimeout(500);
        const panelId = await win
          .locator('.panel-box')
          .first()
          .evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
        await win.getByTestId(`panel-handle-${panelId}`).click({ button: 'right' });
        await expect(win.getByTestId('menu-item-Rename').locator('.context-menu__icon')).toHaveText('✗');
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});
