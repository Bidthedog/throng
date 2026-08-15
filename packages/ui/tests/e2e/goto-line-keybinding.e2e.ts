/**
 * 033 US2 (#219) — Go To Line in Preferences → Key Bindings: AS-10, and SC-012's Go To Line half.
 *
 * The claim SC-012 makes is not "the row is listed". It is that the command can be REBOUND and that
 * after the rebind **the new chord works while the old one stops** — three separate facts, and only
 * the third of them catches a dispatcher that resolved its chord once at startup and cached it. So
 * this spec drives the preferences window, changes the binding on disk, and then goes back to the
 * main window and presses both chords at a real editor.
 *
 * ══ WHY THIS IS ITS OWN FILE, IN THE SERIAL TIER ══
 *
 * It opens the preferences window, which is a child window that takes focus — and throng closes menus
 * and popups when its window loses focus. A spec that does that cannot share a desktop with another
 * headed app, so it is registered in `parallel-plan.json`'s `serial` list (T045). Everything else
 * about Go To Line lives in `goto-line.e2e.ts`, which is parallel-safe precisely because it never
 * opens this window.
 *
 * The capture modal is driven with SYNTHETIC key events, exactly as `preferences-keybindings.e2e.ts`
 * does, so a reserved combination is never handed to the OS.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, settle, cleanupTemp } from './harness.js';

/** The chord the command ships with, and the one it is moved to. Named, not repeated. */
const DEFAULT_CHORD = 'Ctrl+G';
const REBOUND_CHORD = 'F8';

/** Line `n` reads `line-NN`, so the rendered text of a line names its own number. */
const marker = (n: number): string => `line-${String(n).padStart(2, '0')}`;

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-gotokb-'));
  const lines: string[] = [];
  for (let n = 1; n <= 40; n += 1) lines.push(marker(n));
  writeFileSync(join(root, 'lines.txt'), lines.join('\n') + '\n', 'utf8');
  return root;
}

function readBindings(cfgRoot: string): Record<string, string[]> | null {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'keybindings.json'), 'utf8')).bindings;
  } catch {
    return null;
  }
}

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

/** Dispatch a synthetic chord (keydown then keyup) on the prefs window. */
async function sendChord(
  prefs: Page,
  key: string,
  mods: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {},
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

/**
 * The text of the `.cm-gutterElement` beside the caret — SC-006's measurement, reused here so that
 * "the new chord works" means the command DID something rather than merely that a dialog appeared.
 */
async function gutterAtCaret(win: Page, panelId: string): Promise<string> {
  return win.getByTestId(`editor-${panelId}`).evaluate((root) => {
    const caret = root.querySelector('.cm-cursor-primary') as HTMLElement | null;
    if (!caret) throw new Error('no caret is drawn — is the editor focused?');
    const cr = caret.getBoundingClientRect();
    const mid = cr.top + cr.height / 2;
    const hit = Array.from(root.querySelectorAll('.cm-gutters .cm-gutterElement'))
      .map((el) => ({
        text: (el.textContent ?? '').trim(),
        rect: el.getBoundingClientRect(),
        hidden: getComputedStyle(el).visibility === 'hidden',
      }))
      .find((c) => !c.hidden && c.rect.height > 0 && mid >= c.rect.top && mid <= c.rect.bottom);
    if (!hit) throw new Error(`no gutter element beside the caret at y=${mid}`);
    return hit.text;
  });
}

/** An editor panel showing `lines.txt`, with the keyboard in the document. */
async function editorWithFile(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  await win.getByTestId('file-explorer-tree').getByText('lines.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(marker(1), {
    timeout: 8000,
  });
  return pid;
}

/**
 * Put the keyboard in the editor by clicking a visible line.
 *
 * A CLICK, not `element.focus()`: DOM focus is not the same fact as which PANE the application thinks
 * the keyboard is in, and this test opens its file from the tree — which leaves the active pane at
 * Files & Folders, where `navigate.gotoLine` (EDITOR_ONLY) resolves to nothing at all. The first
 * rendered line is used rather than `.cm-content` because Playwright scrolls an element's centre into
 * view before clicking it, and `.cm-content` is the whole document.
 */
async function focusContent(win: Page, panelId: string): Promise<void> {
  const editor = win.getByTestId(`editor-${panelId}`);
  await editor.locator('.cm-content .cm-line').first().click();
  await expect(editor.locator('.cm-editor.cm-focused')).toBeVisible({ timeout: 10_000 });
}

test('Go To Line is listed in Preferences → Key Bindings, is rebindable, and after the rebind the NEW chord works while the OLD one stops (AS-10, SC-012, P1)', async () => {
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-gotokb-'));
  const root = makeProject();
  try {
    await runApp(
      async (app, win) => {
        await settle(win);
        await createProject(win, 'GotoKeybind', root);
        const pid = await editorWithFile(win);

        /* ── AS-10, first clause: listed, named, described, scoped, and showing its chord ── */
        const prefs = await openKeybindings(app, win);
        const row = prefs.getByTestId('binding-navigate.gotoLine');
        await expect(row).toBeVisible();
        await expect(row).toContainText('Go To Line');
        // The DESCRIPTION, not just the label — FR-064 asks for both, and a descriptor with an empty
        // description would satisfy a label-only assertion while telling the user nothing.
        await expect(row.locator('.settings-row__desc')).not.toBeEmpty();
        await expect(prefs.getByTestId('binding-navigate.gotoLine-chord')).toContainText(
          DEFAULT_CHORD,
        );
        // EDITOR-scoped, and the scope column is where a user reads why it is dead in a terminal.
        await expect(prefs.getByTestId('binding-navigate.gotoLine-scope')).toHaveText('Editor');
        // …under the Navigate heading, beside Quick Open.
        await expect(
          prefs.getByTestId('keybindings-group-Navigate').getByTestId('binding-navigate.gotoLine'),
        ).toHaveCount(1);

        /* ── AS-10, second clause: rebind. Capture is ADDITIVE, so the old chord is then removed. ── */
        await row.dblclick();
        await expect(prefs.getByTestId('capture-modal')).toBeVisible();
        await sendChord(prefs, REBOUND_CHORD);
        await expect(prefs.getByTestId('capture-modal')).toBeHidden();
        await expect
          .poll(() => readBindings(cfgRoot)?.['navigate.gotoLine'])
          .toEqual([DEFAULT_CHORD, REBOUND_CHORD]);

        // Wait for the renderer to reflect BOTH pills before removing one, so the click acts on the
        // current two-pill state rather than the stale single-pill one.
        await expect(prefs.getByTestId('binding-navigate.gotoLine-pill-1')).toBeVisible();
        await prefs.getByTestId('binding-navigate.gotoLine-remove-0').click();
        await expect
          .poll(() => readBindings(cfgRoot)?.['navigate.gotoLine'])
          .toEqual([REBOUND_CHORD]);

        /* ── AS-10, third clause: the NEW chord works, at a real editor, live and without a restart ── */
        await win.bringToFront();
        await focusContent(win, pid);
        await win.keyboard.press('Control+Home');

        /*
         * PRESS INSIDE THE POLL, exactly as `keybindings.e2e.ts` does for the zoom accelerators.
         *
         * The binding reaches the main window by a config hot-reload, and the assertion above only
         * established that the file on DISK had changed. A keypress delivered before the renderer
         * has re-read it is simply discarded — so it is the press that has to be retried, not the
         * assertion after it. A single press followed by a retrying `toBeVisible` polls a value
         * nothing is going to change, which is exactly how this failed the first time it was run.
         */
        await expect
          .poll(
            async () => {
              await win.keyboard.press(REBOUND_CHORD);
              return win.getByTestId('gotoline').count();
            },
            { timeout: 10_000 },
          )
          .toBeGreaterThan(0);
        await expect(win.getByTestId('gotoline-input')).toBeFocused();

        // …and it is the command, not merely a dialog: it goes where it is told.
        await win.keyboard.type('27');
        await win.keyboard.press('Enter');
        await expect(win.getByTestId('gotoline')).toHaveCount(0);
        await expect(win.getByTestId(`editor-${pid}`).locator('.cm-editor.cm-focused')).toBeVisible();
        expect(await gutterAtCaret(win, pid)).toBe('27');

        /* ── …and the OLD one stops. The half a cached resolution would silently fail. ── */
        await win.keyboard.press('Control+G');
        await expect(win.getByTestId('gotoline')).toHaveCount(0);
        // The caret did not move either — the retired chord is inert, not merely quiet.
        expect(await gutterAtCaret(win, pid)).toBe('27');

        /*
         * FR-027 / G9 — the CONTENT MENU item, showing its CURRENT chord.
         *
         * Asserted here rather than in `goto-line.e2e.ts` for two reasons, and the second is the
         * interesting one. First, driving a context menu steals focus from any other headed window,
         * so a spec that does it belongs in the serial tier — and this file is already there.
         * Second, "its current chord" is only a claim about anything once the chord has CHANGED: an
         * item that hard-coded `Ctrl+G` would satisfy every assertion made before the rebind above,
         * and fail only here.
         */
        await win.getByTestId(`editor-${pid}`).locator('.cm-content').click({ button: 'right' });
        const item = win.getByTestId('menu-item-Go To Line…');
        await expect(item).toBeVisible();
        await expect(item).toContainText(REBOUND_CHORD);
        await expect(item, 'the menu still names the retired chord').not.toContainText(
          DEFAULT_CHORD,
        );

        // …and it is the command, not a label: choosing it opens the same modal.
        await item.click();
        await expect(win.getByTestId('gotoline')).toBeVisible();
        await expect(win.getByTestId('gotoline-input')).toBeFocused();
        await win.keyboard.press('Escape');
        await expect(win.getByTestId('gotoline')).toHaveCount(0);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(cfgRoot);
    cleanupTemp(root);
  }
});
