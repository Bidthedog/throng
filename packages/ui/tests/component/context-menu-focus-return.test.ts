/**
 * A menu hands focus back to the element that opened it once its action has run (#157 follow-up) — and that handback
 * does not scroll. An action can move the view away from its opener: Open Link on a PDF page link goes to the page it
 * names (074 T083). Focusing the opener with the browser's default scroll then pulled the view straight back to the
 * link, so Open Link went to page 3 and returned to page 1 in the same frame (MT-34, walk-through 2026-11-21).
 *
 * Layer: component — the real ContextMenu; the opener's `focus` is observed, since jsdom does no scrolling of its own.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu } from '../../src/renderer/workspace/context-menu.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('a menu returns focus to its opener after an action, without scrolling to it', () => {
  it('focuses the opener with preventScroll, so an action that moved the view keeps its place', async () => {
    const opener = document.createElement('a');
    opener.href = '#page-3';
    document.body.append(opener);
    const focus = vi.spyOn(opener, 'focus');
    const moved = vi.fn();
    const { rerender } = render(
      createElement(ContextMenu, { x: 10, y: 10, items: [{ label: 'Open Link', onClick: moved, section: 'contextual' }], onClose: () => undefined, opener }),
    );
    fireEvent.click(screen.getByTestId('menu-item-Open Link'));
    rerender(createElement('div'));
    (document.activeElement as HTMLElement | null)?.blur();
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

    expect(moved).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
