import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_LOG_LEVEL,
  FIXED_LOG_NAMES,
  FATAL_CONSOLE_PREFIX,
  crashFileName,
  formatCrashReport,
  formatLogLine,
  logDayOf,
  logFilePid,
  nextRotatedName,
  normaliseRetention,
  passesThreshold,
  retentionPlan,
  shouldRotate,
  type CrashDetails,
  type LogFileInfo,
  type LogLevel,
  type RetentionPolicy,
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
  /** Flush a pending repeat count (066 FR-015). Called on exit; writes nothing else. */
  close(): void;
}

export interface FileLogOptions {
  /** Directory to write into; created if missing. */
  dir: string;
  /**
   * File name — `sessionFileName(...)` for a process's own log (066). Rolled generations become
   * `<name>.1.log`, `<name>.2.log`, … and are deleted only by retention.
   */
  fileName: string;
  /** The component name every record carries. */
  component: string;
  /** Threshold — injected configuration, never a constant (Principle X). */
  level?: LogLevel;
  /** Roll-over size, active days kept and the folder cap (066 FR-018 – FR-019a). */
  retention?: Partial<RetentionPolicy>;
  /** The clock, injectable so day changes and repeat windows can be tested. */
  now?: () => number;
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
  } catch (error) {
    // Circular, or a getter that threw — the shape is not worth a crash. Said on stderr, not through
    // the console: this IS the console's renderer, and logging here would recurse.
    reportOwnFailure('render a console argument', error);
    return String(arg);
  }
}

/**
 * The logger's own failures (contract *The logger's own failures*): it cannot log them to itself, so
 * each goes to stderr — `daemon-startup.log` for the daemon, the developer console for UI main. A
 * failing stderr is the one failure dropped without a trace.
 */
export function reportOwnFailure(what: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  try {
    process.stderr.write(`throng log: ${what}: ${detail}\n`);
  } catch {
    // last-resort: stderr itself is gone, and there is nowhere left to say so (contract *The logger's own failures*).
  }
}

/**
 * Whether a log file may still be open in a running process, so retention must not delete it. A fixed
 * name is reused by whichever process owns it: always treated as live. A per-process name carries its
 * pid: live while that pid is. Anything else is not known to be held.
 */
function heldByARunningProcess(name: string): boolean {
  if (FIXED_LOG_NAMES.includes(name)) return true;
  const pid = logFilePid(name);
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true; // running, as another user (a de-elevated agent)
    if (code !== 'ESRCH') reportOwnFailure(`cannot probe pid ${pid}`, error);
    return false;
  }
}

/** How long an identical line is counted rather than written (066 FR-015). */
const REPEAT_WINDOW_MS = 60_000;

const MB = 1024 * 1024;

export function createFileLog(options: FileLogOptions): DiagnosticLog {
  const retention = normaliseRetention(options.retention);
  const now = options.now ?? Date.now;
  const path = join(options.dir, options.fileName);
  let threshold: LogLevel = options.level ?? DEFAULT_LOG_LEVEL;
  const mirror = options.mirrorToConsole ?? Boolean(process.stdout?.isTTY);

  try {
    mkdirSync(options.dir, { recursive: true });
  } catch (error) {
    // An unwritable log directory must not stop the application — every write below no-ops.
    reportOwnFailure(`cannot create ${options.dir}`, error);
  }

  const rotateIfNeeded = (incomingBytes: number): void => {
    try {
      if (!existsSync(path)) return;
      if (!shouldRotate(statSync(path).size, incomingBytes, retention.maxFileBytes)) return;
      renameSync(path, join(options.dir, nextRotatedName(options.fileName, readdirSync(options.dir))));
    } catch (error) {
      // Rotation is housekeeping; failing it must never cost us the record we are about to write.
      reportOwnFailure(`cannot roll over ${path}`, error);
    }
  };

  const append = (at: number, level: LogLevel, message: string, component: string): void => {
    const line = `${formatLogLine({ at: new Date(at), level, component, message })}\n`;
    try {
      rotateIfNeeded(Buffer.byteLength(line));
      appendFileSync(path, line);
    } catch (error) {
      // See the class note: a lost line beats a crashed application.
      reportOwnFailure(`cannot write ${path}`, error);
    }
  };

  /** Every file retention may consider: the folder's own files and the crash reports beside them. */
  const listLogFiles = (): LogFileInfo[] => {
    const files: LogFileInfo[] = [];
    const scan = (sub: string): void => {
      const folder = sub ? join(options.dir, sub) : options.dir;
      if (!existsSync(folder)) return;
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const name = sub ? `${sub}/${entry.name}` : entry.name;
        try {
          const stat = statSync(join(options.dir, name));
          files.push({ name, bytes: stat.size, modifiedMs: stat.mtimeMs });
        } catch (error) {
          // Another process's prune can delete a file between our readdir and this stat — that one is gone,
          // which is what retention wanted anyway; skip it rather than abandon the whole prune.
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') reportOwnFailure(`cannot stat ${name}`, error);
        }
      }
    };
    scan('');
    scan(CRASH_DIR_NAME);
    return files;
  };

  let prunedDay = '';
  const pruneIfNewDay = (at: number): void => {
    const today = logDayOf(at);
    if (today === prunedDay) return;
    prunedDay = today;
    try {
      const plan = retentionPlan(listLogFiles(), retention, today, heldByARunningProcess);
      let removed = 0;
      for (const name of plan.delete) {
        try {
          rmSync(join(options.dir, name), { force: true });
          removed += 1;
        } catch (error) {
          reportOwnFailure(`cannot delete ${name}`, error);
        }
      }
      if (removed > 0) {
        append(
          at,
          'info',
          `log retention trimmed ${removed} files (${(plan.trimmedBytes / MB).toFixed(1)} MB) to stay under ${Math.round(retention.maxTotalBytes / MB)} MB`,
          options.component,
        );
      }
    } catch (error) {
      reportOwnFailure(`cannot apply retention in ${options.dir}`, error);
    }
  };

  // Repeat collapsing (066 FR-015): an identical line inside the window is counted, not written, and
  // the count is written as one summary line when the window closes, a different line arrives, or
  // the log is closed. A failure on a timer therefore costs a line a minute, not a line a tick.
  let last: { key: string; level: LogLevel; component: string; message: string } | null = null;
  let repeats = 0;
  let windowStart = 0;
  let lastRepeatAt = 0;
  let windowTimer: ReturnType<typeof setTimeout> | undefined;

  /** Write the pending count, stamped when the last repeat happened, and open a fresh window at `at`. */
  const flushRepeats = (at: number): void => {
    if (windowTimer !== undefined) clearTimeout(windowTimer);
    windowTimer = undefined;
    if (!last || repeats === 0) return;
    const seconds = Math.round((lastRepeatAt - windowStart) / 1000);
    append(lastRepeatAt, last.level, `${last.message} (repeated ${repeats} times in ${seconds}s)`, last.component);
    repeats = 0;
    windowStart = at;
  };

  /** A failure that stops repeating still gets its count written when its window ends, not hours later. */
  const armWindowTimer = (): void => {
    if (windowTimer !== undefined) return;
    windowTimer = setTimeout(() => {
      windowTimer = undefined;
      flushRepeats(now());
    }, Math.max(0, windowStart + REPEAT_WINDOW_MS - now()));
    windowTimer.unref?.();
  };

  /** The write itself — retention, repeats, rotation, formatting, disk. No threshold of its own. */
  const emit = (level: LogLevel, message: string, component: string): void => {
    const at = now();
    pruneIfNewDay(at);
    const key = `${level}\u0001${component}\u0001${message}`;
    if (last && last.key === key) {
      repeats += 1;
      lastRepeatAt = at;
      if (at - windowStart >= REPEAT_WINDOW_MS) flushRepeats(at);
      else armWindowTimer();
      return;
    }
    flushRepeats(at);
    append(at, level, message, component);
    last = { key, level, component, message };
    windowStart = at;
  };

  const write = (level: LogLevel, message: string): void => {
    if (!passesThreshold(threshold, level)) return;
    emit(level, message, options.component);
  };

  pruneIfNewDay(now());

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
    close: () => flushRepeats(now()),
    attachConsole(): () => void {
      const original: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};
      for (const method of Object.keys(CONSOLE_LEVELS) as ConsoleMethod[]) {
        const previous = console[method] as (...args: unknown[]) => void;
        original[method] = previous;
        console[method] = (...args: unknown[]): void => {
          const text = args.map(renderArg).join(' ');
          // Console has no fatal method: `logFatal` marks its line, and the mark becomes the level.
          if (method === 'error' && text.startsWith(`${FATAL_CONSOLE_PREFIX} `)) {
            write('fatal', text.slice(FATAL_CONSOLE_PREFIX.length + 1));
          } else {
            write(CONSOLE_LEVELS[method], text);
          }
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
  } catch (error) {
    // A crash we cannot record is not a reason to crash again — but it is a reason to say so.
    reportOwnFailure(`cannot write crash report ${file}`, error);
    return null;
  }
}
