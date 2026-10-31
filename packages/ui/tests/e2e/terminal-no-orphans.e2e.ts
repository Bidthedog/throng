import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, daemonPid, daemonRpc, conhostChildren, expectNoOrphanConhosts, cleanupTemp, splitPanelViaMenu } from './harness.js';
import { skipIfElevated } from './admin.js';
import { processTable } from './helpers/processes.js';

// Every test here asserts the terminal's conhost is a child of the DAEMON — true
// only for a non-elevated (normal-integrity) daemon that runs terminals directly.
// An elevated daemon routes them through the de-elevated agent (its conhosts are
// the agent's children), so skip when elevated (see skipIfElevated).
test.beforeEach(() => skipIfElevated());

// Leak regression (T134 / FR-015b / FR-018): terminating a terminal for ANY reason
// must release its OS host — on Windows/ConPTY the per-terminal `conhost.exe --headless`
// process. Before the fix these were orphaned under the daemon (a taskkill of the shell
// does not close the pseudoconsole; node-pty never closes it for a self-exited shell),
// accumulating across every panel-destroy, project-delete and app-close.
//
// Each test opens a real terminal, confirms its conhost appears under the daemon, ends
// it via a specific path, then asserts NO conhost survives beyond the pre-terminal
// baseline. Coverage: panel-destroy (cmd; every detected flavour is asked of the daemon in
// terminal-conhost-reap.integration.test.ts) + project-delete + Unload with End Terminals.
// The app-close "Terminate all" choice is covered by the last test only for what the app
// itself starts (the Resource Monitor's collector).

/**
 * Confirm a Terminal Panel with `flavour` and wait until its ConPTY host has actually
 * spawned (a new conhost under the daemon) — a flavour-agnostic liveness signal (unlike
 * matching a shell prompt, which PSReadLine repaints for PowerShell flavours). Then a
 * short settle so the host has attributed this conhost to its session before we destroy.
 */
async function openTerminal(
  win: Page,
  panelId: string,
  flavour: string,
  dpid: number,
): Promise<void> {
  const before = conhostChildren(dpid).length;
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption(flavour);
  const confirm = win.getByTestId(`panel-type-confirm-${panelId}`);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(win.getByTestId(`terminal-${panelId}`)).toBeVisible();
  await expect
    .poll(() => conhostChildren(dpid).length, { timeout: 20000 })
    .toBeGreaterThan(before);
  /*
   * `NodePtyHost.attributeConhosts()` (platform-windows/src/node-pty-host.ts) maps this conhost to
   * the session with ONE synchronous WMI query, made the instant `pty.spawn()` returns — before this
   * test's own WMI poll above even ran. If THAT query's view of the process table lagged the real
   * spawn (a real WMI/CIM staleness, not an application race we can observe), `session.conhostPid`
   * stays null and nothing retries it until the NEXT terminal spawns. No RPC exposes
   * `session.conhostPid`, so there is nothing external to wait ON — only the daemon's own comment
   * that this window is "~200ms" gives a number to out-wait.
   */
  // sleep-justified: would wait for NodePtyHost.attributeConhosts() to have resolved this conhost's pid, but nothing exposes that internal state — this covers its documented ~200ms attribution window with margin.
  await win.waitForTimeout(1200);
}

/** Click through however many confirmation dialogs the destroy flow shows. */
async function acceptConfirmations(win: Page): Promise<void> {
  const dialog = win.getByTestId('confirm-dialog');
  for (let i = 0; i < 3; i += 1) {
    const appeared = await dialog
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) break;
    await win.getByTestId('confirm-accept').click();
    // Wait for THIS dialog to actually close before the next iteration looks for another one —
    // otherwise a not-yet-closed dialog would be mistaken for a fresh, unconfirmed one.
    await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
}

/*
 * MOVED DOWN (the per-flavour loop): 'panel-destroy reaps the conhost for EVERY detected terminal flavour' opened and
 * destroyed one real terminal per installed shell through the whole app. What differs between flavours is the
 * daemon's end path, not the renderer, so every flavour is now asked directly in
 * packages/daemon/tests/integration/terminal-conhost-reap.integration.test.ts (`terminal.kill` per detected shell,
 * the console host asserted gone before shutdown's sweep). What only the app can show is that destroying a panel SENDS
 * `terminal.kill` at all, so the cmd case stays here, @core.
 */
test('panel-destroy reaps the terminal’s conhost', { tag: ['@core', '@terminal', '@reserve:process'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-orphan-destroy-'));
  try {
    await runApp(async (_app, win, { pipeName }) => {
      await createProject(win, 'Destroyer', root);
      const dpid = await daemonPid(pipeName);
      const baseline = conhostChildren(dpid);

      const pid = await firstPanelId(win);
      // A second Panel so destroying the terminal Panel is allowed (keep ≥ 1).
      await splitPanelViaMenu(win, pid);
      await openTerminal(win, pid, 'cmd', dpid);

      // Destroy the Panel → daemon `terminal.kill` → the conhost must be reaped.
      await win.getByTestId(`panel-close-${pid}`).click();
      await expect(win.getByTestId('confirm-dialog')).toBeVisible();
      await acceptConfirmations(win);
      await expectNoOrphanConhosts(dpid, baseline);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('deleting a project reaps its terminals’ conhosts', { tag: ['@core', '@terminal', '@reserve:process'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-orphan-projdel-'));
  try {
    await runApp(async (_app, win, { pipeName }) => {
      await createProject(win, 'ToDelete', root);
      const dpid = await daemonPid(pipeName);
      const baseline = conhostChildren(dpid);

      await openTerminal(win, await firstPanelId(win), 'cmd', dpid);

      // Delete the project → its terminals must be torn down, not orphaned.
      await win.locator('[data-testid^="project-delete-"]').first().click();
      await acceptConfirmations(win);
      await expectNoOrphanConhosts(dpid, baseline);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('Unload Project and End Terminals reaps a busy terminal with no dialog, paints the row italic, and reloads with a new shell', { tag: ['@extended', '@terminal', '@reserve:process'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-orphan-unload-'));
  try {
    await runApp(async (_app, win, { pipeName }) => {
      await createProject(win, 'UnloadReap', root);
      const dpid = await daemonPid(pipeName);
      const baseline = conhostChildren(dpid);
      const row = win.locator('.project-item', { hasText: 'UnloadReap' });

      // --- Unload Project and End Terminals, with a BUSY shell (046 FR-081, FR-111) ---
      // `projects.unloadTerminalAction` ships as keepRunning, so the plain row keeps and the second
      // row is its opposite. A busy shell is the stronger case for End: nothing about it being busy
      // may stop the reap, and no dialog may ask first (FR-111).
      const pid = await firstPanelId(win);
      await openTerminal(win, pid, 'cmd', dpid);
      await win.getByTestId(`terminal-${pid}`).click();
      await win.keyboard.type('ping -n 30 127.0.0.1');
      await win.keyboard.press('Enter');
      // The real condition: the daemon's OWN busy check for this panel reports true, rather than
      // guessing how long ping.exe takes to become a real child pid.
      await expect
        .poll(
          async () => {
            const result = (await daemonRpc(pipeName, 'terminal.list', { includeBusy: true })) as {
              sessions: Array<{ panelId: string; busy: boolean }>;
            } | null;
            return result?.sessions.find((s) => s.panelId === pid)?.busy ?? false;
          },
          { timeout: 15000 },
        )
        .toBe(true);

      await row.click({ button: 'right' });
      await win.getByTestId('menu-item-Unload Project and End Terminals').click();

      await expectNoOrphanConhosts(dpid, baseline);
      // The row named its action before the click, so nothing asked (FR-111, SC-015).
      await expect(win.getByTestId('confirm-dialog')).toHaveCount(0);

      // The unloaded row paints its name italic (analysis K1, moved from the deleted
      // loaded-projects.e2e.ts — jsdom cannot tell how an element was painted).
      await expect(row).toHaveAttribute('data-loaded', 'false');
      const italic = await row
        .locator('.project-item__name')
        .evaluate((el) => getComputedStyle(el).fontStyle);
      expect(italic).toBe('italic');

      // Select it again — the layout (FR-033: nothing deleted) comes back, and the terminal Panel
      // reattaches through the existing `attach {explicit:false}` path with a NEW shell (contracts/
      // unload.md §2 "The next load": an ended session gets a new shell, not a missing panel).
      await row.locator('[data-testid^="project-switch-"]').click();
      await expect(row).toHaveAttribute('data-loaded', 'true');
      const normal = await row
        .locator('.project-item__name')
        .evaluate((el) => getComputedStyle(el).fontStyle);
      expect(normal).toBe('normal');
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible();
      await expect.poll(() => conhostChildren(dpid).length, { timeout: 20000 }).toBeGreaterThan(baseline.length);

      /*
       * REMOVED (pyramid pass): the second half of this test — 'Unload Project keeps an idle shell alive, with
       * the same shell pid and the same console host' (046 FR-086, Principle III). It re-drove the unload through
       * the row menu to assert two lower facts: Keep sends the terminal RPC nothing
       * (packages/ui/tests/component/unload-keep-terminals.test.ts, 'T124 repro') and a reattach finds the SAME
       * session (packages/daemon/tests/unit/terminal-reattach-identity.test.ts). What stays is what only the app can show — End reaps a BUSY shell with no dialog, and the row paints italic.
       */
    });
  } finally {
    cleanupTemp(root);
  }
});

/*
 * NARROWED: this was 'app-close “Terminate all” reaps every terminal’s conhost' — two live terminals, the exact
 * `terminal.killAll` the close issues, and the daemon's conhosts checked after. The terminal side of that is the
 * same end path 'panel-destroy' and the project-delete test above already drive (and `terminal.killAll` is pinned in
 * packages/daemon/tests/integration/terminal-reattach.integration.test.ts and command-memory-attached). What only a
 * real app can show is below: the Resource Monitor's collector, a process throng itself starts, is gone once the app
 * is (055, Principle III).
 */
test('closing the app leaves no resource-collector process behind', { tag: ['@core', '@terminal', '@reserve:process'] }, async () => {
  // 055 (Principle III): the Resource Monitor's collector is a process throng starts, so it is one this
  // test must see gone once the app is — found by its entry point and parentage, never by image name,
  // since other throng instances (and the user's own) run collectors too.
  let collectors: number[] = [];
  await runApp(async (app) => {
    const mainPid = app.process().pid;
    await expect
      .poll(
        () => {
          collectors = processTable()
            .filter((p) => p.parent === mainPid && p.cmd.includes('resource-collector-entry'))
            .map((p) => p.pid);
          return collectors.length;
        },
        { timeout: 30_000, message: 'the app never started a resource collector to check for' },
      )
      .toBeGreaterThan(0);
  });
  // The app has closed: nothing it started may be left running.
  await expect
    .poll(() => processTable().filter((p) => collectors.includes(p.pid) && p.cmd.includes('resource-collector-entry')).length, {
      timeout: 20_000,
      message: 'a resource-collector-entry process survived the app closing',
    })
    .toBe(0);
});
