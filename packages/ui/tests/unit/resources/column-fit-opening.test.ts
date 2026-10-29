/**
 * Where the divider opens (055 FR-116): without a restored position, the left column is wide enough for
 * every figure column beside the name column's minimum, and the right column keeps its minimum.
 *
 * Layer: unit — arithmetic only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAME_COLUMN_MIN_WIDTH } from '@throng/core';
import { DIVIDER_PX, FIGURE_FIT_WIDTH_PX, SCROLLBAR_SLACK_PX, openingSplitRatio } from '../../../src/renderer/resources/use-column-fit.js';
import { SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN } from '../../../src/renderer/resources/monitor-session.js';

describe('FIGURE_FIT_WIDTH_PX', () => {
  it('holds the name column\'s minimum and all five figure columns', () => {
    expect(FIGURE_FIT_WIDTH_PX).toBeGreaterThan(NAME_COLUMN_MIN_WIDTH + 5 * 56);
  });
});

describe('openingSplitRatio', () => {
  it('gives the left column exactly the room it needs, rounded up to a whole percent', () => {
    // The left column is its share of what is left AFTER the divider's own track, not of the whole width.
    const ratio = openingSplitRatio(1000);
    expect(ratio * (1000 - DIVIDER_PX)).toBeGreaterThanOrEqual(FIGURE_FIT_WIDTH_PX);
    expect(ratio * (1000 - DIVIDER_PX)).toBeLessThan(FIGURE_FIT_WIDTH_PX + 10);
  });

  it('is enough at the width where the divider track made it fall short (1064px, Network dropped)', () => {
    for (const width of [1064, 1000, 1200, 900, 1500]) {
      const ratio = openingSplitRatio(width);
      if (ratio < SPLIT_MAX) expect(ratio * (width - DIVIDER_PX), `${width}px`).toBeGreaterThanOrEqual(FIGURE_FIT_WIDTH_PX);
    }
  });

  it('names the divider track the stylesheet really has', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8');
    const columns = /\.monitor-body__columns\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(columns).toMatch(new RegExp(`var\\(--monitor-split-left[^)]*\\)\\)?\\s+${DIVIDER_PX}px\\s+minmax`));
  });

  it('keeps slack for the scrollbar a list that scrolls now shows', () => {
    expect(FIGURE_FIT_WIDTH_PX).toBeGreaterThanOrEqual(NAME_COLUMN_MIN_WIDTH + 5 * 56 + SCROLLBAR_SLACK_PX);
  });

  it('is clamped so the right column keeps its minimum', () => {
    expect(openingSplitRatio(FIGURE_FIT_WIDTH_PX)).toBe(SPLIT_MAX);
    expect(openingSplitRatio(100)).toBe(SPLIT_MAX);
  });

  it('never goes below the left column\'s own minimum on a very wide window', () => {
    expect(openingSplitRatio(100_000)).toBe(SPLIT_MIN);
  });

  it('falls back to the default where there is no width to measure', () => {
    expect(openingSplitRatio(0)).toBe(SPLIT_DEFAULT);
    expect(openingSplitRatio(Number.NaN)).toBe(SPLIT_DEFAULT);
  });
});
