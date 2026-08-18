import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

// FR-030 (#7): EVERY theme colour token + the fonts must actually apply, and
// hot-reload. #6: a settings-named theme that doesn't exist must fall back to the
// hardcoded defaults WITHOUT creating a stray file.

const COLOUR_TOKENS = [
  'appBg',
  'sidebarBg',
  'surface',
  'surfaceActive',
  'text',
  'textMuted',
  'accent',
  'danger',
  'railBg',
  'border',
  'statusBarBg',
];

const rootVar = (win: Page, name: string): Promise<string> =>
  win.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/*
 * ONE app for the first two tests (034 FR-045, SC-027) — 3 launches -> 2.
 *
 * Test 3 keeps `runOwnApp`: it writes `appearance.theme = Ghost` into settings.json BEFORE the
 * app starts and its claim is about what a NON-EXISTENT active theme does at boot — that the
 * app falls back to the hardcoded defaults and creates no stray themes/Ghost.json. There is no
 * way to ask a running app that question.
 *
 * Tests 1 and 2 write `themes/throng.json` THROUGH the running app and poll for the reload,
 * which is the behaviour under test rather than a precondition of it. Every write replaces the
 * WHOLE document (test 1 does eleven of them in a loop already), so neither test can inherit a
 * partial theme from the other and their order is free.
 *
 * `sharedCfg` is write isolation, not seeding: it is empty when the app starts.
 */
test.describe.configure({ mode: 'serial' });

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

test('every theme colour token applies and hot-reloads', { tag: ['@extended', '@prefs'] }, async () => {
  const themePath = join(sharedCfg, 'themes', 'throng.json');
  try {
    await runApp(
      async (_app, win) => {
        for (let i = 0; i < COLOUR_TOKENS.length; i += 1) {
          const token = COLOUR_TOKENS[i];
          const value = `#${(i + 1).toString(16).padStart(2, '0')}abcd`; // distinct valid hex
          writeFileSync(
            themePath,
            JSON.stringify({ name: 'throng', colours: { [token]: value } }, null, 2),
            'utf8',
          );
          await expect
            .poll(() => rootVar(win, `--throng-colour-${token}`), { timeout: 8000 })
            .toBe(value);
        }
      },
    );
  } finally {
    // sharedCfg belongs to the file, not to this test, and is removed in `afterAll`.
  }
});

test('theme colours + fonts map to real rendered styles (whole-app)', { tag: ['@extended', '@prefs'] }, async () => {
  try {
    await runApp(
      async (_app, win) => {
        writeFileSync(
          join(sharedCfg, 'themes', 'throng.json'),
          JSON.stringify(
            {
              name: 'throng',
              colours: { appBg: '#010203', text: '#0a0b0c', statusBarBg: '#040506' },
              fonts: { family: 'Courier New', baseSizePx: 18, weights: { normal: 400, bold: 700 } },
            },
            null,
            2,
          ),
          'utf8',
        );
        const body = () => win.evaluate(() => {
          const s = getComputedStyle(document.body);
          return { bg: s.backgroundColor, color: s.color, font: s.fontFamily, size: s.fontSize };
        });
        await expect.poll(async () => (await body()).bg, { timeout: 8000 }).toBe('rgb(1, 2, 3)');
        const b = await body();
        expect(b.color).toBe('rgb(10, 11, 12)');
        expect(b.font).toContain('Courier New');
        expect(b.size).toBe('18px');
        const statusBg = await win.evaluate(
          () => getComputedStyle(document.querySelector('[data-testid="status-bar"]')!).backgroundColor,
        );
        expect(statusBg).toBe('rgb(4, 5, 6)');
      },
    );
  } finally {
    // sharedCfg belongs to the file, not to this test, and is removed in `afterAll`.
  }
});

test('a non-existent settings theme falls back to defaults and writes no file (#6)', { tag: ['@extended', '@prefs'] }, async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    mkdirSync(cfg, { recursive: true });
    writeFileSync(
      join(cfg, 'settings.json'),
      JSON.stringify({ appearance: { theme: 'Ghost' } }, null, 2),
      'utf8',
    );
    await runOwnApp(
      async (_app, win) => {
        // Default throng accent still applied (hardcoded fallback).
        await expect.poll(() => rootVar(win, '--throng-colour-accent')).toBe('#6aa3ff');
        // No stray themes/Ghost.json created.
        expect(existsSync(join(cfg, 'themes', 'Ghost.json'))).toBe(false);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(cfg);
  }
});
