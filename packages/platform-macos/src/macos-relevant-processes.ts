import process from 'node:process';
import { RelevantProcesses } from '@throng/platform-node';
import type { LibSystem } from './libsystem.js';
import { libSystem } from './libsystem.js';
import { listAllPids, readMacosProcRow, type MacosProcRow } from './macos-proc-table.js';

/**
 * The user's processes and those started beneath them, from the libproc table (070 FR-033, R2): the same scope Linux's
 * collector reads, so a tick never reads the system's daemons twice. `proc_pidinfo` gives the owner with the row, so
 * the owner asked about is the row's, read once per tick.
 */
export function macosRelevantProcesses(
  lib: LibSystem | null = libSystem(),
  uid: number = process.getuid?.() ?? 0,
): RelevantProcesses<MacosProcRow> {
  const seen = new Map<number, MacosProcRow>();
  return new RelevantProcesses<MacosProcRow>({
    uid,
    listPids: () => {
      seen.clear();
      return listAllPids(lib);
    },
    readRow: (pid) => {
      const row = readMacosProcRow(pid, lib);
      if (row) seen.set(pid, row);
      return row;
    },
    ownerOf: (pid) => (seen.get(pid) ?? readMacosProcRow(pid, lib))?.uid ?? null,
  });
}
