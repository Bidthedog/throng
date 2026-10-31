import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { openApp,
  createProject as newProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp, FILE_OP_TIMEOUT_MS, focusEditor } from './harness.js';
import { shippedTwoStroke } from '../shared/window-chords.js';

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

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * MERGED IN (test-suite audit) from editor-word-wrap.e2e.ts — none of the three passes launch options, so all share this file's one app
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * US1 (#152, spec 024): per-document editor word-wrap toggle, reachable from the status bar, the
 * content menu, and the `Ctrl+E,W` two-stroke chord (046 FR-091, FR-124; Ctrl+Alt+W before it). Default On (editor.defaultWordWrap). The toggle reflows the
 * live view (the CodeMirror content's white-space flips between wrapping and not).
 */

function makeWrapProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-wrap-'));
  // A single very long line so wrapping is observable.
  writeFileSync(join(root, 'long.txt'), 'x'.repeat(400) + '\n');
  return root;
}

/** The CodeMirror content wraps when its computed white-space is a wrapping mode. */
async function contentWraps(win: import('@playwright/test').Page, pid: string): Promise<boolean> {
  const ws = await win
    .getByTestId(`editor-${pid}`)
    .locator('.cm-content')
    .evaluate((el) => getComputedStyle(el as HTMLElement).whiteSpace);
  return ws === 'break-spaces' || ws === 'pre-wrap' || ws === 'normal';
}

test('word wrap toggles from the status bar, the chord, and the content menu (#152)', { tag: ['@extended', '@editor', '@reserve:input'] }, async () => {
  const root = makeWrapProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'WrapProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('long.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('xxxx', {
        timeout: 8000,
      });

      const wrapBtn = win.getByTestId(`editor-word-wrap-${pid}`);
      // Default On.
      await expect(wrapBtn).toHaveText('Wrap');
      await expect(wrapBtn).toHaveAttribute('aria-pressed', 'true');
      expect(await contentWraps(win, pid)).toBe(true);

      // Status-bar toggle → off; the view stops wrapping.
      await wrapBtn.click();
      await expect(wrapBtn).toHaveText('No Wrap');
      await expect(wrapBtn).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => contentWraps(win, pid)).toBe(false);

      // Ctrl+E,W → back on. Two strokes (046 FR-091) in ONE continuous press (FR-124): Ctrl held
      // from E through W. The first leaves the editor visibly waiting, and only then is the second
      // sent, so it lands in the chord rather than in the document.
      const { hold, first, second } = shippedTwoStroke('editor.toggleWordWrap');
      await focusEditor(win, pid);
      for (const mod of hold) await win.keyboard.down(mod);
      await win.keyboard.press(first);
      await expect(win.getByTestId('editor-pending-chord')).toBeVisible();
      await win.keyboard.press(second);
      for (const mod of [...hold].reverse()) await win.keyboard.up(mod);
      await expect(win.getByTestId('editor-pending-chord')).toHaveCount(0);
      await expect(wrapBtn).toHaveText('Wrap');
      await expect.poll(() => contentWraps(win, pid)).toBe(true);

      // Content menu carries a checkable "Word Wrap" item that toggles it off again.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click({ button: 'right' });
      await expect(win.getByTestId('menu-item-Word Wrap')).toContainText('✓'); // checked while on
      await win.getByTestId('menu-item-Word Wrap').click();
      await expect(wrapBtn).toHaveText('No Wrap');
      await expect.poll(() => contentWraps(win, pid)).toBe(false);
    });
  } finally {
    cleanupTemp(root);
  }
});


/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * MERGED IN (test-suite audit) from editor-scroll-position.e2e.ts
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * US8 (#154) — "Save Document Scroll Position". With the pref OFF (default), opening a different
 * file in place resets scroll to the top; with it ON, reopening a file in place restores its scroll.
 */

const longText = (marker: string): string =>
  Array.from({ length: 300 }, (_, i) => `${marker}_LINE_${i + 1}`).join('\n') + '\n';

function makeScrollProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-scroll-'));
  writeFileSync(join(root, 'one.txt'), longText('ONE'));
  writeFileSync(join(root, 'two.txt'), longText('TWO'));
  return root;
}

const scrollTop = (win: Page) => win.locator('.cm-scroller').first().evaluate((el) => el.scrollTop);

test('with the pref off (default), opening a different file in place scrolls to the top (#154)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const root = makeScrollProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Scroll', root);
      const tree = win.getByTestId('file-explorer-tree');

      await tree.getByText('one.txt', { exact: true }).click();
      await expect(win.locator('.cm-content').first()).toContainText('ONE_LINE_1');

      // Scroll to the bottom of file one.
      await win.locator('.cm-content').first().click();
      await win.keyboard.press('Control+End');
      await expect.poll(() => scrollTop(win)).toBeGreaterThan(100);

      // Open file two IN PLACE (default openTarget reuses this editor).
      await tree.getByText('two.txt', { exact: true }).click();
      await expect(win.locator('.cm-content').first()).toContainText('TWO_LINE_1');

      // US8 (off): the new document starts at the top, not carrying file one's scroll.
      await expect.poll(() => scrollTop(win)).toBeLessThan(5);
    });
  } finally {
    cleanupTemp(root);
  }
});


/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * MERGED IN (test-suite audit) from editor-encoding.e2e.ts
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * 059 US2 + US3 + US4 — a UTF-16 file in the real app: the status bar names its format, its line-ending
 * list switches it to CR and its encoding list to UTF-8, and Ctrl+S writes what was chosen (T043, T069).
 *
 * Why E2E: the indicators' rendered text in a real status bar and the menus they open on a real click
 * are the user's whole route through this feature; every piece beneath them — detection,
 * the authority's line format, the save — is proven lower, and only a running app composes them.

/** UTF-16 LE with a BOM — what PowerShell 5.1's `>` writes. */
function utf16le(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

test('a UTF-16 LE file shows its format, switches to CR and UTF-8 from the status bar, and saves both (059 US2, US3, US4)', { tag: ['@extended', '@editor', '@reserve:input'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-encoding-'));
  const file = join(root, 'ps.txt');
  writeFileSync(file, utf16le('héllo\r\nwörld\r\n'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'EncodingProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('ps.txt', { exact: true }).click();
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(content).toContainText('héllo', { timeout: 8000 });

      await expect(win.getByTestId(`editor-encoding-${pid}`)).toHaveText('UTF-16 LE');
      await expect(win.getByTestId(`editor-line-ending-${pid}`)).toHaveText('CRLF');

      // FR-057 — the line-ending list switches to CR; nothing is written yet.
      await win.getByTestId(`editor-line-ending-${pid}`).click();
      await win.getByTestId('menu-item-line-ending-cr').click();
      await expect(win.getByTestId(`editor-line-ending-${pid}`)).toHaveText('CR');

      // FR-055 — the encoding list changes the document's encoding, still writing nothing.
      await win.getByTestId(`editor-encoding-${pid}`).click();
      await win.getByTestId('menu-item-encoding-utf8').click();
      await expect(win.getByTestId(`editor-encoding-${pid}`)).toHaveText('UTF-8');
      expect(readFileSync(file).toString('hex')).toBe(utf16le('héllo\r\nwörld\r\n').toString('hex'));

      await focusEditor(win, pid);
      await win.keyboard.press('Control+S');
      await expect
        .poll(() => readFileSync(file).toString('hex'), { timeout: 8000 })
        .toBe(Buffer.from('héllo\rwörld\r', 'utf8').toString('hex'));
    });
  } finally {
    cleanupTemp(root);
  }
});

