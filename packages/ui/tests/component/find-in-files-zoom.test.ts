/**
 * 043 T176/T177 (FR-062, research R26) — the panel honours its own zoom, in text AND in metrics.
 *
 * ══ THE TWO HALVES, AND WHY NEITHER WORKS ALONE ══
 *
 * Zoom is already stored per panel and already routed to whichever panel is active; only the drawing
 * was missing. Drawing it means two different things here:
 *
 *   - the TEXT scales through a custom property the stylesheet multiplies with, exactly as
 *     `editor-panel.tsx` + `editor.css` already do;
 *   - the ROW HEIGHT scales as a whole number of pixels computed in JavaScript, because the results
 *     list is windowed on it.
 *
 * Scaling only the text overflows a 22 px row at level +1 — the spec calls that "breaks the
 * windowing arithmetic rather than merely looking wrong". Scaling the height in CSS with a `calc()`
 * hands the browser 26.4 px to round by its own rules while the arithmetic rounds by ours, and the
 * sizer multiplies that disagreement by the row index. So there is one rounded integer, computed
 * once in `resultRowHeightPx`, and CSS is TOLD it.
 *
 * ══ WHY THE STYLESHEET IS READ AS TEXT AND THE METRICS ARE READ FROM THE DOM ══
 *
 * jsdom does not resolve `var()` through the cascade, so `getComputedStyle(el).fontSize` on a rule
 * reading `var(--throng-font-paneText-size)` proves nothing either way — `find-in-files-typography.
 * test.ts` sets out that reasoning at length and this file follows it. What CAN be read exactly is
 * an INLINE style, because the component writes it: the published zoom factor, the published row
 * height, the sizer's height and the window's transform are all written by `results-list.tsx` and
 * `find-in-files-panel.tsx` into `style`, so every number this file asserts is a number the
 * application computed rather than one a browser resolved.
 */
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zoomFactor } from '@throng/core';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  RESULT_ROW_HEIGHT_PX,
  resultRowHeightPx,
} from '../../src/renderer/find-in-files/results-list.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

let bridge: FileSearchStub;

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

/** Render at `zoom` and deliver `count` matches, so the list has a real extent to measure. */
function withRows(zoom: number, count: number): void {
  renderFindInFilesPanel({ zoom });
  bridge.emit({
    panelId: PANEL_ID,
    generation: 1,
    status: 'complete',
    rows: Array.from({ length: count }, (_, i) => resultRow('src/big.ts', i + 1, i * 10)),
    totalMatches: count,
  });
}

const panelEl = (): HTMLElement => screen.getByTestId(`fif-panel-${PANEL_ID}`);
const resultsEl = (): HTMLElement => screen.getByTestId(`fif-results-${PANEL_ID}`);
const sizerEl = (): HTMLElement => screen.getByTestId(`fif-sizer-${PANEL_ID}`);
const windowEl = (): HTMLElement =>
  sizerEl().querySelector('.fif-results__window') as HTMLElement;

/* ────────────────────────────────────────────────────────────────────────── *
 * The text half
 * ────────────────────────────────────────────────────────────────────────── */

describe('the panel’s text scales with the panel’s own zoom level (FR-062)', () => {
  it('publishes the zoom FACTOR on the panel container', () => {
    renderFindInFilesPanel({ zoom: 2 });
    expect(panelEl().style.getPropertyValue('--throng-zoom-fif')).toBe(String(zoomFactor(2)));
  });

  it('publishes 1 at level 0, so an unzoomed panel renders exactly as it did', () => {
    renderFindInFilesPanel();
    expect(panelEl().style.getPropertyValue('--throng-zoom-fif')).toBe('1');
  });

  it('publishes a factor below 1 when the panel is zoomed OUT', () => {
    renderFindInFilesPanel({ zoom: -2 });
    const published = Number(panelEl().style.getPropertyValue('--throng-zoom-fif'));
    expect(published).toBeGreaterThan(0);
    expect(published).toBeLessThan(1);
  });


});

/* ────────────────────────────────────────────────────────────────────────── *
 * The metrics half
 * ────────────────────────────────────────────────────────────────────────── */

describe('the row metrics scale by the SAME rounded integer (FR-062, R26)', () => {
  // DELETED: 'publishes the rounded row height to the stylesheet' — 'agrees across all three' below
  // asserts `--fif-row-height` is `${resultRowHeightPx(level)}px`.

  it('is the unzoomed base at level 0', () => {
    withRows(0, 40);
    expect(resultsEl().style.getPropertyValue('--fif-row-height')).toBe(
      `${RESULT_ROW_HEIGHT_PX}px`,
    );
  });

  it('sizes the scroller’s full extent from that same integer', () => {
    const count = 400;
    withRows(2, count);
    // One heading plus `count` rows — the flattened list, which is what the sizer measures.
    const items = resultsEl().querySelectorAll('.fif-group').length === 0 ? count : count + 1;
    expect(sizerEl().style.height).toBe(`${items * resultRowHeightPx(2)}px`);
  });

  // DELETED: 'offsets the mounted window by a whole multiple of it' — 'agrees across all three' below
  // asserts the translateY is a multiple of the integer row height (so a whole number of px).

  it('agrees across all three, so the sheet and the arithmetic cannot drift apart', () => {
    /*
     * The claim R26 is actually about, in one assertion. The published height, the sizer's total and
     * the window's offset are read back from the DOM the component produced and reduced to the one
     * integer they must all be built from. A `calc()` in the stylesheet would satisfy the first of
     * these and break the other two, at a rate of the rounding error PER ROW.
     */
    const level = 1;
    withRows(level, 400);
    const height = resultRowHeightPx(level);

    expect(resultsEl().style.getPropertyValue('--fif-row-height')).toBe(`${height}px`);
    expect(Number(/^(\d+)px$/.exec(sizerEl().style.height)?.[1]) % height).toBe(0);
    expect(
      Number(/translateY\((-?[\d.]+)px\)/.exec(windowEl().style.transform)?.[1]) % height,
    ).toBe(0);

    // And the number is NOT the fractional product CSS would have produced.
    expect(height).not.toBe(RESULT_ROW_HEIGHT_PX * zoomFactor(level));
  });

});
