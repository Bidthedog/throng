/**
 * 043 T174/T175 (FR-062, research R26) — the windowing arithmetic at a non-zero zoom level.
 *
 * ══ THE ONE NUMBER, AND WHY IT IS COMPUTED IN JAVASCRIPT ══
 *
 * The results list is windowed on a fixed row height. Five places in `results-list.tsx` divide or
 * multiply by it — `visibleRange`'s two divisions, `maxScrollTop`, the sizer's total height, the
 * mounted window's `translateY`, and the keyboard's scroll-into-view — and a sixth consumer is the
 * STYLESHEET, which reads the same number through `--fif-row-height`.
 *
 * Those two must agree EXACTLY, and that is what forbids the obvious implementation. Scaling the
 * text with `calc()` and letting the height follow — `height: calc(var(--fif-row-height) *
 * var(--throng-zoom-fif))` — hands CSS a fractional pixel (22 × 1.2 = 26.4) which the browser rounds
 * by its own rules, while JavaScript multiplies by the same 1.2 and rounds by ours. The sizer's
 * total is `items.length ×` that number, so a disagreement of half a pixel becomes half a pixel PER
 * ROW: at the 500th row of a long result set the mounted window sits 250 px from where the scroll
 * position says it should be, which is rows overlapping at one end of the range and gaps at the
 * other.
 *
 * So the rounding happens ONCE, in JavaScript, and CSS is told the answer rather than asked to
 * compute it. `terminal-panel.tsx` sets the same precedent for the same reason — it rounds the font
 * size to a whole pixel because xterm measures its own cells and cannot be allowed to disagree with
 * the grid.
 *
 * ══ WHAT THIS TIER CAN AND CANNOT SEE ══
 *
 * `resultRowHeightPx` and `visibleRange` are pure and exported, so the derivation and the slice
 * belong here — no DOM, no component, no jsdom. What needs a rendered tree is that the sizer, the
 * `translateY` and the published custom property all carry that same integer, because all three are
 * written in JSX; `find-in-files-zoom.test.ts` asserts those against this same function.
 */
import { describe, expect, it } from 'vitest';
import { zoomFactor } from '@throng/core';
import {
  RESULT_ROW_HEIGHT_PX,
  resultRowHeightPx,
  visibleRange,
} from '../../src/renderer/find-in-files/results-list.js';

/** Every level `Panel.zoom` can hold — `zoom.ts` clamps to this range. */
const LEVELS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];

describe('the row height is derived once, in JavaScript (FR-062, R26)', () => {
  it('is the unzoomed base at level 0, so RESULT_ROW_HEIGHT_PX keeps its meaning', () => {
    // The constant stops being *the* row height and becomes the base it is derived from. Asserting
    // the identity is what stops a later change quietly making level 0 something else.
    expect(resultRowHeightPx(0)).toBe(RESULT_ROW_HEIGHT_PX);
    expect(zoomFactor(0)).toBe(1);
  });

  it('is a WHOLE number of pixels at every level a panel can hold', () => {
    for (const level of LEVELS) {
      const height = resultRowHeightPx(level);
      expect(Number.isInteger(height), `level ${level} produced ${height}`).toBe(true);
      expect(height, `level ${level} produced a row of no height`).toBeGreaterThan(0);
    }
  });

  it('rounds the product rather than truncating it', () => {
    // Named values, because "it calls Math.round" is a claim about the implementation and this is a
    // claim about the output. 22 × 1.2 = 26.4 rounds DOWN to 26; 22 × 1.44 = 31.68 rounds UP to 32,
    // which a `Math.floor` would give as 31 and pass the integer check above.
    expect(resultRowHeightPx(1)).toBe(26);
    expect(resultRowHeightPx(2)).toBe(32);
    expect(resultRowHeightPx(-1)).toBe(18);
  });

  it('is what CSS would NOT have produced, which is the whole finding', () => {
    // The alternative R26 rejects, written out: the fractional pixel a `calc()` would hand the
    // browser, against the integer both consumers now share.
    const fractional = RESULT_ROW_HEIGHT_PX * zoomFactor(1);
    expect(fractional).not.toBe(Math.round(fractional));
    expect(resultRowHeightPx(1)).toBe(Math.round(fractional));
  });
});

describe('visibleRange slices on the row height it is GIVEN (FR-062, R26)', () => {
  it('reads the argument, not the module constant', () => {
    /*
     * The defect this replaces: `visibleRange` closed over `RESULT_ROW_HEIGHT_PX`, so at any zoom
     * level above 0 it divided the scroll offset by 22 while the rows on screen were 26 or 32 tall.
     * At level +2, a scroll to 3200 px is row 100 of a 32 px list and row 145 of a 22 px one — so
     * the window mounted a slice forty-five rows away from what the user was looking at.
     */
    const atBase = visibleRange(1000, 3200, 480, RESULT_ROW_HEIGHT_PX, 0);
    const atZoom = visibleRange(1000, 3200, 480, resultRowHeightPx(2), 0);
    expect(atBase.start).toBe(Math.floor(3200 / 22));
    expect(atZoom.start).toBe(Math.floor(3200 / 32));
    expect(atZoom.start).not.toBe(atBase.start);
  });

  it('mounts fewer rows for a taller row, over the same viewport', () => {
    const viewport = 480;
    const base = visibleRange(1000, 0, viewport, RESULT_ROW_HEIGHT_PX, 0);
    const zoomed = visibleRange(1000, 0, viewport, resultRowHeightPx(2), 0);
    expect(base.end - base.start).toBe(Math.ceil(viewport / 22) + 1);
    expect(zoomed.end - zoomed.start).toBe(Math.ceil(viewport / 32) + 1);
    expect(zoomed.end).toBeLessThan(base.end);
  });

  it('still keeps the overscan margin and the list bounds it always did', () => {
    // The behaviour the argument must not have disturbed: overscan either side, `start` clamped into
    // the list, and `end` never past its length.
    const height = resultRowHeightPx(2);
    const { start, end } = visibleRange(50, 10 * height, 480, height, 6);
    expect(start).toBe(4);
    expect(end).toBeLessThanOrEqual(50);
    expect(visibleRange(0, 0, 480, height, 6)).toEqual({ start: 0, end: 0 });
    expect(visibleRange(3, 99_999, 480, height, 0).start).toBe(2);
  });
});

describe('the three consumers of the row height cannot disagree (R26)', () => {
  /*
   * The sizer's total, the window's offset and the scroll-into-view target are all `index × the row
   * height`, and the drift R26 is about is what happens when one of them uses a different number
   * from the rest. Stated as an arithmetic identity over the ONE derivation, at the row where the
   * drift would be largest.
   */
  it('agrees at row 500 of a long list, where a half-pixel disagreement would be 250 px', () => {
    const level = 1;
    const height = resultRowHeightPx(level);
    const count = 4000;

    const sizerHeight = count * height;
    const { start } = visibleRange(count, 500 * height, 480, height, 0);
    const offset = start * height;

    expect(start).toBe(500);
    expect(offset).toBe(500 * height);
    expect(sizerHeight % height).toBe(0);

    // And the number the stylesheet is told is that same integer — not the fractional product a
    // `calc()` would give it, which at this row is 250 px of accumulated error.
    const fractional = RESULT_ROW_HEIGHT_PX * zoomFactor(level);
    expect(Math.abs(500 * fractional - offset)).toBeCloseTo(500 * Math.abs(fractional - height), 6);
    expect(500 * Math.abs(fractional - height)).toBeGreaterThan(100);
  });
});
