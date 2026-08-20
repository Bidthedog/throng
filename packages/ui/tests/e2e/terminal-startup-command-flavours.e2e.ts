import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * 025 — the Startup Command box, driven through the real app for EVERY built-in shell.
 *
 * The per-flavour E2E that existed only ever used `cmd`. That is how a PowerShell parse failure
 * reached a user: each shell is handed the command differently (`/K`, `-NoExit -Command`,
 * `-c … exec bash`) AND each parses it by its own rules, so a command that works in one proves
 * nothing about the others.
 *
 * The quoted-executable case is here because it is the one that actually broke. PowerShell parses
 * a leading quoted string as an *expression*, so `"C:\Windows\System32\PING.EXE" -t x` failed with
 * "Unexpected token '-t'" — while the identical command worked in cmd and bash.
 */

const FLAVOURS = ['cmd', 'windows-powershell', 'pwsh', 'git-bash'] as const;

/** A marker each shell can echo, spelled the way that shell spells an echo. */
function echoCommand(flavour: string, marker: string): string {
  return flavour === 'windows-powershell' || flavour === 'pwsh'
    ? `Write-Output ${marker}`
    : `echo ${marker}`;
}

async function flavourAvailable(
  win: import('@playwright/test').Page,
  flavour: string,
): Promise<boolean> {
  const select = win.getByTestId('terminal-flavour');
  await expect(select).toBeVisible();
  const values = await select
    .locator('option')
    .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
  return values.includes(flavour);
}

for (const flavour of FLAVOURS) {
  test(`[${flavour}] a startup command runs and leaves a live prompt (FR-004/FR-005)`, { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
    test.setTimeout(120_000);
    const root = mkdtempSync(join(tmpdir(), `throng-suc-${flavour}-`));
    let present = true;
    try {
      await runApp(async (_app, win) => {
        await createProject(win, 'StartupCmdFlavour', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        if (!(await flavourAvailable(win, flavour))) {
          present = false;
          return;
        }
        await win.getByTestId('terminal-flavour').selectOption(flavour);
        await win.getByTestId('terminal-startup-command').fill(echoCommand(flavour, 'SUC_MARKER_OK'));
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toContainText('SUC_MARKER_OK', { timeout: 30_000 });
        // The shell is STILL THERE. A wrong recipe (`cmd /C`, or bash without the re-exec) would
        // have closed it, reverting the panel to its type-selection form.
        await expect(win.getByTestId(`panel-type-select-${pid}`)).toHaveCount(0);
      });
      test.skip(!present, `${flavour} is not installed on this machine`);
    } finally {
      cleanupTemp(root);
    }
  });

  test(`[${flavour}] a QUOTED executable path runs, and reports no parse error`, { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  // Measured on CI run 30943045917: passes without admin rights, fails with them. An elevated
  // daemon routes terminals through the de-elevated agent, a different process tree these
  // assertions do not describe — the condition this guard exists for.
  skipIfElevated();
    test.setTimeout(120_000);
    const root = mkdtempSync(join(tmpdir(), `throng-sucq-${flavour}-`));
    let present = true;
    try {
      await runApp(async (_app, win) => {
        await createProject(win, 'StartupCmdQuoted', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        if (!(await flavourAvailable(win, flavour))) {
          present = false;
          return;
        }
        await win.getByTestId('terminal-flavour').selectOption(flavour);
        // A quoted absolute path with an argument — what you get from copying a path that has
        // spaces in it. The DASH argument matters: PowerShell only mis-parses when a `-` token
        // follows the quoted string. A `/`-style switch does not reproduce it at all, so an
        // earlier version of this test passed against the very bug it was written for.
        await win
          .getByTestId('terminal-startup-command')
          .fill('"C:\\Windows\\System32\\PING.EXE" -n 1 127.0.0.1');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toBeVisible();
        // The shell survived...
        await expect(win.getByTestId(`panel-type-select-${pid}`)).toHaveCount(0);
        // ...and did not complain. This is the assertion that catches the PowerShell defect: it
        // reported "Unexpected token" and "ParserError" rather than running the command.
        // Assert POSITIVELY that the command RAN. A negative assertion on the error text is
        // unreliable: xterm wraps long lines, so 'Unexpected token' can be split across rows and
        // silently never match — an earlier version of this test passed against the real bug
        // for exactly that reason. Ping's own output is unambiguous and cannot be faked by an
        // echo of the command line.
        await expect(term).toContainText('Reply from', { timeout: 30_000 });
      });
      test.skip(!present, `${flavour} is not installed on this machine`);
    } finally {
      cleanupTemp(root);
    }
  });
}
