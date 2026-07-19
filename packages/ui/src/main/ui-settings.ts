import type { IUiSettings } from '@throng/core';

/**
 * Pure reader for the UI main-process settings (Principle X). Environment access is
 * confined to the composition root, which delegates here; kept in its own module (no
 * OS/native imports) so the documented defaults and env overrides are unit-testable in
 * isolation.
 */

/**
 * Last-resort pipe name when neither `THRONG_PIPE_NAME` nor a per-user default is supplied
 * (020 FR-013). The composition root passes a per-user derived default (`defaultPipeName`);
 * this constant only guards direct calls that predate that wiring.
 */
export const DEFAULT_PIPE_NAME = '\\\\.\\pipe\\throng.daemon';
export const DEFAULT_WINDOW_WIDTH = 1280;
export const DEFAULT_WINDOW_HEIGHT = 800;
export const DEFAULT_PING_TIMEOUT_MS = 2000;
/**
 * Attach budget (008 FR-004): sized for launching an interactive shell — several
 * seconds — and therefore far larger than the health-check ping budget. Reusing the
 * ping budget for attach is what made a slow shell report a spurious connection timeout.
 */
export const DEFAULT_ATTACH_TIMEOUT_MS = 15000;
/**
 * Shutdown-drain backstop (019 FR-010): the longest the close will wait for a window to ack
 * that its deferred writes have settled.
 *
 * This is **not the mechanism** — the close waits on the ACK. It is the escape hatch for a
 * renderer that has stopped answering, so an unresponsive window cannot hold the app open
 * forever. Sized generously (a drain is a handful of small writes) precisely because it must
 * never be the thing that decides whether the user's layout survives: FR-011 refuses a fix
 * that depends on a clock.
 */
export const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 5000;

export function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readUiSettings(
  env: NodeJS.ProcessEnv = process.env,
  fallbackPipeName: string = DEFAULT_PIPE_NAME,
): IUiSettings {
  return {
    pipeName: env.THRONG_PIPE_NAME ?? fallbackPipeName,
    window: {
      width: numberFromEnv(env.THRONG_WINDOW_WIDTH, DEFAULT_WINDOW_WIDTH),
      height: numberFromEnv(env.THRONG_WINDOW_HEIGHT, DEFAULT_WINDOW_HEIGHT),
    },
    pingTimeoutMs: numberFromEnv(env.THRONG_PING_TIMEOUT_MS, DEFAULT_PING_TIMEOUT_MS),
    attachTimeoutMs: numberFromEnv(env.THRONG_ATTACH_TIMEOUT_MS, DEFAULT_ATTACH_TIMEOUT_MS),
    shutdownDrainTimeoutMs: numberFromEnv(
      env.THRONG_SHUTDOWN_DRAIN_TIMEOUT_MS,
      DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS,
    ),
  };
}
