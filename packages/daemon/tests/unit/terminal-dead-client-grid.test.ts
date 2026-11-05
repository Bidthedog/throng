import { describe, expect, it } from 'vitest';
import type { ChildProcess, IPtyHost, PtyHandle, PtyStartOptions } from '@throng/core';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * 008 FR-009 sizes a terminal to the smallest view attached to it. UI main dying (a crash, a kill) takes every view
 * with it and sends no detach, while the daemon and the terminals live on. The next launch's panels must then size
 * their terminals by themselves, not by the views of a window that no longer exists.
 */
class SizedHost implements IPtyHost {
  readonly sizes: Array<{ cols: number; rows: number }> = [];
  start(_opts: PtyStartOptions): PtyHandle {
    return { pid: 1000 };
  }
  write(): void {}
  resize(_handle: PtyHandle, cols: number, rows: number): void {
    this.sizes.push({ cols, rows });
  }
  async end(): Promise<void> {}
  async forceEnd(): Promise<{ survivors: never[] }> {
    return { survivors: [] };
  }
  onData(): () => void {
    return () => {};
  }
  onExit(): () => void {
    return () => {};
  }
  async probeChildPids(): Promise<number[]> {
    return [];
  }
  listChildProcesses(): Promise<ChildProcess[]> {
    return Promise.resolve([]);
  }
}

function make(): {
  host: SizedHost;
  events: TerminalEvents;
  attach: (viewId: string, cols: number, rows: number) => Promise<unknown>;
  resize: (viewId: string, cols: number, rows: number) => Promise<unknown>;
} {
  const host = new SizedHost();
  const events = new TerminalEvents();
  const service = new TerminalService(
    host,
    events,
    new TerminalLockManager({ acquire: async () => ({ path: 'x' }), release: async () => {} }),
    { isElevated: () => false },
  );
  const router = new RpcRouter();
  service.register(router);
  const launch = { file: '/bin/bash', args: [], cwd: '/proj' };
  return {
    host,
    events,
    attach: (viewId, cols, rows) =>
      router.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'terminal.attach',
        params: { panelId: 'p', projectId: 'proj', viewId, launch, cols, rows },
      }),
    resize: (viewId, cols, rows) =>
      router.handle({ jsonrpc: '2.0', id: 2, method: 'terminal.resize', params: { panelId: 'p', viewId, cols, rows } }),
  };
}

describe('a terminal outliving the window that sized it', () => {
  it('grows with its panel after UI main died without detaching', async () => {
    const s = make();
    const crashed = { write: (): void => {} };
    s.events.addSink(crashed);
    await s.attach('view-of-the-crashed-window', 120, 40);

    // UI main is gone: its events socket closes, as `ipc-server.ts` reports it, and no detach ever comes.
    s.events.removeSink(crashed);

    s.events.addSink({ write: () => {} });
    await s.attach('view-of-the-next-launch', 120, 40);
    await s.resize('view-of-the-next-launch', 200, 50);

    expect(s.host.sizes.at(-1)).toEqual({ cols: 200, rows: 50 });
  });

  it('still sizes to the smallest view while its windows are alive (008 FR-009)', async () => {
    const s = make();
    s.events.addSink({ write: () => {} });
    await s.attach('small-window', 120, 40);
    await s.attach('large-window', 200, 50);
    await s.resize('large-window', 220, 60);

    expect(s.host.sizes.at(-1) ?? { cols: 120, rows: 40 }).toEqual({ cols: 120, rows: 40 });
  });
});
