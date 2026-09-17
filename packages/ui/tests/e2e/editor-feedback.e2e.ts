import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { openApp,
  createProject as newProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp, FILE_OP_TIMEOUT_MS } from './harness.js';

/*
 * ONE app for this file, not one per test.
 *
 * Each test used to launch its own Electron app, daemon and window — roughly two seconds apiece, and
 * 604 such launches across the suite — to run assertions that never needed a pristine app. Only a
 * test that seeds state BEFORE launch genuinely does, and those keep their own app via `runOwnApp`.
 *
 * The shims below exist so the test bodies below are unchanged:
 *   runApp        runs the body against the shared window. It refuses options rather than ignoring
 *                 them: a dropped config root does not fail, it passes for the wrong reason.
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required — shared window, shared database — and it means a failure skips the rest
 * rather than running them against whatever state the failure left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win'], ctx: { pipeName: string; userDataDir: string }) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win, {
    pipeName: shared.pipeName,
    userDataDir: shared.userDataDir,
  });
};

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

// Post-Delivery-E feedback (Session 2026-07-05b): New Editor menu target (FR-072),
// panel-header Save + Revert (FR-075/076), visible out-of-tree save message
// (FR-078), and the themeable editor monospace font (FR-074).

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-fb-'));
  writeFileSync(join(root, 'a.txt'), 'A-BODY\n');
  return root;
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

const item = (win: Page, label: string) => win.getByTestId(`menu-item-${label}`);

async function stubSaveDialog(app: ElectronApplication, picked: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, picked);
}

/*
 * ── "Open In offers New Editor ... and disables it once the file is open" MOVED DOWN (044 T163a) ──
 *
 * All three of its claims are held below this layer, each observed failing against a broken
 * implementation before the declaration was deleted:
 *
 *   - offered and ENABLED while the file is closed, still OFFERED but disabled once it is open —
 *     `unit/open-in-targets.test.ts` (`describeOpenInTargets`, the `alreadyOpen` rule) and
 *     `component/explorer-open-in-target.test.ts` (the drawn row in the real FileTree menu);
 *   - clicking it opens a SECOND editor panel — `component/editor-open-router.test.ts` ("Open In →
 *     New Editor opens an editor": `performOpenIn` hands `openFileInTab` the `new` target) and
 *     `component/editor-open-routing.test.ts` ("opens a NEW panel every time when the open target is
 *     'new'").
 *
 * What the declaration drove — an in-document React menu and a class on one of its rows — is not in
 * the E2E reserve, which is why it carried no `@reserve:*` tag.
 */
/*
 * ── ONE REMOVED (035 T056), AND A WHOLE FILE WITH IT ──
 *
 * `:84` "a refused out-of-tree save shows a visible message and leaves the buffer unsaved" →
 * `packages/ui/tests/component/editor-notices.test.ts`, which also absorbed the entirety of
 * `editor-external-change-named.e2e.ts` (one declaration, now deleted).
 *
 * ── IN BOTH CASES THE ENDS WERE PROVEN AND THE MIDDLE WAS NOT ──
 *
 * The out-of-tree REFUSAL, and that nothing is written outside the project, is
 * `integration/editor-service-save.integration.test.ts:70`. `buildFileChangedNotice` is pure and is
 * `unit/file-changed-notice.test.ts`. What neither reaches is the hop between them — that a refused
 * save RAISES the notice rather than failing silently (FR-078), and that an `externalChange`
 * broadcast fills the builder in with THIS panel's title, THIS tab's title and the path the document
 * holds NOW.
 *
 * Three string arguments in a row is the shape a wiring mistake hides in best, and the component
 * file catches two versions of it the E2E could not: the panel and tab swapped (`panel-and-tab-
 * swapped`), and a path left behind by a move (`movedto-ignored`) — the migrated test opened one
 * file and never moved it. It also asserts the SUB-WORKSPACE wording, which is the mirror image of
 * the project one; a single test cannot tell a correct message from a hard-coded one.
 *
 * Red-proven against seven mutations: no-external-notice (2), notice-on-every-sync (1),
 * panel-and-tab-swapped (1), notice-names-no-file (2), movedto-ignored (1), save-error-silent (2),
 * one-message-for-both-owners (1).
 */
test('panel-header Save saves; Revert discards changes after confirmation', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  const savePath = join(root, 'note.txt');
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'FbProj', root);
      const pid = await newEditor(win);
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await content.click();
      await win.keyboard.type('first');

      // Save via the panel-header menu (== Ctrl+S).
      await stubSaveDialog(app, savePath);
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await item(win, 'Save').click();
      await expect
        .poll(() => (existsSync(savePath) ? readFileSync(savePath, 'utf8') : ''), { timeout: FILE_OP_TIMEOUT_MS })
        .toBe('first');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);

      // Edit again, then Revert (confirm) → content returns to the saved text.
      await content.click();
      await win.keyboard.type(' SECOND');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await item(win, 'Revert').click();
      await win.getByTestId('confirm-accept').click();

      await expect(content).not.toContainText('SECOND');
      await expect(content).toContainText('first');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('the editor renders in the themeable monospace font (Consolas default)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'FbProj', root);
      const pid = await newEditor(win);
      const family = await win
        .getByTestId(`editor-${pid}`)
        .locator('.cm-scroller')
        .evaluate((el) => getComputedStyle(el).fontFamily);
      expect(family.toLowerCase()).toContain('consolas');
    });
  } finally {
    cleanupTemp(root);
  }
});
