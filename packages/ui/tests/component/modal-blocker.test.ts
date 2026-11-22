/**
 * Print Preview's modality on Linux (075 FR-071; maintainer, 2026-11-22). A natively modal child disables its
 * parent, and a disabled window on Wayland never sets its own cursor as the pointer enters it, so the resize
 * cursor from the preview's edge stayed on screen. On Linux the parent stays enabled and this layer takes its
 * input instead: while main says a modal window is open, nothing under it can be clicked, and the pointer over it
 * is the ordinary arrow.
 *
 * Layer: component — what reaches the window's content while the layer is up is a DOM question.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModalBlocker } from '../../src/renderer/common/modal-blocker.js';

let signal: ((blocked: boolean) => void) | null = null;

function mount(onClick: () => void): void {
  Reflect.set(window, 'throng', {
    window: {
      onModalBlock: (cb: (blocked: boolean) => void) => {
        signal = cb;
        return () => {
          signal = null;
        };
      },
    },
  });
  render(
    createElement(
      Fragment,
      null,
      createElement('button', { 'data-testid': 'under', onClick }, 'Under'),
      createElement(ModalBlocker),
    ),
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  signal = null;
});

describe('the window beneath a modal Print Preview (Linux)', () => {
  it('is covered while the modal is open, takes no click, and is uncovered when it closes', () => {
    const onClick = vi.fn();
    mount(onClick);
    expect(screen.queryByTestId('modal-blocker')).toBeNull();

    act(() => signal?.(true));
    const layer = screen.getByTestId('modal-blocker');
    expect(layer).toHaveClass('modal-blocker');
    fireEvent.mouseDown(layer);
    fireEvent.click(layer);
    expect(onClick).not.toHaveBeenCalled();

    act(() => signal?.(false));
    expect(screen.queryByTestId('modal-blocker')).toBeNull();
    fireEvent.click(screen.getByTestId('under'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
