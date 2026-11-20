/**
 * `editor.print` (Ctrl+P) in a focused editor opens Print Preview for that editor's document: its current text,
 * unsaved edits included, titled with its file name, highlighted in its language. It prints nothing itself.
 *
 * Layer: component — the window's real keydown dispatcher (`EditorKeybindings`) over a mounted workspace and a
 * live CodeMirror view in jsdom; the print bridge is the observable.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  THRONG_THEME,
  type PrintJobRequest,
  type WorkspaceLayout,
} from '@throng/core';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { EditorKeybindings } from '../../src/renderer/editor/editor-chrome.js';
import { registerEditorView, unregisterEditorView } from '../../src/renderer/editor/editor-views.js';
import { removeEditorState, setEditorState } from '../../src/renderer/editor/editor-state.js';
import { printEditorPanel } from '../../src/renderer/editor/editor-print.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';

const now = '2026-01-01T00:00:00.000Z';
const CATEGORIES: ProjectCategoryDto[] = [
  { id: 'default', name: 'In Progress', isDefault: true, minimised: false, createdAt: now, updatedAt: now },
];
const PROJECT: ProjectDto = {
  id: 'p1', name: 'p1', colour: '#3b82f6', rootFolder: 'C:/projects/p1', isActive: true,
  createdAt: now, updatedAt: now, hiddenPaths: [], categoryId: 'default',
};
const layout = (kind: string): WorkspaceLayout => ({
  projectId: 'p1',
  schemaVersion: 1,
  tabs: [
    {
      id: 't1',
      title: 'Tab 1',
      root: { type: 'panel', id: 'ed-p1', originProjectId: 'p1', title: 'Editor', kind, config: { filePath: 'C:/projects/p1/a.ts' } },
      activePanelId: 'ed-p1',
    },
  ],
  activeTabId: 't1',
});

function bridge(kind: string): ThrongBridge {
  return {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: [PROJECT] } as unknown as TResult);
        case 'projects.categories.list':
          return Promise.resolve({ categories: CATEGORIES } as unknown as TResult);
        case 'projects.setActive':
          return Promise.resolve({ activeId: (params as { id: string }).id } as unknown as TResult);
        case 'workspace.load':
          return Promise.resolve({ layout: layout(kind), restored: true } as unknown as TResult);
        case 'workspace.save':
          return Promise.resolve({ ok: true } as unknown as TResult);
        default:
          return Promise.reject(new Error(`unexpected RPC: ${method}`));
      }
    },
  };
}

function Ready(): ReactElement {
  const loaded = useConfigLoaded();
  const { layout: l } = useWorkspace();
  return createElement('span', { 'data-testid': 'ready', 'data-ready': String(loaded && l !== null) });
}

let view: EditorView | undefined;

afterEach(() => {
  unregisterEditorView('ed-p1');
  removeEditorState('ed-p1');
  view?.destroy();
  view = undefined;
  Reflect.deleteProperty(window, 'throng');
  setActivePane('workspace');
});

/** A live editor view for `ed-p1`, holding `saved`, then edited to `text` and not saved. */
function editorView(saved: string, text: string): EditorView {
  view = new EditorView({ state: EditorState.create({ doc: saved, extensions: [javascript()] }) });
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  registerEditorView('ed-p1', view);
  setEditorState('ed-p1', { panelId: 'ed-p1', filePath: 'C:/projects/p1/a.ts', displayName: 'a.ts', dirty: true });
  return view;
}

async function mount(kind: string, open: (r: PrintJobRequest) => Promise<{ opened: boolean }>): Promise<void> {
  Reflect.set(window, 'throng', {
    config: {
      get: () => Promise.resolve({ settings: DEFAULT_APP_SETTINGS, theme: THRONG_THEME, keybindings: DEFAULT_KEYBINDINGS }),
      onChange: () => () => {},
    },
    editor: { isOpen: () => Promise.resolve(false) },
    panel: { notifyTyped: vi.fn(), publishIdentities: vi.fn() },
    print: { open },
  });
  const b = bridge(kind);
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        ProjectsProvider,
        { client: new ProjectsClient(b) },
        createElement(
          WorkspaceProvider,
          { client: new WorkspaceClient(b), activeProjectId: 'p1' },
          createElement(
            NotificationProvider,
            null,
            createElement('div', null, createElement(Ready), createElement(EditorKeybindings, { isSubWorkspace: false })),
          ),
        ),
      ),
    ),
  );
  await waitFor(() => expect(screen.getByTestId('ready')).toHaveAttribute('data-ready', 'true'));
  // The keydown listener is a passive effect scheduled in the same commit; drain it (see physical-key-chords).
  await new Promise((resolve) => setTimeout(resolve, 0));
  setActivePane('workspace');
}

describe('Print… for an editor', () => {
  it('Ctrl+P in an editor opens Print Preview with its current, unsaved text, titled with its file name', async () => {
    const open = vi.fn((_r: PrintJobRequest) => Promise.resolve({ opened: true }));
    await mount('editor', open);
    editorView('const saved = 1;', 'const edited = "<b>";');

    const event = fireEvent.keyDown(window, { key: 'p', code: 'KeyP', ctrlKey: true });

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(event).toBe(false); // handled: the default was prevented
    const request = open.mock.calls[0][0];
    expect(request.title).toBe('a.ts');
    expect(request.output.kind).toBe('document');
    const html = request.output.kind === 'document' ? request.output.html : '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('pre')?.textContent).toBe('const edited = "<b>";');
    expect(doc.querySelector('b')).toBeNull();
    // The editor's language highlights it.
    expect([...doc.querySelectorAll('pre span')].some((s) => s.textContent === 'const')).toBe(true);
  });

  it('the command body prints nothing for a panel with no live editor', async () => {
    const open = vi.fn();
    expect(await printEditorPanel('nope', open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('Ctrl+P over a terminal opens nothing', async () => {
    const open = vi.fn((_r: PrintJobRequest) => Promise.resolve({ opened: true }));
    await mount('terminal', open);
    editorView('x', 'x'); // even with a view registered under the id, the scope decides

    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', ctrlKey: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(open).not.toHaveBeenCalled();
  });
});
