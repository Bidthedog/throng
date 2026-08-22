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
 *
 * `shellStartedAt` — when the shell was spawned — rejects a **pid-reuse impostor** (#280). Windows
 * recycles pids briskly and leaves a dead parent's `ParentProcessId` stale on anything that
 * outlives it, so a long-running process whose real parent has gone can end up advertising a
 * `ppid` that now names this terminal's shell. `ppid` alone cannot tell that apart from a genuine
 * child; start time can, decisively, because a process that began BEFORE the shell cannot be its
 * child. Without it a `cmd.exe` terminal captured the `bash.exe` command line of the build that
 * launched the test run.
 *
 * This is the same test `findOrphans` (`daemon/src/reap-orphans.ts`) already applies to the same
 * problem — there, a parent that started after its supposed child is the impostor; here, a child
 * that started before its supposed parent is. One pattern, two directions.
 *
 * Optional, so a caller that cannot know the spawn time keeps exactly the old behaviour rather
 * than losing capture altogether — which also means OMITTING IT REINTRODUCES #280 for that caller.
 * Leave it out only deliberately, and know that no rule test here will notice; the wiring is held
 * by `daemon/tests/unit/terminal-command-poll.test.ts` instead.
 */
export function foregroundCommand(
  shellPid: number,
  children: readonly ChildProcess[],
  shellImage?: string,
  shellStartedAt?: number,
): string | null {
  const effectiveShell = resolveShellPid(shellPid, children, shellImage);
  /*
   * Compare candidates against the EFFECTIVE shell, not the pid throng launched. Where
   * `resolveShellPid` followed a re-exec chain (Git for Windows' bash launcher does it twice) the
   * innermost shell is a genuine descendant that started LATER, so it is the tighter and the
   * correct floor — using the outer pid's time would admit anything started in between. Its start
   * time is in `children` precisely because it is a descendant; only when the chain was not
   * followed at all does the caller's value apply.
   */
  const floor =
    effectiveShell === shellPid
      ? shellStartedAt
      : children.find((c) => c.pid === effectiveShell)?.startedAt ?? shellStartedAt;
  let best: ChildProcess | null = null;
  for (const child of children) {
    if (child.ppid !== effectiveShell) continue;
    // A child cannot predate its parent: the ppid is stale and names a recycled pid (#280).
    if (floor !== undefined && child.startedAt < floor) continue;
    if (!isCapturableCommand(child.commandLine)) continue;
    if (best === null || child.startedAt >= best.startedAt) best = child;
  }
  return best === null ? null : normaliseCommand(best.commandLine);
}

/** The executable's file name from a command line, lower-cased. '' when it cannot be read. */
function imageName(commandLine: string): string {
  const trimmed = commandLine.trim();
  const path =
    trimmed.startsWith('"') ? trimmed.slice(1, trimmed.indexOf('"', 1)) : trimmed.split(' ')[0];
  return (path ?? '').split(/[\\/]/).pop()?.toLowerCase() ?? '';
}

/**
 * The pid whose direct children are the real candidates (025 FR-022a).
 *
 * Normally that is the shell throng launched. Git for Windows breaks the assumption: its
 * `bin/bash.exe` is a launcher that starts `usr/bin/bash.exe`, and the recipe's own
 * `exec bash -i` adds another link, so a command a user runs is a great-great-grandchild of the
 * PTY. Applied literally, "direct children of the shell" found nothing at all and git-bash never
 * remembered a command.
 *
 * So a chain of processes running the SAME EXECUTABLE as the shell is treated as one shell,
 * transparently. Same-image only, deliberately: it re-follows a shell re-execing itself without
 * reaching through `npm` into `node`, which FR-022 requires stay a single candidate. A user who
 * types `bash` inside their bash terminal is followed too, which is the reading they would want —
 * the command they then run is the one in the foreground.
 */
function resolveShellPid(
  shellPid: number,
  children: readonly ChildProcess[],
  shellImage?: string,
): number {
  const target = shellImage === undefined ? '' : imageName(shellImage);
  if (target === '') return shellPid;
  let current = shellPid;
  // Bounded by the number of processes: each step moves strictly further down the tree.
  for (let depth = 0; depth < children.length; depth++) {
    const next = children
      .filter((c) => c.ppid === current && imageName(c.commandLine) === target)
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    if (next === undefined) return current;
    current = next.pid;
  }
  return current;
}

/**
 * A captured command as it should be SAVED (025 FR-023).
 *
 * The OS reports a process's command line as the launcher built it, which is not always how the
 * user typed it: running `claude agents` through cmd came back as `claude  agents`, with the
 * doubled space the shim inserted. Saving that verbatim puts a command in the Panel's settings
 * that the user never wrote, and it survives every future launch.
 *
 * Runs of whitespace collapse to one space — but only OUTSIDE quotes, so a quoted argument that
 * genuinely contains several spaces (a Windows path is the obvious case) is left exactly as it is.
 */
export function normaliseCommand(commandLine: string): string {
  const collapsed = collapseWhitespace(commandLine);
  const { exe, rest } = splitCommand(collapsed);
  // An unquoted path is not safe to replay everywhere: bash strips the backslashes out of a
  // Windows path, so a captured `C:\\…\\PING.EXE` came back as `C:WINDOWSsystem32ping.exe:
  // command not found`. Quoted, it runs in bash, cmd and both PowerShells alike (measured).
  const needsQuoting = exe.includes(String.fromCharCode(92)) || exe.includes(' ');
  // `splitCommand` has already stripped any quotes, so re-quote on the exe itself rather than on
  // how the input happened to be spelled — testing the input dropped the quotes off a path that
  // arrived already quoted.
  const quoted = needsQuoting ? `"${exe}"` : exe;
  return rest === '' ? quoted : `${quoted} ${rest}`;
}

/** Runs of whitespace to one space, outside quotes only. */
function collapseWhitespace(commandLine: string): string {
  let out = '';
  let quoted = false;
  for (const ch of commandLine.trim()) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && /\s/.test(ch)) {
      if (!out.endsWith(' ')) out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}


/** A command line split into its executable and everything after it, honouring quotes. */
function splitCommand(line: string): { exe: string; rest: string } {
  const trimmed = line.trim();
  if (trimmed.startsWith('"')) {
    const close = trimmed.indexOf('"', 1);
    if (close > 0) {
      return { exe: trimmed.slice(1, close), rest: trimmed.slice(close + 1).trim() };
    }
  }
  const space = trimmed.indexOf(' ');
  return space < 0
    ? { exe: trimmed, rest: '' }
    : { exe: trimmed.slice(0, space), rest: trimmed.slice(space + 1).trim() };
}

/** An executable's bare name, without directory or extension, lower-cased. */
function bareName(exe: string): string {
  const file = exe.split(/[\\/]/).pop() ?? '';
  const dot = file.lastIndexOf('.');
  return (dot > 0 ? file.slice(0, dot) : file).toLowerCase();
}

/**
 * Whether `observed` is just `saved` with its executable resolved to a full path (025 FR-017).
 *
 * The OS reports the command line a launcher built, and shells resolve a command to its image
 * before spawning it: typing `ping -t bbc.co.uk` is reported as
 * `C:\\WINDOWS\\system32\\PING.EXE -t bbc.co.uk`. Textually different, the same command.
 *
 * Treating that as a change was actively harmful, not merely untidy: memory replaced the user's
 * own startup command with the resolved form, and in Git Bash the replacement did not even run —
 * bash strips the backslashes out of an unquoted Windows path, leaving
 * `bash: C:WINDOWSsystem32ping.exe: command not found`. A terminal broke itself by remembering.
 *
 * Same bare executable name and identical arguments means the same command, so the user's
 * spelling is kept.
 */
export function isResolvedForm(observed: string, saved: string): boolean {
  const a = splitCommand(observed);
  const b = splitCommand(saved);
  if (a.rest !== b.rest) return false;
  const nameA = bareName(a.exe);
  return nameA !== '' && nameA === bareName(b.exe);
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
  // …and the same command with its executable resolved to a full path is still the same command.
  if (saved !== undefined && isResolvedForm(value, saved)) return { save: false, reason: 'unchanged' };
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
