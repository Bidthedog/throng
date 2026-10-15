/**
 * The colour of a share bar is how much of the machine its node takes (055 FR-094, FR-097, SC-010 scenario
 * 15): the bar carries the number core's `heatFor` gives it as `--heat` (`share-bars.test.ts` asserts the
 * number for each metric), the stylesheet turns that into a colour from the theme's success, warning and
 * danger, and a key beside the bars shows the scale.
 *
 * Layer: unit-shaped, in the component directory with the rest of the monitor's colour claims — jsdom
 * computes no `color-mix()`, so the mixing is checked where it is written, in the stylesheet read as text
 * (the same seam the literal-colour guard in `breakdown.test.ts` uses). `heatFor`'s own stops are core's
 * unit test.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8');
const ruleOf = (selector: string): string => {
  const escaped = selector.replace(/[.[\]'=():]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
};

describe('the stylesheet mixes the theme’s colours from --heat (FR-094, FR-067)', () => {
  const fill = ruleOf('.share-bar__fill');

  it('passes through the theme’s success, warning and danger colours with color-mix()', () => {
    expect(fill).toMatch(/color-mix\(/);
    expect(fill).toMatch(/var\(--heat/);
    for (const token of ['success', 'warning', 'danger']) expect(fill, token).toContain(`var(--throng-colour-${token})`);
  });

  it('gives a bar with no measured figure a neutral fill', () => {
    expect(ruleOf(".share-bar__fill[data-heat='none']")).toMatch(/background:\s*var\(--throng-colour-/);
  });

  it('draws the key from the same three colours, so the bar IS the scale', () => {
    const bar = ruleOf('.share-key__bar');
    for (const token of ['success', 'warning', 'danger']) expect(bar, token).toContain(`var(--throng-colour-${token})`);
  });

  it('has no treemap tile left to colour', () => {
    expect(css).not.toContain('.treemap__tile');
  });
});
