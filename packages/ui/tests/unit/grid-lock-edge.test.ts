/**
 * 073 FR-039b — a locked row or column marks its outside edge with a highlighted line that REPLACES the border already
 * there: the accent colour at the ordinary cell border's width, so turning a lock on or off moves and resizes nothing.
 *
 * Layer: unit — jsdom lays nothing out, so this reads the stylesheet the grid ships; the classes the rules hang on are
 * the ones `data-grid.tsx` puts on the locked row and the locked-column cells (asserted in `data-grid.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../../src/renderer/grid/grid.css', import.meta.url)), 'utf8');

/** Every declaration block whose selector list contains exactly `selector`, joined. */
function blocks(selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = (m[1] ?? '').split(',').map((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').trim());
    if (sels.includes(selector)) out.push(m[2] ?? '');
  }
  return out.join('\n');
}

const BORDER_WIDTH = /border-(?:right|bottom):\s*(\d+)px solid var\(--throng-colour-border\)/;

describe('the locked strip edge (FR-039b)', () => {
  const plainWidth = (): string => BORDER_WIDTH.exec(blocks('.data-grid__cell'))?.[1] ?? '';

  it('colours the locked row\'s bottom border with the accent, at the ordinary width', () => {
    const rule = blocks('.data-grid__row--locked .data-grid__cell');
    expect(rule).toMatch(/border-bottom-color:\s*var\(--throng-colour-accent\)/);
    expect(rule).not.toMatch(/border-bottom:\s*\d+px/);
    expect(rule).not.toMatch(/border-bottom-width/);
    expect(plainWidth()).toBe('1');
  });

  it('colours the locked column\'s right border with the accent, at the ordinary width', () => {
    const rule = blocks('.data-grid__cell--locked-col');
    expect(rule).toMatch(/border-right-color:\s*var\(--throng-colour-accent\)/);
    expect(rule).not.toMatch(/border-right:\s*\d+px/);
    expect(rule).not.toMatch(/border-right-width/);
  });
});
