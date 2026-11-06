/**
 * 066 FR-009 / FR-009a — the three ways a caught error is logged. Each name states what the catch
 * meant, so a reader (and the failure-logging guard) can tell a handled surprise from an anticipated
 * failure from a crash.
 *
 * They write through `console`, which every throng process routes into its log file (research R1):
 * UI main and the daemon through `attachConsole`, the agent and the collector likewise, the renderer
 * through main's `console-message` forwarding. That is why the same call works in core, which imports
 * no Node builtin, and in every package above it.
 *
 * None of them throws on a hostile error value — a logging call that crashes its caller would turn a
 * handled failure into an unhandled one (FR-016). `logExpected` does throw on an empty reason: that is
 * a programming error at the call site, caught by the first test that exercises it.
 */

import type { LogLevel } from './log-level.js';

/** The prefix `attachConsole` maps to the fatal level; console has no fatal method of its own. */
export const FATAL_CONSOLE_PREFIX = '[FATAL]';

/** The one renderer of a caught value: its message, never a crash. */
export function describeError(error: unknown): string {
  try {
    if (error instanceof Error) return error.message || error.name;
    if (typeof error === 'string') return error;
    if (error === undefined) return 'undefined';
    if (error === null) return 'null';
    if (typeof error === 'object' && 'message' in error) {
      const message = (error as { message: unknown }).message;
      if (typeof message === 'string') return message;
    }
    return JSON.stringify(error) ?? String(error);
  } catch {
    // A circular object or a throwing getter: say what it was rather than what it held. The inner
    // error is not described — it may be as hostile as the value that raised it.
    const kind = Object.prototype.toString.call(error);
    console.debug(`caught: describe an error value: expected — a circular or throwing ${kind} cannot be rendered, so its type is logged instead`);
    return kind;
  }
}

function stackOf(error: unknown): string | undefined {
  try {
    return error instanceof Error && typeof error.stack === 'string' ? error.stack : undefined;
  } catch (stackError) {
    console.debug(`caught: read a stack: expected — a throwing stack getter is reported by type only: ${Object.prototype.toString.call(stackError)}`);
    return undefined;
  }
}

/** An unexpected failure that the code recovered from: written at warn, its stack at debug. */
export function logCaught(where: string, error: unknown): void {
  console.warn(`${where}: ${describeError(error)}`);
  const stack = stackOf(error);
  if (stack) console.debug(`${where}: stack: ${stack}`);
}

/**
 * A failure the code anticipates (a window closing mid-send, a remembered folder since deleted):
 * written at debug, with the reason it is expected. The reason is required — it is what separates an
 * expected failure from a silent one.
 */
export function logExpected(where: string, reason: string, error?: unknown): void {
  if (reason.trim() === '') throw new Error(`logExpected(${where}): a stated reason is required`);
  const tail = error === undefined ? '' : `: ${describeError(error)}`;
  console.debug(`${where}: expected — ${reason}${tail}`);
}

/**
 * A component crashed — a process, a window or a panel. Written at fatal, under every threshold, with the
 * stack: a crash record is the one a user sends, and without the stack it says only that something broke.
 */
export function logFatal(component: string, error: unknown): void {
  console.error(`${FATAL_CONSOLE_PREFIX} ${component} crashed: ${stackOf(error) ?? describeError(error)}`);
}

/**
 * Write one line at `level` through the console — the seam every process routes into its log (R1). The
 * one router: a caller holding a level (a `watchChild` log, an injected `log(level, msg)`) uses this
 * rather than its own switch, so fatal is always marked the same way.
 */
export function logAt(level: LogLevel, message: string): void {
  switch (level) {
    case 'fatal':
      console.error(`${FATAL_CONSOLE_PREFIX} ${message}`);
      return;
    case 'error':
      console.error(message);
      return;
    case 'warn':
      console.warn(message);
      return;
    case 'info':
      console.info(message);
      return;
    case 'debug':
      console.debug(message);
      return;
  }
}
