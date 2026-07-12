import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp } from './harness.js';

// 013 SC-006 — every search and scrollback command is DISCOVERABLE and REBINDABLE in the
// visual Key Bindings editor. The core completeness test already proves each action has a
// descriptor; this proves the descriptors actually reach the user's editor and that one of
// the new commands really can be rebound end-to-end.

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-search-kb-'));
  cfgRoots.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

const SEARCH_ACTIONS = [
  'search.find',
  'search.findNext',
  'search.findPrevious',
  'search.close',
  'search.replace',
  'search.replaceCurrent',
  'search.replaceAll',
];

const SCROLLBACK_ACTIONS = [
  'terminal.scrollLineUp',
  'terminal.scrollLineDown',
  'terminal.scrollPageUp',
  'terminal.scrollPageDown',
  'terminal.scrollToTop',
  'terminal.scrollToBottom',
];

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

test('every search & scrollback command is listed in the Key Bindings editor (SC-006)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);

      for (const action of [...SEARCH_ACTIONS, ...SCROLLBACK_ACTIONS]) {
        await expect(
          prefs.getByTestId(`binding-${action}`),
          `${action} is not exposed in the Key Bindings editor`,
        ).toBeVisible();
      }
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a search command can actually be rebound (FR-017)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);

      await prefs.getByTestId('binding-search.find').dblclick();
      await expect(prefs.getByTestId('capture-modal')).toBeVisible();
      await prefs.evaluate(() => {
        const init: KeyboardEventInit = { key: 'k', bubbles: true, ctrlKey: true, shiftKey: true };
        window.dispatchEvent(new KeyboardEvent('keydown', init));
        window.dispatchEvent(new KeyboardEvent('keyup', init));
      });
      await expect(prefs.getByTestId('capture-modal')).toBeHidden();

      // The new chord is written to the user's keybindings file, alongside the default.
      await expect
        .poll(
          () => {
            try {
              const raw = readFileSync(join(cfgRoot, 'keybindings.json'), 'utf8');
              return (JSON.parse(raw).bindings as Record<string, string[]>)['search.find'];
            } catch {
              return undefined;
            }
          },
          { timeout: 8000 },
        )
        .toEqual(['Ctrl+F', 'Ctrl+Shift+K']);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
