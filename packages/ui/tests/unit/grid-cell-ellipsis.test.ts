/**
 * 073 FR-004 (convergence T080) — a cell's content stays on its row's single line, truncated with an ellipsis.
 *
 * Chromium draws `text-overflow: ellipsis` only on a block container's own inline content. The grid cell is a flex
 * container (it centres its text vertically), so text placed straight in it is clipped with no ellipsis. The text has
 * to sit in an element of its own that clips and ellipsises; `data-grid.test.ts` asserts the cell renders it so.
 *
 * Layer: unit — jsdom lays nothing out, so this reads the stylesheet the grid ships.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../../src/renderer/grid/grid.css', import.meta.url)), 'utf8');

/** Every declaration block whose selector list contains exactly `selector`, joined. */
function blocks(selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = (m[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim());
    if (sels.includes(selector)) out.push(m[2] ?? '');
  }
  return out.join('\n');
}

describe('a truncated cell ends in an ellipsis (FR-004)', () => {
  it('puts the ellipsis on the cell text element, which can shrink below its content and clips it', () => {
    const rule = blocks('.data-grid__cell-text');
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).toMatch(/overflow:\s*hidden/);
    expect(rule).toMatch(/white-space:\s*pre/);
    expect(rule).toMatch(/min-width:\s*0/);
  });

  it('lets a wrapped cell\'s text wrap in full rather than ellipsise (FR-013)', () => {
    const rule = blocks('.data-grid__cell--wrap .data-grid__cell-text');
    expect(rule).toMatch(/white-space:\s*pre-wrap/);
    expect(rule).toMatch(/text-overflow:\s*clip/);
  });
});
