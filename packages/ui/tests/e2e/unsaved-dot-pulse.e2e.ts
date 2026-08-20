import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

// 011 US5 (FR-020..023): the unsaved dot pulses continuously wherever it appears,
// in step, never invisible; and renders static at full opacity under reduced motion.

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

const animationOf = (win: Page, testId: string): Promise<string> =>
  win.getByTestId(testId).evaluate((el) => getComputedStyle(el).animationName);

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010) — 2 launches -> 1.
 *
 * Nothing is seeded before launch. Two temp roots, two projects (`Pulse`, `PulseRM`); the roots are
 * removed in `afterAll`, not per test, because under one app a per-test cleanup deletes a folder the
 * application is still watching.
 *
 * The leftover that matters is `emulateMedia({ reducedMotion: 'reduce' })`, which test 2 sets on the
 * SHARED page (:62). It is the most dangerous kind of leftover in this suite: invisible, surviving
 * every navigation, and turning test 1's entire subject — a running CSS animation — into
 * `animation-name: none`. The `afterEach` resets it.
 *
 * Deliberately NOT undone: test 1's `dialog.showSaveDialog` stub (:46-48), which is per-APP and
 * permanent. Test 2 never saves.
 *
 * ORDER IS LOAD-BEARING: test 1 reads `.project-item .throng-unsaved-dot` with `.first()` (:39), so
 * it needs to be the only project in the sidebar. It is declared first and must stay first.
 *
 * The shim below REFUSES launch options rather than ignoring them.
 *
 * Serial mode is not optional — one window, so a failure SKIPS the rest rather than running them
 * against what it left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
const ownedRoots: string[] = [];

test.beforeAll(async () => {
  shared = await openApp();
});

/*
 * The one piece of window state a test here changes and does not change back.
 *
 * In an `afterEach` rather than a `finally` inside the test: this way it also runs on the failure
 * path, and on a test added later that forgets — and not one line of any test body has to move, so
 * nothing about what these tests assert can have changed with it.
 */
test.afterEach(async () => {
  // `null` restores the OS/Playwright default rather than pinning "no-preference" — the two are
  // not the same, and test 1 asserts a real running animation.
  await shared.win.emulateMedia({ reducedMotion: null });
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of ownedRoots.splice(0)) cleanupTemp(dir);
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

test('the unsaved dot pulses in step across panel, tab and project', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-pulse-'));
  ownedRoots.push(root);
  await runApp(async (app, win) => {
    await createProject(win, 'Pulse', root);
    const pid = await newEditor(win);
    const tabId = await win
      .locator('.tab-chip')
      .first()
      .evaluate((el) => (el as HTMLElement).dataset.testid?.replace('tab-', '') ?? '');

    await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
    await win.keyboard.type('dirty');

    await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
    // All three carry the SAME pulse animation (one shared class -> in step, FR-022).
    expect(await animationOf(win, `panel-unsaved-${pid}`)).toBe('throng-unsaved-pulse');
    expect(await animationOf(win, `tab-unsaved-${tabId}`)).toBe('throng-unsaved-pulse');
    const projDot = win.locator('.project-item .throng-unsaved-dot').first();
    expect(await projDot.evaluate((el) => getComputedStyle(el).animationName)).toBe(
      'throng-unsaved-pulse',
    );

    // Saving clears the changes → the dot stops the instant it is saved (US5 #3 /
    // SC-005): it is removed, since there are then no unsaved changes.
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, join(root, 'scratch.txt'));
    await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
    await win.keyboard.press('Control+s');
    await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
  });
});

test('the unsaved dot is static at full opacity under reduced motion', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-pulse-rm-'));
  ownedRoots.push(root);
  await runApp(async (_app, win) => {
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await createProject(win, 'PulseRM', root);
    const pid = await newEditor(win);
    await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
    await win.keyboard.type('dirty');

    const dot = win.getByTestId(`panel-unsaved-${pid}`);
    await expect(dot).toBeVisible();
    const style = await dot.evaluate((el) => {
      const s = getComputedStyle(el);
      return { animationName: s.animationName, opacity: s.opacity };
    });
    expect(style.animationName).toBe('none');
    expect(style.opacity).toBe('1');
  });
});
