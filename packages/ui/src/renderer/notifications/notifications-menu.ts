import type { NotificationActionDescriptor, NotificationEntry, NotificationOrder } from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';

/**
 * The Notifications panel's context menus (068 Principle VI: every panel action has a menu item; a
 * header icon is an accelerator over the menu, not a substitute for it).
 */

/** What each order is called, in the order the menu and the header's order menu list them (FR-028). */
export const ORDER_LABELS: Readonly<Record<NotificationOrder, string>> = {
  oldest: 'Oldest first',
  newest: 'Newest first',
  'priority-oldest': 'Priority, oldest first',
  'priority-newest': 'Priority, newest first',
};

const ORDERS = Object.keys(ORDER_LABELS) as NotificationOrder[];

/** The four orders as menu rows; the current one carries a tick, and keeps the same test id. */
export function orderMenuItems(order: NotificationOrder, onSetOrder: (order: NotificationOrder) => void): MenuAction[] {
  return ORDERS.map((o) => ({
    label: o === order ? `${ORDER_LABELS[o]} ✓` : ORDER_LABELS[o],
    testId: `menu-item-${ORDER_LABELS[o]}`,
    icon: 'sortOrder',
    section: 'viewState' as const,
    onClick: () => onSetOrder(o),
  }));
}

export interface PanelMenuInput {
  minimised: boolean;
  order: NotificationOrder;
  hasEntries: boolean;
  onSetOrder: (order: NotificationOrder) => void;
  onDismissAll: () => void;
  onToggleMinimise: () => void;
}

/** The panel's own menu: Dismiss all, the order, and Minimise or Restore (FR-026, FR-028, FR-036). */
export function buildPanelMenu(input: PanelMenuInput): MenuAction[] {
  return [
    {
      label: 'Dismiss all',
      icon: 'dismissAll',
      section: 'destroy',
      disabled: !input.hasEntries,
      onClick: input.onDismissAll,
    },
    ...orderMenuItems(input.order, input.onSetOrder),
    {
      label: input.minimised ? 'Restore' : 'Minimise',
      icon: input.minimised ? 'restorePanel' : 'minimisePanel',
      section: 'viewState',
      onClick: input.onToggleMinimise,
    },
  ];
}

export interface EntryMenuInput {
  entry: NotificationEntry;
  /** The descriptors whose targets still exist (FR-031a). */
  actions: readonly NotificationActionDescriptor[];
  onCopy: () => void;
  onDismiss: () => void;
  onRun: (action: NotificationActionDescriptor) => void;
}

/** One entry's menu: Copy, each action it offers, Dismiss. */
export function buildEntryMenu(input: EntryMenuInput): MenuAction[] {
  return [
    { label: 'Copy', icon: 'copy', section: 'content', onClick: input.onCopy },
    ...input.actions.map((action) => ({
      label: action.label,
      icon: iconFor(action),
      section: 'navigate' as const,
      onClick: () => input.onRun(action),
    })),
    { label: 'Dismiss', icon: 'dismiss', section: 'destroy', onClick: input.onDismiss },
  ];
}

/** The theme token an action descriptor is drawn with. */
export function iconFor(action: NotificationActionDescriptor): string {
  switch (action.kind) {
    case 'goToPanel':
      return 'activate';
    case 'openFile':
      return 'quickOpen';
    case 'openPreferences':
      return 'settings';
  }
}
