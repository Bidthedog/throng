/**
 * Explorer toolbar (004, T026, FR-031/032) — themed icon buttons above the tree.
 * Expand opens the next collapsed level relative to the selection; Collapse all
 * resets to the root. (New folder lands in US3.)
 */
import { type ReactElement } from 'react';
import { resolveIcon } from '@throng/core';
import { useActiveTheme } from '../config/config-store.js';

export function ExplorerToolbar({
  onExpand,
  onCollapseAll,
  onNewFolder,
  onDelete,
}: {
  onExpand: () => void;
  onCollapseAll: () => void;
  onNewFolder: () => void;
  onDelete: () => void;
}): ReactElement {
  const theme = useActiveTheme();
  return (
    <div className="explorer-toolbar" data-testid="explorer-toolbar">
      <button
        type="button"
        className="explorer-toolbar__btn"
        title="Expand (next level of the selection)"
        aria-label="Expand"
        onClick={onExpand}
      >
        {resolveIcon(theme, 'expandAll')}
      </button>
      <button
        type="button"
        className="explorer-toolbar__btn"
        title="Collapse all"
        aria-label="Collapse all"
        onClick={onCollapseAll}
      >
        {resolveIcon(theme, 'collapseAll')}
      </button>
      <button
        type="button"
        className="explorer-toolbar__btn"
        title="New folder"
        aria-label="New folder"
        onClick={onNewFolder}
      >
        {resolveIcon(theme, 'newFolder')}
      </button>
      <button
        type="button"
        className="explorer-toolbar__btn explorer-toolbar__btn--danger"
        title="Delete"
        aria-label="Delete"
        onClick={onDelete}
      >
        {resolveIcon(theme, 'destroy')}
      </button>
    </div>
  );
}
