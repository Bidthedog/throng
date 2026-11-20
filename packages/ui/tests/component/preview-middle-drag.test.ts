/**
 * 074 (maintainer's request, 2026-11-19) — a middle-button drag scrolls a preview's body, as it pans a diagram.
 *
 * Layer: component — which box scrolls, by how much, the cursor class and which presses are left alone are all in
 * what the handlers do to the DOM. jsdom lays nothing out, so each box's scroll extent is stubbed on the element.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { PREVIEW_PANNING_CLASS, useMiddleDragScroll } from '../../src/renderer/preview/middle-drag-scroll.js';

/** A preview body holding a scrollable page column, which holds a frame that takes its own middle presses. */
function Body() {
  const drag = useMiddleDragScroll();
  return createElement(
    'div',
    { 'data-testid': 'body', style: { overflowX: 'auto', overflowY: 'auto' }, ...drag },
    createElement(
      'div',
      { 'data-testid': 'column', style: { overflowX: 'auto', overflowY: 'auto' } },
      createElement('p', { 'data-testid': 'text' }, 'text'),
      createElement('div', {
        'data-testid': 'frame',
        onPointerDown: (e: { button: number; preventDefault(): void }) => {
          if (e.button === 1) e.preventDefault();
        },
      }),
    ),
  );
}

/** Give `el` a scroll extent larger than its box, so it counts as scrollable. */
function scrollable(el: HTMLElement): HTMLElement {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 2000 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 500 });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 1500 });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 400 });
  return el;
}

function mount(): { body: HTMLElement; column: HTMLElement } {
  render(createElement(Body));
  return { body: scrollable(screen.getByTestId('body')), column: scrollable(screen.getByTestId('column')) };
}

describe('middle-button drag in a preview body', () => {
  it('scrolls the nearest scrollable box with the pointer, with the move cursor while it lasts', () => {
    const { body, column } = mount();
    column.scrollLeft = 100;
    column.scrollTop = 300;
    const down = fireEvent.pointerDown(screen.getByTestId('text'), { button: 1, buttons: 4, clientX: 200, clientY: 200, pointerId: 1 });
    expect(down).toBe(false); // prevented: Chromium's autoscroll never starts
    expect(body).toHaveClass(PREVIEW_PANNING_CLASS);
    fireEvent.pointerMove(body, { buttons: 4, clientX: 170, clientY: 120, pointerId: 1 });
    // The content follows the pointer: dragged left 30 and up 80, the scroll moves right 30 and down 80.
    expect(column.scrollLeft).toBe(130);
    expect(column.scrollTop).toBe(380);
    expect(body.scrollTop).toBe(0); // the nearer box scrolled, not the body
    fireEvent.pointerUp(body, { button: 1, pointerId: 1 });
    expect(body).not.toHaveClass(PREVIEW_PANNING_CLASS);
    fireEvent.pointerMove(body, { clientX: 0, clientY: 0, pointerId: 1 });
    expect(column.scrollTop).toBe(380);
  });

  it('swallows the middle press’s mousedown and auxclick, so nothing autoscrolls or follows a link', () => {
    mount();
    fireEvent.pointerDown(screen.getByTestId('text'), { button: 1, pointerId: 1 });
    expect(fireEvent.mouseDown(screen.getByTestId('text'), { button: 1 })).toBe(false);
    expect(fireEvent(screen.getByTestId('text'), new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))).toBe(false);
  });

  it('leaves alone a press a diagram or picture frame already took', () => {
    const { body, column } = mount();
    fireEvent.pointerDown(screen.getByTestId('frame'), { button: 1, clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(body, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(body).not.toHaveClass(PREVIEW_PANNING_CLASS);
    expect(column.scrollTop).toBe(0);
  });

  it('leaves Ctrl+middle-click to the zoom reset, and the primary button to selection', () => {
    const { body, column } = mount();
    expect(fireEvent.pointerDown(screen.getByTestId('text'), { button: 1, ctrlKey: true, pointerId: 1 })).toBe(true);
    expect(fireEvent.pointerDown(screen.getByTestId('text'), { button: 0, clientX: 200, clientY: 200, pointerId: 2 })).toBe(true);
    fireEvent.pointerMove(body, { clientX: 100, clientY: 100, pointerId: 2 });
    expect(body).not.toHaveClass(PREVIEW_PANNING_CLASS);
    expect(column.scrollTop).toBe(0);
  });
});
