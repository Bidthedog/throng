/**
 * 048 US1 — a panel's **+** button opens a four-way split menu that splits ITS OWN panel.
 *
 * FR-010 (the menu, in order, with chords, nothing added until chosen), FR-011 (the button's panel
 * becomes active, in its own tab), FR-012 (keyboard), FR-014 (title "Split panel…"), FR-002 (the new
 * panel takes focus and opens in no rename box), T018 (a drag starting closes an open menu).
 *
 * Mounted as a window mounts them: the real `TabGroup`, which renders the strip and the active tab's
 * panels and owns the one `DndContext`, inside the real menu host.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, Fragment, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectPanels,
  createDefaultLayout,
  DEFAULT_APP_SETTINGS,
  type LayoutNode,
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
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { TabGroup } from '../../src/renderer/workspace/tab-group.js';
import { PanelPlaceholder } from '../../src/renderer/workspace/panel-placeholder.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';
import { __resetSplitMode, getSplitModePanel, startSplitMode } from '../../src/renderer/workspace/split-mode.js';

const PROJECT = 'proj-split';

const captured: { ws: ReturnType<typeof useWorkspace> | null } = { ws: null };
function Probe(): null {
  captured.ws = useWorkspace();
  return null;
}
const live = () => captured.ws!;

/** Renders one tab's panels directly, so a NON-active tab's panels can be mounted (FR-011). */
function TabHost({ tabIndex }: { tabIndex: number }): ReactElement | null {
  const layout = useWorkspace().layout;
  const tab = layout?.tabs[tabIndex];
  if (!tab) return null;
  return createElement(
    'div',
    null,
    ...collectPanels(tab.root).map((p) => createElement(PanelPlaceholder, { key: p.id, panel: p, tabId: tab.id })),
  );
}

function mount(opts: { body?: ReactElement; layout?: WorkspaceLayout } = {}): void {
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyTyped: vi.fn(), publishIdentities: vi.fn() },
    config: { get: () => Promise.resolve({ settings: DEFAULT_APP_SETTINGS }), onChange: () => () => {} },
  });
  const layout = opts.layout ?? createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
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
                createElement(
                  ContextMenuProvider,
                  null,
                  createElement(Fragment, null, opts.body ?? createElement(TabGroup, null), createElement(Probe, null)),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

const tabOf = (id: string) => live().layout!.tabs.find((t) => t.id === id)!;
const idsIn = (tabId: string): string[] => collectPanels(tabOf(tabId).root).map((p) => p.id);
const menu = (): HTMLElement | null => screen.queryByTestId('context-menu');
const itemLabels = (): string[] =>
  [...(menu()?.querySelectorAll('[role="menuitem"] .context-menu__label') ?? [])].map((el) => el.textContent ?? '');

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

/**
 * dnd-kit keeps a capturing click guard on the document for 50 ms after a drag ends, so the first click
 * after one is swallowed. A test that clicks next must let it detach first.
 */
async function afterDrag(): Promise<void> {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 80));
  });
}

afterEach(() => {
  __resetPanelFocus();
  __resetSplitMode();
  setActivePane('workspace');
  captured.ws = null;
  Reflect.deleteProperty(window, 'throng');
});

describe('the + button (FR-010, FR-014)', () => {
  it('is titled "Split panel…" and announces a menu', async () => {
    mount();
    const button = await screen.findByTestId('panel-add-p1');
    expect(button).toHaveAttribute('title', 'Split panel…');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('opens Split Down, Split Up, Split Right, Split Left, each with its chord, and adds nothing', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId('panel-add-p1'));
    await waitFor(() => expect(menu()).not.toBeNull());
    expect(itemLabels()).toEqual(['Split Down', 'Split Up', 'Split Right', 'Split Left']);
    expect(screen.getByTestId('menu-shortcut-Split Down')).toHaveTextContent('Ctrl+Shift+Alt+End,ArrowDown');
    expect(screen.getByTestId('menu-shortcut-Split Left')).toHaveTextContent('Ctrl+Shift+Alt+End,ArrowLeft');
    // Nothing is added until an item is chosen.
    expect(idsIn('t1')).toEqual(['p1']);
  });

  it('Split Right divides that panel left/right with the new panel on the right, active and in no rename box (FR-002)', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId('panel-add-p1'));
    await user.click(await screen.findByTestId('menu-item-Split Right'));

    await waitFor(() => expect(idsIn('t1')).toHaveLength(2));
    const root: LayoutNode = tabOf('t1').root;
    expect(root.type).toBe('split');
    if (root.type === 'split') {
      expect(root.orientation).toBe('row');
      expect(root.children[0]).toMatchObject({ id: 'p1' });
    }
    const newId = idsIn('t1').find((id) => id !== 'p1')!;
    expect(tabOf('t1').activePanelId).toBe(newId);
    await settle();
    expect(screen.queryByTestId(`panel-rename-input-${newId}`)).toBeNull();
    expect(screen.getByTestId(`panel-${newId}`).querySelector('input[type="text"]')).toBeNull();
    expect(menu()).toBeNull();
  });

  it('opens the split menu on the FIRST click while another menu is open, and a second click closes its own (R6)', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('panel-add-p1');
    // Some other menu is open: the panel header's own.
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('panel-handle-p1') });
    await waitFor(() => expect(menu()).not.toBeNull());
    expect(itemLabels()).not.toContain('Split Right');

    await user.click(screen.getByTestId('panel-add-p1'));
    await waitFor(() => expect(itemLabels()).toContain('Split Right'));
    expect(itemLabels().slice(0, 4)).toEqual(['Split Down', 'Split Up', 'Split Right', 'Split Left']);

    // Its own menu, on the other hand, the + still toggles shut.
    await user.click(screen.getByTestId('panel-add-p1'));
    await waitFor(() => expect(menu()).toBeNull());
  });

  it('Escape closes the menu and changes nothing', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId('panel-add-p1'));
    await waitFor(() => expect(menu()).not.toBeNull());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(menu()).toBeNull());
    expect(idsIn('t1')).toEqual(['p1']);
  });

  it('an outside click closes the menu and changes nothing', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId('panel-add-p1'));
    await waitFor(() => expect(menu()).not.toBeNull());
    await settle(); // the outside-pointer listener is armed a macrotask after opening
    await user.click(screen.getByTestId('tab-strip'));
    await waitFor(() => expect(menu()).toBeNull());
    expect(idsIn('t1')).toEqual(['p1']);
  });
});

describe('the + button chooses the panel it belongs to (FR-011)', () => {
  it('makes its own panel active as the menu opens, then splits THAT panel', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('panel-add-p1');
    // Two panels; the second is active, so p1's + is a click on an INACTIVE panel.
    act(() => {
      live().splitPanel('t1', 'p1', 'right');
    });
    await waitFor(() => expect(idsIn('t1')).toHaveLength(2));
    const second = idsIn('t1').find((id) => id !== 'p1')!;
    expect(tabOf('t1').activePanelId).toBe(second);

    await user.click(screen.getByTestId('panel-add-p1'));
    await waitFor(() => expect(menu()).not.toBeNull());
    expect(tabOf('t1').activePanelId).toBe('p1');

    await user.click(screen.getByTestId('menu-item-Split Down'));
    await waitFor(() => expect(idsIn('t1')).toHaveLength(3));
    // p1 was split, so its new neighbour sits under p1 and `second` is untouched.
    const newId = idsIn('t1').find((id) => id !== 'p1' && id !== second)!;
    const root = tabOf('t1').root;
    expect(root.type).toBe('split');
    if (root.type === 'split') {
      expect(root.children[1]).toMatchObject({ id: second });
      expect(root.children[0]).toMatchObject({ type: 'split', orientation: 'column' });
    }
    expect(tabOf('t1').activePanelId).toBe(newId);
  });

  it('acts in the button’s OWN tab, not the window’s active tab', async () => {
    const user = userEvent.setup();
    mount({ body: createElement(TabHost, { tabIndex: 1 }) });
    await waitFor(() => expect(live()?.layout).toBeTruthy());
    let t2 = '';
    act(() => {
      t2 = live().addTab();
    });
    await waitFor(() => expect(live().layout!.tabs).toHaveLength(2));
    // The window's active tab goes back to t1 while t2's panels are what is mounted.
    act(() => live().setActiveTab('t1'));
    const t2Panel = idsIn(t2)[0]!;
    await user.click(await screen.findByTestId(`panel-add-${t2Panel}`));
    await user.click(await screen.findByTestId('menu-item-Split Left'));
    await waitFor(() => expect(idsIn(t2)).toHaveLength(2));
    expect(idsIn('t1')).toEqual(['p1']);
    expect(tabOf(t2).activePanelId).toBe(idsIn(t2).find((id) => id !== t2Panel));
  });
});

describe('the + button from the keyboard (FR-012)', () => {
  it('Enter opens the menu, arrows move, Enter chooses', async () => {
    const user = userEvent.setup();
    mount();
    const button = await screen.findByTestId('panel-add-p1');
    button.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(menu()).not.toBeNull());
    await user.keyboard('{ArrowDown}'); // Split Down
    await user.keyboard('{ArrowDown}'); // Split Up
    await user.keyboard('{Enter}');
    await waitFor(() => expect(idsIn('t1')).toHaveLength(2));
    const root = tabOf('t1').root;
    expect(root.type).toBe('split');
    if (root.type === 'split') {
      expect(root.orientation).toBe('column');
      // Split Up: the new panel is first.
      expect(root.children[1]).toMatchObject({ id: 'p1' });
    }
  });

  it('Space opens the menu', async () => {
    const user = userEvent.setup();
    mount();
    const button = await screen.findByTestId('panel-add-p1');
    button.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(menu()).not.toBeNull());
  });
});

describe('a drag starting closes an open + menu (T018)', () => {
  it('closes the menu and changes nothing', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId('panel-add-p1'));
    await waitFor(() => expect(menu()).not.toBeNull());
    const before = JSON.stringify(live().layout);

    const handle = screen.getByTestId('panel-handle-p1');
    fireEvent.pointerDown(handle, { isPrimary: true, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 30, clientY: 10 });
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 50, clientY: 10 });
    await waitFor(() => expect(menu()).toBeNull());
    fireEvent.pointerUp(document, { isPrimary: true, clientX: 50, clientY: 10 });
    await afterDrag();
    expect(JSON.stringify(live().layout)).toBe(before);
  });
});

describe('split mode ends when a menu opens or a drag starts (T032, FR-022)', () => {
  it('the + menu opening ends split mode', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('panel-add-p1');
    startSplitMode('p1');
    expect(getSplitModePanel()).toBe('p1');
    await user.click(screen.getByTestId('panel-add-p1'));
    await waitFor(() => expect(menu()).not.toBeNull());
    expect(getSplitModePanel()).toBeNull();
  });

  it('a right-click menu opening ends split mode', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('panel-add-p1');
    startSplitMode('p1');
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('panel-handle-p1') });
    await waitFor(() => expect(menu()).not.toBeNull());
    expect(getSplitModePanel()).toBeNull();
  });

  it('a drag starting ends split mode', async () => {
    mount();
    await screen.findByTestId('panel-add-p1');
    startSplitMode('p1');
    const handle = screen.getByTestId('panel-handle-p1');
    fireEvent.pointerDown(handle, { isPrimary: true, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 30, clientY: 10 });
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 50, clientY: 10 });
    await waitFor(() => expect(getSplitModePanel()).toBeNull());
    fireEvent.pointerUp(document, { isPrimary: true, clientX: 50, clientY: 10 });
    await afterDrag();
  });
});
