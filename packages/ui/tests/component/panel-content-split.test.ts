/**
 * 048 US2 — a Split submenu on the panel header menu and on the content (right-click) menu.
 *
 * `unit/menu-sections.test.ts` pins where the row sits and what it holds; this file drives the real
 * menus: right-click the untyped placeholder (which had NO content menu before 048), right-click a
 * real CodeMirror editor, open the header menu from the keyboard and choose by arrow keys — and each
 * choice splits THAT panel, with the same result as the **+** menu.
 *
 * The terminal, preview and Find in Files content menus are built by the same `withSplit`, handed the
 * same `{ panelId, keybindings }` at their call sites; `unit/panel-split-wiring.test.ts` guards those
 * three call sites, because mounting xterm, a preview run and a scan in jsdom is the cost of asserting
 * one argument.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, Fragment } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectPanels, createDefaultLayout, DEFAULT_APP_SETTINGS, type WorkspaceLayout } from '@throng/core';
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
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';
import { asKeyboardMenu } from '../../src/renderer/workspace/keyboard-menu.js';
import { mountEditor } from './helpers/mount-editor.js';

const PROJECT = 'proj-content-split';

const captured: { ws: ReturnType<typeof useWorkspace> | null } = { ws: null };
function Probe(): null {
  captured.ws = useWorkspace();
  return null;
}
const live = () => captured.ws!;
const idsIn = (tabId: string): string[] =>
  collectPanels(live().layout!.tabs.find((t) => t.id === tabId)!.root).map((p) => p.id);
const menu = (): HTMLElement | null => screen.queryByTestId('context-menu');

function mountTabGroup(): void {
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
                createElement(
                  ContextMenuProvider,
                  null,
                  createElement(Fragment, null, createElement(TabGroup, null), createElement(Probe, null)),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

afterEach(() => {
  __resetPanelFocus();
  setActivePane('workspace');
  captured.ws = null;
  Reflect.deleteProperty(window, 'throng');
});

describe('the untyped placeholder gains a content menu carrying Split alone (FR-015)', () => {
  it('right-clicking inside it opens Split, and Split ▸ Split Down splits that panel', async () => {
    const user = userEvent.setup();
    mountTabGroup();
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByTestId('panel-body-p1') });

    const root = await screen.findByTestId('context-menu');
    const rows = [...root.querySelectorAll(':scope > [role="menuitem"] > .context-menu__label')].map((el) => el.textContent);
    expect(rows, 'Split is the only item').toEqual(['Split']);
    expect(root.querySelector('[role="separator"]'), 'one section, so no divider').toBeNull();

    await user.click(screen.getByTestId('menu-item-Split'));
    await user.click(await screen.findByTestId('menu-item-Split Down'));

    await waitFor(() => expect(idsIn('t1')).toHaveLength(2));
    const tree = live().layout!.tabs[0]!.root;
    expect(tree.type).toBe('split');
    if (tree.type === 'split') {
      expect(tree.orientation).toBe('column');
      expect(tree.children[0]).toMatchObject({ id: 'p1' });
    }
    expect(menu()).toBeNull();
  });
});

describe('a DORMANT terminal’s body has a content menu carrying Split (FR-015, T062)', () => {
  it('right-clicking inside the dormant placeholder opens Split, and Split ▸ Split Right splits that panel', async () => {
    const user = userEvent.setup();
    mountTabGroup();
    await screen.findByTestId('panel-body-p1');
    // A terminal panel left dormant (Manual reload mode): typed and dormant in ONE batch, so no xterm ever
    // mounts. Done through the store because a dormant panel does not survive an Automatic-mode LOAD.
    act(() => {
      live().setPanelType('p1', 'terminal', { flavourId: 'cmd', flavourLabel: 'Command Prompt' });
      live().setPanelDormant('p1', true);
    });
    await screen.findByTestId('terminal-dormant-p1');
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('terminal-dormant-p1') });

    const root = await screen.findByTestId('context-menu');
    const rows = [...root.querySelectorAll(':scope > [role="menuitem"] > .context-menu__label')].map((el) => el.textContent);
    expect(rows, 'Split is the only item').toEqual(['Split']);

    await user.click(screen.getByTestId('menu-item-Split'));
    await user.click(await screen.findByTestId('menu-item-Split Right'));
    await waitFor(() => expect(idsIn('t1')).toHaveLength(2));
    const tree = live().layout!.tabs[0]!.root;
    expect(tree.type).toBe('split');
    if (tree.type === 'split') {
      expect(tree.orientation).toBe('row');
      expect(tree.children[0]).toMatchObject({ id: 'p1' });
    }
  });
});

describe('the header menu offers Split, reachable and chosen from the keyboard (US2 scenario 2)', () => {
  it('Shift+F10-style menu → arrow to Split → Enter → arrow to Split Left → Enter', async () => {
    const user = userEvent.setup();
    mountTabGroup();
    const handle = await screen.findByTestId('panel-handle-p1');
    // The window dispatcher's menu.open route: a synthetic contextmenu flagged as keyboard-originated.
    act(() => {
      asKeyboardMenu(() => {
        handle.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      });
    });
    await screen.findByTestId('context-menu');

    // Items are navigated by arrows: walk to Split, open it, walk to Split Left (4th), choose.
    for (let guard = 0; guard < 12; guard++) {
      await user.keyboard('{ArrowDown}');
      if (document.activeElement?.getAttribute('data-testid') === 'menu-item-Split') break;
    }
    expect(document.activeElement).toHaveAttribute('data-testid', 'menu-item-Split');
    await user.keyboard('{Enter}');
    await screen.findByTestId('submenu-Split');
    // A keyboard-opened submenu focuses its FIRST item (Split Down); three more arrows reach Split Left.
    for (let i = 0; i < 3; i++) await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAttribute('data-testid', 'menu-item-Split Left');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(idsIn('t1')).toHaveLength(2));
    const tree = live().layout!.tabs[0]!.root;
    expect(tree.type).toBe('split');
    if (tree.type === 'split') {
      expect(tree.orientation).toBe('row');
      // Split Left: the new panel is first, the target second.
      expect(tree.children[1]).toMatchObject({ id: 'p1' });
    }
  });

  it('the header menu’s Split ▸ Split Right gives the same result as the + menu', async () => {
    const user = userEvent.setup();
    mountTabGroup();
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByTestId('panel-handle-p1') });
    await user.click(await screen.findByTestId('menu-item-Split'));
    await user.click(await screen.findByTestId('menu-item-Split Right'));
    await waitFor(() => expect(idsIn('t1')).toHaveLength(2));
    const viaHeader = JSON.stringify(
      (live().layout!.tabs[0]!.root as { orientation?: string; sizes?: number[] }).sizes,
    );
    expect(viaHeader).toBe('[0.5,0.5]');
  });
});

describe('an editor’s content menu offers Split and splits that editor (FR-015)', () => {
  it('right-click inside the document → Split ▸ Split Right', async () => {
    const user = userEvent.setup();
    const holder: { ws: ReturnType<typeof useWorkspace> | null } = { ws: null };
    const EditorProbe = (): null => {
      holder.ws = useWorkspace();
      return null;
    };
    const mounted = mountEditor({
      panelId: 'ed1',
      doc: { text: 'hello\n', version: 1 },
      extras: [createElement(EditorProbe, { key: 'probe' })],
    });
    try {
      const content = await waitFor(() => {
        const el = mounted.content();
        expect(el).toBeTruthy();
        return el;
      });
      await act(async () => {
        fireEvent.contextMenu(content, { clientX: 20, clientY: 10 });
      });
      const root = await screen.findByTestId('context-menu');
      expect(root.textContent).toContain('Split');

      await user.click(screen.getByTestId('menu-item-Split'));
      await user.click(await screen.findByTestId('menu-item-Split Right'));

      await waitFor(() => {
        const layout = holder.ws!.layout!;
        expect(collectPanels(layout.tabs[0]!.root)).toHaveLength(2);
      });
    } finally {
      mounted.unmount();
    }
  });
});
