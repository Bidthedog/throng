import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  openApp,
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
 * ONE app for this file (034 FR-045, SC-027; 035 T056) — 3 launches -> 1.
 *
 * The third test used to keep its OWN launch, because it seeded `appearance.theme = Ghost` before
 * the app started and asked what a non-existent active theme does at boot. That question is
 * answered without an app at all now — `integration/theme-name-fallback.integration.test.ts` puts
 * it to `readConfigOnce` over a real config root — so the launch went with the test.
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

/*
 * ── ONE REMOVED (035 T056) ──
 *
 * `:137` "a non-existent settings theme falls back to defaults and writes no file (#6)" →
 * `packages/ui/tests/integration/theme-name-fallback.integration.test.ts`.
 *
 * It was the one test in this file that was not about a rendered colour. It launched its OWN
 * Electron app against a seeded config root to make two assertions — the default accent is on
 * `<html>`, and no `themes/Ghost.json` was created. The second is a filesystem fact and never
 * needed a window; the first was the end of a chain whose every other link is proven separately:
 * the read falls back (that file), the payload reaches the renderer
 * (`integration/config-broadcast-latency.test.ts`), and `ThemeProvider` writes the tokens onto
 * `<html>` (`component/theme-provider.test.ts`).
 *
 * The integration file adds three cases this could not: the SETTING is left alone rather than
 * corrected behind the user, a theme that DOES exist is still read (without which a resolver
 * ignoring `appearance.theme` entirely would look correct), and a name that would traverse
 * off-tree is refused — with a real theme planted outside the fence, because a version that pointed
 * at an empty path fell back for the wrong reason and proved nothing.
 *
 * Red-proven: creates-the-missing-theme, name-not-confined, always-shipped — one red each.
 *
 * ── WHAT STAYS ──
 *
 * Both remaining tests, `@reserve:layout`: they sample COMPUTED styles across the whole running
 * application to prove that every theme token reaches something real. jsdom computes no cascade.
 */
test('every theme colour token applies and hot-reloads', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
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

test('theme colours + fonts map to real rendered styles (whole-app)', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
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

