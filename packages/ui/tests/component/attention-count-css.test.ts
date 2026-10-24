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

describe('the number inside a flag (FR-131, FR-133)', () => {
  it('is laid over the glyph without taking layout space', () => {
    const count = cssRule('.throng-attention-mark__count');
    expect(count.get('position')).toBe('absolute');
    expect(count.get('pointer-events')).toBe('none');
    expect(count.get('font-size')).toMatch(/^\d+px$/);
  });

  /*
   * MT-03 / MT-04 failed at 1575753e: "I can just see the flag". The glyph is a SOLID flag (⚑), and digits
   * inheriting its colour were painted in that colour on top of it — invisible. So the digits carry the
   * count pill's own pair (`.throng-count-pill`: text on the active surface), the same for both kinds and
   * on a project-coloured row, legible whatever colour the flag is drawn in.
   */
  it('is drawn in the count pill’s own text-on-surface pair, never in the flag’s colour', () => {
    const count = cssRule('.throng-attention-mark__count');
    expect(count.get('background')).toBe('var(--surface-active)');
    expect(count.get('color')).toBe('var(--text)');
    expect(cssRule('.throng-attention-mark--failed .throng-attention-mark__count').get('background')).toBeUndefined();
  });

  it('a numbered glyph is larger than the plain 16px one so the digit fits (FR-131)', () => {
    const glyph = cssRule('.throng-attention-mark[data-numbered] .icon');
    expect(parseInt(glyph.get('width') ?? '0', 10)).toBeGreaterThan(16);
  });

  it('a project row slot keeps its 10px size whether or not a number is drawn (FR-114, FR-133)', () => {
    const slot = cssRule('.project-item__switch > .throng-attention-mark');
    expect(slot.get('width')).toBe('10px');
    expect(slot.get('height')).toBe('10px');
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
