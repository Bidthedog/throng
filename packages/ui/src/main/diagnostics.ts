import { join } from 'node:path';
import { createFileLog, writeCrashReport, type DiagnosticLog } from '@throng/platform-windows';
import type { CrashDetails, LogLevel } from '@throng/core';

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
  /** Write a crash report and summarise it into the log, so the timeline shows both. */
  recordCrash(details: Omit<CrashDetails, 'version' | 'buildId'>): void;
  /** Apply the user's configured level once settings have been read. */
  setLevel(level: LogLevel): void;
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
  policy?: { maxBytes?: number; keep?: number };
  /** Test seam: where crash reports go (defaults beside the log). */
  logDir?: string;
}

export function startUiDiagnostics(options: UiDiagnosticsOptions): UiDiagnostics {
  const logDir = options.logDir ?? logDirFor(options.userDataDir);
  const log = createFileLog({
    dir: logDir,
    fileName: 'main.log',
    component: 'ui-main',
    level: options.level,
    policy: options.policy,
  });

  return {
    log,
    logDir,
    setLevel: (level) => log.setLevel(level),
    logAlways: (level, message, component) => log.logAlways(level, message, component),
    recordCrash(details): void {
      const full: CrashDetails = { ...details, version: options.version, buildId: options.buildId };
      const path = writeCrashReport(logDir, full);
      // The log gets a one-line summary and a POINTER. The report itself is the document a user
      // attaches; the log is the timeline that says a crash happened here, among everything else
      // that was going on at the time — and neither is much use without the other.
      log.error(
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
      reason: 'uncaughtException',
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
