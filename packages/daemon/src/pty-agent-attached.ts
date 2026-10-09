/**
 * The PTY agent's answer to an `attachedprocs` request (051 FR-040/FR-041). Kept out of
 * `pty-agent-entry.ts`, which starts a server on import, so the rule it carries can be tested.
 *
 * The daemon knows each terminal only by its synthetic key, never by the shell's OS pid, so the
 * shell's own pid is rewritten to the key — as a pid and as a parent pid — exactly as `childprocs`
 * re-parents direct children. A failed request is reported as failed, never as an empty answer:
 * empty would read as "nothing attached" and clear a remembered command (FR-042).
 */
import type { ChildProcess, IPtyHost, PtyHandle } from '@throng/core';
import type { AgentCommand, AgentEvent } from './pty-agent-protocol.js';

export async function answerAttachedProcs(
  list: NonNullable<IPtyHost['listAttachedProcesses']> | undefined,
  handleOf: (key: number) => PtyHandle | undefined,
  msg: Extract<AgentCommand, { op: 'attachedprocs' }>,
  log: (line: string) => void,
): Promise<Extract<AgentEvent, { ev: 'attachedprocs' }>> {
  const live = msg.keys.flatMap((key) => {
    const handle = handleOf(key);
    return handle ? [{ key, handle }] : [];
  });
  if (!list) return { ev: 'attachedprocs', reqId: msg.reqId, byKey: {}, failed: true };
  let byShell: Map<number, ChildProcess[]>;
  try {
    byShell = live.length === 0 ? new Map() : await list(live.map((l) => l.handle));
  } catch (error) {
    log(`attachedprocs error: ${error instanceof Error ? error.message : String(error)}`);
    return { ev: 'attachedprocs', reqId: msg.reqId, byKey: {}, failed: true };
  }
  const byKey: Record<string, ChildProcess[]> = {};
  for (const { key, handle } of live) {
    const procs = byShell.get(handle.pid);
    if (!procs) continue; // unknown for this terminal: the daemon falls back to its direct children
    const shell = handle.pid;
    byKey[String(key)] = procs.map((p) => ({
      ...p,
      pid: p.pid === shell ? key : p.pid,
      ppid: p.ppid === shell ? key : p.ppid,
    }));
  }
  return { ev: 'attachedprocs', reqId: msg.reqId, byKey };
}
