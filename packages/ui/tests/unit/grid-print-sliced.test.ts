/**
 * 075 FR-075b, Principle XII — printing a large CSV must not freeze its panel. Building the table for 100,000 rows ×
 * 50 columns in one go took 2.6 – 3.0 s (measured 2026-11-20), so it is built in slices, yielding to input between
 * them, and comes out exactly as the one-go build would.
 *
 * Layer: unit — the builder over a stand-in grid, with a clock the test drives.
 */
import { describe, expect, it } from 'vitest';
import { GRID_PRINT_SLICE_MS, gridPrintHtml, gridPrintHtmlSliced, type GridPrintSource } from '../../src/renderer/grid/grid-print.js';

/** A grid whose every cell read costs `msPerCell` on the test's clock. */
function costed(rows: number, cols: number, msPerCell: number) {
  let clock = 0;
  const source: GridPrintSource = {
    rowCount: rows,
    colCount: cols,
    cell: (r, c) => {
      clock += msPerCell;
      return `r${r}c${c}`;
    },
    header: null,
    width: () => undefined,
  };
  return { source, now: () => clock };
}

describe('building a large table for print', () => {
  it('gives the renderer back at least once per slice, and builds the same document', async () => {
    // 0.01 ms a cell × 50 columns: a slice's worth of rows long before the 64-row check, so every check yields.
    const { source, now } = costed(2_000, 50, 0.01);
    let yields = 0;
    const html = await gridPrintHtmlSliced(source, 'big.csv', {
      now,
      yieldToInput: () => {
        yields++;
        return Promise.resolve();
      },
    });
    expect(yields).toBe(Math.floor(2_000 / 64));
    expect(html).toBe(gridPrintHtml(costed(2_000, 50, 0).source, 'big.csv'));
  });

  it('does not finish while it is waiting for the renderer', async () => {
    const { source, now } = costed(200, 50, 1);
    let release: (() => void) | null = null;
    let done = false;
    const build = gridPrintHtmlSliced(source, 'x.csv', {
      now,
      yieldToInput: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    }).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(release).not.toBeNull();
    expect(done).toBe(false);
    // Let every remaining slice through.
    while (!done) {
      const go = release as (() => void) | null;
      release = null;
      go?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    await build;
  });

  it('a small table is built without yielding at all', async () => {
    const { source, now } = costed(100, 5, 0.001);
    let yields = 0;
    await gridPrintHtmlSliced(source, 's.csv', { now, yieldToInput: () => Promise.resolve(void yields++) });
    expect(yields).toBe(0);
    expect(GRID_PRINT_SLICE_MS).toBeGreaterThan(0);
  });
});
