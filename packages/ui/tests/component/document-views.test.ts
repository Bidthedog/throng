/**
 * Which other panels keep a dirty document shown when one panel closes, deciding whether the close asks.
 *
 * 073 FR-033 is the CSV provider's rule: a grid and an editor on one CSV are one document, and only the last of them
 * asks. Two plain editors on one document stay under 006 FR-006a: a dirty one asks on close, and Discard closes that
 * panel only. 86ac7c17 let a second editor count as well, and the full pipeline on defe6f00 caught it:
 * `editor-replace-open.e2e.ts:243` waited for `dirty-close-dialog` closing one of 054's replaced pair, and it never
 * came (Windows and Linux).
 *
 * Layer: component — the decision reads the live editor and preview stores; what the close then shows is
 * `preview-header-actions.test.ts`'s and the E2E's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { anotherPanelShowsFile } from '../../src/renderer/editor/document-views.js';
import { removeEditorState, setEditorState } from '../../src/renderer/editor/editor-state.js';
import { __resetPreviewStore, applyPreviewUpdate } from '../../src/renderer/preview/preview-store.js';
import { previewUpdate } from './helpers/mount-preview-panel.js';

const FILE = 'D:/proj/shared.csv';

function layoutOf(panels: Panel[]): WorkspaceLayout {
  const base = createDefaultLayout('proj', { tab: 't1', panel: 'unused' });
  const root = { type: 'split' as const, orientation: 'row' as const, children: panels, sizes: panels.map(() => 1 / panels.length) };
  return { ...base, tabs: [{ id: 't1', title: 'Tab 1', root, activePanelId: panels[0]!.id }], activeTabId: 't1' };
}
const editor = (id: string): Panel => ({ type: 'panel', id, originProjectId: 'proj', title: `Panel ${id}`, kind: 'editor' }) as Panel;
const grid = (id: string): Panel => ({ type: 'panel', id, originProjectId: 'proj', title: `Panel ${id}`, kind: 'preview' }) as Panel;

afterEach(() => {
  for (const id of ['e1', 'e2']) removeEditorState(id);
  __resetPreviewStore();
});

describe('anotherPanelShowsFile', () => {
  it('an editor closing beside another editor on the file: nothing counts, so the dirty close still asks (006 FR-006a)', () => {
    setEditorState('e1', { filePath: FILE, dirty: true });
    setEditorState('e2', { filePath: FILE, dirty: true });
    expect(anotherPanelShowsFile(layoutOf([editor('e1'), editor('e2')]), new Set(['e1']), FILE, 'editor')).toBe(false);
  });

  it('an editor closing beside the grid that shows its CSV: the grid counts, so it asks nothing (073 FR-033)', () => {
    setEditorState('e1', { filePath: FILE, dirty: true });
    applyPreviewUpdate(previewUpdate({ panelId: 'g1', providerId: 'csv', filePath: FILE, content: null, revision: 1, dirty: true, ownsDocument: true }));
    expect(anotherPanelShowsFile(layoutOf([editor('e1'), grid('g1')]), new Set(['e1']), FILE, 'editor')).toBe(true);
  });

  it('a grid closing beside an editor on its CSV: the editor counts (073 FR-033)', () => {
    setEditorState('e1', { filePath: FILE, dirty: true });
    applyPreviewUpdate(previewUpdate({ panelId: 'g1', providerId: 'csv', filePath: FILE, content: null, revision: 1, dirty: true, ownsDocument: true }));
    expect(anotherPanelShowsFile(layoutOf([editor('e1'), grid('g1')]), new Set(['g1']), FILE, 'grid')).toBe(true);
  });

  it('the last panel on the file: nothing else counts, whichever kind it is', () => {
    setEditorState('e1', { filePath: FILE, dirty: true });
    expect(anotherPanelShowsFile(layoutOf([editor('e1'), editor('e2')]), new Set(['e1']), FILE, 'grid')).toBe(false);
  });
});
