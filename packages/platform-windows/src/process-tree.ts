/** The fields a descendant walk needs from a process-table row. */
export interface ProcessTreeRow {
  readonly pid: number;
  readonly ppid: number;
  /** Creation time in ms since the epoch; `0` or absent when unknown. */
  readonly startedAt?: number;
}

/**
 * Every process below `rootPid` in a parent-indexed process table, each at most once.
 *
 * ══ WHY THE TABLE CANNOT BE TRUSTED TO BE A TREE ══
 *
 * Windows reuses pids, and a process keeps the parent pid it was BORN with after that parent has
 * exited. So a snapshot can say "X's parent is 100" when 100 now belongs to a different, younger
 * process — a shell a terminal has just started. If X happens to be an ANCESTOR of that shell (the
 * app, the daemon, the PTY agent), the parent graph is a cycle.
 *
 * An unguarded walk never leaves that cycle: its stack grows until V8 refuses the push
 * (`RangeError: Invalid array length`) or the heap runs out. It runs inside the daemon or the
 * PTY agent, whose event loop serves every terminal, so for those seconds no terminal starts,
 * echoes or exits — and a heap exhaustion kills the agent, ending every terminal it hosts with
 * no exit code. Measured in the agent's own log during a stalled E2E run.
 *
 * Two guards, for two different facts:
 *
 *   • an edge whose child is OLDER than its recorded parent is a stale pid, not a parentage — a
 *     process cannot predate the process that created it. This drops the false descendants a
 *     recycled pid would otherwise hand command memory, cycle or not;
 *   • a process already visited is never visited again. Creation times are not always known
 *     (`listChildPids` reads pids alone, and CIM leaves some unreadable), so termination cannot
 *     rest on the first guard.
 */
export function descendantsOf<T extends ProcessTreeRow>(
  byParent: ReadonlyMap<number, readonly T[]>,
  rootPid: number,
): T[] {
  const startedAt = new Map<number, number>();
  for (const rows of byParent.values()) {
    for (const row of rows) startedAt.set(row.pid, row.startedAt ?? 0);
  }

  const result: T[] = [];
  const visited = new Set<number>([rootPid]);
  const stack: number[] = [rootPid];
  while (stack.length > 0) {
    const parentPid = stack.pop() as number;
    const parentStarted = startedAt.get(parentPid) ?? 0;
    for (const child of byParent.get(parentPid) ?? []) {
      if (visited.has(child.pid)) continue;
      const childStarted = child.startedAt ?? 0;
      if (parentStarted > 0 && childStarted > 0 && childStarted < parentStarted) continue;
      visited.add(child.pid);
      result.push(child);
      stack.push(child.pid);
    }
  }
  return result;
}
