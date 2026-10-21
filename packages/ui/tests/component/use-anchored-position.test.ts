/**
 * `useAnchoredPosition` — the placement the tab popover and the attention popover share: measured in a
 * layout effect from the anchor's rect and the surface's own size, run through `clampToViewport`, held
 * as `null` (so the caller keeps the surface invisible) until it has been placed, and not re-set for a
 * sub-half-pixel change.
 *
 * Layer: component — a hook over `getBoundingClientRect` and `innerWidth/innerHeight`, which a DOM can be
 * told the answers to. The clamp's own arithmetic is `clamp-to-viewport.test.ts`'s.
 *
 * ANTI-VACUITY CONTROL: skip the measurement in the hook and the "placed" tests stay at `null`; drop the
 * `GAP` and the gap test fails.
 */
import { act, render, screen } from '@testing-library/react';
import { createElement, useState, type ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ANCHOR_GAP, useAnchoredPosition } from '../../src/renderer/common/use-anchored-position.js';

type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };
const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) }) as Rect as DOMRect;

let anchorRect = rect(100, 100, 20, 20);
let surfaceRect = rect(0, 0, 200, 50);
let placements = 0;

function Probe({ anchor, contentKey }: { anchor: HTMLElement | null; contentKey: string }): ReactElement {
  const { ref, pos } = useAnchoredPosition<HTMLDivElement>(anchor, contentKey);
  placements++;
  return createElement('div', {
    ref,
    'data-testid': 'surface',
    'data-placed': pos === null ? 'no' : `${pos.left},${pos.top}`,
  });
}

function Host(): ReactElement {
  const [key, setKey] = useState('a');
  return createElement('div', null,
    createElement('button', { 'data-testid': 'change', onClick: () => setKey('b') }),
    createElement(Probe, { anchor: document.getElementById('anchor'), contentKey: key }));
}

function mountWith(): void {
  const el = document.createElement('div');
  el.id = 'anchor';
  el.getBoundingClientRect = () => anchorRect;
  document.body.append(el);
  render(createElement(Host));
}

afterEach(() => {
  document.getElementById('anchor')?.remove();
  anchorRect = rect(100, 100, 20, 20);
  surfaceRect = rect(0, 0, 200, 50);
  placements = 0;
});

// jsdom answers zeroes for every element, so the surface (the only element the Probe measures besides the
// anchor, which has its own) is told its size through the prototype for the length of this file.
const original = HTMLElement.prototype.getBoundingClientRect;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.dataset['testid'] === 'surface' ? surfaceRect : original.call(this);
  };
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = original;
});

describe('useAnchoredPosition', () => {
  it('places the surface under the anchor, with the shared gap, before the caller paints it', () => {
    window.innerWidth = 1000;
    window.innerHeight = 800;
    mountWith();
    // Opens at the anchor's left, below its bottom edge plus the gap.
    expect(screen.getByTestId('surface')).toHaveAttribute('data-placed', `100,${120 + ANCHOR_GAP}`);
  });

  it('flips above the anchor when there is no room below', () => {
    window.innerWidth = 1000;
    window.innerHeight = 140;
    mountWith();
    const [, top] = screen.getByTestId('surface').getAttribute('data-placed')!.split(',').map(Number);
    expect(top).toBeLessThan(100);
  });

  it('re-places when the content key changes, and not otherwise', () => {
    window.innerWidth = 1000;
    window.innerHeight = 800;
    mountWith();
    const first = screen.getByTestId('surface').getAttribute('data-placed');
    surfaceRect = rect(0, 0, 200, 90);
    anchorRect = rect(100, 300, 20, 20);
    act(() => screen.getByTestId('change').click());
    expect(screen.getByTestId('surface').getAttribute('data-placed')).not.toBe(first);
  });

  it('does not set state again for a change under half a pixel', () => {
    window.innerWidth = 1000;
    window.innerHeight = 800;
    mountWith();
    const before = placements;
    anchorRect = rect(100.2, 100, 20, 20);
    act(() => screen.getByTestId('change').click());
    // One render for the key change itself; the 0.2px shift must not cost a second.
    expect(placements - before).toBe(1);
  });

  it('stays unplaced with no anchor', () => {
    render(createElement(Probe, { anchor: null, contentKey: 'a' }));
    expect(screen.getByTestId('surface')).toHaveAttribute('data-placed', 'no');
  });
});
