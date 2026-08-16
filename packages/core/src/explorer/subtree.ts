/**
 * Subtree targets for Collapse All Children and Expand All Children (033 US4 —
 * FR-039 to FR-042, contracts/explorer-actions.md §B.1, C1–C5).
 *
 * Both read the same `ExpandNode` view `nextExpandTargets` reads: a second tree
 * shape describing the same tree is the duplication Principle VIII forbids, and
 * C5 exists to say so (hence the import rather than a local interface).
 *
 * Pure. No OS, no DOM — the caller owns loading children and applying opens.
 */

import { childFolders, findNode, type ExpandNode } from './expand.js';

/**
 * Every OPEN folder strictly beneath `relPath`, at every depth, **deepest
 * first** — so a caller can close them in a single pass without a child
 * outliving its parent's collapse.
 *
 * The anchor is excluded, which is what leaves the folder itself open (C1).
 * Returns `[]` when nothing beneath it is expanded, when it is a file, and when
 * it is not in the tree — in each case the caller changes nothing and errors on
 * nothing (C3).
 *
 * A CLOSED anchor yields `[]` as well, and that is the CALLER's precondition
 * rather than a check made here — this function never reads `anchor.open`. It
 * holds because `ExpandNode.children` is loaded only for open folders (see
 * `expand.ts`), so a closed anchor has nothing to walk; `use-explorer-data.ts`
 * builds `children: undefined` for one, and `immediateChildFolders` below rests
 * on the same invariant. Left as a precondition deliberately: a guard would be a
 * second copy of something the view type already declares, and it would have to
 * decide what a closed folder carrying loaded children means — a shape no caller
 * in this codebase can produce, and which YAGNI says not to answer for.
 */
export function descendantOpenFolders(root: ExpandNode, relPath: string): string[] {
  const anchor = findNode(root, relPath);
  if (!anchor) return [];

  const found: { relPath: string; depth: number }[] = [];
  const visit = (node: ExpandNode, depth: number): void => {
    for (const child of childFolders(node)) {
      if (!child.open) continue; // closed: not a target, and no loaded children
      found.push({ relPath: child.relPath, depth });
      visit(child, depth + 1);
    }
  };
  visit(anchor, 1);

  // Stable sort: deepest first, tree order preserved within a depth.
  return found.sort((a, b) => b.depth - a.depth).map((f) => f.relPath);
}

/**
 * The IMMEDIATE child folders of `relPath` — one level, never recursive, so a
 * grandchild is never returned (C4). Open and closed children alike: the closed
 * ones are what Expand All Children opens, and the open ones are already there.
 *
 * Returns `[]` for a folder with no child folders, for a closed folder (whose
 * children are not loaded yet — FR-042 has the caller open it first), for a
 * file, and for an anchor that is not in the tree.
 */
export function immediateChildFolders(root: ExpandNode, relPath: string): string[] {
  const anchor = findNode(root, relPath);
  if (!anchor) return [];
  return childFolders(anchor).map((c) => c.relPath);
}
