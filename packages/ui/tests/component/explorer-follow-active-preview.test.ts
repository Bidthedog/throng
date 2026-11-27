import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 081 US7 (#724, FR-060 – FR-063) — the File Explorer follows the active PREVIEW's source file.
 *
 * Layer: component — the follow is a React hook (`useFollowActiveFile` in `file-tree.tsx`) joining the
 * workspace layout with the editor and preview stores; a unit test cannot run a hook, and nothing here
 * needs a real window. The stores are the real ones; only the workspace layout is stubbed, as
 * `active-editor-file.test.ts` does.
 *
 * Mutations that redden this file: drop the `kind === 'preview'` check in `useActivePreviewFilePath`
 * (the stale-preview case), read `autoRevealActiveFile` for previews (the independence cases), and pass
 * `{ focus: true }` (every positive asserts the options).
 */

const workspace = vi.hoisted(() => ({ value: { layout: null as unknown } }));

vi.mock('../../src/renderer/state/workspace-store.js', () => ({
  useWorkspace: () => workspace.value,
}));

const { useFollowActiveFile } = await import('../../src/renderer/explorer/file-tree.js');
const { applyPreviewUpdate, __resetPreviewStore } = await import('../../src/renderer/preview/preview-store.js');
const { setEditorState, removeEditorState } = await import('../../src/renderer/editor/editor-state.js');

const ROOT = 'C:/proj';
let revision = 0;

function preview(panelId: string, filePath: string): void {
  revision += 1;
  applyPreviewUpdate({
    panelId,
    revision,
    filePath,
    providerId: 'markdown',
    content: null,
    dirty: false,
    parent: null,
    notice: null,
  } as Parameters<typeof applyPreviewUpdate>[0]);
}

/** One tab of side-by-side panels with `activeId` active. */
function layoutOf(panels: Array<{ id: string; kind: string }>, activeId: string): void {
  workspace.value = {
    layout: {
      activeTabId: 't1',
      tabs: [
        {
          id: 't1',
          title: 'T',
          activePanelId: activeId,
          root: {
            type: 'split',
            id: 'split',
            direction: 'row',
            children: panels.map((p) => ({ type: 'panel', id: p.id, kind: p.kind, title: p.id })),
          },
        },
      ],
    },
  };
}

interface Follow {
  followEditor: boolean;
  followPreview: boolean;
}

function follow(opts: Follow) {
  const reveal = vi.fn((_rel: string, _o: { focus: boolean }) => Promise.resolve());
  renderHook(() => useFollowActiveFile({ ready: true, rootFolder: ROOT, ...opts, reveal }));
  return reveal;
}

const editors: string[] = [];

beforeEach(() => {
  workspace.value = { layout: null };
  __resetPreviewStore();
});
afterEach(() => {
  for (const id of editors.splice(0)) removeEditorState(id);
  __resetPreviewStore();
});

describe('Follow the active preview (081 FR-061)', () => {
  it('reveals the active preview’s source file under the root, without moving focus', () => {
    preview('pv1', 'C:/proj/docs/readme.md');
    layoutOf([{ id: 'pv1', kind: 'preview' }], 'pv1');

    const reveal = follow({ followEditor: false, followPreview: true });

    expect(reveal).toHaveBeenCalledWith('docs/readme.md', { focus: false });
  });

  it('follows the ACTIVE preview when two are open', () => {
    preview('pv1', 'C:/proj/a.md');
    preview('pv2', 'C:/proj/b.md');
    layoutOf(
      [
        { id: 'pv1', kind: 'preview' },
        { id: 'pv2', kind: 'preview' },
      ],
      'pv2',
    );

    const reveal = follow({ followEditor: false, followPreview: true });

    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith('b.md', { focus: false });
  });
});

describe('it leaves the tree unchanged (081 FR-061, FR-062)', () => {
  it('when the setting is off', () => {
    preview('pv1', 'C:/proj/docs/readme.md');
    layoutOf([{ id: 'pv1', kind: 'preview' }], 'pv1');

    expect(follow({ followEditor: true, followPreview: false })).not.toHaveBeenCalled();
  });

  it('when the source is outside the project root', () => {
    preview('pv1', 'D:/elsewhere/readme.md');
    layoutOf([{ id: 'pv1', kind: 'preview' }], 'pv1');

    expect(follow({ followEditor: true, followPreview: true })).not.toHaveBeenCalled();
  });

  it('when the preview has no state yet (no source)', () => {
    layoutOf([{ id: 'pv1', kind: 'preview' }], 'pv1');

    expect(follow({ followEditor: true, followPreview: true })).not.toHaveBeenCalled();
  });

  it('when the active panel is a terminal that was a preview, stale state and all', () => {
    preview('p1', 'C:/proj/stale.md');
    layoutOf([{ id: 'p1', kind: 'terminal' }], 'p1');

    expect(follow({ followEditor: true, followPreview: true })).not.toHaveBeenCalled();
  });
});

describe('the two follow settings are independent (081 FR-063)', () => {
  it('the editor setting does not turn the preview follow on or off', () => {
    preview('pv1', 'C:/proj/a.md');
    layoutOf([{ id: 'pv1', kind: 'preview' }], 'pv1');

    expect(follow({ followEditor: false, followPreview: true })).toHaveBeenCalledWith('a.md', { focus: false });
    expect(follow({ followEditor: true, followPreview: false })).not.toHaveBeenCalled();
  });

  it('the preview setting does not turn the editor follow on or off', () => {
    editors.push('e1');
    setEditorState('e1', { filePath: 'C:/proj/src/x.ts', displayName: 'x.ts' });
    layoutOf([{ id: 'e1', kind: 'editor' }], 'e1');

    expect(follow({ followEditor: true, followPreview: false })).toHaveBeenCalledWith('src/x.ts', { focus: false });
    expect(follow({ followEditor: false, followPreview: true })).not.toHaveBeenCalled();
  });
});
