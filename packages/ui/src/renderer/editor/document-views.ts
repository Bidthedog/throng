/**
 * 073 FR-033 — closing the LAST panel showing a dirty document asks; closing one of several does not, since the
 * document is still shown and still savable from what remains.
 *
 * What counts as showing a file's document, in this window: an editor holding the file, or a CSV Preview Editor on it
 * that is a view of the document (the grid that opened it, or one parented to an editor). A Markdown or other parented
 * preview is not: it cannot edit or save the document, so closing the editor behind it still leaves the edits nowhere.
 *
 * FR-033 is the CSV provider's rule: it covers a document a CSV Preview Editor shows. Two plain editors on one document
 * stay under 006 FR-006a — closing either one that is dirty asks, and Discard closes that panel only (054's replaced
 * pair, `editor-replace-open.e2e.ts`). So for an EDITOR closing, only a grid still showing the file counts.
 */
import { collectPanels, pathCompareKey, PREVIEW_KIND, type WorkspaceLayout } from '@throng/core';
import { getPreviewState } from '../preview/preview-store.js';
import { getEditorState } from './editor-state.js';

/**
 * Whether a panel other than those in `closing` shows `filePath`'s document. `closingKind` is what is closing: an
 * editor counts only a grid that stays (006 FR-006a governs editor beside editor); a grid counts an editor or a grid.
 */
export function anotherPanelShowsFile(
  layout: WorkspaceLayout | null | undefined,
  closing: ReadonlySet<string>,
  filePath: string | null | undefined,
  closingKind: 'editor' | 'grid',
): boolean {
  if (layout == null || filePath == null || filePath === '') return false;
  const key = pathCompareKey(filePath);
  const same = (p: string | null | undefined): boolean => p != null && p !== '' && pathCompareKey(p) === key;
  for (const tab of layout.tabs) {
    for (const panel of collectPanels(tab.root)) {
      if (closing.has(panel.id)) continue;
      if (closingKind === 'grid' && panel.kind === 'editor' && same(getEditorState(panel.id)?.filePath)) return true;
      if (panel.kind === PREVIEW_KIND) {
        const state = getPreviewState(panel.id);
        if (state !== undefined && same(state.filePath) && (state.ownsDocument === true || (state.parent != null && state.providerId === 'csv'))) {
          return true;
        }
      }
    }
  }
  return false;
}
