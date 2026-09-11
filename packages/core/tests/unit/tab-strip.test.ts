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

  it('moves exactly one tab leftwards from a tab boundary', () => {
    // Window [200,450]: tabs 0 and 1 are fully hidden, tab 2 starts exactly on the edge.
    const m = strip([100, 100, 100, 100, 100, 100], 200, 250);
    expect(stripCounts(m).hiddenLeft).toBe(2);
    const target = stepTarget(m, 'left');
    expect(target).toBe(100); // tab 1's left edge
    expect(stripCounts({ ...m, scrollLeft: target! }).hiddenLeft).toBe(1);
  });

  /*
   * #382 supersedes S3 here. A step from part-way into a tab used to skip the tab it had cut off and
   * land on the one before it (0, from 150). It now completes the cut-off tab first: the nearest tab
   * start behind the strip — the same rule that lets a strip scrolled a few pixels step back at all.
   */
  it('steps leftwards from a position that straddles a tab boundary to the start of the cut-off tab', () => {
    // Window [150,400]: tab 0 [0,100] is fully hidden, tab 1 [100,200] straddles.
    const m = strip([100, 100, 100, 100, 100, 100], 150, 250);
    expect(stripCounts(m).hiddenLeft).toBe(1);
    expect(stepTarget(m, 'left')).toBe(100);
    expect(stepTarget({ ...m, scrollLeft: 100 }, 'left')).toBe(0);
  });

  it('never scrolls past the end of the content', () => {
    // [0,240] [240,340] [340,440] in a 250 viewport: max scrollLeft is 440-250 = 190,
    // so stepping right cannot put tab 1 (left 240) flush with the left edge.
    const m = strip([240, 100, 100], 0, 250);
    expect(stripCounts(m).hiddenRight).toBe(1);
    expect(stepTarget(m, 'right')).toBe(190);
  });

  /*
   * #382 supersedes the edge case that made these inert. Scrolled into the middle of one over-wide
   * tab there IS more of it each way, and stepping reveals it — the start, or the end.
   */
  it('steps to either end of a single tab wider than the viewport (S6)', () => {
    const m = strip([500], 200, 200);
    expect(stepTarget(m, 'left')).toBe(0);
    expect(stepTarget(m, 'right')).toBe(300);
    expect(stepTarget({ ...m, scrollLeft: 0 }, 'left'), 'nothing further left at the start').toBeNull();
    expect(stepTarget({ ...m, scrollLeft: 300 }, 'right'), 'nothing further right at the end').toBeNull();
  });

  it('returns null for an empty strip', () => {
    expect(stepTarget(strip([], 0, 250), 'left')).toBeNull();
    expect(stepTarget(strip([], 0, 250), 'right')).toBeNull();
  });
});

/*
 * #382. Reported: click the partly-visible right-most tab and the strip shifts a few pixels to reveal it.
 * Tab 0 is now cut off on the left and the left fade is showing — but step-left is disabled, and
 * stays disabled until a whole tab has scrolled past. S4 says there is nothing to reveal that way
 * because no tab is ENTIRELY hidden; there is — the part of tab 0 the strip scrolled over.
 */
describe('stepping back from a strip that has moved by less than one tab', () => {
  it('steps left to the start when the first tab is only partly hidden', () => {
    // Window [30,280]: tab 0 [0,100] is cut off by 30px on the left, and nothing is fully hidden.
    const m = strip([100, 100, 100, 100, 100, 100], 30, 250);
    expect(stripCounts(m).hiddenLeft).toBe(0);
    expect(stepTarget(m, 'left'), 'the strip has moved, so it can be stepped back').toBe(0);
  });

  it('steps right to the end when the last tab is only partly hidden', () => {
    // Window [330,580]: tab 5 [500,600] is cut off by 20px on the right, and nothing is fully hidden.
    const m = strip([100, 100, 100, 100, 100, 100], 330, 250);
    expect(stripCounts(m).hiddenRight).toBe(0);
    expect(stepTarget(m, 'right'), 'there is more strip to the right').toBe(350);
  });
});

/*
 * #382. Reported: a tab brought into view lands flush with the viewport edge, so the edge fade paints over
 * it. The fades are 24px overlays at the track's edges (theme.css `.tab-strip::before/::after`), and
 * they show whenever the strip is not at that end.
 */
describe('a revealed tab is clear of the edge fade', () => {
  const EDGE_FADE = 24;
  const faded = (widths: number[], scrollLeft: number, viewportWidth: number): StripMetrics => ({
    ...strip(widths, scrollLeft, viewportWidth),
    edgeInset: EDGE_FADE,
  });

  it('brings a tab hidden to the right clear of the right-hand fade', () => {
    const m = faded([100, 100, 100, 100, 100, 100], 0, 250);
    const target = revealTarget(m, 3)!;
    expect(target + 250, 'the strip is not at its end, so the right fade is showing').toBeLessThan(600);
    expect(m.tabOffsets[3]!.right).toBeLessThanOrEqual(target + 250 - EDGE_FADE);
  });

  it('brings a tab hidden to the left clear of the left-hand fade', () => {
    const m = faded([100, 100, 100, 100, 100, 100], 350, 250);
    const target = revealTarget(m, 2)!;
    expect(target, 'the strip is not at its start, so the left fade is showing').toBeGreaterThan(0);
    expect(m.tabOffsets[2]!.left).toBeGreaterThanOrEqual(target + EDGE_FADE);
  });

  it('moves for a tab that is inside the viewport but under a fade', () => {
    // Window [110,360]: the left fade covers [110,134], so tab 1 [100,200] has its start under it.
    const m = faded([100, 100, 100, 100, 100, 100], 110, 250);
    expect(revealTarget(m, 1)).toBe(76);
  });

  it('does not move for a tab clear of both fades (S5)', () => {
    // Window [76,326]: clear region [100,302]. Tab 1 [100,200] is inside it.
    const m = faded([100, 100, 100, 100, 100, 100], 76, 250);
    expect(revealTarget(m, 1)).toBeNull();
  });

  it('needs no clearance at the start or the end, where no fade is drawn', () => {
    const atStart = faded([100, 100, 100, 100, 100, 100], 350, 250);
    expect(revealTarget(atStart, 0)).toBe(0);
    const atEnd = faded([100, 100, 100, 100, 100, 100], 0, 250);
    expect(revealTarget(atEnd, 5)).toBe(350);
  });
});

describe('a step lands its tab clear of the left fade', () => {
  const faded = (scrollLeft: number): StripMetrics => ({
    ...strip([100, 100, 100, 100, 100, 100], scrollLeft, 250),
    edgeInset: 24,
  });

  it('steps right to the next tab, its start clear of the fade', () => {
    expect(stepTarget(faded(0), 'right')).toBe(76); // tab 1 at 100, the fade over [76,100]
    expect(stepTarget(faded(76), 'right')).toBe(176);
  });

  it('steps back the same way it came', () => {
    expect(stepTarget(faded(176), 'left')).toBe(76);
    expect(stepTarget(faded(76), 'left')).toBe(0);
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
