/**
 * The PTY agent's answer to a `cwds` request (012, 053 FR-001). Kept out of `pty-agent-entry.ts`, which starts a
 * server on import, so the rule it carries can be tested.
 *
 * The daemon knows each terminal only by its synthetic key, never by the shell's OS pid, so it cannot read a shell's
 * working directory itself: asked by key, the OS answers about some other process or none. The agent holds the real
 * pids, reads them, and answers by key. A terminal it could not read is absent — the daemon then keeps its last
 * value — and a failed read is an empty answer, which changes nothing.
 */
import type { IProcessCwd, PtyHandle } from '@throng/core';
import type { AgentCommand, AgentEvent } from './pty-agent-protocol.js';

export async function answerCwds(
  cwd: IProcessCwd,
  handleOf: (key: number) => PtyHandle | undefined,
  msg: Extract<AgentCommand, { op: 'cwds' }>,
  log: (line: string) => void,
): Promise<Extract<AgentEvent, { ev: 'cwds' }>> {
  const live = msg.keys.flatMap((key) => {
    const handle = handleOf(key);
    return handle ? [{ key, pid: handle.pid }] : [];
  });
  const byKey: Record<string, string> = {};
  if (live.length === 0) return { ev: 'cwds', reqId: msg.reqId, byKey };
  try {
    const byPid = await cwd.read(live.map((l) => l.pid));
    for (const { key, pid } of live) {
      const dir = byPid.get(pid);
      if (dir !== undefined) byKey[String(key)] = dir;
    }
  } catch (error) {
    log(`cwds error: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ev: 'cwds', reqId: msg.reqId, byKey };
}
