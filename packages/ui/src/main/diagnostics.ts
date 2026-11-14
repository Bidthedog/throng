import { join } from 'node:path';
import { createFileLog, createProcessAnonymiser, writeCrashReport, type DiagnosticLog } from '@throng/platform';
import {
  DEFAULT_LOG_LEVEL,
  passesThreshold,
  type Anonymiser,
  type CrashDetails,
  type LogLevel,
  type RetentionPolicy,
} from '@throng/core';

/**
 * Durable diagnostics for the Electron main process (#123).
 *
 * A developer runs throng from a terminal and watches it. An INSTALLED throng is launched from a
 * shortcut and has no console at all — so every `console.*` it wrote went nowhere, no crash left a
 * trace, and a user whose app would not start had nothing whatever to send. The version number told
 * us WHICH build broke; nothing told us HOW.
 *
 * This owns the main process's half of the answer: one rotating log beside the rest of its per-user
 * state, the existing console output tee'd into it (rather than twenty-nine call sites rewritten),
 * and a crash report written for every way a component can die without being asked to.
 */

/** Logs live beside the other per-user state, never under the install root (spec 020, FR-008). */
export const LOG_DIR_NAME = 'logs';

export function logDirFor(userDataDir: string): string {
  return join(userDataDir, LOG_DIR_NAME);
}

export interface UiDiagnostics {
  readonly log: DiagnosticLog;
  readonly logDir: string;
  /**
   * 068 FR-034a: the anonymiser every line written here passes through. UI main teaches it each
   * project's root and name as the project list arrives; its salt goes to the daemon and the
   * collector so one value gets one token in every process.
   */
  readonly anonymiser: Anonymiser;
  readonly salt: string;
  /** Write a crash report and summarise it into the log, so the timeline shows both. */
  recordCrash(details: Omit<CrashDetails, 'version' | 'buildId'>): void;
  /** Apply the user's configured level once settings have been read. */
  setLevel(level: LogLevel): void;
  /** Whether a record at `level` passes the threshold in force now (066: the renderer's records). */
  passes(level: LogLevel): boolean;
  /**
   * Write a record the configured threshold must not be allowed to drop (030 FR-006b).
   *
   * The notice channel's route to the file. A notice the user set to "Never display" is promised a
   * log record in exchange — so `diagnostics.logLevel: 'error'` silently swallowing every `info`
   * and `warning` notice would make that promise false, and nothing would say so. `component`
   * names the record's origin (`renderer-notice`) in place of `ui-main`.
   */
  logAlways(level: LogLevel, message: string, component?: string): void;
}

export interface UiDiagnosticsOptions {
  userDataDir: string;
  version: string;
  buildId: string;
  /** The level to start at, before settings are read. */
  level?: LogLevel;
  /** Rotation/retention, from settings (Principle X) — see DiagnosticsSettings. */
  retention?: Partial<RetentionPolicy>;
  /** Test seam: where crash reports go (defaults beside the log). */
  logDir?: string;
  /** The folder the application is installed in (kept relative in stacks); defaults to the exec dir. */
  installDir?: string;
  /** Further folders to hide, such as the config root. */
  extraDirs?: readonly string[];
}

export function startUiDiagnostics(options: UiDiagnosticsOptions): UiDiagnostics {
  const logDir = options.logDir ?? logDirFor(options.userDataDir);
  const { anonymiser, salt } = createProcessAnonymiser({
    logDir,
    // The salt lives in the user data folder, outside the logs a user attaches to a bug report.
    saltDir: options.userDataDir,
    userDataDir: options.userDataDir,
    installDir: options.installDir,
    extraDirs: options.extraDirs,
  });
  const log = createFileLog({
    dir: logDir,
    fileName: 'main.log',
    component: 'ui-main',
    level: options.level,
    retention: options.retention,
    anonymiser,
  });
  // Mirrors the log's own threshold, which it does not expose: records written with a component of
  // their own go through `logAlways`, so the threshold test is made here.
  let threshold: LogLevel = options.level ?? DEFAULT_LOG_LEVEL;

  return {
    log,
    logDir,
    anonymiser,
    salt,
    setLevel: (level) => {
      threshold = level;
      log.setLevel(level);
    },
    passes: (level) => passesThreshold(threshold, level),
    logAlways: (level, message, component) => log.logAlways(level, message, component),
    recordCrash(details): void {
      const full: CrashDetails = { ...details, version: options.version, buildId: options.buildId };
      const path = writeCrashReport(logDir, full, anonymiser);
      // The log gets a one-line summary and a POINTER. The report itself is the document a user
      // attaches; the log is the timeline that says a crash happened here, among everything else
      // that was going on at the time — and neither is much use without the other.
      // 066 FR-009a — a component that died is fatal, which no threshold drops.
      log.log(
        'fatal',
        `CRASH ${details.component}: ${details.reason}` +
          (details.exitCode === undefined || details.exitCode === null
            ? ''
            : ` (exit ${details.exitCode})`) +
          (path ? ` — report: ${path}` : ' — report could not be written'),
      );
    },
  };
}

/** The Electron surface these handlers need — narrowed so the wiring can be unit-tested. */
export interface CrashSourceApp {
  on(event: 'render-process-gone', listener: (event: unknown, webContents: unknown, details: { reason: string; exitCode: number }) => void): void;
  on(event: 'child-process-gone', listener: (event: unknown, details: { type: string; reason: string; exitCode: number; name?: string; serviceName?: string }) => void): void;
}

/**
 * Capture every way a component can die without being asked to.
 *
 * `window-all-closed → app.quit()` means a renderer that dies takes the whole application with it,
 * quietly and indistinguishably from the user closing it. And because Electron initialises its own
 * Crashpad, such a crash is not even reported to Windows — which is why the machine's event log had
 * nothing to say about an application that had plainly been disappearing.
 */
export function installCrashHandlers(
  diagnostics: UiDiagnostics,
  app: CrashSourceApp,
  proc: NodeJS.EventEmitter = process,
): void {
  app.on('render-process-gone', (_event, _webContents, details) => {
    diagnostics.recordCrash({
      component: 'renderer',
      at: new Date(),
      reason: details.reason,
      exitCode: details.exitCode,
      output: `The window process ended with reason "${details.reason}".`,
    });
  });

  app.on('child-process-gone', (_event, details) => {
    diagnostics.recordCrash({
      component: details.type || 'child-process',
      at: new Date(),
      reason: details.reason,
      exitCode: details.exitCode,
      output: `A ${details.type} child process (${details.name ?? details.serviceName ?? 'unnamed'}) ended with reason "${details.reason}".`,
    });
  });

  const onUncaught = (error: Error): void => {
    diagnostics.recordCrash({
      component: 'ui-main',
      at: new Date(),
      // The message rides in the reason so the log line names the failure, not only the report.
      reason: `uncaughtException: ${error.message}`,
      output: error.stack ?? `${error.name}: ${error.message}`,
    });
    // Hand the error back to the platform once it is recorded. MERELY HAVING A LISTENER suppresses
    // Electron's own uncaught-exception behaviour, so swallowing it here would trade a visible
    // failure for an application left running in a state nobody has reasoned about.
    proc.removeListener('uncaughtException', onUncaught);
    throw error;
  };
  proc.on('uncaughtException', onUncaught);

  proc.on('unhandledRejection', (reason: unknown) => {
    // NOT a crash: the process is still standing, and killing it over a rejected promise would be a
    // worse bug than the rejection. It goes in the timeline, where it belongs.
    const text = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    diagnostics.log.error(`unhandledRejection: ${text}`);
  });
}

/**
 * How long a window may stay unresponsive, after Electron says it is, before it counts as a crash
 * (066 research R3). A window that answers again inside it was busy, not dead.
 */
export const UNRESPONSIVE_FATAL_MS = 15_000;

/** The Electron surface `watchWindowHealth` needs: a BrowserWindow, narrowed for the unit test. */
export interface WatchedWindow {
  on(event: 'unresponsive' | 'responsive', listener: () => void): unknown;
  readonly webContents: {
    on(event: 'preload-error', listener: (event: unknown, preloadPath: string, error: Error) => void): unknown;
    on(
      event: 'did-fail-load',
      listener: (event: unknown, errorCode: number, errorDescription: string, url: string, isMainFrame: boolean) => void,
    ): unknown;
    once(event: 'did-finish-load', listener: () => void): unknown;
  };
}

/** Chromium's ERR_ABORTED: a load superseded by another navigation — not a failure of the window. */
const ERR_ABORTED = -3;

/**
 * 066 FR-005 / FR-009a — a window's own ways of dying, per window: unresponsive past
 * `UNRESPONSIVE_FATAL_MS`, a preload script that threw (the window has no `window.throng`), and a
 * first load that failed (the window is blank). Each is fatal. `label` names the window in the record.
 */
export function watchWindowHealth(diagnostics: UiDiagnostics, win: WatchedWindow, label: string): void {
  let hung: ReturnType<typeof setTimeout> | undefined;
  win.on('unresponsive', () => {
    diagnostics.log.warn(`window ${label} is unresponsive`);
    clearTimeout(hung);
    hung = setTimeout(() => {
      hung = undefined;
      diagnostics.log.log('fatal', `window ${label} unresponsive for ${UNRESPONSIVE_FATAL_MS} ms`);
    }, UNRESPONSIVE_FATAL_MS);
    hung.unref?.();
  });
  win.on('responsive', () => {
    if (hung === undefined) return;
    clearTimeout(hung);
    hung = undefined;
    diagnostics.log.info(`window ${label} is responsive again`);
  });

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    diagnostics.log.log('fatal', `window ${label}: preload ${preloadPath} threw: ${error.stack ?? error.message}`);
  });

  let loaded = false;
  win.webContents.once('did-finish-load', () => {
    loaded = true;
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === ERR_ABORTED) {
      diagnostics.log.debug(`window ${label}: load of ${url} aborted — expected: superseded by another navigation`);
      return;
    }
    const what = `window ${label}: load of ${url} failed: ${errorDescription} (${errorCode})`;
    if (loaded) diagnostics.log.warn(what);
    else diagnostics.log.log('fatal', `${what} — the window never loaded`);
  });
}
