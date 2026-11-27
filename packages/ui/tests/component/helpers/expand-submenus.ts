import { fireEvent, screen } from '@testing-library/react';

/**
 * Opens one submenu of the context menu on screen (Insert ▸, Copy as ▸), so a test finds its rows by test id as it
 * found the flat rows they used to be. A click on a parent row opens its flyout, as a hover dwell does; a menu level
 * holds one flyout open at a time.
 */
export function openSubmenu(parent: string): void {
  fireEvent.click(screen.getByTestId(`menu-item-${parent}`));
}

/** Right-click `el`, then open its `parent` submenu. */
export function menuWithSubmenu(el: HTMLElement, parent: string): void {
  fireEvent.contextMenu(el, { clientX: 5, clientY: 5 });
  openSubmenu(parent);
}
