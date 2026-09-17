/**
 * 044 u8 fix round 1 — EVERY route that ends a preview tells main, and no route that merely closes a
 * view of one does (review items 2, 6 and 7; FR-042, FR-110).
 *
 * ══ WHY EACH ROUTE IS ITS OWN TEST ══
 *
 * `preview.destroyed` is how main drops a run and broadcasts `openChanged { open: false }`. A route
 * that forgets it leaves main believing the file still has its one preview (FR-012): Open Preview stays
 * greyed and the status-bar button stays pressed until the app restarts, for a preview nobody can see.
 * The header's ✕ was the only route that sent it; closing a Tab, closing the other Tabs, and destroying
 * a sub-workspace from its last Tab or last Panel each dropped previews silently.
 *
 * The opposite mistake is as real. A PROJECT preview synced into a sub-workspace is one run with two
 * views. Closing it — or clearing its type — inside the sub-workspace removes that window's view; the
 * project still shows it, so main must keep the run. `killsSession`'s rule, which editors already
 * follow, decides both directions: the view ends the run only in the main window, or when the panel is
 * the sub-workspace's own.
 *
 * Mounted through the real `TabGroup` (the six providers `tab-strip.test.ts` established), so a Tab
 * destroy is a real Destroy Tab from the chip's menu and a panel close is a real ✕.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Fragment, createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_KIND,
  collectPanels,
  createDefaultLayout,
  createPreviewProviderRegistry,
  type LayoutNode,
  type Panel,
  type PreviewAttachRequest,
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
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { TabGroup } from '../../src/renderer/workspace/tab-group.js';
import { SubWorkspaceWindowContext } from '../../src/renderer/workspace/subworkspace-window-context.js';
import { PreviewProviderRegistryContext } from '../../src/renderer/preview/provider-registry-context.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { openPreview, type PreviewPlacementWorkspace } from '../../src/renderer/preview/open-preview.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';

const PROJECT = 'proj-1';
/** A sub-workspace window's layout carries its own synthetic project id; its OWN panels carry it too. */
const SUB = 'sub-1';

const registry = createPreviewProviderRegistry([
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
]);
/*
 * The test provider ENABLED in settings, and the workspace opened only once they are live (044 US4).
 * A provider with no settings entry counts as disabled (`enabledProviderFor`), and the restore filter
 * never mounts a preview of a disabled provider (FR-067) — so without this every preview below would be
 * filtered out of the layout before a route could close it.
 */
const TEST_TEXT_ENABLED = { editor: { previews: { providers: { testText: { enabled: true } } } } };
function WhenSettingsAreLive({ children }: { children: ReactNode }): ReactNode {
  return useConfigLoaded() ? children : null;
}

function FakeBody({ panelId }: PreviewBodyProps): ReactElement {
  return createElement('div', { 'data-testid': `fake-body-${panelId}` }, 'body');
}

/**
 * A persisted preview panel. `placedInLayoutProjectId` is what `placePreview` records — the layout of
 * the window that opened the run — so a panel built WITHOUT it is one persisted before that field
 * existed, or one whose placing window is unknown.
 */
const preview = (id: string, origin: string, placedInLayoutProjectId?: string): Panel => ({
  type: 'panel',
  id,
  originProjectId: origin,
  title: `Panel ${id}`,
  kind: PREVIEW_KIND,
  config: { filePath: `D:/proj/${id}.prvtxt`, ...(placedInLayoutProjectId !== undefined ? { placedInLayoutProjectId } : {}) },
});
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
        case 'panelName.claim':
          return Promise.resolve({ granted: (params as { desired: string }).desired, adjusted: false } as T);
        default:
          return Promise.reject(new Error(`unexpected RPC from the preview destroy routes: ${method}`));
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

const captured: { ws: ReturnType<typeof useWorkspace> | null } = { ws: null };
function Probe(): null {
  captured.ws = useWorkspace();
  return null;
}
const allPanels = (): Panel[] =>
  (captured.ws?.layout?.tabs ?? []).flatMap((t) => collectPanels(t.root) as Panel[]);

function mount(layout: WorkspaceLayout, opts: { sub?: boolean; attachFails?: boolean } = {}) {
  const user = userEvent.setup();
  const bridge = {
    attach: vi.fn((req: PreviewAttachRequest) =>
      Promise.resolve(
        opts.attachFails
          ? ({ ok: false, reason: 'failed' } as never)
          : {
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
            },
      ),
    ),
    detach: vi.fn(),
    destroyed: vi.fn(),
    onUpdate: vi.fn(() => () => {}),
  };
  const subWorkspace = { notifyChanged: vi.fn(), close: vi.fn() };
  // 044 US7b fix round 1, item 7 — the same routes end each panel's navigation history.
  const history = { purge: vi.fn(), attach: vi.fn(), setViewState: vi.fn(), onChanged: () => () => {} };
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn() },
    preview: bridge,
    history,
    editor: { destroy: vi.fn() },
    subWorkspace,
    config: { get: () => Promise.resolve({ settings: TEST_TEXT_ENABLED }), onChange: () => () => {} },
  });
  const services = servicesOver(fakeDaemon(layout));
  const shell = (children: ReactNode): ReactElement =>
    opts.sub
      ? createElement(SubWorkspaceWindowContext.Provider, { value: { id: SUB, name: 'Sub', colour: '#336699' } }, children)
      : createElement(Fragment, null, children);

  render(
    createElement(
      PreviewProviderRegistryContext.Provider,
      { value: { registry, views: { testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(FakeBody) } } } },
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
    ),
  );
  return { user, bridge, subWorkspace, history };
}

async function ready(): Promise<void> {
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
  await screen.findByTestId('tab-t1');
}

/** Destroy Tab from the chip's own menu, accepting as many confirmations as the level asks for. */
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
  __resetPreviewStore();
  localStorage.clear();
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  localStorage.clear();
});

describe('closing Tabs in the main window ends their previews (review item 2)', () => {
  it('Destroy Tab sends destroyed for the preview in it', async () => {
    const { user, bridge } = mount(layoutOf(PROJECT, [row(preview('a', PROJECT), plain('b', PROJECT)), plain('c', PROJECT)]));
    await ready();
    await screen.findByTestId('fake-body-a');

    await destroyTabFromMenu(user, 't1');

    await waitFor(() => expect(allPanels().map((p) => p.id)).not.toContain('a'));
    expect(bridge.destroyed).toHaveBeenCalledWith('a');
    // Only the preview: the plain panel beside it has no run to end.
    expect(bridge.destroyed).toHaveBeenCalledTimes(1);
  });

  it('Destroy Other Tabs sends destroyed for a preview in a tab that is not even mounted', async () => {
    const { user, bridge } = mount(layoutOf(PROJECT, [plain('a', PROJECT), preview('z', PROJECT)]));
    await ready();

    await destroyTabFromMenu(user, 't1', 'Destroy other tabs');

    await waitFor(() => expect(allPanels().map((p) => p.id)).not.toContain('z'));
    expect(bridge.destroyed).toHaveBeenCalledWith('z');
  });
});

describe('destroying a sub-workspace ends ITS previews and keeps the project’s (review item 2)', () => {
  it('from its last Tab: destroyed for the sub-workspace’s own preview, not for a synced project one', async () => {
    const { user, bridge, subWorkspace } = mount(
      layoutOf(SUB, [row(preview('own', SUB), preview('synced', PROJECT))]),
      { sub: true },
    );
    await ready();
    await screen.findByTestId('fake-body-own');

    await destroyTabFromMenu(user, 't1', 'Destroy Tab', 1);

    await waitFor(() => expect(subWorkspace.close).toHaveBeenCalledWith(SUB));
    expect(bridge.destroyed).toHaveBeenCalledWith('own');
    expect(bridge.destroyed).not.toHaveBeenCalledWith('synced');
  });

  /*
   * 044 US3 (carried from the US2 review) — Destroy Other Tabs inside a sub-workspace takes the same rule
   * as a single Tab destroy there: the sub-workspace's OWN preview ends, and a PROJECT preview synced into
   * it keeps its run, because the project window still shows it.
   */
  it('Destroy Other Tabs: destroyed for the sub-workspace’s own preview, not for a synced project one', async () => {
    const { user, bridge, subWorkspace } = mount(
      layoutOf(SUB, [plain('keep', SUB), row(preview('own', SUB), preview('synced', PROJECT))]),
      { sub: true },
    );
    await ready();

    await destroyTabFromMenu(user, 't1', 'Destroy other tabs');

    await waitFor(() => expect(allPanels().map((p) => p.id)).not.toContain('synced'));
    expect(allPanels().map((p) => p.id)).toEqual(['keep']);
    expect(bridge.destroyed).toHaveBeenCalledWith('own');
    expect(bridge.destroyed).not.toHaveBeenCalledWith('synced');
    // The window stays: it still has a Tab.
    expect(subWorkspace.close).not.toHaveBeenCalled();
  });

  it('from its last Panel: destroyed for the sub-workspace’s own preview', async () => {
    const { user, bridge, subWorkspace } = mount(layoutOf(SUB, [preview('own', SUB)]), { sub: true });
    await ready();
    await screen.findByTestId('fake-body-own');

    await user.click(screen.getByTestId('panel-close-own'));
    await screen.findByTestId('confirm-dialog');
    await user.click(screen.getByTestId('confirm-accept'));

    await waitFor(() => expect(subWorkspace.close).toHaveBeenCalledWith(SUB));
    expect(bridge.destroyed).toHaveBeenCalledWith('own');
  });
});

describe('US7b fix round 1, item 7 — the same routes purge navigation history (FR-110)', () => {
  const editor = (id: string, origin: string): Panel => ({
    type: 'panel',
    id,
    originProjectId: origin,
    title: `Panel ${id}`,
    kind: 'editor',
    config: { filePath: `D:/proj/${id}.ts` },
  });

  it('Destroy Tab purges the preview in it', async () => {
    const { user, history } = mount(layoutOf(PROJECT, [row(preview('a', PROJECT), plain('b', PROJECT)), plain('c', PROJECT)]));
    await ready();
    await screen.findByTestId('fake-body-a');

    await destroyTabFromMenu(user, 't1');

    await waitFor(() => expect(history.purge).toHaveBeenCalledWith('a'));
    expect(history.purge).not.toHaveBeenCalledWith('b');
  });

  it('Destroy Other Tabs purges an editor and a preview in a tab that is not even mounted', async () => {
    const { user, history } = mount(layoutOf(PROJECT, [plain('keep', PROJECT), row(preview('z', PROJECT), editor('ed', PROJECT))]));
    await ready();

    await destroyTabFromMenu(user, 't1', 'Destroy other tabs');

    await waitFor(() => expect(allPanels().map((p) => p.id)).toEqual(['keep']));
    expect(history.purge).toHaveBeenCalledWith('z');
    expect(history.purge).toHaveBeenCalledWith('ed');
    expect(history.purge).not.toHaveBeenCalledWith('keep');
  });

  it('a sub-workspace’s last Tab: purges its own panels, never a synced project one', async () => {
    const { user, history, subWorkspace } = mount(
      layoutOf(SUB, [row(preview('own', SUB), preview('synced', PROJECT))]),
      { sub: true },
    );
    await ready();
    await screen.findByTestId('fake-body-own');

    await destroyTabFromMenu(user, 't1', 'Destroy Tab', 1);

    await waitFor(() => expect(subWorkspace.close).toHaveBeenCalledWith(SUB));
    expect(history.purge).toHaveBeenCalledWith('own');
    expect(history.purge).not.toHaveBeenCalledWith('synced');
  });

  it('a sub-workspace’s last Panel: purges it', async () => {
    const { user, history, subWorkspace } = mount(layoutOf(SUB, [preview('own', SUB)]), { sub: true });
    await ready();
    await screen.findByTestId('fake-body-own');

    await user.click(screen.getByTestId('panel-close-own'));
    await screen.findByTestId('confirm-dialog');
    await user.click(screen.getByTestId('confirm-accept'));

    await waitFor(() => expect(subWorkspace.close).toHaveBeenCalledWith(SUB));
    expect(history.purge).toHaveBeenCalledWith('own');
  });
});

describe('a view of a synced preview closed inside a sub-workspace keeps the run (review items 6, 7)', () => {
  it('closing it sends no destroyed, and still removes it from the window', async () => {
    const { user, bridge } = mount(layoutOf(SUB, [row(preview('synced', PROJECT), plain('other', SUB))]), { sub: true });
    await ready();
    await screen.findByTestId('fake-body-synced');

    await user.click(screen.getByTestId('panel-close-synced'));

    await waitFor(() => expect(allPanels().map((p) => p.id)).not.toContain('synced'));
    expect(bridge.destroyed).not.toHaveBeenCalled();
  });

  it('closing the sub-workspace’s OWN preview the same way does send it (the control)', async () => {
    const { user, bridge } = mount(layoutOf(SUB, [row(preview('own', SUB), plain('other', SUB))]), { sub: true });
    await ready();
    await screen.findByTestId('fake-body-own');

    await user.click(screen.getByTestId('panel-close-own'));

    await waitFor(() => expect(bridge.destroyed).toHaveBeenCalledWith('own'));
  });

  it('Clear panel type on a synced preview sends no destroyed, and clears the type here', async () => {
    const { user, bridge } = mount(layoutOf(SUB, [row(preview('synced', PROJECT), plain('other', SUB))]), {
      sub: true,
      attachFails: true,
    });
    await ready();
    await screen.findByTestId('panel-failure-synced');

    await user.click(screen.getByTitle('Clear panel type'));

    await waitFor(() => expect(allPanels().find((p) => p.id === 'synced')?.kind).toBeUndefined());
    expect(bridge.destroyed).not.toHaveBeenCalled();
  });

  /*
   * uc-report concern 1 — a preview OPENED in a sub-workspace window (Ctrl+P, Quick Open, the explorer)
   * belongs to the real project it previews (I-1, `6d19ef6f`), so the synced-view rule above would read it
   * as a project preview and keep main's run when it is closed. No project window holds it, so nothing
   * would ever end the run: main keeps believing the file has a preview, and Open Preview for it does
   * nothing until the app restarts (FR-012). A view this window CREATED is this window's to end.
   */
  it('a preview this sub-workspace window OPENED is ended by closing it, though it belongs to the project', async () => {
    const { user, bridge } = mount(layoutOf(SUB, [row(plain('seed', SUB), plain('other', SUB))]), { sub: true });
    await ready();

    const opened = await openPreview({
      ws: () => captured.ws as unknown as PreviewPlacementWorkspace,
      bridge: {
        open: () => Promise.resolve({ kind: 'placeLocally' as const, reservation: 'res-1', besidePanelId: null }),
        placeDeclined: vi.fn(),
      },
      intent: { absPath: 'D:/proj/opened.prvtxt', projectId: PROJECT },
    });
    expect(opened.kind).toBe('placed');
    const id = (opened as { kind: 'placed'; panelId: string }).panelId;
    // It belongs to the project, as the attach needs (I-1) — the point of the case. Read once the placement has
    // rendered: `allPanels()` reads the workspace as of the last render, which React 19 commits a tick later.
    await waitFor(() => expect(allPanels().find((p) => p.id === id)?.originProjectId).toBe(PROJECT));
    // …and the panel RECORDS that this window placed it, so the rule survives the layout being persisted
    // and restored (review finding 2). Nothing else about the run is persisted, so nothing else can say it.
    expect(allPanels().find((p) => p.id === id)?.config).toMatchObject({ placedInLayoutProjectId: SUB });
    await screen.findByTestId(`fake-body-${id}`);

    await user.click(screen.getByTestId(`panel-close-${id}`));

    await waitFor(() => expect(bridge.destroyed).toHaveBeenCalledWith(id));
  });

  /*
   * Review finding 2 — the same preview, after a RELAUNCH. The window's module state is gone, so the
   * panel is only what the layout holds: a project-owned preview inside a `subworkspace:<id>` layout,
   * the exact shape of a synced project one. The placing layout it carries is what tells them apart, and
   * without it main keeps a run no window holds — Open Preview for that file does nothing until the next
   * restart (FR-012, FR-014).
   */
  it('a preview this sub-workspace opened and a RELAUNCH restored is still its to end', async () => {
    const { user, bridge } = mount(layoutOf(SUB, [row(preview('restored', PROJECT, SUB), plain('other', SUB))]), { sub: true });
    await ready();
    await screen.findByTestId('fake-body-restored');

    await user.click(screen.getByTestId('panel-close-restored'));

    await waitFor(() => expect(bridge.destroyed).toHaveBeenCalledWith('restored'));
  });

  it('a project preview SYNCED here and restored the same way still keeps the run (the control)', async () => {
    const { user, bridge } = mount(layoutOf(SUB, [row(preview('mirror', PROJECT, PROJECT), plain('other', SUB))]), { sub: true });
    await ready();
    await screen.findByTestId('fake-body-mirror');

    await user.click(screen.getByTestId('panel-close-mirror'));

    await waitFor(() => expect(allPanels().map((p) => p.id)).not.toContain('mirror'));
    expect(bridge.destroyed).not.toHaveBeenCalled();
  });

  it('Clear panel type on the sub-workspace’s own preview sends destroyed (the control)', async () => {
    const { user, bridge } = mount(layoutOf(SUB, [row(preview('own', SUB), plain('other', SUB))]), {
      sub: true,
      attachFails: true,
    });
    await ready();
    await screen.findByTestId('panel-failure-own');

    await user.click(screen.getByTitle('Clear panel type'));

    await waitFor(() => expect(bridge.destroyed).toHaveBeenCalledWith('own'));
    expect(allPanels().find((p) => p.id === 'own')?.kind).toBeUndefined();
  });
});
