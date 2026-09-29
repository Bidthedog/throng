/**
 * 047 T046 — a preview's fold state never has its own copy (US3, research.md R3, Principle XI): it
 * reads and writes through `fold-state-store.ts` (editor's cache) exactly as an editor view does —
 * `file:<path>` when parented (the SAME key its editor uses), `panel:<id>` when standalone.
 */
import { act, screen } from '@testing-library/react';
import { createElement, useEffect, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewProviderRegistry, initialFold, type FoldState } from '@throng/core';
import {
  __resetFoldStateStore,
  applyFoldStateFromSync,
  documentFoldState,
} from '../../src/renderer/editor/fold-state-store.js';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { COLD, ROOT, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const FILE = `${ROOT}/README.md`;

let captured: PreviewBodyProps | null = null;

function FakeBody(props: PreviewBodyProps): ReactElement {
  captured = props;
  useEffect(() => {
    props.onDrawn(props.filePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.filePath]);
  return createElement('div', { 'data-testid': `fake-body-${props.panelId}` }, props.content.kind === 'text' ? props.content.text : '');
}

const registry = createPreviewProviderRegistry([{ id: 'markdown', displayName: 'Markdown', extensions: ['.md'], kind: 'text' }]);
const views: Record<string, PreviewProviderView> = { markdown: { id: 'markdown', textSelection: true, load: () => Promise.resolve(FakeBody) } };

let m: MountedPreviewWindow | undefined;

function installFoldBridge(): { setFoldState: ReturnType<typeof vi.fn>; foldState: ReturnType<typeof vi.fn>; onSync: ReturnType<typeof vi.fn> } {
  const setFoldState = vi.fn();
  const syncListeners = new Set<(msg: { foldState?: { key: string; state: FoldState } }) => void>();
  const onSync = vi.fn((cb: (msg: { foldState?: { key: string; state: FoldState } }) => void) => {
    syncListeners.add(cb);
    return () => syncListeners.delete(cb);
  });
  const foldStateFn = vi.fn(() => Promise.resolve(initialFold('expanded')));
  const throng = window.throng as unknown as { editor: Record<string, unknown> };
  throng.editor.setFoldState = setFoldState;
  throng.editor.foldState = foldStateFn;
  throng.editor.onSync = onSync;
  return { setFoldState, foldState: foldStateFn, onSync };
}

afterEach(() => {
  m?.unmount();
  m = undefined;
  captured = null;
  __resetFoldStateStore();
});

describe('a PARENTED preview reads and writes the DOCUMENT\'s fold state (file:<path>)', () => {
  it('an editor-side fold change (main\'s sync broadcast) reaches the preview\'s foldState prop', async () => {
    m = await mountMarkdownPreview('# T\n\nwords\n', FILE, {
      providers: { registry, views },
      attach: { parent: { panelId: 'editor-1', title: 'README' } },
    });
    const bridge = installFoldBridge();
    await screen.findByTestId(`fake-body-${m.id}`, {}, COLD);

    const key = `file:${FILE}`;
    const nextState: FoldState = { base: 'collapsed', flipped: [] };
    act(() => applyFoldStateFromSync(key, nextState));

    expect(captured?.foldState).toEqual(nextState);
    expect(bridge.setFoldState).not.toHaveBeenCalled(); // a SYNC apply never echoes back
  });

  it('the body toggling a section calls window.throng.editor.setFoldState under the SAME file: key', async () => {
    m = await mountMarkdownPreview('# T\n\nwords\n', FILE, {
      providers: { registry, views },
      attach: { parent: { panelId: 'editor-1', title: 'README' } },
    });
    const bridge = installFoldBridge();
    await screen.findByTestId(`fake-body-${m.id}`, {}, COLD);

    const next: FoldState = { base: 'expanded', flipped: ['install'] };
    act(() => captured?.onFoldChange?.(next));

    expect(bridge.setFoldState).toHaveBeenCalledWith(m.id, next);
    expect(documentFoldState(`file:${FILE}`, initialFold('expanded'))).toEqual(next);
  });
});

describe('a STANDALONE preview reads and writes its OWN state (panel:<id>), seeded from the setting', () => {
  it('seeds via window.throng.editor.foldState(panelId, editor.markdownSectionsOpen)', async () => {
    m = await mountMarkdownPreview('# T\n\nwords\n', FILE, {
      providers: { registry, views },
      settings: { editor: { markdownSectionsOpen: 'collapsed' } },
    });
    const bridge = installFoldBridge();
    await screen.findByTestId(`fake-body-${m.id}`, {}, COLD);

    await vi.waitFor(() => expect(bridge.foldState).toHaveBeenCalledWith(m!.id, 'collapsed'));
  });

  it('a toggle on the standalone preview sets its OWN panel:<id> entry, not any file: one', async () => {
    m = await mountMarkdownPreview('# T\n\nwords\n', FILE, { providers: { registry, views } });
    const bridge = installFoldBridge();
    await screen.findByTestId(`fake-body-${m.id}`, {}, COLD);
    await vi.waitFor(() => expect(bridge.foldState).toHaveBeenCalled());

    const next: FoldState = { base: 'expanded', flipped: ['install'] };
    act(() => captured?.onFoldChange?.(next));

    expect(bridge.setFoldState).toHaveBeenCalledWith(m.id, next);
    expect(documentFoldState(`panel:${m.id}`, initialFold('expanded'))).toEqual(next);
    // Never written under the document's own key — that would be a SECOND original (Principle XI).
    expect(documentFoldState(`file:${FILE}`, initialFold('expanded'))).toEqual(initialFold('expanded'));
  });
});
