/**
 * 073 FR-024 (convergence T082) — Copy puts the selected cells on the clipboard. A copy holds at most
 * `GRID_MAX_CELLS` cells (what a paste can take back, FR-024 as refined), and a copy cut short at that bound says so:
 * `copyGridRange` reports how many cells it copied of how many were selected, so the panel can tell the reader. A
 * copy within the bound reports nothing.
 *
 * Layer: unit — the clipboard bridge stubbed; the panel's notice is `preview-copy-capped.test.ts`'s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRID_MAX_CELLS } from '@throng/core/csv';
import { copyGridRange } from '../../src/renderer/grid/grid-copy.js';

let write: ReturnType<typeof vi.fn>;

beforeEach(() => {
  write = vi.fn(async () => {});
  // The unit layer has no DOM: the bridge is all `window` holds here.
  Reflect.set(globalThis, 'window', { throng: { clipboard: { write, writeRich: vi.fn(async () => {}) } } });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

describe('a grid copy past the cell bound (FR-024)', () => {
  it('copies the bound and reports how many of how many', async () => {
    const width = 1000;
    const rows = GRID_MAX_CELLS / width + 5;
    const onCapped = vi.fn();
    const ok = await copyGridRange({ top: 0, bottom: rows - 1, left: 0, right: width - 1 }, () => 'x', 'plain', onCapped);
    expect(ok).toBe(true);
    expect(onCapped).toHaveBeenCalledWith(GRID_MAX_CELLS, rows * width);
    const text = write.mock.calls[0]![0].text as string;
    expect(text.split('\n')).toHaveLength(GRID_MAX_CELLS / width);
  });

  it('reports nothing for a copy within the bound', async () => {
    const onCapped = vi.fn();
    await copyGridRange({ top: 0, bottom: 9, left: 0, right: 2 }, () => 'x', 'plain', onCapped);
    expect(onCapped).not.toHaveBeenCalled();
  });
});
