/**
 * 044 T075 — `EditorTitlePublisher`: every editor panel's DISPLAYED name reaches main, so a parented
 * preview can be titled after it (FR-031; contracts/preview-ipc.md §1 `publishEditorTitle`).
 *
 * ══ WHY THE RENDERER PUBLISHES IT ══
 *
 * An editor's name is decided here — `panelDisplayTitle` over the layout's custom title and the
 * editor's live file — and main holds the layout only as an opaque blob. So each window says what its
 * editors are called, main keeps the latest per editor panel, and forwards it on each preview's update
 * as `parent.title`. A preview stores no link to its editor (FR-013); this is the only route the name
 * has.
 *
 * ══ WHAT "CHANGED" MEANS ══
 *
 * The name, not the render. The window re-renders on every layout write — a zoom, a tab switch, a
 * resize — and a publish per render would put an IPC message per frame on a drag. The publisher
 * remembers what it last sent per panel and sends again only when that differs.
 *
 * Mounted under the real `WorkspaceProvider` over a fake daemon, so renames and resets go through the
 * store's own operations, and the file comes from `editor-state` exactly as the header reads it.
 */
import { act, render, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, editorAutoTitle, type Panel, type WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { removeEditorState, setEditorState } from '../../src/renderer/editor/editor-state.js';
import { EditorTitlePublisher } from '../../src/renderer/editor/editor-title-publisher.js';

const PROJECT = 'proj-1';
const README = 'D:/proj/README.md';
const GUIDE = 'D:/proj/docs/guide.md';

const panel = (id: string, over: Partial<Panel> = {}): Panel => ({
  type: 'panel',
  id,
  originProjectId: PROJECT,
  title: `Panel ${id}`,
  ...over,
});

function seeded(): WorkspaceLayout {
  const base = createDefaultLayout(PROJECT, { tab: 't1', panel: 'x' });
  return {
    ...base,
    tabs: [
      {
        id: 't1',
        title: 'Tab 1',
        root: {
          type: 'split',
          orientation: 'row',
          sizes: [0.5, 0.5],
          children: [panel('ed1', { kind: 'editor', config: { filePath: README } }), panel('term', { kind: 'terminal' })],
        },
      },
      // A BACKGROUND tab: its editor is not mounted, and a preview of its file still needs its name.
      { id: 't2', title: 'Tab 2', root: panel('ed2', { kind: 'editor', config: { filePath: GUIDE } }) },
    ],
    activeTabId: 't1',
  };
}

function client(): WorkspaceClient {
  const layout = seeded();
  const bridge: ThrongBridge = {
    invoke<T>(method: string): Promise<T> {
      if (method === 'workspace.load') return Promise.resolve({ layout, restored: true } as T);
      if (method === 'workspace.save') return Promise.resolve({ ok: true } as T);
      return Promise.reject(new Error(`unexpected RPC: ${method}`));
    },
  };
  return new WorkspaceClient(bridge);
}

type Ws = ReturnType<typeof useWorkspace>;
const captured: { ws: Ws | null } = { ws: null };
function Capture(): ReactElement | null {
  captured.ws = useWorkspace();
  return null;
}

let publish: ReturnType<typeof vi.fn>;

async function mount(): Promise<void> {
  render(
    createElement(
      WorkspaceProvider,
      { client: client(), activeProjectId: PROJECT },
      createElement(Capture),
      createElement(EditorTitlePublisher),
    ),
  );
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
}

const ws = (): Ws => captured.ws as Ws;

beforeEach(() => {
  captured.ws = null;
  publish = vi.fn();
  Reflect.set(window, 'throng', { preview: { publishEditorTitle: publish } });
});
afterEach(() => {
  removeEditorState('ed1');
  removeEditorState('ed2');
  Reflect.deleteProperty(window, 'throng');
});

describe('publishing each editor panel’s displayed name (FR-031)', () => {
  it('publishes every editor panel in the window on mount — background tabs included — and nothing else', async () => {
    await mount();
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    expect(publish).toHaveBeenCalledWith('ed1', editorAutoTitle(README));
    expect(publish).toHaveBeenCalledWith('ed2', editorAutoTitle(GUIDE));
    expect(publish.mock.calls.map((c) => c[0])).not.toContain('term');
  });

  it('publishes a CUSTOM name when the editor is renamed, and the derived one again on Reset Name', async () => {
    await mount();
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    publish.mockClear();

    act(() => ws().renamePanel('ed1', 'Release plan'));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('ed1', 'Release plan');

    act(() => ws().resetPanelName('ed1'));
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith('ed1', editorAutoTitle(README));
  });

  it('publishes the DERIVED name again when the editor’s live file changes (an open in place, a Save As)', async () => {
    await mount();
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    publish.mockClear();

    act(() => setEditorState('ed2', { filePath: 'D:/proj/docs/changelog.md' }));

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('ed2', editorAutoTitle('D:/proj/docs/changelog.md'));
  });

  it('does not publish when the name is unchanged — a tab switch, a zoom, a state write about something else', async () => {
    await mount();
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    publish.mockClear();

    act(() => ws().setActiveTab('t2'));
    act(() => ws().bumpZoom('ed1', 1));
    act(() => setEditorState('ed1', { filePath: README, dirty: true }));
    // Renaming to the name it already displays is no change either.
    act(() => ws().renamePanel('ed2', editorAutoTitle(GUIDE)));

    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes an editor panel added later, once', async () => {
    await mount();
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    publish.mockClear();

    let added = '';
    act(() => {
      added = ws().addPanel('t1');
    });
    expect(publish).not.toHaveBeenCalled(); // untyped: not an editor yet
    act(() => ws().setPanelType(added, 'editor', { filePath: 'D:/proj/todo.md' }));

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(added, editorAutoTitle('D:/proj/todo.md'));
  });
});
