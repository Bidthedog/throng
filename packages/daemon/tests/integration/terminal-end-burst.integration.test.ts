import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CMD,
  openEventsSocket,
  rpcCall,
  startTerminalDaemon,
  waitFor,
  type EventsSocket,
  type TerminalDaemon,
} from './terminal-harness.js';

/**
 * #465 — several terminals ended together, the moment they have attached.
 *
 * Layer: integration — the failure is inside the real node-pty/ConPTY host (a native access
 * violation, or an exit node-pty never reports); a fake host cannot crash.
 *
 * The nightly gate went red three times in the integration stage on the same shape: a handful of
 * real `cmd` sessions attached and then ended at once (`killAll {}` in
 * `terminal-unload-filters`, the kill-while-attaching loop in `terminal-responsiveness`). Twice the
 * vitest worker died with 0xC0000005 (an access violation inside the process hosting node-pty, the
 * daemon in production); once one session's `terminal.exit` never arrived and its conhost outlived
 * even the forced end.
 *
 * One round of that shape fails rarely, so this repeats it. Each round is what app close does:
 * attach, `killAll {}` straight away, and every session must report its exit. A crash takes the
 * worker with it, which vitest reports as an unhandled error against this file.
 *
 * The cause was node-pty 1.1.0's unlocked native terminal list (`NodePtyHost.killShell`). Measured on
 * `windows-2022`, before the fix this file and its two neighbours above crashed or hung 9 runs in 20;
 * after it, 0 in 10. The ORDER is proven deterministically by `node-pty-host-end.test.ts`; this file
 * is the end-to-end net, which is why it is over the per-file budget: the crash needs repetition to
 * show. Six rounds each is half what reproduced it, and costs ~35 s on the runner.
 */

const ROUNDS = 6;
const PER_ROUND = 4;

let daemon: TerminalDaemon;
let cwd: string;
let evt: EventsSocket;

beforeEach(async () => {
  daemon = await startTerminalDaemon();
  cwd = mkdtempSync(join(tmpdir(), 'throng-end-burst-'));
  evt = await openEventsSocket(daemon.pipeName);
});

afterEach(async () => {
  evt.close();
  await daemon.stop();
  rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('ending several terminals at once (#465)', () => {
  it(
    `every session reports its exit, ${ROUNDS} rounds of ${PER_ROUND} ended the moment they attach`,
    async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const ids = Array.from({ length: PER_ROUND }, (_, i) => `r${round}-t${i}`);
        await Promise.all(
          ids.map((panelId) =>
            rpcCall(daemon.pipeName, 'terminal.attach', {
              panelId,
              projectId: 'proj',
              launch: { file: CMD, args: [], cwd },
              cols: 80,
              rows: 24,
            }),
          ),
        );

        const res = await rpcCall(daemon.pipeName, 'terminal.killAll', {});
        expect(res.error, `round ${round}: killAll failed`).toBeUndefined();
        expect([...res.result.killed].sort()).toEqual([...ids].sort());

        for (const panelId of ids) {
          await waitFor(
            () => evt.notifications.some((n) => n.method === 'terminal.exit' && n.params.panelId === panelId),
            8000,
            `round ${round}: a terminal.exit notification for ${panelId}`,
          );
        }
        await waitFor(
          async () => (await rpcCall(daemon.pipeName, 'terminal.list', {})).result.sessions.length === 0,
          8000,
          `round ${round}: every session to leave the list`,
        );
      }
    },
    240_000,
  );

  it(
    `sessions started while the previous ones are still being reaped stay alive, ${ROUNDS} rounds`,
    async () => {
      const attach = (panelId: string, projectId: string) =>
        rpcCall(daemon.pipeName, 'terminal.attach', {
          panelId,
          projectId,
          launch: { file: CMD, args: [], cwd },
          cols: 80,
          rows: 24,
        });
      const exitedIds = () =>
        new Set(evt.notifications.filter((n) => n.method === 'terminal.exit').map((n) => n.params.panelId));
      let survivors: string[] = [];
      for (let round = 0; round < ROUNDS; round++) {
        const ids = Array.from({ length: PER_ROUND }, (_, i) => `o${round}-t${i}`);
        await Promise.all(ids.map((panelId) => attach(panelId, `p${round}`)));
        // End the last round's survivors, then start this round's replacements straight away: the new
        // hosts are created while the old ones are still being attributed and reaped.
        if (survivors.length > 0) {
          const res = await rpcCall(daemon.pipeName, 'terminal.killAll', { projectId: `p${round - 1}` });
          expect(res.error, `round ${round}: killAll failed`).toBeUndefined();
          for (const panelId of survivors) {
            await waitFor(
              () => exitedIds().has(panelId),
              8000,
              `round ${round}: a terminal.exit notification for ${panelId}`,
            );
          }
        }
        // None of this round's sessions was asked to end: an exit here is one terminal's end taking another.
        const echoes = ids.map((panelId, i) => ({ panelId, marker: `R${round}T${i}Z` }));
        for (const { panelId, marker } of echoes) {
          await rpcCall(daemon.pipeName, 'terminal.write', { panelId, data: `echo ${marker}\r` });
        }
        for (const { panelId, marker } of echoes) {
          await waitFor(
            () =>
              evt.notifications
                .filter((n) => n.method === 'terminal.output' && n.params.panelId === panelId)
                .map((n) => String(n.params.data))
                .join('')
                .includes(marker),
            8000,
            `round ${round}: ${panelId} to echo ${marker} (it was never ended)`,
          );
        }
        expect(ids.filter((id) => exitedIds().has(id)), `round ${round}: sessions nobody ended`).toEqual([]);
        // Busy when the next round ends them, as Unload and app close usually find them.
        for (const panelId of ids) {
          await rpcCall(daemon.pipeName, 'terminal.write', { panelId, data: 'ping -n 60 127.0.0.1\r' });
        }
        survivors = ids;
      }
    },
    240_000,
  );
});
