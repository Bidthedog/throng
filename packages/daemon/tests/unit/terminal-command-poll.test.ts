import { describe, it, expect } from 'vitest';
import type { ChildProcess, IPtyHost, PtyExit, PtyHandle, PtyStartOptions } from '@throng/core';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * 025 FR-019 (T024) — the shared command observation's WIRING.
 *
 * `foregroundCommand` and `captureDecision` are unit-tested as pure rules, and the end-to-end
 * behaviour is covered by E2E. What neither reaches is the loop itself: that it publishes only on a
 * change, that it is suspended while nothing is listening, and that its interval comes from the
 * injected setting rather than a constant. Each of those is a place a defect hides silently — a
 * poll that never fires looks exactly like a terminal with nothing running.
 */

const CHILD: ChildProcess = { pid: 2001, ppid: 1000, commandLine: 'npm run dev', startedAt: 10 };

class FakeHost implements IPtyHost {
  /** What the next observation will report. Mutated by the tests. */
  children: ChildProcess[] = [];
  private nextPid = 1000;
  start(_opts: PtyStartOptions): PtyHandle {
    return { pid: this.nextPid++ };
  }
  write(): void {}
  resize(): void {}
  kill(): void {}
  onData(): () => void {
    return () => {};
  }
  onExit(_handle: PtyHandle, _cb: (e: PtyExit) => void): () => void {
    return () => {};
  }
  listChildPids(): number[] {
    return this.children.map((c) => c.pid);
  }
  listChildProcesses(): Promise<ChildProcess[]> {
    return Promise.resolve(this.children);
  }
}

const noopLock = { acquire: () => ({ path: 'x' }), release: () => {} };
const launch = { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj' };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeService(pollMs: number) {
  const host = new FakeHost();
  const events = new TerminalEvents();
  const locks = new TerminalLockManager(noopLock);
  const service = new TerminalService(
    host,
    events,
    locks,
    { isElevated: () => false },
    undefined,
    false,
    0,
    undefined,
    pollMs,
  );
  const router = new RpcRouter();
  service.register(router);
  const published: Array<{ panelId: string; command: string | null }> = [];
  /** A sink makes the service "observed"; without one the poll must stay asleep. */
  const sink = {
    write: (frame: string): void => {
      const msg = JSON.parse(frame) as { method: string; params: { panelId: string; command: string | null } };
      if (msg.method === 'terminal.command') published.push(msg.params);
    },
  };
  return {
    host,
    events,
    published,
    sink,
    attach: (params: object) => router.handle({ jsonrpc: '2.0', id: 1, method: 'terminal.attach', params }),
  };
}

describe('the shared command observation (025 FR-019 / T024)', () => {
  it('publishes a change, and does NOT publish the same value again', async () => {
    const s = makeService(30);
    s.events.addSink(s.sink);
    await s.attach({ panelId: 'p1', projectId: 'proj', launch, cols: 80, rows: 24 });

    s.host.children = [CHILD];
    await sleep(200);
    expect(s.published.filter((p) => p.command === 'npm run dev').length).toBe(1);

    // Several more intervals with the SAME command must add nothing: a notification per poll would
    // make every consumer re-render, and re-persist, once a second forever.
    await sleep(200);
    expect(s.published.filter((p) => p.command === 'npm run dev').length).toBe(1);
  });

  it('publishes null when the command goes away, so "idle" is distinguishable from "unseen"', async () => {
    const s = makeService(30);
    s.events.addSink(s.sink);
    await s.attach({ panelId: 'p1', projectId: 'proj', launch, cols: 80, rows: 24 });

    s.host.children = [CHILD];
    await sleep(200);
    s.host.children = [];
    await sleep(200);

    expect(s.published.at(-1)?.command).toBeNull();
  });

  it('stays asleep while nothing is listening, and resumes when something is (FR-019f)', async () => {
    const s = makeService(30);
    // No sink yet — deliberately.
    await s.attach({ panelId: 'p1', projectId: 'proj', launch, cols: 80, rows: 24 });
    s.host.children = [CHILD];
    await sleep(200);
    expect(s.published).toHaveLength(0);

    s.events.addSink(s.sink);
    await sleep(200);
    expect(s.published.at(-1)?.command).toBe('npm run dev');
  });

  it('uses the INJECTED interval, not a constant — a slow one has not fired yet', async () => {
    // If the interval were hardcoded at 1000ms this test would be indistinguishable from the one
    // above; the point is that the value passed in is the value used.
    const slow = makeService(5000);
    slow.events.addSink(slow.sink);
    await slow.attach({ panelId: 'p1', projectId: 'proj', launch, cols: 80, rows: 24 });
    slow.host.children = [CHILD];
    await sleep(300);
    expect(slow.published).toHaveLength(0);
  });
});
