/**
 * 057 FR-125, amended by the v1 review (2026-11-28): "Flagging when in a panel also needs a keyboard shortcut."
 * `panel.toggleFlag` flags the panel that holds focus, or unflags it when it holds a mark, running the same
 * flag / unflag its title menu's Flag / Unflag row runs.
 *
 * Layer: component. The real `TabGroup` mounts the real panel box, which registers the toggle; the real window
 * dispatcher takes the chord. Main is the stand-in: `attention.flag` / `attention.unflag` are recorded, and the
 * mark set is fed to the attention store the way main's broadcast would.
 *
 * A dormant terminal is the typed panel here: it offers Flag like any typed panel and mounts no shell.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Fragment, createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  collectPanels,
  createDefaultLayout,
  type AttentionMark,
  type LayoutNode,
  type Panel,
  type WorkspaceLayout,
} from '@throng/core';
import { MAIN_WINDOW_CAPABILITIES, WindowDispatcher } from '../../src/renderer/keybindings/window-dispatcher.js';
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
import { TabGroup } from '../../src/renderer/workspace/tab-group.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { __resetAttentionStore, setAttentionMarks } from '../../src/renderer/attention/attention-store.js';
import { runPanelFlagToggle } from '../../src/renderer/workspace/panel-flag-registry.js';

const PROJECT = 'proj';

const dormantTerminal = (id: string): Panel => ({
  type: 'panel',
  id,
  originProjectId: PROJECT,
  title: `Terminal ${id}`,
  kind: 'terminal',
  dormant: true,
});
const plain = (id: string): Panel => ({ type: 'panel', id, originProjectId: PROJECT, title: `Panel ${id}` });

function layoutOf(...children: Panel[]): WorkspaceLayout {
  const root: LayoutNode =
    children.length === 1
      ? children[0]!
      : { type: 'split', orientation: 'row', children, sizes: children.map(() => 1 / children.length) };
  const base = createDefaultLayout(PROJECT, { tab: 't1', panel: 'unused' });
  return { ...base, tabs: [{ id: 't1', title: 'Tab 1', root, activePanelId: collectPanels(root)[0]?.id }], activeTabId: 't1' };
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

function WhenSettingsAreLive({ children }: { children: ReactNode }): ReactNode {
  return useConfigLoaded() ? children : null;
}

/** The shipped chord as a keydown carries it. */
function chordEvent(): KeyboardEventInit {
  const token = DEFAULT_KEYBINDINGS.bindings['panel.toggleFlag'][0]!;
  const parts = token.split('+');
  const key = parts.pop()!;
  return {
    key: key.toLowerCase(),
    code: `Key${key.toUpperCase()}`,
    ctrlKey: parts.includes('Ctrl'),
    shiftKey: parts.includes('Shift'),
    altKey: parts.includes('Alt'),
    bubbles: true,
    cancelable: true,
  };
}

const flag = vi.fn();
const unflag = vi.fn();
let unmount: (() => void) | null = null;

async function mount(layout: WorkspaceLayout): Promise<void> {
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn(), notifyTyped: vi.fn() },
    history: { purge: vi.fn(), attach: vi.fn(), setViewState: vi.fn(), onChanged: () => () => {} },
    config: { get: () => Promise.resolve({ settings: {} }), onChange: () => () => {} },
    attention: { flag, unflag },
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
                  createElement(
                    ContextMenuProvider,
                    null,
                    createElement(
                      Fragment,
                      null,
                      createElement(TabGroup, null),
                      createElement(WindowDispatcher, { capabilities: MAIN_WINDOW_CAPABILITIES }),
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
  unmount = () => {
    view.unmount();
    Reflect.deleteProperty(window, 'throng');
  };
  await screen.findByTestId(`panel-${collectPanels(layout.tabs[0]!.root)[0]!.id}`);
}

/** Focus inside panel `id`'s box and press the chord there; true when the dispatcher consumed it. */
function pressInPanel(id: string): boolean {
  const body = screen.getByTestId(`panel-body-${id}`);
  body.tabIndex = -1;
  body.focus();
  let notTaken = true;
  act(() => {
    notTaken = fireEvent.keyDown(body, chordEvent());
  });
  return !notTaken;
}

function markOn(panelId: string): AttentionMark {
  return {
    panelId,
    projectId: PROJECT,
    panelTitle: `Terminal ${panelId}`,
    projectName: '',
    tabTitle: 'Tab 1',
    doing: null,
    producer: 'user',
    kind: 'waiting',
    reason: 'flagged',
    raisedAt: 1,
    dwellStartedAt: null,
  } as AttentionMark;
}

afterEach(() => {
  unmount?.();
  unmount = null;
  flag.mockReset();
  unflag.mockReset();
  __resetAttentionStore();
});

describe('panel.toggleFlag flags or unflags the panel that holds focus (057 FR-125, v1 review)', () => {
  it('ships a tier-2 chord', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['panel.toggleFlag']).toEqual(['Ctrl+Alt+G']);
  });

  it('flags an unflagged panel, with its place, as the Flag row does', async () => {
    await mount(layoutOf(dormantTerminal('a'), dormantTerminal('b')));
    expect(pressInPanel('b')).toBe(true);
    expect(flag).toHaveBeenCalledTimes(1);
    expect(flag.mock.calls[0]![0]).toMatchObject({ panelId: 'b', projectId: PROJECT });
    expect(unflag).not.toHaveBeenCalled();
  });

  it('unflags a panel that holds a mark, as the Unflag row does', async () => {
    await mount(layoutOf(dormantTerminal('a'), dormantTerminal('b')));
    // Main's broadcast of the mark set, then a render for the panel to read it.
    await act(async () => {
      setAttentionMarks([markOn('b')]);
      await Promise.resolve();
    });
    expect(pressInPanel('b')).toBe(true);
    expect(unflag).toHaveBeenCalledWith('b');
    expect(flag).not.toHaveBeenCalled();
  });

  it('a blank panel offers no Flag, so the chord has nothing to flag there', async () => {
    await mount(layoutOf(plain('a'), dormantTerminal('b')));
    pressInPanel('a');
    expect(flag).not.toHaveBeenCalled();
    expect(runPanelFlagToggle('a')).toBe(false);
  });
});
