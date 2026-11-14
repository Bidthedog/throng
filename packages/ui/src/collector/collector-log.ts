import { logFatal, parseLogLevel, sessionFileName } from '@throng/core';
import { createFileLog, createProcessAnonymiser, type DiagnosticLog } from '@throng/platform';

/**
 * 066 FR-005 / FR-017 — the resource collector's own log, in the one logs folder.
 *
 * UI main passes the folder, level and retention through the environment it forks the collector with
 * (`THRONG_LOG_DIR`, `THRONG_LOG_LEVEL`, `THRONG_LOG_MAX_KB`, `THRONG_LOG_KEEP_DAYS`,
 * `THRONG_LOG_MAX_TOTAL_MB`); one session file per collector process, like the PTY agent's.
 */
export interface CollectorLogOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly pid: number;
  readonly startedAt: Date;
}

/** The collector's session log, or null when main passed no folder (a test fork, an old main). */
export function openCollectorLog(options: CollectorLogOptions): DiagnosticLog | null {
  const { env } = options;
  const dir = env.THRONG_LOG_DIR;
  if (!dir) return null;
  // 068 FR-034a: the salt UI main passed (`THRONG_LOG_SALT`), else one of its own (the salt file lives in the user data folder, which only UI main reads).
  const { anonymiser } = createProcessAnonymiser({ logDir: dir, salt: env.THRONG_LOG_SALT });
  return createFileLog({
    dir,
    fileName: sessionFileName('collector', options.startedAt, options.pid),
    component: 'collector',
    anonymiser,
    level: parseLogLevel(env.THRONG_LOG_LEVEL),
    retention: {
      maxFileBytes: Number(env.THRONG_LOG_MAX_KB) * 1024 || undefined,
      keepDays: Number(env.THRONG_LOG_KEEP_DAYS) || undefined,
      maxTotalBytes: Number(env.THRONG_LOG_MAX_TOTAL_MB) * 1024 * 1024 || undefined,
    },
    // Its stdout is ignored by the fork; writing through would only reach nobody.
    mirrorToConsole: false,
  });
}

/**
 * A throw nobody caught in the collector is its crash: recorded at fatal through `logFatal` (which
 * the attached console maps to the fatal level), the log flushed, and the process ended — UI main's
 * `watchChild` records the exit from its side, and its host restarts the collector.
 */
export function installCollectorCrashHooks(
  proc: NodeJS.EventEmitter,
  log: DiagnosticLog | null,
  exit: (code: number) => void,
): void {
  proc.on('uncaughtException', (error: unknown) => {
    logFatal('collector', error);
    log?.close();
    exit(1);
  });
  proc.on('unhandledRejection', (reason: unknown) => {
    logFatal('collector', reason);
  });
}
