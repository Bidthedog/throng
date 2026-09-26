/**
 * The PTY agent's answer to a `childpids` request (046 branch review #1, #2). Kept out of
 * `pty-agent-entry.ts`, which starts a server on import, so the rule it carries can be tested.
 *
 * Two rules:
 *
 *   - **A failed probe is reported as failed, never as `pids: []`.** An empty list is how an idle
 *     shell looks, so a swallowed PowerShell timeout made the daemon count a running build as idle,
 *     and Unload's `closeIdle` ended it. The daemon treats `failed` as busy.
 *   - **The probe is awaited.** The agent's own event loop carries every terminal it hosts, so the
 *     synchronous whole-table scan it used to run per request froze all of them; the async probe
 *     also shares one snapshot between requests that arrive together.
 */
import type { PtyHandle } from '@throng/core';
import type { AgentCommand, AgentEvent } from './pty-agent-protocol.js';

export async function answerChildPids(
  probe: (handle: PtyHandle) => Promise<number[]>,
  handle: PtyHandle | undefined,
  msg: Extract<AgentCommand, { op: 'childpids' }>,
  log: (line: string) => void,
): Promise<Extract<AgentEvent, { ev: 'childpids' }>> {
  // A key the agent no longer holds is a terminal that has ended: it has no children, which is a
  // real answer, not an unknown one.
  if (!handle) return { ev: 'childpids', key: msg.key, reqId: msg.reqId, pids: [] };
  try {
    return { ev: 'childpids', key: msg.key, reqId: msg.reqId, pids: await probe(handle) };
  } catch (error) {
    log(`childpids error key=${msg.key}: ${error instanceof Error ? error.message : String(error)}`);
    return { ev: 'childpids', key: msg.key, reqId: msg.reqId, pids: [], failed: true };
  }
}
