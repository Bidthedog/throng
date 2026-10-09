/**
 * 051 FR-015a — every process a forced end of one terminal must reach: the shell, every process
 * descended from it by parent pid, and the terminal's console host.
 *
 * Walked over ONE process table rather than left to a tree kill, because a tree kill starts from a
 * LIVE root: once the shell has exited, `taskkill /T` on its pid finds nothing, yet its children's
 * recorded parent pid still names it, so the table still links them.
 *
 * Pure. Each pid appears once; a cycle in the table terminates; `selfPid` (the process doing the
 * ending) is never a target, whatever the table claims.
 *
 * A child must not predate its parent (#280): Windows leaves a dead parent's pid in a long-lived
 * process's `ParentProcessId`, so a stale ppid can name the shell. Such a process, and everything
 * under it, belongs to some other program and is never force-killed. The shell's own start is
 * `shellStartedAt`; below it each process's recorded start. An unknown time (`0` or absent)
 * compares as the epoch, matching `descendantsOf`.
 */
export function escalationTargets(
  table: readonly { pid: number; ppid: number; startedAt?: number }[],
  shellPid: number,
  conhostPid: number | null,
  selfPid: number,
  shellStartedAt?: number,
): number[] {
  const children = new Map<number, { pid: number; startedAt: number }[]>();
  const startOf = new Map<number, number>();
  for (const { pid, ppid, startedAt } of table) {
    startOf.set(pid, startedAt ?? 0);
    const list = children.get(ppid);
    const entry = { pid, startedAt: startedAt ?? 0 };
    if (list) list.push(entry);
    else children.set(ppid, [entry]);
  }
  if (shellStartedAt !== undefined) startOf.set(shellPid, shellStartedAt);
  const seen = new Set<number>();
  const queue = [shellPid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid) || pid === selfPid) continue;
    seen.add(pid);
    const parentStart = startOf.get(pid) ?? 0;
    for (const child of children.get(pid) ?? []) {
      if (child.startedAt < parentStart) continue; // a stale ppid, not a child (#280)
      queue.push(child.pid);
    }
  }
  if (conhostPid !== null && conhostPid !== selfPid) seen.add(conhostPid);
  return [...seen];
}
