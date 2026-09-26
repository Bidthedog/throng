import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  runApp,
  createProject,
  firstPanelId,
  daemonPid,
  daemonRpc,
  conhostChildren,
  probeConhostChildren,
  expectNoOrphanConhosts, cleanupTemp} from './harness.js';
import { skipIfElevated } from './admin.js';

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
// baseline. Coverage: every detected flavour (panel-destroy) + project-delete + the
// exact `terminal.killAll` the app-close "Terminate all" choice issues.

/** The flavour ids the type-selection form offers on THIS machine. */
async function detectedFlavours(win: Page, panelId: string): Promise<string[]> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
  return win
    .getByTestId('terminal-flavour')
    .locator('option')
    .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
}

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

/**
 * The pids of `image` processes whose parent is `parentPid` — for a non-elevated daemon, the shells
 * its ConPTY sessions launched. `null` when the OS query itself failed, so a broken probe can never
 * read as "the same shells" or as "no shells".
 */
function shellChildren(parentPid: number, image: string): number[] | null {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq '${image}' -and $_.ParentProcessId -eq ${parentPid} } | ForEach-Object { $_.ProcessId }`,
      ],
      { encoding: 'utf8', timeout: 8000, windowsHide: true },
    );
    return out
      .split(/\r?\n/)
      .map((l) => Number(l.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
  } catch {
    return null;
  }
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

test('panel-destroy reaps the conhost for EVERY detected terminal flavour', { tag: ['@core', '@terminal', '@reserve:process'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-orphan-destroy-'));
  try {
    await runApp(async (_app, win, { pipeName }) => {
      await createProject(win, 'Destroyer', root);
      const dpid = await daemonPid(pipeName);
      const baseline = conhostChildren(dpid);

      const flavours = await detectedFlavours(win, await firstPanelId(win));
      expect(flavours.length).toBeGreaterThan(0);

      /*
       * The budget has to scale with the work, because this test's cost is not fixed.
       *
       * It opens and destroys a real terminal PER INSTALLED FLAVOUR, and each round spawns several
       * `powershell.exe` probes to ask the OS which conhosts the daemon owns. On a machine with two
       * shells that fits inside Playwright's default 30s; on one with five, or when PowerShell is
       * slow because the machine is busy, it cannot — and the test then failed as a flat TIMEOUT,
       * with no assertion having failed and nothing to point at.
       *
       * That is a measurement problem wearing a defect's clothes: it reports "terminals leak" on a
       * loaded machine and says nothing at all about terminals. Sizing the budget by the actual
       * flavour count keeps the assertion honest on any machine.
       */
      test.setTimeout(20_000 + flavours.length * 25_000);

      for (const flavour of flavours) {
        const pid = await firstPanelId(win);
        // A second Panel so destroying the terminal Panel is allowed (keep ≥ 1).
        await win.getByTestId(`panel-add-${pid}`).click();
        await openTerminal(win, pid, flavour, dpid);

        // Destroy the Panel → daemon `terminal.kill` → the conhost must be reaped.
        await win.getByTestId(`panel-close-${pid}`).click();
        await expect(win.getByTestId('confirm-dialog')).toBeVisible();
        await acceptConfirmations(win);
        await expectNoOrphanConhosts(dpid, baseline);
      }
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

test('Unload Project and End Terminals reaps a busy terminal, and Unload Project keeps an idle shell alive, through the row menu', { tag: ['@extended', '@terminal', '@reserve:process'] }, async () => {
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
      // The real condition for "settled, and idle" (the daemon's OWN busy check) rather than a fixed
      // wait for attribution to have happened.
      await expect
        .poll(
          async () => {
            const result = (await daemonRpc(pipeName, 'terminal.list', { includeBusy: true })) as {
              sessions: Array<{ panelId: string; busy: boolean }>;
            } | null;
            return result?.sessions.find((s) => s.panelId === pid)?.busy ?? null;
          },
          { timeout: 15000 },
        )
        .toBe(false);

      // --- Unload Project (default keepRunning), with only an IDLE shell (FR-086, Principle III) ---
      // Keep Terminals Running keeps EVERY terminal, idle shells included: the same shell process,
      // and the same ConPTY host, are still there after the unload and after the project is
      // selected again — the panel reattaches rather than spawning a new shell.
      const shellsBefore = shellChildren(dpid, 'cmd.exe');
      expect(shellsBefore, 'the shell probe failed').not.toBeNull();
      expect(shellsBefore, 'exactly one cmd.exe shell under the daemon').toHaveLength(1);
      const hostsBefore = probeConhostChildren(dpid);
      expect(hostsBefore.ok, 'the conhost probe failed').toBe(true);
      const hostsKept = hostsBefore.pids.filter((p) => !baseline.includes(p)).sort((a, b) => a - b);
      expect(hostsKept).toHaveLength(1);

      await row.click({ button: 'right' });
      await win.getByTestId('menu-item-Unload Project').click();
      await expect(row).toHaveAttribute('data-loaded', 'false');
      await expect(win.getByTestId('confirm-dialog')).toHaveCount(0);

      await row.locator('[data-testid^="project-switch-"]').click();
      await expect(row).toHaveAttribute('data-loaded', 'true');
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible();
      // The reattached session answers the daemon's own list as the same idle panel.
      await expect
        .poll(
          async () => {
            const result = (await daemonRpc(pipeName, 'terminal.list', { includeBusy: true })) as {
              sessions: Array<{ panelId: string; busy: boolean }>;
            } | null;
            return result?.sessions.find((s) => s.panelId === pid)?.busy ?? null;
          },
          { timeout: 15000 },
        )
        .toBe(false);
      expect(shellChildren(dpid, 'cmd.exe'), 'the idle shell survived Unload with the same pid').toEqual(shellsBefore);
      const hostsAfter = probeConhostChildren(dpid);
      expect(hostsAfter.ok, 'the conhost probe failed').toBe(true);
      expect(hostsAfter.pids.filter((p) => !baseline.includes(p)).sort((a, b) => a - b)).toEqual(hostsKept);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('app-close “Terminate all” reaps every terminal’s conhost', { tag: ['@core', '@terminal', '@reserve:process'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-orphan-closeall-'));
  try {
    await runApp(async (_app, win, { pipeName }) => {
      await createProject(win, 'CloseAll', root);
      const dpid = await daemonPid(pipeName);
      const baseline = conhostChildren(dpid);

      // Two live terminals in two Panels.
      const pidA = await firstPanelId(win);
      await win.getByTestId(`panel-add-${pidA}`).click();
      await openTerminal(win, pidA, 'cmd', dpid);
      const pidB = (await win.locator('.panel-box').evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.panelId ?? ''),
      )).find((id) => id !== pidA)!;
      await openTerminal(win, pidB, 'cmd', dpid);
      expect(conhostChildren(dpid).length).toBeGreaterThanOrEqual(baseline.length + 2);

      // The exact call the app-close "Terminate all" choice issues (main.ts).
      await daemonRpc(pipeName, 'terminal.killAll', {});
      await expectNoOrphanConhosts(dpid, baseline);
    });
  } finally {
    cleanupTemp(root);
  }
});
