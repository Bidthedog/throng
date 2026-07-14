import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * US3 (007 Phase D) + H2 (2026-07-08): the Key Bindings tab rebinds a shortcut by
 * capturing a chord — capture is ADDITIVE (multiple chords per action, FR-033), a
 * bare single non-excluded key is bindable (FR-033a), an excluded key/reserved OS
 * combo is surfaced as unavailable (FR-032a/033a), individual chords are removable
 * (FR-033b), and a conflict warns + Reassign moves the chord from the other action
 * while keeping this action's existing chords (additive, FR-034). Chords are
 * dispatched as synthetic DOM key events so reserved combos never reach the OS.
 */

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-kb-'));
  cfgRoots.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

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

test('double-click captures a chord and ADDS it (multiple chords per action)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);
      await prefs.getByTestId('binding-view.toggleProjects').dblclick();
      await expect(prefs.getByTestId('capture-modal')).toBeVisible();
      await sendChord(prefs, 'k', { ctrlKey: true }); // Ctrl+K added to the default Ctrl+B
      await expect(prefs.getByTestId('capture-modal')).toBeHidden();
      await expect
        .poll(() => readBindings(cfgRoot)?.['view.toggleProjects'])
        .toEqual(['Ctrl+B', 'Ctrl+K']); // added, not replaced
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a single key binds (no modifier required); double-click does not select text', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);
      const row = prefs.getByTestId('binding-view.toggleExplorer');
      // Double-clicking the row must not highlight its text (FR-031).
      expect(await row.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
      await row.dblclick();
      await sendChord(prefs, 'F7'); // a bare single key is now bindable (F7 is unbound by default)
      await expect(prefs.getByTestId('capture-modal')).toBeHidden();
      await expect
        .poll(() => readBindings(cfgRoot)?.['view.toggleExplorer'])
        .toEqual(['Ctrl+N', 'F7']); // added to the default, not replaced
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the capture ("Bind") dialog does not allow text selection', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);
      await prefs.getByTestId('binding-view.toggleExplorer').dblclick();
      const modal = prefs.getByTestId('capture-modal');
      await expect(modal).toBeVisible();
      // Chrome/dialog text is non-selectable app-wide (inherited from body).
      expect(await modal.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
      expect(
        await prefs
          .getByTestId('capture-modal')
          .locator('.capture-modal__title')
          .evaluate((el) => getComputedStyle(el).userSelect),
      ).toBe('none');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('an excluded single key (Space) is rejected and not saved', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);
      await prefs.getByTestId('binding-view.toggleExplorer').dblclick();
      await sendChord(prefs, ' '); // Space — excluded
      await expect(prefs.getByTestId('capture-error')).toBeVisible();
      await expect(prefs.getByTestId('capture-modal')).toBeVisible(); // stays open
      expect(readBindings(cfgRoot)?.['view.toggleExplorer']).toEqual(['Ctrl+N']); // unchanged
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a chord pill removes just that binding (FR-033b)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);
      // Add Ctrl+K so view.toggleProjects has two chords, then remove the first.
      await prefs.getByTestId('binding-view.toggleProjects').dblclick();
      await sendChord(prefs, 'k', { ctrlKey: true });
      await expect
        .poll(() => readBindings(cfgRoot)?.['view.toggleProjects'])
        .toEqual(['Ctrl+B', 'Ctrl+K']);
      // Wait for the renderer to reflect both chords (the live-reload round-trip) so
      // the remove acts on the current two-pill state, not the stale single-pill one.
      await expect(prefs.getByTestId('binding-view.toggleProjects-pill-1')).toBeVisible();
      await prefs.getByTestId('binding-view.toggleProjects-remove-0').click(); // remove Ctrl+B
      await expect
        .poll(() => readBindings(cfgRoot)?.['view.toggleProjects'])
        .toEqual(['Ctrl+K']);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a reserved OS combo is surfaced as unavailable and not saved', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);
      await prefs.getByTestId('binding-view.toggleExplorer').dblclick();
      await sendChord(prefs, 'F4', { altKey: true }); // Alt+F4 (reserved)
      await expect(prefs.getByTestId('capture-error')).toContainText('reserved');
      await expect(prefs.getByTestId('capture-modal')).toBeVisible();
      expect(readBindings(cfgRoot)?.['view.toggleExplorer']).toEqual(['Ctrl+N']);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a conflicting chord warns and Reassign moves it from the other action', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);
      // Rebind view.toggleExplorer to Ctrl+B — already bound to view.toggleProjects.
      await prefs.getByTestId('binding-view.toggleExplorer').dblclick();
      await sendChord(prefs, 'b', { ctrlKey: true });
      await expect(prefs.getByTestId('capture-conflict')).toBeVisible();
      await prefs.getByTestId('capture-reassign').click();
      await expect(prefs.getByTestId('capture-modal')).toBeHidden();
      // Reassign is additive here (FR-033/034): Ctrl+B is added to view.toggleExplorer's
      // existing chord(s), not a replacement.
      await expect.poll(() => readBindings(cfgRoot)?.['view.toggleExplorer']).toEqual(['Ctrl+N', 'Ctrl+B']);
      // Removed from the previous owner.
      await expect.poll(() => readBindings(cfgRoot)?.['view.toggleProjects']).toEqual([]);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * 016 FR-017b0 · T110 — the SCOPE column.
 *
 * `Ctrl+X` appears twice in this list, and that is correct: one entry cuts a LINE in an editor, the
 * other cuts a FILE in the tree, and they can never both fire. The scope is the only thing on screen
 * that says so. Without it, a user seeing the duplicate concludes throng is broken and "fixes" it by
 * rebinding one of the two — breaking something that worked.
 */
test('every command shows WHERE it is live, and Ctrl+X coexists on two of them (FR-017b0)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);

      // The two commands that share Ctrl+X — shown side by side, each with the scope that makes the
      // sharing legitimate.
      await expect(prefs.getByTestId('binding-editor.cutLine-scope')).toHaveText('Editor');
      await expect(prefs.getByTestId('binding-file.cut-scope')).toHaveText('File Explorer');
      await expect(prefs.getByTestId('binding-editor.cutLine-chord')).toContainText('Ctrl+X');
      await expect(prefs.getByTestId('binding-file.cut-chord')).toContainText('Ctrl+X');

      // …and neither is flagged as a clash: no conflict warning is raised anywhere on the tab, and
      // both keep their chord.
      await expect(prefs.getByTestId('capture-conflict')).toHaveCount(0);

      // A window-level command reads "Everywhere" — one pill, because listing all three contexts
      // says the same thing less clearly and would drown the rows that carry real information.
      const everywhere = prefs.getByTestId('binding-focus.left-scope').locator('.keybinding-scope');
      await expect(everywhere).toHaveCount(1);
      await expect(everywhere).toHaveText('Everywhere');

      // …and a command live in the panels but not the file tree gets TWO SEPARATE pills. Joined into
      // one, "Editor · Terminal" reads as a single exotic scope rather than as two ordinary ones.
      const panels = prefs.getByTestId('binding-editor.save-scope').locator('.keybinding-scope');
      await expect(panels).toHaveCount(2);
      await expect(panels).toHaveText(['Editor', 'Terminal']);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a REAL clash — scopes that intersect — still warns and never silently steals the chord', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);

      // Both of these are EDITOR-scoped, so their scopes intersect: this is a genuine clash, and it
      // must still raise 007 FR-034's warn → Reassign/Cancel.
      //
      // This is the journey a scope-aware `findConflict` could quietly destroy. Make it a shade too
      // permissive — have it answer "no conflict" when it should not — and the last writer silently
      // takes the chord, which is exactly the behaviour FR-017b2 bans. Nothing else catches that:
      // the scope table would still be right, the coexistence test above would still pass, and the
      // only symptom is a binding the user never agreed to give up.
      await prefs.getByTestId('binding-editor.indentLines').dblclick();
      await sendChord(prefs, 'x', { ctrlKey: true }); // …Ctrl+X, owned by editor.cutLine
      await expect(prefs.getByTestId('capture-conflict')).toBeVisible();

      // Cancel keeps BOTH bindings exactly as they were — the chord is not stolen.
      await prefs.getByTestId('capture-cancel').click();
      await expect(prefs.getByTestId('capture-modal')).toBeHidden();
      await expect(prefs.getByTestId('binding-editor.cutLine-chord')).toContainText('Ctrl+X');
      await expect(prefs.getByTestId('binding-editor.indentLines-chord')).not.toContainText('Ctrl+X');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
