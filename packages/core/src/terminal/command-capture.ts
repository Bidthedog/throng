/**
 * Command memory (025 US2) — the rules that decide what a Terminal Panel remembers.
 *
 * Kept pure and free of any OS or UI type so the whole of the user's stated behaviour can be
 * tested as data in / data out: the six worked examples in the spec are six calls to
 * {@link captureDecision}, with no PTY, no daemon and no renderer involved.
 */
import type { ChildProcess } from '../abstractions/pty-host.js';

/** Longest command line worth remembering. Beyond this it is almost certainly not something
 *  a user typed, and a startup command has to stay editable in a single-line field (FR-023). */
export const MAX_CAPTURABLE_COMMAND_LENGTH = 2048;

/**
 * Whether an observed command line is worth saving (FR-023). A saved command is re-executed on
 * the next cold start, so anything that cannot be shown in the form and re-run as-is is
 * discarded rather than persisted — leaving the previous value untouched.
 *
 * Control characters are rejected by code point rather than by regex: a multi-line command
 * cannot round-trip through a single-line field, and an escape sequence has no business in
 * persisted configuration that gets executed.
 */
export function isCapturableCommand(commandLine: string): boolean {
  const trimmed = commandLine.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > MAX_CAPTURABLE_COMMAND_LENGTH) return false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * The command that "had control" of a terminal (FR-022): the most recently started **direct**
 * child of the shell.
 *
 * Direct children only, deliberately (FR-022a) — a command's own helpers are its business, not
 * separate candidates, and a grandchild whose parent has already exited means nothing is
 * running as far as the user is concerned. Ties on start time resolve to the later entry, which
 * matches the "most recently started" reading.
 *
 * Returns null when nothing qualifies, which the caller must treat as "leave the saved command
 * alone" — never as "clear it" (FR-017).
 */
export function foregroundCommand(
  shellPid: number,
  children: readonly ChildProcess[],
): string | null {
  let best: ChildProcess | null = null;
  for (const child of children) {
    if (child.ppid !== shellPid) continue;
    if (!isCapturableCommand(child.commandLine)) continue;
    if (best === null || child.startedAt >= best.startedAt) best = child;
  }
  return best === null ? null : best.commandLine.trim();
}

/** Why a capture did or did not happen — recorded in diagnostics so "it forgot my command"
 *  is answerable from the log alone (FR-026a). */
export type CaptureReason =
  | 'memory-off'
  | 'nothing-running'
  | 'not-capturable'
  | 'unchanged'
  | 'saved';

export type CaptureOutcome =
  | { save: false; reason: Exclude<CaptureReason, 'saved'> }
  | { save: true; reason: 'saved'; value: string };

/**
 * The whole memory rule, in one function.
 *
 * | memory | observed        | result                                  |
 * |--------|-----------------|-----------------------------------------|
 * | off    | anything        | unchanged — only a user edit changes it |
 * | on     | a live command  | saved becomes that command              |
 * | on     | nothing running | **unchanged** — never cleared           |
 *
 * The "never cleared" row is the one that carries the user's intent: a terminal sitting at a
 * bare prompt when it ends says nothing about what the panel should run next time, so the
 * previous value stands. A command that has already finished is likewise never captured,
 * because `observed` only ever holds something alive at the moment of observation.
 */
export function captureDecision(
  rememberCommand: boolean,
  saved: string | undefined,
  observed: string | null,
): CaptureOutcome {
  if (!rememberCommand) return { save: false, reason: 'memory-off' };
  if (observed === null) return { save: false, reason: 'nothing-running' };
  if (!isCapturableCommand(observed)) return { save: false, reason: 'not-capturable' };
  const value = observed.trim();
  if ((saved ?? '') === value) return { save: false, reason: 'unchanged' };
  return { save: true, reason: 'saved', value };
}

/**
 * Whether a capture outcome deserves a **toast**, as opposed to only a log line (025 FR-026b/c).
 *
 * The governing question is whether the user has any other way to find out. Only one outcome
 * qualifies: a command WAS running and throng threw it away because it could not be stored. The
 * terminal never says that, so without a toast the user simply finds their memory silently wrong.
 *
 * Everything else is deliberately silent:
 *  - `nothing-running` is the designed behaviour, not an error (FR-026c) — toasting it would fire
 *    on ordinary teardown and train people to ignore notices.
 *  - `memory-off` and `unchanged` are no-ops the user asked for.
 *  - `saved` is success.
 *
 * Failures the SHELL already printed (a mistyped command, a missing binary) never reach here —
 * they are the terminal's own output, and repeating them would be noise.
 */
export function shouldNotifyCaptureOutcome(outcome: CaptureOutcome): boolean {
  return outcome.save === false && outcome.reason === 'not-capturable';
}

/**
 * A one-line diagnostics record for a capture decision (025 FR-026a). Every outcome is logged,
 * including the no-ops — the point is that "it forgot my command" can be answered from the log
 * alone, naming the rule that fired, without reproducing the problem.
 */
export function captureLogLine(panelId: string, outcome: CaptureOutcome): string {
  const detail = outcome.save ? ` value=${JSON.stringify(outcome.value)}` : '';
  return `[025:capture] panel=${panelId} saved=${outcome.save} reason=${outcome.reason}${detail}`;
}
