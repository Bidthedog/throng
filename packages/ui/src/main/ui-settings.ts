import type { IUiSettings } from '@throng/core';

/**
 * Pure reader for the UI main-process settings (Principle X). Environment access is
 * confined to the composition root, which delegates here; kept in its own module (no
 * OS/native imports) so the documented defaults and env overrides are unit-testable in
 * isolation.
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

export function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readUiSettings(env: NodeJS.ProcessEnv = process.env): IUiSettings {
  return {
    pipeName: env.THRONG_PIPE_NAME ?? DEFAULT_PIPE_NAME,
    window: {
      width: numberFromEnv(env.THRONG_WINDOW_WIDTH, DEFAULT_WINDOW_WIDTH),
      height: numberFromEnv(env.THRONG_WINDOW_HEIGHT, DEFAULT_WINDOW_HEIGHT),
    },
    pingTimeoutMs: numberFromEnv(env.THRONG_PING_TIMEOUT_MS, DEFAULT_PING_TIMEOUT_MS),
    attachTimeoutMs: numberFromEnv(env.THRONG_ATTACH_TIMEOUT_MS, DEFAULT_ATTACH_TIMEOUT_MS),
  };
}
