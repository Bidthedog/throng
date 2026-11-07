/**
 * #541 — a panel that is destroyed takes its attention mark with it, whichever route destroyed it
 * (057 FR-007, FR-128, and the edge case "A panel destroyed, or a project deleted, while marked").
 *
 * Layer: component — the routes are the real `TabGroup`'s destroy flows (a chip menu, a ✕, the confirm
 * dialogs); the core model's `panelDestroyed` is pinned in unit, and what is missing is a route reaching it.
 *
 * ══ WHAT THE USER SAW ══
 *
 * A flagged (or bell-marked) panel was destroyed, and the mark stayed on its project row and category
 * header with nothing left that could clear it: the panel that would clear it on focus no longer exists,
 * and a manual flag is stored by the daemon, so a restart brings it back.
 *
 * ══ HOW THIS STANDS IN FOR MAIN ══
 *
 * Marks live in main's `AttentionService`; every holder in every window draws main's set. The service is
 * the real one, on faked ports. The renderer reaches it the way `main.ts` relays it: a renderer's
 * `panel.notifyDestroyed(id)` is `throng:panel:destroy`, which main answers with
 * `attentionService.onPanelDestroyed(id)`. So "the mark is gone" is read from main's own set, and "it will
 * not come back after a restart" from the `attention.flagClear` the service sends the daemon.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Fragment, createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  createDefaultLayout,
  type AppSettings,
  type ISystemNotifier,
  type ITaskbarBadge,
  type LayoutNode,
  type Panel,
  type WorkspaceLayout,
} from '@throng/core';
import { ATTENTION_FLAG_CLEAR_METHOD, ATTENTION_FLAG_LIST_METHOD } from '@throng/ipc-contract';
import { AttentionService, type AttentionSettingsSource } from '../../src/main/attention-service.js';
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
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { TabGroup } from '../../src/renderer/workspace/tab-group.js';
import { SubWorkspaceWindowContext } from '../../src/renderer/workspace/subworkspace-window-context.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';

const PROJECT = 'proj-1';
/** A sub-workspace window's layout carries its own synthetic project id; its OWN panels carry it too. */
const SUB = 'sub-1';

function WhenSettingsAreLive({ children }: { children: ReactNode }): ReactNode {
  return useConfigLoaded() ? children : null;
}

const plain = (id: string, origin: string): Panel => ({ type: 'panel', id, originProjectId: origin, title: `Panel ${id}` });
const row = (...children: Panel[]): LayoutNode =>
  children.length === 1
    ? children[0]
    : { type: 'split', orientation: 'row', children, sizes: children.map(() => 1 / children.length) };

function layoutOf(projectId: string, tabs: LayoutNode[]): WorkspaceLayout {
  const base = createDefaultLayout(projectId, { tab: 't1', panel: 'unused' });
  return {
    ...base,
    tabs: tabs.map((root, i) => ({ id: `t${i + 1}`, title: `Tab ${i + 1}`, root })),
    activeTabId: 't1',
  };
}

function fakeDaemon(layout: WorkspaceLayout): ThrongBridge {
  return {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save':
        case 'subworkspace.delete':
          return Promise.resolve({ ok: true } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [] } as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as T);
        case 'panelName.claim':
          return Promise.resolve({ granted: (params as { desired: string }).desired, adjusted: false } as T);
        default:
          return Promise.reject(new Error(`unexpected RPC from the attention destroy routes: ${method}`));
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

/** Main's attention service on faked ports, and the daemon calls it made. */
function mainAttention() {
  const daemonCalls: Array<{ method: string; params: unknown }> = [];
  const s = structuredClone(DEFAULT_APP_SETTINGS) as AppSettings;
  const settings: AttentionSettingsSource = {
    attention: s.attention,
    notifications: s.notifications,
    terminals: { attention: s.terminals.attention },
  };
  const notifier: ISystemNotifier = { show: () => {}, close: () => {}, onClick: () => {} };
  const badge: ITaskbarBadge = { set: () => {}, clear: () => {} };
  const service = new AttentionService({
    windows: {
      ids: () => [1],
      toastHostIds: () => [1],
      focusedId: () => null,
      mainId: () => 1,
      send: () => {},
      broadcast: () => {},
      raise: () => {},
      requestBadgeImage: () => Promise.resolve(null),
    },
    daemon: {
      call: <T,>(method: string, params: unknown): Promise<T> => {
        daemonCalls.push({ method, params });
        if (method === ATTENTION_FLAG_LIST_METHOD) return Promise.resolve({ flags: [] } as T);
        return Promise.resolve({ ok: true } as T);
      },
    },
    notifier,
    badge,
    settings: () => settings,
    log: () => {},
  });
  /** The panel menu's Flag, as the renderer asks main for it. */
  const flag = (panelId: string, projectId: string): void =>
    service.flag({ panelId, projectId, panelTitle: `Panel ${panelId}`, tabTitle: '', projectName: projectId });
  const marked = (): string[] => service.currentMarks().map((m) => m.panelId);
  const flagClears = (): string[] =>
    daemonCalls.filter((c) => c.method === ATTENTION_FLAG_CLEAR_METHOD).map((c) => (c.params as { panelId: string }).panelId);
  return { service, flag, marked, flagClears };
}

const captured: { ws: ReturnType<typeof useWorkspace> | null } = { ws: null };
function Probe(): null {
  captured.ws = useWorkspace();
  return null;
}
const tabIds = (): string[] => (captured.ws?.layout?.tabs ?? []).map((t) => t.id);

function mount(layout: WorkspaceLayout, attention: ReturnType<typeof mainAttention>, opts: { sub?: boolean } = {}) {
  const user = userEvent.setup({ delay: null });
  Reflect.set(window, 'throng', {
    // main.ts `throng:panel:destroy`: the attention half of what main does with it.
    panel: { notifyDestroyed: vi.fn((id: string) => attention.service.onPanelDestroyed(id)), notifyRenamed: vi.fn() },
    // main.ts `throng:attention:panelsDestroyed`: every route that ends panels without the ✕'s cascade.
    attention: {
      panelsDestroyed: vi.fn((ids: string[]) => {
        for (const id of ids) attention.service.onPanelDestroyed(id);
      }),
    },
    preview: { attach: vi.fn(), detach: vi.fn(), destroyed: vi.fn(), onUpdate: vi.fn(() => () => {}) },
    history: { purge: vi.fn(), attach: vi.fn(), setViewState: vi.fn(), onChanged: () => () => {} },
    editor: { destroy: vi.fn() },
    subWorkspace: { notifyChanged: vi.fn(), close: vi.fn() },
    config: { get: () => Promise.resolve({ settings: {} }), onChange: () => () => {} },
  });
  const services = servicesOver(fakeDaemon(layout));
  const shell = (children: ReactNode): ReactElement =>
    opts.sub
      ? createElement(SubWorkspaceWindowContext.Provider, { value: { id: SUB, name: 'Sub', colour: '#336699' } }, children)
      : createElement(Fragment, null, children);

  render(
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
                  createElement(
                    ContextMenuProvider,
                    null,
                    shell(createElement(Fragment, null, createElement(TabGroup, null), createElement(Probe, null))),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  return { user };
}

async function ready(): Promise<void> {
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
  await screen.findByTestId('tab-t1');
}

/** Destroy Tab (or another destroy item) from the chip's own menu, accepting every confirmation. */
async function destroyTabFromMenu(
  user: ReturnType<typeof userEvent.setup>,
  tabId: string,
  label = 'Destroy Tab',
  accepts = 2,
): Promise<void> {
  await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`tab-${tabId}`) });
  await user.click(await screen.findByTestId(`menu-item-${label}`));
  for (let i = 0; i < accepts; i += 1) {
    await screen.findByTestId('confirm-dialog');
    await user.click(screen.getByTestId('confirm-accept'));
  }
}

beforeEach(() => {
  captured.ws = null;
  localStorage.clear();
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  localStorage.clear();
});

describe('#541 — a destroyed panel takes its mark with it, in the main window', () => {
  it('the panel’s own ✕ clears its flag, here and in the daemon’s store', async () => {
    const attention = mainAttention();
    const { user } = mount(layoutOf(PROJECT, [row(plain('p1', PROJECT), plain('p2', PROJECT))]), attention);
    await ready();
    attention.flag('p2', PROJECT);
    expect(attention.marked()).toEqual(['p2']);

    await user.click(await screen.findByTestId('panel-close-p2'));

    await waitFor(() => expect(attention.marked()).toEqual([]));
    expect(attention.flagClears()).toEqual(['p2']);
  });

  it('Destroy Tab clears the flag of a panel in that tab, here and in the daemon’s store', async () => {
    const attention = mainAttention();
    const { user } = mount(layoutOf(PROJECT, [plain('p1', PROJECT), plain('p2', PROJECT)]), attention);
    await ready();
    attention.flag('p2', PROJECT);

    await destroyTabFromMenu(user, 't2');

    await waitFor(() => expect(tabIds()).toEqual(['t1']));
    expect(attention.marked(), 'the mark outlived the tab that held its panel').toEqual([]);
    expect(attention.flagClears(), 'the stored flag outlived the tab, so a restart restores it').toEqual(['p2']);
  });

  it('Destroy other tabs clears the flags of every panel in those tabs', async () => {
    const attention = mainAttention();
    const { user } = mount(
      layoutOf(PROJECT, [plain('p1', PROJECT), row(plain('p2', PROJECT), plain('p3', PROJECT))]),
      attention,
    );
    await ready();
    attention.flag('p1', PROJECT);
    attention.flag('p3', PROJECT);

    await destroyTabFromMenu(user, 't1', 'Destroy other tabs');

    await waitFor(() => expect(tabIds()).toEqual(['t1']));
    expect(attention.marked(), 'the kept tab’s mark stays; the destroyed tab’s goes').toEqual(['p1']);
    expect(attention.flagClears()).toEqual(['p3']);
  });
});

describe('#541 — in a sub-workspace window, a destroy that ends the panel takes its mark; a local close does not', () => {
  it('✕ on the sub-workspace’s own panel clears its flag', async () => {
    const attention = mainAttention();
    const { user } = mount(layoutOf(SUB, [row(plain('s1', SUB), plain('s2', SUB))]), attention, { sub: true });
    await ready();
    attention.flag('s2', SUB);

    await user.click(await screen.findByTestId('panel-close-s2'));

    await waitFor(() => expect(captured.ws?.layout?.tabs[0]?.root.type).toBe('panel'));
    expect(attention.marked(), 'the sub-workspace’s own panel is gone for good, and its mark stayed').toEqual([]);
    expect(attention.flagClears()).toEqual(['s2']);
  });

  it('✕ on a project panel synced into the sub-workspace keeps its flag — the project still shows the panel', async () => {
    const attention = mainAttention();
    const { user } = mount(layoutOf(SUB, [row(plain('s1', SUB), plain('p1', PROJECT))]), attention, { sub: true });
    await ready();
    attention.flag('p1', PROJECT);

    await user.click(await screen.findByTestId('panel-close-p1'));

    await waitFor(() => expect(captured.ws?.layout?.tabs[0]?.root.type).toBe('panel'));
    expect(attention.marked()).toEqual(['p1']);
    expect(attention.flagClears()).toEqual([]);
  });

  it('Destroy Tab on the last tab destroys the sub-workspace, and clears its own panels’ flags', async () => {
    const attention = mainAttention();
    const { user } = mount(layoutOf(SUB, [row(plain('s1', SUB), plain('p1', PROJECT))]), attention, { sub: true });
    await ready();
    attention.flag('s1', SUB);
    attention.flag('p1', PROJECT);

    await destroyTabFromMenu(user, 't1', 'Destroy Tab', 1);

    await waitFor(() => expect(attention.marked(), 'the sub-workspace’s own panel kept its mark').toEqual(['p1']));
    expect(attention.flagClears()).toEqual(['s1']);
  });
});
