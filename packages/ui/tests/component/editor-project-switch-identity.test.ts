/**
 * #228 — switching to a second project must not re-point its editors at the first project's file.
 *
 * Layer: component — the defect is in what React reuses across an in-place workspace swap (`switchProject`
 * reloads no page), which jsdom shows with the real `SplitTree`, real `EditorPanel` and a real CodeMirror
 * view. The E2E (`editor-cross-project-restore.e2e.ts`, the clean-files test) keeps the real-restart wiring;
 * this owns the dirty-buffer half that used to need a second Electron launch.
 *
 * Two projects whose layouts have the SAME SHAPE — one tab, one editor panel — so position and type are
 * identical and only the panel id tells the editors apart. Project A's editor is mounted first (live in the
 * document authority, as a restore leaves it); project B's holds a recovered DIRTY buffer and is not yet
 * registered with the authority, so its mount must LOAD its own `config.filePath` and restore the unsaved text
 * onto it. An instance reused from A would load A's path into B's document.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceLayout } from '@throng/core';
import { createDefaultLayout, DEFAULT_APP_SETTINGS } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { SplitTree } from '../../src/renderer/workspace/split-tree.js';
import { removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';

const ALPHA = { project: 'proj-alpha', panel: 'pa', path: 'C:/alpha/alpha-only.txt', text: 'ALPHA-ONLY\n' };
const BETA = { project: 'proj-beta', panel: 'pb', path: 'C:/beta/beta-only.txt', text: 'BETA-ONLY\n', unsaved: 'BETA-UNSAVED-EDIT\n' };

interface Doc {
  text: string;
  version: number;
  dirty: boolean;
  absPath: string;
}

function layoutFor(projectId: string, panelId: string, filePath: string): WorkspaceLayout {
  const layout = createDefaultLayout(projectId, { tab: `t-${panelId}`, panel: panelId });
  layout.tabs[0].root = {
    type: 'panel',
    id: panelId,
    originProjectId: projectId,
    title: 'Panel 1',
    kind: 'editor',
    config: { filePath },
  };
  return layout;
}

/** The document authority in miniature: a panel's document exists once it has loaded (or restored) one. */
function mountSwitchable() {
  const layouts: Record<string, WorkspaceLayout> = {
    [ALPHA.project]: layoutFor(ALPHA.project, ALPHA.panel, ALPHA.path),
    [BETA.project]: layoutFor(BETA.project, BETA.panel, BETA.path),
  };
  const files: Record<string, string> = { [ALPHA.path]: ALPHA.text, [BETA.path]: BETA.text };
  const docs = new Map<string, Doc>([[ALPHA.panel, { text: ALPHA.text, version: 1, dirty: false, absPath: ALPHA.path }]]);
  const recovered = new Map<string, { text: string }>([[BETA.panel, { text: BETA.unsaved }]]);
  const loads: { panelId: string; absPath: string }[] = [];
  const listeners: ((msg: unknown) => void)[] = [];

  const editor = {
    register: vi.fn(),
    destroy: vi.fn(),
    verifyPath: vi.fn(),
    save: vi.fn(() => Promise.resolve({ ok: true })),
    openInto: vi.fn(() => Promise.resolve({ action: 'open' })),
    link: vi.fn(() => Promise.resolve(null)),
    chooseSavePath: vi.fn(() => Promise.resolve(null)),
    recoverOne: vi.fn((panelId: string) => Promise.resolve(recovered.get(panelId) ?? null)),
    restoreRecovered: vi.fn((panelId: string, text: string) => {
      const doc = docs.get(panelId);
      if (doc) docs.set(panelId, { ...doc, text, dirty: true });
      return Promise.resolve();
    }),
    load: vi.fn((req: { panelId: string; absPath: string }) => {
      loads.push({ panelId: req.panelId, absPath: req.absPath });
      const text = files[req.absPath];
      if (text === undefined) return Promise.resolve({ ok: false as const, reason: 'io' });
      docs.set(req.panelId, { text, version: 1, dirty: false, absPath: req.absPath });
      return Promise.resolve({ ok: true as const, text, version: 1, encoding: 'utf8', hasBom: false, lineEnding: 'lf' });
    }),
    getContent: vi.fn((panelId: string) => {
      const doc = docs.get(panelId);
      if (!doc) return Promise.resolve(null);
      return Promise.resolve({
        ...doc,
        fileMissing: false,
        unloadable: false,
        replaced: false,
        encoding: 'utf8',
        hasBom: false,
        lineEnding: 'lf',
        readNotice: null,
      });
    }),
    onSync: (fn: (msg: unknown) => void) => {
      listeners.push(fn);
      return () => {
        const at = listeners.indexOf(fn);
        if (at >= 0) listeners.splice(at, 1);
      };
    },
    dispatch: vi.fn(),
    foldState: (_id: string, seed: 'expanded' | 'collapsed') => Promise.resolve({ base: seed, flipped: [] }),
    setFoldState: vi.fn(),
  };
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn(), notifyTyped: vi.fn(), publishIdentities: vi.fn() },
    config: { get: () => Promise.resolve({ settings: DEFAULT_APP_SETTINGS }), onChange: () => () => {} },
    editor,
  });

  const projects = [ALPHA, BETA].map((p) => ({
    id: p.project,
    name: p.project,
    colour: '#336699',
    rootFolder: p.path.replace(/\/[^/]+$/, ''),
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    hiddenPaths: [],
  }));
  const bridge: ThrongBridge = {
    invoke<T>(method: string, args?: unknown): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout: layouts[(args as { projectId: string }).projectId], restored: true } as T);
        case 'workspace.save':
          return Promise.resolve({ ok: true } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list':
          return Promise.resolve({ projects } as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as T);
        default:
          return Promise.resolve({} as T);
      }
    },
  };
  const services: Services = {
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };

  /** What `TabGroup` renders for the active tab, without the strip and drag context around it. */
  function ActiveTab(): ReactElement | null {
    const tab = useWorkspace().layout?.tabs[0];
    return tab ? createElement(SplitTree, { node: tab.root, tabId: tab.id, path: [] }) : null;
  }
  const tree = (activeProjectId: string): ReactElement =>
    createElement(
      ConfigProvider,
      null,
      createElement(
        ServicesProvider,
        { services },
        createElement(
          ProjectsProvider,
          { client: services.projects },
          createElement(
            WorkspaceProvider,
            { client: services.workspace, activeProjectId },
            createElement(
              NotificationProvider,
              null,
              createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, createElement(ActiveTab))),
            ),
          ),
        ),
      ),
    );
  const view = render(tree(ALPHA.project));
  return {
    docs,
    loads,
    editor,
    switchTo: (projectId: string) => act(async () => view.rerender(tree(projectId))),
    unmount: () => view.unmount(),
  };
}

const editorText = (panelId: string): string =>
  screen.getByTestId(`editor-${panelId}`).querySelector('.cm-content')?.textContent ?? '';

afterEach(() => {
  for (const id of [ALPHA.panel, BETA.panel]) {
    removeEditorState(id);
    removePanelLanguage(id);
  }
  Reflect.deleteProperty(window, 'throng');
});

describe('a project switch in the one renderer (#228)', () => {
  it('a dirty buffer restored in the incoming project keeps ITS OWN path and text, never the outgoing project\'s', async () => {
    const h = mountSwitchable();
    await waitFor(() => expect(editorText(ALPHA.panel)).toContain('ALPHA-ONLY'));

    await h.switchTo(BETA.project);

    await waitFor(() => expect(editorText(BETA.panel)).toContain('BETA-UNSAVED-EDIT'));
    // The panel loaded ITS file, and nothing loaded project A's path on its behalf.
    expect(h.loads.filter((l) => l.panelId === BETA.panel)).toEqual([{ panelId: BETA.panel, absPath: BETA.path }]);
    expect(h.loads.some((l) => l.panelId === BETA.panel && l.absPath === ALPHA.path)).toBe(false);
    // The authority's document for B names B's path and carries the unsaved edit (a dirty document wearing
    // another project's path is unsaveable by the confinement guard, or saveable over the wrong file).
    expect(h.docs.get(BETA.panel)).toMatchObject({ absPath: BETA.path, dirty: true, text: BETA.unsaved });
    expect(document.querySelector('.panel-box__file-name')?.textContent).toBe('beta-only.txt');
    expect(screen.queryByTestId(`panel-failure-${BETA.panel}`)).toBeNull();
    h.unmount();
  });
});
