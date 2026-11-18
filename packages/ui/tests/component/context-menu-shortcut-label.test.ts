/**
 * A menu row's shortcut reads as the platform names it (070 FR-029): `Cmd+C` on macOS, as Preferences shows it,
 * never the raw binding token `Meta+C`; on Windows and Linux the token is its own label.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WINDOWS_HOST_TRAITS, configureHostTraits, macosHostTraits } from '@throng/core';
import { ContextMenu } from '../../src/renderer/workspace/context-menu.js';

function menuWith(shortcut: string): HTMLElement {
  render(
    createElement(ContextMenu, {
      x: 10,
      y: 10,
      items: [{ label: 'Copy', section: 'content', shortcut, onClick: vi.fn() }],
      onClose: vi.fn(),
    }),
  );
  return screen.getByTestId('menu-shortcut-Copy');
}

afterEach(() => {
  cleanup();
  configureHostTraits(WINDOWS_HOST_TRAITS);
});

describe('a menu row’s shortcut text', () => {
  it('on macOS reads Cmd and Option, in Apple’s order', () => {
    configureHostTraits(macosHostTraits('/tmp/throng-ipc', []));
    expect(menuWith('Meta+C').textContent).toBe('(Cmd+C)');
    cleanup();
    expect(menuWith('Shift+Alt+Meta+V').textContent).toBe('(Option+Shift+Cmd+V)');
  });

  // Measured on a hosted macOS runner: the open menu got `c` with metaKey true and stayed open.
  it('on macOS, Cmd+C runs the row whose shortcut is Meta+C and closes the menu', () => {
    configureHostTraits(macosHostTraits('/tmp/throng-ipc', []));
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(
      createElement(ContextMenu, {
        x: 10,
        y: 10,
        items: [{ label: 'Copy', section: 'content', shortcut: 'Meta+C', onClick }],
        onClose,
      }),
    );
    fireEvent.keyDown(screen.getByTestId('context-menu'), { key: 'c', code: 'KeyC', metaKey: true });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('on Windows is the binding token as written', () => {
    expect(menuWith('Ctrl+C').textContent).toBe('(Ctrl+C)');
  });
});
