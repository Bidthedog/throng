import { fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { createPortal } from 'react-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keepTabInPanel } from '../../src/renderer/common/panel-tab-stop.js';

/**
 * T11 (maintainer's v1 review, 2026-11-27) — Tab never takes focus out of a panel on its own.
 *
 * jsdom has no layout, so `getClientRects()` is empty for every element; it is defined here to report a box for any
 * element not hidden by an inline `display: none` on itself or an ancestor, the way a browser would.
 */
const original = HTMLElement.prototype.getClientRects;
beforeAll(() => {
  HTMLElement.prototype.getClientRects = function (this: HTMLElement) {
    const hidden = this.closest('[style*="display: none"]') !== null;
    return (hidden ? [] : [{}]) as unknown as DOMRectList;
  };
});
afterAll(() => {
  HTMLElement.prototype.getClientRects = original;
});

function panel(children: ReturnType<typeof h>[]): void {
  render(h('div', { 'data-testid': 'panel', onKeyDown: keepTabInPanel }, ...children));
}

/** Fires Tab on `el`; true when the browser's own focus move would go ahead. */
function tab(el: HTMLElement, shift = false): boolean {
  return fireEvent.keyDown(el, { key: 'Tab', shiftKey: shift });
}

describe('keepTabInPanel (T11)', () => {
  it('lets Tab move between the panel\'s own controls', () => {
    panel([h('button', { key: 'a' }, 'A'), h('button', { key: 'b' }, 'B')]);
    expect(tab(screen.getByText('A'))).toBe(true);
    expect(tab(screen.getByText('B'), true)).toBe(true);
  });

  it('cancels Tab at the last control and Shift+Tab at the first, so focus stays in the panel', () => {
    panel([h('button', { key: 'a' }, 'A'), h('button', { key: 'b' }, 'B')]);
    expect(tab(screen.getByText('B'))).toBe(false);
    expect(tab(screen.getByText('A'), true)).toBe(false);
  });

  it('does not count a hidden or tabindex=-1 control as somewhere to go', () => {
    panel([
      h('button', { key: 'a' }, 'A'),
      h('button', { key: 'b', tabIndex: -1 }, 'B'),
      h('div', { key: 'c', style: { display: 'none' } }, h('button', null, 'C')),
    ]);
    expect(tab(screen.getByText('A'))).toBe(false);
  });

  it('leaves a key a surface already handled, and one from a portalled dialog, alone', () => {
    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);
    panel([
      h('button', { key: 'a', onKeyDown: (e: { preventDefault(): void }) => e.preventDefault() }, 'A'),
      createPortal(h('button', { key: 'p' }, 'P'), elsewhere) as unknown as ReturnType<typeof h>,
    ]);
    // Already prevented by the button itself: false either way, and the handler adds nothing.
    expect(tab(screen.getByText('A'))).toBe(false);
    // The portal's element is outside the panel's DOM: its Tab is the dialog's business.
    expect(tab(screen.getByText('P'))).toBe(true);
  });
});
