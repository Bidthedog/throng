/**
 * 044 T104 — Files & Folders *Open In → Preview* (FR-003, FR-004, FR-012, FR-062, SC-001;
 * contracts/menus-and-controls.md §5).
 *
 * ══ WHO DECIDES, WHO DRAWS ══
 *
 * Core's `previewAffordance` decides (absent / disabled / enabled); `file-tree.tsx` asks it at
 * right-click — with `preview.isOpen` AWAITED, because a menu is built once, at open time, and must not
 * read a value from the last render — and passes the answer to `buildContextMenuItems` as its own
 * argument. It is never added to the shared `describeOpenInTargets`, which Find in Files rows also draw
 * (T105 guards that side).
 *
 * ══ WHY THE CLICK IS OBSERVED AT THE OPENER ══
 *
 * FR-005: every entry point runs the one `preview.open` command through the window's registered opener
 * (`requestPreviewOpen`), and that opener is what calls `window.throng.preview.open`
 * (`open-preview.test.ts` owns that half). So this file asserts that choosing the row reaches the one
 * command with the right request, exactly as `status-strip-preview-button.test.ts` does for the button.
 *
 * ══ ANTI-VACUITY ══
 *
 * Every "absent" case also asserts that the flyout itself was opened and holds *Terminal*, so an
 * absence cannot pass on a menu that never rendered.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHIPPED_PREVIEW_PROVIDERS,
  createDefaultLayout,
  previewAffordance,
  DEFAULT_APP_SETTINGS,
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
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { FileTree } from '../../src/renderer/explorer/file-tree.js';
import { buildContextMenuItems, type ContextMenuOps } from '../../src/renderer/explorer/context-menu-items.js';
import { PreviewProviderRegistryContext } from '../../src/renderer/preview/provider-registry-context.js';
import { PREVIEW_PROVIDER_VIEWS } from '../../src/renderer/preview/providers/index.js';
import { registerPreviewOpener, type PreviewOpenIntent } from '../../src/renderer/preview/open-preview.js';
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
const PROJECT_ID = 'proj-preview';

const entry = (name: string, kind: 'file' | 'folder'): FileTreeEntry => ({
  name,
  kind,
  isSymlink: false,
  hasChildren: kind === 'folder',
});

const LISTING: Record<string, FileTreeEntry[]> = {
  '': [entry('docs', 'folder'), entry('README.md', 'file'), entry('notes.txt', 'file')],
  docs: [],
};

const MARKDOWN_OFF = { editor: { previews: { providers: { markdown: { enabled: false } } } } };

function fakeServices(layout: WorkspaceLayout): { services: Services; loads: string[] } {
  const loads: string[] = [];
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      switch (method) {
        case 'workspace.load':
          loads.push((params as { projectId: string }).projectId);
          return Promise.resolve({ layout, restored: true } as TResult);
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

let opened: PreviewOpenIntent[];
let isOpenAsked: string[];

beforeEach(() => {
  localStorage.clear();
  opened = [];
  isOpenAsked = [];
  registerPreviewOpener((intent) => {
    opened.push(intent);
    return Promise.resolve({ kind: 'placed', panelId: 'panel-x' });
  });
});
afterEach(() => {
  registerPreviewOpener(null);
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

async function mount(opts: { previewOpen?: boolean; settings?: Record<string, unknown> } = {}) {
  const user = userEvent.setup();
  const { services, loads } = fakeServices(createDefaultLayout(PROJECT_ID, { tab: 't1', panel: 'p1' }));
  let configLoaded = false;
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
    preview: {
      isOpen: vi.fn((absPath: string) => {
        isOpenAsked.push(absPath);
        return Promise.resolve(opts.previewOpen ?? false);
      }),
    },
    config: {
      get: () => {
        configLoaded = true;
        return Promise.resolve({ settings: opts.settings });
      },
      onChange: () => () => {},
    },
  });

  const wrap = (children: ReactNode): ReactElement =>
    createElement(
      PreviewProviderRegistryContext.Provider,
      { value: { registry: SHIPPED_PREVIEW_PROVIDERS, views: PREVIEW_PROVIDER_VIEWS } },
      createElement(
        ConfigProvider,
        null,
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
        ),
      ),
    );

  render(
    wrap(createElement(FileTree, { rootFolder: ROOT_FOLDER, projectId: PROJECT_ID, hiddenPaths: [], onHide: vi.fn() })),
  );
  const tree = await screen.findByRole('tree');
  await waitFor(() => expect(loads).toEqual([PROJECT_ID]));
  await waitFor(() => expect(configLoaded).toBe(true));
  await act(() => Promise.resolve());
  return { user, tree };
}

async function openInFlyout(user: ReturnType<typeof userEvent.setup>, tree: HTMLElement, name: string): Promise<HTMLElement> {
  await user.pointer({ keys: '[MouseRight]', target: within(tree).getByText(name) });
  await user.click(await screen.findByTestId('menu-item-Open In'));
  const flyout = await screen.findByTestId('submenu-Open In');
  // The anti-vacuity anchor: the flyout really rendered.
  expect(within(flyout).getByTestId('menu-item-Terminal')).toBeInTheDocument();
  return flyout;
}

/** The labels of the flyout's own rows, in order (nested flyouts excluded). */
const rowLabels = (flyout: HTMLElement): string[] =>
  [...flyout.querySelectorAll('[role="menuitem"]')]
    .filter((el) => el.closest('[role="menu"]') === flyout)
    .map((el) => (el.getAttribute('data-testid') ?? '').replace(/^menu-item-/, ''));

describe('where Preview sits in Open In (contracts §5)', () => {
  it('after the editor targets, before Terminal, with OS File Explorer still first', async () => {
    const { user, tree } = await mount();
    const flyout = await openInFlyout(user, tree, 'README.md');
    const labels = rowLabels(flyout);

    expect(labels[0]).toBe('OS File Explorer');
    const preview = labels.indexOf('Preview');
    expect(preview, `Preview in ${JSON.stringify(labels)}`).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(labels.indexOf('New Editor'));
    expect(preview).toBe(labels.indexOf('Terminal') - 1);
  });
});

describe('absent where a preview means nothing (FR-003, FR-004)', () => {
  it('on a folder', async () => {
    const { user, tree } = await mount();
    const flyout = await openInFlyout(user, tree, 'docs');
    expect(within(flyout).queryByTestId('menu-item-Preview')).toBeNull();
  });

  it('on a file no provider claims', async () => {
    const { user, tree } = await mount();
    const flyout = await openInFlyout(user, tree, 'notes.txt');
    expect(within(flyout).queryByTestId('menu-item-Preview')).toBeNull();
    expect(within(flyout).getByTestId('menu-item-New Editor')).toBeInTheDocument();
  });

  it('for a file outside the project — the builder draws no row for an absent affordance', () => {
    // The tree composes every path under its own root, so the outside case is reached at the seam the
    // tree hands over: core's answer for a path outside the root, passed as the Preview argument.
    const affordance = previewAffordance({
      registry: SHIPPED_PREVIEW_PROVIDERS,
      settings: DEFAULT_APP_SETTINGS.editor.previews,
      absPath: 'E:/elsewhere/README.md',
      projectRoot: ROOT_FOLDER,
      isFolder: false,
      previewOpen: false,
      surface: 'explorer',
    });
    expect(affordance.state).toBe('absent');
    const noop = (): void => {};
    const ops = new Proxy({}, { get: () => noop }) as unknown as ContextMenuOps;
    const items = buildContextMenuItems({
      node: { relPath: 'README.md', kind: 'file' },
      selectedRelPaths: [],
      clipboard: null,
      ops,
      preview: { affordance, open: noop },
    });
    const openIn = items.find((i) => i.label === 'Open In');
    expect(openIn?.submenu?.map((i) => i.label)).not.toContain('Preview');
  });
});

describe('drawn DISABLED, never hidden, while unavailable', () => {
  const isDisabled = (el: HTMLElement): boolean => el.getAttribute('aria-disabled') === 'true';

  it('while the provider is turned off (FR-062)', async () => {
    const { user, tree } = await mount({ settings: MARKDOWN_OFF });
    const flyout = await openInFlyout(user, tree, 'README.md');
    const row = within(flyout).getByTestId('menu-item-Preview');
    expect(isDisabled(row)).toBe(true);
    await user.click(row);
    expect(opened).toEqual([]);
  });

  it('while main says the file already has its preview — awaited at right-click (FR-012)', async () => {
    const { user, tree } = await mount({ previewOpen: true });
    const flyout = await openInFlyout(user, tree, 'README.md');
    expect(isOpenAsked).toEqual([`${ROOT_FOLDER}/README.md`]);
    const row = within(flyout).getByTestId('menu-item-Preview');
    expect(isDisabled(row)).toBe(true);
    await user.click(row);
    expect(opened).toEqual([]);
  });
});

describe('choosing it runs preview.open (FR-003, FR-005, SC-001)', () => {
  it('asks the one command for this file, in this project, with no requesting panel', async () => {
    const { user, tree } = await mount();
    const flyout = await openInFlyout(user, tree, 'README.md');
    const row = within(flyout).getByTestId('menu-item-Preview');
    expect(row.getAttribute('aria-disabled')).toBe('false');

    await user.click(row);

    expect(opened).toEqual([{ absPath: `${ROOT_FOLDER}/README.md`, projectId: PROJECT_ID }]);
  });
});
