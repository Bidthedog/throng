import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 060 FR-009 (hand test) — a match in a results row was drawn with its top and bottom frame cut off.
 *
 * `.fif-row` is exactly `--fif-row-height` high with `overflow: hidden` (the list is windowed on that
 * height), and so is `.fif-row__snippet`. The shared match rule frames the mark with an `outline`, which is
 * painted OUTSIDE the box — and the mark fills the snippet's line box, so the outer edge falls on the
 * clipping edge. The row cannot grow, so the frame moves inside the mark: a negative `outline-offset`
 * equal to the outline's own width, scoped to `.fif-results` so the editor's match is untouched.
 * jsdom applies no stylesheet, so this reads the two sheets the way `find-bar-highlight-css.test.ts` does.
 */
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');

const FIF_CSS = read('../../src/renderer/find-in-files/find-in-files.css');
const FIND_BAR_CSS = read('../../src/renderer/search/find-bar.css');

function declarationsOf(css: string, selector: string): Map<string, string> {
  for (const m of css.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    if (m[1].trim().replace(/\s+/g, ' ') !== selector) continue;
    const declarations = new Map<string, string>();
    for (const part of m[2].split(';')) {
      const colon = part.indexOf(':');
      if (colon < 0) continue;
      declarations.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim());
    }
    return declarations;
  }
  throw new Error(`no rule for ${selector}`);
}

describe('a results-row match frame fits inside its row (060 FR-009)', () => {
  it('draws an ordinary match frame inside the mark', () => {
    expect(declarationsOf(FIF_CSS, '.fif-results .throng-search-match').get('outline-offset')).toBe('-1px');
  });

  it('draws the current match frame (2 px) inside the mark', () => {
    expect(declarationsOf(FIF_CSS, '.fif-results .throng-search-match--current').get('outline-offset')).toBe('-2px');
  });

  it('leaves the editor match rules without an outline-offset', () => {
    expect(
      declarationsOf(FIND_BAR_CSS, ':where(.cm-editor, .fif-results) .throng-search-match').has('outline-offset'),
    ).toBe(false);
    expect(
      declarationsOf(FIND_BAR_CSS, ':where(.cm-editor, .fif-results) .throng-search-match--current').has('outline-offset'),
    ).toBe(false);
  });

  it('keeps the row height fixed (the list is windowed on it)', () => {
    expect(declarationsOf(FIF_CSS, '.fif-group, .fif-row').get('height')).toBe('var(--fif-row-height)');
  });
});
