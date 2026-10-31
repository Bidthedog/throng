import { afterEach, describe, expect, it } from 'vitest';
import type { IPtyHost, PtyHandle, PtyStartOptions } from '@throng/core';
import { RpcRouter } from '../../src/rpc-router.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { TerminalService } from '../../src/terminal-service.js';
import { FakeHost } from './attention-harness.js';

/**
 * Daemon terminal service wiring that needs no shell: the capabilities report (FR-025a), the launch
 * failure for a missing executable (FR-019) and the bounded reattach scrollback (T131/T132).
 *
 * Layer: unit — (moved down from `terminal-service.integration.test.ts` and
 * `terminal-hygiene.integration.test.ts`, which used real shells.) Every claim here is the service's
 * own logic over what the host reports: the elevation flag it was given, an exception from
 * `host.start`, and `MAX_SCROLLBACK` applied to the chunks the host emits. A real conhost adds none of
 * it; real start/stream/kill through a pipe is still proved by `terminal-reattach.integration.test.ts`.
 */

const noopLock = { acquire: async () => ({ path: 'x' }), release: async () => {} };
const launch = { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj' };

const live: TerminalService[] = [];
function make(host: IPtyHost, elevated = false) {
  const service = new TerminalService(host, new TerminalEvents(), new TerminalLockManager(noopLock), {
    isElevated: () => elevated,
  });
  live.push(service);
  const router = new RpcRouter();
  service.register(router);
  let id = 0;
  const rpc = (method: string, params: object = {}) =>
    router.handle({ jsonrpc: '2.0', id: ++id, method, params }) as Promise<{ result?: any; error?: any }>;
  return { rpc };
}
afterEach(async () => {
  for (const s of live.splice(0)) await s.shutdown();
});

describe('terminal.capabilities (elevation gate, FR-025a)', () => {
  it('reports the daemon elevation to the UI (false by default)', async () => {
    const { rpc } = make(new FakeHost());
    expect((await rpc('terminal.capabilities')).result).toEqual({ elevated: false });
  });

  it('reports elevated=true when the daemon runs elevated', async () => {
    const { rpc } = make(new FakeHost(), true);
    expect((await rpc('terminal.capabilities')).result).toEqual({ elevated: true });
  });
});

describe('terminal.attach launch failure (FR-019)', () => {
  it('returns a launch-failure error for a missing executable', async () => {
    class MissingExecutableHost extends FakeHost {
      override start(_opts: PtyStartOptions): PtyHandle {
        throw new Error('File not found: C:/throng-no-such-shell-xyz.exe');
      }
    }
    const { rpc } = make(new MissingExecutableHost());
    const res = await rpc('terminal.attach', {
      panelId: 'p2',
      projectId: 'proj',
      launch: { ...launch, file: 'C:/throng-no-such-shell-xyz.exe' },
      cols: 80,
      rows: 24,
    });
    expect(res.error).toBeTruthy();
    expect(String(res.error.message)).toMatch(/launch/i);
  });
});

describe('reattach scrollback is bounded (resource hygiene, T131/T132)', () => {
  const SCROLLBACK_CAP = 64 * 1024; // MAX_SCROLLBACK in terminal-service.ts

  it('keeps only the tail under sustained output, so memory is flat however much a shell prints', async () => {
    const host = new FakeHost();
    const { rpc } = make(host);
    const attach = () =>
      rpc('terminal.attach', { panelId: 'flat', projectId: 'p', launch, cols: 80, rows: 24 });
    await attach();

    // ~20k lines of 40 chars ≈ 800 KB, far over the cap; the last line is distinguishable.
    const line = `${'X'.repeat(40)}\r\n`;
    for (let i = 0; i < 20_000; i++) host.emit(line);
    host.emit('LAST_LINE_MARKER\r\n');

    const scrollback = String((await attach()).result.scrollback);
    expect(scrollback.length).toBeGreaterThan(1000); // output really flowed
    expect(scrollback.length).toBeLessThanOrEqual(SCROLLBACK_CAP); // and stayed bounded
    expect(scrollback).toContain('LAST_LINE_MARKER'); // the tail is what is kept
  });
});
