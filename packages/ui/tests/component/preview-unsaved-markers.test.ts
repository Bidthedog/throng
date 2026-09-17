/**
 * 044 SC-006 / FR-044 — a dirty preview lights none of the app's unsaved markers (u8 review item 7).
 *
 * The first cut asserted that nothing reached `editor-state` — which is the MECHANISM, and says
 * nothing about the markers a user reads. This mounts the three surfaces that count unsaved documents
 * — the Tab chip, the Projects list and the Files & Folders tree — beside a preview whose parent
 * document is dirty, and reads the markers themselves.
 *
 * ══ THE CONTROL IS WHAT MAKES THE ABSENCE MEAN SOMETHING ══
 *
 * Three absent dots are also what three surfaces that never draw a dot look like. So the SAME file is
 * then made dirty the way an editor makes it dirty, in the same Tab and project, and all three dots
 * appear. One document, one count (FR-044): the editor's, never the preview's as well.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { Fragment, createElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_KIND,
  createDefaultLayout,
  createPreviewProviderRegistry,
  type Panel,
  type PreviewAttachRequest,
  type PreviewUpdate,
  type WorkspaceLayout,
} from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { TabGroup } from '../../src/renderer/workspace/tab-group.js';
import { ProjectsPanel } from '../../src/renderer/sidebar/projects-panel.js';
import { FileTree } from '../../src/renderer/explorer/file-tree.js';
import { PreviewProviderRegistryContext } from '../../src/renderer/preview/provider-registry-context.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';
import { allEditorStates, removeEditorState, setEditorState } from '../../src/renderer/editor/editor-state.js';

const PROJECT = 'proj-1';
const ROOT = 'D:/proj';
const FILE = `${ROOT}/notes.prvtxt`;

/** jsdom has no `ResizeObserver`; the tree mounts only once one reports a size (file-tree.test.ts). */
class ImmediateResizeObserver implements ResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    const rect = { width: 320, height: 600, top: 0, left: 0, right: 320, bottom: 600, x: 0, y: 0, toJSON: () => ({}) };
    this.cb([{ target, contentRect: rect } as ResizeObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}
beforeAll(() => {
  globalThis.ResizeObserver = ImmediateResizeObserver;
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
});

const registry = createPreviewProviderRegistry([
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
]);
/*
 * The test provider ENABLED in settings, and the workspace opened only once they are live (044 US4).
 * A provider with no settings entry counts as disabled (`enabledProviderFor`), and the restore filter
 * never mounts a preview of a disabled provider (FR-067).
 */
const TEST_TEXT_ENABLED = { editor: { previews: { providers: { testText: { enabled: true } } } } };
function WhenSettingsAreLive({ children }: { children: ReactNode }): ReactNode {
  return useConfigLoaded() ? children : null;
}
function FakeBody({ panelId }: PreviewBodyProps): ReactElement {
  return createElement('div', { 'data-testid': `fake-body-${panelId}` }, 'body');
}

function layout(): WorkspaceLayout {
  const base = createDefaultLayout(PROJECT, { tab: 't1', panel: 'unused' });
  const preview: Panel = {
    type: 'panel',
    id: 'pv',
    originProjectId: PROJECT,
    title: 'Panel pv',
    kind: PREVIEW_KIND,
    config: { filePath: FILE },
  };
  // The editor's panel, untyped here: the tab dot reads editor state by panel id, so the control
  // below can make it dirty without mounting CodeMirror in jsdom.
  const editorSlot: Panel = { type: 'panel', id: 'ed', originProjectId: PROJECT, title: 'Panel ed' };
  return {
    ...base,
    tabs: [
      {
        id: 't1',
        title: 'Tab 1',
        root: { type: 'split', orientation: 'row', children: [preview, editorSlot], sizes: [0.5, 0.5] },
      },
    ],
    activeTabId: 't1',
  };
}

function fakeDaemon(): ThrongBridge {
  const seeded = layout();
  return {
    invoke<T>(method: string): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout: seeded, restored: true } as T);
        case 'workspace.save':
          return Promise.resolve({ ok: true } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list':
          return Promise.resolve({
            projects: [
              {
                id: PROJECT,
                name: 'Proj',
                colour: '#336699',
                rootFolder: ROOT,
                isActive: true,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                hiddenPaths: [],
              },
            ],
          } as T);
        case 'document.pruneMissing':
          return Promise.resolve({ pruned: 0 } as T);
        case 'fileopUndo.get':
          return Promise.resolve({ stackJson: null } as T);
        default:
          return Promise.reject(new Error(`unexpected RPC from the unsaved-marker mount: ${method}`));
      }
    },
  };
}

function servicesOver(bridge: ThrongBridge): Services {
  return {
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}

function mount() {
  const listeners = new Set<(u: PreviewUpdate) => void>();
  const preview = {
    attach: vi.fn((req: PreviewAttachRequest) =>
      Promise.resolve({
        ok: true as const,
        update: {
          panelId: req.panelId,
          revision: 1,
          filePath: req.filePath,
          providerId: 'testText',
          content: { kind: 'text' as const, text: 'x' },
          dirty: false,
          parent: null,
          notice: null,
        },
      }),
    ),
    detach: vi.fn(),
    destroyed: vi.fn(),
    onUpdate: vi.fn((cb: (u: PreviewUpdate) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
  };
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn() },
    preview,
    editor: { isOpen: () => Promise.resolve(false) },
    config: { get: () => Promise.resolve({ settings: TEST_TEXT_ENABLED }), onChange: () => () => {} },
    files: {
      setRoot: vi.fn(),
      list: vi.fn((relDir: string) =>
        Promise.resolve(
          relDir === ''
            ? { entries: [{ name: 'notes.prvtxt', kind: 'file', isSymlink: false, hasChildren: false }] }
            : { entries: [] },
        ),
      ),
      onChange: vi.fn(() => () => {}),
      onWatchFailed: vi.fn(() => () => {}),
    },
  });
  const services = servicesOver(fakeDaemon());
  const workspace = createElement(
    WorkspaceProvider,
    { client: services.workspace, activeProjectId: PROJECT },
    createElement(
      NotificationProvider,
      null,
      createElement(
        ConfirmProvider,
        null,
        createElement(
          ContextMenuProvider,
          null,
          createElement(
            Fragment,
            null,
            createElement(ProjectsPanel, null),
            createElement(FileTree, { rootFolder: ROOT, projectId: PROJECT, hiddenPaths: [], onHide: () => {} }),
            createElement(TabGroup, null),
          ),
        ),
      ),
    ),
  );
  render(
    createElement(
      PreviewProviderRegistryContext.Provider,
      {
        value: { registry, views: { testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(FakeBody) } } },
      },
      createElement(
        ServicesProvider,
        { services },
        createElement(
          ProjectsProvider,
          { client: services.projects },
          createElement(ConfigProvider, null, createElement(WhenSettingsAreLive, null, workspace)),
        ),
      ),
    ),
  );
  const push = (u: PreviewUpdate): void => {
    act(() => {
      for (const l of [...listeners]) l(u);
    });
  };
  return { push };
}

beforeEach(() => {
  __resetPreviewStore();
  localStorage.clear();
});
afterEach(() => {
  for (const s of allEditorStates()) removeEditorState(s.panelId);
  Reflect.deleteProperty(window, 'throng');
  localStorage.clear();
});

describe('a dirty preview is not counted as unsaved anywhere (SC-006, FR-044)', () => {
  it('lights no Tab, project or tree marker — and the editor holding the same file lights all three', async () => {
    const { push } = mount();
    await screen.findByTestId('fake-body-pv');
    const tree = await screen.findByRole('tree');
    await within(tree).findByText('notes.prvtxt');
    await screen.findByText('Proj');

    // The preview's source document is dirty, and the preview says so (FR-040) — to itself only.
    push({
      panelId: 'pv',
      revision: 2,
      filePath: FILE,
      providerId: 'testText',
      content: null,
      dirty: true,
      parent: { panelId: 'ed', title: 'notes' },
      notice: null,
    });

    expect(screen.queryByTestId('tab-unsaved-t1')).toBeNull();
    expect(screen.queryByTestId(`project-unsaved-${PROJECT}`)).toBeNull();
    expect(within(tree).queryByTestId('tree-unsaved-notes.prvtxt')).toBeNull();

    // CONTROL — the document's own editor goes dirty: one document, and now one count on each surface.
    act(() => {
      setEditorState('ed', { filePath: FILE, dirty: true, ownerProjectId: PROJECT });
    });

    await waitFor(() => expect(screen.getByTestId('tab-unsaved-t1')).toBeInTheDocument());
    expect(screen.getByTestId(`project-unsaved-${PROJECT}`)).toBeInTheDocument();
    expect(within(tree).getByTestId('tree-unsaved-notes.prvtxt')).toBeInTheDocument();
  });
});
