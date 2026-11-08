import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, onTestFinished, vi } from 'vitest';
import { WAIT_THEN_START } from '../../src/main/restart-installed-copy.js';

/**
 * Layer: integration — what the wait does against a real process and a real /proc; a fake has no process
 * table to disagree with it.
 */
it.skipIf(process.platform !== 'linux')('starts the launcher only after the old process has gone (058 FR-018, #610)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'throng-restart-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const record = join(dir, 'started');
  const launcher = join(dir, 'throng');
  writeFileSync(launcher, `#!/bin/sh\necho started > '${record}'\n`, { mode: 0o755 });

  const oldProcess = spawn('sleep', ['30']);
  const pid = oldProcess.pid;
  if (pid === undefined) throw new Error('no pid for the stand-in process');
  execFile('/bin/sh', ['-c', WAIT_THEN_START, 'throng-restart', String(pid), launcher]);

  // Long enough for several turns of the 0.1s wait, the shortest bound that can show it is waiting.
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(existsSync(record)).toBe(false);

  oldProcess.kill('SIGKILL');
  await vi.waitFor(() => expect(existsSync(record)).toBe(true), { timeout: 5_000, interval: 25 });
});
