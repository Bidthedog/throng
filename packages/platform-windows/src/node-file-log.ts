import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_LOG_LEVEL,
  DEFAULT_ROTATION,
  crashFileName,
  formatCrashReport,
  formatLogLine,
  normaliseRotation,
  passesThreshold,
  rotationPlan,
  shouldRotate,
  type CrashDetails,
  type LogLevel,
  type RotationPolicy,
} from '@throng/core';

/**
 * The durable diagnostic sink (#123).
 *
 * It lives in a platform package rather than in core because it performs real I/O, and core is
 * guarded to import no Node builtin at all (`no-os-imports.test.ts`). Core owns the DECISIONS —
 * levels, the record format, what rotation should do — and this owns the disk. Nothing in the file
 * is Windows-specific, so it moves unchanged the day a platform-posix package exists.
 *
 * An installed throng is launched from a shortcut and has NO CONSOLE: every `console.log` it makes
 * goes to a stream nobody owns, and the daemon's went to `stdio: 'ignore'` outright. So a user
 * whose app would not start, or whose terminal misbehaved, had literally nothing to send — the
 * version number told us WHICH build broke and nothing whatever about HOW.
 *
 * Writes are SYNCHRONOUS, the same decision (and for the same reason) as the de-elevated PTY
 * agent's logger this generalises: each line is flushed before the next statement runs, so a crash
 * immediately afterwards cannot lose the line written just before it. A diagnostic channel that
 * loses its last line loses the only one that mattered.
 *
 * Nothing here throws. A logger that takes down the process it is observing is worse than no
 * logger at all, and a full disk or a locked file must not be the reason an application will not
 * start.
 */
export interface DiagnosticLog {
  /** The file being appended to — shown in the UI so a user can find it. */
  readonly path: string;
  /** The directory it lives in — what an "open logs folder" affordance opens. */
  readonly dir: string;
  log(level: LogLevel, message: string): void;
  /**
   * Write regardless of the configured threshold (030 FR-006b).
   *
   * For records whose absence would break a guarantee made to the user. A notice the user chose
   * never to SEE is still promised a record — that is the whole basis on which turning a severity
   * off is offered — and `diagnostics.logLevel: 'error'` would otherwise drop every `info` and
   * `warn` notice on the floor, silently, leaving the setting's own confirmation text false.
   *
   * It is `log` minus the threshold test and nothing else: rotation, formatting and the
   * never-throw behaviour are the same code. `component` names this record's origin in place of
   * the log's own — one file holds main's timeline and the renderer's notices, and a reader who
   * cannot tell them apart has to guess.
   */
  logAlways(level: LogLevel, message: string, component?: string): void;
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
  /**
   * Route this process's `console.*` into the log as well.
   *
   * This is what makes the diagnostics EXISTING code already writes durable, without rewriting
   * twenty-nine call sites into a logging API — which the issue explicitly does not ask for. It
   * returns a restore function, so a test can put the console back.
   */
  attachConsole(): () => void;
  /** Change the threshold at runtime (a settings change must not need a restart to take effect). */
  setLevel(level: LogLevel): void;
}

export interface FileLogOptions {
  /** Directory to write into; created if missing. */
  dir: string;
  /** File name, e.g. `main.log`. Rotated generations become `main.1.log`, `main.2.log`, … */
  fileName: string;
  /** The component name every record carries. */
  component: string;
  /** Threshold — injected configuration, never a constant (Principle X). */
  level?: LogLevel;
  policy?: Partial<RotationPolicy>;
  /**
   * Also write through to the original console stream. Defaults to whether stdout is a TTY: a
   * developer running from a terminal keeps their output, while a detached daemon (whose stdout is
   * a redirected file) does not write everything twice.
   */
  mirrorToConsole?: boolean;
}

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';
const CONSOLE_LEVELS: Readonly<Record<ConsoleMethod, LogLevel>> = {
  error: 'error',
  warn: 'warn',
  log: 'info',
  info: 'info',
  debug: 'debug',
};

/** Render a console argument the way a log file wants it: readable, never `[object Object]`. */
function renderArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg); // circular, or a getter that threw — the shape is not worth a crash
  }
}

export function createFileLog(options: FileLogOptions): DiagnosticLog {
  const policy = normaliseRotation({ ...DEFAULT_ROTATION, ...options.policy });
  const path = join(options.dir, options.fileName);
  let threshold: LogLevel = options.level ?? DEFAULT_LOG_LEVEL;
  const mirror = options.mirrorToConsole ?? Boolean(process.stdout?.isTTY);

  try {
    mkdirSync(options.dir, { recursive: true });
  } catch {
    /* an unwritable log directory must not stop the application — every write below no-ops */
  }

  const rotateIfNeeded = (incomingBytes: number): void => {
    try {
      if (!existsSync(path)) return;
      if (!shouldRotate(statSync(path).size, incomingBytes, policy)) return;
      const plan = rotationPlan(options.fileName, policy);
      for (const name of plan.remove) rmSync(join(options.dir, name), { force: true });
      for (const { from, to } of plan.renames) {
        const fromPath = join(options.dir, from);
        if (existsSync(fromPath)) renameSync(fromPath, join(options.dir, to));
      }
    } catch {
      /* rotation is housekeeping; failing it must never cost us the record we are about to write */
    }
  };

  /** The write itself — rotation, formatting, disk. No policy of its own. */
  const emit = (level: LogLevel, message: string, component: string): void => {
    const line = `${formatLogLine({ at: new Date(), level, component, message })}\n`;
    try {
      rotateIfNeeded(Buffer.byteLength(line));
      appendFileSync(path, line);
    } catch {
      /* see the class note: a lost line beats a crashed application */
    }
  };

  const write = (level: LogLevel, message: string): void => {
    if (!passesThreshold(threshold, level)) return;
    emit(level, message, options.component);
  };

  return {
    path,
    dir: options.dir,
    log: write,
    logAlways: (level, message, component) => emit(level, message, component ?? options.component),
    error: (m) => write('error', m),
    warn: (m) => write('warn', m),
    info: (m) => write('info', m),
    debug: (m) => write('debug', m),
    setLevel: (level) => {
      threshold = level;
    },
    attachConsole(): () => void {
      const original: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};
      for (const method of Object.keys(CONSOLE_LEVELS) as ConsoleMethod[]) {
        const previous = console[method] as (...args: unknown[]) => void;
        original[method] = previous;
        console[method] = (...args: unknown[]): void => {
          write(CONSOLE_LEVELS[method], args.map(renderArg).join(' '));
          if (mirror) previous(...args);
        };
      }
      return () => {
        for (const [method, fn] of Object.entries(original)) {
          if (fn) (console as unknown as Record<string, unknown>)[method] = fn;
        }
      };
    },
  };
}

/** The sub-directory crash reports live in, beside the logs they belong to. */
export const CRASH_DIR_NAME = 'crashes';

/**
 * Write one crash report and return its path (or null if it could not be written).
 *
 * Separate from the log rather than a level within it: a crash report is a whole document — build,
 * exit code, output — and the thing a user attaches to a bug report. It is ALSO summarised into the
 * log by the caller, so the timeline still shows that the crash happened and where to find it.
 */
export function writeCrashReport(logDir: string, details: CrashDetails): string | null {
  const dir = join(logDir, CRASH_DIR_NAME);
  const file = join(dir, crashFileName(details.component, details.at));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, formatCrashReport(details));
    return file;
  } catch {
    return null; // a crash we cannot record is not a reason to crash again
  }
}
