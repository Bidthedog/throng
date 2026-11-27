import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu, type MenuAction } from '../../src/renderer/workspace/context-menu.js';

/**
 * A root menu taller than its window scrolls inside it (the v1 review's menu order put Destroy Panel last, and a
 * small sub-workspace window then drew it below its bottom edge, where it could not be clicked).
 *
 * jsdom lays nothing out, so the menu's natural height (`scrollHeight`) and the window's are set here.
 */
const rows = (n: number): MenuAction[] =>
  Array.from({ length: n }, (_, i) => ({ label: `Row ${i}`, section: 'content' as const, onClick: () => {} }));

function withHeights(natural: number, windowHeight: number): void {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(natural);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(windowHeight);
}

afterEach(() => vi.restoreAllMocks());

const menu = (): HTMLElement => screen.getByTestId('menu-item-Row 0').closest('[role="menu"]') as HTMLElement;

describe('a context menu taller than its window', () => {
  it('is capped at the window height, less its edge gaps, and scrolls', () => {
    withHeights(900, 300);
    render(createElement(ContextMenu, { x: 10, y: 10, items: rows(30), onClose: vi.fn(), submenuDelayMs: 60_000 }));
    expect(menu().style.maxHeight).toBe('292px');
    expect(menu().style.overflowY).toBe('auto');
    expect(Number.parseFloat(menu().style.top)).toBeGreaterThanOrEqual(0);
  });

  it('that fits keeps no cap, so its submenus can open beside it', () => {
    withHeights(200, 800);
    render(createElement(ContextMenu, { x: 10, y: 10, items: rows(5), onClose: vi.fn(), submenuDelayMs: 60_000 }));
    expect(menu().style.maxHeight).toBe('');
    expect(menu().style.overflowY).toBe('');
  });
});
