import { describe, it, expect } from 'vitest';
import type { IPtyHost, PtyStartOptions, PtyHandle, PtyExit } from '@throng/core';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * 008 FR-002 / FR-007 (clarified 2026-07-10). The prior design inferred intent from a
 * launchKey (which INCLUDED the working directory) and REAPED a running session whenever
 * the key differed. A tab mirrored into a sub-workspace resolves a different cwd, so the
 * launch looked different and the running program was killed — the data loss in User
 * Story 1. The fix makes intent EXPLICIT in the protocol rather than inferred:
 *   • an IMPLICIT attach (mirror / re-render / reconnect — `explicit` absent/false) MUST
 *     reuse a running session for the panel, whatever launch identity it computes, and
 *     MUST NOT reap it; and
 *   • an EXPLICIT re-type (`explicit: true` — the user deliberately picked a different
 *     terminal) IS a user-initiated destroy-then-create: it terminates the running session
 *     and cold-starts the new flavour (FR-007 explicit request).
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
const bashOtherCwd = { file: 'C:/git/bin/bash.exe', args: [], cwd: 'C:/proj/sub' };
const pwsh = { file: 'C:/pwsh.exe', args: [], cwd: 'C:/proj' };

describe('terminal.attach intent — implicit reuses, explicit re-types (008 FR-002/FR-007)', () => {
  it('IMPLICIT reattach reuses the SAME session when the launch is unchanged (mirror/reopen)', async () => {
    const { host, attach } = makeService();

    await attach({ ...base, launch: bash });
    const second = (await attach({ ...base, launch: bash })) as { result?: { status?: string } };

    expect(host.started).toHaveLength(1); // NOT restarted
    expect(host.killed).toHaveLength(0);
    expect(second.result?.status).toBe('running');
  });

  it('IMPLICIT reattach reuses the running session when only the working directory differs (cwd not inferred)', async () => {
    const { host, attach } = makeService();

    await attach({ ...base, launch: bash });
    // A mirror into a sub-workspace resolves a different cwd — this MUST NOT reap.
    const second = (await attach({ ...base, launch: bashOtherCwd })) as { result?: { status?: string } };

    expect(host.started).toHaveLength(1);
    expect(host.killed).toHaveLength(0);
    expect(second.result?.status).toBe('running');
  });

  it('IMPLICIT reattach reuses the running session even when the launch genuinely differs (no inferred reap)', async () => {
    const { host, attach } = makeService();

    await attach({ ...base, launch: bash });
    // A DIFFERENT launch arriving IMPLICITLY (e.g. a re-render that recomputed a flavour)
    // must not kill the running program — intent is not inferred from the launch key.
    const second = (await attach({ ...base, launch: pwsh })) as { result?: { status?: string } };

    expect(host.started).toHaveLength(1); // still the original session
    expect(host.killed).toHaveLength(0); // the running git-bash was NOT reaped
    expect(second.result?.status).toBe('running');
  });

  it('EXPLICIT re-type terminates the running session and cold-starts the new flavour', async () => {
    const { host, attach } = makeService();

    await attach({ ...base, launch: bash });
    const bashPid = host.started[0].handle.pid;
    // The user deliberately re-typed the panel (PowerShell instead of git-bash): an
    // explicit destroy-then-create. The old shell MUST be terminated and the new one started.
    const second = (await attach({ ...base, launch: pwsh, explicit: true })) as { result?: { status?: string } };

    expect(host.started).toHaveLength(2);
    expect(host.started[1].opts.file).toBe(pwsh.file); // the NEW flavour actually launches
    expect(host.killed).toContain(bashPid); // the old running shell is reaped
    expect(second.result?.status).toBe('running');
  });

  it("an explicitly-reaped session's delayed exit does not clobber the new session", async () => {
    const { host, attach, statusOf } = makeService();

    await attach({ ...base, launch: bash });
    const stalePid = host.started[0].handle.pid;
    await attach({ ...base, launch: pwsh, explicit: true });

    // The real host fires the killed terminal's exit asynchronously, AFTER the
    // replacement is registered. It must not tear down the new (same-panelId) session.
    host.fireExit(stalePid);

    expect(await statusOf('p1')).toBe('running');
  });

  it('cold-starts a fresh session only after the previous one has exited', async () => {
    const { host, attach, statusOf } = makeService();

    await attach({ ...base, launch: bash });
    const firstPid = host.started[0].handle.pid;
    // The shell exits on its own (user typed `exit`) — the session is removed from the registry.
    host.fireExit(firstPid);
    expect(await statusOf('p1')).toBeUndefined();

    // A subsequent attach for the same panel now cold-starts (nothing running to reuse).
    await attach({ ...base, launch: pwsh });
    expect(host.started).toHaveLength(2);
    expect(host.started[1].opts.file).toBe(pwsh.file);
  });
});
