import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IPtyHost, PtyStartOptions, PtyHandle } from '@throng/core';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * 053 manual test — a running program's window title is lost when throng re-attaches to its terminal.
 *
 * Layer: unit — what a view learns on attach is the daemon's replay, and the replay is built here.
 *
 * The user restarted throng (and unloaded and reloaded a project) with claude already running and titled.
 * A fresh view rebuilds its screen from the replayed scrollback tail, and its header learns the window
 * title only from an OSC 0/2 sequence in what it parses. The tail is bounded (64 KB) and empty while a
 * program holds the alternate screen, so a title set before the tail began never reaches the new view,
 * and the panel's name loses it.
 *
 * The attach hands the view the title alongside the tail (`windowTitle`); the tail itself is untouched,
 * so an alternate-screen program still gets no replay (028).
 */

class RecordingPtyHost implements IPtyHost {
  readonly started: { opts: PtyStartOptions; handle: PtyHandle }[] = [];
  private nextPid = 1000;
  private dataHandlers: ((data: string) => void)[] = [];

  start(opts: PtyStartOptions): PtyHandle {
    const handle = { pid: this.nextPid++ };
    this.started.push({ opts, handle });
    return handle;
  }
  write(): void {}
  resize(): void {}
  async end(): Promise<void> {}
  async forceEnd(): Promise<{ survivors: never[] }> {
    return { survivors: [] };
  }
  onData(_handle: PtyHandle, cb: (data: string) => void): () => void {
    this.dataHandlers.push(cb);
    return () => {};
  }
  emitData(data: string): void {
    for (const h of this.dataHandlers) h(data);
  }
  listChildProcesses(): { pid: number; commandLine: string }[] {
    return [];
  }
  onExit(): () => void {
    return () => {};
  }
  async probeChildPids(): Promise<number[]> {
    return [];
  }
}

const noopLock = { acquire: async () => ({ path: 'x' }), release: async () => {} };

function makeService() {
  vi.useFakeTimers();
  const host = new RecordingPtyHost();
  const events = new TerminalEvents();
  const service = new TerminalService(host, events, new TerminalLockManager(noopLock), { isElevated: () => false });
  const router = new RpcRouter();
  service.register(router);
  const attach = async (viewId: string): Promise<{ scrollback: string; windowTitle?: string }> => {
    const res = (await router.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'terminal.attach',
      params: { panelId: 'p1', projectId: 'proj', viewId, cols: 100, rows: 30, launch },
    })) as { result: { scrollback: string; windowTitle?: string } };
    return res.result;
  };
  return { host, attach };
}

const launch = { file: 'C:/pwsh.exe', args: [], cwd: 'C:/proj' };
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const title = (t: string): string => `${ESC}]0;${t}${BEL}`;

/** The window title a re-attaching view is told: the attach's title, else the last OSC 0/2 in its tail. */
function titleAfter(res: { scrollback: string; windowTitle?: string }): string | undefined {
  if (res.windowTitle !== undefined) return res.windowTitle;
  const pattern = new RegExp(`${ESC}\\][02];([^${BEL}${ESC}]*)(?:${BEL}|${ESC}\\\\)`, 'g');
  let last: string | undefined;
  for (const m of res.scrollback.matchAll(pattern)) last = m[1];
  return last;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a re-attaching view learns the running program’s window title', () => {
  it('after more output than the replayed tail holds', async () => {
    const { host, attach } = makeService();
    await attach('A');
    host.emitData(title('✳ work on links'));
    host.emitData('x'.repeat(70 * 1024));

    expect(titleAfter(await attach('B'))).toBe('✳ work on links');
  });

  it('while the program holds the alternate screen, when no tail is replayed at all', async () => {
    const { host, attach } = makeService();
    await attach('A');
    host.emitData(title('✳ work on links'));
    host.emitData(`${ESC}[?1049h`);

    const res = await attach('B');

    expect(titleAfter(res)).toBe('✳ work on links');
    expect(res.scrollback, 'an alternate-screen program still gets no replayed tail (028)').toBe('');
  });

  it('control: the latest title wins, and a cleared title stays cleared', async () => {
    const { host, attach } = makeService();
    await attach('A');
    host.emitData(title('first'));
    host.emitData(title('second'));
    host.emitData('y'.repeat(70 * 1024));
    expect(titleAfter(await attach('B'))).toBe('second');

    host.emitData(title(''));
    host.emitData('z'.repeat(70 * 1024));
    expect(titleAfter(await attach('C')) ?? '').toBe('');
  });
});
