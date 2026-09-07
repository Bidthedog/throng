import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, it } from 'vitest';
import { runPtyHostContract } from '@throng/core/testing';
import { NodePtyHost } from '@throng/platform-windows';

const cmd = process.env.ComSpec ?? 'cmd.exe';

describe('NodePtyHost', () => {
  it(
    'satisfies the IPtyHost contract against a real shell',
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'throng-pty-'));
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
