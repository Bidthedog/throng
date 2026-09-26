/**
 * A new tab's name box keeps focus while it is open (046 FR-125 against rename-on-create).
 *
 * REGRESSION (gate 36247830190 at c9c7ebdc, `notice-a11y.e2e.ts:142`): after `tab-add`, the new tab's
 * rename box was gone. FR-125 (T211) gave the untyped panel a focus target, so `PanelFocusSync`'s
 * tab-switch `requestPanelFocus(activePanelId)` — parked until the new tab's panel registers — now
 * DELIVERS: the type picker takes focus, the name box blurs, and blur commits and closes it.
 *
 * Required: the name box keeps focus while it is open; when it closes (Enter or Escape), focus moves
 * into the new tab's active panel — for an untyped panel, its type picker (FR-125).
 *
 * The same check for the other rename-on-create surface, a new panel opening in rename mode
 * (FR-041, `lastAddedPanelId`), sits beside it.
 *
 * Mounted as a window mounts them: the real `TabGroup` (which renders the strip, the New Tab button and
 * the active tab's panels) with the real `PanelFocusSync` beside it.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { PanelFocusSync } from '../../src/renderer/app.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';

const PROJECT = 'proj-new-tab';

const captured: { ws: ReturnType<typeof useWorkspace> | null } = { ws: null };
function Probe(): null {
  captured.ws = useWorkspace();
  return null;
}

function mount(): void {
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn(), notifyTyped: vi.fn(), publishIdentities: vi.fn() },
    config: { get: () => Promise.resolve({ settings: DEFAULT_APP_SETTINGS }), onChange: () => () => {} },
  });
  const layout: WorkspaceLayout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
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
        case 'panelName.claim':
          return Promise.resolve({ granted: (params as { desired: string }).desired, adjusted: false } as T);
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
                  createElement(
                    Fragment,
                    null,
                    createElement(TabGroup, null),
                    createElement(PanelFocusSync, null),
                    createElement(Probe, null),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/** Two animation frames and a macrotask: every deferred focus the code schedules has run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

const activeTab = () => {
  const l = captured.ws?.layout;
  return l?.tabs.find((t) => t.id === l.activeTabId);
};

afterEach(() => {
  __resetPanelFocus();
  setActivePane('workspace');
  captured.ws = null;
  Reflect.deleteProperty(window, 'throng');
});

describe('a new tab opens with its name box focused, and focus goes into its panel when the box closes', () => {
  async function addTab(): Promise<{ input: HTMLInputElement; tabId: string; panelId: string }> {
    mount();
    await screen.findByTestId('panel-type-select-p1');
    fireEvent.click(screen.getByTestId('tab-add'));
    await waitFor(() => expect(activeTab()?.id).not.toBe('t1'));
    const tab = activeTab()!;
    const panelId = collectPanels(tab.root)[0].id;
    await screen.findByTestId(`panel-type-select-${panelId}`);
    await settle();
    const input = screen.queryByTestId(`tab-rename-input-${tab.id}`) as HTMLInputElement | null;
    expect(input, 'the new tab’s name box closed — something took focus from it').not.toBeNull();
    return { input: input!, tabId: tab.id, panelId };
  }

  it('the name box is still open and holds focus once the new tab’s panel has mounted', async () => {
    const { input } = await addTab();
    expect(document.activeElement, `activeElement: ${document.activeElement?.outerHTML.slice(0, 120)}`).toBe(input);
  });

  it('Enter closes it and moves focus to the new tab’s type picker (FR-125)', async () => {
    const { input, tabId, panelId } = await addTab();
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await settle();
    expect(screen.queryByTestId(`tab-rename-input-${tabId}`)).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId(`panel-type-select-${panelId}`));
  });

  it('Escape closes it and moves focus to the new tab’s type picker (FR-125)', async () => {
    const { input, tabId, panelId } = await addTab();
    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    await settle();
    expect(screen.queryByTestId(`tab-rename-input-${tabId}`)).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId(`panel-type-select-${panelId}`));
  });
});

describe('a new panel opens with its name box focused (FR-041 rename-on-create)', () => {
  it('the new panel’s name box is still open and holds focus once the panel has mounted', async () => {
    mount();
    await screen.findByTestId('panel-type-select-p1');
    fireEvent.click(screen.getByTestId('panel-add-p1'));
    let newId = '';
    await waitFor(() => {
      const ids = collectPanels(activeTab()!.root).map((p) => p.id);
      expect(ids.length).toBe(2);
      newId = ids.find((id) => id !== 'p1')!;
    });
    await screen.findByTestId(`panel-type-select-${newId}`);
    await settle();
    const box = screen.getByTestId(`panel-${newId}`).querySelector('input[type="text"]');
    expect(box, 'the new panel’s name box closed — something took focus from it').not.toBeNull();
    expect(document.activeElement).toBe(box);
  });
});
