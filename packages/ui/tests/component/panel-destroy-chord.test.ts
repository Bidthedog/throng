/**
 * 048 FR-131 (#461) — Destroy Panel from the keyboard: `panel.destroy`, `Ctrl+Shift+Alt+F4`.
 *
 * Three claims, each at the layer that can see it:
 *  - the WINDOW DISPATCHER picks the panel that holds focus (not merely the active one), consumes the
 *    chord so a focused terminal never receives it, and does nothing — consuming nothing — while focus
 *    is in a side pane; the same in a sub-workspace window (stand-in panel boxes, the shared opener);
 *  - the chord runs the panel's OWN destroy flow — the one its header ✕ runs — through the real
 *    `TabGroup`: an empty panel goes, a dirty editor asks first, and the last panel of a sub-workspace
 *    window asks to destroy the sub-workspace;
 *  - the panel menu's Destroy / Close item shows the command's live chord.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Fragment, createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  collectPanels,
  createDefaultLayout,
  type Keybindings,
  type LayoutNode,
  type Panel,
  type WorkspaceLayout,
} from '@throng/core';
import {
  MAIN_WINDOW_CAPABILITIES,
  SUB_WORKSPACE_CAPABILITIES,
  WindowDispatcher,
  type WindowCapabilities,
} from '../../src/renderer/keybindings/window-dispatcher.js';
import {
  __resetPanelDestroy,
  registerPanelDestroy,
  requestPanelDestroy,
} from '../../src/renderer/workspace/panel-destroy.js';
import { getPendingChord, setPendingChord } from '../../src/renderer/editor/pending-chord.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { panelHeaderMenu, type PanelHeaderMenuActions } from '../../src/renderer/workspace/panel-header-menu.js';
import { registerEditorActions, unregisterEditorActions } from '../../src/renderer/editor/editor-actions.js';
import {
  __resetDirtyCloseStore,
  useDirtyCloseRequest,
  type DirtyCloseRequest,
} from '../../src/renderer/editor/dirty-close-store.js';
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
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
const SUB = 'sub-1';
/** The shipped chord, as a keydown carries it: F4 with Ctrl, Shift and Alt held. */
const DESTROY = { key: 'F4', code: 'F4', ctrlKey: true, shiftKey: true, altKey: true } as const;

let m: MountedWorkspace | undefined;
const cleanup: HTMLElement[] = [];

const editor = (id: string): Panel => ({
  type: 'panel',
  id,
  originProjectId: PROJECT,
  title: id,
  kind: 'editor',
  config: { filePath: `D:/proj/${id}.ts` },
});

/** p1 beside p2, p1 the active panel. */
function twoPanels(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [editor('p1'), editor('p2')] };
  l.tabs[0].activePanelId = 'p1';
  return l;
}

function mounted<T extends HTMLElement>(el: T, parent: HTMLElement = document.body): T {
  parent.appendChild(el);
  if (parent === document.body) cleanup.push(el);
  return el;
}

/** A stand-in panel box, as `panel-placeholder.tsx` marks it, holding a focusable terminal textarea. */
function panelWithTerminal(id: string): { box: HTMLElement; terminal: HTMLTextAreaElement; reached: ReturnType<typeof vi.fn> } {
  const box = mounted(document.createElement('div'));
  box.setAttribute('data-panel-host', id);
  const terminal = mounted(document.createElement('textarea'), box);
  const reached = vi.fn();
  terminal.addEventListener('keydown', reached);
  return { box, terminal, reached };
}

/** Press the chord at `target`; true when the dispatcher consumed it. */
function press(target: Element, init: KeyboardEventInit = DESTROY): boolean {
  let notTaken = true;
  act(() => {
    notTaken = fireEvent.keyDown(target, init);
  });
  return !notTaken;
}

async function mountDispatcher(capabilities: WindowCapabilities): Promise<void> {
  m = await mountWorkspace(twoPanels(), {
    extras: [createElement(WindowDispatcher, { key: 'dispatcher', capabilities })],
  });
}

beforeEach(() => {
  __resetPanelDestroy();
  setActivePane('workspace');
  setPendingChord(null);
});

afterEach(() => {
  __resetDirtyCloseStore();
  unregisterEditorActions('p2');
  for (const el of cleanup.splice(0)) el.remove();
  setPendingChord(null);
  setActivePane('workspace');
  m?.unmount();
  m = undefined;
  __resetPanelDestroy();
});

describe('the shared destroy opener', () => {
  it('runs the callback the panel registered, and nothing once it unregistered', () => {
    const destroy = vi.fn();
    const unregister = registerPanelDestroy('p1', destroy);
    expect(requestPanelDestroy('p1')).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
    unregister();
    expect(requestPanelDestroy('p1')).toBe(false);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('an older registration unregistering does not remove a newer one for the same panel', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerPanelDestroy('p1', first);
    registerPanelDestroy('p1', second);
    unregisterFirst();
    expect(requestPanelDestroy('p1')).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('the window dispatcher runs panel.destroy on the panel that holds focus (FR-131)', () => {
  for (const [name, caps] of [
    ['main', MAIN_WINDOW_CAPABILITIES],
    ['sub-workspace', SUB_WORKSPACE_CAPABILITIES],
  ] as const) {
    it(`${name}: from a focused terminal it destroys THAT panel, and the terminal receives nothing`, async () => {
      await mountDispatcher(caps);
      const p1 = vi.fn();
      const p2 = vi.fn();
      registerPanelDestroy('p1', p1);
      registerPanelDestroy('p2', p2);
      // p1 is the tab's active panel; focus is in p2's terminal — the panel that holds focus wins.
      const { terminal, reached } = panelWithTerminal('p2');
      terminal.focus();

      expect(press(terminal)).toBe(true);
      expect(reached, 'the chord reached the terminal').not.toHaveBeenCalled();
      expect(p2).toHaveBeenCalledTimes(1);
      expect(p1).not.toHaveBeenCalled();
      expect(getPendingChord(), 'it raised a not-available notice').toBeNull();
    });
  }

  it('with focus on no element (the body) and the workspace holding the pane, it destroys the active panel', async () => {
    await mountDispatcher(MAIN_WINDOW_CAPABILITIES);
    const p1 = vi.fn();
    registerPanelDestroy('p1', p1);
    expect(press(document.body)).toBe(true);
    expect(p1).toHaveBeenCalledTimes(1);
  });

  for (const pane of ['files', 'projects'] as const) {
    it(`with focus in a side pane (${pane}) it destroys nothing and leaves the key to the pane`, async () => {
      await mountDispatcher(MAIN_WINDOW_CAPABILITIES);
      const p1 = vi.fn();
      registerPanelDestroy('p1', p1);
      const tree = mounted(document.createElement('div'));
      tree.tabIndex = 0;
      tree.focus();
      setActivePane(pane);

      expect(press(tree), 'the dispatcher consumed the chord in a side pane').toBe(false);
      expect(p1).not.toHaveBeenCalled();
    });
  }

  it('with focus in a dialog it destroys nothing — a pending confirmation is not asked twice', async () => {
    await mountDispatcher(MAIN_WINDOW_CAPABILITIES);
    const p1 = vi.fn();
    registerPanelDestroy('p1', p1);
    const dialog = mounted(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    const button = mounted(document.createElement('button'), dialog);
    button.focus();

    expect(press(button)).toBe(false);
    expect(p1).not.toHaveBeenCalled();
  });

  it('follows a rebind: the old chord does nothing, the new one destroys', async () => {
    m = await mountWorkspace(twoPanels(), {
      extras: [createElement(WindowDispatcher, { key: 'dispatcher', capabilities: MAIN_WINDOW_CAPABILITIES })],
      throng: {
        config: {
          get: () => Promise.resolve({ settings: {}, keybindings: { bindings: { 'panel.destroy': ['Ctrl+Alt+F9'] } } }),
          onChange: () => () => {},
        },
      },
    });
    const p1 = vi.fn();
    registerPanelDestroy('p1', p1);
    const { terminal } = panelWithTerminal('p1');
    terminal.focus();
    await waitFor(() => {
      press(terminal, { key: 'F9', code: 'F9', ctrlKey: true, altKey: true });
      expect(p1).toHaveBeenCalled();
    });
    p1.mockClear();
    expect(press(terminal)).toBe(false);
    expect(p1).not.toHaveBeenCalled();
  });
});

/* ══ The real flow, through the real TabGroup — the ✕'s own flow, reached from the keyboard ══ */

const plain = (id: string, origin: string): Panel => ({ type: 'panel', id, originProjectId: origin, title: `Panel ${id}` });
const row = (...children: Panel[]): LayoutNode =>
  children.length === 1
    ? (children[0] as Panel)
    : { type: 'split', orientation: 'row', children, sizes: children.map(() => 1 / children.length) };

function layoutOf(projectId: string, root: LayoutNode): WorkspaceLayout {
  const base = createDefaultLayout(projectId, { tab: 't1', panel: 'unused' });
  return { ...base, tabs: [{ id: 't1', title: 'Tab 1', root, activePanelId: collectPanels(root)[0]?.id }], activeTabId: 't1' };
}

function fakeDaemon(layout: WorkspaceLayout): ThrongBridge {
  return {
    invoke<T>(method: string): Promise<T> {
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
        default:
          return Promise.resolve({} as T);
      }
    },
  };
}

const captured: { ws: ReturnType<typeof useWorkspace> | null; dirty: DirtyCloseRequest | null } = { ws: null, dirty: null };
function Probe(): null {
  captured.ws = useWorkspace();
  captured.dirty = useDirtyCloseRequest();
  return null;
}
function WhenSettingsAreLive({ children }: { children: ReactNode }): ReactNode {
  return useConfigLoaded() ? children : null;
}
const panelIds = (): string[] => (captured.ws?.layout?.tabs ?? []).flatMap((t) => collectPanels(t.root).map((p) => p.id));

let unmountReal: (() => void) | null = null;

async function mountReal(layout: WorkspaceLayout, opts: { sub?: boolean } = {}): Promise<void> {
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
  const caps = opts.sub ? SUB_WORKSPACE_CAPABILITIES : MAIN_WINDOW_CAPABILITIES;
  const shell = (children: ReactNode): ReactElement =>
    opts.sub
      ? createElement(SubWorkspaceWindowContext.Provider, { value: { id: SUB, name: 'Sub', colour: '#336699' } }, children)
      : createElement(Fragment, null, children);
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
                  createElement(
                    ContextMenuProvider,
                    null,
                    shell(
                      createElement(
                        Fragment,
                        null,
                        createElement(TabGroup, null),
                        createElement(WindowDispatcher, { capabilities: caps }),
                        createElement(Probe, null),
                      ),
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
  unmountReal = () => {
    view.unmount();
    Reflect.deleteProperty(window, 'throng');
  };
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
  await screen.findByTestId(`panel-${collectPanels(layout.tabs[0]!.root)[0]!.id}`);
}

/** Focus somewhere inside panel `id`'s box and press the chord there. */
function pressInPanel(id: string): boolean {
  const body = screen.getByTestId(`panel-body-${id}`);
  body.tabIndex = -1;
  body.focus();
  return press(body);
}

describe('the chord runs the panel’s own destroy flow (FR-131 — the ✕’s flow, not a copy)', () => {
  afterEach(() => {
    unmountReal?.();
    unmountReal = null;
    captured.ws = null;
    captured.dirty = null;
  });

  it('an empty panel that holds focus is destroyed at once, and only that one', async () => {
    await mountReal(layoutOf(PROJECT, row(plain('a', PROJECT), plain('b', PROJECT))));
    expect(pressInPanel('b')).toBe(true);
    await waitFor(() => expect(panelIds()).toEqual(['a']));
  });

  it('a panel holding unsaved editor content asks first, and Cancel keeps it (the unsaved-editor guard)', async () => {
    await mountReal(layoutOf(PROJECT, row(plain('a', PROJECT), plain('p2', PROJECT))));
    registerEditorActions('p2', {
      save: () => Promise.resolve(true),
      saveAs: () => Promise.resolve(true),
      isDirty: () => true,
      openFile: () => Promise.resolve(),
      revert: () => {},
      reloadFromDisk: () => Promise.resolve(true),
    });
    pressInPanel('p2');
    await waitFor(() => expect(captured.dirty).not.toBeNull());
    expect(panelIds()).toEqual(['a', 'p2']);
    act(() => captured.dirty?.resolve('cancel'));
    await waitFor(() => expect(captured.dirty).toBeNull());
    expect(panelIds()).toEqual(['a', 'p2']);
  });

  it('in a sub-workspace window, the last panel asks to destroy the sub-workspace — exactly as its ✕ does', async () => {
    await mountReal(layoutOf(SUB, plain('only', SUB)), { sub: true });
    pressInPanel('only');
    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog.textContent).toContain('Destroy sub-workspace');
  });

  it('stops listening once the panel is gone — a second press destroys nothing more', async () => {
    await mountReal(layoutOf(PROJECT, row(plain('a', PROJECT), plain('b', PROJECT))));
    pressInPanel('b');
    await waitFor(() => expect(panelIds()).toEqual(['a']));
    expect(requestPanelDestroy('b')).toBe(false);
  });
});

/* ══ The menu shows the chord ══ */

const noop = (): void => {};
const panelActions: PanelHeaderMenuActions = {
  split: noop,
  zoomIn: noop,
  zoomOut: noop,
  resetZoom: noop,
  save: noop,
  saveAs: noop,
  revert: noop,
  reloadFromDisk: noop,
  reloadTerminal: noop,
  revealInTree: noop,
  openInOsExplorer: noop,
  tryAgain: noop,
  copyDetails: noop,
  clearPanelType: noop,
  redraw: noop,
  sendToNewTab: noop,
  sendToTab: noop,
  find: noop,
  replace: noop,
  replaceAll: noop,
  destroy: noop,
  openPreview: noop,
  navigateBack: noop,
  navigateForward: noop,
  refreshPreview: noop,
  openInEditor: noop,
  goToEditor: noop,
  toggleSyncScroll: noop,
};

function destroyItem(panelVerb: 'Destroy' | 'Close', keybindings: Keybindings) {
  return panelHeaderMenu({
    panel: plain('p1', PROJECT),
    panelVerb,
    keybindings,
    otherTabs: [],
    editor: null,
    panelFailure: false,
    detach: null,
    preview: null,
    actions: panelActions,
  }).find((i) => i.label === `${panelVerb} Panel`);
}

describe('the panel menu’s Destroy item shows the chord (FR-131)', () => {
  it('Destroy Panel and Close Panel each show the shipped chord', () => {
    expect(destroyItem('Destroy', DEFAULT_KEYBINDINGS)?.shortcut).toBe('Ctrl+Shift+Alt+F4');
    expect(destroyItem('Close', DEFAULT_KEYBINDINGS)?.shortcut).toBe('Ctrl+Shift+Alt+F4');
  });

  it('shows a rebound chord, and none when the command is unbound', () => {
    const rebound = { ...DEFAULT_KEYBINDINGS, bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'panel.destroy': ['Ctrl+Alt+F9'] } };
    expect(destroyItem('Destroy', rebound)?.shortcut).toBe('Ctrl+Alt+F9');
    const unbound = { ...DEFAULT_KEYBINDINGS, bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'panel.destroy': [] } };
    expect(destroyItem('Destroy', unbound)?.shortcut).toBeUndefined();
  });
});
