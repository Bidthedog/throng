/**
 * 073 FR-033d — the editor's in-step highlight must be VISIBLE on every shipped theme (MT-10 step 6 failed: "I do not see
 * the highlight in the editor any more - just on the CSV preview").
 *
 * `editor-sync-mark-real-panel.test.ts` shows the real panel DOES put the highlight class on the line, so the defect was
 * in what the class paints. The rule mixed `--throng-colour-accentText` — the colour of text drawn ON an accent fill, which
 * the default themes set to their own background (`accentText: p.bg`) — at 22% over transparent. That is a wash of the
 * background colour over the background: no visible difference. The grid's row highlight, which does show, mixes `accent`.
 *
 * Layer: unit — the stylesheet's rule against every shipped theme's tokens (jsdom has no cascade for `color-mix`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALL_DEFAULT_THEMES, contrastRatio, hexToRgb } from '@throng/core';
import { describe, expect, it } from 'vitest';

const css = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../src/renderer/${rel}`, import.meta.url)), 'utf8');

/** The token a rule mixes into its background, and the percentage. */
function washOf(sheet: string, selector: string): { token: string; percent: number } {
  const at = sheet.indexOf(`${selector} {`);
  expect(at, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
  const body = sheet.slice(at, sheet.indexOf('}', at));
  const m = /color-mix\(in srgb, var\(--throng-colour-([A-Za-z0-9]+)\) (\d+)%, transparent\)/.exec(body);
  expect(m, `${selector} mixes a theme token into its background`).not.toBeNull();
  return { token: m![1]!, percent: Number(m![2]) };
}

/** `token` at `percent` over `bg`, as a hex colour. */
function blend(token: string, percent: number, bg: string): string {
  const a = hexToRgb(token);
  const b = hexToRgb(bg);
  const mix = (x: number, y: number): string => Math.round(x * (percent / 100) + y * (1 - percent / 100)).toString(16).padStart(2, '0');
  return `#${mix(a.r, b.r)}${mix(a.g, b.g)}${mix(a.b, b.b)}`;
}

/** How far the wash must lift the line off the editor's background: the grid's own row highlight clears this on every theme. */
const VISIBLE = 1.08;

describe('the editor sync-mark highlight is visible on every shipped theme', () => {
  const rule = washOf(css('editor/editor.css'), '.cm-line.throng-sync-mark--on');

  for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
    it(`${name}: the washed line differs from the editor background`, () => {
      const bg = theme.colours.editorBg!;
      const wash = blend(theme.colours[rule.token]!, rule.percent, bg);
      expect(contrastRatio(wash, bg), `${rule.token} at ${rule.percent}% over editorBg (${bg}) gives ${wash}`).toBeGreaterThanOrEqual(VISIBLE);
    });
  }

  it('is calibrated: the grid row highlight (which the maintainer sees) clears the same bar on every theme', () => {
    const grid = washOf(css('grid/grid.css'), '.data-grid__row--sync-mark::after');
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      const bg = theme.colours.editorBg!;
      const wash = blend(theme.colours[grid.token]!, grid.percent, bg);
      expect(contrastRatio(wash, bg), `${name}: ${grid.token} gives ${wash}`).toBeGreaterThanOrEqual(VISIBLE);
    }
  });
});
