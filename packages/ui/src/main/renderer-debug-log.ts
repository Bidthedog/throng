/**
 * The renderer→main DEBUG log channel (#290, #162).
 *
 * The renderer has no file of its own, and an installed throng has no console to read, so a view's
 * debug lines travel here and land in `main.log` beside main's own timeline. Written through the
 * ordinary threshold-gated `debug`, unlike the notice channel: these lines exist only when the user
 * asked for `diagnostics.logLevel: debug`, and must cost nothing otherwise.
 */

/** One-way, like the notice channel: a diagnostics write that failed must never surface. */
export const RENDERER_DEBUG_LOG_CHANNEL = 'throng:diagnostics:debug';

/** Prefixed onto every line, so a reader can tell the renderer's records from main's. */
export const RENDERER_DEBUG_PREFIX = '[renderer-terminal]';

/** Longer than any real line; a bound so a runaway caller cannot fill the log from one send. */
const MAX_LINE = 4000;

export interface RendererDebugLogSink {
  debug(message: string): void;
}

export interface RendererDebugLogIpc {
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

export function registerRendererDebugLogIpc(
  sink: RendererDebugLogSink,
  ipc: RendererDebugLogIpc,
): void {
  ipc.on(RENDERER_DEBUG_LOG_CHANNEL, (_event, payload) => {
    try {
      if (typeof payload !== 'string' || payload === '') return;
      const line = payload.replace(/[\r\n]+/g, ' ').slice(0, MAX_LINE);
      sink.debug(`${RENDERER_DEBUG_PREFIX} ${line}`);
    } catch {
      /* an uncaught throw in an ipcMain listener would take main down */
    }
  });
}
