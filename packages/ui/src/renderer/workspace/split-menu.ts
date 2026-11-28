/**
 * The shared Split menu (048 R3, contracts/menus-commands-controls.md "The Split item").
 *
 * ONE builder feeds every surface that offers a split: the panel title menu (as a submenu) and the panel's **+**
 * button (as the four items alone). The v1 review (#732) took Split out of every body menu: it acts on the panel, not
 * on the content under the pointer. Surfaces that each listed the directions by hand is how the order, a label or a
 * chord display ends up different on one of them.
 *
 * The chord each row shows is the command's CURRENT binding (`firstBinding`), so a rebind moves what
 * the menu says as well as what the keys do. The action bodies stay at the call site: what "split this
 * panel" means needs the workspace store, which a pure builder does not hold.
 */
import { firstBinding, type ActionId, type Keybindings, type SplitDirection } from '@throng/core';
import type { MenuAction } from './context-menu.js';
import { isPanelTabMaximised } from './maximise-store.js';

/** The menu's order is the contract's order (FR-010): Down, Up, Right, Left. */
const SPLIT_ROWS: readonly { direction: SplitDirection; label: string; action: ActionId }[] = [
  { direction: 'down', label: 'Split Down', action: 'panel.splitDown' },
  { direction: 'up', label: 'Split Up', action: 'panel.splitUp' },
  { direction: 'right', label: 'Split Right', action: 'panel.splitRight' },
  { direction: 'left', label: 'Split Left', action: 'panel.splitLeft' },
];

/** What a surface hands in: split THIS panel (not "the active one") in this direction. */
export type RunSplit = (panelId: string, direction: SplitDirection) => void;

/** The four split rows alone — the **+** button's menu, where a parent "Split" row would be noise. */
export function splitMenuItems(panelId: string, keybindings: Keybindings, run: RunSplit): MenuAction[] {
  // 054 FR-074 — while the panel's tab has something maximised, adding panels is off: the rows are drawn
  // disabled, never hidden (Principle VI). Read here so every surface built from this one builder agrees.
  const maximised = isPanelTabMaximised(panelId);
  return SPLIT_ROWS.map(
    (row): MenuAction => ({
      label: row.label,
      section: 'create',
      shortcut: firstBinding(keybindings, row.action),
      ...(maximised ? { disabled: true } : {}),
      onClick: () => run(panelId, row.direction),
    }),
  );
}

/** One "Split" row whose submenu is the four items — the panel title menu (FR-015). */
export function splitSubmenu(panelId: string, keybindings: Keybindings, run: RunSplit): MenuAction {
  return {
    label: 'Split',
    icon: 'add',
    section: 'create',
    // 054 FR-074 — the whole row is disabled while the tab is maximised: a disabled parent opens no submenu.
    ...(isPanelTabMaximised(panelId) ? { disabled: true } : {}),
    submenu: splitMenuItems(panelId, keybindings, run),
  };
}
