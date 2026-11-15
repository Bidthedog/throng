/** What the scope needs of a process-table row. */
export interface ParentedRow {
  readonly pid: number;
  readonly ppid: number;
}

export interface RelevantProcessesDeps<R extends ParentedRow> {
  readonly uid: number;
  listPids(): readonly number[];
  readRow(pid: number): R | null;
  /** The owner of `pid`, or null once it has gone. */
  ownerOf(pid: number): number | null;
}

/**
 * The processes a collector tick reads: the user's own, and anything started beneath one, such as a `sudo` in a terminal.
 * Shared by Linux and macOS (070 FR-033, R1); each supplies its own table.
 *
 * Attribution only claims what the roster leads to, so the system's daemons and kernel threads cost a read every tick for
 * nothing, and they are most of a machine's table (measured on Linux: 372 of 539). Each is read once to learn what it is,
 * then left out until its pid goes away. That hides nothing later: a process only ever reparents upwards, so one with no
 * user process above it never gains one. 055 SC-004, for the same reason Windows reads one session's table.
 */
export class RelevantProcesses<R extends ParentedRow> {
  private readonly system = new Set<number>();
  private readonly relevant = new Set<number>();

  constructor(private readonly deps: RelevantProcessesDeps<R>) {}

  read(): R[] {
    const listed = this.deps.listPids();
    const present = new Set(listed);
    for (const known of [this.system, this.relevant]) {
      for (const pid of known) if (!present.has(pid)) known.delete(pid);
    }
    const rows = new Map<number, R>();
    for (const pid of listed) {
      if (this.system.has(pid)) continue;
      const row = this.deps.readRow(pid);
      if (row) rows.set(pid, row);
    }
    for (const row of rows.values()) this.classify(row, rows);
    return [...rows.values()].filter((row) => this.relevant.has(row.pid));
  }

  private classify(row: R, rows: ReadonlyMap<number, R>): void {
    if (this.relevant.has(row.pid) || this.system.has(row.pid)) return;
    const chain: number[] = [];
    let at: R | undefined = row;
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
