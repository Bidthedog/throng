import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { runPtyHostContract } from '@throng/core/testing';
import { NodePtyHost } from '@throng/platform-windows';

const cmd = process.env.ComSpec ?? 'cmd.exe';

/** This process's live ConPTY hosts — every one belongs to a terminal some host here started. */
function ownConhosts(): number[] {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'conhost.exe' -or $_.Name -eq 'OpenConsole.exe') -and $_.ParentProcessId -eq ${process.pid} } | ForEach-Object { $_.ProcessId }`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return out
    .split(/\r?\n/)
    .map(Number)
    .filter((n) => n > 0);
}

describe('NodePtyHost', () => {
  it(
    'satisfies the IPtyHost contract against a real shell',
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'throng-pty-'));
      const before = new Set(ownConhosts());
      try {
        await runPtyHostContract({
          make: () => new NodePtyHost(),
          cwd,
          interactiveShell: { file: cmd, args: [] },
          selfExitingShell: { file: cmd, args: ['/c', 'ver'] },
          echoLine: (marker) => `echo ${marker}\r\n`,
          /*
           * ping spawns ping.exe as a real, long-lived child of the shell.
           *
           * `-n 40` (~39 s), not `-n 6` (~5 s), and the number is load-bearing: the contract makes
           * TWO waits that require this child to still be running, and their budgets total 30 s. At
           * `-n 6` the child died long before the second wait began — and on a slow enough machine,
           * before the FIRST one observed it — so the suite was racing a process it had already
           * outlived. It costs no wall-clock: the contract kills the shell when it is done, which
           * takes the ping with it, and nothing ever waits for this child to exit on its own.
           */
          startChildLine: () => 'ping -n 40 127.0.0.1\r\n',
        });
        // 051 FR-014 / Principle III: every host the contract started — including the one ended
        // before it could be identified, and the self-exited one reaped after its exit — is gone.
        const deadline = Date.now() + 10_000;
        let left = ownConhosts().filter((pid) => !before.has(pid));
        while (left.length > 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 250));
          left = ownConhosts().filter((pid) => !before.has(pid));
        }
        expect(left, 'console hosts left behind by the contract').toEqual([]);
      } finally {
        rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
    /*
     * Raised with the budgets above. Worst case is now roughly 8 (echo) + 15 + 15 (the two child
     * observations) + 8 (onExit) + 8 (self-exit) ≈ 55 s, which 60 s did not clear with any margin.
     */
    120_000,
  );
});
