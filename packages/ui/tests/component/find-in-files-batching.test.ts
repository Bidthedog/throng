/**
 * 043 T053c — SC-004's RENDERER half, asserted structurally rather than by wall clock.
 *
 * SC-004 says a 5,000-file project streams its results without the window stalling, and it puts a
 * 100 ms figure on it. That figure is a DESIGN BUDGET, not an assertion: a 100 ms ceiling measured
 * in jsdom measures whichever machine happened to run the suite, and this repo has a strict
 * flaky-test gate. `quickstart.md`'s hands-on step is what judges the 100 ms.
 *
 * What is assertable, and what these tests assert, is the SHAPE that budget is chosen to respect:
 *
 *   1. one arriving batch is one synchronous turn's work — the store reads each arriving row once
 *      and never re-reads a row it has already accepted;
 *   2. accepting a batch does not rebuild the accumulated list, so the cost of the n-th batch is
 *      the same as the cost of the first (the spec's Assumptions decline a match ceiling, so an
 *      O(total)-per-batch fold is quadratic in a number nothing bounds);
 *   3. a batch from a superseded generation costs nothing at all — it is dropped before a single
 *      row is looked at.
 *
 * The producer's half — that no batch ever exceeds `MAX_ROWS_PER_BATCH` — is asserted over a real
 * 5,000-file walk in `packages/ui/tests/integration/file-search-scan.integration.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { MAX_ROWS_PER_BATCH, type ResultRow } from '@throng/core';
import {
  NO_FILE_SEARCH_RESULTS,
  applyFileSearchUpdate,
  type FileSearchUpdateEvent,
} from '../../src/renderer/find-in-files/find-in-files-store.js';

function row(i: number): ResultRow {
  return {
    relPath: `pkg${i % 40}/f${i}.ts`,
    line: 1,
    column: 14,
    from: 13,
    to: 19,
    snippet: {
      before: 'export const ',
      matched: 'needle',
      after: ';',
      truncatedStart: false,
      truncatedEnd: false,
    },
  };
}

/** A batch that counts how many times the store read an element out of it. */
function countedBatch(rows: ResultRow[]): { rows: ResultRow[]; reads: () => number } {
  let reads = 0;
  const proxy = new Proxy(rows, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  return { rows: proxy, reads: () => reads };
}

function batchOf(start: number, size: number): ResultRow[] {
  return Array.from({ length: size }, (_, i) => row(start + i));
}

function update(generation: number, rows: ResultRow[], total: number): FileSearchUpdateEvent {
  return { panelId: 'p1', generation, status: 'running', rows, totalMatches: total };
}

describe('find in files: one batch is one turn (043 T053c, SC-004)', () => {
  it('reads each arriving row once and no accumulated row at all', () => {
    let state = NO_FILE_SEARCH_RESULTS;
    let delivered = 0;
    const perTurnReads: number[] = [];

    for (let k = 0; k < 20; k++) {
      const batch = countedBatch(batchOf(delivered, MAX_ROWS_PER_BATCH));
      delivered += MAX_ROWS_PER_BATCH;
      state = applyFileSearchUpdate(state, update(1, batch.rows, delivered));
      perTurnReads.push(batch.reads());
      // Nothing is queued for a later turn: the batch it was handed is the batch it landed.
      expect(state.rows).toHaveLength(delivered);
    }

    // Each arriving row is looked at exactly once, so one turn's work is bounded by the batch —
    // which the producer bounds at MAX_ROWS_PER_BATCH.
    for (const reads of perTurnReads) expect(reads).toBeLessThanOrEqual(MAX_ROWS_PER_BATCH);
    // The twentieth batch costs what the first did. A fold that rebuilt the list would make this
    // grow with `delivered`, which is exactly the stall SC-004 forbids and the reason the spec's
    // refusal to cap the match count matters here.
    expect(perTurnReads.at(-1)).toBe(perTurnReads[0]);
  });

  it('appends in place rather than rebuilding the accumulated list', () => {
    // The structural claim behind the one above, stated as identity so it cannot be satisfied by
    // accident: within a generation the accumulated array is the SAME array, while the state object
    // is a new one so a consumer still re-renders.
    const first = applyFileSearchUpdate(
      NO_FILE_SEARCH_RESULTS,
      update(1, batchOf(0, MAX_ROWS_PER_BATCH), MAX_ROWS_PER_BATCH),
    );
    const second = applyFileSearchUpdate(
      first,
      update(1, batchOf(MAX_ROWS_PER_BATCH, MAX_ROWS_PER_BATCH), 2 * MAX_ROWS_PER_BATCH),
    );
    expect(second).not.toBe(first);
    expect(second.rows).toBe(first.rows);
    expect(second.rows).toHaveLength(2 * MAX_ROWS_PER_BATCH);
    expect(second.version).toBeGreaterThan(first.version);
  });

  it('drops a superseded batch without reading a single row', () => {
    const current = applyFileSearchUpdate(NO_FILE_SEARCH_RESULTS, update(2, batchOf(0, 10), 10));
    const stale = countedBatch(batchOf(1000, MAX_ROWS_PER_BATCH));
    const after = applyFileSearchUpdate(current, update(1, stale.rows, MAX_ROWS_PER_BATCH));
    expect(after).toBe(current);
    expect(stale.reads()).toBe(0);
    expect(after.rows).toHaveLength(10);
  });

  it('a new generation starts a new array, so the abandoned run leaves nothing behind', () => {
    const first = applyFileSearchUpdate(NO_FILE_SEARCH_RESULTS, update(1, batchOf(0, 10), 10));
    const next = applyFileSearchUpdate(first, update(2, batchOf(500, 3), 3));
    expect(next.rows).not.toBe(first.rows);
    expect(next.rows).toHaveLength(3);
    expect(next.totalMatches).toBe(3);
  });

  it('carries the scan counters the panel reports, without inventing any', () => {
    const state = applyFileSearchUpdate(NO_FILE_SEARCH_RESULTS, {
      panelId: 'p1',
      generation: 1,
      status: 'complete',
      rows: batchOf(0, 4),
      totalMatches: 4,
      filesScanned: 5_000,
      skipped: 3,
    });
    expect(state.status).toBe('complete');
    expect(state.totalMatches).toBe(4);
    expect(state.filesScanned).toBe(5_000);
    // FR-045f — ONE count for the whole scan, carried as a number and never as a per-file marker.
    expect(state.skipped).toBe(3);
    expect(NO_FILE_SEARCH_RESULTS.status).toBe('notRun');
  });
});
