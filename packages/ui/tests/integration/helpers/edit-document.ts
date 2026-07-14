import { ChangeSet } from '@codemirror/state';
import type { EditorCoordinator, DocMeta } from '../../../src/main/editor-coordinator.js';

/**
 * Edit an open document the way a real view does (016, FR-028f): as a CHANGE dispatched to the
 * document's authority, against the version the view last saw.
 *
 * 006's tests pushed a whole new string with `notifyDirty`, because that is what the renderer did.
 * Nothing does that any more — a view sends what CHANGED, and UI main owns the result — so the
 * tests drive the same path the app does.
 */
export function editDocument(
  coordinator: EditorCoordinator,
  meta: DocMeta,
  text: string,
  viewId = 'view-1',
): void {
  const current = coordinator.getContent(meta.panelId);
  if (!current) throw new Error(`[edit-document] no open document for panel ${meta.panelId}`);

  coordinator.dispatchChange(meta, {
    documentId: meta.panelId,
    viewId,
    changes: ChangeSet.of(
      { from: 0, to: current.text.length, insert: text },
      current.text.length,
    ).toJSON(),
    baseVersion: current.version,
    selectionBefore: null,
    mergeClass: null,
  });
}
