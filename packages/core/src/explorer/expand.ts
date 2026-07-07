/**
 * Level-by-level, context-sensitive "Expand" for the file tree (004, FR-032).
 * Pure. Each Expand click opens the SHALLOWEST ring of still-collapsed folders
 * reachable from an anchor (the selected folder, a selected file's parent, or
 * the root). A collapsed anchor folder opens itself first; an already-open
 * anchor opens the next collapsed level inside it. Because targets are derived
 * from the current open-state, "Collapse all" naturally restarts at level 1
 * (no remembered depth). No OS/DOM.
 */

/** A lightweight view of the tree carrying only what the algorithm needs. */
export interface ExpandNode {
  relPath: string;
  kind: 'file' | 'folder';
  open: boolean;
  /** Present (loaded) only for OPEN folders; closed folders need no children. */
  children?: ExpandNode[];
}

function findNode(node: ExpandNode, relPath: string): ExpandNode | null {
  if (node.relPath === relPath) return node;
  for (const child of node.children ?? []) {
    const hit = findNode(child, relPath);
    if (hit) return hit;
  }
  return null;
}

function childFolders(node: ExpandNode): ExpandNode[] {
  return (node.children ?? []).filter((c) => c.kind === 'folder');
}

/**
 * Returns the relPaths of folders to open for this Expand click, given the tree
 * `root` (open folders carry loaded `children`) and the `anchorRelPath`
 * (a folder relPath; "" = root). Empty when nothing remains to expand.
 */
export function nextExpandTargets(root: ExpandNode, anchorRelPath: string): string[] {
  const anchor = findNode(root, anchorRelPath) ?? root;

  // A collapsed (non-root) anchor folder opens itself first.
  if (anchor.kind === 'folder' && !anchor.open && anchor.relPath !== '') {
    return [anchor.relPath];
  }

  // An open anchor: breadth-first through its open subtree for the shallowest
  // level that still has collapsed folders; open all collapsed folders there.
  let frontier = childFolders(anchor);
  while (frontier.length > 0) {
    const closed = frontier.filter((f) => !f.open);
    if (closed.length > 0) return closed.map((f) => f.relPath);
    frontier = frontier.flatMap(childFolders);
  }
  return [];
}
