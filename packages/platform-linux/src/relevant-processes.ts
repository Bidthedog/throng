import { readdirSync, readFileSync, statSync } from 'node:fs';
import process from 'node:process';
import { logExpected } from '@throng/core';
import { parseStat, type ProcRow } from './proc-table.js';

export interface RelevantProcessesDeps {
  readonly uid: number;
  listPids(): readonly number[];
  readRow(pid: number): ProcRow | null;
  /** The owner of `pid`, or null once it has gone. */
  ownerOf(pid: number): number | null;
}

/**
 * The processes a collector tick reads: the user's own, and anything started beneath one, such as a `sudo` in a terminal.
 *
 * Attribution only claims what the roster leads to, so the system's daemons and kernel threads cost a read every tick for
 * nothing, and they are most of a machine's table (measured: 372 of 539). Each is read once to learn what it is, then left
 * out until its pid goes away. That hides nothing later: a process only ever reparents upwards, so one with no user process
 * above it never gains one. 055 SC-004, for the same reason Windows reads one session's table.
 */
export class RelevantProcesses {
  private readonly system = new Set<number>();
  private readonly relevant = new Set<number>();

  constructor(private readonly deps: RelevantProcessesDeps) {}

  read(): ProcRow[] {
    const listed = this.deps.listPids();
    const present = new Set(listed);
    for (const known of [this.system, this.relevant]) {
      for (const pid of known) if (!present.has(pid)) known.delete(pid);
    }
    const rows = new Map<number, ProcRow>();
    for (const pid of listed) {
      if (this.system.has(pid)) continue;
      const row = this.deps.readRow(pid);
      if (row) rows.set(pid, row);
    }
    for (const row of rows.values()) this.classify(row, rows);
    return [...rows.values()].filter((row) => this.relevant.has(row.pid));
  }

  private classify(row: ProcRow, rows: ReadonlyMap<number, ProcRow>): void {
    if (this.relevant.has(row.pid) || this.system.has(row.pid)) return;
    const chain: number[] = [];
    let at: ProcRow | undefined = row;
    let isRelevant = false;
    while (at && !chain.includes(at.pid)) {
      chain.push(at.pid);
      if (this.relevant.has(at.pid) || this.deps.ownerOf(at.pid) === this.deps.uid) {
        isRelevant = true;
        break;
      }
      at = rows.get(at.ppid);
    }
    const into = isRelevant ? this.relevant : this.system;
    for (const pid of chain) into.add(pid); // Everything walked past shares the answer.
  }
}

/**
 * The real machine, for the collector. It has a process of its own to block, and over 521 processes a blocking read cost
 * a tenth of the CPU of the async one (measured, 055 SC-004).
 */
export function procRelevantProcesses(units: Parameters<typeof parseStat>[1]): RelevantProcesses {
  return new RelevantProcesses({
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
