import type { IOrphanProcesses, OrphanCandidate } from '@throng/core';
import { programName, readCommandLine, readProcTable, trySignal } from './proc-table.js';

/**
 * The process table for the orphan sweep (062 FR-018).
 *
 * A Linux process whose parent dies is adopted by init or the user's systemd, so its parent still looks alive. Those
 * two are reported as "no parent" (-1): that is what adoption means, and it lets the one orphan rule serve both
 * platforms. Only processes `isThrongOwned` accepts are ever signalled.
 */
export class LinuxOrphanProcesses implements IOrphanProcesses {
  async snapshot(): Promise<OrphanCandidate[]> {
    const rows = await readProcTable();
    const byPid = new Map(rows.map((row) => [row.pid, row]));
    const adopters = (ppid: number): boolean => ppid === 1 || byPid.get(ppid)?.comm === 'systemd';
    return Promise.all(
      rows.map(async (row) => ({
        pid: row.pid,
        ppid: adopters(row.ppid) ? -1 : row.ppid,
        name: programName(row),
        createdMs: row.startedAt,
        commandLine: await readCommandLine(row.pid),
      })),
    );
  }

  kill(pid: number): boolean {
    return trySignal(pid, 'SIGKILL');
  }
}
