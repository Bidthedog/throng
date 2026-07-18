import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A durable, crash-safe diagnostic sink for the de-elevated PTY agent. */
export interface AgentLogger {
  /** The absolute file the logger appends to (`<dir>/throng-agent-<pid>.log`). */
  readonly path: string;
  /** Append one timestamped line. NEVER throws — see the class note. */
  log(message: string): void;
}

/**
 * Durable diagnostic log for the de-elevated PTY agent (019 #94 follow-up).
 *
 * The agent runs as a DETACHED, medium-integrity process launched via
 * `CreateProcessWithTokenW` with `CREATE_NO_WINDOW`: it has no console and its
 * stdout/stderr are not redirected anywhere, so when it dies shortly after connecting
 * back to the daemon (`pty-agent-host.ts` `sock.on('close')` after `connected=true`)
 * there is NO channel that reveals WHY. This writes an appendable log to
 * `%TEMP%/throng-agent-<pid>.log` — a location reachable across the integrity boundary
 * — so the developer's next elevated run leaves a durable record of the crash.
 *
 * Writes are SYNCHRONOUS (`appendFileSync`) on purpose: each line is flushed to disk
 * before the next statement runs, so a subsequent hard crash (even a native ConPTY
 * access violation) cannot lose the line that was written just before it.
 *
 * `log` NEVER throws: a diagnostic channel must not itself take down the process it is
 * observing. A failed write is silently dropped — losing a log line is strictly better
 * than crashing the agent we are trying to diagnose.
 */
export function createAgentLogger(pid: number, dir: string = tmpdir()): AgentLogger {
  const path = join(dir, `throng-agent-${pid}.log`);
  return {
    path,
    log(message: string): void {
      try {
        appendFileSync(path, `${new Date().toISOString()} ${message}\n`);
      } catch {
        /* diagnostics must never throw — a lost line beats a crashed agent */
      }
    },
  };
}
