/**
 * Clone-and-sync: what the "Sync to" menu actually does to the sub-workspace set (US7 / 003,
 * FR-012…FR-018).
 *
 * PLACE AT: `packages/ui/tests/component/subworkspace-sync.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/subworkspace-sync.e2e.ts:68` and `:110`, and
 * `packages/ui/tests/e2e/subworkspace-detach.e2e.ts:46` (034 FR-045).
 *
 * ══ WHY THIS IS REACHABLE AT ALL, AND WHY IT WAS THOUGHT NOT TO BE ══
 *
 * The whole sync mechanism lives in `DetachProvider` (`workspace/detach-context.tsx`), and that
 * provider consumes `useWorkspace()`. `WorkspaceContext` is private, so this was written off as
 * E2E-only. That was wrong: `WorkspaceProvider` is EXPORTED and takes `client` and `activeProjectId`
 * as PROPS, and `WorkspaceClient` / `SubWorkspacesClient` are one-argument classes over
 * `ThrongBridge` — an exported interface with a single method. So the real providers mount here over
 * a fake daemon, with no production change and no cast.
 *
 * The fake is a fake DAEMON, not a fake provider, for the same reason
 * `project-settings-dialog.test.ts` puts its seam at the bridge: `syncToExisting` RE-READS
 * `workspace.loadSubWorkspaces` before every add and RE-READS it again afterwards, so a bridge that
 * echoed a canned reply would leave every assertion below reading its own fixture back. Here the
 * fake holds the sub-workspace set as real state, `workspace.persistSubWorkspaces` REPLACES it, and
 * `subworkspace.list` DERIVES `tabCount` / `panelCount` from whatever was last persisted — using the
 * same two lines the real repository uses (`packages/persistence/src/subworkspace-repository.ts:24`
 * `tabCount: tabs.length`, `:25` `panelCount: tabs.reduce((n, tab) => n + countPanels(tab.root), 0)`).
 * A row that reads `2T·2P` below therefore means the persisted document really gained a Tab, exactly
 * as the migrated spec's `subworkspace-counts-sw1` did.
 *
 * IT LANDS STRONGER THAN THE E2E DID, in two places:
 *   - the E2E could only read the COUNTS. These tests read the persisted payload as well, so
 *     "cloned the Panel into the Tab the user chose" is distinguishable from "added a Panel
 *     somewhere in the sub-workspace" — two states with identical counts.
 *   - the E2E asserted the main workspace was unchanged by counting `.tab-chip` / `.panel-box`.
 *     Here the main layout is compared whole, so a clone that mutated a title, a split ratio or a
 *     panel's origin project would fail rather than pass on an unchanged count.
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 *   - `subworkspace-detach.e2e.ts:11` — a real second BrowserWindow opening and rendering the
 *     detached content. Window lifecycle is a Principle V reserve and no fake bridge reaches it.
 *   - `subworkspace-sync.e2e.ts:87` — the third-level flyout being fully ON SCREEN
 *     (`toBeInViewport`). jsdom has no layout, so the flip/clamp that assertion guards cannot be
 *     seen here at all (034 FR-049). Its state half is re-proved below as a strengthening, not as a
 *     replacement.
 *   - `subworkspace-sync.e2e.ts:126` — the greyed-out row. The RENDERING of `alreadyHasPanel` and
 *     the menu REFRESHING after a sync are both proved below, but the three lines at
 *     `workspace/panel-placeholder.tsx:507` that DERIVE `alreadyHasPanel` from the sub-workspace's
 *     own panels are the call site's, and the host below mirrors them rather than running them.
 *     A mirrored mapping is not a covered mapping (FR-047).
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * In `mount()` below, drop the `DetachProvider` wrapper — render `Host` directly inside
 * `SubWorkspacesProvider`. `useDetach()` then returns null, the host draws `no-detach` instead of a
 * menu, and — RUN, measured — all FIVE tests in this file fail (four on a missing menu item, one on a
 * persist that never happens). Nothing here is satisfied by a tree that rendered nothing. The count
 * read SIX until it was executed; the file has five.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  collectPanels,
  countPanels,
  createDefaultLayout,
  type Panel,
  type SubWorkspace,
  type WorkspaceLayout,
} from '@throng/core';
import type { SubWorkspaceMetaDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import {
  SubWorkspacesProvider,
  useSubWorkspaces,
} from '../../src/renderer/state/subworkspaces-store.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { DetachProvider, useDetach } from '../../src/renderer/workspace/detach-context.js';
import { SubworkspacesPanel } from '../../src/renderer/sidebar/subworkspaces-panel.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenu, type MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { panelHeaderMenu } from '../../src/renderer/workspace/panel-header-menu.js';
import { tabContextMenu } from '../../src/renderer/workspace/tab-menu.js';

const PROJECT = 'proj';
const noop = (): void => undefined;

/** The seeded sub-workspace: one Tab "D" holding one Panel "sp". Reads as `1T·1P`. */
function seedSub(): SubWorkspace {
  return {
    id: 'sw1',
    ownerUser: 'local',
    name: 'Detached A',
    colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    tabs: [
      { id: 'st', title: 'D', root: { type: 'panel', id: 'sp', originProjectId: 'x', title: 'SP' } },
    ],
  };
}

/**
 * A fake daemon at the BRIDGE.
 *
 * `subworkspace.list` derives its counts from the persisted content rather than returning a fixture,
 * which is what makes a count assertion below evidence of a real write. Anything the sync path does
 * NOT legitimately call is rejected loudly: a silently-resolved unexpected RPC is how a test starts
 * passing against a behaviour that no longer exists.
 */
function fakeDaemon(
  layout: WorkspaceLayout,
  initial: SubWorkspace[],
  // The one RPC that must reject, and what the daemon says when it does. The migrated E2E arranged
  // this by seeding a SQLite trigger that aborted every INSERT into sub_workspaces; the renderer
  // cannot tell that apart from any other rejected persist, and it is the renderer under test.
  failing?: { method: string; message: string },
) {
  let subs = initial;
  const persists: SubWorkspace[][] = [];
  const saved: WorkspaceLayout[] = [];

  const meta = (s: SubWorkspace): SubWorkspaceMetaDto => ({
    id: s.id,
    name: s.name ?? '',
    colour: s.colour ?? '',
    tabCount: s.tabs.length,
    panelCount: s.tabs.reduce((n, t) => n + countPanels(t.root), 0),
  });

  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      if (failing && method === failing.method) return Promise.reject(new Error(failing.message));
      let reply: unknown;
      switch (method) {
        case 'workspace.load':
          reply = { layout, restored: true };
          break;
        case 'workspace.save':
          saved.push((params as { layout: WorkspaceLayout }).layout);
          reply = { ok: true };
          break;
        case 'workspace.loadSubWorkspaces':
          reply = { subWorkspaces: subs };
          break;
        case 'workspace.persistSubWorkspaces': {
          subs = (params as { subWorkspaces: SubWorkspace[] }).subWorkspaces;
          persists.push(subs);
          reply = { ok: true };
          break;
        }
        case 'subworkspace.list':
          reply = { subWorkspaces: subs.map(meta) };
          break;
        default:
          return Promise.reject(new Error(`unexpected RPC from the sync path: ${method}`));
      }
      return Promise.resolve(reply as TResult);
    },
  };

  return {
    bridge,
    persists,
    saved,
    /** The set as the daemon now holds it — i.e. what was actually written. */
    current: (): SubWorkspace[] => subs,
  };
}

/**
 * The real `Services`, every member a real client over the one fake bridge.
 *
 * Built in full rather than cast from a partial: `useServices` is typed, and a
 * `as unknown as Services` would let a member that this path DOES reach be silently absent — which
 * surfaces as `undefined is not a function` inside an effect rather than as a failed assertion.
 * Every client here is a one-argument class over `ThrongBridge`, so there is no cost to honesty.
 */
function servicesOver(bridge: ThrongBridge): Services {
  return {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}

const panelIds = (sub: SubWorkspace, tabIndex: number): string[] =>
  collectPanels(sub.tabs[tabIndex].root).map((p) => p.id);

const mainPanel: Panel = {
  type: 'panel',
  id: 'p1',
  originProjectId: PROJECT,
  title: 'Panel 1',
};

/**
 * The two real menus, plus the counts, plus the main layout.
 *
 * The `detach` objects are built exactly as `tab-group.tsx:1334` and `panel-placeholder.tsx:504`
 * build them — including `alreadyHasPanel`, whose derivation is the one thing here that mirrors a
 * call site rather than running it (see the header).
 */
function Host({ sidebar = false }: { sidebar?: boolean } = {}): ReactElement {
  const detach = useDetach();
  const { subWorkspaces } = useSubWorkspaces();
  const ws = useWorkspace();
  const [open, setOpen] = useState<'tab' | 'panel' | null>(null);

  if (!detach) return createElement('div', { 'data-testid': 'no-detach' });

  const items: MenuAction[] =
    open === 'tab'
      ? tabContextMenu({
          tabId: 't1',
          destroyTabDisabled: false,
          destroyOthersDisabled: true,
          detach: {
            subWorkspaces: detach.subWorkspaces.map((s) => ({ id: s.id, name: s.name ?? '' })),
            detachToNew: (id) => detach.detachToNew('tab', id),
            syncToExisting: (id, subId) => detach.syncToExisting('tab', id, subId),
          },
          actions: { rename: noop, destroyTab: noop, destroyOthers: noop },
        })
      : panelHeaderMenu({
          panel: mainPanel,
          panelVerb: 'Destroy',
          keybindings: DEFAULT_KEYBINDINGS,
          otherTabs: [],
          editor: null,
          editorFailure: false,
          detach: {
            subWorkspaces: detach.subWorkspaces.map((s) => ({
              id: s.id,
              name: s.name ?? '',
              alreadyHasPanel: s.tabs.some((t) =>
                collectPanels(t.root).some((p) => p.id === mainPanel.id),
              ),
              tabs: s.tabs.map((t) => ({ id: t.id, title: t.title })),
            })),
            detachToNew: () => detach.detachToNew('panel', mainPanel.id),
            syncToExisting: (subId, tabId) =>
              detach.syncToExisting('panel', mainPanel.id, subId, tabId),
          },
          actions: {
            beginRename: noop,
            resetName: noop,
            zoomIn: noop,
            zoomOut: noop,
            resetZoom: noop,
            save: noop,
            saveAs: noop,
            revert: noop,
            reloadFromDisk: noop,
            revealInTree: noop,
            openInOsExplorer: noop,
            tryAgain: noop,
            copyDetails: noop,
            clearPanelType: noop,
            redraw: noop,
            sendToNewTab: noop,
            sendToTab: noop,
            destroy: noop,
          },
        });

  return createElement(
    'div',
    null,
    createElement(
      'span',
      { 'data-testid': 'layout-state' },
      ws.layout ? 'loaded' : 'empty',
    ),
    /*
     * The MAIN workspace, as a digest rather than a count.
     *
     * The migrated spec proved "clone, not move" by counting `.tab-chip` / `.panel-box`, and a count
     * cannot tell an untouched layout from one whose Tab was re-parented, re-titled or had its Panel
     * swapped for a copy with a new id. Every one of those loses the user's work out of the main
     * workspace while the count stays put.
     */
    createElement(
      'span',
      { 'data-testid': 'main-layout' },
      (ws.layout?.tabs ?? [])
        .map((t) => `${t.id}[${collectPanels(t.root).map((p) => p.id).join(',')}]`)
        .join('|'),
    ),
    // The sidebar's row, reduced to the one thing the migrated spec read off it — UNLESS the real
    // `SubworkspacesPanel` is mounted beside us, which emits the same testid for real. Two elements
    // under one testid is a `getByTestId` that throws, so exactly one of them draws it.
    ...(sidebar
      ? [createElement(SubworkspacesPanel, { key: 'sidebar' })]
      : subWorkspaces.map((s: SubWorkspaceMetaDto) =>
          createElement(
            'span',
            { key: s.id, 'data-testid': `subworkspace-counts-${s.id}` },
            `${s.tabCount}T·${s.panelCount}P`,
          ),
        )),
    createElement(
      'span',
      { 'data-testid': 'subworkspace-names' },
      subWorkspaces.map((s: SubWorkspaceMetaDto) => s.name).join('|'),
    ),
    /*
     * What the MENU is built from, separately from what the sidebar is built from.
     *
     * `DetachProvider` keeps two lists: the sidebar's metadata (`subworkspace.list`) and the full
     * documents the menus need (`workspace.loadSubWorkspaces`). They refresh from two different
     * round trips, so the counts above can land a tick before this does — and the greyed-out test
     * must wait for THIS one, or it re-opens the menu against a list that has not caught up and
     * fails intermittently rather than meaningfully.
     */
    createElement(
      'span',
      { 'data-testid': 'detach-contents' },
      detach.subWorkspaces
        .map(
          (s) =>
            `${s.id}:${s.tabs.map((t) => collectPanels(t.root).map((p) => p.id).join(',')).join('/')}`,
        )
        .join('|'),
    ),
    createElement(
      'button',
      { 'data-testid': 'open-tab-menu', onClick: () => setOpen('tab') },
      'tab menu',
    ),
    createElement(
      'button',
      { 'data-testid': 'open-panel-menu', onClick: () => setOpen('panel') },
      'panel menu',
    ),
    open === null
      ? null
      : createElement(ContextMenu, {
          x: 0,
          y: 0,
          items,
          // Re-opening rebuilds the items from the CURRENT detach state, which is what the
          // "already synced" test needs: a menu cached from the first open would grey nothing.
          onClose: () => setOpen(null),
          submenuDelayMs: 0,
        }),
  );
}

function stubSubWorkspaceBridge() {
  const api = {
    open: vi.fn(),
    atPoint: vi.fn(() => Promise.resolve(null)),
    close: vi.fn(),
    notifyChanged: vi.fn(),
    onChanged: vi.fn(() => () => {}),
  };
  window.throng = { subWorkspace: api };
  return api;
}

afterEach(() => {
  delete window.throng;
});

async function mount(
  initial: SubWorkspace[] = [seedSub()],
  options: { sidebar?: boolean; failing?: { method: string; message: string } } = {},
) {
  const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  const daemon = fakeDaemon(layout, initial, options.failing);
  const windowApi = stubSubWorkspaceBridge();
  const services = servicesOver(daemon.bridge);
  const user = userEvent.setup();

  render(
    createElement(ServicesProvider, {
      services,
      children: createElement(WorkspaceProvider, {
        client: services.workspace,
        activeProjectId: PROJECT,
        children: createElement(SubWorkspacesProvider, {
          client: services.subWorkspaces,
          children: createElement(DetachProvider, {
            // `SubworkspacesPanel` calls `useErrorNotice` and `useConfirm` unconditionally, so both
            // providers are required the moment `sidebar` is on — and harmless when it is not.
            children: createElement(NotificationProvider, {
              children: createElement(ConfirmProvider, {
                children: createElement(Host, { sidebar: options.sidebar ?? false }),
              }),
            }),
          }),
        }),
      }),
    }),
  );

  // Both stores load asynchronously. Every test below starts from a loaded layout AND a loaded
  // list, so a count assertion can never be a race with the first `subworkspace.list`.
  await waitFor(() => expect(screen.getByTestId('layout-state')).toHaveTextContent('loaded'));
  if (initial.length > 0) {
    await waitFor(() =>
      expect(screen.getByTestId(`subworkspace-counts-${initial[0].id}`)).toHaveTextContent('1T·1P'),
    );
  }
  return { user, daemon, windowApi, layout };
}

/** Open a menu and walk down to the "Sync to" flyout. */
async function openSyncTo(
  user: ReturnType<typeof userEvent.setup>,
  which: 'tab' | 'panel',
): Promise<void> {
  await user.click(screen.getByTestId(which === 'tab' ? 'open-tab-menu' : 'open-panel-menu'));
  await user.click(screen.getByTestId('menu-item-Sync to'));
  await waitFor(() => expect(screen.getByTestId('menu-item-New Sub-workspace')).toBeVisible());
}

describe('syncing into an EXISTING sub-workspace clones, and never moves (FR-016)', () => {
  it('a Tab: the sub-workspace gains a second Tab and the main workspace keeps its own', async () => {
    const { user, daemon } = await mount();
    expect(screen.getByTestId('main-layout')).toHaveTextContent('t1[p1]');
    await openSyncTo(user, 'tab');

    await user.click(screen.getByTestId('menu-item-Detached A'));

    await waitFor(() =>
      expect(screen.getByTestId('subworkspace-counts-sw1')).toHaveTextContent('2T·2P'),
    );
    const [written] = daemon.current();
    expect(written.tabs).toHaveLength(2);
    // The clone carries the SAME panel identity — that is what "synced" means here (INV-5).
    expect(panelIds(written, 1)).toEqual(['p1']);
    expect(panelIds(written, 0)).toEqual(['sp']);
    /*
     * The clone half. The main layout is UNCHANGED and nothing was written back to it: a sync that
     * moved the Tab, or that rewrote the main layout with a copy carrying fresh panel ids, would
     * still leave one tab chip on screen — and would lose the user's Tab out of the main workspace,
     * which is the failure this requirement exists to prevent.
     */
    expect(screen.getByTestId('main-layout')).toHaveTextContent('t1[p1]');
    expect(daemon.saved).toEqual([]);
  });

  it('a Panel, into the Tab the user picked: still one Tab, now two Panels', async () => {
    /*
     * A STRENGTHENING of `subworkspace-sync.e2e.ts:87`, not a replacement — that test also asserts
     * the third-level flyout is fully on screen, which is real layout and stays there (FR-049).
     *
     * What is added here is the thing counts cannot say: the Panel landed in the CHOSEN Tab. "1T·2P"
     * is equally true of a Panel appended to the wrong Tab if there were two, so the payload is what
     * makes the target meaningful.
     */
    const { user, daemon } = await mount();
    await openSyncTo(user, 'panel');

    await user.click(screen.getByTestId('menu-item-Detached A'));
    await waitFor(() => expect(screen.getByTestId('menu-item-New Tab')).toBeVisible());
    await user.click(screen.getByTestId('menu-item-D'));

    await waitFor(() =>
      expect(screen.getByTestId('subworkspace-counts-sw1')).toHaveTextContent('1T·2P'),
    );
    const [written] = daemon.current();
    expect(written.tabs).toHaveLength(1);
    expect(panelIds(written, 0).sort()).toEqual(['p1', 'sp']);
  });

  it('a Panel, as a NEW Tab: the sub-workspace gains a Tab with only that Panel in it', async () => {
    const { user, daemon } = await mount();
    await openSyncTo(user, 'panel');

    await user.click(screen.getByTestId('menu-item-Detached A'));
    await waitFor(() => expect(screen.getByTestId('menu-item-New Tab')).toBeVisible());
    await user.click(screen.getByTestId('menu-item-New Tab'));

    await waitFor(() =>
      expect(screen.getByTestId('subworkspace-counts-sw1')).toHaveTextContent('2T·2P'),
    );
    const [written] = daemon.current();
    expect(written.tabs).toHaveLength(2);
    expect(panelIds(written, 1)).toEqual(['p1']);
    // The new Tab is named, not left blank — `nextSubWorkspaceTabName` over the sub's own titles.
    expect(written.tabs[1].title).toBe('Sub-workspace Tab 1');
  });
});

describe('a Panel already in a sub-workspace cannot be synced there twice (FR-017)', () => {
  it('greys the row out once the sync has landed, and drops its submenu with it', async () => {
    /*
     * Two claims in one, and they are one mechanism. The row greying is
     * `panelHeaderMenu`'s `alreadyHasPanel` branch; the row greying *at this moment* is
     * `DetachProvider` having re-read `workspace.loadSubWorkspaces` after the persist. Without the
     * re-read the menu is built from a stale set and the user can sync the same Panel again — which
     * is the defect, not the styling.
     *
     * The submenu's absence is asserted too: a disabled row that still opened a flyout would offer
     * "New Tab" behind a greyed label, and clicking it would sync the Panel a second time.
     */
    const { user, daemon } = await mount();
    await openSyncTo(user, 'panel');
    await user.click(screen.getByTestId('menu-item-Detached A'));
    await waitFor(() => expect(screen.getByTestId('menu-item-New Tab')).toBeVisible());
    await user.click(screen.getByTestId('menu-item-New Tab'));
    await waitFor(() =>
      expect(screen.getByTestId('subworkspace-counts-sw1')).toHaveTextContent('2T·2P'),
    );
    // The menu's OWN source, not the sidebar's — see `detach-contents` in the host.
    await waitFor(() =>
      expect(screen.getByTestId('detach-contents')).toHaveTextContent('sw1:sp/p1'),
    );

    await openSyncTo(user, 'panel');
    const row = screen.getByTestId('menu-item-Detached A');
    expect(row).toHaveClass('context-menu__item--disabled');
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByTestId('submenu-Detached A')).toBeNull();

    // And it is inert: clicking a greyed row must not sync, and must not close the menu either.
    const before = daemon.persists.length;
    await user.click(row);
    expect(daemon.persists).toHaveLength(before);
  });
});

describe('detaching into a NEW sub-workspace (FR-012/FR-018)', () => {
  it('names it "Sub-workspace 1", clones the Panel into it, and opens its window', async () => {
    /*
     * MIGRATED FROM `subworkspace-detach.e2e.ts:46`, whose window half is a strict duplicate of
     * `:11`'s — both launch Electron, detach, and assert one new window with one `.panel-box`. What
     * distinguishes the two specs is Tab-vs-Panel, and that difference is entirely in which core
     * function runs (`detachTab` vs `detachPanel`, both proved at
     * `packages/core/tests/unit/sub-workspace.test.ts:159` and `:89`) and in what gets persisted,
     * which is what this asserts.
     *
     * `open` is asserted because the E2E's `app.waitForEvent('window')` is downstream of exactly
     * this call. The window itself does not appear here, and `:11` keeps proving that it does.
     */
    const { user, daemon, windowApi } = await mount();
    await openSyncTo(user, 'panel');

    await user.click(screen.getByTestId('menu-item-New Sub-workspace'));

    await waitFor(() => expect(daemon.current()).toHaveLength(2));
    const created = daemon.current()[1];
    // "Sub-workspace 1" even though a sub-workspace already exists — the auto-name counts
    // "Sub-workspace N" names, and "Detached A" is not one (FR-018).
    expect(created.name).toBe('Sub-workspace 1');
    expect(created.tabs).toHaveLength(1);
    expect(panelIds(created, 0)).toEqual(['p1']);
    // Appended, never replacing: the existing sub-workspace is still there, untouched.
    expect(daemon.current()[0].id).toBe('sw1');
    expect(screen.getByTestId('subworkspace-names')).toHaveTextContent('Detached A|Sub-workspace 1');
    // Clone, not move — the Panel is still in the project it came from (`:46`'s `.panel-box` count).
    expect(screen.getByTestId('main-layout')).toHaveTextContent('t1[p1]');
    expect(daemon.saved).toEqual([]);
    expect(windowApi.open).toHaveBeenCalledWith(created.id);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A persist that fails must not fail SILENTLY
 * (030 FR-019, migrated from subworkspace-persist-error.e2e.ts:15)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ WHAT THE E2E BOUGHT, AND WHAT IT COST ══
 *
 * It seeded a SQLite trigger into a real database — `BEFORE INSERT ON sub_workspaces … RAISE(ABORT)`
 * — launched Electron against that data directory, started a daemon, created a project, right-clicked
 * a real tab, walked a real context menu, and then asserted that a notice appeared.
 *
 * The defect it was filed for is on the RENDERER side of that: `detach-context.tsx:158` used to
 * swallow the rejection in a fire-and-forget async block, so the user saw nothing at all. What
 * reaches the renderer from a failed persist is a rejected `workspace.persistSubWorkspaces` — and a
 * rejection raised by an aborting trigger is not distinguishable, there, from any other. So the
 * trigger is an elaborate way of arranging one rejected promise, and the rest of the launch is the
 * cost of arranging it.
 *
 * What does NOT come down with it: that the daemon actually rejects when the write fails. That is
 * the daemon's contract and it is asserted against a real database in the persistence tests, not by
 * reading a notice in a renderer.
 *
 * ══ WHY THE REAL SIDEBAR PANEL AND NOT THE STORE'S `error` ══
 *
 * The store holding an error string is not the requirement — the user SEEING it is, and 032's "one
 * condition, one notice" rule is about exactly that gap. `SubworkspacesPanel` is what turns the
 * store's error into the addressable `subworkspace-error` notice (`subworkspaces-panel.tsx:52`), so
 * these tests mount it and read the notice the E2E read.
 */
describe('a failed create surfaces, and leaves nothing behind (migrated from subworkspace-persist-error.e2e.ts:15)', () => {
  const FAILING = {
    method: 'workspace.persistSubWorkspaces',
    message: 'simulated persist failure',
  };

  it('shows the error notice instead of silence, and lists no phantom sub-workspace', async () => {
    const { user, daemon, windowApi } = await mount([seedSub()], { sidebar: true, failing: FAILING });
    await openSyncTo(user, 'tab');

    await user.click(screen.getByTestId('menu-item-New Sub-workspace'));

    const notice = await screen.findByTestId('subworkspace-error');
    expect(notice).toBeVisible();
    // The E2E matched /fail/i against whatever the daemon said. The renderer's job is to carry that
    // message through rather than to replace it with a house phrase, so the assertion is on the
    // daemon's own words.
    expect(notice).toHaveTextContent(/simulated persist failure/i);

    // No phantom. The set is unchanged, and the sidebar lists only what was there before.
    expect(daemon.current()).toHaveLength(1);
    expect(daemon.current()[0].id).toBe('sw1');
    expect(screen.queryByTestId('subworkspace-names')).toHaveTextContent('Detached A');
    expect(screen.getByTestId('subworkspace-names')).not.toHaveTextContent('Sub-workspace 1');

    // And no window for a sub-workspace that does not exist — the half the E2E could not have
    // asserted, because a window that never opens leaves nothing to look for.
    expect(windowApi.open).not.toHaveBeenCalled();
  });

  it('leaves the MAIN workspace exactly as it was', async () => {
    const { user, daemon } = await mount([seedSub()], { sidebar: true, failing: FAILING });
    await openSyncTo(user, 'tab');

    await user.click(screen.getByTestId('menu-item-New Sub-workspace'));
    await screen.findByTestId('subworkspace-error');

    // Detach-to-new is a CLONE, so a failure has nothing to roll back — but only because the main
    // layout was never touched. A future "move" semantics would have to say so here.
    expect(screen.getByTestId('main-layout')).toHaveTextContent('t1[p1]');
    expect(daemon.saved).toEqual([]);
  });

  it('names the sub-workspace that failed to appear, not just the failure', async () => {
    const { user } = await mount([seedSub()], { sidebar: true, failing: FAILING });
    await openSyncTo(user, 'tab');

    await user.click(screen.getByTestId('menu-item-New Sub-workspace'));

    // 030 FR-019: the notice completes "An error occurred when you tried to …", and the subject is
    // named BEFORE the persist precisely so a window that never existed can still be identified.
    // The E2E only ever matched /fail/i, so it would have passed on a bare message.
    const notice = await screen.findByTestId('subworkspace-error');
    expect(notice).toHaveTextContent(/create the sub-workspace/i);
    expect(notice).toHaveTextContent(/Sub-workspace 1/);
  });

  it('clears the error once a later create succeeds', async () => {
    const { user, daemon } = await mount([seedSub()], { sidebar: true });
    await openSyncTo(user, 'tab');
    await user.click(screen.getByTestId('menu-item-New Sub-workspace'));

    // The happy path calls `clearError()` before it refreshes. Nothing asserted that, and a store
    // that only ever accumulates errors shows the user a stale failure for the rest of the session.
    await waitFor(() => expect(daemon.current()).toHaveLength(2));
    expect(screen.queryByTestId('subworkspace-error')).toBeNull();
  });
});
