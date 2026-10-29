import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORK_ELEVATION_REQUIRED } from '@throng/core';
import { lazyNetworkReader, type NetworkTraceHandle } from '../../src/windows-network-trace.js';

/**
 * 055 FR-113, R20 — the collector's network reader starts the trace when the monitor first reads it,
 * and stops it once the monitor stops reading, so a closed monitor costs no per-event work.
 */

const IDLE_MS = 10_000;

function fakeStart() {
  const traces: Array<NetworkTraceHandle & { disposed: boolean }> = [];
  const start = vi.fn(async () => {
    const t = {
      disposed: false,
      read: async () => new Map([[1, 10]]),
      dispose: async () => {
        t.disposed = true;
      },
    };
    traces.push(t);
    return t;
  });
  return { start, traces };
}

describe('lazyNetworkReader (FR-113, R20)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts nothing until the first read', () => {
    const { start } = fakeStart();
    lazyNetworkReader({ start, idleMs: IDLE_MS });
    expect(start).not.toHaveBeenCalled();
  });

  it('keeps the trace while it is read, and stops it once reads stop', async () => {
    const { start, traces } = fakeStart();
    const reader = lazyNetworkReader({ start, idleMs: IDLE_MS });
    expect(await reader.read()).toEqual(new Map([[1, 10]]));
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(IDLE_MS / 2);
      await reader.read();
    }
    expect(start).toHaveBeenCalledTimes(1);
    expect(traces[0]!.disposed).toBe(false);

    await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
    expect(traces[0]!.disposed, 'a monitor that stopped reading stops the trace').toBe(true);

    await reader.read();
    expect(start, 'the next read starts a new trace').toHaveBeenCalledTimes(2);
  });

  it('keeps a refusal without retrying it on every tick', async () => {
    const start = vi.fn(async () => ({ kind: 'unavailable' as const, reason: NETWORK_ELEVATION_REQUIRED }));
    const reader = lazyNetworkReader({ start, idleMs: IDLE_MS });
    expect(await reader.read()).toEqual({ kind: 'unavailable', reason: NETWORK_ELEVATION_REQUIRED });
    await reader.read();
    expect(start).toHaveBeenCalledTimes(1);
  });
});
