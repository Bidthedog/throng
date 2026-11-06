import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IPtyHost, PtyHandle } from '@throng/core';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * 066 FR-010 — a terminal launch failure is logged whether or not it has a classified cause. Before,
 * `classifyAndLog` warned only when `classifyFailure` recognised the error, so a missing shell or a
 * broken shell path (no cause) reached the panel and left no line in daemon.log.
 *
 * Layer: unit — a fake host whose `start` throws, observed through `console.warn` (the daemon's console
 * is attached to its file log).
 */

class ThrowingHost implements IPtyHost {
  constructor(private readonly error: Error) {}
  start(): PtyHandle {
    throw this.error;
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
  onExit(): () => void {
    return () => {};
  }
  async probeChildPids(): Promise<number[]> {
    return [];
  }
}

const noopLock = { acquire: async () => ({ path: 'x' }), release: async () => {} };

function attachWith(error: Error) {
  const service = new TerminalService(
    new ThrowingHost(error),
    new TerminalEvents(),
    new TerminalLockManager(noopLock),
    { isElevated: () => false },
  );
  const router = new RpcRouter();
  service.register(router);
  return router.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'terminal.attach',
    params: { panelId: 'p1', projectId: 'proj', cols: 80, rows: 24, launch: { file: 'C:/nope.exe', args: [], cwd: 'C:/proj' } },
  }) as Promise<{ error?: { message: string } }>;
}

afterEach(() => vi.restoreAllMocks());

describe('066 — a terminal launch failure is always logged', () => {
  it('warns for a failure with no classified cause, naming the error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const response = await attachWith(new Error('File not found: C:/nope.exe'));
    expect(response.error?.message).toContain('Failed to launch terminal');
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('launch') && l.includes('File not found: C:/nope.exe'))).toBe(true);
  });
});
