import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IPtyHost, PtyStartOptions, PtyHandle, PtyExit } from '@throng/core';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * 008 FR-005 / SC-006 (moved down from terminal-slow-start.e2e.ts, daemon half) — a COLD-START attach that
 * is slow answers late, but its session is registered first, so the client's retry is a REUSE that returns
 * at once and starts no second shell.
 *
 * Layer: unit — the ordering (register, then delay) is inside `TerminalService.attach`; a fake pty host and
 * fake timers show it without a real shell. The renderer's half is terminal-slow-start-attach.test.ts.
 */

class FakePtyHost implements IPtyHost {
  readonly started: PtyStartOptions[] = [];
  private nextPid = 1000;
  start(opts: PtyStartOptions): PtyHandle {
    this.started.push(opts);
    return { pid: this.nextPid++ };
  }
  write(): void {}
  resize(): void {}
  async end(): Promise<void> {}
  async forceEnd(): Promise<{ survivors: never[] }> {
    return { survivors: [] };
  }
  onData(): () => void {
    return () => {};
  }
  onExit(_h: PtyHandle, _cb: (e: PtyExit) => void): () => void {
    return () => {};
  }
  async probeChildPids(): Promise<number[]> {
    return [];
  }
}

const noopLock = { acquire: async () => ({ path: 'x' }), release: async () => {} };
const COLD_START_DELAY_MS = 20_000;

function makeService(delayMs: number) {
  const host = new FakePtyHost();
  const service = new TerminalService(
    host,
    new TerminalEvents(),
    new TerminalLockManager(noopLock),
    { isElevated: () => false },
    undefined,
    false,
    delayMs,
  );
  const router = new RpcRouter();
  service.register(router);
  const attach = (params: object) =>
    router.handle({ jsonrpc: '2.0', id: 1, method: 'terminal.attach', params }) as Promise<{
      result?: { status?: string; sessionId?: number };
    }>;
  return { host, attach };
}

const params = { panelId: 'p1', projectId: 'proj', cols: 80, rows: 24, launch: { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj' } };

afterEach(() => vi.useRealTimers());

describe('008 FR-005 — a slow cold-start attach and its retry', () => {
  it('answers late, but a retry meanwhile reuses the registered session at once and starts no second shell', async () => {
    vi.useFakeTimers();
    const { host, attach } = makeService(COLD_START_DELAY_MS);

    let firstAnswered = false;
    const first = attach(params).then((r) => {
      firstAnswered = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(1_000); // far short of the delay: the first attach is still pending
    expect(firstAnswered, 'the cold-start answer is held back').toBe(false);

    // The client gave up at its budget and retried. No timers advance: a reuse must not wait out the delay.
    const retry = await attach(params);
    expect(retry.result?.status).toBe('running');
    expect(host.started, 'the retry reused the session; it did not start another').toHaveLength(1);

    await vi.advanceTimersByTimeAsync(COLD_START_DELAY_MS);
    const late = await first;
    expect(late.result?.sessionId, 'the late answer names the same session the retry reused').toBe(retry.result?.sessionId);
  });
});
