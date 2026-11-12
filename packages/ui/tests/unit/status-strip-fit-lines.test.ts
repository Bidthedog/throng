/**
 * 067 T102 (FR-096, FR-097) — the total-lines segment in the status bar's form table and hide order.
 *
 * `lines` joins the readouts between `selected` and `chars` on screen, with the forms `lines` and
 * `lns`, and goes after total words and total characters when the bar gives way:
 * words → chars → LINES → selected → column → line.
 */
import { describe, expect, it } from 'vitest';
import {
  HIDE_ORDER,
  READOUT_LABELS,
  READOUT_ORDER,
  fitReadouts,
  labelShortens,
  type SegmentId,
  type SegmentWidth,
} from '../../src/renderer/editor/status-strip-fit.js';

const widths = (): Partial<Record<SegmentId, SegmentWidth>> => ({
  line: { full: 10, short: 10 },
  column: { full: 10, short: 10 },
  selected: { full: 10, short: 5 },
  lines: { full: 10, short: 5 },
  chars: { full: 10, short: 5 },
  words: { full: 10, short: 5 },
});

describe('the form table (FR-096)', () => {
  it('names the full form `lines` and the short form `lns`, and the label does shorten', () => {
    expect(READOUT_LABELS.lines).toEqual({ full: 'Lines.', short: 'Lns.' });
    expect(labelShortens('lines')).toBe(true);
  });

  it('sits between selected and chars on screen', () => {
    expect([...READOUT_ORDER]).toEqual(['line', 'column', 'selected', 'lines', 'chars', 'words']);
  });
});

describe('the hide order (FR-097)', () => {
  it('is total words, total characters, total lines, selected characters, column, line', () => {
    expect([...HIDE_ORDER].slice(0, 6)).toEqual(['words', 'chars', 'lines', 'selected', 'column', 'line']);
    // …and the format indicators of 059 still outlast every readout.
    expect([...HIDE_ORDER].slice(6)).toEqual(['lineEnding', 'encoding']);
  });

  it('drops the segments in exactly that order as the bar narrows, and never brings one back out of turn', () => {
    const goneAt = new Map<SegmentId, number>();
    let previous = new Set<SegmentId>(fitReadouts({ available: 1000, widths: widths(), gap: 2 }).segments.map((s) => s.id));
    expect([...previous]).toEqual(['line', 'column', 'selected', 'lines', 'chars', 'words']);
    for (let available = 1000; available >= 0; available -= 1) {
      const now = new Set(fitReadouts({ available, widths: widths(), gap: 2 }).segments.map((s) => s.id));
      for (const id of previous) if (!now.has(id)) goneAt.set(id, available);
      previous = now;
    }
    const byDisappearance = [...goneAt.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    expect(byDisappearance).toEqual(['words', 'chars', 'lines', 'selected', 'column', 'line']);
  });

  it('shortens `lines` to `lns` before hiding any segment', () => {
    // 6 segments x 10 + 5 gaps x 2 = 70 full. With words, chars, lines and selected short: 55.
    const at = (available: number) => fitReadouts({ available, widths: widths(), gap: 2 });
    expect(at(70).segments.every((s) => s.label === 'full')).toBe(true);
    const tight = at(55);
    expect(tight.segments.map((s) => s.id)).toHaveLength(6);
    expect(tight.segments.find((s) => s.id === 'lines')?.label).toBe('short');
  });
});
