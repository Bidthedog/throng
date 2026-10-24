/**
 * The node the detail pane describes and the charts plot (055 FR-060): the row the user selected, or —
 * with nothing selected, or the selection gone — the node in focus.
 */
import { useMemo } from 'react';
import type { ResourceNode } from '@throng/core';
import type { DetailFrame } from '@throng/ipc-contract';
import { descendants, nodeAt } from './monitor-model.js';
import { isEnded, resolveFocusPath, useSelection, useSession, useListView } from './monitor-session.js';

export interface Subject {
  readonly node: ResourceNode;
  readonly ended: boolean;
  /** The whole displayed tree, for looking up a node's owners by id. */
  readonly tree: ResourceNode;
  readonly frame: DetailFrame;
}

export function useSubject(): Subject | null {
  const { tree, frame } = useSession();
  const view = useListView();
  const selectedId = useSelection();
  return useMemo(() => {
    if (tree === null || frame === null) return null;
    const focus = nodeAt(tree, resolveFocusPath(view.focusPath, tree)) ?? tree;
    const selected = selectedId === null ? undefined : descendants(tree).find((n) => n.id === selectedId);
    const node = selected ?? focus;
    return { node, ended: isEnded(node.id), tree, frame };
  }, [tree, frame, view.focusPath, selectedId]);
}
