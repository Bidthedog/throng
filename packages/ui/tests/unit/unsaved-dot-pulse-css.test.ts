/**
 * 011 US5 (FR-020 – FR-023) — the unsaved dot pulses, in step, never vanishing; and is static at full
 * opacity under reduced motion.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/unsaved-dot-pulse.e2e.ts` (both declarations). jsdom evaluates
 * neither `@keyframes` nor `prefers-reduced-motion`, so — as `split-mode-pulse-css.test.ts` does for
 * 048 — the claims are asserted on the stylesheet text, which is where they are made. That every dot
 * (panel, tab, project, tree row) wears the ONE shared class, so they all run this one animation and are
 * therefore in step (FR-022), is `unsaved-dot-call-sites.test.ts`.
 *
 * ANTI-VACUITY CONTROL: rename the animation on `.throng-unsaved-dot`, drop `infinite`, let the keyframes
 * reach `opacity: 0`, or delete the reduced-motion rule, and one test here fails.
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

/** The body of every `@media (prefers-reduced-motion: reduce)` block, in file order. */
function reducedMotionBlocks(source: string): string[] {
  return [...source.matchAll(/@media \(prefers-reduced-motion: reduce\) \{/g)].map((m) => {
    const start = m.index! + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}') depth--;
    }
    return source.slice(start, i - 1);
  });
}

describe('.throng-unsaved-dot pulses (FR-020, FR-022)', () => {
  it('runs the shared throng-unsaved-pulse animation continuously', () => {
    const rule = blockOf(css, '.throng-unsaved-dot');
    expect(rule).toMatch(/animation:\s*throng-unsaved-pulse(?![\w-])[^;]*\binfinite\b/);
  });

  it('animates opacity only, and never reaches zero — an absent dot means "no unsaved changes" (FR-021)', () => {
    const frames = blockOf(css, '@keyframes throng-unsaved-pulse');
    const properties = [...frames.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    expect(new Set(properties)).toEqual(new Set(['opacity']));
    const opacities = [...frames.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    expect(opacities.length).toBeGreaterThan(1);
    expect(Math.min(...opacities), 'the dot is never invisible').toBeGreaterThan(0);
    expect(Math.max(...opacities), 'and is at full opacity at its peak').toBe(1);
  });
});

describe('.throng-unsaved-dot under reduced motion (FR-023)', () => {
  it('is static at full opacity — no animation', () => {
    const mine = reducedMotionBlocks(css).find((b) => b.includes('.throng-unsaved-dot'));
    expect(mine, 'no reduced-motion rule for .throng-unsaved-dot').toBeDefined();
    const rule = blockOf(mine!, '.throng-unsaved-dot');
    expect(rule).toMatch(/animation:\s*none/);
    expect(rule).toMatch(/opacity:\s*1/);
  });
});
