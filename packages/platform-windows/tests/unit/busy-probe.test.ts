import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 046 branch review #2 / #1 — the busy probe behind Unload's dialog and `closeIdle`.
 *
 * #2: a probe that FAILS (PowerShell missing, CIM refusing, the 5 s timeout on a loaded machine)
 * must never read as "no children". An empty answer is how an idle shell looks, so a swallowed
 * failure classifies a running build as idle and `closeIdle` ends it. The probe has to say it does
 * not know, and the caller then treats the terminal as busy.
 *
 * #1: the probe must be ASYNC (the daemon's one event loop serves every terminal's output) and one
 * snapshot must serve every terminal asked about together — a snapshot costs ~0.55–0.7 s here
 * (measured: `Get-CimInstance Win32_Process`, five cold runs), so one per terminal, in series,
 * blows through main's call budget with three terminals.
 *
 * `node:child_process` is mocked; node-pty itself loads for real (the constructor requires it) but
 * no terminal is started.
 */

const execFileSync = vi.fn();
const execFile = vi.fn();
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync, execFile };
});

/** A fresh module per test: the shared snapshot is module state, and must not leak between tests. */
async function newHost() {
  vi.resetModules();
  const { NodePtyHost } = await import('../../src/node-pty-host.js');
  return new NodePtyHost();
}

/** `pid,ppid` lines, the shape the pid snapshot asks PowerShell for. Shell 100 has child 200. */
const TABLE = ['4,0', '100,1', '200,100', '300,1'].join('\r\n');

type Callback = (err: Error | null, stdout?: string, stderr?: string) => void;

beforeEach(() => {
  execFileSync.mockReset();
  execFile.mockReset();
});

describe('a failed probe never reads as idle (review #2)', () => {
  it('listChildPids THROWS when the snapshot fails, rather than returning []', async () => {
    execFileSync.mockImplementation(() => {
      throw new Error('spawnSync powershell.exe ETIMEDOUT');
    });
    const host = await newHost();
    expect(() => host.listChildPids({ pid: 100 })).toThrow();
  });

  it('probeChildPids REJECTS when the snapshot fails', async () => {
    execFile.mockImplementation((_f: string, _a: string[], _o: unknown, cb: Callback) => {
      cb(new Error('Command failed: powershell.exe (timed out)'));
    });
    const host = await newHost();
    await expect(host.probeChildPids!({ pid: 100 })).rejects.toThrow();
  });

  it('probeChildPids REJECTS an empty table — a snapshot without even System is not an answer', async () => {
    execFile.mockImplementation((_f: string, _a: string[], _o: unknown, cb: Callback) => {
      cb(null, '', '');
    });
    const host = await newHost();
    await expect(host.probeChildPids!({ pid: 100 })).rejects.toThrow();
  });
});

describe('one async snapshot serves every terminal asked about together (review #1)', () => {
  it('answers each terminal from ONE execFile call, and never uses execFileSync', async () => {
    execFile.mockImplementation((_f: string, _a: string[], _o: unknown, cb: Callback) => {
      setTimeout(() => cb(null, TABLE, ''), 5);
    });
    const host = await newHost();

    const [busy, idle, gone] = await Promise.all([
      host.probeChildPids!({ pid: 100 }),
      host.probeChildPids!({ pid: 300 }),
      host.probeChildPids!({ pid: 999 }),
    ]);

    expect(busy).toEqual([200]);
    expect(idle).toEqual([]);
    expect(gone).toEqual([]);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('a later call takes a FRESH snapshot — the sharing never outlives the one call', async () => {
    execFile.mockImplementation((_f: string, _a: string[], _o: unknown, cb: Callback) => {
      setTimeout(() => cb(null, TABLE, ''), 5);
    });
    const host = await newHost();

    await host.probeChildPids!({ pid: 100 });
    await new Promise((r) => setTimeout(r, 400));
    await host.probeChildPids!({ pid: 100 });

    expect(execFile).toHaveBeenCalledTimes(2);
  });
});
