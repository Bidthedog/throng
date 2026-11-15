/**
 * Layer: integration. Tagged `regression`: a session lost on the nth return, or a process left on the nth close, only
 * shows after many cycles, so this runs in the gate, not on every pull request (070 SC-003, SC-004). The macOS
 * counterpart of `platform-linux/tests/integration/terminal-soak.integration.test.ts`, over the real daemon terminal
 * service and the libproc table (T019) as the witness.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { skipUnlessMacos } from '@throng/core/testing';
import { isLiveMacosRow, readMacosArgv, readMacosProcTable, type MacosProcRow } from '../../src/macos-proc-table.js';
import { openEventsSocket, rpcCall, startTerminalDaemon, waitFor } from '../../../daemon/tests/integration/terminal-harness.js';

/** A `sleep` duration nothing else on the runner uses, so its argv marks the jobs these terminals started. */
const MARK = '30107';

/**
 * Every live process the terminals started since `since`: their shells (`zsh -f`) and their jobs (`sleep 30107`). Found
 * by argv over the whole table, not by parentage, because a job whose shell has gone is launchd's child, not ours.
 */
async function survivors(since: number): Promise<MacosProcRow[]> {
  const rows = (await readMacosProcTable()).filter((row) => isLiveMacosRow(row) && row.startedAt >= since);
  return rows.filter((row) => {
    const argv = readMacosArgv(row.pid) ?? [];
    return (row.comm === 'sleep' && argv.includes(MARK)) || (row.comm === 'zsh' && argv[1] === '-f');
  });
}

/**
 * A full-screen program: it takes the alternate screen and answers each line it is given, so a reattach that lost it,
 * or left it unable to read, fails the round.
 */
const FULL_SCREEN = `printf '\\033[?1049h'; while read line; do printf 'GOT_%s_END\\n' "$line"; done`;

describe.skipIf(skipUnlessMacos('libproc is the witness'))('macOS terminals across 20 cycles (070 SC-003, SC-004)', () => {
  it('a full-screen program survives 20 departures and returns, its screen kept', { tags: ['regression'], timeout: 180_000 }, async () => {
    const daemon = await startTerminalDaemon();
    const cwd = mkdtempSync(join(tmpdir(), 'throng-soak-'));
    const attach = (): Promise<{ result: { sessionId: string; altScreen?: boolean } }> =>
      rpcCall(daemon.pipeName, 'terminal.attach', {
        panelId: 'soak',
        projectId: 'proj',
        launch: { file: '/bin/zsh', args: ['-f', '-c', FULL_SCREEN], cwd },
        cols: 80,
        rows: 24,
      });
    try {
      const first = await attach();
      let sessionId = first.result.sessionId;
      for (let i = 0; i < 20; i += 1) {
        const events = await openEventsSocket(daemon.pipeName);
        const again = await attach();
        expect(again.result.sessionId).toBe(sessionId);
        if (i > 0) expect(again.result.altScreen).toBe(true);
        sessionId = again.result.sessionId;
        await rpcCall(daemon.pipeName, 'terminal.write', { panelId: 'soak', data: `r${i}\r` });
        await waitFor(
          () => events.notifications.some((n) => n.method === 'terminal.output' && String(n.params.data).includes(`GOT_r${i}_END`)),
          8000,
          `round ${i} to reach the program`,
        );
        events.close();
      }
    } finally {
      await rpcCall(daemon.pipeName, 'terminal.killAll', {}).catch(() => undefined);
      await daemon.stop();
      rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('20 rounds of opening, closing and stopping the daemon leave no process behind', { tags: ['regression'], timeout: 240_000 }, async () => {
    // A second's slack: start times are the kernel's clock, and only a later process can be one of these.
    const since = Date.now() - 1000;
    const cwd = mkdtempSync(join(tmpdir(), 'throng-soak-'));
    try {
      for (let i = 0; i < 20; i += 1) {
        const roundStart = Date.now() - 100; // this round's jobs, not the last round's
        const daemon = await startTerminalDaemon();
        for (const panelId of ['a', 'b']) {
          await rpcCall(daemon.pipeName, 'terminal.attach', {
            panelId,
            projectId: 'proj',
            launch: { file: '/bin/zsh', args: ['-f', '-i'], cwd },
            cols: 80,
            rows: 24,
          });
          // A job in a process group of its own, which ignores hang-ups: the case a group kill alone misses.
          await rpcCall(daemon.pipeName, 'terminal.write', { panelId, data: `(trap '' HUP TERM; sleep ${MARK}) &\r` });
        }
        // Both jobs running before anything is closed: a close that lands while a shell is still forking its job is a
        // race no person can make, and what this proves is that a job already running does not outlive its terminal.
        const jobs = async (): Promise<number> =>
          (await survivors(roundStart)).filter((row) => row.comm === 'sleep').length;
        await waitFor(async () => (await jobs()) >= 2, 10_000, `round ${i}'s two jobs to start`);
        await rpcCall(daemon.pipeName, 'terminal.kill', { panelId: 'a' });
        await daemon.stop();
      }
      await waitFor(async () => (await survivors(since)).length === 0, 10_000, 'every process the terminals started to end').catch(
        async (error: unknown) => {
          const left = (await survivors(since)).map((row) => `${row.pid} ${row.comm} ${(readMacosArgv(row.pid) ?? []).join(' ')}`);
          throw new Error(`${String(error)}; still running: ${left.join('; ')}`, { cause: error });
        },
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
