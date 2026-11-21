/**
 * 073 FR-033d, FR-033f — the sync mark's lifetime: bright until the highlight duration after the LAST sync scroll, then
 * off, then gone; a duration of 0 draws nothing at all.
 *
 * Layer: unit — the store and fake timers; no DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SYNC_MARK_FADE_MS,
  SYNC_MARK_QUIET_MS,
  SYNC_MARK_REMOVE_MS,
  __resetSyncMarks,
  clearSyncMark,
  publishSyncMark,
  settleSyncMark,
  subscribeSyncMark,
  syncMarkOf,
} from '../../src/renderer/preview/sync-mark-store.js';

beforeEach(() => {
  vi.useFakeTimers();
  __resetSyncMarks();
});
afterEach(() => {
  __resetSyncMarks();
  vi.useRealTimers();
});

describe('the default duration is 1.5 seconds', () => {
  it('is bright until 1.5 s, off at 1.5 s, gone 700 ms later', () => {
    publishSyncMark('ed', 3);
    vi.advanceTimersByTime(SYNC_MARK_FADE_MS - 1);
    expect(syncMarkOf('ed')).toEqual({ line: 3, on: true });
    vi.advanceTimersByTime(1);
    expect(syncMarkOf('ed')).toEqual({ line: 3, on: false });
    vi.advanceTimersByTime(SYNC_MARK_REMOVE_MS);
    expect(syncMarkOf('ed')).toBeNull();
  });
});

describe('the highlight duration is the caller\'s, per scroll (FR-033f: read live by the next scroll)', () => {
  it('at 4 seconds it stays bright for 4 s, then fades', () => {
    publishSyncMark('ed', 3, 4000);
    vi.advanceTimersByTime(3999);
    expect(syncMarkOf('ed')?.on).toBe(true);
    vi.advanceTimersByTime(1);
    expect(syncMarkOf('ed')).toEqual({ line: 3, on: false });
    vi.advanceTimersByTime(SYNC_MARK_REMOVE_MS);
    expect(syncMarkOf('ed')).toBeNull();
  });

  it('the next scroll uses its own duration: a value changed between two scrolls applies to the second', () => {
    publishSyncMark('ed', 3, 4000);
    vi.advanceTimersByTime(1000);
    publishSyncMark('ed', 4, 500);
    vi.advanceTimersByTime(499);
    expect(syncMarkOf('ed')?.on).toBe(true);
    vi.advanceTimersByTime(1);
    expect(syncMarkOf('ed')).toEqual({ line: 4, on: false });
  });

  it('at 0 nothing is drawn at all: no mark, no notification', () => {
    const heard = vi.fn();
    const off = subscribeSyncMark(heard);
    publishSyncMark('ed', 3, 0);
    expect(syncMarkOf('ed')).toBeNull();
    expect(heard).not.toHaveBeenCalled();
    off();
  });

  it('a 0 after a mark is showing takes the mark down at once', () => {
    publishSyncMark('ed', 3, 4000);
    publishSyncMark('ed', 4, 0);
    expect(syncMarkOf('ed')).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(syncMarkOf('ed')).toBeNull();
  });

  it('a negative or non-finite duration draws nothing, like 0', () => {
    publishSyncMark('ed', 3, -1);
    publishSyncMark('ed', 3, Number.NaN);
    expect(syncMarkOf('ed')).toBeNull();
  });
});

describe('073 T075 — a publish that changes nothing tells nobody', () => {
  it('the same line again, while it is showing, emits nothing: a hundred repeats are one notification', () => {
    const heard = vi.fn();
    const off = subscribeSyncMark(heard);
    for (let i = 0; i < 100; i += 1) publishSyncMark('ed', 3);
    expect(heard).toHaveBeenCalledTimes(1);
    off();
  });

  it('each move to another line is one notification, and the fade is one more', () => {
    const heard = vi.fn();
    const off = subscribeSyncMark(heard);
    publishSyncMark('ed', 3);
    publishSyncMark('ed', 4);
    expect(heard).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(SYNC_MARK_FADE_MS);
    expect(heard).toHaveBeenCalledTimes(3);
    off();
  });
});

describe('the mark is made once scrolling has stopped for 300 ms (FR-033g)', () => {
  it('draws nothing, reads nothing and tells no one while calls keep coming inside the quiet period', () => {
    const heard = vi.fn();
    const line = vi.fn(() => 7);
    const off = subscribeSyncMark(heard);
    for (let i = 0; i < 50; i += 1) {
      settleSyncMark('ed', line);
      vi.advanceTimersByTime(16);
    }
    expect(heard).not.toHaveBeenCalled();
    expect(line).not.toHaveBeenCalled();
    expect(syncMarkOf('ed')).toBeNull();
    off();
  });

  it('publishes exactly once, SYNC_MARK_QUIET_MS after the last call, from the line asked for THEN', () => {
    let at = 1;
    settleSyncMark('ed', () => at);
    vi.advanceTimersByTime(100);
    at = 9;
    settleSyncMark('ed', () => at);
    vi.advanceTimersByTime(SYNC_MARK_QUIET_MS - 1);
    expect(syncMarkOf('ed')).toBeNull();
    vi.advanceTimersByTime(1);
    expect(syncMarkOf('ed')).toEqual({ line: 9, on: true });
  });

  it('a mark that is showing comes down on the next call, with one notification, and nothing is drawn until it stops again', () => {
    settleSyncMark('ed', () => 4);
    vi.advanceTimersByTime(SYNC_MARK_QUIET_MS);
    expect(syncMarkOf('ed')?.on).toBe(true);
    const heard = vi.fn();
    const off = subscribeSyncMark(heard);
    settleSyncMark('ed', () => 5);
    expect(syncMarkOf('ed')).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    settleSyncMark('ed', () => 5);
    expect(heard).toHaveBeenCalledTimes(1); // no mark to clear: no notification
    vi.advanceTimersByTime(SYNC_MARK_QUIET_MS);
    expect(syncMarkOf('ed')).toEqual({ line: 5, on: true });
    off();
  });

  it('a duration of 0 schedules nothing, and one that is showing comes down', () => {
    publishSyncMark('ed', 2);
    const line = vi.fn(() => 3);
    settleSyncMark('ed', line, 0);
    vi.advanceTimersByTime(SYNC_MARK_QUIET_MS * 2);
    expect(line).not.toHaveBeenCalled();
    expect(syncMarkOf('ed')).toBeNull();
  });

  it('clearing the pair (sync turned off, a view gone) cancels a mark that was waiting to be drawn', () => {
    settleSyncMark('ed', () => 6);
    vi.advanceTimersByTime(100);
    clearSyncMark('ed');
    vi.advanceTimersByTime(SYNC_MARK_QUIET_MS);
    expect(syncMarkOf('ed')).toBeNull();
  });

  it('a line of null (no place to name) draws nothing', () => {
    settleSyncMark('ed', () => null);
    vi.advanceTimersByTime(SYNC_MARK_QUIET_MS);
    expect(syncMarkOf('ed')).toBeNull();
  });
});
