import { describeError, reportToLog } from './diagnostics-log.js';

/**
 * The renderer's own failure hooks (066 FR-009/FR-009a, research R5), installed by every window's entry
 * point (`main.tsx` serves the main, sub-workspace and preferences windows alike).
 *
 * Two families, and the split is React's:
 *
 *  - **Root callbacks** (`createRoot(..., rootErrorOptions)`) — what React hands over when a render, an
 *    effect or a lifecycle threw. `onUncaughtError` means no boundary caught it and the root unmounted:
 *    the window is gone, so it is FATAL. `onCaughtError` means a boundary caught it; the boundary reports
 *    its own failure (the panel boundary at fatal with the panel's subject, the file tree's at error), so
 *    this is only a debug breadcrumb — logging it at a higher level would write every panel crash twice.
 *    `onRecoverableError` is React recovering by itself (a hydration or concurrent retry): warn.
 *  - **Window listeners** — what no React boundary can see: a throw from an event handler or a timer
 *    (`error`) and a promise nobody awaited (`unhandledrejection`). Neither tears a panel down, so both
 *    are logged at ERROR, not fatal.
 */
export interface ReactErrorInfo {
  componentStack?: string | undefined;
}

function withStack(error: unknown, info: ReactErrorInfo | undefined): string {
  const stack = info?.componentStack;
  return stack ? `${describeError(error)}\ncomponent stack:${stack}` : describeError(error);
}

export const rootErrorOptions = {
  onUncaughtError: (error: unknown, info?: ReactErrorInfo): void =>
    reportToLog('fatal', 'renderer', `uncaught render error, window torn down: ${withStack(error, info)}`),
  onCaughtError: (error: unknown, info?: ReactErrorInfo): void =>
    reportToLog('debug', 'renderer', `error caught by a boundary: ${withStack(error, info)}`),
  onRecoverableError: (error: unknown, info?: ReactErrorInfo): void =>
    reportToLog('warn', 'renderer', `React recovered from an error: ${withStack(error, info)}`),
};

/** Install the `error` and `unhandledrejection` listeners; returns the function that removes them. */
export function installWindowErrorListeners(target: Window = window): () => void {
  const onError = (event: ErrorEvent): void => {
    const detail = event.error !== undefined && event.error !== null ? describeError(event.error) : event.message;
    reportToLog('error', 'renderer', `uncaught error: ${detail}`);
  };
  const onRejection = (event: Event): void => {
    const reason = (event as Event & { reason?: unknown }).reason;
    reportToLog('error', 'renderer', `unhandled promise rejection: ${describeError(reason)}`);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
