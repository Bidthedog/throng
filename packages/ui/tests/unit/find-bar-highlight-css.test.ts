import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 047 T077 (FR-074, MT-01) — every editor find match carries an outline, not only the current one.
 *
 * jsdom applies no stylesheet, so a component test cannot see the rule; this reads `find-bar.css` the
 * way `preview-text-selection-css.test.ts` reads its files. The current match keeps its own stronger
 * outline, which must still win over the ordinary one.
 */
const FIND_BAR_CSS = readFileSync(
  fileURLToPath(new URL('../../src/renderer/search/find-bar.css', import.meta.url)),
  'utf8',
);

/** The declarations of the innermost rule whose selector list is exactly `selector`, comments removed. */
function declarationsOf(css: string, selector: string): Map<string, string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const m of text.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
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

describe('editor find-match outlines (047 FR-074)', () => {
  it('outlines every match in searchMatchBorder', () => {
    const match = declarationsOf(FIND_BAR_CSS, '.cm-editor .throng-search-match');
    expect(match.get('outline')).toMatch(/^1px solid var\(--throng-colour-searchMatchBorder\b/);
  });

  it('keeps the current match on its own outline, declared after the ordinary one', () => {
    const current = declarationsOf(FIND_BAR_CSS, '.cm-editor .throng-search-match--current');
    expect(current.get('outline')).toMatch(/^1px solid var\(--throng-colour-searchMatchCurrentBorder\b/);
    expect(FIND_BAR_CSS.indexOf('.cm-editor .throng-search-match--current {')).toBeGreaterThan(
      FIND_BAR_CSS.indexOf('.cm-editor .throng-search-match {'),
    );
  });
});
