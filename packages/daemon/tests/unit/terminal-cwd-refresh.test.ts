import { describe, it, expect } from 'vitest';
import type {
  ChildProcess,
  IProcessCwd,
  IPtyHost,
  PtyExit,
  PtyHandle,
  PtyStartOptions,
} from '@throng/core';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * 029 FR-013 — `terminal.list { refreshCwd }`, and the one-second lie it exists to prevent.
 *
 * ══ THE DEFECT THIS PINS ══
 *
 * `cwd` is sampled on a 1-second timer. That is right for what it was built for — a panel title a
 * second stale is invisible — and wrong for naming a lock holder, where the answer is a SENTENCE
 * SHOWN TO THE USER. Measured in `fileop-lock-cause.e2e.ts`: a rename attempted within a second of
 * `cd Inner` was told the folder was "open in another program" while the program was the user's own
 * terminal, because the daemon had not yet looked.
 *
 * Wrong, not merely vague — and the failure path is exactly where a user is least able to tell.
 *
 * ══ WHY THIS IS A UNIT TEST AND NOT ONLY AN E2E ══
 *
 * The E2E proves the sentence; it cannot prove WHY it is right, because a slow enough machine would
 * let the poll fire and the test would pass for the wrong reason. Here the poll provably has not run
 * (nothing is subscribed, and the interval is a real second), so a correct `refreshCwd` is the only
 * thing that can produce the fresh answer.
 */

const noopLock = { acquire: () => ({ path: 'x' }), release: () => {} };
const launch = { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj' };

class FakeHost implements IPtyHost {
  private nextPid = 4100;
  lastPid = 0;
  start(_opts: PtyStartOptions): PtyHandle {
    this.lastPid = this.nextPid++;
    return { pid: this.lastPid };
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
    return [];
  }
  listChildProcesses(): Promise<ChildProcess[]> {
    return Promise.resolve([]);
  }
}

/** A shell whose working directory the test moves, and which counts how often it was asked. */
class FakeProcessCwd implements IProcessCwd {
  cwd: string | null = null;
  reads = 0;
  async read(pids: readonly number[]): Promise<Map<number, string>> {
    this.reads += 1;
    const out = new Map<number, string>();
    if (this.cwd) for (const pid of pids) out.set(pid, this.cwd);
    return out;
  }
}

interface Listed {
  sessions: Array<{ panelId: string; cwd?: string }>;
}

function makeService() {
  const host = new FakeHost();
  const processCwd = new FakeProcessCwd();
  const service = new TerminalService(
    host,
    new TerminalEvents(),
    new TerminalLockManager(noopLock),
    { isElevated: () => false },
    undefined,
    false,
    0,
    processCwd,
  );
  const router = new RpcRouter();
  service.register(router);
  const call = async (method: string, params: object): Promise<unknown> =>
    (await router.handle({ jsonrpc: '2.0', id: 1, method, params })).result;
  return {
    host,
    processCwd,
    call,
    attach: () => call('terminal.attach', { panelId: 'p1', projectId: 'proj', launch, cols: 80, rows: 24 }),
    list: (params: object) => call('terminal.list', params) as Promise<Listed>,
  };
}

describe('terminal.list { refreshCwd } (029 FR-013)', () => {
  it('serves the LAST POLL by default — which is the stale answer #196 was told', async () => {
    const s = makeService();
    await s.attach();
    // The shell has moved, and nothing has polled: no sink is attached, so the poller is asleep,
    // and its interval is a real second regardless.
    s.processCwd.cwd = 'C:/proj/Inner';

    const listed = await s.list({});

    // The launch cwd, not the live one. Deliberately asserted rather than left implicit: this is the
    // behaviour every OTHER caller depends on, and making the refresh unconditional would charge a
    // native read per terminal to every panel-title update.
    expect(listed.sessions[0]?.cwd).toBe('C:/proj');
    expect(s.processCwd.reads, 'a plain list must not probe the OS at all').toBe(0);
  });

  it('reads the shell RIGHT NOW when asked, even with nothing subscribed', async () => {
    const s = makeService();
    await s.attach();
    s.processCwd.cwd = 'C:/proj/Inner';

    const listed = await s.list({ refreshCwd: true });

    // The whole point: fresh without waiting for the timer. "Even with nothing subscribed" is not
    // incidental — the poller skips entirely when no sink is listening (FR-019f's sibling rule), so
    // a refresh that merely woke the poller would still answer `C:/proj` here.
    expect(listed.sessions[0]?.cwd).toBe('C:/proj/Inner');
    expect(s.processCwd.reads).toBe(1);
  });

  it('reports the launch cwd when the OS will not say, rather than dropping the field', async () => {
    const s = makeService();
    await s.attach();
    s.processCwd.cwd = null; // a process that exited, or a read denied — both are ordinary

    const listed = await s.list({ refreshCwd: true });

    // A holder lookup that receives no cwd would silently stop naming throng, which is the failure
    // mode FR-012 asks to be a stated outcome rather than an absence. The launch cwd is still true.
    expect(listed.sessions[0]?.cwd).toBe('C:/proj');
  });
});
