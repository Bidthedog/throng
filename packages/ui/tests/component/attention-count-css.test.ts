/**
 * The stylesheet half of 057 round 12 (FR-130, FR-131, FR-133).
 *
 * Layer: component — jsdom applies no layout, so what a flag, a pill or a pale header does to the page is
 * asserted as the CSS rules that decide it (read from the shipped `theme.css`, as
 * `projects-panel-categories.test.ts` does). A real layout is E2E, and how legible the digits are at the
 * default UI scale is a judgement made by hand in MT-03.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_DEFAULT_THEMES, resolveColour } from '@throng/core';

function cssRule(selector: string): Map<string, string> {
  const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8');
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  const declarations = new Map<string, string>();
  for (const part of (match?.[1] ?? '').split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    declarations.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim());
  }
  return declarations;
}

/*
 * Round 13 (FR-135, FR-136): the flag is gone. MT-03 / MT-04 failed twice on the number — first invisible on
 * the solid flag, then "does not look good" on a backing laid over it — and the answer is a solid circle with
 * the number as its own text, in the black or white derived from its fill (`--throng-attention-mark-text`).
 */
describe('the number inside the circle (FR-131, FR-133, FR-136)', () => {
  it('is the circle’s own text, centred, in the colour derived for its fill, with no backing of its own', () => {
    const mark = cssRule('.throng-attention-mark');
    expect(mark.get('color')).toMatch(/^var\(--throng-attention-mark-text\b/);
    expect(mark.get('align-items')).toBe('center');
    expect(mark.get('justify-content')).toBe('center');
    const count = cssRule('.throng-attention-mark__count');
    expect(count.get('background')).toBeUndefined();
    expect(count.get('color')).toBeUndefined();
    expect(count.get('position')).toBeUndefined();
    expect(count.get('font-weight')).toBe('700');
    expect(count.get('font-size')).toMatch(/^\d+px$/);
  });

  /*
   * Hand-testing 83ad8368: "the number … should be centered — it is currently offset to the top right a
   * little". A line box keeps room for descenders digits never use (so they ride high), and negative
   * letter-spacing narrows the box on its right (so they spill right). Trim the box to the digits' cap
   * height and baseline, and spell them at their natural spacing, so the flex centring centres the ink.
   */
  it('centres the digits’ ink, not their line box: trimmed to cap height and baseline, no letter-spacing', () => {
    for (const selector of ['.throng-attention-mark__count', ".throng-attention-mark__count[data-wide='true']"]) {
      const count = cssRule(selector);
      expect(count.get('letter-spacing'), selector).toBeUndefined();
    }
    expect(cssRule('.throng-attention-mark__count').get('text-box')).toBe('trim-both cap alphabetic');
  });

  it('“9+” fits inside the circle: a smaller size for two characters (FR-136)', () => {
    const one = parseInt(cssRule('.throng-attention-mark__count').get('font-size') ?? '0', 10);
    const two = parseInt(cssRule(".throng-attention-mark__count[data-wide='true']").get('font-size') ?? '0', 10);
    expect(two).toBeGreaterThan(0);
    expect(two).toBeLessThan(one);
  });

  it('a project row slot is the 14px colour dot’s size whether or not a number is drawn (FR-133, FR-137)', () => {
    const slot = cssRule('.project-item__switch > .throng-attention-mark');
    expect(slot.get('width')).toBe('14px');
    expect(slot.get('height')).toBe('14px');
  });

  it('an empty flag slot keeps the flag’s size, hidden rather than removed (FR-133)', () => {
    const slot = cssRule('.throng-attention-slot');
    expect(slot.get('visibility')).toBe('hidden');
    expect(slot.get('width')).toBe('14px');
    expect(slot.get('margin-left')).toBe('6px');
  });
});

describe('the pill slots keep their size (FR-133)', () => {
  it('a tab chip pill has a fixed width and, when empty, hides rather than collapses', () => {
    expect(cssRule('.tab-chip__count').get('width')).toMatch(/^\d+px$/);
    const empty = cssRule('.tab-chip__count--empty');
    expect(empty.get('visibility')).toBe('hidden');
    expect(empty.get('display')).toBeUndefined();
  });

  it('the category pill has a fixed width', () => {
    expect(cssRule('.category-header__count').get('min-width')).toMatch(/^\d+px$/);
  });
});

describe('a minimised category header is paler (FR-130)', () => {
  it('mixes the header surface toward the sidebar background, with no new token', () => {
    const bg = cssRule('.category-header--minimised').get('background') ?? '';
    expect(bg).toContain('color-mix(');
    expect(bg).toContain('--throng-colour-categoryHeaderBackground');
    expect(bg).toContain('--throng-colour-sidebarBg');
  });

  it('every bundled theme has a header surface distinct from its sidebar, so the mix shows', () => {
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      expect(resolveColour(theme, 'categoryHeaderBackground').toLowerCase(), name).not.toBe(
        resolveColour(theme, 'sidebarBg').toLowerCase(),
      );
    }
  });
});
