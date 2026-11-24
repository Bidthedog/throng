/**
 * US6 (#137) — ask the File Explorer to reveal a path in throng's own tree: expand its ancestors, select
 * its row and scroll it into view. `file-tree.tsx` listens for the event and reveals only a path under
 * ITS project's root, so a caller never needs to know which tree is mounted.
 *
 * The one reveal behind the panel header's **Reveal File in File Explorer** and the Link menu's **Find
 * in File Explorer** (#714), so the two cannot drift. A folder reveals as itself: `revealInTree` opens
 * the ancestors and selects whatever row the path names.
 */
export const REVEAL_IN_TREE_EVENT = 'throng:reveal-in-tree';

export function revealInFileExplorer(absPath: string | null | undefined): void {
  window.dispatchEvent(new CustomEvent(REVEAL_IN_TREE_EVENT, { detail: { absPath: absPath ?? undefined } }));
}
