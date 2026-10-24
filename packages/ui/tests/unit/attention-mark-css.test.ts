/**
 * 057 FR-093, FR-094 — the mark blinks slowly and holds still under reduced motion; the highlighted
 * project row's colour dot is ringed so it reads against the fill.
 *
 * jsdom evaluates neither `@keyframes` nor `prefers-reduced-motion`, so — as `split-mode-pulse-css.test.ts`
 * does for 048 — the claims are asserted on the stylesheet text, which is where they are made.
 *
 * ANTI-VACUITY CONTROL: drop the mark's `animation` and the blink test fails; give it the unsaved dot's
 * 1.5 s and the "slower" test fails; drop it from the reduced-motion blocks and that test fails; put the
 * ring back to 1px and the ring test fails.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../src/renderer/theme.css'), 'utf8');

/** The body of the first rule or at-rule whose prelude is exactly `prelude`. */
function blockOf(source: string, prelude: string): string {
  const at = source.indexOf(`${prelude} {`);
  expect(at, `theme.css has no \`${prelude} {\``).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = at + prelude.length + 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(at + prelude.length + 2, i);
    }
  }
  throw new Error(`unbalanced block for ${prelude}`);
}

/** Every `@media (prefers-reduced-motion: reduce)` block's body. */
function reducedMotionBlocks(): string[] {
  return [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{/g)].map((m) => {
    const start = m.index! + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}') depth--;
    }
    return css.slice(start, i - 1);
  });
}

/** Seconds from an `animation` shorthand's first duration. */
function durationOf(rule: string): number {
  const m = /animation:\s*[\w-]+\s+([\d.]+)(m?s)/.exec(rule);
  expect(m, 'the rule declares an animation with a duration').not.toBeNull();
  return m![2] === 'ms' ? Number(m![1]) / 1000 : Number(m![1]);
}

describe('the attention mark blinks slowly (FR-093)', () => {
  it('animates opacity and nothing else', () => {
    const rule = blockOf(css, '.throng-attention-mark');
    const name = /animation:\s*([\w-]+)/.exec(rule)?.[1];
    expect(name, 'the mark names its keyframes').toBeTruthy();
    const frames = blockOf(css, `@keyframes ${name}`);
    const properties = new Set([...frames.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]));
    expect(properties).toEqual(new Set(['opacity']));
  });

  it('cycles every 2 s, slower than the unsaved dot, and well under three times a second', () => {
    const mark = durationOf(blockOf(css, '.throng-attention-mark'));
    const unsaved = durationOf(blockOf(css, '.throng-unsaved-dot'));
    expect(mark).toBe(2);
    expect(mark).toBeGreaterThan(unsaved);
  });

  it('holds still at full opacity under prefers-reduced-motion', () => {
    const block = reducedMotionBlocks().find((b) => /\.throng-attention-mark\b/.test(b));
    expect(block, 'a reduced-motion block covers the mark').toBeDefined();
    const rule = blockOf(block!, '.throng-attention-mark');
    expect(rule).toMatch(/animation:\s*none/);
    expect(rule).toMatch(/opacity:\s*1\b/);
  });
});

describe('the mark is one circle, the colour dot’s size (FR-092, FR-135, FR-137, FR-138)', () => {
  // The leading newline keeps `.project-item--active .project-item__dot {` from matching first.
  const dot = (): string => blockOf(css, '\n.project-item__dot');
  const slot = (): string => blockOf(css, '.project-item__switch > .throng-attention-mark');
  const mark = (): string => blockOf(css, '.throng-attention-mark');
  const px = (rule: string, prop: string): number | null => {
    const m = new RegExp(`(?:^|[\\s;])${prop}:\\s*(-?[\\d.]+)px`).exec(rule);
    return m ? Number(m[1]) : null;
  };

  it('the colour dot and the circle are both 14px, so marking a row never moves its name (FR-137)', () => {
    for (const rule of [dot(), mark(), slot()]) {
      expect(px(rule, 'width')).toBe(14);
      expect(px(rule, 'height')).toBe(14);
    }
  });

  it('carries no margin of its own on a row and does not shrink or grow in the flex row', () => {
    expect(slot()).toMatch(/margin:\s*0\s*;/);
    expect(slot()).toMatch(/flex:\s*0\s+0\s+auto/);
  });

  it('is a solid disc in the attention colour, its number in the colour derived for it (FR-135, FR-136)', () => {
    expect(mark()).toMatch(/border-radius:\s*50%/);
    expect(mark()).toMatch(/background:\s*var\(--throng-colour-attentionMark\)/);
    expect(mark()).toMatch(/color:\s*var\(--throng-attention-mark-text\b/);
  });

  it('has no kind variant and no glyph rule: one look everywhere (FR-135)', () => {
    expect(css).not.toMatch(/\.throng-attention-mark--(?:attention|failed)/);
    expect(css).not.toMatch(/\.throng-attention-mark[^{]*\.icon/);
    expect(css).not.toMatch(/attentionFailedMark/);
  });

  // FR-107 is superseded: the selected row's circle keeps the attention fill; like the colour dot there
  // (FR-094) it is ringed in the row's contrast colour, so it reads on a fill close to the attention colour.
  it('keeps its fill on the selected row, ringed in the row’s contrast colour as the dot is (FR-094, FR-135)', () => {
    const rule = blockOf(css, '.project-item--active .throng-attention-mark');
    // Not `currentColor`: the circle's own colour is its number's, not the row's (review, round 13).
    expect(rule).toMatch(/box-shadow:\s*0\s+0\s+0\s+2px\s+var\(--project-fill-text\b/);
    expect(rule).not.toMatch(/background|color:/);
  });

  it('is larger than the unsaved dot, which it may sit beside (FR-138)', () => {
    expect(px(mark(), 'width')!).toBeGreaterThan(px(blockOf(css, '.throng-unsaved-dot'), 'width')!);
  });

  it('shows a pointer over a mark that can be clicked (FR-105)', () => {
    expect(blockOf(css, ".throng-attention-mark[data-clickable='true']")).toMatch(/cursor:\s*pointer/);
  });
});

describe('the highlighted row’s colour dot (FR-094)', () => {
  it('is ringed at least 2px in the row’s contrast colour', () => {
    const rule = blockOf(css, '.project-item--active .project-item__dot');
    const ring = /box-shadow:\s*0\s+0\s+0\s+(\d+)px\s+currentColor/.exec(rule);
    expect(ring, 'a currentColor ring — the black or white 046 FR-072a picks for the row').not.toBeNull();
    expect(Number(ring![1])).toBeGreaterThanOrEqual(2);
  });
});

// FR-118 — the header of a marked panel is filled with its kind's colour, mixed into the header surface so
// the title stays legible; it outranks the active panel's header fill, since a marked panel can be active.
describe('a marked panel’s header (FR-118)', () => {
  const rule = (): string => blockOf(css, '.panel-box[data-attention] .panel-box__header');

  // FR-135: a failed panel's header is tinted exactly as any marked panel's.
  it('fills a marked panel’s header, of either kind, with the attention colour mixed into the surface', () => {
    const r = rule();
    const token = '--throng-colour-attentionMark';
    expect(r).toMatch(new RegExp(`background:\\s*color-mix\\(in srgb, var\\(${token}\\) \\d+%, var\\(--bg-raised\\)\\)`));
    const pct = Number(/color-mix\(in srgb, var\([^)]*\) (\d+)%/.exec(r)![1]);
    expect(pct).toBeGreaterThanOrEqual(20); // obvious at a glance
    expect(pct).toBeLessThanOrEqual(40); // the title stays readable over it
  });

  it('comes after the active panel’s header fill, so a marked active panel still shows it', () => {
    expect(css.indexOf('.panel-box[data-attention] .panel-box__header')).toBeGreaterThan(
      css.indexOf('.panel-box--active .panel-box__header'),
    );
  });
});

// FR-119 — a popover entry puts its description on a line of its own, indented under the name; a rule
// separates entries (indented, as the entries are, within a project) and a full-width one separates projects.
describe('the attention popover’s layout (FR-119)', () => {
  it('stacks each entry: the head, then the description indented beneath it', () => {
    expect(blockOf(css, '.attention-popover__line')).toMatch(/flex-direction:\s*column/);
    expect(blockOf(css, '.attention-popover__reason')).toMatch(/padding-left:\s*\d+px/);
  });

  // FR-121 — a name that wraps keeps its icon beside its first line, not centred on the whole name.
  it('pins the icon to the top of its entry', () => {
    expect(blockOf(css, '.attention-popover__head')).toMatch(/align-items:\s*flex-start/);
    expect(blockOf(css, '.attention-popover__icon')).not.toMatch(/align-self:\s*center/);
  });

  it('rules between entries and between projects', () => {
    expect(blockOf(css, '.attention-popover__line + .attention-popover__line')).toMatch(/border-top:\s*1px solid var\(--border\)/);
    expect(blockOf(css, '.attention-popover__group + .attention-popover__group')).toMatch(/border-top:\s*1px solid var\(--border\)/);
  });
});

// FR-122 — a notice control (the toast’s go-to) is drawn exactly as Copy and Dismiss are.
describe('a notice’s own controls (FR-122)', () => {
  it('gives .notice__control the Copy and Dismiss treatment', () => {
    expect(css).toMatch(/\.notice__control,\s*\.notice__copy,\s*\.notice__dismiss\s*\{[^}]*background:\s*none/);
    expect(css).toMatch(/\.notice__control:hover,\s*\.notice__copy:hover/);
  });
});
