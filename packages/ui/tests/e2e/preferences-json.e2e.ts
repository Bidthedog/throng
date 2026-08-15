import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp, cleanupTemp} from './harness.js';
import { writeSettingsAtomic } from './helpers/config-write.js';

/**
 * US5 (007 Phase C): the global UI⇄JSON toggle + standalone JSON editor. The
 * toggle flips all tabs together and stays visible at the minimum window size;
 * valid JSON applies + persists, invalid JSON is surfaced and not applied; the
 * Themes JSON follows the selected theme; a malformed file shows its raw text.
 */
const cfgRoots: string[] = [];
function freshCfgRoot(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-json-'));
  cfgRoots.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) cleanupTemp(dir);
});
function readSettings(cfgRoot: string): any {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8'));
  } catch {
    return null;
  }
}
async function openSettings(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-settings').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  return prefs;
}

/**
 * Replace the CodeMirror editor's content (CM ignores `input.fill`).
 *
 * 032 FR-017: this NO LONGER APPLIES ANYTHING. The 300 ms debounce is gone, so typing changes the
 * buffer and nothing else — the document reaches disk when the user LEAVES the editor. Use
 * {@link leaveJsonEditor} for that.
 */
async function setEditorText(prefs: Page, kind: string, content: string): Promise<void> {
  const editor = prefs.getByTestId(`json-editor-${kind}`).locator('.cm-content');
  await editor.click();
  await prefs.keyboard.press('Control+A');
  await editor.pressSequentially(content);
}

/**
 * Leave the JSON editor, which is what APPLIES the buffer (032, FR-017).
 *
 * The mode toggle is the "closing the JSON view" trigger named first in the clarification. It is
 * also one of the three exits FR-018 blocks while the document is invalid, so a caller that expects
 * the leave to be refused simply asserts the block afterwards rather than calling something else.
 */
async function leaveJsonEditor(prefs: Page): Promise<void> {
  await prefs.getByTestId('prefs-mode-toggle').click();
}

test('the toggle flips all tabs to JSON and stays visible; valid JSON applies, invalid is surfaced', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();

      // Toggle to JSON — the Settings tab now shows the JSON editor.
      await prefs.getByTestId('prefs-mode-toggle').click();
      await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();
      // The code editor is one of the few surfaces that MAY select text (the
      // app-wide user-select:none is lifted for .cm-editor).
      expect(
        await prefs
          .getByTestId('json-editor-settings')
          .locator('.cm-content')
          .evaluate((el) => getComputedStyle(el).userSelect),
      ).toBe('text');
      // Switch to Key Bindings — it too is JSON (global toggle, FR-020).
      await prefs.getByTestId('prefs-tab-keybindings').click();
      await expect(prefs.getByTestId('json-tab-keybindings')).toBeVisible();
      await prefs.getByTestId('prefs-tab-settings').click();

      // The toggle stays visible at the minimum window size (FR-019).
      await app.evaluate(({ BrowserWindow }) => {
        const wins = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
        wins[wins.length - 1].setSize(420, 360); // prefs window minimum
      });
      await expect(prefs.getByTestId('prefs-mode-toggle')).toBeVisible();

      /*
       * Edit valid JSON → applies ON LEAVING, and persists (032 FR-017).
       *
       * The tolerant reader merges the rest over defaults, so a minimal valid document is enough to
       * set the theme. What changed here is WHEN: nothing was written while the text was being
       * typed, which is the whole point — a half-typed value is frequently still valid JSON, and
       * applying it is what pulled the document out from under the user's cursor.
       */
      await setEditorText(prefs, 'settings', '{"appearance":{"theme":"Matrix"}}');
      await leaveJsonEditor(prefs);
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      await expect.poll(() => readSettings(cfgRoot)?.appearance?.theme).toBe('Matrix');

      // Invalid JSON → surfaced, not applied (theme stays Matrix), and the user cannot leave.
      await prefs.getByTestId('prefs-mode-toggle').click();
      await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();
      await setEditorText(prefs, 'settings', '{ not valid');
      await expect(prefs.getByTestId('json-invalid')).toBeVisible();
      expect(readSettings(cfgRoot)?.appearance?.theme).toBe('Matrix');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * 032 FR-017/FR-018/FR-019 — the JSON editor's edit lifecycle.
 *
 * ══ WHAT THESE REPLACE, AND WHY ══
 *
 * Two FR-041 tests used to live here: an external change against a DIRTY buffer raised a conflict
 * banner offering Reload or Keep editing. They are gone because the situation they described is
 * gone, not because they were failing.
 *
 * That banner fired constantly, milliseconds after a keystroke, and the "external change" was
 * almost always throng writing the file itself: the 300 ms debounce applied a half-typed value that
 * happened to parse, 031's bounds guard corrected it out of range on the read back, and wrote the
 * correction. The banner was accurate and useless — it reported a conflict the user had caused by
 * typing, against a document only they were editing.
 *
 * FR-017 removes the write, so it removes the conflict. What is left is a genuine external change —
 * the user's own text editor, another tool — and that is now a NOTE rather than a choice, because
 * the buffer is never overwritten while it is being edited (asserted by the caret test below).
 */
const MID_EDIT = '{"appearance":{"theme":"Matrix"';

async function openSettingsJson(app: ElectronApplication, win: Page): Promise<Page> {
  const prefs = await openSettings(app, win);
  await prefs.getByTestId('prefs-mode-toggle').click();
  await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();
  return prefs;
}

test('nothing is written while the user is typing, valid or not (FR-017)', async () => {
  const cfgRoot = freshCfgRoot({ 'settings.json': '{"appearance":{"theme":"throng"}}\n' });
  await runApp(
    async (app, win) => {
      const prefs = await openSettingsJson(app, win);

      // A COMPLETE, VALID document — under the old debounce this applied within 300 ms.
      await setEditorText(prefs, 'settings', '{"appearance":{"theme":"Matrix"}}');

      // Long enough that "nothing happened" means something: the old debounce was 300 ms.
      await prefs.waitForTimeout(1200);
      expect(
        readSettings(cfgRoot)?.appearance?.theme,
        'a valid buffer must NOT be written while the user is still editing it',
      ).toBe('throng');

      // Leaving is what applies it.
      await leaveJsonEditor(prefs);
      await expect.poll(() => readSettings(cfgRoot)?.appearance?.theme).toBe('Matrix');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * FR-017's THIRD apply trigger — closing the Preferences window — reported as not working.
 *
 * ══ WHAT WAS REPORTED ══
 *
 * "I don't see changes that I make in the JSON editor being reflected in the file saved on disk."
 *
 * Applying on LEAVING rather than on a debounce is deliberate, and the other two triggers are
 * covered: `nothing is written while the user is typing` proves the mode toggle applies, and the
 * blocked-exit test proves a tab switch does. **Closing the window was covered only for an INVALID
 * buffer**, where the point was that it refuses — so the valid path, which is the one a user
 * actually takes to finish an edit, was asserted nowhere.
 *
 * ══ THE SUSPECTED MECHANISM ══
 *
 * The close gate replies "yes, you may close" and main destroys the renderer. The write is issued
 * from `writeConfig`, which dispatches it inside a `.then()` — a microtask AFTER the reply has
 * already been sent. So the reply and the write race, and the renderer can be gone before the write
 * leaves it.
 *
 * Stated as a suspicion because that is what it is until this test says otherwise.
 */
test('closing the Preferences window applies the JSON buffer (FR-017)', async () => {
  const cfgRoot = freshCfgRoot({ 'settings.json': '{"appearance":{"theme":"throng"}}\n' });
  await runApp(
    async (app, win) => {
      const prefs = await openSettingsJson(app, win);

      // A complete, VALID edit — the state a user is in when they have finished and reach for the X.
      await setEditorText(prefs, 'settings', '{"appearance":{"theme":"Matrix"}}');
      expect(
        readSettings(cfgRoot)?.appearance?.theme,
        'nothing may be written while the user is still typing (FR-017)',
      ).toBe('throng');

      // Close it the way the user does: the title bar's own X.
      await Promise.all([
        prefs.waitForEvent('close'),
        prefs.getByTestId('window-close').click(),
      ]);

      // THE ASSERTION. Closing the window is one of FR-017's three apply triggers, so the edit must
      // be on disk — and it must not need the whole application to shut down to get there.
      await expect
        .poll(() => readSettings(cfgRoot)?.appearance?.theme, { timeout: 10_000 })
        .toBe('Matrix');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * FR-017 is the least discoverable thing about this editor, so it is stated on screen.
 *
 * Nothing is written while the user types and there is no moment where the app appears to save. A
 * user who does not know that reads the silence as lost work — which is exactly what happened: the
 * behaviour was reported as a bug by the person who had asked for it. The rule is now visible
 * BEFORE it matters rather than inferable only afterwards.
 */
test('a standing warning explains when the file is saved, and names it (FR-017)', async () => {
  const cfgRoot = freshCfgRoot({ 'settings.json': '{"appearance":{"theme":"throng"}}\n' });
  await runApp(
    async (app, win) => {
      const prefs = await openSettingsJson(app, win);

      // Present from the moment the JSON view opens — before the user has typed anything, which is
      // when knowing the rule is most useful.
      const warning = prefs.getByTestId('json-unsaved-warning');
      await expect(warning).toBeVisible();
      await expect(warning).toContainText(
        'This file will not be saved until you switch back to the UI, switch tab, or close preferences',
      );
      // It names the document, because "this file" is ambiguous in a window with three of them.
      await expect(warning.locator('strong')).toHaveText('settings.json');
      await expect(warning).toContainText('may result in data loss');

      // ── It yields the slot to the error, rather than stacking with it.
      await setEditorText(prefs, 'settings', MID_EDIT);
      await expect(prefs.getByTestId('json-invalid')).toBeVisible();
      await expect(
        prefs.getByTestId('json-unsaved-warning'),
        'the warning and the error share one slot — a user reading about a broken document does not need the general rule as well',
      ).toHaveCount(0);

      // ── And takes it back when the document is valid again.
      await setEditorText(prefs, 'settings', '{"appearance":{"theme":"Matrix"}}');
      await expect(prefs.getByTestId('json-invalid')).toHaveCount(0);
      await expect(prefs.getByTestId('json-unsaved-warning')).toBeVisible();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the warning names whichever document is open, not always settings.json', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettingsJson(app, win);
      await expect(prefs.getByTestId('json-unsaved-warning').locator('strong')).toHaveText(
        'settings.json',
      );

      // The JSON toggle is global, so switching tab stays in JSON mode on a different document.
      await prefs.getByTestId('prefs-tab-keybindings').click();
      await expect(prefs.getByTestId('json-tab-keybindings')).toBeVisible();
      await expect(prefs.getByTestId('json-unsaved-warning').locator('strong')).toHaveText(
        'keybindings.json',
      );
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * THE TRAP: a theme that does not exist, and no way out of the window at all.
 *
 * ══ WHAT WAS REPORTED ══
 *
 * "Open Settings in JSON mode. Edit the theme to a theme that does not exist. Click on Themes. No
 * document is shown. Discard, Discard and close, and switching tab do not work — the user is stuck
 * on the Themes page forever. The only way out is closing throng entirely."
 *
 * ══ THE MECHANISM, WHICH IS TWO DEFECTS ══
 *
 * **One.** `appearance.theme` is a `select` whose valid values are the themes on disk, so the
 * registry declares NO `allowedValues` for it — and the validity check is registry-driven, so a
 * theme name that names nothing passes as valid and is committed on leaving.
 *
 * **Two, and this is the trap.** The Themes tab's JSON document is `{kind:'theme', name:
 * <appearance.theme>}`. That file does not exist, so `readRaw` returns `''`, and an empty buffer
 * does not parse — so the editor opens ALREADY INVALID, on a document the user never touched.
 *
 * Every exit then refuses, including the escape: *Discard* restores the loaded baseline, which is
 * the same empty string, and *Discard and close* discards to that same invalid baseline and is
 * refused by the close gate. FR-018a exists precisely to stop this ("a window that cannot be closed
 * at all is a worse defect than the one FR-018 fixes") and it did not hold, because it assumed the
 * baseline was always something valid to fall back to.
 *
 * ══ WHY BOTH HALVES ARE FIXED ══
 *
 * Validating the theme name stops the user reaching the trap. It does not REMOVE the trap: a theme
 * file deleted by another program, or corrupt on disk, arrives at exactly the same place. So a CLEAN
 * buffer never blocks an exit either — there are no edits to lose, so there is nothing for the block
 * to protect.
 */
test('a theme that does not exist is refused before it can trap the user', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettingsJson(app, win);

      // The user types a theme name that names nothing.
      await setEditorText(prefs, 'settings', '{"appearance":{"theme":"NoSuchTheme"}}');

      // ── It is refused, and the notice lists the themes that DO exist.
      const notice = prefs.getByTestId('json-invalid');
      await expect(notice, 'a theme that does not exist must not be accepted').toBeVisible();
      await expect(notice).toContainText('appearance.theme');
      await expect(notice).toContainText('throng');
      await expect(notice).toContainText('"NoSuchTheme"');

      // ── So the Themes tab cannot be reached with it, which is what produced the trap.
      await prefs.getByTestId('prefs-tab-themes').click();
      await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();
      expect(readSettings(cfgRoot)?.appearance?.theme).not.toBe('NoSuchTheme');

      // ── An existing theme is accepted, and the tab opens.
      await setEditorText(prefs, 'settings', '{"appearance":{"theme":"throng"}}');
      await expect(prefs.getByTestId('json-invalid')).toHaveCount(0);
      await prefs.getByTestId('prefs-tab-themes').click();
      await expect(prefs.getByTestId('json-tab-theme')).toBeVisible();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a document that is absent or unreadable through no edit of the user’s never traps them', async () => {
  // The trap itself, reached directly rather than through the theme name — because deleting a theme
  // file, or corrupting one, gets here without the validation above ever being involved.
  const cfgRoot = freshCfgRoot({
    'settings.json': '{"appearance":{"theme":"Ghost"}}\n',
  });
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      await prefs.getByTestId('prefs-mode-toggle').click();
      await prefs.getByTestId('prefs-tab-themes').click();

      // The Themes JSON tab is open on a theme with no file behind it: an empty, unparseable buffer
      // the user never typed a character into.
      await expect(prefs.getByTestId('json-tab-theme')).toBeVisible();

      // ── They can still leave. Nothing of theirs is at risk, so there is nothing to protect.
      await prefs.getByTestId('prefs-tab-settings').click();
      await expect(
        prefs.getByTestId('json-tab-settings'),
        'a buffer the user never edited must never block an exit',
      ).toBeVisible();

      // ── And the window still closes.
      await Promise.all([
        prefs.waitForEvent('close'),
        prefs.getByTestId('window-close').click(),
      ]);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('an invalid document blocks every exit, and says which values are wrong (FR-018/FR-019)', async () => {
  const cfgRoot = freshCfgRoot({ 'settings.json': '{"appearance":{"theme":"throng"}}\n' });
  await runApp(
    async (app, win) => {
      const prefs = await openSettingsJson(app, win);

      await setEditorText(prefs, 'settings', MID_EDIT);
      await expect(prefs.getByTestId('json-invalid')).toBeVisible();

      // ── Exit 1: switching tab is refused, and the JSON editor is still what is on screen.
      await prefs.getByTestId('prefs-tab-keybindings').click();
      await expect(
        prefs.getByTestId('json-tab-settings'),
        'switching tab must be refused while the document is invalid',
      ).toBeVisible();
      await expect(prefs.getByTestId('json-tab-keybindings')).toHaveCount(0);

      // ── Exit 2: leaving the JSON view is refused too.
      await leaveJsonEditor(prefs);
      await expect(
        prefs.getByTestId('json-tab-settings'),
        'closing the JSON view must be refused while the document is invalid',
      ).toBeVisible();
      await expect(prefs.getByTestId('settings-tab')).toHaveCount(0);

      /*
       * ── And the refusal is VISIBLE, not silent (FR-018's second sentence) — through the ONE
       *    notice, which flashes.
       *
       * There is deliberately no second surface to assert here. Refusing an exit used to raise a
       * toast, and a refused CLOSE used to raise a third strip at the top of the window: one
       * condition, three messages, two of them stating the user could not leave while a Discard
       * button sat a few pixels away. `json-leave-blocked` and `json-close-blocked` are gone.
       */
      const notice = prefs.getByTestId('json-invalid');
      await expect(notice).toBeVisible();
      await expect(
        notice,
        'a refused exit must flash the notice rather than raise another one',
      ).toHaveClass(/json-tab__error--flash/);
      await expect(prefs.getByTestId('json-leave-blocked')).toHaveCount(0);

      // ── It says what is WRONG, not what the user may not do: Discard means they always may.
      await expect(notice).toContainText('This document is not valid:');
      await expect(notice).not.toContainText('cannot leave');

      // ── Nothing was written on the way (FR-017 still holds under a refused exit).
      expect(readSettings(cfgRoot)?.appearance?.theme).toBe('throng');

      // ── Fix it, and every exit opens again.
      await setEditorText(prefs, 'settings', '{"appearance":{"theme":"Cyberpunk"}}');
      await expect(prefs.getByTestId('json-invalid')).toHaveCount(0);
      await leaveJsonEditor(prefs);
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      await expect.poll(() => readSettings(cfgRoot)?.appearance?.theme).toBe('Cyberpunk');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the notice names the offending value and what it accepts (FR-019)', async () => {
  const cfgRoot = freshCfgRoot({ 'settings.json': '{"appearance":{"theme":"throng"}}\n' });
  await runApp(
    async (app, win) => {
      const prefs = await openSettingsJson(app, win);

      // A value that PARSES and is out of range — the case the old "Invalid JSON" banner could not
      // describe at all, because the document was perfectly valid JSON.
      await setEditorText(
        prefs,
        'settings',
        '{"appearance":{"theme":"throng"},"panes":{"projects":{"maxWidth":99999}}}',
      );

      const notice = prefs.getByTestId('json-invalid');
      await expect(notice).toBeVisible();
      // The KEY, so the user knows which value — and the RANGE, so they know what to change it to.
      await expect(notice).toContainText('panes.projects.maxWidth');
      await expect(notice).toContainText('between');
      // And the value they actually typed, so there is no doubt which line is meant.
      await expect(notice).toContainText('99999');
      // The setting's own LABEL, quoted, so the line reads as the row does in the form.
      await expect(notice).toContainText('"Projects pane max width"');
      // The key is set apart from the label rather than run together with it.
      await expect(notice.locator('em')).toContainText('panes.projects.maxWidth');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the notice offers Discard and Discard-and-close from the moment it appears (FR-018a)', async () => {
  const cfgRoot = freshCfgRoot({ 'settings.json': '{"appearance":{"theme":"throng"}}\n' });
  await runApp(
    async (app, win) => {
      const prefs = await openSettingsJson(app, win);

      await setEditorText(prefs, 'settings', MID_EDIT);

      /*
       * BOTH ESCAPES ARE THERE IMMEDIATELY, not once a close has already been refused.
       *
       * The first version showed them only after the user had pressed the X and been rejected —
       * which meant the notice spent most of its life saying "you cannot leave" while the thing
       * that made that untrue was hidden.
       */
      await expect(prefs.getByTestId('json-invalid')).toBeVisible();
      await expect(prefs.getByTestId('json-discard')).toBeVisible();
      await expect(prefs.getByTestId('json-discard-and-close')).toBeVisible();
      await expect(prefs.getByTestId('json-copy-problems')).toBeVisible();

      // Discard alone: the buffer goes back to the document in effect and the notice clears, with
      // the editor still open — the user has abandoned an edit, not left the editor.
      await prefs.getByTestId('json-discard').click();
      await expect(prefs.getByTestId('json-invalid')).toHaveCount(0);
      await expect(prefs.getByTestId('json-editor-settings')).toContainText('throng');
      await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a refused close is answered by Discard and close, from the notice (FR-018/FR-018a)', async () => {
  const cfgRoot = freshCfgRoot({ 'settings.json': '{"appearance":{"theme":"throng"}}\n' });
  await runApp(
    async (app, win) => {
      const prefs = await openSettingsJson(app, win);

      await setEditorText(prefs, 'settings', MID_EDIT);
      await expect(prefs.getByTestId('json-invalid')).toBeVisible();

      // Close the window the way the OS does — not via a React handler, which is exactly why the
      // gate lives in main.
      await app.evaluate(({ BrowserWindow }) => {
        const wins = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
        wins[wins.length - 1].close();
      });

      // Refused — and the refusal FLASHES the one notice rather than raising a second surface.
      const notice = prefs.getByTestId('json-invalid');
      await expect(notice, 'the window must refuse to close on an invalid document').toHaveClass(
        /json-tab__error--flash/,
      );
      await expect(prefs.getByTestId('json-close-blocked')).toHaveCount(0);

      // Taking the escape closes the window, and the last valid document is still in effect —
      // nothing was written, so discarding is genuinely a no-op on the file.
      await Promise.all([
        prefs.waitForEvent('close'),
        prefs.getByTestId('json-discard-and-close').click(),
      ]);
      expect(readSettings(cfgRoot)?.appearance?.theme).toBe('throng');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a malformed settings.json shows its raw text in the JSON editor for repair (FR-043)', async () => {
  const malformed = '{ "appearance": { "theme": "throng" }  <-- broken';
  const cfgRoot = freshCfgRoot({ 'settings.json': malformed });
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      await prefs.getByTestId('prefs-mode-toggle').click();
      await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();
      await expect(prefs.getByTestId('json-editor-settings')).toContainText('<-- broken');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

// 016 FR-001a / T030: throng's OWN configuration files are JSON, and they are among the files a
// user is most likely to be looking at. The preferences JSON tabs are a SECOND CodeMirror view —
// exactly the place a feature added to "the editor" silently fails to arrive.
test('the preferences JSON editors are syntax-highlighted (FR-001a)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      await prefs.getByTestId('prefs-mode-toggle').click();
      await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();

      // Distinct token colours — a key, a string and a number are not all the same colour, which
      // is what plain text would look like.
      const colours = async (kind: string): Promise<string[]> =>
        prefs.evaluate((k) => {
          const spans = document.querySelectorAll(
            `[data-testid="json-editor-${k}"] .cm-line span`,
          );
          const out = new Set<string>();
          spans.forEach((s) => out.add(getComputedStyle(s).color));
          return [...out];
        }, kind);

      await expect.poll(() => colours('settings').then((c) => c.length), { timeout: 8000 }).toBeGreaterThan(1);

      // …and the same for the Key Bindings and Themes documents.
      await prefs.getByTestId('prefs-tab-keybindings').click();
      await expect(prefs.getByTestId('json-tab-keybindings')).toBeVisible();
      await expect.poll(() => colours('keybindings').then((c) => c.length), { timeout: 8000 }).toBeGreaterThan(1);

      await prefs.getByTestId('prefs-tab-themes').click();
      await expect(prefs.getByTestId('json-tab-theme')).toBeVisible();
      await expect.poll(() => colours('theme').then((c) => c.length), { timeout: 8000 }).toBeGreaterThan(1);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * #264 — undo with nothing of the user's to undo must be a no-op.
 *
 * ══ THE DEFECT ══
 *
 * Pressing Ctrl+Z in a preferences JSON editor, having typed nothing, emptied the buffer and raised
 * "Invalid JSON — not applied." Both halves were untrue from the user's chair: nothing they did was
 * undone, and the empty buffer they were looking at was not the document in effect.
 *
 * ══ THE CAUSE ══
 *
 * `StandaloneEditor` mounts with `EditorState.create({ doc: value })`, but the JSON tab's document
 * arrives ASYNCHRONOUSLY — it is read off disk after mount. So the editor mounts EMPTY, and the
 * sync effect then dispatches the document in.
 *
 * That dispatch is an ordinary transaction, so CodeMirror's history records it. The undo stack is
 * therefore `[empty] -> [document]` before the user has touched anything, and Ctrl+Z faithfully
 * undoes the only entry it has: the load itself.
 *
 * It also explains the reported recovery — switching tabs and back re-reads the file and
 * re-dispatches, which looks like self-healing and is really just the same bug running forwards.
 *
 * The fix annotates the programmatic sync with `Transaction.addToHistory.of(false)`: loading a
 * document is not an edit, so it does not belong in the history of edits.
 */
test('Ctrl+Z with no user edits leaves the document alone (#264)', async () => {
  const cfgRoot = freshCfgRoot({
    'settings.json': JSON.stringify({ appearance: { theme: 'Matrix' } }, null, 2),
  });

  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      await prefs.getByTestId('prefs-mode-toggle').click();
      await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();

      const editor = prefs.getByTestId('json-editor-settings').locator('.cm-content');
      await expect(editor).toContainText('Matrix', { timeout: 20_000 });
      const loaded = await editor.innerText();

      // Focus the editor and undo, having typed NOTHING.
      await editor.click();
      await prefs.keyboard.press('Control+z');

      // The document is still there. On master the buffer is emptied by undoing its own load.
      await expect(editor, 'undo must not reach past the user\'s own edits').toContainText('Matrix');
      expect(await editor.innerText()).toBe(loaded);

      // And no banner, because nothing invalid was ever applied.
      await expect(
        prefs.getByTestId('json-invalid'),
        'an untouched document must not be reported as invalid JSON',
      ).toHaveCount(0);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * The JSON editor must not move the user's caret, and must not adopt a document under them.
 *
 * ══ WHAT WAS REPORTED ══
 *
 * "If I alter a value and don't finish typing a valid value quick enough, the file refreshes and the
 * caret goes back to line 1, column 1."
 *
 * ══ THE MECHANISM ══
 *
 * Two things compound.
 *
 * The 300 ms debounce fires on whatever is in the buffer, and a half-typed value is often still
 * VALID JSON — `10` on its way to `15` is `1` for a moment. So it is written. Main then reads it
 * back, 031's bounds guard finds it out of range, corrects it and WRITES THE CORRECTION BACK. That
 * document differs from `lastAppliedRef`, so the tab treats it as an external change.
 *
 * `dirtyRef` is false at that instant — the apply had just cleared it, and the user has paused — so
 * the external branch adopts it: `setText(raw)`. `StandaloneEditor`'s sync then replaces the whole
 * document (`from: 0, to: current.length`), and a full replace necessarily drops the selection at
 * position 0.
 *
 * ══ WHY THE TEST WRITES THE FILE DIRECTLY ══
 *
 * The bounds-correction round trip is timing-dependent and needs a setting with a range. An external
 * write reproduces the same condition deterministically — it is the same code path from the tab's
 * point of view, which is what is under test — and it uses the shared atomic helper so the watcher
 * can never catch a half-written file (#253).
 */
test('an external change does not move the caret or replace the buffer under the user', async () => {
  const cfgRoot = freshCfgRoot({
    'settings.json': `${JSON.stringify(
      { appearance: { theme: 'Matrix' }, editor: { autoSave: false } },
      null,
      2,
    )}\n`,
  });

  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      await prefs.getByTestId('prefs-mode-toggle').click();
      await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();

      const editor = prefs.getByTestId('json-editor-settings').locator('.cm-content');
      await expect(editor).toContainText('Matrix', { timeout: 20_000 });

      /*
       * Put the caret on a line that HAS CONTENT, and record which one.
       *
       * `.cm-activeLine` is the observable — CodeMirror marks the line holding the caret — but the
       * probe has to land somewhere with text in it. A first version pressed Ctrl+End, which lands
       * on the trailing empty line after the closing brace, so the assertion compared "" to "" and
       * would have passed no matter what the product did.
       */
      await editor.getByText('"autoSave"').click();

      /*
       * AND MAKE AN EDIT, because that is what the report describes — "if I ALTER a value…".
       *
       * A revision of this test only clicked, leaving the buffer clean. That mattered once, when a
       * clean buffer meant "the debounce just applied and cleared the dirty flag"; it does not now,
       * because FR-017 removed the debounce and a clean buffer means the user has genuinely typed
       * nothing. A clean buffer FOLLOWS the file deliberately (015 FR-013b needs it, so a reset
       * pressed from the toolbar refreshes what is on screen), so testing the protection through one
       * would be testing the wrong branch.
       */
      await prefs.keyboard.press('End');
      await prefs.keyboard.type(' ');
      const activeBefore = await prefs.locator('.cm-activeLine').innerText();
      expect(activeBefore, 'the caret must start on a line with content').toContain('autoSave');

      // An external change lands while the user is sitting in the editor with unsaved edits.
      writeSettingsAtomic(cfgRoot, {
        appearance: { theme: 'Cyberpunk' },
        editor: { autoSave: false },
      });

      // Give the watcher time to deliver it — this is a NEGATIVE assertion, so it has to wait long
      // enough that "nothing happened" means something.
      await prefs.waitForTimeout(1500);

      // ── The caret has not been dragged back to the top.
      const activeAfter = await prefs.locator('.cm-activeLine').innerText();
      expect(
        activeAfter,
        'an external change must not move the user\'s caret',
      ).toBe(activeBefore);

      // ── And the buffer the user was working in is still theirs.
      await expect(
        editor,
        'the document must not be swapped under the user while they are editing it',
      ).toContainText('Matrix');

      // ── The change is not swallowed either: it is offered, naming the file and both actions.
      const external = prefs.getByTestId('json-external-change');
      await expect(external).toBeVisible();
      await expect(external).toContainText('settings.json');
      await expect(external).toContainText('has changed on disk');
      await expect(prefs.getByTestId('json-external-reload')).toBeVisible();
      await expect(prefs.getByTestId('json-external-overwrite')).toBeVisible();

      // ── Reload From Disk adopts the file and drops the user's edit, as it says.
      await prefs.getByTestId('json-external-reload').click();
      await expect(editor).toContainText('Cyberpunk');
      await expect(prefs.getByTestId('json-external-change')).toHaveCount(0);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * The other half of the external-change rule, and the one that has no notice at all.
 *
 * A buffer nobody has typed in has nothing of the user's to protect, so following the file is simply
 * showing the truth — and a notice there would report an event with no consequence. It is also what
 * 015 FR-013b requires: a reset pressed from the toolbar while the JSON view is open must refresh
 * the visible document, and pressing a button is not typing.
 */
test('a CLEAN buffer follows the file silently, with no notice', async () => {
  const cfgRoot = freshCfgRoot({
    'settings.json': `${JSON.stringify({ appearance: { theme: 'Matrix' } }, null, 2)}\n`,
  });

  await runApp(
    async (app, win) => {
      const prefs = await openSettingsJson(app, win);
      const editor = prefs.getByTestId('json-editor-settings').locator('.cm-content');
      await expect(editor).toContainText('Matrix', { timeout: 20_000 });

      // The user is even sitting in the editor — they simply have not typed.
      await editor.getByText('"theme"').click();

      writeSettingsAtomic(cfgRoot, { appearance: { theme: 'Cyberpunk' } });

      // Reflected immediately, and NOT announced.
      await expect(editor).toContainText('Cyberpunk');
      await expect(
        prefs.getByTestId('json-external-change'),
        'a clean buffer following the file is not an event worth a notice',
      ).toHaveCount(0);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('Overwrite With These Changes keeps the buffer and puts it on disk', async () => {
  const cfgRoot = freshCfgRoot({
    'settings.json': `${JSON.stringify({ appearance: { theme: 'Matrix' } }, null, 2)}\n`,
  });

  await runApp(
    async (app, win) => {
      const prefs = await openSettingsJson(app, win);
      const editor = prefs.getByTestId('json-editor-settings').locator('.cm-content');
      await expect(editor).toContainText('Matrix', { timeout: 20_000 });

      // An unsaved edit of the user's…
      await setEditorText(prefs, 'settings', '{"appearance":{"theme":"Mine"}}');
      // …and someone else changes the file underneath it.
      writeSettingsAtomic(cfgRoot, { appearance: { theme: 'Theirs' } });
      await expect(prefs.getByTestId('json-external-change')).toBeVisible();

      // The user chooses their own version. It goes to disk NOW — the second action is a write, not
      // merely a dismissal, which is why the two buttons are named for what they do.
      await prefs.getByTestId('json-external-overwrite').click();
      await expect(prefs.getByTestId('json-external-change')).toHaveCount(0);
      await expect.poll(() => readSettings(cfgRoot)?.appearance?.theme).toBe('Mine');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
