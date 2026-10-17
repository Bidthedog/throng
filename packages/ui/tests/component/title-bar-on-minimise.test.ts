/**
 * `onMinimise` on the title bar and its window controls (055 T118, FR-081, FR-085): a window that is
 * closed by its minimise (the Resource Monitor shrinks into the status bar and closes) replaces the OS
 * minimise with its own handler; every other caller is unchanged.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TitleBar } from '../../src/renderer/title-bar/title-bar.js';

function stubWindowBridge() {
  const bridge = {
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    onMaximizeChange: vi.fn(() => () => {}),
  };
  window.throng = { window: bridge };
  return bridge;
}

afterEach(() => {
  delete window.throng;
});

describe('onMinimise', () => {
  it('runs instead of the OS minimise when given', () => {
    const bridge = stubWindowBridge();
    const onMinimise = vi.fn();
    render(createElement(TitleBar, { identity: 'Resource Monitor', onMinimise }));

    fireEvent.click(screen.getByTestId('window-min'));

    expect(onMinimise).toHaveBeenCalledTimes(1);
    expect(bridge.minimize).not.toHaveBeenCalled();
  });

  it('leaves every caller without it on the OS minimise', () => {
    const bridge = stubWindowBridge();
    render(createElement(TitleBar, { identity: 'throng' }));

    fireEvent.click(screen.getByTestId('window-min'));

    expect(bridge.minimize).toHaveBeenCalledTimes(1);
  });

  it('does not touch Maximise or Close', () => {
    const bridge = stubWindowBridge();
    render(createElement(TitleBar, { identity: 'Resource Monitor', onMinimise: vi.fn() }));

    fireEvent.click(screen.getByTestId('window-max'));
    fireEvent.click(screen.getByTestId('window-close'));

    expect(bridge.maximize).toHaveBeenCalledTimes(1);
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });
});
