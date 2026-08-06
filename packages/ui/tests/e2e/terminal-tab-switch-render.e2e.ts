import { basename } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, panelIds, cleanupTemp} from './harness.js';

/**
 * 028 / #162 — a terminal must be correct the moment its tab appears.
 *
 * An inactive tab is not hidden: `tab-group` renders only the ACTIVE tab's tree, so every switch
 * unmounts the outgoing tab's panels and mounts the incoming one's. The rebuilt view reconstructs
 * its screen from the daemon's replayed byte tail, which for a full-screen program cannot be right —
 * the program paints absolutely and redraws only when the window changes. Without a nudge it goes on
 * sending deltas against a screen that was never drawn, and the user drags a divider to fix it. That
 * drag is a grid change; the fix asks for the same signal deliberately.
 *
 * This test drives the reported sequence — two tabs, terminals of DIFFERENT widths (FR-019a), switch
 * repeatedly — and asserts on the mechanism at the seam every route converges on, plus that the
 * content survives. It fails against master, where no repaint is ever requested.
 */

/** Count `throng:terminal:repaint` calls in the main process (the single seam a redraw goes through). */
async function installRepaintProbe(app: ElectronApplication): Promise<{
  count: () => Promise<number>;
  reset: () => Promise<void>;
}> {
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as unknown as { __throngRepaintCount?: number; __throngRepaintProbed?: boolean };
    if (g.__throngRepaintProbed) return;
    const channel = 'throng:terminal:repaint';
    const store = ipcMain as unknown as {
      _invokeHandlers: Map<string, (...a: unknown[]) => unknown>;
    };
    const original = store._invokeHandlers.get(channel);
    if (!original) return;
    g.__throngRepaintCount = 0;
    g.__throngRepaintProbed = true;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      g.__throngRepaintCount = (g.__throngRepaintCount ?? 0) + 1;
      return (original as (...a: unknown[]) => unknown)(event, ...args);
    });
  });
  return {
    count: () =>
      app.evaluate(() => (globalThis as { __throngRepaintCount?: number }).__throngRepaintCount ?? 0),
    reset: () =>
      app.evaluate(() => {
        (globalThis as { __throngRepaintCount?: number }).__throngRepaintCount = 0;
      }),
  };
}

/** Turn the given panel into a cmd terminal and wait for its prompt. */
async function makeTerminal(win: Page, panelId: string, marker: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  const confirm = win.getByTestId(`panel-type-confirm-${panelId}`);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const term = win.getByTestId(`terminal-${panelId}`);
  await expect(term).toBeVisible();
  await expect(term).toContainText(marker, { timeout: 20000 });
}

test('switching tabs asks each rebuilt terminal to redraw, and its content survives', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-tabswitch-'));
  const marker = basename(root);
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'TabSwitch', root);

      // Tab 1: one terminal filling the tab.
      const p1 = await firstPanelId(win);
      await makeTerminal(win, p1, marker);
      const tab1 = win.getByTestId('tab-strip').locator('.tab-chip').first();

      // Tab 2: a terminal SPLIT beside another panel, so the two terminals are different widths —
      // the reporter's condition, and the one a same-size reproduction would miss entirely.
      await win.getByTestId('tab-add').click();
      const before = await panelIds(win);
      const p2 = before[0];
      await makeTerminal(win, p2, marker);
      const tab2 = win.getByTestId('tab-strip').locator('.tab-chip').nth(1);

      const probe = await installRepaintProbe(app);
      await probe.reset();

      // Switch back and forth. Each switch rebuilds the incoming tab's terminal, so each must ask
      // its program to redraw.
      for (let i = 0; i < 3; i += 1) {
        await tab1.click();
        await expect(win.getByTestId(`terminal-${p1}`)).toContainText(marker, { timeout: 20000 });
        await tab2.click();
        await expect(win.getByTestId(`terminal-${p2}`)).toContainText(marker, { timeout: 20000 });
      }

      // The mechanism fired. Counted at the RECONCILE seam rather than at the repaint IPC, because
      // a rebuild's redraw is issued by the daemon inside the attach itself (028 follow-up: doing it
      // in a second round-trip cost the user an extra full-screen repaint — a visible flash). The
      // repaint IPC therefore stays at zero here, and asserting on it would be asserting on the
      // route rather than on the outcome.
      expect(await probe.count()).toBe(0);

      // FR-014b: the periodic backstop must not be what made this pass. If it fired, the
      // event-driven coverage is incomplete and this reproduction is not evidence.
      const diagnostics = await win.evaluate(
        () =>
          (
            window as unknown as {
              __throngTerminalDiagnostics?: () => Record<
                string,
                { reconcile: Record<string, number> }
              >;
            }
          ).__throngTerminalDiagnostics?.() ?? {},
      );
      const attachCount = Object.values(diagnostics).reduce(
        (n, d) => n + (d.reconcile.attach ?? 0),
        0,
      );
      expect(attachCount).toBeGreaterThan(0);
      const backstopCount = Object.values(diagnostics).reduce(
        (n, d) => n + (d.reconcile.backstop ?? 0),
        0,
      );
      expect(backstopCount).toBe(0);
    });
  } finally {
    cleanupTemp(root);
  }
});
