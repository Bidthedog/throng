/**
 * Builds the file-tree right-click menu (004, T051, FR-020). Offers the
 * actionable operations + "Open in file explorer"; paste is disabled when the
 * clipboard is empty; the root cannot be renamed/cut/copied/deleted. Structured
 * so more items can be added as the feature grows.
 */
import type { MenuItem } from '../workspace/context-menu.js';
import type { ClipboardState } from './use-explorer-data.js';
import { firstBinding, type Keybindings, type TargetNode } from '@throng/core';

export interface ContextMenuOps {
  beginRename: (relPath: string) => void;
  cut: (relPaths: string[]) => void;
  copy: (relPaths: string[]) => void;
  paste: (target: TargetNode) => void;
  remove: (relPaths: string[]) => void;
  reveal: (relPath: string) => void;
  hide: (relPath: string) => void;
  /** Create a new folder under the target (a folder → itself; a file → its parent). */
  newFolder: (target: TargetNode) => void;
  /** Create a new file under the target (a folder → itself; a file → its parent). */
  newFile: (target: TargetNode) => void;
}

export function buildContextMenuItems(args: {
  node: TargetNode;
  selectedRelPaths: string[];
  clipboard: ClipboardState;
  ops: ContextMenuOps;
  /** Editor "Open In" targets for a file (006, FR-011a) — appended under Open In,
   *  after OS File Explorer. Absent for folders/root. */
  openIn?: MenuItem[];
  /** Live keybindings (US1, #125) — the first bound chord of each file.* action is shown in
   *  brackets on its menu item. Absent → no shortcuts (unchanged rendering). */
  keybindings?: Keybindings;
}): MenuItem[] {
  const { node, selectedRelPaths, clipboard, ops, openIn, keybindings } = args;
  // US1 (#125): the first bound chord for an explorer command, or undefined (→ no brackets).
  const sc = (action: string): string | undefined =>
    keybindings ? firstBinding(keybindings, action as never) : undefined;
  const isRoot = node.relPath === '';
  // Operate on the whole selection when the right-clicked node is part of it;
  // otherwise just on that node.
  const targets =
    selectedRelPaths.length > 0 && selectedRelPaths.includes(node.relPath)
      ? selectedRelPaths
      : [node.relPath];

  const items: MenuItem[] = [];
  if (!isRoot) {
    items.push({ label: 'Rename', icon: 'rename', shortcut: sc('file.rename'), onClick: () => ops.beginRename(node.relPath) });
    items.push({ label: 'Cut', shortcut: sc('file.cut'), onClick: () => ops.cut(targets) });
    items.push({ label: 'Copy', shortcut: sc('file.copy'), onClick: () => ops.copy(targets) });
  }
  items.push({ label: 'Paste', disabled: clipboard === null, shortcut: sc('file.paste'), onClick: () => ops.paste(node) });
  items.push({ label: 'New File', icon: 'add', onClick: () => ops.newFile(node) });
  items.push({ label: 'New Folder', icon: 'newFolder', onClick: () => ops.newFolder(node) });
  if (!isRoot) {
    items.push({ label: 'Delete', icon: 'destroy', shortcut: sc('file.delete'), onClick: () => ops.remove(targets) });
  }
  // A single, consistently-named OS reveal for BOTH files and folders (FR-107).
  // Files ALSO get an "Open In" submenu of editor targets only (no reveal duplicate).
  if (openIn && openIn.length > 0) {
    items.push({ label: 'Open In', icon: 'send', submenu: openIn });
  }
  items.push({ label: 'Open in OS File Explorer', onClick: () => ops.reveal(node.relPath) });
  if (!isRoot) {
    items.push({ label: 'Hide in this project', onClick: () => ops.hide(node.relPath) });
  }
  return items;
}
