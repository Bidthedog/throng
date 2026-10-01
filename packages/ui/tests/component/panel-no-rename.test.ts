/**
 * 048 US5 — no surface renames a panel (FR-030, FR-031); a tab still does (FR-038).
 *
 * A panel is named by what it holds, so there is no header edit mode, no double-click on the title, no
 * Rename / Reset Name item in any menu, and no chord: F2 reaches whatever has focus, a terminal included.
 *
 * Mounted as a window mounts them: the real `TabGroup` inside the real menu host.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, Fragment } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultLayout,
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  type Tab,
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
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { TabGroup } from '../../src/renderer/workspace/tab-group.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { resolveScoped } from '../../src/renderer/keybindings/scope.js';

const PROJECT = 'proj-no-rename';

function mount(): void {
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyTyped: vi.fn(), publishIdentities: vi.fn() },
    config: { get: () => Promise.resolve({ settings: DEFAULT_APP_SETTINGS }), onChange: () => () => {} },
  });
  const layout: WorkspaceLayout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
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
          return Promise.resolve({ projects: [] } as T);
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
              createElement(
                ConfirmProvider,
                null,
                createElement(ContextMenuProvider, null, createElement(Fragment, null, createElement(TabGroup, null))),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

afterEach(() => {
  setActivePane('workspace');
  Reflect.deleteProperty(window, 'throng');
});

describe('no panel menu offers a rename (FR-030, FR-031)', () => {
  it('the header menu has neither Rename nor Reset Name, and still has its other rows', async () => {
    const user = userEvent.setup();
    mount();
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByTestId('panel-handle-p1') });
    const menu = await screen.findByTestId('context-menu');
    const labels = [...menu.querySelectorAll('[role="menuitem"] .context-menu__label')].map((el) => el.textContent);
    expect(labels).not.toContain('Rename');
    expect(labels).not.toContain('Reset Name');
    // Anti-vacuity: the menu is the real one, with the rows that remain.
    expect(labels).toContain('Destroy Panel');
    expect(screen.queryByTestId('menu-item-Rename')).toBeNull();
    expect(screen.queryByTestId('menu-item-Reset Name')).toBeNull();
  });
});

describe('no gesture on a panel opens a text box (US5 scenario 2)', () => {
  it('double-clicking the header title opens nothing', async () => {
    mount();
    const title = await screen.findByTestId('panel-title-p1');
    fireEvent.doubleClick(title);
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    expect(screen.queryByTestId('panel-rename-input-p1')).toBeNull();
    expect(screen.getByTestId('panel-handle-p1').querySelector('input')).toBeNull();
    expect(screen.getByTestId('panel-title-p1')).toBeInTheDocument();
  });

  it('double-clicking the header itself opens nothing either', async () => {
    mount();
    fireEvent.doubleClick(await screen.findByTestId('panel-handle-p1'));
    expect(screen.queryByTestId('panel-rename-input-p1')).toBeNull();
  });
});

describe('F2 is not a panel command (FR-037)', () => {
  const tab = (kind: string): Tab =>
    ({
      id: 't1',
      title: 'T',
      activePanelId: 'p1',
      root: { type: 'panel', id: 'p1', kind, title: 'P' },
    }) as unknown as Tab;

  it.each(['terminal', 'editor', 'preview', 'findInFiles'])(
    'with a %s panel active nothing consumes F2, so the focused surface receives it',
    (kind) => {
      const resolved = resolveScoped(
        DEFAULT_KEYBINDINGS,
        { key: 'F2' },
        { tabs: [tab(kind)], activeTabId: 't1' },
        { transientFocus: false, overlayOpen: false },
      );
      expect(resolved).toBeNull();
    },
  );
});

describe('tab renaming is unchanged (FR-038)', () => {
  it('double-clicking a tab still opens its name box', async () => {
    mount();
    fireEvent.doubleClick(await screen.findByTestId('tab-title-t1'));
    await waitFor(() => expect(screen.getByTestId('tab-rename-input-t1')).toBeInTheDocument());
  });
});
