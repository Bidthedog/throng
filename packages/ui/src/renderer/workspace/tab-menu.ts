/**
 * A Tab's right-click menu (033 US5, T062a/T064 — extracted from `tab-group.tsx`'s inline
 * `menuItems` arrow).
 *
 * It was a closure over component state, which is exactly why it could not be tested below E2E, so
 * the extraction takes what it needs as arguments. Nothing about what the menu draws changed — no
 * label, no icon, no action, no condition (N6, FR-053).
 *
 * Sections: Content (Rename) · Destroy (Destroy Tab, Destroy other tabs) · Navigate (Sync to).
 * *Sync to* therefore moves from second to LAST. That is FR-047's fixed order — the constitution's
 * own example of a Navigate item — and FR-053 protects order **within** a section, not across them.
 */
import type { MenuAction } from './context-menu.js';

export interface TabMenuDetach {
  /** The sub-workspaces this Tab can be synced into. */
  subWorkspaces: readonly { id: string; name: string }[];
  /** Detach this Tab into a NEW sub-workspace window. */
  detachToNew: (tabId: string) => void;
  /** Clone this Tab into an existing sub-workspace. */
  syncToExisting: (tabId: string, subWorkspaceId: string) => void;
}

export interface TabMenuArgs {
  tabId: string;
  /**
   * P10 / FR-046 — the close affordance is unavailable exactly where Destroy Tab is. In a
   * sub-workspace the last Tab IS closeable (it closes the whole sub-workspace, FR-029); in the main
   * window a project keeps its last Tab.
   */
  destroyTabDisabled: boolean;
  /** There are no OTHER tabs to destroy. */
  destroyOthersDisabled: boolean;
  /**
   * Sub-workspace targets. `null` inside a sub-workspace window (no detach context), where the item
   * is absent rather than disabled — an empty Navigate group draws no divider.
   */
  detach: TabMenuDetach | null;
  actions: {
    rename: (tabId: string) => void;
    destroyTab: (tabId: string) => void;
    destroyOthers: (tabId: string) => void;
  };
}

export function tabContextMenu(args: TabMenuArgs): MenuAction[] {
  const { tabId, destroyTabDisabled, destroyOthersDisabled, detach, actions } = args;

  const items: MenuAction[] = [
    { label: 'Rename', icon: 'rename', section: 'content', onClick: () => actions.rename(tabId) },
  ];

  // Sync (clone) this Tab into a sub-workspace (US7). Hidden in a sub-workspace
  // window (no detach context). "New Window" creates a new sub-workspace; an
  // existing one gets the Tab added. Cloning leaves the Tab in place.
  if (detach) {
    items.push({
      label: 'Sync to',
      icon: 'send',
      section: 'navigate',
      submenu: [
        {
          label: 'New Sub-workspace',
          icon: 'detach',
          section: 'navigate',
          onClick: () => detach.detachToNew(tabId),
        },
        ...detach.subWorkspaces.map((s) => ({
          label: s.name,
          icon: 'tab',
          section: 'navigate' as const,
          onClick: () => detach.syncToExisting(tabId, s.id),
        })),
      ],
    });
  }

  items.push({
    label: 'Destroy Tab',
    icon: 'destroy',
    section: 'destroy',
    onClick: () => actions.destroyTab(tabId),
    disabled: destroyTabDisabled,
  });
  items.push({
    label: 'Destroy other tabs',
    icon: 'destroy',
    section: 'destroy',
    onClick: () => actions.destroyOthers(tabId),
    disabled: destroyOthersDisabled,
  });

  return items;
}
