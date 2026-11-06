import { isAbsolute, join, relative } from 'node:path';
import { parseLogLevel, sessionFileName } from '@throng/core';
import { createFileLog, type DiagnosticLog } from '@throng/platform-node';

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

export interface AgentLogOptions {
  /** `argv[3]` — the encoded log folder, if the daemon passed one. */
  readonly arg: string | undefined;
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
  return createFileLog({
    dir,
    fileName: sessionFileName('pty-agent', options.startedAt, options.pid),
    component: 'pty-agent',
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
