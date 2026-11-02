/**
 * The side panes animate: collapsing or expanding one slides the shell's grid column rather than snapping it,
 * and a live resize drag turns the animation off so dragging stays snappy.
 *
 * Moved down from `e2e/layout.e2e.ts` ('the side panes animate'), which read the shell's computed
 * `transitionProperty` in a launched window. The claim is the DECLARED rule: `.throng-shell` names
 * `grid-template-columns` as its transition.
 *
 * Layer: unit — jsdom applies no stylesheet, so the declared rule is what a test can hold; how the slide
 * looks is the hands-on plan's.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../../src/renderer/theme.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}

describe('.throng-shell side-pane transition', () => {
  it('transitions grid-template-columns, so a collapse or expand slides', () => {
    expect(rule('.throng-shell')).toMatch(/transition:\s*grid-template-columns\b/);
  });

  it('is suppressed during a live resize drag, so dragging stays snappy', () => {
    expect(rule('.throng-shell--no-anim')).toMatch(/transition:\s*none/);
  });
});
