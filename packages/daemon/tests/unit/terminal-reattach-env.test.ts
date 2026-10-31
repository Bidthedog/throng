import { describe, it, expect } from 'vitest';
import type { IPtyHost, PtyStartOptions, PtyHandle, PtyExit } from '@throng/core';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * A terminal kept running across an unload/reattach keeps its environment. At the daemon
 * boundary that means: a reattach reuses the running host process (the shell's environment is
 * a property of that process, so it is untouched) and never re-launches with the reattach
 * call's `launch.env` / `launch.baseEnv`. Only a real shell can show the variables themselves;
 * this proves the daemon neither respawns nor re-applies a new environment.
 * (Replaces the environment half of the deleted terminal-unload-keep integration test.)
 */

class FakePtyHost implements IPtyHost {
  readonly started: PtyStartOptions[] = [];
  private nextPid = 2000;

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
  onExit(_handle: PtyHandle, _cb: (e: PtyExit) => void): () => void {
    return () => {};
  }
  async probeChildPids(): Promise<number[]> {
    return [];
  }
}

const noopLock = { acquire: async () => ({ path: 'x' }), release: async () => {} };

function makeService() {
  const host = new FakePtyHost();
  const service = new TerminalService(host, new TerminalEvents(), new TerminalLockManager(noopLock), {
    isElevated: () => false,
  });
  const router = new RpcRouter();
  service.register(router);
  const attach = (params: object) =>
    router.handle({ jsonrpc: '2.0', id: 1, method: 'terminal.attach', params });
  return { host, attach };
}

const base = { panelId: 'p1', projectId: 'proj', cols: 80, rows: 24 };

describe('terminal.attach reattach keeps the running session environment', () => {
  it('reuses the running host process and never applies the reattach call\'s env', async () => {
    const { host, attach } = makeService();
    const original = {
      file: 'C:/git/bin/bash.exe',
      args: [],
      cwd: 'C:/proj',
      env: { THRONG_MARK: 'original' },
      baseEnv: { PATH: 'C:/original' },
    };
    await attach({ ...base, launch: original });

    const second = (await attach({
      ...base,
      launch: { ...original, env: { THRONG_MARK: 'changed' }, baseEnv: { PATH: 'C:/changed' } },
    })) as { result?: { status?: string } };

    expect(second.result?.status).toBe('running');
    expect(host.started).toHaveLength(1); // same process: nothing relaunched with a new env
    expect(host.started[0].env).toEqual({ THRONG_MARK: 'original' });
    expect(host.started[0].baseEnv).toEqual({ PATH: 'C:/original' });
  });
});
