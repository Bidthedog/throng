/**
 * Wire protocol between the daemon and its **de-elevated PTY agent** (FR-025c mixed
 * mode). An elevated daemon can't drop a node-pty child's integrity in-process (a
 * medium child can't attach to the elevated-owned ConPTY — verified), so unchecked
 * terminals are hosted by a separate **medium-integrity** agent process that creates
 * its OWN ConPTY. The two talk newline-delimited JSON over a dedicated named pipe
 * (handle inheritance doesn't survive the de-elevated launch, so a pipe — not stdio
 * — is used). Each terminal is keyed by a daemon-assigned integer `key` (the synthetic
 * `PtyHandle.pid` the daemon hands to `TerminalService`), not the OS pid.
 */
import type { ChildProcess, ProcessSurvivor } from '@throng/core';


/** Daemon → agent commands. */
export type AgentCommand =
  // First frame: tells the agent which pid to watch so it can self-terminate (and
  // reap its terminals) if the daemon dies WITHOUT a clean pipe close (T134).
  | { op: 'hello'; daemonPid: number }
  | { op: 'start'; key: number; file: string; args: string[]; cwd: string; cols: number; rows: number; env?: Record<string, string> }
  | { op: 'write'; key: number; data: string }
  | { op: 'resize'; key: number; cols: number; rows: number }
  // 051: an end with an outcome, answered by `ended` once the agent's own host has settled it.
  | { op: 'end'; key: number; reqId: number; timeoutMs: number }
  // 051 FR-015a: escalation, answered by `forceEnded` with whatever survived.
  | { op: 'forceEnd'; key: number; reqId: number; timeoutMs: number }
  | { op: 'childpids'; key: number; reqId: number }
  // 051 FR-040/FR-041: what is attached to each of these terminals' consoles, in one request.
  | { op: 'attachedprocs'; keys: number[]; reqId: number }
  // 025: command lines too, for a Panel's command memory. Async by contract (FR-019b).
  | { op: 'childprocs'; key: number; reqId: number };

/** Agent → daemon events. */
export type AgentEvent =
  | { ev: 'ready' }
  | { ev: 'started'; key: number; pid: number }
  | { ev: 'error'; key: number; message: string }
  | { ev: 'data'; key: number; data: string }
  | { ev: 'exit'; key: number; code: number | null; signal?: string }
  // `failed`: the agent could not read the process table (046). `pids` is then meaningless — it is
  // NOT "no children", and the daemon treats the terminal as busy.
  | { ev: 'childpids'; key: number; reqId: number; pids: number[]; failed?: true }
  | { ev: 'childprocs'; key: number; reqId: number; procs: ChildProcess[] }
  // Keyed by terminal key; the shell's own OS pid already rewritten to its key, as `childprocs` does.
  // `failed` is a request that could not be answered — unknown, never "nothing attached".
  | { ev: 'attachedprocs'; reqId: number; byKey: Record<string, ChildProcess[]>; failed?: boolean }
  | { ev: 'ended'; reqId: number; ok: boolean; reason?: string }
  | { ev: 'forceEnded'; reqId: number; survivors: ProcessSurvivor[] };

/** Frame one message as a protocol line. */
export function encodeLine(msg: AgentCommand | AgentEvent): string {
  return `${JSON.stringify(msg)}\n`;
}
