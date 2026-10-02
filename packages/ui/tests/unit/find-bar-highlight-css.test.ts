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
    // 049 FR-009b: the current match's outline is 2 px; the ordinary one (above) stays 1 px.
    expect(current.get('outline')).toMatch(/^2px solid var\(--throng-colour-searchMatchCurrentBorder\b/);
    // An outline is painted outside the box and takes no layout space, so 2 px moves no text.
    expect(current.has('border')).toBe(false);
    expect(current.has('padding')).toBe(false);
    expect(FIND_BAR_CSS.indexOf('.cm-editor .throng-search-match--current {')).toBeGreaterThan(
      FIND_BAR_CSS.indexOf('.cm-editor .throng-search-match {'),
    );
  });

  it('leaves the existing match rules exactly as they were (049 FR-009)', () => {
    expect(declarationsOf(FIND_BAR_CSS, '.cm-editor .throng-search-match').get('background')).toMatch(
      /^var\(--throng-colour-searchMatch,/,
    );
    expect(declarationsOf(FIND_BAR_CSS, '.cm-editor .throng-search-match--current').get('background')).toMatch(
      /^var\(--throng-colour-searchMatchCurrent,/,
    );
    expect(declarationsOf(FIND_BAR_CSS, '::highlight(throng-preview-match)').get('background-color')).toMatch(
      /^var\(--throng-colour-searchMatch,/,
    );
    expect(declarationsOf(FIND_BAR_CSS, '::highlight(throng-preview-match-current)').get('background-color')).toMatch(
      /^var\(--throng-colour-searchMatchCurrent,/,
    );
  });
});

/**
 * 049 FR-009b — the preview's match frames: the current match's frame is 2 px wide, every other 1 px. The frame is
 * an absolutely positioned, border-box div in a layer of its own, so a thicker border moves no text and grows
 * neither the frame's box nor the layer; it is drawn inside the match's own rectangle.
 */
const FRAMES_CSS = readFileSync(
  fileURLToPath(new URL('../../src/renderer/preview/match-frames.css', import.meta.url)),
  'utf8',
);

describe('preview match frames (049 FR-009b)', () => {
  it('frames an ordinary match in 1 px and the current match in 2 px, both border-box', () => {
    const ordinary = declarationsOf(FRAMES_CSS, '.preview-match-frame');
    expect(ordinary.get('border')).toMatch(/^1px solid var\(--throng-colour-searchMatchBorder\b/);
    expect(ordinary.get('box-sizing')).toBe('border-box');
    const current = declarationsOf(FRAMES_CSS, '.preview-match-frame--current');
    expect(current.get('border-width')).toBe('2px');
    expect(current.get('border-color')).toMatch(/^var\(--throng-colour-searchMatchCurrentBorder\b/);
  });
});

/**
 * 049 (US3, US4; contracts/surfaces-tokens-setting.md) — the occurrence tints: the other instances of the
 * selected text, softer than a find match and carrying no outline, in the focused or the inactive strength.
 */
describe('occurrence tints (049 FR-014, FR-016, FR-018a)', () => {
  it('tints a focused editor’s occurrences in searchMatchOccurrence, with no outline', () => {
    const rule = declarationsOf(FIND_BAR_CSS, '.cm-editor.cm-focused .throng-occurrence');
    expect(rule.get('background')).toMatch(/^var\(--throng-colour-searchMatchOccurrence\b/);
    expect(rule.has('outline')).toBe(false);
  });

  it('tints an unfocused editor’s occurrences in the weaker searchMatchOccurrenceInactive, with no outline', () => {
    const rule = declarationsOf(FIND_BAR_CSS, '.cm-editor:not(.cm-focused) .throng-occurrence');
    expect(rule.get('background')).toMatch(/^var\(--throng-colour-searchMatchOccurrenceInactive\b/);
    expect(rule.has('outline')).toBe(false);
  });

  it('paints a preview’s occurrences, focused and inactive, through ::highlight, with no outline', () => {
    const focused = declarationsOf(FIND_BAR_CSS, '::highlight(throng-preview-occurrence)');
    expect(focused.get('background-color')).toMatch(/^var\(--throng-colour-searchMatchOccurrence\b/);
    expect(focused.has('outline')).toBe(false);
    const inactive = declarationsOf(FIND_BAR_CSS, '::highlight(throng-preview-occurrence-inactive)');
    expect(inactive.get('background-color')).toMatch(/^var\(--throng-colour-searchMatchOccurrenceInactive\b/);
    expect(inactive.has('outline')).toBe(false);
  });
});
