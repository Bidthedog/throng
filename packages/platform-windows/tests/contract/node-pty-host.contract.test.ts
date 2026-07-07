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
          // ping spawns ping.exe as a real, multi-second child of the shell.
          startChildLine: () => 'ping -n 6 127.0.0.1\r\n',
        });
      } finally {
        rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
    60_000,
  );
});
