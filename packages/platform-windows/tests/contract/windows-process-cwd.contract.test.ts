import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WindowsProcessCwd } from '../../src/windows-process-cwd.js';

// 012 revision: the process-cwd OS seam reads a live process's working directory by
// walking its PEB. This contract test spawns a real child in a KNOWN directory and
// reads it back, proving the FFI/offset logic end-to-end on the host.

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe('WindowsProcessCwd (PEB read)', () => {
  it('reads the working directory of a running process by pid', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'throng-cwd-')));
    // A long-lived child that just waits, launched IN the known directory. `cmd /k`
    // stays alive with no output; we read its cwd then kill it.
    const child = spawn('cmd.exe', ['/k'], { cwd: dir, windowsHide: true });
    cleanups.push(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      // Best-effort: cmd.exe holds `dir` as its cwd until it fully exits, so an
      // immediate delete can EPERM. Swallow it — the OS temp dir is reclaimed later.
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
      } catch {
        /* the child still holds the directory; leave it for the OS to reap */
      }
    });
    expect(child.pid).toBeGreaterThan(0);

    // Give the shell a moment to initialise its process parameters.
    await new Promise((r) => setTimeout(r, 400));

    const cwds = await new WindowsProcessCwd().read([child.pid!]);
    const read = cwds.get(child.pid!);
    expect(read, 'a cwd should be read for the live child').toBeTruthy();
    // Case-insensitive path compare (Windows) with normalised separators.
    expect(read!.toLowerCase()).toBe(dir.toLowerCase());
  });

  it('omits a pid that does not exist (never throws)', async () => {
    const cwds = await new WindowsProcessCwd().read([0, 999999999]);
    expect(cwds.size).toBe(0);
  });
});
