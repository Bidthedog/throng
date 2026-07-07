import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { runApp } from './harness.js';

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

test('every theme colour token applies and hot-reloads', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  const themePath = join(cfg, 'themes', 'throng.json');
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
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});

test('theme colours + fonts map to real rendered styles (whole-app)', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    await runApp(
      async (_app, win) => {
        writeFileSync(
          join(cfg, 'themes', 'throng.json'),
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
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});

test('a non-existent settings theme falls back to defaults and writes no file (#6)', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    mkdirSync(cfg, { recursive: true });
    writeFileSync(
      join(cfg, 'settings.json'),
      JSON.stringify({ appearance: { theme: 'Ghost' } }, null, 2),
      'utf8',
    );
    await runApp(
      async (_app, win) => {
        // Default throng accent still applied (hardcoded fallback).
        await expect.poll(() => rootVar(win, '--throng-colour-accent')).toBe('#6aa3ff');
        // No stray themes/Ghost.json created.
        expect(existsSync(join(cfg, 'themes', 'Ghost.json'))).toBe(false);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});
