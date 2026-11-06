import { describeError as describeCaught, logAt } from '@throng/core';
/**
 * The renderer's one way into the diagnostics log (066 FR-009/FR-009a, research R5).
 *
 * `window.throng.diagnostics.log(level, component, message)` is the preload channel that lands a line
 * in `main.log` (contracts/diagnostics.md, *Preload -> main*). Every renderer failure report — the
 * root's error callbacks, the window listeners and the per-panel boundary — goes through here, so the
 * "bridge absent" and "bridge threw" cases are decided once.
 *
 * A failure to REPORT a failure must not become a second failure: this never throws. When the bridge
 * is absent (a test, a window still booting) or throws, the line goes to the console, which main's
 * `console-message` backstop still collects.
 */
export type RendererLogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug';

interface DiagnosticsLogBridge {
  log?: (level: RendererLogLevel, component: string, message: string) => void;
}

/** What a thrown value says about itself, with its stack where it has one. Never throws. */
export function describeError(error: unknown): string {
  return error instanceof Error && typeof error.stack === 'string' ? error.stack : describeCaught(error);
}

export function reportToLog(level: RendererLogLevel, component: string, message: string): void {
  try {
    const bridge = window.throng?.diagnostics as DiagnosticsLogBridge | undefined;
    if (bridge?.log) {
      bridge.log(level, component, message);
      return;
    }
    // No bridge: the console, whose forwarding into main.log maps `[FATAL] ` back to fatal.
    logAt(level, `${component}: ${message}`);
  } catch (err) {
    console.error(`renderer log failed (${level} ${component}): ${message}`, err);
  }
}
