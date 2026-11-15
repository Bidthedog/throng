import { readdirSync, readFileSync, statSync } from 'node:fs';
import process from 'node:process';
import { logExpected } from '@throng/core';
import { parseStat, type ProcRow } from './proc-table.js';
import { RelevantProcesses } from '@throng/platform-node';

/** The shared POSIX scope (070 R1), under the names Linux has always imported. */
export { RelevantProcesses };
export type { RelevantProcessesDeps } from '@throng/platform-node';

/**
 * The real machine, for the collector. It has a process of its own to block, and over 521 processes a blocking read cost
 * a tenth of the CPU of the async one (measured, 055 SC-004).
 */
export function procRelevantProcesses(units: Parameters<typeof parseStat>[1]): RelevantProcesses<ProcRow> {
  return new RelevantProcesses<ProcRow>({
    uid: process.getuid?.() ?? 0,
    listPids: () => readdirSync('/proc').filter((name) => /^\d+$/.test(name)).map(Number),
    readRow: (pid) => {
      try {
        return parseStat(readFileSync(`/proc/${pid}/stat`, 'utf8'), units);
      } catch (error) {
        logExpected('relevant-processes: read stat', 'a process can exit between the /proc listing and this read', error);
        return null;
      }
    },
    ownerOf: (pid) => statSync(`/proc/${pid}`, { throwIfNoEntry: false })?.uid ?? null,
  });
}
