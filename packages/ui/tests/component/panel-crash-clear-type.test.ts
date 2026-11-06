/**
 * 066 FR-009a, manual test MT-01 — the crashed-panel banner's *Clear panel type* takes the panel back to
 * the panel-type selection screen.
 *
 * REPRO (maintainer, MT-01): "when clicking the clear panel type button, nothing happens."
 *
 * Mounted the way a window mounts a panel (`PanelPlaceholder` inside the real workspace store), with the
 * `THRONG_TEST_PANEL_THROW` seam on — the state the hand test drives — and an editor-typed panel.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectPanels, createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
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
import { PanelPlaceholder } from '../../src/renderer/workspace/panel-placeholder.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';
import { clearDraft } from '../../src/renderer/panel-type/panel-draft-store.js';

const PROJECT = 'proj-crash';
let PANEL = '';
const purge = vi.fn();
let seq = 0;

function Host(): ReactElement | null {
  const ws = useWorkspace();
  const tab = ws.layout?.tabs[0];
  if (!tab) return null;
  return createElement(
    'div',
    null,
    ...collectPanels(tab.root).map((p) => createElement(PanelPlaceholder, { key: p.id, panel: p, tabId: tab.id })),
  );
}

async function mount(): Promise<void> {
  const layout: WorkspaceLayout = createDefaultLayout(PROJECT, { tab: 't1', panel: PANEL });
  const editorPanel: Panel = {
    type: 'panel',
    id: PANEL,
    originProjectId: PROJECT,
    title: 'Panel 1',
    kind: 'editor',
    config: { filePath: 'D:/proj-crash/notes.md' },
  } as Panel;
  layout.tabs[0].root = editorPanel;
  layout.tabs[0].activePanelId = PANEL;
  const bridge: ThrongBridge = {
    invoke<T>(method: string): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
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
                rootFolder: 'D:/proj-crash',
                isActive: true,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                hiddenPaths: [],
              },
            ],
          } as T);
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

  Reflect.set(window, 'throng', {
    testPanelThrow: true,
    diagnostics: { log: vi.fn() },
    terminal: { listFlavours: () => Promise.resolve([]), capabilities: () => Promise.resolve({ elevated: false }) },
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn(), notifyTyped: vi.fn(), publishIdentities: vi.fn() },
    config: { get: () => Promise.resolve({ settings: {} }), onChange: () => () => {} },
    history: { purge },
    editor: {
      register: vi.fn(),
      destroy: vi.fn(),
      verifyPath: vi.fn(),
      isOpen: () => Promise.resolve(false),
      openInto: () => Promise.resolve({ action: 'open' }),
      load: () => Promise.resolve({ ok: false, reason: 'io' }),
      getContent: () => Promise.resolve({ text: '', version: 1, dirty: false, absPath: null }),
      onSync: () => () => {},
      dispatch: vi.fn(),
    },
  });

  render(
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
            { client: services.workspace, activeProjectId: PROJECT },
            createElement(
              NotificationProvider,
              null,
              createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, createElement(Host, null))),
            ),
          ),
        ),
      ),
    ),
  );
  await screen.findByTestId(`panel-failure-${PANEL}`);
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  PANEL = `p-crash-${++seq}`;
  setActivePane('workspace');
  // React logs every caught render error to the console; the boundary's own record is what matters.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
  clearDraft(PANEL);
  __resetPanelFocus();
  Reflect.deleteProperty(window, 'throng');
});

describe('MT-01 — Clear panel type on a crashed panel', () => {
  it('takes the crashed panel back to the panel-type selection screen', async () => {
    await mount();
    await userEvent.click(screen.getByTitle('Clear panel type'));
    expect(await screen.findByTestId(`panel-type-select-${PANEL}`)).toBeVisible();
    expect(screen.queryByTestId(`panel-failure-${PANEL}`)).toBeNull();
  });

  it("clears a crashed EDITOR the way the editor's own Clear panel type does: its navigation history goes too", async () => {
    // The header menu and the editor banner clear an editor through `clearEditorPanelType`, which ends
    // the panel's history in main (044 FR-110). The crash banner is a third door onto the same command.
    await mount();
    purge.mockClear();
    await userEvent.click(screen.getByTitle('Clear panel type'));
    await waitFor(() => expect(purge).toHaveBeenCalledWith(PANEL));
  });
});
