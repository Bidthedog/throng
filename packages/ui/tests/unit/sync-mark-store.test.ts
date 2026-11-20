/**
 * 073 FR-033d, FR-033f — the sync mark's lifetime: bright until the highlight duration after the LAST sync scroll, then
 * off, then gone; a duration of 0 draws nothing at all.
 *
 * Layer: unit — the store and fake timers; no DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SYNC_MARK_FADE_MS,
  SYNC_MARK_REMOVE_MS,
  __resetSyncMarks,
  publishSyncMark,
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
