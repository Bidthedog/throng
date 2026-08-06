import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IPtyHost, PtyStartOptions, PtyHandle } from '@throng/core';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * 028 (#162, #163) — `terminal.repaint`.
 *
 * A tab switch unmounts every panel, so a returning tab rebuilds its terminal and reconstructs the
 * screen from the session's replayed byte tail. For a full-screen program that reconstruction cannot
 * be right: the program paints absolutely, and its own state is the only authority for what the
 * screen should say. The program only redraws when the window changes — which is why a divider drag
 * cures the corruption instantly and a repaint of xterm's buffer never does.
 *
 * So a repaint is a grid NUDGE: resize away, resize back. The program redraws in full, at the size
 * it already had. Everything else must be untouched — this is deliberately the least invasive thing
 * that can force a redraw, because it runs on every tab switch.
 */

interface Resized {
  pid: number;
  cols: number;
  rows: number;
}

class RecordingPtyHost implements IPtyHost {
  readonly started: { opts: PtyStartOptions; handle: PtyHandle }[] = [];
  readonly resizes: Resized[] = [];
  readonly writes: string[] = [];
  private nextPid = 1000;
  private exitHandlers: ((e: { code: number | null; signal?: string }) => void)[] = [];

  start(opts: PtyStartOptions): PtyHandle {
    const handle = { pid: this.nextPid++ };
    this.started.push({ opts, handle });
    return handle;
  }
  write(_handle: PtyHandle, data: string): void {
    this.writes.push(data);
  }
  resize(handle: PtyHandle, cols: number, rows: number): void {
    this.resizes.push({ pid: handle.pid, cols, rows });
  }
  kill(): void {}
  private dataHandlers: ((data: string) => void)[] = [];
  onData(_handle: PtyHandle, cb: (data: string) => void): () => void {
    this.dataHandlers.push(cb);
    return () => {};
  }
  /** Emit program output, which is how the service learns which SCREEN the program is on. */
  emitData(data: string): void {
    for (const h of this.dataHandlers) h(data);
  }
  listChildProcesses(): { pid: number; commandLine: string }[] {
    return [];
  }
  onExit(_handle: PtyHandle, cb: (e: { code: number | null; signal?: string }) => void): () => void {
    this.exitHandlers.push(cb);
    return () => {};
  }
  fireExit(): void {
    for (const h of this.exitHandlers) h({ code: 0 });
  }
  listChildPids(): number[] {
    return [];
  }
}

const noopLock = { acquire: () => ({ path: 'x' }), release: () => {} };

function makeService() {
  vi.useFakeTimers();
  const host = new RecordingPtyHost();
  const events = new TerminalEvents();
  const locks = new TerminalLockManager(noopLock);
  const service = new TerminalService(host, events, locks, { isElevated: () => false });
  const router = new RpcRouter();
  service.register(router);
  // Subscribe as a notification sink and keep only the grid frames — the same wire the UI sees.
  const grids: { cols: number; rows: number }[] = [];
  events.addSink({
    write(frame: string) {
      const msg = JSON.parse(frame) as { method: string; params: { cols: number; rows: number } };
      if (msg.method.endsWith('grid')) grids.push(msg.params);
      return true;
    },
  });
  const call = (method: string, params: object) =>
    router.handle({ jsonrpc: '2.0', id: 1, method, params });
  return {
    host,
    grids,
    attach: (params: object) => call('terminal.attach', params),
    detach: (params: object) => call('terminal.detach', params),
    repaint: (params: object) => call('terminal.repaint', params),
  };
}

const launch = { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj' };
const panel = { panelId: 'p1', projectId: 'proj', launch };

/** The sequence a full-screen program sends when it takes the alternate screen. */
const ENTER_ALT_SCREEN = `${String.fromCharCode(27)}[?1049h`;

/**
 * Let the deferred restore run. The two resizes are deliberately NOT in the same tick: ConPTY had
 * not finished repainting at the intermediate size before the second arrived, and the half-finished
 * repaint left a row of one repeated character — corrupting the screen the repaint exists to repair.
 */
async function settleRestore(): Promise<void> {
  await vi.advanceTimersByTimeAsync(100);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('terminal.repaint (028 FR-017/FR-042)', () => {
  it('is a no-op for a panel with no session', async () => {
    const { host, repaint } = makeService();
    const res = await repaint({ panelId: 'nope' });
    expect(res).toMatchObject({ result: { ok: true } });
    expect(host.resizes).toHaveLength(0);
  });

  it('forces a redraw by nudging the grid and restoring it', async () => {
    const { host, attach, repaint } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    host.emitData(ENTER_ALT_SCREEN); // only a full-screen program is nudged — see the normal-screen test
    const pid = host.started[0].handle.pid;
    host.resizes.length = 0;

    await repaint({ panelId: 'p1' });
    await settleRestore();

    // Two real window-change signals: the program redraws, and ends at the size it began.
    expect(host.resizes).toEqual([
      { pid, cols: 100, rows: 29 },
      { pid, cols: 100, rows: 30 },
    ]);
  });

  it('nudges rows, never columns — a column change would reflow a shell\u2019s wrapped lines', async () => {
    const { host, attach, repaint } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    host.resizes.length = 0;
    await repaint({ panelId: 'p1' });
    await settleRestore();
    expect(host.resizes.every((r) => r.cols === 100)).toBe(true);
  });

  it('leaves the session grid untouched, so every view\u2019s idea of the size stays true', async () => {
    const { attach, repaint } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    await repaint({ panelId: 'p1' });
    await settleRestore();
    // A later attach is handed the grid: it must still be the real one.
    const res = (await attach({ ...panel, viewId: 'B', cols: 120, rows: 40 })) as {
      result: { grid: { cols: number; rows: number } };
    };
    expect(res.result.grid).toEqual({ cols: 100, rows: 30 });
  });

  it('publishes no grid event — the views\u2019 size did not change', async () => {
    const { attach, repaint, grids } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    grids.length = 0;
    await repaint({ panelId: 'p1' });
    await settleRestore();
    expect(grids).toHaveLength(0);
  });

  it('writes nothing to the pty — a redraw is never Ctrl+L or any other keystroke (FR-044)', async () => {
    const { host, attach, repaint } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    host.writes.length = 0;
    await repaint({ panelId: 'p1' });
    await settleRestore();
    expect(host.writes).toHaveLength(0);
  });

  it('coalesces rapid repeats — three presses are ONE nudge, not six racing resizes', async () => {
    // Regression fence for a defect this feature's own E2E caught under parallel load: with the
    // restore in the same tick and no coalescing, three rapid Ctrl+F5 presses became six interleaved
    // resizes, and ConPTY's half-finished repaint left a row filled with one repeated character —
    // corrupting the screen the repaint exists to repair.
    const { host, attach, repaint } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    host.emitData(ENTER_ALT_SCREEN);
    host.resizes.length = 0;
    await repaint({ panelId: 'p1' });
    await repaint({ panelId: 'p1' });
    await repaint({ panelId: 'p1' });
    expect(host.resizes).toEqual([{ pid: host.started[0].handle.pid, cols: 100, rows: 29 }]);
    await settleRestore();
    expect(host.resizes).toEqual([
      { pid: host.started[0].handle.pid, cols: 100, rows: 29 },
      { pid: host.started[0].handle.pid, cols: 100, rows: 30 },
    ]);
  });

  it('accepts a further repaint once the previous one has restored', async () => {
    const { host, attach, repaint } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    host.emitData(ENTER_ALT_SCREEN);
    host.resizes.length = 0;
    await repaint({ panelId: 'p1' });
    await settleRestore();
    await repaint({ panelId: 'p1' });
    await settleRestore();
    expect(host.resizes).toHaveLength(4);
    expect(host.resizes.at(-1)).toMatchObject({ cols: 100, rows: 30 });
  });

  it('does NOT nudge a session on the normal screen — the resize would destroy its buffer', async () => {
    /*
     * The nudge exists for a program that owns every cell and only redraws on a window change. On the
     * normal screen there is no such program: the buffer IS the content, and Windows reflows a
     * console buffer when it is resized. Measured at a PowerShell prompt with 120 lines of output —
     * one Ctrl+F5 left a single row, and everything typed afterwards rendered split across the screen
     * until `clear`. A redraw must never be the thing that destroys what it was asked to redraw.
     *
     * Nothing is lost by staying still: the normal screen's redraw is the view repainting its own
     * buffer, which needs no help from the pty.
     */
    const { host, attach, repaint } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    host.resizes.length = 0;
    const res = await repaint({ panelId: 'p1' });
    await settleRestore();
    expect(res).toMatchObject({ result: { ok: true } });
    expect(host.resizes).toHaveLength(0);
  });

  it('nudges again once a program leaves and re-enters the alternate screen', async () => {
    const { host, attach, repaint } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    host.emitData(`${ENTER_ALT_SCREEN}${String.fromCharCode(27)}[?1049l`); // in and straight back out
    host.resizes.length = 0;
    await repaint({ panelId: 'p1' });
    await settleRestore();
    expect(host.resizes).toHaveLength(0); // back on the normal screen — no nudge

    host.emitData(ENTER_ALT_SCREEN);
    await repaint({ panelId: 'p1' });
    await settleRestore();
    expect(host.resizes).toHaveLength(2);
  });

  it('does not resize a session whose process has exited', async () => {
    const { host, attach, repaint } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    host.fireExit();
    host.resizes.length = 0;
    const res = await repaint({ panelId: 'p1' });
    expect(res).toMatchObject({ result: { ok: true } });
    expect(host.resizes).toHaveLength(0);
  });

  it('never nudges below the minimum grid', async () => {
    const { host, attach, repaint } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 1, rows: 1 });
    host.resizes.length = 0;
    await repaint({ panelId: 'p1' });
    await settleRestore();
    expect(host.resizes.every((r) => r.rows >= 1 && r.cols >= 1)).toBe(true);
  });
});

/**
 * 028 T015 — one attach, one repaint.
 *
 * A tab switch unmounts its panels, so the returning tab's attach is a REBUILD: the session has been
 * running all along and its screen is whatever the program last painted, which the rebuilt view has
 * no way to know. That is the case worth a nudge, and it is worth exactly one — the cost of this
 * feature is paid on every tab switch, and three nudges would be three flashes.
 *
 * A cold start is the opposite: nothing has painted yet, so there is nothing to redraw.
 */
describe('repaint on attach (028 T015)', () => {
  it('does not nudge a COLD START — nothing has painted yet', async () => {
    const { host, attach } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    await settleRestore();
    // The only resizes are the ones that set the grid up; none of them is a nudge-and-restore pair.
    expect(host.resizes.filter((r) => r.rows === 29)).toHaveLength(0);
  });

  it('nudges exactly once when a REBUILT view attaches to a running session', async () => {
    const { host, attach, detach } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    host.emitData(ENTER_ALT_SCREEN); // only a full-screen program is nudged
    // Every view goes: this is what a tab switch does, and it is what marks the grid stale.
    await detach({ panelId: 'p1', viewId: 'A' });
    host.resizes.length = 0;

    const res = (await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 })) as {
      result: { redrawn?: boolean };
    };
    await settleRestore();

    expect(res.result.redrawn, 'the view must be told not to ask again').toBe(true);
    expect(host.resizes).toEqual([
      { pid: host.started[0].handle.pid, cols: 100, rows: 29 },
      { pid: host.started[0].handle.pid, cols: 100, rows: 30 },
    ]);
  });
});

/**
 * 028 T012 — what a rebuilt view is given to replay.
 *
 * The replayed tail is a byte log, and a full-screen program's screen is not in it: the program
 * paints absolutely, and its deltas assume a screen the tail no longer describes. Painting it lands
 * absolute-positioned fragments on the normal buffer — visible as a flash of stale content, and
 * then as a screen that is simply wrong until something forces a redraw.
 *
 * So a session on the alternate screen replays NOTHING, and says which screen it is on instead.
 */
describe('replay suppression on the alternate screen (028 T012)', () => {
  it('withholds the tail from a view rebuilt over a full-screen program', async () => {
    const { host, attach, detach } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    host.emitData('some scrollback the shell printed\r\n');
    host.emitData(ENTER_ALT_SCREEN);
    host.emitData('absolute deltas that assume the alternate screen');
    await detach({ panelId: 'p1', viewId: 'A' });

    const res = (await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 })) as {
      result: { scrollback: string; altScreen?: boolean };
    };
    expect(res.result.scrollback, 'nothing may be replayed onto the normal buffer').toBe('');
    expect(res.result.altScreen, 'the view must be told which screen the program is on').toBe(true);
  });

  it('still replays the tail for a program on the NORMAL screen', async () => {
    // The suppression is about the alternate screen alone: an ordinary shell's scrollback is exactly
    // what a rebuilt view needs, and withholding it would blank a terminal on every tab switch.
    const { host, attach, detach } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    host.emitData('ordinary shell output\r\n');
    await detach({ panelId: 'p1', viewId: 'A' });

    const res = (await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 })) as {
      result: { scrollback: string; altScreen?: boolean };
    };
    expect(res.result.scrollback).toContain('ordinary shell output');
    expect(res.result.altScreen).toBe(false);
  });

  it('replays again once the program LEAVES the alternate screen', async () => {
    // Withheld, not discarded: leaving the alt screen makes the tail worth replaying again.
    const { host, attach, detach } = makeService();
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    host.emitData('printed before the program took the screen\r\n');
    host.emitData(ENTER_ALT_SCREEN);
    host.emitData(`${String.fromCharCode(27)}[?1049l`);
    await detach({ panelId: 'p1', viewId: 'A' });

    const res = (await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 })) as {
      result: { scrollback: string; altScreen?: boolean };
    };
    expect(res.result.scrollback).toContain('printed before the program took the screen');
    expect(res.result.altScreen).toBe(false);
  });
});
