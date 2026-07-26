/**
 * What a file-tree drag carries to a drop target OUTSIDE the tree (024 US2/US4, #155/#114).
 *
 * The tree's own drag runs on react-arborist's react-dnd channel, which a native drop target on a
 * terminal or an empty panel cannot read. So on drag start the tree records the dragged items here
 * and a panel's native `drop` reads them back. This module is the pure decision — which rows the
 * gesture is actually about, and what their absolute paths are — kept out of the DOM handler so it
 * can be tested without a browser.
 */

export interface TreeDragPayload {
  /** Absolute paths of the dragged items, in selection order. */
  paths: string[];
  /**
   * True iff the drag is exactly ONE file — not a folder, not a multi-selection. US4 accepts only
   * this onto an empty panel (a panel cannot open a folder); US2 ignores it and takes every path.
   */
  singleFile: boolean;
}

export interface TreeDragInput {
  /** The project's root folder, in its native form (drive path or POSIX). */
  rootFolder: string;
  /** The `/`-joined relPath of the row the user actually grabbed. */
  draggedRelPath: string;
  /** Whether the grabbed row is a file or a folder. */
  draggedKind: 'file' | 'folder';
  /** The tree's current selection, in selection order. */
  selectedRelPaths: readonly string[];
}

/** An item's OS-native absolute path from the project root + its `/`-joined relPath. */
export function toAbsPath(rootFolder: string, relPath: string): string {
  const sep = rootFolder.includes('\\') ? '\\' : '/';
  const root = rootFolder.replace(/[\\/]+$/, '');
  return relPath ? `${root}${sep}${relPath.split('/').join(sep)}` : root;
}

/**
 * Decide what a drag gesture carries, or `null` when it carries nothing droppable.
 *
 * The selection rule mirrors react-arborist's own: the whole selection travels only when the grabbed
 * row belongs to it. Dragging an UNSELECTED row carries that row alone — otherwise grabbing a file
 * while three others happen to be selected pastes four paths the user never pointed at, and the drop
 * looks identical either way, so nothing tells them it went wrong.
 */
export function buildTreeDragPayload(input: TreeDragInput): TreeDragPayload | null {
  const { rootFolder, draggedRelPath, draggedKind, selectedRelPaths } = input;
  const rels =
    selectedRelPaths.length > 0 && selectedRelPaths.includes(draggedRelPath)
      ? [...selectedRelPaths]
      : [draggedRelPath];
  // The root row has no relPath, and "the project" is not an item the user picked to drop.
  if (rels.length === 0 || (rels.length === 1 && rels[0] === '')) return null;
  return {
    paths: rels.map((r) => toAbsPath(rootFolder, r)),
    singleFile: rels.length === 1 && draggedKind === 'file',
  };
}
