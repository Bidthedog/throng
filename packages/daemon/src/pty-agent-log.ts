import { isAbsolute, join, relative } from 'node:path';
import { parseLogLevel, sensitive, sessionFileName } from '@throng/core';
import { createFileLog, createProcessAnonymiser, type DiagnosticLog } from '@throng/platform-node';

/**
 * The PTY agent's log (066 FR-017, contract *PTY agent*).
 *
 * The agent is often launched DE-ELEVATED (`CreateProcessWithTokenW`, environment NULL, WITH_PROFILE),
 * so it inherits nothing — not `THRONG_LOG_DIR`, not the log level — and it may run as a different user
 * from the daemon that started it. Its log folder therefore travels as its second argument
 * (`pty-agent-entry.js <pipe> <logDir>`): a folder under `%APPDATA%` as `appdata:<relative path>`,
 * resolved against the agent's OWN `APPDATA` so a different user writes to their own throng folder;
 * anything else as an absolute path. It never falls back to the temp folder: with no folder it can
 * name, the agent keeps no log of its own, and its parent's records (the host, `watchChild`) remain.
 */

/** The marker for a folder given relative to `%APPDATA%`. */
export const APPDATA_LOG_DIR_PREFIX = 'appdata:';

/** The daemon's half: the agent argument for `logDir`, relative to `appData` when it lies inside it. */
export function encodeAgentLogDir(logDir: string, appData: string | undefined): string {
  if (!appData) return logDir;
  const rel = relative(appData, logDir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return logDir;
  return `${APPDATA_LOG_DIR_PREFIX}${rel}`;
}

/** The agent's half: the folder its argument names, else `THRONG_LOG_DIR`, else none. */
export function resolveAgentLogDir(arg: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  if (arg?.startsWith(APPDATA_LOG_DIR_PREFIX)) {
    const appData = env.APPDATA;
    if (appData) return join(appData, arg.slice(APPDATA_LOG_DIR_PREFIX.length));
  } else if (arg && isAbsolute(arg)) {
    return arg;
  }
  return env.THRONG_LOG_DIR || undefined;
}

/** The salt travels as argv[4] (see {@link AgentLogOptions.saltArg}); it must never be written out. */
export function describeAgentArgv(argv: readonly string[]): string {
  return JSON.stringify(argv.map((arg, index) => (index === 4 ? '<salt>' : arg)));
}

/**
 * The `start` request as one log line. The file and arguments are the user's command (068 FR-034b),
 * which no pattern can recognise, so they are marked `sensitive` and the anonymiser logs a token.
 */
export function describeAgentStart(msg: {
  key: string | number;
  file: string;
  args: readonly string[];
  cwd: string;
  cols: number;
  rows: number;
}): string {
  return (
    `cmd start key=${msg.key} file=${sensitive('command', msg.file)} ` +
    `args=${sensitive('command', JSON.stringify(msg.args))} cwd=${msg.cwd} cols=${msg.cols} rows=${msg.rows}`
  );
}

/** A protocol line that did not parse: its text is keystrokes and commands, so it is a token, not a quote. */
export function describeMalformedLine(reason: string, line: string): string {
  return `ignored malformed line (${reason}): ${sensitive('line', line.slice(0, 200))}`;
}

export interface AgentLogOptions {
  /** `argv[3]` — the encoded log folder, if the daemon passed one. */
  readonly arg: string | undefined;
  /**
   * `argv[4]` — the anonymiser's salt (068 FR-034a). An extra argument, not an environment variable,
   * because the de-elevated launch drops the environment; absent, a salt of its own is used (nothing is read from or written to the logs folder).
   */
  readonly saltArg?: string | undefined;
  /** The agent's own environment: `APPDATA`, and the level and retention a plain spawn inherits. */
  readonly env: NodeJS.ProcessEnv;
  readonly pid: number;
  readonly startedAt: Date;
}

/** One file per agent process in the logs folder, levelled and rolled like every other; null when there is no folder. */
export function openAgentLog(options: AgentLogOptions): DiagnosticLog | null {
  const dir = resolveAgentLogDir(options.arg, options.env);
  if (!dir) return null;
  const { env } = options;
  const { anonymiser } = createProcessAnonymiser({ logDir: dir, salt: options.saltArg || env.THRONG_LOG_SALT });
  return createFileLog({
    dir,
    fileName: sessionFileName('pty-agent', options.startedAt, options.pid),
    component: 'pty-agent',
    anonymiser,
    level: parseLogLevel(env.THRONG_LOG_LEVEL),
    retention: {
      maxFileBytes: Number(env.THRONG_LOG_MAX_KB) * 1024 || undefined,
      keepDays: Number(env.THRONG_LOG_KEEP_DAYS) || undefined,
      maxTotalBytes: Number(env.THRONG_LOG_MAX_TOTAL_MB) * 1024 * 1024 || undefined,
    },
    // Detached with no console: writing through to stdout would only feed the tee nobody reads.
    mirrorToConsole: false,
  });
}
