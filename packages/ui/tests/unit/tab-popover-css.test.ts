import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 031 FR-051a: the tab popover's panel rows read as separate entries, each with its icon at its top left.
 *
 * Layer: unit, over the stylesheet. jsdom does no layout, and each of these is a declared rule a reader can
 * check; how it looks is MT-12's.
 */
const css = readFileSync(resolve(__dirname, '../../src/renderer/theme.css'), 'utf8');
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `${selector} exists`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};
const pixels = (body: string, property: string): number => Number(new RegExp(`${property}: (\\d+)px`).exec(body)?.[1]);

describe('the tab popover (031 FR-051a)', () => {
  it('is wider than the 340px it used to stop at', () => {
    expect(pixels(rule('.tabstrip-popover'), 'max-width')).toBeGreaterThan(340);
    expect(pixels(rule('.tabstrip-popover'), 'min-width')).toBeGreaterThan(0);
  });

  it('holds each icon at the top of its row, on the first line of a wrapped name', () => {
    expect(rule('.tabstrip-popover__panel')).toContain('align-items: flex-start');
    expect(pixels(rule('.tabstrip-popover__panel-icon'), 'margin-top')).toBeGreaterThan(0);
  });

  it('rules a line between rows, and none above the first', () => {
    expect(rule('.tabstrip-popover__panel + .tabstrip-popover__panel')).toContain('border-top: 1px solid');
    expect(pixels(rule('.tabstrip-popover__panel'), 'padding')).toBeGreaterThan(0);
    expect(rule('.tabstrip-popover__panel')).not.toContain('padding-left');
  });
});
