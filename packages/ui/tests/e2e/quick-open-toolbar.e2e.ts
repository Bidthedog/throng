/**
 * 033 US1 (#219) — Quick Open's VISIBLE route: the Files & Folders toolbar button.
 *
 * Covers AS-16 and AS-17 of the spec, FR-018, FR-018a–FR-018c, V1–V5 of
 * `contracts/navigation-modals.md §4`, and SC-012's Quick Open half.
 *
 * ══ WHY THIS SPEC IS SERIAL (T025) ══
 *
 * It opens the preferences window, which is a child window that TAKES FOCUS — and throng closes
 * menus and popups when its window loses focus. A second headed app sharing the desktop therefore
 * loses whatever menu it had open, and the failure lands on an unrelated test. That is the
 * mechanism `parallel-plan.json` exists to encode, not a guess about this file being slow.
 *
 * ══ WHY THE BUTTON IS LOCATED BY ITS ACCESSIBLE NAME ══
 *
 * `helpers/navigation.ts` owns the locator and explains it: V3 requires the button's `title` to
 * carry the command's LIVE chord, so the title changes the moment the binding changes and a
 * title-based locator would break on the very rebind AS-17 is about. The `aria-label` is the stable
 * half.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
  createProject as newProject,
  firstPanelId,
  focusEditor,
  settle,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';
import { createDeepTree, cleanupDeepTree } from './helpers/deep-tree.js';
import {
  QUICK_OPEN_CHORD,
  openQuickOpen,
  openQuickOpenFromToolbar,
  quickOpenToolbarButton,
} from './helpers/navigation.js';

/*
 * ONE app for the two tests that can share it. Two cannot, and each says why at its own `runOwnApp`:
 * the FR-018c test needs an app in which NO project has ever been opened, and the rebinding test
 * writes `keybindings.json`, which every later test in a shared app would then inherit.
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

let projectSeq = 0;
const createProject = (win: Page, name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

/** The Key Bindings tab of the preferences window, opened through the cog exactly as US3 does. */
async function openKeybindings(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-keybindings').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('keybindings-tab')).toBeVisible();
  return prefs;
}

/** Dispatch a synthetic chord at the capture dialog, so a reserved combo never reaches the OS. */
async function sendChord(
  prefs: Page,
  key: string,
  mods: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
): Promise<void> {
  await prefs.evaluate(
    ({ key: k, mods: m }) => {
      const init = { key: k, bubbles: true, ...m } as KeyboardEventInit;
      window.dispatchEvent(new KeyboardEvent('keydown', init));
      window.dispatchEvent(new KeyboardEvent('keyup', init));
    },
    { key, mods },
  );
}

function readBindings(cfgRoot: string): Record<string, string[]> | null {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'keybindings.json'), 'utf8')).bindings;
  } catch {
    return null;
  }
}

/** The toolbar's controls, by accessible name, in the order they are drawn. */
async function toolbarNames(win: Page): Promise<string[]> {
  return win
    .getByTestId('explorer-toolbar')
    .evaluate((bar) =>
      [...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? ''),
    );
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── */

test('with no project open the button is DRAWN AND DISABLED and the chord opens nothing — and both come alive once a project is opened (FR-018, FR-018c, V4, A5)', async () => {
  const tree = createDeepTree('throng-qtb-noproject-');
  try {
    // Its OWN app, and this is the state that needs one: a shared app has had a project opened by
    // whichever test ran first, and "no project has ever been opened" cannot be recovered from that.
    await runOwnApp(async (_app, win) => {
      await settle(win);
      /*
       * The Files & Folders pane defaults to COLLAPSED when no project is open
       * (`throng.explorerVisibleNoProject`, app.tsx) — "the user may still expand it to its empty
       * placeholder". Expanding it is the state FR-018c is about: a button nobody can see is
       * neither drawn nor disabled, and the requirement is about what the user finds when they look.
       */
      await win.getByTestId('pane-show-right').click();
      await expect(win.getByTestId('file-explorer-empty')).toBeVisible();

      /*
       * DRAWN and DISABLED, not hidden (FR-018c, and the 2026-08-15 clarification that settles
       * "absent or disabled" for the temporarily-unavailable case). A control that vanishes teaches
       * the user nothing; one that is visibly unavailable explains itself in its hover title.
       */
      await expect(quickOpenToolbarButton(win)).toBeVisible();
      await expect(quickOpenToolbarButton(win)).toBeDisabled();

      // A5 — the chord opens nothing either, and never lists a previous project's files.
      await win.keyboard.press(QUICK_OPEN_CHORD);
      await expect(win.getByTestId('quickopen')).toHaveCount(0);

      /*
       * …and the SAME chord, in the SAME app, opens the modal once a project exists.
       *
       * This half is what makes the half above evidence. A `toHaveCount(0)` on its own is satisfied
       * by a chord nothing has ever bound, by a window that is not listening, and by a test that
       * mistyped the chord — all three look identical. Proving the chord is live here rules them
       * out without waiting on a clock.
       */
      await newProject(win, 'QOToolbarNoProject', tree.root);
      await expect(quickOpenToolbarButton(win)).toBeEnabled();
      await openQuickOpen(win);
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('the toolbar carries a Quick Open button beside Expand and Collapse all, drawn from a theme token, tooltipped with its current chord, and opening the same modal (AS-16, V1–V3, V5)', async () => {
  const tree = createDeepTree('throng-qtb-shape-');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QOToolbarShape', tree.root);

      /*
       * V1 and V5 in one read: the new control is BESIDE Collapse all, and the four shipped controls
       * are all still there, unchanged. Asserting the whole list rather than just the new button is
       * what makes V5 ("it is the only new toolbar control") checkable at all.
       */
      const names = await toolbarNames(win);
      expect(names).toEqual(['Expand', 'Collapse all', 'Quick Open', 'New folder', 'Delete']);

      const button = quickOpenToolbarButton(win);

      // V2 — the shared `Icon` component, never a hard-coded glyph. The token's EXISTENCE is a unit
      // gate (`icon-tokens-exist.test.ts`); what E2E can see is that the button draws an icon
      // element and carries no text of its own.
      await expect(button.locator('span.icon')).toHaveCount(1);
      expect((await button.textContent())?.trim() ?? '').toBe('');

      // V3 / AS-16 — the hover title names the action AND the command's current chord.
      const title = (await button.getAttribute('title')) ?? '';
      expect(title).toContain('Quick Open');
      expect(title).toContain('Ctrl+Shift+T');

      // …and clicking it opens the same modal the chord opens.
      await openQuickOpenFromToolbar(win);
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('the command is listed in Preferences → Key Bindings with its name, description, scope and chord (SC-012, P1, FR-064)', async () => {
  const tree = createDeepTree('throng-qtb-listed-');
  try {
    await runApp(async (app, win) => {
      await settle(win);
      await createProject(win, 'QOToolbarListed', tree.root);

      const prefs = await openKeybindings(app, win);
      const row = prefs.getByTestId('binding-navigate.quickOpen');
      await expect(row).toBeVisible();
      expect((await row.locator('.settings-row__label').textContent())?.trim() ?? '').not.toBe('');
      expect((await row.locator('.settings-row__desc').textContent())?.trim() ?? '').not.toBe('');
      await expect(prefs.getByTestId('binding-navigate.quickOpen-chord')).toContainText(
        'Ctrl+Shift+T',
      );
      // EVERYWHERE (T034): a window command, live in the editor, the terminal and the tree alike.
      await expect(prefs.getByTestId('binding-navigate.quickOpen-scope')).toHaveText('Everywhere');

      // Closed explicitly: this file shares an app, and a preferences window left open would take
      // focus away from every test that followed.
      await prefs.close();
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('rebinding the chord changes the tooltip, makes the new chord work and stops the old one (AS-17, SC-012, V3)', async () => {
  const tree = createDeepTree('throng-qtb-rebind-');
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-qtb-cfg-'));
  /*
   * The longest journey in this file: a project, an editor, the preferences window, a chord capture,
   * a pill removal, a config hot-reload back into the main window, and then three keyboard journeys
   * against the result. Comfortably past the 30s default, and a budget that only just fits is a
   * future flake under the strict gate rather than a tight test.
   */
  test.setTimeout(90_000);
  try {
    // Its OWN app and its OWN config root: this test WRITES `keybindings.json`, and a shared app
    // would carry the rebind into everything that ran after it.
    await runOwnApp(
      async (app, win) => {
        await settle(win);
        await newProject(win, 'QOToolbarRebind', tree.root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();
        await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();

        const prefs = await openKeybindings(app, win);
        // Named before it is driven: a bare `dblclick` on an absent row spends the whole test
        // budget and reports a timeout with no subject, which is an hour in the wrong file.
        const row = prefs.getByTestId('binding-navigate.quickOpen');
        await expect(row, 'navigate.quickOpen is not listed in Preferences → Key Bindings').toBeVisible();
        await row.dblclick();
        await expect(prefs.getByTestId('capture-modal')).toBeVisible();
        await sendChord(prefs, 'F8'); // unbound by default
        await expect(prefs.getByTestId('capture-modal')).toBeHidden();
        await expect
          .poll(() => readBindings(cfgRoot)?.['navigate.quickOpen'])
          .toEqual(['Ctrl+Shift+T', 'F8']); // capture is ADDITIVE (007 FR-033)

        // …so the old chord has to be REMOVED for "the old one stops" to be a thing that happened.
        await expect(prefs.getByTestId('binding-navigate.quickOpen-pill-1')).toBeVisible();
        await prefs.getByTestId('binding-navigate.quickOpen-remove-0').click();
        await expect.poll(() => readBindings(cfgRoot)?.['navigate.quickOpen']).toEqual(['F8']);
        await prefs.close();

        // V3 / AS-17 — the tooltip is read LIVE from the bindings, so it names the new chord with no
        // restart. `toHaveAttribute` retries, so this waits for the hot-reload round trip.
        await win.bringToFront();
        await expect(quickOpenToolbarButton(win)).toHaveAttribute('title', /F8/);
        await expect(quickOpenToolbarButton(win)).not.toHaveAttribute('title', /Ctrl\+Shift\+T/);

        // The NEW chord works.
        await focusEditor(win, pid);
        await win.keyboard.press('F8');
        await expect(win.getByTestId('quickopen')).toBeVisible();
        await win.keyboard.press('Escape');
        await expect(win.getByTestId('quickopen')).toHaveCount(0);

        /*
         * …and the OLD chord does not — proved by where the keystrokes LAND, not by an absence.
         *
         * `toHaveCount(0)` on its own is satisfied instantly by a renderer that has not got round to
         * opening the modal yet, which is the vacuous-guard shape #244 exists to name. Typing after
         * the dead chord gives the assertion something positive to wait for: if the old chord still
         * opened the modal, `zq` would land in the modal's query input and never reach the editor,
         * and this assertion fails on the editor's content.
         */
        await focusEditor(win, pid);
        await win.keyboard.press(QUICK_OPEN_CHORD);
        await win.keyboard.type('zq');
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('zq');
        await expect(win.getByTestId('quickopen')).toHaveCount(0);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupDeepTree(tree);
    cleanupTemp(cfgRoot);
  }
});
