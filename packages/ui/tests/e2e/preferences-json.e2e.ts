import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { FILE_OP_TIMEOUT_MS, runApp as runOwnApp, openApp, cleanupTemp, type OpenApp } from './harness.js';
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
test.afterAll(async () => {
  await shared?.close();
  for (const dir of cfgRoots.splice(0)) cleanupTemp(dir);
});
function readSettings(cfgRoot: string): any {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8'));
  } catch {
    return null;
  }
}
/*
 * ONE LAUNCH FOR SEVEN OF THE ELEVEN (034 SC-010).
 *
 * The seeds in this file are not pre-launch state. `JsonTab` reads its document when the JSON
 * tab MOUNTS, not when the app starts, so a seed whose only job is to decide what the editor
 * DISPLAYS is written into one shared config root just before the preferences window opens.
 *
 * Four tests still launch their own app, and each says why at its own declaration.
 *
 * Every shared test seeds `settings.json` first, INCLUDING the three that used to run against an
 * empty root. One root means residue — the first test leaves `Matrix` behind, the blocked-exits
 * test leaves `Cyberpunk`, and the syntax-highlighting test needs the active theme to have a file
 * behind it or its Themes tab opens empty and measures no colours. Seeding every test removes the
 * ordering dependency instead of documenting one.
 *
 * `mode: 'serial'` is not optional: these share a window, a database and a config root, so they
 * must not interleave, and a failure must skip the rest rather than run them against whatever
 * state it left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
/** The shared config root. Still called `cfgRoot`, because every test body already says so. */
let cfgRoot: string;

test.beforeAll(async () => {
  cfgRoot = freshCfgRoot();
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: cfgRoot } });
});

/**
 * Put the document a test wants in front of it, BEFORE it opens the preferences window.
 *
 * Atomic, via the shared helper, so the watcher can never catch a half-written file (#253). The
 * wait is for the APP, not for the editor: the JSON tab reads the file itself on mount, but the
 * active theme — which decides whether the Themes tab has a document at all — comes from the
 * watcher's broadcast, so it polls `data-theme` (the same observable `theme-sweep.e2e.ts` uses)
 * rather than guessing how long that broadcast takes. Every caller in this file seeds a theme.
 */
async function seedSettings(value: { appearance: { theme: string } }): Promise<void> {
  writeSettingsAtomic(cfgRoot, value);
  await expect(shared.win.locator('html')).toHaveAttribute('data-theme', value.appearance.theme, {
    timeout: 8000,
  });
}

/**
 * Run `fn` against the shared app, then dispose of whatever preferences window it left open.
 *
 * The preferences window is a SINGLETON — `openPreferences` focuses the existing one and switches
 * tab rather than creating another — so leaving one open would hang the next test on
 * `app.waitForEvent('window')`, which never fires.
 *
 * `destroy()` rather than `close()` is the load-bearing choice. FR-018 lets an invalid buffer
 * REFUSE a close, and three of these tests deliberately end holding one; a teardown that can be
 * refused is not a teardown.
 */
async function sharedApp(
  fn: (app: ElectronApplication, win: Page) => Promise<void>,
  opts?: never,
): Promise<void> {
  if (opts !== undefined) {
    throw new Error('sharedApp takes no launch options — a test that needs them uses runOwnApp');
  }
  try {
    await fn(shared.app, shared.win);
  } finally {
    await shared.app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
      for (const w of wins.slice(1)) w.destroy();
    });
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

test('the toggle flips all tabs to JSON and stays visible; valid JSON applies, invalid is surfaced', { tag: ['@extended', '@prefs', '@reserve:window'] }, async () => {
  await seedSettings({ appearance: { theme: 'throng' } });
  await sharedApp(
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
      await expect.poll(() => readSettings(cfgRoot)?.appearance?.theme, { timeout: FILE_OP_TIMEOUT_MS }).toBe('Matrix');

      // Invalid JSON → surfaced, not applied (theme stays Matrix), and the user cannot leave.
      await prefs.getByTestId('prefs-mode-toggle').click();
      await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();
      await setEditorText(prefs, 'settings', '{ not valid');
      await expect(prefs.getByTestId('json-invalid')).toBeVisible();
      expect(readSettings(cfgRoot)?.appearance?.theme).toBe('Matrix');
    },
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

/*
 * MOVED to `packages/ui/tests/component/preferences-json-tab.test.ts` (034 FR-045) — five tests:
 *
 *   - 'nothing is written while the user is typing, valid or not (FR-017)'
 *   - 'a standing warning explains when the file is saved, and names it (FR-017)'
 *   - 'the warning names whichever document is open, not always settings.json'
 *   - 'Discard restores the document in effect and leaves the editor open (FR-018a)'
 *   - 'a CLEAN buffer follows the file silently, with no notice'
 *
 * Every one of them launched Electron, started a daemon, opened a second BrowserWindow and typed
 * into a real CodeMirror instance in order to observe a decision the JSON TAB makes in the
 * renderer and nowhere else: whether to call `writeConfig`, which file name to put in a sentence,
 * what `discard()` restores, and which branch of the external-change effect runs. Not one of them
 * read a file, resized a window, or watched a window refuse to close.
 *
 * `StandaloneEditor` is stubbed there with a `<textarea>` carrying the same string-in/string-out
 * contract, so the tab’s real `onChange`, real dirty tracking, real gate registration and the real
 * `JsonDocumentNotice` are all exercised — only the text widget is swapped. Everything CodeMirror
 * actually contributes stays below: syntax colouring, the caret surviving a programmatic sync, and
 * the undo history not containing the document load.
 *
 * FOUR OF THE FIVE LAND STRONGER THAN THEY DID HERE:
 *   - "nothing is written while typing" is asserted on the WRITE BRIDGE never being called,
 *     instead of on a file still holding its old value after a 1200 ms sleep — so a write that
 *     landed and was then reverted can no longer pass it;
 *   - a third claim is added that this file never made: leaving a buffer the user never TOUCHED
 *     writes nothing, which is what stops throng waking its own watcher over a document nobody
 *     changed;
 *   - Discard is asserted to write nothing, which a Discard-then-commit bug would have passed here
 *     while looking identical on screen;
 *   - the warning is checked against THREE documents including a theme file (`Matrix.json`), which
 *     needed a theme to be selected first to reach from here.
 *
 * The clean-buffer test also gained its complement — a DIRTY buffer keeps the user’s text and
 * raises the notice — without which "no notice appeared" passes just as well against a build that
 * never raises one at all.
 *
 * ANTI-VACUITY CONTROL, and it is why the rest can be believed: deleting the `readRaw` member from
 * the fake config bridge fails ALL ELEVEN component cases. Optional chaining makes that a silent
 * no-op in production — the tab still mounts and the notice still renders — so every "X is absent"
 * assertion would otherwise have held over a tab with no document in it.
 *
 * WHAT STAYS HERE, and why: the toggle at the minimum window size and the syntax colouring (real
 * layout and real text rendering, FR-049); closing the Preferences window applying the buffer, the
 * refused close, and the theme with no file behind it (window lifecycle); the invalid document
 * blocking every exit and the nonexistent theme being refused BEFORE the Themes tab (the shell’s
 * gate wiring, which a component test can only re-implement, not exercise); the caret surviving an
 * external change; Overwrite putting the buffer on disk; and a malformed settings.json surviving
 * startup.
 */

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
test('closing the Preferences window applies the JSON buffer (FR-017)', { tag: ['@extended', '@prefs', '@reserve:window'] }, async () => {
  await seedSettings({ appearance: { theme: 'throng' } });
  await sharedApp(
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
/*
 * ONE TEST REMOVED (035) — "a theme that does not exist is refused before it can trap the user", now
 * `packages/ui/tests/component/preferences-app.test.ts`.
 *
 * The trap it prevents: the Themes tab renders the ACTIVE theme, so a name that exists nowhere leaves
 * the user on a screen they cannot use and cannot correct from — correcting it means going back to a
 * tab the broken name is what stopped them leaving. Refusing the name at the document is what keeps
 * that from happening, and the notice listing the themes that DO exist is what makes the refusal
 * actionable.
 *
 * All three of its assertions move together, because they are one requirement: WHICH setting, WHAT
 * the user wrote, and what they may write instead. The component version adds that the name never
 * reached the document at all — the trap needs it WRITTEN to spring, and "the tab did not open" is
 * satisfied by a refusal that wrote it anyway.
 *
 * Red-proven by removing `checkActiveTheme` from `settings-validity.ts:210`: three fail.
 *
 * The test BELOW stays, and its own comment says why: it reaches the trap directly, because deleting
 * or corrupting a theme FILE gets there without this validation ever being involved.
 */

test('a document that is absent or unreadable through no edit of the user’s never traps them', { tag: ['@extended', '@prefs', '@reserve:window'] }, async () => {
  // The trap itself, reached directly rather than through the theme name — because deleting a theme
  // file, or corrupting one, gets here without the validation above ever being involved.
  const cfgRoot = freshCfgRoot({
    'settings.json': '{"appearance":{"theme":"Ghost"}}\n',
  });
  await runOwnApp(
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

/*
 * ONE TEST REMOVED (035) — "an invalid document blocks every exit, and says which values are wrong",
 * now `packages/ui/tests/component/preferences-app.test.ts`.
 *
 * ══ THE WINDOW MOUNTS WITH NO PROVIDERS AT ALL ══
 *
 * `PreferencesApp` IS the window's root: it mounts ThemeProvider, OnEntryProvider, ConfigProvider,
 * NotificationProvider, ConfirmProvider and ResetNoticeProvider itself, so a component test supplies
 * only `window.throng.config` — one seam, at the process boundary. Established by spike before
 * anything was written, as with `PanelPlaceholder` and `TabGroup`.
 *
 * `StandaloneEditor` is stubbed with a textarea, the seam `preferences-json-tab.test.ts` already
 * established and argues for: `.cm-content` is contenteditable and has no value setter, and
 * everything this test is about is UPSTREAM of the widget. What the stub cannot see stays here —
 * syntax colouring, the caret surviving a programmatic sync, the undo history not containing the
 * document load.
 *
 * NINE TESTS REPLACE ONE, and three of them assert things it did not:
 *
 *   - the notice is NOT flashing before anything is refused, so the class arriving is a change
 *     rather than a state that was always there;
 *   - nothing is written on a REFUSED EXIT — a window that refused the exit and wrote the broken
 *     document anyway would satisfy every "does it block?" assertion and leave the user's settings
 *     file unparseable;
 *   - and both exits RE-OPEN once the document parses, with the write asserted rather than just the
 *     exit. A gate that never re-opens is not a gate, it is a trap, and an exit that opened without
 *     writing would lose the edit silently.
 *
 * Red-proven three ways: dropping either `leaveJson()` guard, and dropping the `--flash` class.
 */

/*
 * MOVED to `packages/ui/tests/component/preferences-json-notice.test.ts` (034 FR-045):
 * "the notice names the offending value and what it accepts (FR-019)", plus the presence half of the
 * test below.
 *
 * The first launched Electron, opened the preferences window, switched to JSON mode and typed an
 * out-of-range number into a real CodeMirror instance — to read a `<ul>`. WHAT each problem says is
 * `checkSettingsText`, already covered in `packages/core/tests/unit/settings-validity.test.ts`; how
 * those problems are DRAWN is `json-document-notice.tsx`, which was extracted first and verified
 * against all seventeen tests in this file, unchanged, before anything was deleted.
 *
 * Twelve component tests replace them, and say more than the two did: that the standing FR-017
 * explanation and the invalidity notice are ALTERNATIVES in one slot (mutating that to show both
 * reddens ten of the twelve), that every problem is listed rather than the first, that a
 * document-level problem with no setting behind it still renders, that the notice carries
 * `role="alert"`, and that a refusal flashes the ONE notice rather than raising a second surface —
 * 032's rule, previously asserted only from the far side of a refused window close.
 *
 * WHAT STAYS: that typing invalid text PRODUCES these problems, that the window really refuses to
 * close, and that Discard-and-close leaves the last valid document in effect on disk. No component
 * test can watch a BrowserWindow decline to close.
 */

test('a refused close is answered by Discard and close, from the notice (FR-018/FR-018a)', { tag: ['@extended', '@prefs', '@reserve:window'] }, async () => {
  await seedSettings({ appearance: { theme: 'throng' } });
  await sharedApp(
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
  );
});

test('a malformed settings.json shows its raw text in the JSON editor for repair (FR-043)', { tag: ['@extended', '@prefs', '@reserve:window'] }, async () => {
  const malformed = '{ "appearance": { "theme": "throng" }  <-- broken';
  const cfgRoot = freshCfgRoot({ 'settings.json': malformed });
  await runOwnApp(
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
test('the preferences JSON editors are syntax-highlighted (FR-001a)', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  await seedSettings({ appearance: { theme: 'throng' } });
  await sharedApp(
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
test('Ctrl+Z with no user edits leaves the document alone (#264)', { tag: ['@extended', '@prefs'] }, async () => {
  await seedSettings({ appearance: { theme: 'Matrix' } });

  await sharedApp(
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
test('an external change does not move the caret or replace the buffer under the user', { tag: ['@extended', '@prefs'] }, async () => {
  const cfgRoot = freshCfgRoot({
    'settings.json': `${JSON.stringify(
      { appearance: { theme: 'Matrix' }, editor: { autoSave: false } },
      null,
      2,
    )}\n`,
  });

  await runOwnApp(
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

      /*
       * The fence: wait for the conflict notice itself rather than a duration. `json-external-change`
       * only appears once the watcher has delivered the write AND the tab has decided what to do
       * with it, so its visibility is the positive proof that the opportunity to clobber the buffer
       * has passed — the same thing the 1500ms sleep was standing in for, but falsifiable instead of
       * guessed.
       */
      const external = prefs.getByTestId('json-external-change');
      await expect(external).toBeVisible();

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

test('Overwrite With These Changes keeps the buffer and puts it on disk', { tag: ['@extended', '@prefs'] }, async () => {
  const cfgRoot = freshCfgRoot({
    'settings.json': `${JSON.stringify({ appearance: { theme: 'Matrix' } }, null, 2)}\n`,
  });

  await runOwnApp(
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
      await expect.poll(() => readSettings(cfgRoot)?.appearance?.theme, { timeout: FILE_OP_TIMEOUT_MS }).toBe('Mine');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
