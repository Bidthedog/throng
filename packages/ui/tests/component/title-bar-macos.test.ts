/**
 * The title bar under macOS traits (070 FR-026, research R16): the native traffic lights sit in it, so throng's own
 * window controls are not drawn and the bar reserves their inset on the left. Windows and Linux are unchanged.
 *
 * Layer: component — the bar takes props and host traits and nothing else; that the lights are really there is the
 * `@macos` E2E's (`macos-window.e2e.ts`).
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WINDOWS_HOST_TRAITS, configureHostTraits, linuxHostTraits, macosHostTraits } from '@throng/core';
import { TitleBar } from '../../src/renderer/title-bar/title-bar.js';

function stubWindowBridge(): void {
  window.throng = {
    window: {
      minimize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => Promise.resolve(false)),
      onMaximizeChange: vi.fn(() => () => {}),
    },
  };
}

afterEach(() => {
  configureHostTraits(WINDOWS_HOST_TRAITS);
  delete window.throng;
});

const bar = (): HTMLElement => screen.getByTestId('title-bar');

describe('the title bar on macOS (070 FR-026)', () => {
  it('draws no window controls and reserves the traffic-light inset, for every kind of window', () => {
    configureHostTraits(macosHostTraits('/tmp/throng', []));
    stubWindowBridge();
    for (const props of [{}, { closeOnly: true }, { showMinimise: false }]) {
      const { unmount } = render(createElement(TitleBar, { identity: 'throng', ...props }));
      expect(screen.queryByTestId('window-controls')).toBeNull();
      expect(bar()).toHaveClass('title-bar--traffic-lights');
      unmount();
    }
  });

  it('still double-clicks to zoom, as a native title bar does', () => {
    configureHostTraits(macosHostTraits('/tmp/throng', []));
    stubWindowBridge();
    render(createElement(TitleBar, { identity: 'throng' }));
    bar().querySelector('.title-bar__drag-zone')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(window.throng?.window?.maximize).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Windows', WINDOWS_HOST_TRAITS],
    ['Linux', linuxHostTraits('/run/x')],
  ])('keeps its own window controls and no inset on %s', (_name, traits) => {
    configureHostTraits(traits);
    stubWindowBridge();
    render(createElement(TitleBar, { identity: 'throng' }));
    expect(screen.getByTestId('window-controls')).toBeInTheDocument();
    expect(bar()).not.toHaveClass('title-bar--traffic-lights');
  });
});
