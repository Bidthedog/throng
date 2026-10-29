/**
 * `requestTabDestroy(tabId)` (055 FR-063): the Resource Monitor's Destroy Tab runs the tab strip's own
 * flow, and refuses a tab that is not mounted in this window.
 *
 * Layer: component — the real `TabGroup`, `ConfirmProvider` and settings; only the daemon bridge is
 * faked. The flow's rules (the double confirmation `destroyTab` ships at, the editor teardown) are the
 * strip's and are pinned by `tab-strip.test.ts`; what is new here is that this route REACHES that flow.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Fragment, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectPanels, createDefaultLayout, type WorkspaceLayout } from '@throng/core';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../../src/renderer/context-menu-provider.js';
import { NotificationProvider } from '../../../src/renderer/common/notification.js';
import { ServicesProvider, type Services } from '../../../src/renderer/composition-root.js';
import { ConfigProvider, useConfigLoaded } from '../../../src/renderer/config/config-store.js';
import { ProjectsClient } from '../../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../../src/renderer/state/panel-name-client.js';
import type { ThrongBridge } from '../../../src/renderer/state/bridge.js';
import { ProjectsProvider } from '../../../src/renderer/state/projects-store.js';
import { WorkspaceProvider, useWorkspace } from '../../../src/renderer/state/workspace-store.js';
import { TabGroup } from '../../../src/renderer/workspace/tab-group.js';
import { __resetTabDestroy, isTabMounted, requestTabDestroy } from '../../../src/renderer/workspace/tab-destroy.js';

const PROJECT = 'proj';

function twoTabs(): WorkspaceLayout {
  const base = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  const panel = (id: string) => ({ type: 'panel' as const, id, originProjectId: PROJECT, title: `Panel ${id}` });
  return {
    ...base,
    tabs: [
      { id: 't1', title: 'First', root: panel('p1'), activePanelId: 'p1' },
      { id: 't2', title: 'Second', root: panel('p2'), activePanelId: 'p2' },
    ],
    activeTabId: 't1',
  };
}

function fakeDaemon(layout: WorkspaceLayout): ThrongBridge {
  return {
    invoke<T>(method: string): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [] } as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as T);
        default:
          return Promise.resolve({ ok: true } as T);
      }
    },
  };
}

const captured: { ws: ReturnType<typeof useWorkspace> | null } = { ws: null };
function Probe(): null {
  captured.ws = useWorkspace();
  return null;
}
function WhenSettingsAreLive({ children }: { children: ReactNode }): ReactNode {
  return useConfigLoaded() ? children : null;
}
const tabIds = (): string[] => (captured.ws?.layout?.tabs ?? []).map((t) => t.id);

let unmount: (() => void) | null = null;

async function mount(layout: WorkspaceLayout): Promise<void> {
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn(), notifyTyped: vi.fn() },
    preview: { attach: vi.fn(), detach: vi.fn(), destroyed: vi.fn(), onUpdate: vi.fn(() => () => {}) },
    history: { purge: vi.fn(), attach: vi.fn(), setViewState: vi.fn(), onChanged: () => () => {} },
    editor: { destroy: vi.fn() },
    subWorkspace: { notifyChanged: vi.fn(), close: vi.fn() },
    config: { get: () => Promise.resolve({ settings: {} }), onChange: () => () => {} },
  });
  const bridge = fakeDaemon(layout);
  const services: Services = {
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
  const view = render(
    createElement(
      ServicesProvider,
      { services },
      createElement(
        ProjectsProvider,
        { client: services.projects },
        createElement(
          ConfigProvider,
          null,
          createElement(
            WhenSettingsAreLive,
            null,
            createElement(
              WorkspaceProvider,
              { client: services.workspace, activeProjectId: layout.projectId },
              createElement(
                NotificationProvider,
                null,
                createElement(
                  ConfirmProvider,
                  null,
                  createElement(ContextMenuProvider, null, createElement(Fragment, null, createElement(TabGroup, null), createElement(Probe, null))),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  unmount = () => {
    view.unmount();
    Reflect.deleteProperty(window, 'throng');
  };
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
  await screen.findByTestId(`panel-${collectPanels(layout.tabs[0]!.root)[0]!.id}`);
}

beforeEach(() => {
  __resetTabDestroy();
});
afterEach(() => {
  unmount?.();
  unmount = null;
  __resetTabDestroy();
});

describe('requestTabDestroy', () => {
  it('opens the strip’s own Destroy Tab confirmation for a mounted tab — a background tab included', async () => {
    await mount(twoTabs());
    expect(isTabMounted('t2')).toBe(true);

    let answered = false;
    act(() => {
      answered = requestTabDestroy('t2');
    });

    expect(answered).toBe(true);
    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog).toHaveTextContent('Destroy Tab');
    expect(dialog).toHaveTextContent('Second');
  });

  it('destroys the tab once the confirmations settings ask for are accepted, and not before', async () => {
    const user = userEvent.setup();
    await mount(twoTabs());

    act(() => {
      requestTabDestroy('t2');
    });
    await screen.findByTestId('confirm-dialog');
    expect(tabIds()).toEqual(['t1', 't2']);

    // `destroyTab` ships at the double level: a dialog, then the “absolutely sure” one.
    await user.click(screen.getByTestId('confirm-accept'));
    await user.click(await screen.findByTestId('confirm-accept'));

    await waitFor(() => expect(tabIds()).toEqual(['t1']));
  });

  it('leaves the tab alone when the user cancels', async () => {
    const user = userEvent.setup();
    await mount(twoTabs());
    act(() => {
      requestTabDestroy('t2');
    });
    await user.click(await screen.findByTestId('confirm-cancel'));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(tabIds()).toEqual(['t1', 't2']);
  });

  it('refuses a tab this window does not hold, opening nothing', async () => {
    await mount(twoTabs());
    expect(isTabMounted('elsewhere')).toBe(false);

    let answered = true;
    act(() => {
      answered = requestTabDestroy('elsewhere');
    });

    expect(answered).toBe(false);
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('stops answering for a tab once it is gone', async () => {
    const user = userEvent.setup();
    await mount(twoTabs());
    act(() => {
      requestTabDestroy('t2');
    });
    await user.click(await screen.findByTestId('confirm-accept'));
    await user.click(await screen.findByTestId('confirm-accept'));
    await waitFor(() => expect(tabIds()).toEqual(['t1']));

    expect(isTabMounted('t2')).toBe(false);
    expect(requestTabDestroy('t2')).toBe(false);
  });
});
