import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { adminTest, skipWithoutInteractiveDesktop } from './admin.js';

// FR-025c (mixed mode): with an ELEVATED daemon, a Terminal confirmed WITHOUT
// "run as admin" MUST run **de-elevated** (medium integrity / "User"); one confirmed
// WITH it MUST run **elevated** ("Admin"). Today ALL terminals in admin mode run
// elevated regardless of the checkbox — these tests pin that bug (and the separate
// "git bash doesn't launch in admin mode" bug).
//
// Elevation-gated: the mixed-mode matrix is only meaningful when the TEST PROCESS is
// itself elevated (so the daemon it spawns is elevated). Run it that way with
// `npm run test:e2e:admin`. At medium integrity the tests assert the baseline
// (everything runs as "User") and log — loudly, never a silent pass — that the
// elevated matrix was skipped.

// Each probe prints `THRONG_IL=<value>` where <value> is produced by RUNTIME
// expansion — `!errorlevel!` (delayed), `$?`, `$(...)` — so the value NEVER appears
// in the (echoed) command line, only in the output. That lets us substring-match the
// result unambiguously (xterm's rendered text can't be split into clean lines).
//   admin → THRONG_IL=0 (cmd/bash) or THRONG_IL=True (PowerShell)
//   user  → THRONG_IL=<non-zero> (cmd/bash) or THRONG_IL=False (PowerShell)
const PS_PROBE =
  `Write-Output "THRONG_IL=$(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"`;
const PROBE: Record<string, string> = {
  cmd: `cmd /v:on /c "net session >nul 2>&1 & echo THRONG_IL=!errorlevel!"`,
  'windows-powershell': PS_PROBE,
  pwsh: PS_PROBE,
  'git-bash': `net session >/dev/null 2>&1; echo THRONG_IL=$?`,
};

/** Match the OUTPUT token (unique — never in the echoed command). */
function classify(flavour: string, text: string): 'admin' | 'user' | null {
  if (flavour === 'windows-powershell' || flavour === 'pwsh') {
    if (/THRONG_IL=True/.test(text)) return 'admin';
    if (/THRONG_IL=False/.test(text)) return 'user';
    return null;
  }
  // cmd / git-bash: numeric exit code (0 = admin, non-zero = access-denied user).
  if (/THRONG_IL=0(?!\d)/.test(text)) return 'admin';
  if (/THRONG_IL=[1-9]/.test(text)) return 'user';
  return null;
}

async function daemonElevated(win: Page): Promise<boolean> {
  const caps = await win.evaluate(() => window.throng?.terminal?.capabilities?.());
  return caps?.elevated === true;
}

/** The flavour ids offered in the dropdown (after selecting Terminal on `pid`). */
async function availableFlavours(win: Page, pid: string): Promise<string[]> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  return win
    .getByTestId(`panel-type-form-${pid}`)
    .getByTestId('terminal-flavour')
    .evaluate((el) => Array.from((el as HTMLSelectElement).options).map((o) => o.value));
}

/** Type a probe into the live terminal and read back which integrity it reported. */
async function readIntegrity(win: Page, term: Locator, flavour: string): Promise<'admin' | 'user'> {
  await term.click();
  await win.keyboard.type(PROBE[flavour]);
  await win.keyboard.press('Enter');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const verdict = classify(flavour, await term.innerText());
    if (verdict) return verdict;
    await win.waitForTimeout(250);
  }
  throw new Error(`terminal produced no THRONG_IL token (did ${flavour} launch?)`);
}

/**
 * On panel `pid` (showing the type form): confirm a Terminal of `flavour`
 * (optionally checking "run as admin"), probe its integrity, then `exit` so the
 * Panel reverts to the form ready for the next config.
 */
async function confirmProbeExit(
  win: Page,
  pid: string,
  flavour: string,
  admin: boolean,
  promptMarker: string,
): Promise<'admin' | 'user'> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId(`panel-type-form-${pid}`).getByTestId('terminal-flavour').selectOption(flavour);
  if (admin) await win.getByTestId('terminal-admin').check();
  await win.getByTestId(`panel-type-confirm-${pid}`).click();

  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible({ timeout: 15000 });
  // Wait until the shell prompt is actually ready before typing — every flavour's
  // prompt shows the cwd (the project-root basename). Typing before the prompt
  // exists drops keystrokes (the earlier flakiness).
  await expect(term).toContainText(promptMarker, { timeout: 20000 });
  try {
    return await readIntegrity(win, term, flavour);
  } finally {
    // Kill the session via the bridge (reliable across cmd/PowerShell/bash) — its
    // exit reverts the Panel to the type-selection form (FR-020), ready for the
    // next config. More robust than typing each shell's own `exit`.
    await win.evaluate((id) => window.throng?.terminal?.kill?.(id), pid);
    await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
  }
}

adminTest('cmd & PowerShell honour the run-as-admin flag (integrity matrix, FR-025c)', async () => {
  // De-elevation needs an interactive elevated desktop; headless CI runners can't drop integrity.
  skipWithoutInteractiveDesktop();
  const root = mkdtempSync(join(tmpdir(), 'throng-admin-int-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Integrity', root);
      const base = basename(root);
      const pid = await firstPanelId(win);
      // We only reach here elevated (adminTest skips otherwise), so the daemon it
      // spawned must be elevated — assert it before the mixed-mode matrix.
      expect(await daemonElevated(win), 'the @admin daemon must be elevated').toBe(true);
      const flavours = await availableFlavours(win, pid);
      const psFlavour = flavours.includes('windows-powershell')
        ? 'windows-powershell'
        : flavours.includes('pwsh')
          ? 'pwsh'
          : null;
      const targets = ['cmd', psFlavour].filter((f): f is string => !!f && flavours.includes(f));

      for (const flavour of targets) {
        // UNCHECKED → must be de-elevated to "User" even though the daemon is elevated.
        const unchecked = await confirmProbeExit(win, pid, flavour, false, base);
        expect(unchecked, `${flavour} without run-as-admin must run as User`).toBe('user');
        // CHECKED → runs elevated ("Admin").
        const checked = await confirmProbeExit(win, pid, flavour, true, base);
        expect(checked, `${flavour} with run-as-admin must run as Admin`).toBe('admin');
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});

adminTest('git bash launches and honours the run-as-admin flag (FR-024/FR-025c)', async () => {
  // De-elevation needs an interactive elevated desktop; headless CI runners can't drop integrity.
  skipWithoutInteractiveDesktop();
  const root = mkdtempSync(join(tmpdir(), 'throng-admin-gitbash-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'GitBashAdmin', root);
      const base = basename(root);
      const pid = await firstPanelId(win);
      expect(await daemonElevated(win), 'the @admin daemon must be elevated').toBe(true);
      const flavours = await availableFlavours(win, pid);
      test.skip(!flavours.includes('git-bash'), 'Git Bash is not installed on this runner');

      // Git Bash MUST launch and run the probe (it currently fails to launch in admin
      // mode) — readIntegrity throws if no marker appears, i.e. the shell never ran.
      const unchecked = await confirmProbeExit(win, pid, 'git-bash', false, base);
      expect(unchecked, 'git bash without run-as-admin must run as User').toBe('user');
      const checked = await confirmProbeExit(win, pid, 'git-bash', true, base);
      expect(checked, 'git bash with run-as-admin must run as Admin').toBe('admin');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});
