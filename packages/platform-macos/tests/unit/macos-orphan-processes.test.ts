import { describe, expect, it } from 'vitest';
import { MacosOrphanProcesses } from '../../src/macos-process-services.js';
import { fakeLibSystem, type FakeProcess } from '../support/fake-libsystem.js';

const ME = 501;
const proc = (pid: number, uid: number, comm: string, argv?: string[]): FakeProcess => ({
  pid,
  ppid: 1,
  uid,
  comm,
  startedAt: 1_700_000_000_000 + pid,
  argv,
});

/**
 * The sweep runs on every daemon start over the whole table (070 FR-018, R10). Only this user's `node` (and
 * `conhost.exe`, never seen on a Mac) can be throng's, so only those cost a `KERN_PROCARGS2` read.
 */
describe('MacosOrphanProcesses', () => {
  it('reads the command line only of this user’s processes the sweep could accept', async () => {
    const lib = fakeLibSystem([
      proc(1, 0, 'launchd'),
      proc(90, 0, 'node', ['node', 'root-owned.js']),
      proc(500, ME, 'zsh', ['-zsh']),
      proc(600, ME, 'node', ['node', 'pty-agent-entry.js']),
    ]);
    const rows = await new MacosOrphanProcesses({ lib, uid: ME }).snapshot();
    expect(lib.argvReads).toEqual([600]);
    expect(rows.find((r) => r.pid === 600)).toMatchObject({ commandLine: 'node pty-agent-entry.js', ppid: -1, name: 'node' });
    expect(rows.find((r) => r.pid === 90)?.commandLine).toBe('');
    expect(rows.find((r) => r.pid === 500)?.commandLine).toBe('');
    expect(rows).toHaveLength(4);
  });
});
