import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { basename } from 'node:path';
import { test, expect } from '@playwright/test';
import { TERMINAL_OUTPUT_TIMEOUT_MS, createProject, firstPanelId, runApp } from './harness.js';
import { tmpDir, registerTempCleanup } from './temp-file-helpers.js';

/**
 * #90 — terminal keyboard fidelity for a modified Enter. Drives the REAL key path (xterm +
 * attachCustomKeyEventHandler + ConPTY) end to end. What a modified Enter SHOULD become depends on
 * how the program on the other end reads input, so there are two observable cases:
 *
 *   - a PowerShell prompt (win32-input-mode): a modified Enter must insert a soft line break AND
 *     ADVANCE THE CURSOR to the continuation line. Asserted against PSReadLine's real render — a bare
 *     LF here strands the cursor on the first line (the follow-up bug this proves fixed).
 *   - a program that NEGOTIATED the kitty protocol (e.g. Claude Code): a distinct CSI-u sequence,
 *     which takes precedence over win32-input. Its exact bytes are captured by a Node program on the
 *     other end; marker chars between presses make every byte attributable — which is how the
 *     original trailing-`\r` bug (`\x1b[13;2u\r`) was caught.
 *
 * The third encoding — a bare `\n` when NEITHER protocol is active — is covered by unit tests, not
 * here: no in-app raw-byte prompt can reach the `\n` branch to observe it, because ConPTY swallows a
 * child's attempt to turn win32-input off once a console shell has enabled it. The kitty case uses
 * cmd only because it is always present and can host `node`.
 */

// Both cases leave a shell sitting at a prompt with the project root as its CWD, which locks the
// directory on Windows until the process has fully gone. Removing it inline would race that lock and
// fail the test in teardown with every assertion green (017 FR-013a/FR-014), so the removal is
// tracked and best-effort.
registerTempCleanup();

/**
 * Does THIS machine's console host actually ask for win32-input-mode?
 *
 * The PowerShell case below can only work where it does: throng sends the win32 key event *only* to a
 * program that requested the mode (`CSI ? 9001 h`), and falls back to a bare LF otherwise — so where
 * nothing requests it, PSReadLine gets the LF, strands the cursor, and the assertion legitimately
 * fails. That is not a throng bug to fix in the test; it is the environment lacking the mechanism the
 * fix is built on. Observed on the `windows-2022` CI image (build 20348) while a Windows 11 dev box
 * negotiates it fine.
 *
 * So gate on the precondition ITSELF rather than on a proxy: spawn a real powershell.exe over ConPTY
 * and see whether `?9001h` comes back. Guessing from an OS build number or an elevation check would
 * only be modelling the cause — this measures the thing the fix actually depends on, and starts
 * running by itself the day the platform gains it. node-pty is a plain-Node native module and this is
 * a plain-Node process, so requiring it here is safe (Electron's main process must not).
 */
async function negotiatesWin32Input(): Promise<boolean> {
  const pty = createRequire(import.meta.url)('node-pty') as {
    spawn(file: string, args: string[], opts: Record<string, unknown>): {
      readonly pid: number;
      onData(cb: (d: string) => void): void;
      kill(): void;
    };
  };
  return await new Promise<boolean>((resolve) => {
    const before = new Set(conhostChildren(process.pid));
    const p = pty.spawn('powershell.exe', ['-NoLogo', '-NoProfile'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 20,
      cwd: process.cwd(),
    });
    const done = (v: boolean): void => {
      clearTimeout(timer);
      reapProbe(p.pid, before);
      resolve(v);
    };
    const timer = setTimeout(() => done(false), 20000); // no request within a prompt's lifetime → absent
    p.onData((d) => {
      if (d.includes('?9001h')) done(true);
    });
  });
}

/**
 * Dispose of the probe's shell and pseudoconsole WITHOUT node-pty's own `kill()` — issue #240.
 *
 * node-pty 1.1.0's Windows `kill()` forks `conpty_console_list_agent`, which calls
 * `AttachConsole(shellPid)` and hands back every pid attached to that console so node-pty can
 * `process.kill()` each one. When the agent fails — it prints `Error: AttachConsole failed` and dies
 * — node-pty's 5-second fallback resolves the list as `[shellPid]` and kills THAT, by bare pid,
 * **five seconds after the shell it named has gone**. Windows reuses pids freely, and an E2E shard
 * starts an Electron app, a daemon and a shell every couple of seconds, so the pid is very likely to
 * belong to somebody else by then. Measured on CI: the agent failed at 11:51:26.836, and 5.4s later
 * the NEXT spec's Electron app died 1.3s into its body with "Target page, context or browser has been
 * closed" — a test killed by the teardown of a test that had already been skipped.
 *
 * This is exactly why `NodePtyHost` avoids node-pty's `kill()` too (see its comment); this call site
 * was the one left using it, and it is the more dangerous of the two because it runs in the Playwright
 * WORKER, whose `process.kill` reaches every other app the worker is driving.
 *
 * So: taskkill the shell tree by pid, then reap the pseudoconsole host node-pty leaves behind for a
 * shell it did not kill itself. `before` is the worker's conhost children from before the spawn, so
 * only the probe's own host is reaped.
 */
function reapProbe(shellPid: number, before: ReadonlySet<number>): void {
  taskkill(shellPid);
  for (const pid of conhostChildren(process.pid)) if (!before.has(pid)) taskkill(pid);
}

function taskkill(pid: number): void {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true,
    });
  } catch {
    /* already gone — best effort, never an assertion */
  }
}

/** The pids of headless `conhost.exe` / `OpenConsole.exe` hosts owned by `parentPid` (one per live ConPTY). */
function conhostChildren(parentPid: number): number[] {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'conhost.exe' -or $_.Name -eq 'OpenConsole.exe') -and $_.ParentProcessId -eq ${parentPid} } | ForEach-Object { $_.ProcessId }`,
      ],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    );
    return out
      .split(/\r?\n/)
      .map((l) => Number(l.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

test('at a PowerShell prompt, a modified Enter inserts a soft line break and the cursor advances', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  test.skip(
    !(await negotiatesWin32Input()),
    "this console host never requests win32-input-mode, so there is no key event to send and throng correctly falls back to a bare LF — the cursor advance it buys is not available here to observe (seen on windows-2022 / build 20348)",
  );
  const root = tmpDir('throng-me-pwsh-');
  await runApp(async (_app, win) => {
    await createProject(win, 'ME', root);
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
    await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
    await win.getByTestId(`panel-type-confirm-${pid}`).click();
    const term = win.getByTestId(`terminal-${pid}`);
    await expect(term).toBeVisible();
    await expect(term).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS }); // PS prompt (cwd) is up
    await term.click();
    // Type a token, a modified Enter, then a second token. PSReadLine shows a `>> ` continuation
    // line; the second token must land ON it (cursor advanced). The old bare-LF bug left the cursor
    // on the first line, so the second token merged with the first and the continuation showed the
    // FIRST token instead. We drive Ctrl+Enter specifically — the reported key, and the one whose
    // PSReadLine binding (InsertLineAbove) would open a line ABOVE the one being typed; it only does
    // the right thing because throng forces Shift, making it InsertLineBelow.
    await win.keyboard.type('AAA', { delay: 60 });
    await win.keyboard.press('Control+Enter');
    await win.keyboard.type('BBB', { delay: 60 });
    const screen = () => term.evaluate((el) => el.textContent ?? '');
    await expect.poll(screen, { timeout: 15000 }).toMatch(/>>\s*BBB/); // BBB on the continuation line
    expect(await screen()).not.toMatch(/AAABBB/); // never merged onto one line
  });
});

// MERGED into terminal-kitty-editing-keys.e2e.ts ('Ctrl+Backspace and a modified Enter reach a kitty program ...'):
// the kitty case (Shift+Enter / Ctrl+Enter as distinct CSI-u, plain Enter unchanged) used the same fixture, shell and
// capture file, and that file shares one app. This file keeps its own app per test: the PowerShell case is a real
// win32-input probe plus a PSReadLine render.
