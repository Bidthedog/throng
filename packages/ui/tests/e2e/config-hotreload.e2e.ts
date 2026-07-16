import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runApp, createProject, panelIds, commitPanelRename } from './harness.js';

// US8 / FR-030/031/033: user config (settings + theme) is read at startup and
// hot-reloaded when the JSON files change — so edits apply without a restart, and
// also after a restart.

const accentVar = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--throng-colour-accent').trim();

test('hot-reloads the theme when themes/throng.json changes (no restart)', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    await runApp(
      async (_app, win) => {
        // Default throng accent applied first.
        await expect.poll(() => win.evaluate(accentVar)).toBe('#6aa3ff');

        // Edit the theme file → the running app picks it up (hot-reload).
        writeFileSync(
          join(cfg, 'themes', 'throng.json'),
          JSON.stringify({ name: 'throng', colours: { accent: '#ff00ff' } }, null, 2),
          'utf8',
        );
        await expect.poll(() => win.evaluate(accentVar), { timeout: 8000 }).toBe('#ff00ff');
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});

test('themes the whole app — base text colour hot-reloads from the theme file', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    await runApp(
      async (_app, win) => {
        const bodyColour = () => win.evaluate(() => getComputedStyle(document.body).color);
        await expect.poll(bodyColour).not.toBe(''); // themed

        writeFileSync(
          join(cfg, 'themes', 'throng.json'),
          JSON.stringify({ name: 'throng', colours: { text: '#abcdef' } }, null, 2),
          'utf8',
        );
        // #abcdef === rgb(171, 205, 239) — the app body text re-themes live.
        await expect.poll(bodyColour, { timeout: 8000 }).toBe('rgb(171, 205, 239)');
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});

test('applies a hand-edited settings.json on startup (confirmations level)', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    // Pre-seed settings BEFORE launch: destroying a panel needs no confirmation.
    mkdirSync(cfg, { recursive: true });
    writeFileSync(
      join(cfg, 'settings.json'),
      JSON.stringify({ confirmations: { destroyPanel: 'none' } }, null, 2),
      'utf8',
    );

    await runApp(
      async (_app, win) => {
        await createProject(win, 'NoConfirm', 'C:/c/noconfirm');
        const a = (await panelIds(win))[0];
        await win.getByTestId(`panel-add-${a}`).click();
        await commitPanelRename(win);
        await expect(win.locator('.panel-box')).toHaveCount(2);

        const [first] = await panelIds(win);
        await win.getByTestId(`panel-close-${first}`).click();
        // destroyPanel level is "none" → removed immediately, no dialog.
        await expect(win.getByTestId('confirm-dialog')).toHaveCount(0);
        await expect(win.locator('.panel-box')).toHaveCount(1);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});
