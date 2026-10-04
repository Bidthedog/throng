import { afterEach, describe, expect, it, vi } from 'vitest';
import { setEditorState, removeEditorState } from '../../src/renderer/editor/editor-state.js';
import {
  registerEditorActions,
  unregisterEditorActions,
  type EditorActions,
} from '../../src/renderer/editor/editor-actions.js';
import { saveAllEditors } from '../../src/renderer/editor/editor-save-all.js';
import { saveDirtyMovedOutEditors } from '../../src/renderer/editor/moved-out-save.js';
import { panelHeaderMenu } from '../../src/renderer/workspace/panel-header-menu.js';

/**
 * Every flow that saves, meeting an editor whose file moved to another project (050 FR-036).
 *
 * Save is unavailable there, so: Save All passes it by without failing the batch; a close that
 * "saves first" (project unload / remove, an in-place open) goes through `saveForClose` = Save As, and a
 * refused or cancelled one stops the flow; and the panel menu's Save is disabled.
 */

const ids: string[] = [];
function editor(id: string, o: { movedOut?: boolean; dirty?: boolean; project?: string; saveAsOk?: boolean }) {
  ids.push(id);
  setEditorState(id, {
    filePath: `D:/other/${id}.txt`,
    displayName: `${id}.txt`,
    dirty: o.dirty ?? true,
    movedOut: o.movedOut ?? false,
    ownerProjectId: o.project ?? 'p1',
  });
  const actions = {
    save: vi.fn(() => Promise.resolve(!o.movedOut)),
    saveAs: vi.fn(() => Promise.resolve(true)),
    saveForClose: vi.fn(() => Promise.resolve(o.saveAsOk ?? true)),
    isDirty: () => o.dirty ?? true,
  } as unknown as EditorActions;
  registerEditorActions(id, actions);
  return actions;
}

afterEach(() => {
  for (const id of ids.splice(0)) {
    removeEditorState(id);
    unregisterEditorActions(id);
  }
});

const layout = (panelIds: string[]) =>
  ({
    activeTabId: 't1',
    tabs: [
      {
        id: 't1',
        root: {
          type: 'split',
          id: 's',
          direction: 'row',
          children: panelIds.map((id) => ({ type: 'panel', id, originProjectId: 'p1', kind: 'editor' })),
        },
      },
    ],
  }) as never;

describe('Save All', () => {
  it('passes a moved-out editor by and still saves the others', async () => {
    const out = editor('out', { movedOut: true });
    const ok = editor('ok', {});

    await saveAllEditors({ layout: layout(['out', 'ok']), activeProjectId: 'p1', scope: 'all' });

    expect(out.save).not.toHaveBeenCalled();
    expect(out.saveForClose).not.toHaveBeenCalled();
    expect(ok.save).toHaveBeenCalledTimes(1);
  });
});

describe('closing flows that save first', () => {
  it('Save As every dirty moved-out editor of the project, and say so when all went through', async () => {
    const a = editor('a', { movedOut: true });
    const other = editor('other', { movedOut: true, project: 'p2' });
    const clean = editor('clean', { movedOut: true, dirty: false });

    expect(await saveDirtyMovedOutEditors('p1')).toBe(true);

    expect(a.saveForClose).toHaveBeenCalledTimes(1);
    expect(other.saveForClose, 'another project is not this flow’s').not.toHaveBeenCalled();
    expect(clean.saveForClose, 'a clean one has nothing to save').not.toHaveBeenCalled();
  });

  it('a cancelled Save As stops the flow', async () => {
    editor('a', { movedOut: true, saveAsOk: false });
    expect(await saveDirtyMovedOutEditors('p1')).toBe(false);
  });

  it('an editor that is not mounted cannot be Saved As, so it stops the flow rather than being dropped', async () => {
    editor('a', { movedOut: true });
    unregisterEditorActions('a');
    expect(await saveDirtyMovedOutEditors('p1')).toBe(false);
  });
});

describe('the panel menu', () => {
  it('disables Save for a moved-out editor and leaves Save As enabled', () => {
    const items = (movedOut: boolean) =>
      panelHeaderMenu({
        panel: { type: 'panel', id: 'x', kind: 'editor', title: 'P' },
        panelVerb: 'Destroy',
        keybindings: { bindings: {} },
        otherTabs: [],
        editor: { dirty: true, hasFilePath: true, movedOut },
        panelFailure: false,
        detach: null,
        actions: new Proxy({}, { get: () => () => {} }),
      } as never) as unknown as { label?: string; disabled?: boolean }[];
    const find = (list: ReturnType<typeof items>, label: string) => list.find((i) => i.label === label);

    expect(find(items(true), 'Save')?.disabled).toBe(true);
    expect(find(items(true), 'Save As…')?.disabled).toBeFalsy();
    expect(find(items(false), 'Save')?.disabled).toBeFalsy();
  });
});
