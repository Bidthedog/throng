import { friendlyName } from '../resources/friendly-names.js';
import { isCapturableCommand } from './command-capture.js';

/** The image's file name, from a path with either separator. */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? '';
}

/** The first token of a command line, honouring a leading quote. */
function firstToken(commandLine: string): string {
  const line = commandLine.trim();
  if (line.startsWith('"')) {
    const close = line.indexOf('"', 1);
    return close > 0 ? line.slice(1, close) : line.slice(1);
  }
  const space = line.search(/\s/);
  return space < 0 ? line : line.slice(0, space);
}

/** The native install keeps each release as `.../claude/versions/<version>`, whatever the launcher was called. */
const NATIVE_VERSIONED_IMAGE = /[\\/]claude[\\/]versions[\\/][^\\/]+$/i;

function isClaudeImage(path: string, commandLine: string): boolean {
  const image = fileName(path);
  if (image === '') return false;
  return friendlyName(image, commandLine) === 'Claude Code' || NATIVE_VERSIONED_IMAGE.test(path);
}

/**
 * Whether a process is Claude Code (068 FR-041): the native `claude` image at any path, or node
 * running its package. Reuses the friendly-name rule so the two never disagree.
 *
 * Judged from what the process was LAUNCHED as (its argv[0]) and from what it is (its executable):
 * on Linux the native install runs `~/.local/share/claude/versions/<version>`, so the executable's
 * own name is a version number while argv[0] and the kernel's name are `claude` (measured).
 */
export function isClaudeCodeProcess(proc: { commandLine: string; executablePath?: string }): boolean {
  return (
    isClaudeImage(firstToken(proc.commandLine), proc.commandLine) ||
    (proc.executablePath !== undefined && isClaudeImage(proc.executablePath, proc.commandLine))
  );
}

const CLAUDE_SCRIPT = /[\\/]claude-code[\\/]|[\\/]@anthropic-ai[\\/]claude/i;

/** Flags that select a session, each taking an optional or required value. */
const VALUE_FLAGS = new Set(['--resume', '-r', '--session-id']);
const BARE_FLAGS = new Set(['--continue', '-c', '--fork-session']);

/** Flags that take no value: a word after one is a prompt, not its value. */
const BOOLEAN_FLAGS = new Set([
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  '--verbose',
  '--debug',
  '--ide',
  '--chrome',
  '--no-chrome',
  '--bare',
  '--strict-mcp-config',
  '--include-partial-messages',
  '--replay-user-messages',
  '--disable-slash-commands',
  '--no-session-persistence',
  '--brief',
]);

/** Flags that take every following word up to the next flag. */
const VARIADIC_FLAGS = new Set([
  '--add-dir',
  '--allowedTools',
  '--allowed-tools',
  '--disallowedTools',
  '--disallowed-tools',
  '--mcp-config',
  '--plugin-dir',
  '--betas',
  '--tools',
  '--file',
]);

/** The shell that will read the command back: the one quoting rule that is safe for it. */
export type ResumeShell = 'posix' | 'powershell' | 'cmd';

/** The shell a terminal's image runs, for {@link claudeResumeCommand}'s quoting. Anything else reads POSIX. */
export function resumeShellFor(shellImage: string): ResumeShell {
  const stem = fileName(shellImage).toLowerCase().replace(/\.exe$/, '');
  if (stem === 'pwsh' || stem === 'powershell') return 'powershell';
  if (stem === 'cmd') return 'cmd';
  return 'posix';
}

const POSIX_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
const POWERSHELL_SAFE = /^[A-Za-z0-9_@+=:,./\\-]+$/;
const CMD_SAFE = /^[A-Za-z0-9_@+=:,./\\-]+$/;
const CMD_UNSAFE = /["%^&|<>!]/;

/** One argument as `shell` reads it back unchanged, or null when no spelling of it is safe to type. */
function quoteFor(shell: ResumeShell, arg: string): string | null {
  switch (shell) {
    case 'posix':
      return POSIX_SAFE.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
    case 'powershell':
      // A double quote inside an argument reaches a native program differently across PowerShell versions; decline.
      if (arg.includes('"')) return null;
      return POWERSHELL_SAFE.test(arg) ? arg : `'${arg.replace(/'/g, "''")}'`;
    case 'cmd':
      if (CMD_UNSAFE.test(arg)) return null;
      return CMD_SAFE.test(arg) ? arg : `"${arg}"`;
  }
}

/**
 * The command that resumes `sessionId` in a fresh terminal (068 FR-041, FR-041a): the launch flags the
 * process had, minus every argument that selects or forks a session, a leading `agents`, and every
 * positional argument (a prompt would be sent again on each restore), then `--resume <id>`. The
 * executable is the bare `claude`, never the image path. Each argument is quoted for `shell`, because
 * the text is typed into it. Null when the result could not be saved as a command, or an argument has
 * no safe spelling for `shell`.
 */
export function claudeResumeCommand(argv: readonly string[], sessionId: string, shell: ResumeShell = 'posix'): string | null {
  if (argv.length === 0) return null;
  let rest = argv.slice(1);
  const stem = fileName(argv[0] as string).toLowerCase().replace(/\.exe$/, '');
  if ((stem === 'node' || stem === 'nodejs') && rest[0] !== undefined && CLAUDE_SCRIPT.test(rest[0])) {
    rest = rest.slice(1);
  }
  if (rest[0] === 'agents') rest = rest.slice(1);
  const kept: string[] = [];
  let expects: 'none' | 'one' | 'many' = 'none';
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] as string;
    if (BARE_FLAGS.has(arg)) continue;
    if (arg.startsWith('--resume=') || arg.startsWith('--session-id=')) continue;
    if (VALUE_FLAGS.has(arg)) {
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('-')) i += 1;
      expects = 'none';
      continue;
    }
    if (arg.length > 1 && arg.startsWith('-')) {
      kept.push(arg);
      expects = arg.includes('=') || BOOLEAN_FLAGS.has(arg) ? 'none' : VARIADIC_FLAGS.has(arg) ? 'many' : 'one';
      continue;
    }
    // A word: the value of the flag before it, or a positional argument to drop.
    if (expects === 'none') continue;
    kept.push(arg);
    if (expects === 'one') expects = 'none';
  }
  const quoted: string[] = [];
  for (const arg of kept) {
    const q = quoteFor(shell, arg);
    if (q === null) return null;
    quoted.push(q);
  }
  const command = ['claude', ...quoted, '--resume', sessionId].join(' ');
  return isCapturableCommand(command) ? command : null;
}
