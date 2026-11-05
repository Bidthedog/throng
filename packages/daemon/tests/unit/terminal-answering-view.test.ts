import { describe, it, expect } from 'vitest';
import type { IPtyHost, PtyHandle } from '@throng/core';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * 008 FR-006b. A mirrored panel has one xterm per view, and each answers what a program asks the terminal.
 * The program reads one answer and the spare lands at the shell's prompt as if typed (`1R`, reproduced 5/5
 * in the real app), so one question gets one answer.
 */

class RecordingPtyHost implements IPtyHost {
  readonly written: string[] = [];
  private nextPid = 1000;
  start(): PtyHandle {
    return { pid: this.nextPid++ };
  }
  write(_handle: PtyHandle, data: string): void {
    this.written.push(data);
  }
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
const launch = { file: '/bin/bash', args: [], cwd: '/proj' };
const ANSWER = '\u001b[2;1R';

async function mirrored() {
  const host = new RecordingPtyHost();
  const service = new TerminalService(host, new TerminalEvents(), new TerminalLockManager(noopLock), {
    isElevated: () => false,
  });
  const router = new RpcRouter();
  service.register(router);
  const call = (method: string, params: object) => router.handle({ jsonrpc: '2.0', id: 1, method, params });
  const panel = { panelId: 'p1', projectId: 'proj', launch, cols: 80, rows: 24 };
  await call('terminal.attach', { ...panel, viewId: 'A' });
  await call('terminal.attach', { ...panel, viewId: 'B' });
  return {
    host,
    answer: (view: string) => call('terminal.write', { panelId: 'p1', data: ANSWER, answerFrom: view }),
    type: (data: string) => call('terminal.write', { panelId: 'p1', data }),
    detach: (view: string) => call('terminal.detach', { panelId: 'p1', viewId: view }),
  };
}

describe('a question put to a mirrored panel (008 FR-006b)', () => {
  it('reaches the program with one answer, however many views answered', async () => {
    const { host, answer } = await mirrored();
    await answer('A');
    await answer('B');
    expect(host.written).toEqual([ANSWER]);
  });

  it('is answered by the next view once the answering one has gone', async () => {
    const { host, answer, detach } = await mirrored();
    await detach('A');
    await answer('B');
    expect(host.written).toEqual([ANSWER]);
  });

  it('never drops what the user typed, whichever window typed it', async () => {
    const { host, type } = await mirrored();
    await type(ANSWER); // Shift+F3 and a cursor report are the same bytes
    await type('ls\r');
    expect(host.written).toEqual([ANSWER, 'ls\r']);
  });
});
