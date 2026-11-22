/**
 * A setting-toggle menu row draws its icon as the status bar's toggle does: plain while on, struck through while off
 * (076 FR-005, the terminal content menu; maintainer, 2026-11-22).
 *
 * Layer: component — the off line is a class on the rendered icon; jsdom shows which rows carry it.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu } from '../../src/renderer/workspace/context-menu.js';

afterEach(cleanup);

const iconOf = (label: string): Element => screen.getByTestId(`menu-item-${label}`).querySelector('.context-menu__icon')!;

describe('a setting-toggle menu row', () => {
  it('strikes its icon through only while the setting is off', () => {
    render(
      createElement(ContextMenu, {
        x: 10,
        y: 10,
        items: [
          { label: 'On', testId: 'menu-item-On', section: 'viewState', icon: 'rememberCommand', checked: true, settingToggle: true, onClick: vi.fn() },
          { label: 'Off', testId: 'menu-item-Off', section: 'viewState', icon: 'rememberDirectory', checked: false, settingToggle: true, onClick: vi.fn() },
          { label: 'Plain', testId: 'menu-item-Plain', section: 'viewState', icon: 'copy', onClick: vi.fn() },
        ],
        onClose: vi.fn(),
      }),
    );
    expect(iconOf('On').classList.contains('setting-toggle-icon--off')).toBe(false);
    expect(iconOf('Off').classList.contains('setting-toggle-icon--off')).toBe(true);
    expect(iconOf('Off').querySelector('.icon, svg, img')).not.toBeNull();
    expect(iconOf('Plain').classList.contains('setting-toggle-icon--off')).toBe(false);
  });
});
