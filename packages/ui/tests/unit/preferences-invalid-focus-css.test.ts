/**
 * 077 FR-024 — what is wrong with a box is said in the Preferences toast, so the box's red outline is its only mark. A
 * focused box drew the browser's default focus ring over that border, so the box being typed into — the one most
 * likely to be invalid — showed no red at all (walk-through MT-82, 2026-11-21). An invalid box's focus ring therefore
 * takes the error colour, from the theme's token.
 *
 * Layer: unit — `preferences.css` read as text; nothing is rendered.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/preferences/preferences.css'), 'utf8');

/** Every declaration block whose selector list names `selector`. */
function blocksFor(selector: string): string[] {
  const out: string[] = [];
  for (const m of CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(',').map((s) => s.trim());
    if (selectors.includes(selector)) out.push(m[2]!);
  }
  return out;
}

describe('a focused invalid box keeps its error mark (077 FR-024)', () => {
  for (const pseudo of [':focus', ':focus-visible']) {
    it(`.ctl__input--invalid${pseudo} draws its ring in the danger token`, () => {
      const body = blocksFor(`.ctl__input--invalid${pseudo}`).join(';');
      expect(body).toMatch(/outline(?:-color)?\s*:[^;]*var\(--danger\)/);
      // The token, not a literal: the theme decides the colour.
      expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    });
  }
});
