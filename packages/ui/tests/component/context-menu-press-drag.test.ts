/**
 * Pressing on one menu item and dragging onto another (reported in 049's manual testing, 2026-10-02).
 *
 * Releasing on a different item rightly runs nothing — a click needs the press and the release on the same
 * item. But the PRESS gave the first item DOM focus (items are focusable, for the roving keyboard focus), and
 * `.context-menu__item:focus` paints the same highlight as `:hover` (theme.css, 018 FR-013a). So while the
 * pointer sat on the second item, two items were highlighted: the pressed one by focus, the other by hover.
 *
 * jsdom applies no stylesheet, so this asserts the cause the highlight follows from: which element holds
 * focus. user-event's pointer, unlike `fireEvent`, moves focus on a press the way a browser does.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu, type MenuAction } from '../../src/renderer/workspace/context-menu.js';

function renderMenu(): { first: ReturnType<typeof vi.fn>; second: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  const first = vi.fn();
  const second = vi.fn();
  const onClose = vi.fn();
  const items: MenuAction[] = [
    { label: 'First', section: 'navigate', onClick: first },
    { label: 'Second', section: 'navigate', onClick: second },
  ];
  render(createElement(ContextMenu, { x: 10, y: 10, items, onClose }));
  return { first, second, onClose };
}

describe('a press on one menu item dragged onto another', () => {
  it('leaves the pressed item without focus, so only the item under the pointer is highlighted', async () => {
    renderMenu();
    const user = userEvent.setup();
    const first = screen.getByTestId('menu-item-First');
    const second = screen.getByTestId('menu-item-Second');

    await user.pointer([{ keys: '[MouseLeft>]', target: first }, { target: second }]);

    expect(document.activeElement).not.toBe(first);
    expect(first.matches(':focus')).toBe(false);
  });

  it('runs nothing when released on the other item', async () => {
    const { first, second, onClose } = renderMenu();
    const user = userEvent.setup();
    await user.pointer([
      { keys: '[MouseLeft>]', target: screen.getByTestId('menu-item-First') },
      { target: screen.getByTestId('menu-item-Second') },
      { keys: '[/MouseLeft]', target: screen.getByTestId('menu-item-Second') },
    ]);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still runs an item clicked in place, and arrow keys still move a visible focus', async () => {
    const { second, onClose } = renderMenu();
    const user = userEvent.setup();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByTestId('menu-item-First'));
    await user.click(screen.getByTestId('menu-item-Second'));
    expect(second).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});
