import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openApp,
  runApp as runOwnApp,
  createProject,
  panelIds,
  commitPanelRename,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

// US8 / FR-030/031/033: user config (settings + theme) is read at startup and
// hot-reloaded when the JSON files change — so edits apply without a restart, and
// also after a restart.

const accentVar = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--throng-colour-accent').trim();

/*
 * ONE app for the first two tests (034 FR-045, SC-027) — 3 launches -> 2.
 *
 * Test 3 keeps `runOwnApp` and genuinely has to: it writes `confirmations.destroyPanel = none`
 * into settings.json BEFORE the app starts (:64) and hands the app that root. An app that has
 * already read its settings cannot show what a different document does at STARTUP.
 *
 * Tests 1 and 2 are the opposite case, and the distinction is the whole of this conversion:
 * they write `themes/throng.json` THROUGH the running app and poll for the hot-reload. That is
 * the behaviour under test, not a precondition of it.
 *
 * DECLARATION ORDER IS LOAD-BEARING. Test 1 opens by asserting the DEFAULT accent `#6aa3ff` —
 * a first-run claim about a config root nothing has written to yet — so it must stay first.
 * Test 2 then replaces the theme document WHOLESALE, which is what puts the accent back where
 * test 1 left the default: each write is the entire file, never a patch.
 *
 * Two consecutive whole-file theme hot-reloads in one process is not a new hazard — since
 * SC-027, `theme-fonts.e2e.ts` does five of them in one app.
 */
test.describe.configure({ mode: 'serial' });

/** Write isolation for the two shared tests — NOT pre-launch state; nothing is in it at boot. */
const sharedCfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: sharedCfg } });
});

test.afterAll(async () => {
  await shared?.close();
  cleanupTemp(sharedCfg);
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

test('hot-reloads the theme when themes/throng.json changes (no restart)', { tag: ['@extended', '@prefs'] }, async () => {
  try {
    await runApp(
      async (_app, win) => {
        // Default throng accent applied first.
        await expect.poll(() => win.evaluate(accentVar)).toBe('#6aa3ff');

        // Edit the theme file → the running app picks it up (hot-reload).
        writeFileSync(
          join(sharedCfg, 'themes', 'throng.json'),
          JSON.stringify({ name: 'throng', colours: { accent: '#ff00ff' } }, null, 2),
          'utf8',
        );
        await expect.poll(() => win.evaluate(accentVar), { timeout: 8000 }).toBe('#ff00ff');
      },
    );
  } finally {
    // sharedCfg belongs to the file, not to this test, and is removed in `afterAll`.
  }
});

test('themes the whole app — base text colour hot-reloads from the theme file', { tag: ['@extended', '@prefs'] }, async () => {
  try {
    await runApp(
      async (_app, win) => {
        const bodyColour = () => win.evaluate(() => getComputedStyle(document.body).color);
        await expect.poll(bodyColour).not.toBe(''); // themed

        writeFileSync(
          join(sharedCfg, 'themes', 'throng.json'),
          JSON.stringify({ name: 'throng', colours: { text: '#abcdef' } }, null, 2),
          'utf8',
        );
        // #abcdef === rgb(171, 205, 239) — the app body text re-themes live.
        await expect.poll(bodyColour, { timeout: 8000 }).toBe('rgb(171, 205, 239)');
      },
    );
  } finally {
    // sharedCfg belongs to the file, not to this test, and is removed in `afterAll`.
  }
});

test('applies a hand-edited settings.json on startup (confirmations level)', { tag: ['@extended', '@prefs'] }, async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    // Pre-seed settings BEFORE launch: destroying a panel needs no confirmation.
    mkdirSync(cfg, { recursive: true });
    writeFileSync(
      join(cfg, 'settings.json'),
      JSON.stringify({ confirmations: { destroyPanel: 'none' } }, null, 2),
      'utf8',
    );

    await runOwnApp(
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
    cleanupTemp(cfg);
  }
});
