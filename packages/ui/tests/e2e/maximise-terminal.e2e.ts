import { copyFileSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { skipIfHostCannotDeliverReencodedKeys } from './helpers/console-caps.js';
import { FILE_OP_TIMEOUT_MS, TERMINAL_OUTPUT_TIMEOUT_MS, createProject, firstPanelId, runApp } from './harness.js';
import { tmpDir, registerTempCleanup } from './temp-file-helpers.js';

/**
 * 054 US8 (T069) — maximising a REAL terminal, in place (FR-070 – FR-073, FR-071a, research R7).
 *
 * What only this layer can see: that a real xterm in a real window is lifted over the tab body WITHOUT
 * being remounted, that `Alt+Shift+Enter` is taken by throng in the capture phase before xterm encodes
 * it, and that Shift+Enter and Ctrl+Enter still reach a real program over a real ConPTY with their
 * kitty bytes unchanged while the panel is maximised. The window dispatcher's gate over stand-in
 * surfaces is `component/maximise-keys.test.ts`; the modal rules and the DOM node kept are
 * `component/maximise-panel.test.ts`; the encoder's bytes are `terminal-modified-enter.e2e.ts`, whose
 * harness this reuses.
 */

const KITTY = fileURLToPath(new URL('./fixtures/kitty-echo.mjs', import.meta.url)); // enables kitty

// The shell sits at a prompt in the project root, which locks it until the process has gone; removal is
// tracked and best-effort (017 FR-013a/FR-014), as in terminal-modified-enter.
registerTempCleanup();

type Box = { x: number; y: number; width: number; height: number };

/** Every panel box's laid-out rectangle, by panel id. */
async function panelBoxes(win: Page): Promise<Record<string, Box>> {
  return win.evaluate(() => {
    const out: Record<string, Box> = {};
    for (const el of document.querySelectorAll<HTMLElement>('.panel-box[data-panel-id]')) {
      const r = el.getBoundingClientRect();
      out[el.dataset.panelId ?? ''] = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    return out;
  });
}

async function splitFrom(win: Page, panelId: string, row: 'Split Right' | 'Split Down'): Promise<void> {
  const before = await win.locator('.panel-box').count();
  await win.getByTestId(`panel-add-${panelId}`).click();
  await win.getByTestId(`menu-item-${row}`).click();
  await expect(win.locator('.panel-box')).toHaveCount(before + 1);
}

test('Alt+Shift+Enter maximises a real terminal in place; Shift+Enter and Ctrl+Enter still reach its program; restore is exact', { tag: ['@extended', '@window', '@reserve:input'] }, async () => {
  skipIfHostCannotDeliverReencodedKeys();
  const root = tmpDir('throng-max-term-');
  copyFileSync(KITTY, join(root, 'k.mjs'));
  await runApp(async (_app, win) => {
    await createProject(win, 'MAX', root);
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
    await win.getByTestId('terminal-flavour').selectOption('cmd');
    await win.getByTestId(`panel-type-confirm-${pid}`).click();
    const term = win.getByTestId(`terminal-${pid}`);
    await expect(term).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
    await term.click();
    await win.keyboard.type('node k.mjs', { delay: 40 });
    await win.keyboard.press('Enter');
    await expect(term).toContainText('KITTY_ECHO_READY', { timeout: 30000 });

    // Three panels: the terminal, one beside it, one below it.
    await splitFrom(win, pid, 'Split Right');
    await splitFrom(win, pid, 'Split Down');
    const layoutBefore = await panelBoxes(win);
    expect(Object.keys(layoutBefore)).toHaveLength(3);
    // The xterm element itself, so a remount (a NEW element) is visible as a different handle.
    const xtermBefore = await term.locator('.xterm').elementHandle();

    await term.click();
    await win.keyboard.press('Alt+Shift+Enter');
    const tabBody = win.getByTestId('tab-body');
    await expect(tabBody).toHaveAttribute('data-maximised', pid);
    for (const other of Object.keys(layoutBefore).filter((id) => id !== pid)) {
      await expect(win.getByTestId(`panel-${other}`)).toHaveAttribute('inert', '');
    }
    // The terminal now covers the tab body (its margin aside), and it is the SAME xterm.
    const body = (await tabBody.boundingBox())!;
    const maximised = (await panelBoxes(win))[pid]!;
    expect(maximised.width).toBeGreaterThan(body.width - 20);
    expect(maximised.height).toBeGreaterThan(body.height - 20);
    expect(await term.locator('.xterm').evaluate((el, prior) => el === prior, xtermBefore)).toBe(true);

    // a <Shift+Enter> b <Ctrl+Enter> c <Enter> d — with the panel maximised (FR-071a).
    await term.click();
    await win.keyboard.type('a', { delay: 40 });
    await win.keyboard.press('Shift+Enter');
    await win.keyboard.type('b', { delay: 40 });
    await win.keyboard.press('Control+Enter');
    await win.keyboard.type('c', { delay: 40 });
    await win.keyboard.press('Enter');
    await win.keyboard.type('d', { delay: 40 });
    const capFile = join(root, 'cap.bin');
    await expect.poll(() => readFileSync(capFile).toString('latin1'), { timeout: FILE_OP_TIMEOUT_MS }).toContain('d');
    const got = readFileSync(capFile).toString('latin1');
    const between = (l: string, r: string): string => got.slice(got.indexOf(l) + 1, got.indexOf(r));
    // Alt+Shift+Enter was throng's: nothing (no `\x1b[13;4u`, no line break) reached the program first.
    expect(got.indexOf('a'), `capture=${JSON.stringify(got)}`).toBe(0);
    expect(between('a', 'b')).toBe('\x1b[13;2u'); // Shift+Enter — unchanged
    expect(between('b', 'c')).toBe('\x1b[13;5u'); // Ctrl+Enter — unchanged
    expect(between('c', 'd')).toBe('\r'); // plain Enter — unchanged

    // Restore: the layout underneath is exactly as it was (FR-072, FR-073).
    await win.keyboard.press('Alt+Shift+Enter');
    await expect(tabBody).not.toHaveAttribute('data-maximised', /.*/);
    const layoutAfter = await panelBoxes(win);
    for (const [id, box] of Object.entries(layoutBefore)) {
      const now = layoutAfter[id]!;
      expect(Math.abs(now.x - box.x), id).toBeLessThanOrEqual(1);
      expect(Math.abs(now.y - box.y), id).toBeLessThanOrEqual(1);
      expect(Math.abs(now.width - box.width), id).toBeLessThanOrEqual(1);
      expect(Math.abs(now.height - box.height), id).toBeLessThanOrEqual(1);
    }
  });
});
