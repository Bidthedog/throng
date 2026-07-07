import { describe, it, expect } from 'vitest';
import type { IPtyHost, PtyStartOptions, PtyHandle, PtyExit } from '@throng/core';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * Bug: after a client-side `terminal.attach` timeout (the daemon actually cold-started
 * the terminal, the UI just gave up waiting), the Panel reverts to the type form. If
 * the user then picks a DIFFERENT terminal type, the daemon returns the still-running
 * STALE session for that panelId — so the wrong shell loads (PowerShell was chosen, but
 * because the timed-out session was git-bash, git-bash loads again). `terminal.attach`
 * must honour a changed launch spec for a live panel: reap the stale terminal and
 * cold-start the requested one. An UNCHANGED launch must still reattach (mirror/reopen).
 */

interface Started {
  opts: PtyStartOptions;
  handle: PtyHandle;
}

class FakePtyHost implements IPtyHost {
  readonly started: Started[] = [];
  readonly killed: number[] = [];
  private readonly exitCbs = new Map<number, (e: PtyExit) => void>();
  private nextPid = 1000;

  start(opts: PtyStartOptions): PtyHandle {
    const handle = { pid: this.nextPid++ };
    this.started.push({ opts, handle });
    return handle;
  }
  write(): void {}
  resize(): void {}
  kill(handle: PtyHandle): void {
    this.killed.push(handle.pid);
  }
  onData(): () => void {
    return () => {};
  }
  onExit(handle: PtyHandle, cb: (e: PtyExit) => void): () => void {
    this.exitCbs.set(handle.pid, cb);
    return () => this.exitCbs.delete(handle.pid);
  }
  listChildPids(): number[] {
    return [];
  }
  /** Test helper: fire the process-exit the real host emits asynchronously after kill. */
  fireExit(pid: number, code = 0): void {
    this.exitCbs.get(pid)?.({ code });
  }
}

const noopLock = { acquire: () => ({ path: 'x' }), release: () => {} };

function makeService() {
  const host = new FakePtyHost();
  const events = new TerminalEvents();
  const locks = new TerminalLockManager(noopLock);
  const service = new TerminalService(host, events, locks, { isElevated: () => false });
  const router = new RpcRouter();
  service.register(router);
  const call = (method: string, params: object) =>
    router.handle({ jsonrpc: '2.0', id: 1, method, params });
  const attach = (params: object) => call('terminal.attach', params);
  const statusOf = async (panelId: string): Promise<string | undefined> => {
    const res = (await call('terminal.list', {})) as {
      result: { sessions: Array<{ panelId: string; status: string }> };
    };
    return res.result.sessions.find((s) => s.panelId === panelId)?.status;
  };
  return { host, attach, statusOf };
}

const base = { panelId: 'p1', projectId: 'proj', cols: 80, rows: 24 };
const bash = { file: 'C:/git/bin/bash.exe', args: [], cwd: 'C:/proj' };
const pwsh = { file: 'C:/pwsh.exe', args: [], cwd: 'C:/proj' };

describe('terminal.attach reattach identity (retype after timeout, FR-020)', () => {
  it('cold-starts the NEW terminal when the launch changes for a still-running panel', async () => {
    const { host, attach } = makeService();

    await attach({ ...base, launch: bash });
    expect(host.started).toHaveLength(1);
    expect(host.started[0].opts.file).toBe(bash.file);

    // Same panelId, DIFFERENT launch (user re-typed after the attach timed out).
    await attach({ ...base, launch: pwsh });

    // MUST start PowerShell, not silently return the stale git-bash session.
    expect(host.started).toHaveLength(2);
    expect(host.started[1].opts.file).toBe(pwsh.file);
    // And the stale git-bash PTY must be reaped (no orphan).
    expect(host.killed).toContain(host.started[0].handle.pid);
  });

  it('reattaches (reuses) the SAME session when the launch is unchanged (mirror/reopen)', async () => {
    const { host, attach } = makeService();

    await attach({ ...base, launch: bash });
    const second = (await attach({ ...base, launch: bash })) as { result?: { status?: string } };

    expect(host.started).toHaveLength(1); // NOT restarted
    expect(host.killed).toHaveLength(0);
    expect(second.result?.status).toBe('running');
  });

  it("the reaped stale session's delayed exit does not clobber the new session", async () => {
    const { host, attach, statusOf } = makeService();

    await attach({ ...base, launch: bash });
    const stalePid = host.started[0].handle.pid;
    await attach({ ...base, launch: pwsh });

    // The real host fires the killed terminal's exit asynchronously, AFTER the
    // replacement is registered. It must not tear down the new (same-panelId) session.
    host.fireExit(stalePid);

    expect(await statusOf('p1')).toBe('running');
  });
});
