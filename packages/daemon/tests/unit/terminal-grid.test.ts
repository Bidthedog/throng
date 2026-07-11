import { describe, it, expect } from 'vitest';
import type { IPtyHost, PtyStartOptions, PtyHandle } from '@throng/core';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * 008 FR-009/FR-010/FR-012/FR-013. A terminal session exposes a SINGLE character grid
 * sized to the minimum columns and minimum rows across every attached view. The daemon —
 * the only component that sees every window — owns the per-view dimensions and the
 * minimum, and issues exactly ONE PTY resize, only when the computed grid actually
 * changes. A view smaller than 1×1 is clamped. Nothing about focus (no dimension change)
 * may emit a resize.
 */

interface Started {
  opts: PtyStartOptions;
  handle: PtyHandle;
}
interface Resized {
  pid: number;
  cols: number;
  rows: number;
}

class RecordingPtyHost implements IPtyHost {
  readonly started: Started[] = [];
  readonly resizes: Resized[] = [];
  readonly killed: number[] = [];
  private nextPid = 1000;

  start(opts: PtyStartOptions): PtyHandle {
    const handle = { pid: this.nextPid++ };
    this.started.push({ opts, handle });
    return handle;
  }
  write(): void {}
  resize(handle: PtyHandle, cols: number, rows: number): void {
    this.resizes.push({ pid: handle.pid, cols, rows });
  }
  kill(handle: PtyHandle): void {
    this.killed.push(handle.pid);
  }
  onData(): () => void {
    return () => {};
  }
  onExit(): () => void {
    return () => {};
  }
  listChildPids(): number[] {
    return [];
  }
}

const noopLock = { acquire: () => ({ path: 'x' }), release: () => {} };

function makeService() {
  const host = new RecordingPtyHost();
  const events = new TerminalEvents();
  const locks = new TerminalLockManager(noopLock);
  const service = new TerminalService(host, events, locks, { isElevated: () => false });
  const router = new RpcRouter();
  service.register(router);
  const call = (method: string, params: object) =>
    router.handle({ jsonrpc: '2.0', id: 1, method, params });
  return {
    host,
    attach: (params: object) => call('terminal.attach', params),
    resize: (params: object) => call('terminal.resize', params),
  };
}

const launch = { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj' };
const panel = { panelId: 'p1', projectId: 'proj', launch };

describe('terminal grid = minimum across attached views (008 FR-009)', () => {
  it('cold-starts at the first view size and takes the minimum as more views attach', async () => {
    const { host, attach } = makeService();

    // View A cold-starts the PTY at its own size.
    await attach({ ...panel, viewId: 'A', cols: 80, rows: 24 });
    expect(host.started).toHaveLength(1);
    expect(host.started[0].opts.cols).toBe(80);
    expect(host.started[0].opts.rows).toBe(24);
    const pid = host.started[0].handle.pid;

    // View B is LARGER on both axes → the minimum is unchanged → NO resize.
    await attach({ ...panel, viewId: 'B', cols: 100, rows: 30 });
    expect(host.resizes).toHaveLength(0);

    // View C is SMALLER on both axes → the minimum shrinks → exactly ONE resize to the min.
    await attach({ ...panel, viewId: 'C', cols: 60, rows: 20 });
    expect(host.resizes).toEqual([{ pid, cols: 60, rows: 20 }]);
  });

  it('takes the per-axis minimum across three or more views (not merely two)', async () => {
    const { host, attach } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 120, rows: 24 });
    const pid = host.started[0].handle.pid;
    await attach({ ...panel, viewId: 'B', cols: 80, rows: 40 });
    await attach({ ...panel, viewId: 'C', cols: 100, rows: 30 });
    // min cols = 80 (B), min rows = 24 (A) — mixed across views.
    expect(host.resizes.at(-1)).toEqual({ pid, cols: 80, rows: 24 });
  });

  it('grows the grid exactly once when the smallest view is enlarged, with no intermediate resize', async () => {
    const { host, attach, resize } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    const pid = host.started[0].handle.pid;
    await attach({ ...panel, viewId: 'B', cols: 60, rows: 20 }); // grid → 60×20
    host.resizes.length = 0;

    // Enlarge B beyond A: grid → min(100,120)=100, min(30,40)=30 — one resize.
    await resize({ panelId: 'p1', viewId: 'B', cols: 120, rows: 40 });
    expect(host.resizes).toEqual([{ pid, cols: 100, rows: 30 }]);
  });

  it('emits NO resize when a report does not change the computed grid (e.g. a focus change)', async () => {
    const { host, attach, resize } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 80, rows: 24 });
    await attach({ ...panel, viewId: 'B', cols: 100, rows: 30 }); // grid stays 80×24
    host.resizes.length = 0;

    // The larger view re-reports the SAME dimensions (a focus/repaint, not a resize).
    await resize({ panelId: 'p1', viewId: 'B', cols: 100, rows: 30 });
    // The smaller view re-reports its unchanged dimensions.
    await resize({ panelId: 'p1', viewId: 'A', cols: 80, rows: 24 });
    expect(host.resizes).toHaveLength(0);
  });

  it('clamps the grid to a minimum of one column and one row (008 FR-012)', async () => {
    const { host, attach, resize } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 80, rows: 24 });
    const pid = host.started[0].handle.pid;
    host.resizes.length = 0;

    // A degenerate view report must not drive the grid below 1×1.
    await resize({ panelId: 'p1', viewId: 'A', cols: 0, rows: 0 });
    expect(host.resizes).toEqual([{ pid, cols: 1, rows: 1 }]);
  });
});
