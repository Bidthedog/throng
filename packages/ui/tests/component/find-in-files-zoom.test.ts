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
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

const PANEL_CSS = resolve(
  process.cwd(),
  'packages/ui/src/renderer/find-in-files/find-in-files.css',
);

const sheet = (): string => {
  expect(existsSync(PANEL_CSS), `${PANEL_CSS} was not found`).toBe(true);
  return readFileSync(PANEL_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
};

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

  it('multiplies the Pane Text size by it in the stylesheet', () => {
    // The role still decides the BASE (FR-064): this multiplies the role's own variable rather than
    // restating a size, so a user who changes Pane Text still changes this panel's text.
    expect(sheet()).toMatch(
      /font-size:\s*calc\(\s*var\(--throng-font-paneText-size\)\s*\*\s*var\(--throng-zoom-fif[^)]*\)\s*\)/,
    );
  });

  it('does so from a selector that outranks the role rule, not one that ties with it', () => {
    /*
     * ══ THE CASCADE FACT THIS RULE EXISTS INSIDE, AND WHY THE SELECTOR IS DOUBLED ══
     *
     * `theme.css` hands `.fif-panel` the Pane Text role, and `theme.css` is imported LAST in
     * `main.tsx` while this sheet arrives through the component graph — so in the built bundle the
     * role rule comes AFTER everything here. Two rules of equal specificity are settled by document
     * order, so a plain `.fif-panel { font-size: … }` in this file would lose to the role rule and
     * do nothing at all.
     *
     * That is not a hypothetical: it is precisely the defect FR-079 has just removed from this same
     * sheet — `.fif-btn`'s `font-size: 12px`, a declaration that read as the obvious place to change
     * something and governed nothing. A zoom that silently did not apply would be the same failure
     * with a requirement behind it.
     *
     * `.fif-panel.fif-panel` is one element, twice named: same subject, specificity (0,2,0), and no
     * dependence on which sheet a bundler happens to emit first. It is asserted here rather than
     * only explained in the sheet, because a later tidy-up to the "obvious" single class would leave
     * every text assertion in this file passing.
     */
    expect(
      sheet(),
      'the zoom rule must outrank theme.css’s Pane Text rule, which is emitted after this sheet',
    ).toMatch(/\.fif-panel\.fif-panel\s*\{/);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The metrics half
 * ────────────────────────────────────────────────────────────────────────── */

describe('the row metrics scale by the SAME rounded integer (FR-062, R26)', () => {
  it('publishes the rounded row height to the stylesheet', () => {
    withRows(2, 40);
    expect(resultsEl().style.getPropertyValue('--fif-row-height')).toBe(
      `${resultRowHeightPx(2)}px`,
    );
  });

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

  it('offsets the mounted window by a whole multiple of it, never a fraction', () => {
    withRows(2, 400);
    const transform = windowEl().style.transform;
    const px = Number(/translateY\((-?[\d.]+)px\)/.exec(transform)?.[1]);
    expect(Number.isInteger(px), `translateY was ${transform}`).toBe(true);
    expect(px % resultRowHeightPx(2)).toBe(0);
  });

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

  it('asks the stylesheet to compute no row height of its own', () => {
    /*
     * The negative half, and the one that makes the rule enforceable rather than a convention: the
     * sheet may READ `--fif-row-height`, and it may not multiply it. A `calc(var(--fif-row-height) *
     * var(--throng-zoom-fif))` anywhere here would give the browser a second rounding authority over
     * a number the arithmetic has already rounded.
     */
    const offenders = [...sheet().matchAll(/calc\([^;{}]*--fif-row-height[^;{}]*\)/g)].map(
      (m) => m[0],
    );
    expect(offenders, 'CSS is told the row height, never asked to compute it (R26)').toEqual([]);
  });
});
