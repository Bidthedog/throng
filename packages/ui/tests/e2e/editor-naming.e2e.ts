/**
 * US5 (#97, spec 024): editor panels name themselves from the open file.
 *
 * An editor with no manual name shows the open file's basename (final extension stripped); a manual
 * rename wins even when a different file is opened; "Reset Name" restores the auto name and is
 * disabled until the panel has been renamed; the shared unsaved dot shows for a dirty editor whether
 * auto-named or renamed.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-naming-'));
  writeFileSync(join(root, 'foo.ts'), 'export const foo = 1;\n');
  writeFileSync(join(root, 'bar.md'), '# bar\n');
  writeFileSync(join(root, 'baz.ts'), 'export const baz = 2;\n');
  return root;
}

const ownedRoots: string[] = [];
/** Register a project root for removal in `afterAll`, once the shared app has closed. */
function own(dir: string): string {
  ownedRoots.push(dir);
  return dir;
}

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010) — 2 launches -> 1.
 *
 * Nothing is seeded before launch. Two temp roots, two project names (`BlurNameProj`,
 * `NamingProj`), and every assertion is on a panel id the test itself made.
 *
 * The roots are deleted in `afterAll`, NOT per test: under one app a per-test cleanup removes a
 * folder the application is still watching, which is what `dcdcb46` reverted three conversions for.
 *
 * Test 2 ends with a DIRTY editor on baz.ts. That is safe past the boundary because it is the last
 * test and because the harness teardown DESTROYS the window rather than closing it — no close
 * handshake, so no unsaved-changes prompt (`terminate-all-drain.e2e.ts:115-117`).
 *
 * The shim below REFUSES launch options rather than ignoring them: a swallowed option does not fail,
 * it makes a test pass for the wrong reason.
 *
 * Serial mode is not optional — one window and one daemon, so a failure SKIPS the rest rather than
 * running them against what it left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
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

test('dismissing a new panel’s rename box without typing leaves it auto-named (#97/#89 follow-up)', { tag: ['@extended', '@editor'] }, async () => {
  const root = own(makeProject());
  await runApp(async (_app, win) => {
    await createProject(win, 'BlurNameProj', root);
    const pid = await firstPanelId(win);

    // A user-added panel opens straight into its rename box. Leaving that box without typing is
    // what everyone actually does — you click away to pick the panel's type — and it used to
    // commit the untouched default as a MANUAL name, which then outranked every automatic one.
    await win.getByTestId(`panel-add-${pid}`).click();
    const ids = await win
      .locator('[data-testid^="panel-rename-input-"]')
      .evaluateAll((els) =>
        els.map((e) => (e.getAttribute('data-testid') ?? '').replace('panel-rename-input-', '')),
      );
    const p2 = ids[0];
    expect(p2).toBeTruthy();
    await win.keyboard.press('Tab'); // blur without typing
    await expect(win.getByTestId(`panel-rename-input-${p2}`)).toHaveCount(0);

    // "Reset Name" stays DISABLED — the panel was never renamed.
    await win.getByTestId(`panel-handle-${p2}`).click({ button: 'right' });
    await expect(win.getByTestId('menu-item-Reset Name')).toBeDisabled();
    await win.keyboard.press('Escape');

    // …so it still names itself from the file it opens.
    await win.getByTestId(`panel-type-select-${p2}`).selectOption('editor');
    await win.getByTestId(`panel-type-confirm-${p2}`).click();
    await win.getByTestId(`editor-${p2}`).click();
    await win.getByTestId('file-explorer-tree').getByText('foo.ts', { exact: true }).click();
    await expect(win.getByTestId(`panel-title-${p2}`)).toHaveText('foo', { timeout: 8000 });
  });
});

test('an editor titles itself from its open file; rename wins; Reset Name restores it (#97)', { tag: ['@extended', '@editor'] }, async () => {
  const root = own(makeProject());
  await runApp(async (_app, win) => {
    await createProject(win, 'NamingProj', root);
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
    await win.getByTestId(`panel-type-confirm-${pid}`).click();
    await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
    await win.getByTestId(`editor-${pid}`).click();

    const title = win.getByTestId(`panel-title-${pid}`);
    const tree = win.getByTestId('file-explorer-tree');

    // Auto-name from the open file's basename, final extension stripped.
    await tree.getByText('foo.ts', { exact: true }).click();
    await expect(title).toHaveText('foo', { timeout: 8000 });

    // Re-derives as the open file changes.
    await tree.getByText('bar.md', { exact: true }).click();
    await expect(title).toHaveText('bar', { timeout: 8000 });

    // "Reset Name" is DISABLED before any manual rename (FR-017).
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await expect(win.getByTestId('menu-item-Reset Name')).toBeDisabled();
    await win.keyboard.press('Escape');

    // A manual rename WINS, even when another file is opened.
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Rename').click();
    const input = win.getByTestId(`panel-rename-input-${pid}`);
    await input.fill('Scratch');
    await input.press('Enter');
    await expect(title).toHaveText('Scratch');
    await tree.getByText('baz.ts', { exact: true }).click();
    await expect(title).toHaveText('Scratch');

    // "Reset Name" restores the auto name — the CURRENT file's basename.
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Reset Name').click();
    await expect(title).toHaveText('baz', { timeout: 8000 });

    // The unsaved dot shows for a dirty auto-named editor, beside (not inside) the title.
    const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
    await content.click();
    await win.keyboard.type('// edit');
    await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 8000 });
    await expect(title).toHaveText('baz'); // dirtiness never folded into the name
  });
});
