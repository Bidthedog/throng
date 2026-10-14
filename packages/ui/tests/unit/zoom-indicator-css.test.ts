/**
 * #486 — the zoom indicator's declared rule: top-right, above the content, out of the pointer's way, fading in
 * fast and out slowly. Its cue is `component/zoom-indicator.test.ts`'s.
 *
 * Layer: unit — jsdom applies no stylesheet, so the declared rule is what a test can hold; how it looks is
 * MT-10's.
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

describe('.zoom-indicator', () => {
  it('sits top-right, above the content, out of the pointer’s way, and fades in fast and out slowly', () => {
    const base = rule('.zoom-indicator');
    expect(base).toMatch(/position:\s*absolute/);
    expect(base).toMatch(/top:\s*\d+px/);
    expect(base).toMatch(/right:\s*\d+px/);
    expect(base).toMatch(/pointer-events:\s*none/);
    expect(base).toMatch(/opacity:\s*0/);
    const shown = rule('.zoom-indicator--shown');
    expect(shown).toMatch(/opacity:\s*1/);
    const fadeOut = Number(/transition:\s*opacity (\d+)ms/.exec(base)![1]);
    const fadeIn = Number(/transition:\s*opacity (\d+)ms/.exec(shown)![1]);
    expect(fadeOut).toBeGreaterThan(fadeIn);
  });

  // MT-04 retest (2026-10-13) — the active ring is redrawn above the panel's content (B8 measures the paint),
  // and above the indicator too.
  it('the active panel ring is redrawn above everything inside the panel, the indicator included', () => {
    const ring = rule('.panel-box--active::after');
    expect(ring).toMatch(/position:\s*absolute/);
    expect(ring).toMatch(/outline:\s*inherit/);
    expect(ring).toMatch(/outline-offset:\s*inherit/);
    expect(ring).toMatch(/pointer-events:\s*none/);
    const z = (block: string): number => Number(/z-index:\s*(\d+)/.exec(block)![1]);
    expect(z(ring)).toBeGreaterThan(z(rule('.zoom-indicator')));
  });

  it('a panel’s holder takes no height, so showing it moves nothing', () => {
    const anchor = rule('.panel-box__zoom-anchor');
    expect(anchor).toMatch(/position:\s*relative/);
    expect(anchor).toMatch(/height:\s*0/);
  });
});
