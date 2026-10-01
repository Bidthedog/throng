/**
 * 048 FR-026 — the pulse is a compositor-only animation, and steady under reduced motion.
 *
 * jsdom evaluates neither `@keyframes` nor `prefers-reduced-motion`, so the claim is asserted on the
 * stylesheet text, which is where it is made: the keyframes the pulse uses animate `opacity` and nothing
 * else (no layout, no paint properties), and the reduced-motion block turns the animation off and leaves
 * a steady highlighted border. A regression to `width`, `box-shadow` or a dropped reduced-motion rule
 * fails here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../src/renderer/theme.css'), 'utf8');

/** The body of the first top-level rule or at-rule whose prelude is exactly `prelude`. */
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

describe('.panel-box__split-mode (FR-026)', () => {
  it('draws an accent border over the panel that never takes the pointer', () => {
    const rule = blockOf(css, '.panel-box__split-mode');
    expect(rule).toMatch(/border:\s*\d+px solid var\(--accent\)/);
    expect(rule).toMatch(/pointer-events:\s*none/);
    expect(rule).toMatch(/position:\s*absolute/);
  });

  it('animates opacity and nothing else — compositor-only, no layout work while it runs', () => {
    const rule = blockOf(css, '.panel-box__split-mode');
    const name = /animation:\s*([\w-]+)/.exec(rule)?.[1];
    expect(name, 'the pulse names its keyframes').toBeTruthy();
    const frames = blockOf(css, `@keyframes ${name}`);
    const properties = [...frames.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    expect(properties.length).toBeGreaterThan(0);
    expect(new Set(properties)).toEqual(new Set(['opacity']));
  });

  it('shows a steady highlighted border instead of a pulse under prefers-reduced-motion', () => {
    const reduced = blockOf(css, '@media (prefers-reduced-motion: reduce)');
    // The first media block in the file belongs to the flash; the split-mode rule must be in one too.
    const all = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{/g)];
    const blocks = all.map((m) => {
      const start = m.index! + m[0].length;
      let depth = 1;
      let i = start;
      for (; i < css.length && depth > 0; i++) {
        if (css[i] === '{') depth++;
        if (css[i] === '}') depth--;
      }
      return css.slice(start, i - 1);
    });
    void reduced;
    const mine = blocks.find((b) => b.includes('.panel-box__split-mode'));
    expect(mine, 'no reduced-motion rule for .panel-box__split-mode').toBeDefined();
    expect(mine).toMatch(/animation:\s*none/);
    expect(mine).toMatch(/opacity:\s*1/);
  });
});
