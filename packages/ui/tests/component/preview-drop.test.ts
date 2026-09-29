/**
 * 047 T057 — dropping files on a preview (US5, research.md R9, contracts/preview-ipc-047.md §4).
 *
 * Driven through the SAME two test seams the editor's own drop tests use (`throng:tree-drop`,
 * `throng:os-drop` — `os-drop-refusal.test.ts`'s precedent): a synthetic `File`/OS drag cannot be
 * built in jsdom (Electron 43 removed `File.path`), so these events ARE the documented seam, not a
 * shortcut around it.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OS_DROP_EVENT } from '../../src/renderer/editor/drop-target.js';
import { TREE_DROP_EVENT } from '../../src/renderer/explorer/tree-drag-store.js';
import { getTreeDrag, setTreeDrag, clearTreeDrag } from '../../src/renderer/explorer/tree-drag-store.js';
import { getActivePane, setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { COLD, ROOT, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

let m: MountedPreviewWindow | undefined;

afterEach(() => {
  m?.unmount();
  m = undefined;
  clearTreeDrag();
});

/** `window.throng.editor.resolveDrop`, answering `ok: true` for every path unless told otherwise. */
function stubResolveDrop(refuse: Record<string, { reason: string; error: string }> = {}): void {
  const throng = window.throng as unknown as { editor: Record<string, unknown> };
  throng.editor.resolveDrop = (req: { absPath: string }) => {
    const bad = refuse[req.absPath];
    return Promise.resolve(bad ? { ok: false, reason: bad.reason, error: bad.error } : { ok: true, absPath: req.absPath });
  };
}

async function osDrop(paths: string[]): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(OS_DROP_EVENT, { detail: { panelId: m!.id, paths } }));
    await Promise.resolve();
  });
}

async function mount(): Promise<MountedPreviewWindow> {
  m = await mountMarkdownPreview('# T\n\nwords\n');
  await screen.findByTestId(`preview-markdown-${m.id}`, {}, COLD);
  stubResolveDrop();
  return m;
}

describe('an accepted file navigates the dropped-on panel (contract §4 step 3)', () => {
  it('a .md file — a provider claims it — navigates with intent drop', async () => {
    const mounted = await mount();
    const other = `${ROOT}/other.md`;

    await osDrop([other]);

    await waitFor(() =>
      expect(mounted.preview.navigate).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: mounted.id, target: { absPath: other }, intent: { kind: 'drop' } }),
      ),
    );
  });
});

/*
 * Reported in review (MT-03, 2026-09-28): "dragging a file into an existing preview panel should
 * activate the middle pane and focus the dragged-to panel." A drag from the explorer leaves the Files
 * pane active and the keyboard there.
 */
describe('a drop onto a preview activates the workspace pane and focuses the panel (MT-03)', () => {
  for (const route of ['tree', 'os'] as const) {
    it(`${route} drop`, async () => {
      const mounted = await mount();
      const other = `${ROOT}/other.md`;
      const outside = document.createElement('input');
      document.body.appendChild(outside);
      outside.focus();
      setActivePane('files');

      if (route === 'os') await osDrop([other]);
      else
        await act(async () => {
          setTreeDrag({ paths: [other], singleFile: true });
          window.dispatchEvent(new CustomEvent(TREE_DROP_EVENT, { detail: { panelId: mounted.id, paths: [other], singleFile: true } }));
          await Promise.resolve();
        });

      await waitFor(() => expect(mounted.preview.navigate).toHaveBeenCalled());
      expect(getActivePane()).toBe('workspace');
      await waitFor(() => expect(screen.getByTestId(`preview-body-${mounted.id}`)).toHaveFocus());
      outside.remove();
    });
  }
});

describe('a file no enabled provider claims is refused silently (contract §4 step 2)', () => {
  it('a .ts file changes nothing — no navigate, no open, no notice', async () => {
    const mounted = await mount();
    const script = `${ROOT}/app.ts`;

    await osDrop([script]);
    // Give the confinement round-trip a turn to resolve before asserting the negative.
    await act(async () => {
      await Promise.resolve();
    });

    expect(mounted.preview.navigate).not.toHaveBeenCalled();
    expect(mounted.preview.open).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('notices')).queryAllByRole('alert')).toHaveLength(0);
  });

  it('a tree drag shows the refused cursor for a .ts file, and drops nothing', async () => {
    const mounted = await mount();
    const script = `${ROOT}/app.ts`;
    setTreeDrag({ paths: [script], singleFile: true });

    // The dragover cursor decision is `TreeDropTarget`'s own `accepts` callback, driven directly
    // here since jsdom has no drag-and-drop pointer simulation for react-dnd's own channel.
    const dropTarget = screen.getByTestId(`tree-drop-${mounted.id}`);
    const { fireEvent } = await import('@testing-library/react');
    const dataTransfer = { dropEffect: 'copy', types: [] as string[] };
    fireEvent.dragOver(dropTarget, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe('none');

    await act(async () => {
      window.dispatchEvent(new CustomEvent(TREE_DROP_EVENT, { detail: { panelId: mounted.id, paths: [script], singleFile: true } }));
    });
    expect(mounted.preview.navigate).not.toHaveBeenCalled();
    expect(getTreeDrag()).not.toBeNull(); // never claimed — TreeDropTarget's own onDrop early-returns
  });
});

describe('a confinement refusal raises the editor\'s own notice (FR-022, same as an editor)', () => {
  it('project-owned: main\'s out-of-tree wording is shown verbatim', async () => {
    const mounted = await mount();
    const outside = 'D:/elsewhere/outside.md';
    stubResolveDrop({ [outside]: { reason: 'out-of-tree', error: 'That file is outside this project.' } });

    await osDrop([outside]);

    const notice = await screen.findByTestId(`os-drop-error-${outside}`);
    expect(notice).toHaveTextContent('That file is outside this project.');
    expect(mounted.preview.navigate).not.toHaveBeenCalled();
  });
});

describe('three OS files: the first navigates, the rest open new (FR-024)', () => {
  it('navigates once for the first, opens target:new for each remaining accepted file', async () => {
    const mounted = await mount();
    const first = `${ROOT}/first.md`;
    const second = `${ROOT}/second.md`;
    const third = `${ROOT}/third.md`;

    await osDrop([first, second, third]);

    await waitFor(() =>
      expect(mounted.preview.navigate).toHaveBeenCalledWith(
        expect.objectContaining({ target: { absPath: first }, intent: { kind: 'drop' } }),
      ),
    );
    expect(mounted.preview.navigate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mounted.preview.open).toHaveBeenCalledTimes(2));
    expect(mounted.preview.open).toHaveBeenCalledWith(
      expect.objectContaining({ absPath: second, target: { mode: 'new', reusePanelId: null } }),
    );
    expect(mounted.preview.open).toHaveBeenCalledWith(
      expect.objectContaining({ absPath: third, target: { mode: 'new', reusePanelId: null } }),
    );
  });

  it('a refused file among the three does not consume the "first" slot', async () => {
    const mounted = await mount();
    const badScript = `${ROOT}/app.ts`; // no provider — refused silently, step 2
    const first = `${ROOT}/first.md`;

    await osDrop([badScript, first]);

    await waitFor(() =>
      expect(mounted.preview.navigate).toHaveBeenCalledWith(
        expect.objectContaining({ target: { absPath: first }, intent: { kind: 'drop' } }),
      ),
    );
    expect(mounted.preview.open).not.toHaveBeenCalled();
  });
});

describe('text/HTML drops still reach the body\'s own refusal, nothing written', () => {
  it('a non-file drag is not claimed by the drop targets and changes nothing', async () => {
    const mounted = await mount();
    const body = await screen.findByTestId(`preview-body-${mounted.id}`);
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.drop(body, { dataTransfer: { types: ['text/plain'], files: [] } });

    expect(mounted.preview.navigate).not.toHaveBeenCalled();
    expect(mounted.preview.open).not.toHaveBeenCalled();
  });
});
