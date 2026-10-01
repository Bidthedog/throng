/**
 * 048 US3 (FR-020 – FR-025, SC-003) and FR-091 — splitting a panel from the keyboard, where only a
 * running application can answer.
 *
 * ══ WHAT A CHEAPER LAYER CANNOT SEE ══
 *
 * `tests/component/split-mode.test.ts` drives every split-mode rule through the window dispatcher in
 * jsdom: the arrow with modifiers held and released, Escape, another key, the timeout, blur, another
 * panel, the re-arm. What it cannot observe is a REAL SHELL not receiving the strokes (FR-023, SC-003):
 * xterm's hidden textarea holds the keystroke, ConPTY turns a leaked `Ctrl+Shift+Alt+End` into a
 * `1;8`-modified End and a leaked Escape clears cmd's line, and whether any of that happens is decided
 * by the capture-phase listener in the shipped app. And it cannot open a sub-workspace window, which
 * is a separate renderer realm that FR-091 says must split by chord exactly as the main window does.
 *
 * ══ THE SENTINEL ══
 *
 * A made-up command typed WITHOUT Enter, then every chord variant, then Enter. cmd answers with the
 * line it actually received, quoted: `'zqsplit048' is not recognized…`. A leaked Escape would have
 * cleared the line (no quote at all); a leaked arrow would have recalled or moved; a leaked modified
 * End would have typed its escape sequence into the quote. So the one assertion is exact.
 *
 * ══ TIER: SERIAL ══
 *
 * A real `cmd` (starves at high worker counts) and, in the second test, a context menu (throng closes
 * menus on blur) — `parallel-plan.json` lists it.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, panelIds, cleanupTemp } from './harness.js';

const SENTINEL = 'zqsplit048';

/** Right-click the panel handle and sync it into a brand-new sub-workspace window. */
async function syncToNewSubWorkspace(app: ElectronApplication, win: Page, panelId: string): Promise<Page> {
  await win.getByTestId(`panel-handle-${panelId}`).click({ button: 'right' });
  await win.getByTestId('menu-item-Sync to').click();
  const [child] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('menu-item-New Sub-workspace').click(),
  ]);
  await child.waitForLoadState('domcontentloaded');
  return child;
}

test('neither stroke of a split chord reaches a real shell, completed or cancelled', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-splitmode-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SplitMode', root);
      const term = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${term}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${term}`).click();
      const terminal = win.getByTestId(`terminal-${term}`);
      await expect(terminal).toContainText(basename(root), { timeout: 30_000 });

      // The sentinel sits on cmd's line, un-entered, through every chord below.
      await terminal.click();
      await win.keyboard.type(SENTINEL);
      await expect(terminal).toContainText(SENTINEL, { timeout: 10_000 });

      // ── Held: Ctrl+Shift+Alt stay down from End through the arrow (FR-020a). ──
      await win.keyboard.down('Control');
      await win.keyboard.down('Shift');
      await win.keyboard.down('Alt');
      await win.keyboard.press('End');
      await win.keyboard.press('ArrowDown');
      await win.keyboard.up('Alt');
      await win.keyboard.up('Shift');
      await win.keyboard.up('Control');
      await expect(win.locator('.panel-box')).toHaveCount(2);

      // ── Released: the arrow on its own after the first stroke. ──
      await terminal.click();
      await win.keyboard.press('Control+Shift+Alt+End');
      await win.keyboard.press('ArrowRight');
      await expect(win.locator('.panel-box')).toHaveCount(3);

      // ── Cancelled: Escape ends split mode and is consumed (FR-022). ──
      await terminal.click();
      await win.keyboard.press('Control+Shift+Alt+End');
      await win.keyboard.press('Escape');
      await expect(win.locator('.panel-box')).toHaveCount(3);

      // cmd reports the line it received: exactly the sentinel, nothing added, nothing cleared.
      await terminal.click();
      await win.keyboard.press('Enter');
      await expect(terminal).toContainText(`'${SENTINEL}' is not recognized`, { timeout: 15_000 });
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a sub-workspace window splits by chord through the same dispatcher (FR-091)', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-splitmode-sub-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'SplitModeSub', root);
      const a = await firstPanelId(win);
      const child = await syncToNewSubWorkspace(app, win, a);
      try {
        await expect(child.locator('.panel-box')).toHaveCount(1);
        await child.bringToFront();
        await child.getByTestId(`panel-${a}`).click();

        await child.keyboard.press('Control+Shift+Alt+End');
        await child.keyboard.press('ArrowRight');

        await expect(child.locator('.panel-box')).toHaveCount(2);
        // The split belongs to this window only (FR-004).
        expect(await panelIds(win)).toEqual([a]);
      } finally {
        if (!child.isClosed()) await child.close();
      }
    });
  } finally {
    cleanupTemp(root);
  }
});
