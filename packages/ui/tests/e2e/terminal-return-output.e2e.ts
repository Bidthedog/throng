import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { cleanupTemp, createProject, firstPanelId, runApp, splitPanelViaMenu, switchProject, TEST_SHELL } from './harness.js';

/**
 * Layer: E2E — 061 SC-007, SC-010 and Focus Mode: that a real tab or project switch joins the replay to live output and
 * that a panel in the shown tab stays subscribed. Each hop's logic is proved below this; only the journey is here.
 */

async function makeShell(win: Page, panelId: string, marker: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption(TEST_SHELL);
  await win.getByTestId(`panel-type-confirm-${panelId}`).click();
  await expect(win.getByTestId(`terminal-${panelId}`)).toContainText(marker, { timeout: 20_000 });
}

async function run(win: Page, panelId: string, command: string): Promise<void> {
  await win.getByTestId(`terminal-${panelId}`).click();
  await win.keyboard.type(command);
  await win.keyboard.press('Enter');
}

/** Every buffer line of the panel's terminal, read through the view's own scrollback. */
async function bufferNumbers(win: Page, panelId: string): Promise<number[]> {
  return win.evaluate((id) => {
    const lines = (window as unknown as { __throngTerminalLines?: (panel: string) => string[] }).__throngTerminalLines?.(id) ?? [];
    return lines.flatMap((line) => {
      const match = /^N(\d+)$/.exec(line.trim());
      return match ? [Number(match[1])] : [];
    });
  }, panelId);
}

test('coming back to a project shows every line once, in order', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-return-'));
  const other = mkdtempSync(join(tmpdir(), 'throng-return-other-'));
  writeFileSync(join(root, 'count.cjs'), `let n = 0; const t = setInterval(() => { console.log('N' + (n += 1)); if (n >= 4000) clearInterval(t); }, 1);\n`);
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Away', other);
      await createProject(win, 'Numbers', root);
      const panelId = await firstPanelId(win);
      await makeShell(win, panelId, basename(root));
      await run(win, panelId, 'node count.cjs');

      for (let i = 0; i < 20; i += 1) {
        await switchProject(win, 'Away');
        await switchProject(win, 'Numbers');
      }

      await expect
        .poll(async () => (await bufferNumbers(win, panelId)).at(-1), { timeout: 40_000 })
        .toBe(4000);
      const seen = await bufferNumbers(win, panelId);
      expect(seen).toEqual(Array.from({ length: seen.length }, (_, i) => seen[0]! + i));
      expect(seen.length).toBe(4000);
    });
  } finally {
    cleanupTemp(root);
    cleanupTemp(other);
  }
});

test('a panel hidden by another panel’s Focus Mode keeps its output', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.setTimeout(60_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-focus-'));
  writeFileSync(join(root, 'later.cjs'), `setTimeout(() => console.log('HIDDEN_OUTPUT_' + 61), 2000);\n`);
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Focus', root);
      const first = await firstPanelId(win);
      await makeShell(win, first, basename(root));
      await splitPanelViaMenu(win, first);
      const form = await win.locator('[data-testid^="panel-type-form-"]').first().getAttribute('data-testid');
      const second = form!.replace('panel-type-form-', '');
      await makeShell(win, second, basename(root));

      await run(win, second, 'node later.cjs');
      await win.getByTestId(`terminal-${first}`).click();
      await win.keyboard.press('Alt+Shift+Enter');
      await expect(win.getByTestId('tab-body')).toHaveAttribute('data-maximised', first);
      await expect
        .poll(async () => win.evaluate((id) => (window as unknown as { __throngTerminalLines?: (p: string) => string[] }).__throngTerminalLines?.(id).join('\n') ?? '', second), { timeout: 15_000 })
        .toContain('HIDDEN_OUTPUT_61');

      await win.keyboard.press('Alt+Shift+Enter');
      await expect(win.getByTestId(`terminal-${second}`)).toContainText('HIDDEN_OUTPUT_61');
    });
  } finally {
    cleanupTemp(root);
  }
});
