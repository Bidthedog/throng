import { FATAL_CONSOLE_PREFIX, isLogLevel, logCaught, type LogLevel } from '@throng/core';

/**
 * 066 FR-005 / research R1, R5 — the renderer's records reach `main.log`.
 *
 * Two routes, one sink. The preload's `diagnostics.log(level, component, message)` is the renderer's
 * own channel: it carries the fatal level and a component (`panel`, `renderer`), which nothing else
 * can. The `console-message` forwarder is the backstop for whatever the renderer — or a library it
 * loads — writes to its console. Fatal is written whatever the threshold (FR-009a); every other level
 * passes main's configured threshold, so `logExpected`'s debug lines appear exactly when debug is on.
 */

/** Contract *Preload → main*. One-way: a diagnostics write that failed must never surface in the view. */
export const DIAGNOSTICS_LOG_CHANNEL = 'throng:diagnostics:log';

/** The most of one renderer message a record keeps (contract: 8 KB), so one send cannot flood the log. */
export const MAX_RENDERER_MESSAGE_CHARS = 8 * 1024;

/** A component name is a label, not content. */
const MAX_COMPONENT_CHARS = 64;

const RENDERER_COMPONENT = 'renderer';

/** What the forwarders need of UI main's diagnostics (`UiDiagnostics` satisfies it). */
export interface DiagnosticsLogSink {
  logAlways(level: LogLevel, message: string, component?: string): void;
  passes(level: LogLevel): boolean;
}

export interface DiagnosticsLogIpc {
  on(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
}

function cap(message: string): string {
  return message.length > MAX_RENDERER_MESSAGE_CHARS
    ? `${message.slice(0, MAX_RENDERER_MESSAGE_CHARS)}… [${message.length - MAX_RENDERER_MESSAGE_CHARS} more chars]`
    : message;
}

function write(sink: DiagnosticsLogSink, level: LogLevel, component: string, message: string): void {
  if (level !== 'fatal' && !sink.passes(level)) return;
  sink.logAlways(level, cap(message), component);
}

/** The renderer's own channel. A payload that is not `{ level, component, message }` is dropped. */
export function registerDiagnosticsLogIpc(sink: DiagnosticsLogSink, ipc: DiagnosticsLogIpc): void {
  ipc.on(DIAGNOSTICS_LOG_CHANNEL, (_event, payload) => {
    try {
      if (typeof payload !== 'object' || payload === null) return;
      const { level, component, message } = payload as Record<string, unknown>;
      if (!isLogLevel(level) || typeof message !== 'string') return;
      const name =
        typeof component === 'string' && component.trim() !== ''
          ? component.trim().slice(0, MAX_COMPONENT_CHARS)
          : RENDERER_COMPONENT;
      write(sink, level, name, message);
    } catch (error) {
      // An uncaught throw in an ipcMain listener would take main down; the console reaches main.log.
      logCaught('diagnostics IPC', error);
    }
  });
}

/** Electron's `console-message` details (Electron ≥ 35 passes them as the event). */
interface ConsoleMessageDetails {
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  lineNumber?: number;
  sourceId?: string;
}

export interface ConsoleSource {
  on(event: 'console-message', listener: (details: ConsoleMessageDetails) => void): unknown;
}

const CONSOLE_LEVELS: Readonly<Record<ConsoleMessageDetails['level'], LogLevel>> = {
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  error: 'error',
};

/** The backstop: one window's console into `main.log` as component `renderer`. */
export function forwardRendererConsole(sink: DiagnosticsLogSink, contents: ConsoleSource): void {
  contents.on('console-message', (details) => {
    try {
      let level: LogLevel = CONSOLE_LEVELS[details.level] ?? 'info';
      let message = String(details.message);
      // The renderer's `logFatal` writes `[FATAL] …` to console.error, as every other process does.
      if (level === 'error' && message.startsWith(`${FATAL_CONSOLE_PREFIX} `)) {
        level = 'fatal';
        message = message.slice(FATAL_CONSOLE_PREFIX.length + 1);
      }
      write(sink, level, RENDERER_COMPONENT, message);
    } catch (error) {
      logCaught('renderer console forwarder', error);
    }
  });
}
