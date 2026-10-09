/**
 * How far a host's OS creation time may read before its session's recorded spawn time and still be
 * that session's. Both come from the same system clock and the host is created DURING the spawn, so
 * this only absorbs rounding between the two readings.
 */
export const CONHOST_CLOCK_TOLERANCE_MS = 250;

/**
 * 051 R5 — attribute per-terminal console hosts to the sessions waiting for one.
 *
 * node-pty creates each terminal's host during its synchronous spawn, so hosts are created in spawn
 * order and none of a pending session's is older than the oldest pending spawn. Hosts older than
 * that are orphans or belong to sessions that already hold one, and are never candidates.
 *
 * The caller reads the table and THEN lists what is pending, so every host in the table belongs to a
 * listed session or to none: a terminal that spawned while the table was being read is pending too,
 * and is either in the table — and paired — or not yet, and waits for a later pass. The candidates
 * are therefore the hosts of a PREFIX of the pending sessions, paired oldest-first.
 *
 * Pairing the NEWEST hosts instead, as this once did, gives an earlier session a later terminal's
 * host whenever a terminal spawns during the read — and ending one terminal then ends another's.
 *
 * Pure: the caller reads the process table and owns the sessions.
 *
 * @param pending sessions with no host yet: spawn sequence number and the time just before spawning
 * @param hosts this process's console hosts with their OS creation time, epoch ms
 * @param claimed hosts already attributed to a session, or being reaped
 * @returns spawn sequence number → host pid, for every session that could be given one
 */
export function assignConhosts(
  pending: readonly { seq: number; spawnedAt: number }[],
  hosts: readonly { pid: number; createdAt: number }[],
  claimed: ReadonlySet<number>,
): Map<number, number> {
  const assigned = new Map<number, number>();
  if (pending.length === 0) return assigned;
  const ordered = [...pending].sort((a, b) => a.seq - b.seq);
  const floor = Math.min(...ordered.map((s) => s.spawnedAt)) - CONHOST_CLOCK_TOLERANCE_MS;
  const candidates = hosts
    .filter((h) => !claimed.has(h.pid) && h.createdAt >= floor)
    .sort((a, b) => a.createdAt - b.createdAt || a.pid - b.pid);
  for (let i = 0; i < Math.min(candidates.length, ordered.length); i += 1) {
    assigned.set(ordered[i]!.seq, candidates[i]!.pid);
  }
  return assigned;
}
