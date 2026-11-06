import { readlink } from 'node:fs/promises';
import { logExpected, type IProcessCwd } from '@throng/core';

/** A shell's working directory, read from the operating system (062 FR-017). A gone or foreign process is absent. */
export class LinuxProcessCwd implements IProcessCwd {
  async read(pids: readonly number[]): Promise<Map<number, string>> {
    const found = new Map<number, string>();
    await Promise.all(
      pids.map(async (pid) => {
        try {
          const cwd = await readlink(`/proc/${pid}/cwd`);
          // The kernel marks a working directory that has been removed.
          if (!cwd.endsWith(' (deleted)')) found.set(pid, cwd);
        } catch (error) {
          logExpected('linux-process-cwd: read cwd', "a shell that has exited, or another user's process, has no readable cwd and is absent, as the interface says", error);
        }
      }),
    );
    return found;
  }
}
