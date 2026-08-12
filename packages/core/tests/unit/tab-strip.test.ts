import { describe, it, expect } from 'vitest';
import {
  stripCounts,
  stepTarget,
  revealTarget,
  ease,
  type StripMetrics,
} from '../../src/workspace/tab-strip.js';

// 031 US3 (contracts/tab-strip.md §2, S1–S6, A4, A5): the tab strip's geometry as
// pure arithmetic. No DOM: the renderer measures, this decides. Offsets are content
// coordinates (a tab's offsetLeft and offsetLeft+offsetWidth within the track), and
// the viewport shows [scrollLeft, scrollLeft + viewportWidth].

function strip(widths: number[], scrollLeft: number, viewportWidth: number): StripMetrics {
  let x = 0;
  const tabOffsets = widths.map((w) => {
    const left = x;
    x += w;
    return { left, right: x };
  });
  return { tabOffsets, scrollLeft, viewportWidth };
}

describe('stripCounts (S1)', () => {
  it('reports nothing hidden and no overflow when every tab fits', () => {
    expect(stripCounts(strip([100, 100, 100], 0, 400))).toEqual({
      hiddenLeft: 0,
      hiddenRight: 0,
      total: 3,
      overflowing: false,
    });
  });

  it('counts the tabs fully hidden past the right edge', () => {
    // 6x100 = 600 of content in a 250 viewport at the start: [0,250] is shown, so
    // the tabs at 300, 400 and 500 are fully hidden and the one at 200 is not.
    expect(stripCounts(strip([100, 100, 100, 100, 100, 100], 0, 250))).toEqual({
      hiddenLeft: 0,
      hiddenRight: 3,
      total: 6,
      overflowing: true,
    });
  });

  it('counts each side when scrolled into the middle', () => {
    // Window [250,500]: tabs 0 and 1 end at or before 250; tab 5 starts at 500.
    expect(stripCounts(strip([100, 100, 100, 100, 100, 100], 250, 250))).toEqual({
      hiddenLeft: 2,
      hiddenRight: 1,
      total: 6,
      overflowing: true,
    });
  });

  it('counts a partly-visible tab on NEITHER side', () => {
    // Window [50,200]. Tab 0 [0,100] straddles the left edge: it is not hidden left,
    // and it is obviously not hidden right either.
    const counts = stripCounts(strip([100, 100, 100, 100], 50, 150));
    expect(counts.hiddenLeft).toBe(0);
    expect(counts.hiddenRight).toBe(2);
    expect(counts.total).toBe(4);
  });

  it('treats a tab that ends exactly on the left edge as hidden, and one that starts exactly on the right edge as hidden', () => {
    const counts = stripCounts(strip([100, 100, 100], 100, 100));
    expect(counts.hiddenLeft).toBe(1); // tab 0 ends at exactly 100
    expect(counts.hiddenRight).toBe(1); // tab 2 starts at exactly 200
  });

  it('reports nothing at all for an empty strip', () => {
    expect(stripCounts(strip([], 0, 250))).toEqual({
      hiddenLeft: 0,
      hiddenRight: 0,
      total: 0,
      overflowing: false,
    });
  });
});

describe('stripCounts with one tab wider than the viewport (S6)', () => {
  it('overflows with nothing hidden either side at the start', () => {
    expect(stripCounts(strip([500], 0, 200))).toEqual({
      hiddenLeft: 0,
      hiddenRight: 0,
      total: 1,
      overflowing: true,
    });
  });

  it('still hides nothing either side when scrolled into the middle of that tab', () => {
    const counts = stripCounts(strip([500], 300, 200));
    expect(counts.hiddenLeft).toBe(0);
    expect(counts.hiddenRight).toBe(0);
    expect(counts.overflowing).toBe(true);
  });

  it('counts the neighbours of an over-wide tab normally', () => {
    // [0,50] [50,550] [550,600] in a 200 viewport at 300: window [300,500].
    const counts = stripCounts(strip([50, 500, 50], 300, 200));
    expect(counts).toEqual({ hiddenLeft: 1, hiddenRight: 1, total: 3, overflowing: true });
  });
});

describe('stepTarget (S3, S4)', () => {
  it('returns null in both directions when the strip does not overflow', () => {
    const m = strip([100, 100, 100], 0, 400);
    expect(stepTarget(m, 'left')).toBeNull();
    expect(stepTarget(m, 'right')).toBeNull();
  });

  it('returns null leftwards when nothing is hidden to the left', () => {
    expect(stepTarget(strip([100, 100, 100, 100, 100, 100], 0, 250), 'left')).toBeNull();
  });

  it('returns null rightwards when nothing is hidden to the right', () => {
    // Window [350,600] shows the last two and a half tabs; nothing is fully hidden right.
    const m = strip([100, 100, 100, 100, 100, 100], 350, 250);
    expect(stripCounts(m).hiddenRight).toBe(0);
    expect(stepTarget(m, 'right')).toBeNull();
  });

  it('moves exactly one tab rightwards, landing it flush with the left edge', () => {
    const m = strip([100, 100, 100, 100, 100, 100], 0, 250);
    const target = stepTarget(m, 'right');
    expect(target).toBe(100); // tab 1's left edge
    // Exactly one tab moved out of view on the left.
    expect(stripCounts({ ...m, scrollLeft: target! }).hiddenLeft).toBe(1);
  });

  it('steps one tab at a time on repeated presses', () => {
    const m = strip([100, 100, 100, 100, 100, 100], 0, 250);
    const first = stepTarget(m, 'right')!;
    const second = stepTarget({ ...m, scrollLeft: first }, 'right')!;
    expect(first).toBe(100);
    expect(second).toBe(200);
  });

  it('moves exactly one tab leftwards, landing the newly revealed tab flush with the left edge', () => {
    const m = strip([100, 100, 100, 100, 100, 100], 250, 250);
    expect(stripCounts(m).hiddenLeft).toBe(2);
    const target = stepTarget(m, 'left');
    expect(target).toBe(100); // tab 1's left edge — the last one fully hidden left
    expect(stripCounts({ ...m, scrollLeft: target! }).hiddenLeft).toBe(1);
  });

  it('steps leftwards from a position that straddles a tab boundary', () => {
    // Window [150,400]: tab 0 [0,100] is fully hidden, tab 1 [100,200] straddles.
    const m = strip([100, 100, 100, 100, 100, 100], 150, 250);
    expect(stripCounts(m).hiddenLeft).toBe(1);
    expect(stepTarget(m, 'left')).toBe(0);
  });

  it('never scrolls past the end of the content', () => {
    // [0,240] [240,340] [340,440] in a 250 viewport: max scrollLeft is 440-250 = 190,
    // so stepping right cannot put tab 1 (left 240) flush with the left edge.
    const m = strip([240, 100, 100], 0, 250);
    expect(stripCounts(m).hiddenRight).toBe(1);
    expect(stepTarget(m, 'right')).toBe(190);
  });

  it('is inert in both directions for a single tab wider than the viewport (S6)', () => {
    const m = strip([500], 200, 200);
    expect(stepTarget(m, 'left')).toBeNull();
    expect(stepTarget(m, 'right')).toBeNull();
  });

  it('returns null for an empty strip', () => {
    expect(stepTarget(strip([], 0, 250), 'left')).toBeNull();
    expect(stepTarget(strip([], 0, 250), 'right')).toBeNull();
  });
});

describe('revealTarget (S5)', () => {
  it('returns null for an already fully visible tab, so the strip does not move', () => {
    const m = strip([100, 100, 100, 100, 100, 100], 0, 250);
    expect(revealTarget(m, 0)).toBeNull();
    expect(revealTarget(m, 1)).toBeNull();
  });

  it('returns null for every tab when nothing overflows', () => {
    const m = strip([100, 100, 100], 0, 400);
    for (let i = 0; i < 3; i += 1) expect(revealTarget(m, i)).toBeNull();
  });

  it('brings a tab hidden to the right flush with the RIGHT edge', () => {
    const m = strip([100, 100, 100, 100, 100, 100], 0, 250);
    expect(revealTarget(m, 3)).toBe(150); // 400 - 250
    expect(revealTarget(m, 5)).toBe(350); // 600 - 250
  });

  it('brings a tab hidden to the left flush with the LEFT edge', () => {
    const m = strip([100, 100, 100, 100, 100, 100], 250, 250);
    expect(revealTarget(m, 0)).toBe(0);
    expect(revealTarget(m, 1)).toBe(100);
  });

  it('moves for a tab that is only partly visible', () => {
    const m = strip([100, 100, 100, 100], 50, 150);
    expect(revealTarget(m, 0)).toBe(0); // straddles the left edge
    const right = strip([100, 100, 100, 100], 0, 150);
    expect(revealTarget(right, 1)).toBe(50); // [100,200] straddles the right edge: 200 - 150
  });

  it('shows the START of a tab wider than the viewport', () => {
    const m = strip([50, 500, 50], 0, 200);
    expect(revealTarget(m, 1)).toBe(50);
  });

  it('never scrolls past either end of the content', () => {
    const m = strip([100, 100, 100, 100, 100, 100], 0, 250);
    const target = revealTarget(m, 5)!;
    expect(target).toBeLessThanOrEqual(600 - 250);
    expect(revealTarget(strip([100, 100, 100, 100, 100, 100], 600 - 250, 250), 0)).toBe(0);
  });

  it('returns null for an index that is not a tab', () => {
    const m = strip([100, 100, 100, 100, 100, 100], 0, 250);
    expect(revealTarget(m, -1)).toBeNull();
    expect(revealTarget(m, 6)).toBeNull();
    expect(revealTarget(m, 1.5)).toBeNull();
    expect(revealTarget(strip([], 0, 250), 0)).toBeNull();
  });
});

describe('ease (A4, A5)', () => {
  it('starts at 0 and ends at 1', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it('is symmetric about the midpoint', () => {
    expect(ease(0.5)).toBeCloseTo(0.5, 10);
    for (const t of [0.1, 0.25, 0.4]) {
      expect(ease(t) + ease(1 - t)).toBeCloseTo(1, 10);
    }
  });

  it('is monotonically increasing over [0,1]', () => {
    let previous = ease(0);
    for (let i = 1; i <= 100; i += 1) {
      const value = ease(i / 100);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it('accelerates from rest and decelerates to a stop, rather than sliding at a constant speed', () => {
    const steps = 100;
    const deltas: number[] = [];
    for (let i = 0; i < steps; i += 1) {
      deltas.push(ease((i + 1) / steps) - ease(i / steps));
    }
    // Speed rises through the first half...
    for (let i = 1; i < steps / 2; i += 1) {
      expect(deltas[i]).toBeGreaterThan(deltas[i - 1]);
    }
    // ...and falls through the second.
    for (let i = steps / 2 + 1; i < steps; i += 1) {
      expect(deltas[i]).toBeLessThan(deltas[i - 1]);
    }
    // A constant-speed slide would put the quarter marks on the diagonal.
    expect(ease(0.25)).toBeLessThan(0.25);
    expect(ease(0.75)).toBeGreaterThan(0.75);
  });

  it('clamps outside [0,1] so a late or early frame cannot overshoot', () => {
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    expect(ease(Number.NaN)).toBe(0);
  });
});
