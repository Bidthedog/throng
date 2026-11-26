/**
 * 080 FR-055 — every (?) is drawn smaller than a standard icon control and stays legible, the same everywhere and
 * whatever the theme's icon size. An `.icon` takes `--throng-size-icon` (16px by default), so shrinking the button's
 * font alone changes nothing visible: the glyph inside a help link needs a size of its own.
 *
 * Layer: unit — the rule is the whole behaviour; the stylesheet is read as text.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(new URL('../../src/renderer/theme.css', import.meta.url), 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\})\\s*(?:/\\*[\\s\\S]*?\\*/\\s*)*${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (!match) return {};
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries(
    body
      .split(';')
      .map((d) => d.split(':').map((p) => p.trim()))
      .filter((p) => p.length === 2 && p[0] !== '')
      .map(([k, v]) => [k, v]),
  );
}

const px = (value: string | undefined): number => Number(/^(\d+(?:\.\d+)?)px$/.exec(value ?? '')?.[1] ?? NaN);

describe('the (?) size (080 FR-055)', () => {
  const glyph = rule('button.icon-button.help-link .icon');

  it('gives the glyph a fixed size of its own, not the theme icon size', () => {
    for (const prop of ['width', 'height', 'font-size']) {
      expect(glyph[prop], `${prop} of the (?) glyph`).toMatch(/^\d+px$/);
    }
  });

  it('draws the glyph smaller than the 16px icon size, but legible (at least 10px)', () => {
    const size = px(glyph.width);
    expect(size).toBeLessThan(16);
    expect(size).toBeGreaterThanOrEqual(10);
    expect(px(glyph.height)).toBe(size);
    expect(px(glyph['font-size'])).toBe(size);
  });

  it('keeps the control no taller than 16px', () => {
    expect(px(rule('button.icon-button.help-link').height)).toBeLessThanOrEqual(16);
  });
});
