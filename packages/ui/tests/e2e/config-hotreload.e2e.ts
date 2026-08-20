import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openApp,
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

/*
 * ── ONE REMOVED (035 T056) ──
 *
 * `:111` "applies a hand-edited settings.json on startup (confirmations level)" — two halves, and
 * only one of them was about configuration:
 *
 *   a hand-edited document is READ at startup
 *     → `integration/config-store.integration.test.ts` and `integration/config-watcher-retry.test.ts`,
 *       which also cover the unreadable and mid-write cases this could not reach
 *   the level the user set REACHES the destroy, and `none` means no dialog
 *     → `component/tab-strip.test.ts`
 *
 * `planConfirmations` is pure and covered in `core/tests/unit`. What had no test was that
 * `panel-placeholder.tsx:322` hands it `settings.confirmations` rather than a default — which is
 * the hop a hand-edited level actually travels, and the only part of this test that was not already
 * proven somewhere else.
 *
 * The component version's panel holds a RUNNING TERMINAL, and that is load-bearing: a panel with
 * nothing running is destroyed without a confirmation anyway at the shipped level, so a test that
 * destroyed an EMPTY panel under `none` would prove nothing — both levels behave identically there.
 * The migrated test destroyed an empty panel.
 *
 * Red-proven: ignores-the-setting (1), never-confirms (2), ignores-what-is-running (2).
 *
 * ── WHAT STAYS ──
 *
 * Both remaining tests, `@reserve:layout`: each writes a theme file into a RUNNING app's config root
 * and polls a COMPUTED colour until the watcher's reload reaches the screen. jsdom computes no
 * cascade, and the file-watch round trip is the subject rather than the setup.
 */
test('hot-reloads the theme when themes/throng.json changes (no restart)', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
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

test('themes the whole app — base text colour hot-reloads from the theme file', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
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

