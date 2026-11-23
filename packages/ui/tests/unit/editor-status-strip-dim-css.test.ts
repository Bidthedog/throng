/**
 * 016 FR-010g — the editor's status strip is a themed control that DIMS with its panel: fully lit on the
 * active panel, dimmed on the dimmed-active one, never left bright while every other indicator dims.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/editor-language-override.e2e.ts` ("the strip is a themed control
 * that DIMS with its panel"). Its hover title is `component/editor-language-strip.test.ts`; the strip's
 * contents and inherited colour are `component/status-strip-line-ending.test.ts`. What neither asserted
 * is the opacity rules, nor that the strip's background is a theme token. jsdom has no cascade over the
 * panel-box classes, so — as `split-mode-pulse-css.test.ts` does — the claim is read from the stylesheet,
 * where it is made.
 *
 * ANTI-VACUITY CONTROL: set the dimmed rule's opacity to 1, or the lit rule's to less than 1, or give the
 * strip a literal background, and one test here fails.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../src/renderer/editor/editor.css'), 'utf8');

/** The body of the first rule whose selector is exactly `selector`. */
function blockOf(source: string, selector: string): string {
  const at = source.indexOf(`${selector} {`);
  expect(at, `editor.css has no \`${selector} {\``).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('}', at);
  return source.slice(at + selector.length + 2, end);
}

const opacityOf = (rule: string): number => Number(/opacity:\s*([\d.]+)/.exec(rule)?.[1]);

describe('the editor status strip dims with its panel (FR-010g)', () => {
  it('is fully lit on the active panel', () => {
    expect(opacityOf(blockOf(css, '.panel-box--active .editor-status-strip'))).toBe(1);
  });

  it('is dimmed on the dimmed-active panel, so it never stays lit beside dimmed indicators', () => {
    const dimmed = opacityOf(blockOf(css, '.panel-box--active-dimmed .editor-status-strip'));
    expect(dimmed).toBeGreaterThan(0);
    expect(dimmed).toBeLessThan(1);
  });

  it('takes its background from a theme token, never a hardcoded colour', () => {
    expect(blockOf(css, '.editor-status-strip')).toMatch(/background:\s*var\(--throng-colour-editorStatusStripBg\b/);
  });
});
