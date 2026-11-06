import type { ChildProcess } from 'node:child_process';

import { logCaught, type LogLevel } from '@throng/core';

/**
 * 066 FR-005 / FR-007 / FR-008 / FR-014 — the parent's half of every child process.
 *
 * A child that fails while resolving its imports cannot log anything itself; only its parent saw it
 * go (#542). So every process throng starts is passed through here, which records a failed spawn, an
 * exit nobody asked for, and the tail of what the child wrote to stderr.
 *
 * - A **long-lived** child (daemon, collector, PTY agent) is meant to run until throng stops it: any
 *   exit it was not asked for is a crash, logged at fatal — exit code 0 included.
 * - A **helper** (a one-shot command) is meant to finish: success is silent, a failing exit is warn.
 * - An exit the caller marks expected (`expectedExit` returns its reason) is logged at debug with
 *   that reason, never as a failure (FR-008).
 */

/** The most of a child's stderr a record carries (FR-014): the end, where the error is. */
export const STDERR_TAIL_CHARS = 4096;

export interface WatchChildOptions {
  /** What the log calls the child: `daemon`, `collector`, `reg query`. */
  name: string;
  log: (level: LogLevel, message: string) => void;
  /** Meant to run until stopped (fatal on any unasked exit), rather than a one-shot helper. */
  longLived: boolean;
  /** The reason this exit was expected, or undefined when it was not. Asked at exit time. */
  expectedExit?: (code: number | null, signal: NodeJS.Signals | null) => string | undefined;
}

export function watchChild(child: ChildProcess, options: WatchChildOptions): void {
  let tail = '';
  let failedToStart = false;
  const failureLevel: LogLevel = options.longLived ? 'fatal' : 'warn';

  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    tail = (tail + chunk).slice(-STDERR_TAIL_CHARS);
  });

  child.on('error', (error) => {
    // A failed spawn has no pid, and emits `error` then `close`; the close carries nothing the error
    // did not. A child that DID start can also emit `error` (an IPC send on a closed channel, a kill
    // that failed) — that is logged in its own right, and its exit still is too.
    if (child.pid === undefined) {
      failedToStart = true;
      options.log(failureLevel, `${options.name} failed to start: ${error.message}`);
      return;
    }
    options.log(failureLevel, `${options.name} error: ${error.message}`);
  });

  // `close`, not `exit`: by then the stderr stream has drained, so the tail is complete.
  child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    if (failedToStart) return;
    const how = signal ? `on signal ${signal}` : `with code ${code}`;
    const reason = options.expectedExit?.(code, signal);
    if (reason !== undefined) {
      options.log('debug', `${options.name} exited ${how}: expected — ${reason}`);
      return;
    }
    if (!options.longLived && code === 0) return;
    const detail = tail.trim();
    options.log(failureLevel, `${options.name} exited ${how}${detail ? `: ${detail}` : ''}`);
  });
}

/** An `execFile`-style helper failed: one warn line with its name, the error and its stderr. */
export function logChildFailure(name: string, error: unknown, stderr?: string | Buffer): void {
  const tail = String(stderr ?? '').trim().slice(-STDERR_TAIL_CHARS);
  const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
  logCaught(name, tail ? `${message}: ${tail}` : message);
}
