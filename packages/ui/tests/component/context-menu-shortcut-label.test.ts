/**
 * A menu row's shortcut reads as the platform names it (070 FR-029): `Cmd+C` on macOS, as Preferences shows it,
 * never the raw binding token `Meta+C`; on Windows and Linux the token is its own label.
 */
import { cleanup, render, screen } from '@testing-library/react';
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

  it('on Windows is the binding token as written', () => {
    expect(menuWith('Ctrl+C').textContent).toBe('(Ctrl+C)');
  });
});
