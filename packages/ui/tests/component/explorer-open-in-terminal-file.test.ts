/**
 * 033 US3 AS-3 / B4 — a right-clicked FILE opens its terminal in the file's PARENT folder.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/open-in-terminal.e2e.ts` (`AS-3 — a right-clicked file opens its
 * terminal in the file’s parent folder`). The E2E launched Electron and a real shell to read the cwd tag
 * off the panel header; the rule under test is one line in `FileTree.openInTerminal`: the start
 * directory is built from `resolveTarget(node)`, which is the parent folder for a file. That request is
 * observable at the component: the config handed to `window.throng.panel.notifyTyped` is the one
 * `ws.setPanelType` was given.
 *
 * Layer: component — the decision lives in `file-tree.tsx`, not in a shell; a real shell reporting a real
 * cwd is what AS-2 (kept at E2E) and B5 prove.
 *
 * ══ ANTI-VACUITY / MUTATION ══
 *
 * In `openInTerminal`, build the start directory from the node's own path instead of `resolveTarget(node)`
 * (`${rootFolder}/${node.relPath}`): the assertion below goes red with `.../deep/nested/inside.txt`.
 * Deleting the `ResizeObserver` stub leaves the tree unmounted and every step fails at `findByRole('tree')`.
 *
 * Harness modelled on `explorer-open-in-target.test.ts`.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, type WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { FileTree } from '../../src/renderer/explorer/file-tree.js';
import type { FileTreeEntry } from '../../src/renderer/global.js';

class ImmediateResizeObserver implements ResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    const contentRect = { width: 320, height: 600, top: 0, left: 0, right: 320, bottom: 600, x: 0, y: 0, toJSON: () => ({}) };
    this.cb([{ target, contentRect } as ResizeObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  globalThis.ResizeObserver = ImmediateResizeObserver;
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
});

const ROOT_FOLDER = 'C:/projects/demo';
const PROJECT_ID = 'proj-oit-file';

const entry = (name: string, kind: 'file' | 'folder'): FileTreeEntry => ({
  name,
  kind,
  isSymlink: false,
  hasChildren: kind === 'folder',
});

const LISTING: Record<string, FileTreeEntry[]> = {
  '': [entry('deep', 'folder'), entry('top.txt', 'file')],
  deep: [entry('nested', 'folder')],
  'deep/nested': [entry('inside.txt', 'file')],
};

function fakeServices(layout: WorkspaceLayout): { services: Services; loads: string[] } {
  const loads: string[] = [];
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      switch (method) {
        case 'workspace.load':
          loads.push((params as { projectId: string }).projectId);
          return Promise.resolve({ layout, restored: true } as TResult);
        case 'workspace.save':
          return Promise.resolve({ saved: true } as TResult);
        case 'document.pruneMissing':
          return Promise.resolve({ pruned: 0 } as TResult);
        case 'fileopUndo.get':
          return Promise.resolve({ stackJson: null } as TResult);
        default:
          return Promise.reject(new Error(`unexpected RPC from the file tree: ${method}`));
      }
    },
  };
  return {
    services: {
      bridge,
      projects: new ProjectsClient(bridge),
      workspace: new WorkspaceClient(bridge),
      subWorkspaces: new SubWorkspacesClient(bridge),
      documents: new DocumentClient(bridge),
      fileOpUndo: new FileOpUndoClient(bridge),
      panelNames: new PanelNameClient(bridge),
    },
    loads,
  };
}

let typed: Array<{ panelId: string; kind: string; config: { startDirectory?: string; flavourId?: string } }>;

beforeEach(() => {
  localStorage.clear();
  typed = [];
});
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

async function mount() {
  const user = userEvent.setup({ delay: null });
  const { services, loads } = fakeServices(createDefaultLayout(PROJECT_ID, { tab: 't1', panel: 'p1' }));
  Reflect.set(window, 'throng', {
    files: {
      setRoot: vi.fn(),
      list: vi.fn((relDir: string) => {
        const entries = LISTING[relDir];
        return Promise.resolve(entries ? { entries } : { error: `no such folder: ${relDir}`, cause: null });
      }),
      onChange: vi.fn(() => () => {}),
      onWatchFailed: vi.fn(() => () => {}),
    },
    editor: { isOpen: () => Promise.resolve(false) },
    terminal: {
      listFlavours: () => Promise.resolve([{ id: 'test-shell', label: 'Test Shell', defaultShellArguments: [] }]),
    },
    config: { onChange: () => () => {} },
    panel: {
      notifyTyped: vi.fn((panelId: string, kind: string, config: (typeof typed)[number]['config']) => {
        typed.push({ panelId, kind, config });
      }),
    },
  });

  const wrap = (children: ReactNode): ReactElement =>
    createElement(
      ServicesProvider,
      { services },
      createElement(
        WorkspaceProvider,
        { client: services.workspace, activeProjectId: PROJECT_ID },
        createElement(
          NotificationProvider,
          null,
          createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, children)),
        ),
      ),
    );

  render(wrap(createElement(FileTree, { rootFolder: ROOT_FOLDER, projectId: PROJECT_ID, hiddenPaths: [], onHide: vi.fn() })));
  const tree = await screen.findByRole('tree');
  await waitFor(() => expect(loads).toEqual([PROJECT_ID]));
  await act(() => Promise.resolve());
  return { user, tree };
}

describe('Open In → Terminal on a file (033 AS-3 / B4)', () => {
  it('starts the terminal in the file’s parent folder, never the file itself', async () => {
    const { user, tree } = await mount();
    await user.dblClick(within(tree).getByText('deep'));
    await user.dblClick(await within(tree).findByText('nested'));
    const file = await within(tree).findByText('inside.txt');

    await user.pointer({ keys: '[MouseRight]', target: file });
    await user.click(await screen.findByTestId('menu-item-Open In'));
    await screen.findByTestId('submenu-Open In');
    await user.click(await screen.findByTestId('menu-item-Terminal'));
    const flavours = await screen.findByTestId('submenu-Terminal');
    await user.click(within(flavours).getByText('Test Shell'));

    await waitFor(() => expect(typed).toHaveLength(1));
    expect(typed[0]!.kind).toBe('terminal');
    expect(typed[0]!.config.startDirectory).toBe(`${ROOT_FOLDER}/deep/nested`);
  });
});
