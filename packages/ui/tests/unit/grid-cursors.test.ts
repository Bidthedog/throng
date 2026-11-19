/**
 * 073 FR-008c — the grid's header pointers: a right-pointing select arrow over a row number, a down-pointing one over a
 * column letter, a diagonal one over the corner, and the column edge keeps `col-resize`.
 *
 * Layer: unit — jsdom draws no cursors, so this reads the stylesheet the grid ships and the cursor images it names. The
 * classes those rules hang on are the ones `data-grid.tsx` puts on the header elements (asserted in the component test
 * `data-grid.test.ts`, "header pointers"). The images are files, not `data:` URIs: the renderer's CSP allows `img-src`
 * from 'self' only (`renderer-csp.test.ts`), and `?no-inline` stops Vite turning a small file into a `data:` URI.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const GRID = fileURLToPath(new URL('../../src/renderer/grid/', import.meta.url));
const css = readFileSync(`${GRID}grid.css`, 'utf8');

/** The declaration block of the one rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const match = new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1]!;
}

const CASES = [
  { selector: '.data-grid__rowhead', file: 'row-select.svg', tip: { x: 19, y: 12 } },
  { selector: '.data-grid__colhead', file: 'column-select.svg', tip: { x: 12, y: 19 } },
  { selector: '.data-grid__corner', file: 'corner-select.svg', tip: { x: 18, y: 18 } },
] as const;

describe('the grid header cursors (FR-008c)', () => {
  for (const c of CASES) {
    it(`${c.selector} shows ${c.file} with its tip as the hotspot, and falls back to a pointer`, () => {
      const cursor = /cursor:\s*([^;]+);/.exec(rule(c.selector))?.[1] ?? '';
      expect(cursor).toContain(`url('./cursors/${c.file}?no-inline')`);
      expect(cursor).toMatch(new RegExp(`\\)\\s+${c.tip.x}\\s+${c.tip.y}\\s*,\\s*pointer\\s*$`));
      expect(cursor).not.toContain('data:');
    });

    it(`${c.file} exists, is a 24 px image, and holds its hotspot inside it`, () => {
      const path = `${GRID}cursors/${c.file}`;
      expect(existsSync(path)).toBe(true);
      const svg = readFileSync(path, 'utf8');
      expect(svg).toMatch(/width="24"/);
      expect(svg).toMatch(/height="24"/);
      expect(c.tip.x).toBeLessThan(24);
      expect(c.tip.y).toBeLessThan(24);
    });
  }

  it('a drag pins its starting pointer over the whole grid, resize edges included (FR-008e)', () => {
    const pinned = (mode: string): string => {
      const m = new RegExp(`\\.data-grid\\[data-drag='${mode}'\\],\\s*\\.data-grid\\[data-drag='${mode}'\\] \\*\\s*\\{([^}]*)\\}`).exec(css);
      if (!m) throw new Error(`no drag rule for ${mode}`);
      return m[1]!;
    };
    expect(pinned('cols')).toMatch(/url\('\.\/cursors\/column-select\.svg\?no-inline'\) 12 19, pointer !important;/);
    expect(pinned('rows')).toMatch(/url\('\.\/cursors\/row-select\.svg\?no-inline'\) 19 12, pointer !important;/);
    expect(pinned('cells')).toMatch(/cursor:\s*default !important;/);
  });

  it('a middle-button pan pins the move cursor over the whole grid, over every per-element cursor (FR-008f)', () => {
    expect(css).toMatch(/\.data-grid\[data-drag='pan'\],\s*\.data-grid\[data-drag='pan'\] \*\s*\{[^}]*cursor:\s*move\s*!important/);
  });

  it('the column resize edge keeps col-resize, which wins over the column letter\'s arrow', () => {
    expect(rule('.data-grid__resize')).toMatch(/cursor:\s*col-resize;/);
    expect(css.indexOf('.data-grid__resize {')).toBeGreaterThan(css.indexOf('.data-grid__colhead {'));
  });
});
