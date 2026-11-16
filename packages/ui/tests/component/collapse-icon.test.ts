/**
 * `RotatedIcon` and `CollapseIcon` (069 FR-040): every collapse / restore control draws the
 * `minimisePanel` or `restorePanel` key, turned to face its edge.
 *
 * Layer: component — which key is drawn and the transform it carries are DOM; none of it needs a window.
 * Whether the turned art LOOKS right in the side panes is the manual plan's (MT-01).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { RotatedIcon } from '../../src/renderer/common/rotated-icon.js';
import { CollapseIcon, type CollapseEdge } from '../../src/renderer/panes/collapse-icon.js';
import { drawnIcon, iconMarkup } from './helpers/icon-markup.js';

function drawn(el: ReturnType<typeof render>['container']): { key: string | undefined; transform: string } {
  const span = el.querySelector<HTMLElement>('.rotated-icon');
  expect(span, 'a collapse icon is a RotatedIcon').not.toBeNull();
  return { key: drawnIcon(span), transform: span!.style.transform };
}

describe('RotatedIcon', () => {
  it('turns the one themed icon by any angle, clockwise', () => {
    const { container } = render(createElement(RotatedIcon, { token: 'chevron', degrees: 37.5 }));
    const { key, transform } = drawn(container);
    expect(key).toBe(iconMarkup('chevron'));
    expect(transform).toBe('rotate(37.5deg)');
  });

  it('leaves the art untransformed at 0°', () => {
    const { container } = render(createElement(RotatedIcon, { token: 'chevron', degrees: 0 }));
    expect(drawn(container).transform).toBe('');
  });
});

describe('CollapseIcon faces the edge it collapses toward (FR-040)', () => {
  const cases: Array<[CollapseEdge, boolean, 'minimisePanel' | 'restorePanel', string]> = [
    ['bottom', false, 'minimisePanel', ''],
    ['bottom', true, 'restorePanel', ''],
    ['left', false, 'minimisePanel', 'rotate(90deg)'],
    ['left', true, 'restorePanel', 'rotate(90deg)'],
    ['right', false, 'minimisePanel', 'rotate(-90deg)'],
    ['right', true, 'restorePanel', 'rotate(-90deg)'],
  ];
  it.each(cases)('%s edge, collapsed=%s: %s, %s', (edge, collapsed, key, transform) => {
    const { container } = render(createElement(CollapseIcon, { edge, collapsed }));
    expect(drawn(container)).toEqual({ key: iconMarkup(key), transform });
  });

  it('is what the side panes\' hide and show buttons draw, each facing its own edge', () => {
    // The side panes live in `App`, which needs the whole window to mount; the wiring is one line each.
    const app = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/app.tsx'), 'utf8');
    expect(app).toContain('<CollapseIcon edge="left" collapsed={!leftShown} />');
    expect(app).toContain('<CollapseIcon edge="right" collapsed={!rightShown} />');
  });
});
