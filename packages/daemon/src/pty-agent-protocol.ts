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

/** Daemon → agent commands. */
export type AgentCommand =
  // First frame: tells the agent which pid to watch so it can self-terminate (and
  // reap its terminals) if the daemon dies WITHOUT a clean pipe close (T134).
  | { op: 'hello'; daemonPid: number }
  | { op: 'start'; key: number; file: string; args: string[]; cwd: string; cols: number; rows: number; env?: Record<string, string> }
  | { op: 'write'; key: number; data: string }
  | { op: 'resize'; key: number; cols: number; rows: number }
  | { op: 'kill'; key: number }
  | { op: 'childpids'; key: number; reqId: number };

/** Agent → daemon events. */
export type AgentEvent =
  | { ev: 'ready' }
  | { ev: 'started'; key: number; pid: number }
  | { ev: 'error'; key: number; message: string }
  | { ev: 'data'; key: number; data: string }
  | { ev: 'exit'; key: number; code: number | null; signal?: string }
  | { ev: 'childpids'; key: number; reqId: number; pids: number[] };

/** Frame one message as a protocol line. */
export function encodeLine(msg: AgentCommand | AgentEvent): string {
  return `${JSON.stringify(msg)}\n`;
}
