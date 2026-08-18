/**
 * No two panels anywhere in throng share a name (024 follow-up).
 *
 * A panel's name is how a user REFERS to it — in the tab strip, in the window title, in the
 * app-close warning listing what is still running, and out loud to whoever they are pairing with.
 * Two panels called "Build" in two projects make every one of those a riddle. Uniqueness spans
 * every project and every sub-workspace, which is why only the daemon can enforce it.
 */
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

/**
 * Rename the given panel through its header menu, and assert the name it ended up with.
 *
 * The expected name is asserted HERE, with a retrying expectation, rather than returned for the
 * caller to compare. Returning `textContent()` was a single instantaneous read taken the moment the
 * rename input closed: the title had not necessarily re-rendered yet, so under load it captured the
 * OLD name and the comparison failed. That is what reddened CI (run 30951944889) while the test
 * passed every time locally — a timing artefact, not a naming bug.
 */
async function renamePanel(win: Page, panelId: string, to: string, expected: string): Promise<void> {
  await win.getByTestId(`panel-handle-${panelId}`).click({ button: 'right' });
  await win.getByTestId('menu-item-Rename').click();
  const input = win.getByTestId(`panel-rename-input-${panelId}`);
  await expect(input).toBeVisible();
  await input.fill(to);
  await input.press('Enter');
  await expect(win.getByTestId(`panel-rename-input-${panelId}`)).toHaveCount(0);
  await expect(win.getByTestId(`panel-title-${panelId}`)).toHaveText(expected);
}

/*
 * ONE app for this file, not one per test (034 FR-045, SC-027) — 2 launches -> 1.
 *
 * ══ THE TWO TESTS ARE DECLARED IN THE OPPOSITE ORDER TO THE ONE THEY WERE WRITTEN IN ══
 *
 * "the generated names of two projects do not collide" asserts the literal names `Panel 1` and
 * `Panel 2`. Those are not arbitrary strings: `nextDefaultPanelName`
 * (packages/core/src/workspace/unique-name.ts:63) returns the LOWEST FREE number across every
 * project and sub-workspace the daemon can see, so the claim is a claim about a PRISTINE global
 * sequence. It can only be true of the first projects an app makes, which makes it a
 * first-run condition and puts it first.
 *
 * The other test then runs against a sequence at Panel 3 and up, which costs it nothing: every
 * name it asserts is one it TYPED (Build, Build (2), BUILD (2)), and `uniquePanelName` gives a
 * typed name a numeric suffix rather than renumbering it (:37-40). "Build" is still free.
 *
 * Nothing here is seeded before launch and nothing else leaks: the four temp roots are deleted
 * in `afterAll` (a per-test delete removes a folder the app is still watching), the projects
 * have four distinct names, and the `panel-name-adjusted` notice is raised ONLY from a user
 * rename (panel-placeholder.tsx:249-270) — the generated-name adjustment in the first test does
 * not raise one, so nothing stale can satisfy the second test's notice assertions.
 */
const ownedRoots: string[] = [];
/** Register a project root for removal in `afterAll`, once the shared app has closed. */
function own(dir: string): string {
  ownedRoots.push(dir);
  return dir;
}

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

test('the generated names of two projects do not collide', { tag: ['@extended', '@window'] }, async () => {
  const rootA = own(mkdtempSync(join(tmpdir(), 'throng-autoA-')));
  const rootB = own(mkdtempSync(join(tmpdir(), 'throng-autoB-')));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'AutoAlpha', rootA);
      const a = await firstPanelId(win);
      await expect(win.getByTestId(`panel-title-${a}`)).toHaveText('Panel 1');
      // The daemon answers from PERSISTED layouts, so give this project's layout time to be written
      // before the next one asks whether its name is taken.
      //
      // sleep-justified: `panelName.claim` reads project A's layout back from the SQLite store
      // (panel-name-service.ts), not from this window's in-memory state, and the debounced save
      // that puts it there raises no event this window can observe — the later poll on project
      // B's title cannot rescue this, because B's name is decided once, at creation.
      await win.waitForTimeout(2500);

      await createProject(win, 'AutoBeta', rootB);
      const b = await firstPanelId(win);
      // Every project used to number its panels within its OWN layout, so both were "Panel 1".
      // Generated names now run in ONE sequence across the whole application — so the second
      // project's first panel is "Panel 2". Not "Panel 1 (2)": a suffix is for a name the user
      // typed and wants to keep the words of; a generated name simply rejoins the sequence.
      await expect
        .poll(() => win.getByTestId(`panel-title-${b}`).textContent(), { timeout: 8000 })
        .toBe('Panel 2');
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the application is still watching — the class dcdcb46 reverted three
    // conversions for.
  }
});

test('a name taken in ANOTHER project is adjusted, and the user is told once', { tag: ['@extended', '@window'] }, async () => {
  const rootA = own(mkdtempSync(join(tmpdir(), 'throng-nameA-')));
  const rootB = own(mkdtempSync(join(tmpdir(), 'throng-nameB-')));
  try {
    await runApp(async (_app, win) => {
      // Project A: name its panel "Build".
      await createProject(win, 'AlphaProj', rootA);
      const a = await firstPanelId(win);
      await renamePanel(win, a, 'Build', 'Build');

      // Project B — a DIFFERENT project, whose layout this window is now showing instead.
      await createProject(win, 'BetaProj', rootB);
      const b = await firstPanelId(win);
      expect(b).not.toBe(a);

      // The clash is in a project that is not even open. Only the daemon can see it.
      await renamePanel(win, b, 'Build', 'Build (2)');

      // Told once, in a warning that dismisses itself — nothing was lost and nothing to decide.
      const notice = win.getByTestId('panel-name-adjusted');
      await expect(notice).toBeVisible({ timeout: 8000 });
      await expect(notice).toContainText('Build (2)');
      await expect(notice).toHaveClass(/notice--warning/);

      // Case-insensitively, too: two panels a user cannot tell apart are the same name.
      const third = await win.getByTestId(`panel-add-${b}`).click().then(async () => {
        const ids = await win
          .locator('[data-testid^="panel-type-select-"]')
          .evaluateAll((els) =>
            els.map((e) => (e.getAttribute('data-testid') ?? '').replace('panel-type-select-', '')),
          );
        return ids[0];
      });
      await renamePanel(win, third, 'BUILD', 'BUILD (2)');
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the application is still watching — the class dcdcb46 reverted three
    // conversions for.
  }
});
