/**
 * 044 T104 — File Explorer *Open In → Preview* (FR-003, FR-004, FR-012, FR-062, SC-001;
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
  PREVIEW_KIND,
  SHIPPED_PREVIEW_PROVIDERS,
  createDefaultLayout,
  previewAffordance,
  DEFAULT_APP_SETTINGS,
  truncateGraphemes,
  type Panel,
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
import { __resetLastActivePreview, recordLastActivePreview } from '../../src/renderer/preview/last-active-preview.js';
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
  __resetLastActivePreview();
  registerPreviewOpener((intent) => {
    opened.push(intent);
    return Promise.resolve({ kind: 'placed', panelId: 'panel-x' });
  });
});
afterEach(() => {
  registerPreviewOpener(null);
  localStorage.clear();
  __resetLastActivePreview();
  Reflect.deleteProperty(window, 'throng');
});

/**
 * 047 US2 — `createDefaultLayout`'s single untyped panel, typed as a preview UP FRONT (`setPanelType`
 * is a no-op on an already-typed panel, and this fixture needs one typed from the start), so *Last
 * Preview Panel* has something in the visible tab to reuse once `recordLastActivePreview` names it.
 */
function layoutWithVisiblePreview(previewId: string, filePath: string): WorkspaceLayout {
  const base = createDefaultLayout(PROJECT_ID, { tab: 't1', panel: previewId });
  const root = base.tabs[0]!.root as Panel;
  return { ...base, tabs: [{ ...base.tabs[0]!, root: { ...root, kind: PREVIEW_KIND, config: { filePath } } }] };
}

async function mount(opts: { previewOpen?: boolean; settings?: Record<string, unknown>; layout?: WorkspaceLayout } = {}) {
  const user = userEvent.setup();
  const { services, loads } = fakeServices(opts.layout ?? createDefaultLayout(PROJECT_ID, { tab: 't1', panel: 'p1' }));
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

describe('where the preview rows sit in Open In (contracts §5; 047 FR-075)', () => {
  it('there is NO plain Preview row; Last Preview Panel and New Preview Panel sit after the editor targets, before Terminal', async () => {
    const { user, tree } = await mount();
    const flyout = await openInFlyout(user, tree, 'README.md');
    const labels = rowLabels(flyout);

    expect(labels[0]).toBe('OS File Explorer');
    // 047 FR-075 — the plain Preview row is gone; the two explicit rows replace it.
    expect(labels).not.toContain('Preview');
    const last = labels.indexOf('Last Preview Panel');
    expect(last, `Last Preview Panel in ${JSON.stringify(labels)}`).toBeGreaterThan(-1);
    expect(last).toBeGreaterThan(labels.indexOf('New Editor'));
    expect(labels[last + 1]).toBe('New Preview Panel');
    expect(last).toBe(labels.indexOf('Terminal') - 2);
  });
});

describe('absent where a preview means nothing (FR-003, FR-004)', () => {
  it('on a folder', async () => {
    const { user, tree } = await mount();
    const flyout = await openInFlyout(user, tree, 'docs');
    expect(within(flyout).queryByTestId('menu-item-New Preview Panel')).toBeNull();
  });

  it('on a file no provider claims', async () => {
    const { user, tree } = await mount();
    const flyout = await openInFlyout(user, tree, 'notes.txt');
    expect(within(flyout).queryByTestId('menu-item-New Preview Panel')).toBeNull();
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
      preview: { affordance, openLastActive: noop, openNew: noop, lastPreviewTitle: null },
    });
    const openIn = items.find((i) => i.label === 'Open In');
    const labels = openIn?.submenu?.map((i) => i.label) ?? [];
    expect(labels).not.toContain('New Preview Panel');
    expect(labels).not.toContain('Last Preview Panel');
  });
});

describe('drawn DISABLED, never hidden, while unavailable', () => {
  const isDisabled = (el: HTMLElement): boolean => el.getAttribute('aria-disabled') === 'true';

  it('while the provider is turned off (FR-062)', async () => {
    const { user, tree } = await mount({ settings: MARKDOWN_OFF });
    const flyout = await openInFlyout(user, tree, 'README.md');
    const row = within(flyout).getByTestId('menu-item-New Preview Panel');
    expect(isDisabled(row)).toBe(true);
    await user.click(row);
    expect(opened).toEqual([]);
  });

  it('while main says the file already has its preview — awaited at right-click (FR-012)', async () => {
    const { user, tree } = await mount({ previewOpen: true });
    const flyout = await openInFlyout(user, tree, 'README.md');
    expect(isOpenAsked).toEqual([`${ROOT_FOLDER}/README.md`]);
    const row = within(flyout).getByTestId('menu-item-New Preview Panel');
    expect(isDisabled(row)).toBe(true);
    await user.click(row);
    expect(opened).toEqual([]);
  });
});

/*
 * ── 047 US2 (T037) — Last Preview Panel / New Preview Panel ────────────────────────────────────────
 *
 * contracts/menus-commands-controls.md "Files & Folders → Open In":
 *
 * | Item                | Availability                                                          |
 * |----------------------|------------------------------------------------------------------------|
 * | Last Preview Panel   | as Preview, PLUS disabled while the visible tab has no preview to reuse|
 * | New Preview Panel    | as Preview                                                             |
 */
describe('Last Preview Panel / New Preview Panel (FR-014)', () => {
  const isDisabled = (el: HTMLElement): boolean => el.getAttribute('aria-disabled') === 'true';

  it('present for a file with an enabled provider, absent for a folder or an unclaimed file', async () => {
    const { user, tree } = await mount();
    const flyout = await openInFlyout(user, tree, 'README.md');
    expect(within(flyout).getByTestId('menu-item-Last Preview Panel')).toBeInTheDocument();
    expect(within(flyout).getByTestId('menu-item-New Preview Panel')).toBeInTheDocument();
  });

  it('absent on a folder and on a file no provider claims, exactly like Preview', async () => {
    const { user, tree } = await mount();
    const folderFlyout = await openInFlyout(user, tree, 'docs');
    expect(within(folderFlyout).queryByTestId('menu-item-Last Preview Panel')).toBeNull();
    expect(within(folderFlyout).queryByTestId('menu-item-New Preview Panel')).toBeNull();

    const unclaimedFlyout = await openInFlyout(user, tree, 'notes.txt');
    expect(within(unclaimedFlyout).queryByTestId('menu-item-Last Preview Panel')).toBeNull();
    expect(within(unclaimedFlyout).queryByTestId('menu-item-New Preview Panel')).toBeNull();
  });

  it('New Preview Panel is disabled exactly when Preview is (provider off, already previewed)', async () => {
    const off = await mount({ settings: MARKDOWN_OFF });
    const offFlyout = await openInFlyout(off.user, off.tree, 'README.md');
    expect(isDisabled(within(offFlyout).getByTestId('menu-item-New Preview Panel'))).toBe(true);

    const already = await mount({ previewOpen: true });
    const alreadyFlyout = await openInFlyout(already.user, already.tree, 'README.md');
    expect(isDisabled(within(alreadyFlyout).getByTestId('menu-item-New Preview Panel'))).toBe(true);
  });

  it('Last Preview Panel is ALSO disabled, and unnamed, while the visible tab holds no preview to reuse (FR-076)', async () => {
    // No preview recorded active in this (default, single-panel, non-preview) layout.
    const { user, tree } = await mount();
    const flyout = await openInFlyout(user, tree, 'README.md');
    const row = within(flyout).getByTestId('menu-item-Last Preview Panel');
    expect(isDisabled(row)).toBe(true);
    await user.click(row);
    expect(opened).toEqual([]);
  });

  it('Last Preview Panel is enabled, and names the panel it would reuse as its header shows it (FR-076)', async () => {
    recordLastActivePreview('t1', 'pv');
    const { user, tree } = await mount({ layout: layoutWithVisiblePreview('pv', `${ROOT_FOLDER}/other.md`) });
    const flyout = await openInFlyout(user, tree, 'README.md');
    // The header title of a standalone preview is `<file stem> - Preview` (044 FR-031); the item names the
    // panel without the suffix, since it already says "Preview Panel" (FR-080).
    const row = within(flyout).getByTestId('menu-item-Last Preview Panel (other)');
    expect(isDisabled(row)).toBe(false);
    expect(within(flyout).queryByTestId('menu-item-Last Preview Panel')).toBeNull();
  });

  /**
   * MT-02 round 3 — "the name of the panel in Last Preview Panel (<name>) should be truncated as long
   * file names make that menu item look ridiculous". FR-076 names the panel as its HEADER shows it, and
   * the header truncates at `tabs.maxNameLength` (031 US4); the menu drew the whole name.
   */
  it('truncates a long panel name exactly as the header does (FR-076, MT-02)', async () => {
    recordLastActivePreview('t1', 'pv');
    const stem = 'an-extremely-long-markdown-file-name-that-goes-on-and-on-well-past-any-sensible-width';
    const { user, tree } = await mount({ layout: layoutWithVisiblePreview('pv', `${ROOT_FOLDER}/${stem}.md`) });
    const flyout = await openInFlyout(user, tree, 'README.md');
    // FR-080 (round 3, amended) — the name alone, no " - Preview", cut to 16 and marked with an ellipsis.
    const shown = `${truncateGraphemes(stem, 16)}\u2026`;
    expect(shown).toBe('an-extremely-lon\u2026');
    expect(within(flyout).getByTestId(`menu-item-Last Preview Panel (${shown})`)).toBeInTheDocument();
  });

  it('a name within 16 characters shows whole, without the " - Preview" suffix (FR-080)', async () => {
    recordLastActivePreview('t1', 'pv');
    const { user, tree } = await mount({ layout: layoutWithVisiblePreview('pv', `${ROOT_FOLDER}/other.md`) });
    const flyout = await openInFlyout(user, tree, 'README.md');
    expect(within(flyout).getByTestId('menu-item-Last Preview Panel (other)')).toBeInTheDocument();
  });

  it('a renamed preview panel is named by its own title', async () => {
    recordLastActivePreview('t1', 'pv');
    const base = layoutWithVisiblePreview('pv', `${ROOT_FOLDER}/other.md`);
    const tab = base.tabs[0]!;
    const layout: WorkspaceLayout = {
      ...base,
      tabs: [{ ...tab, root: { ...(tab.root as Panel), title: 'Design notes', titleIsCustom: true } }],
    };
    const { user, tree } = await mount({ layout });
    const flyout = await openInFlyout(user, tree, 'README.md');
    expect(within(flyout).getByTestId('menu-item-Last Preview Panel (Design notes)')).toBeInTheDocument();
  });

  it('sends the explicit target override — never the setting — for each row', async () => {
    recordLastActivePreview('t1', 'pv');
    const { user, tree } = await mount({ layout: layoutWithVisiblePreview('pv', `${ROOT_FOLDER}/other.md`) });
    const flyout = await openInFlyout(user, tree, 'README.md');

    await user.click(within(flyout).getByTestId('menu-item-Last Preview Panel (other)'));
    expect(opened.at(-1)).toEqual({
      absPath: `${ROOT_FOLDER}/README.md`,
      projectId: PROJECT_ID,
      target: { mode: 'lastActive' },
      flash: true, // 047 FR-083
    });

    const flyout2 = await openInFlyout(user, tree, 'README.md');
    await user.click(within(flyout2).getByTestId('menu-item-New Preview Panel'));
    expect(opened.at(-1)).toEqual({
      absPath: `${ROOT_FOLDER}/README.md`,
      projectId: PROJECT_ID,
      target: { mode: 'new' },
      flash: true,
    });
  });
});
