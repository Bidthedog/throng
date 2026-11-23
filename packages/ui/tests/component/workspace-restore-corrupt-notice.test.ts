import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultLayout, type WorkspaceLayout } from '@throng/core';
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
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { WorkspacePane } from '../../src/renderer/app.js';

/**
 * MIGRATED FROM `packages/ui/tests/e2e/persistence-restore.e2e.ts` — `falls back to the default
 * workspace and notifies on a corrupt layout (SC-011)`.
 *
 * Layer: component — the E2E corrupted a row in SQLite to make the daemon answer
 * `restored: false, reason: 'corrupt'`. The repository half of that (a corrupt document yields a
 * default layout and that reason) is `integration/workspace-persistence.integration.test.ts`; what
 * is left is the renderer's half, which needs no window: the store keeps the synthesised default
 * (one Tab, one Panel) and the workspace pane raises `restore-notice`.
 */

const PROJECT = 'proj-corrupt';
const captured: { ws: ReturnType<typeof useWorkspace> | null } = { ws: null };
function Probe(): null {
  captured.ws = useWorkspace();
  return null;
}

function mount(load: { layout: WorkspaceLayout; restored: boolean; reason?: string }): void {
  const bridge: ThrongBridge = {
    invoke<T>(method: string): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve(load as T);
        case 'projects.list':
          return Promise.resolve({
            projects: [{ id: PROJECT, name: 'Gamma', rootFolder: 'C:/proj', hiddenPaths: [] }],
          } as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        default:
          return Promise.resolve({ ok: true } as T);
      }
    },
  };
  Reflect.set(globalThis, 'ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  Reflect.set(window, 'throng', {
    config: { get: () => Promise.resolve({ settings: {} }), onChange: () => () => {} },
    panel: { notifyTyped: () => {} },
    files: { onMoved: () => () => {} },
  });
  const services: Services = {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
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
              ContextMenuProvider,
              null,
              createElement(
                ConfirmProvider,
                null,
                createElement(NotificationProvider, null, createElement(WorkspacePane), createElement(Probe)),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

afterEach(() => {
  captured.ws = null;
  Reflect.deleteProperty(window, 'throng');
});

describe('a corrupt saved layout falls back to the default workspace and says so (SC-011)', () => {
  it('shows restore-notice beside exactly one Tab holding one Panel', async () => {
    mount({
      layout: createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' }),
      restored: false,
      reason: 'corrupt',
    });

    await waitFor(() => expect(screen.getByTestId('restore-notice')).toBeTruthy());
    expect(captured.ws?.layout?.tabs).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="workspace-pane"] .panel-box')).toHaveLength(1);
  });

  it('raises no notice when the layout restored cleanly (so the one above is about corruption)', async () => {
    mount({ layout: createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' }), restored: true });

    await waitFor(() => expect(captured.ws?.layout?.tabs).toHaveLength(1));
    expect(screen.queryByTestId('restore-notice')).toBeNull();
  });
});
