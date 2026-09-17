/**
 * 044 T159 — SC-003: a new preview type is one provider, not a feature (FR-001, FR-003, FR-051, FR-061,
 * FR-062, FR-066, FR-067, FR-070, FR-071, FR-073; contracts/preview-provider-seam.md §6).
 *
 * ══ WHAT IS BEING PROVED ══
 *
 * Two providers the app has never heard of — `testText` (`.prvtxt`, one own toggle) and `testBinary`
 * (`.prvbin`, a source MIME allowlist) — are registered HERE ONLY (`tests/fixtures/preview/
 * test-providers.ts`), handed to the window through `PreviewProviderRegistryContext` and the settings
 * tab's metadata context, and every FR-070 surface is then driven through its REAL component or builder:
 *
 * | #   | Surface                                   | Claim                                                              |
 * |-----|-------------------------------------------|--------------------------------------------------------------------|
 * | S1  | Files & Folders Open In (`FileTree`)      | Preview for `.prvtxt` and `.prvbin`, none for `.txt`               |
 * | S2  | Editor status strip                       | the button for `.prvtxt`; none for `.prvbin` (no editor surface)  |
 * | —   | Default open action (`EditorOpenListener`)| binary: Preview while enabled, Editor while disabled (FR-051)      |
 * | S3  | Preview header menu (`PanelPlaceholder`)  | the binary menu is the text menu without Open in Editor           |
 * | S4  | Preferences → Editor → Previews           | text: enabled, default open action, own toggle; binary: enabled   |
 * | S5  | Settings completeness                     | defaults and descriptors declare the same leaves                   |
 * | S6  | Layout restore (`WorkspaceProvider`)      | kept while enabled, dropped while disabled                          |
 * | S6a | The disabled state                        | Open In, the button, and the own settings are DISABLED, not hidden |
 * | S7  | The preview panel body                    | a binary body gets `resource` content and is never parented        |
 *
 * Nothing in `src` names either provider, so a surface that passes here does so by reading the
 * registry — which is FR-070 observed rather than asserted. `preview-surfaces-name-no-provider.test.ts`
 * is the structural half.
 *
 * ══ THE SETTINGS DOCUMENT ══
 *
 * Settings reach every surface as a `config.get` payload, written by `testPreviewSettings()` as the
 * test registry's generated defaults — see that function for why the document has to name them.
 *
 * ══ ANTI-VACUITY ══
 *
 * Every absence is paired with a presence on the same rendered surface: the Open In flyout's Terminal
 * row, the strip's word-wrap toggle, the header menu's Refresh row, and the text provider's own button,
 * row or status bar in the control case. The restore test keeps an enabled preview beside the one it
 * expects dropped.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_KIND,
  collectPanels,
  createDefaultLayout,
  editorAutoTitle,
  leavesOfDeclared,
  previewSettingsDefaults,
  previewSettingsDescriptors,
  type LayoutNode,
  type Panel,
  type PreviewAttachRequest,
  type PreviewUpdate,
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
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsMetadataContext, SettingsTab } from '../../src/renderer/preferences/settings-tab.js';
import { FileTree } from '../../src/renderer/explorer/file-tree.js';
import { StatusStrip } from '../../src/renderer/editor/status-strip.js';
import { EditorOpenListener } from '../../src/renderer/editor/editor-open.js';
import { removeEditorState, setEditorState } from '../../src/renderer/editor/editor-state.js';
import { PanelPlaceholder } from '../../src/renderer/workspace/panel-placeholder.js';
import { PreviewProviderRegistryContext } from '../../src/renderer/preview/provider-registry-context.js';
import { registerPreviewOpener, type PreviewOpenIntent } from '../../src/renderer/preview/open-preview.js';
import { __resetPreviewOpenStore } from '../../src/renderer/preview/preview-open-store.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import type { FileTreeEntry } from '../../src/renderer/global.js';
import {
  TEST_BINARY,
  TEST_PREVIEW_PROVIDERS,
  TEST_PREVIEW_REGISTRY,
  TEST_TEXT,
  testPreviewSettings,
} from '../fixtures/preview/test-providers.js';

const PROJECT = 'proj-seam';
const ROOT = 'D:/proj';
const TEXT_FILE = `${ROOT}/a.prvtxt`;
const BINARY_FILE = `${ROOT}/a.prvbin`;

const TEXT_OFF = testPreviewSettings({ testText: { enabled: false } });
const BINARY_OFF = testPreviewSettings({ testBinary: { enabled: false } });

/** The test registry and views, around `child` — the one injection every surface below reads. */
const withTestProviders = (child: ReactNode): ReactElement =>
  createElement(PreviewProviderRegistryContext.Provider, { value: TEST_PREVIEW_PROVIDERS }, child);

function WhenSettingsAreLive({ children }: { children: ReactNode }): ReactElement | null {
  return useConfigLoaded() ? createElement('div', null, children) : null;
}

/** The workspace store a test mounted, as its last render saw it. */
type Ws = ReturnType<typeof useWorkspace>;

function servicesOver(bridge: ThrongBridge): Services {
  return {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  } as Services;
}

function daemonOver(layout: WorkspaceLayout, saves: WorkspaceLayout[] = []): ThrongBridge {
  return {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save':
          saves.push((params as { layout: WorkspaceLayout }).layout);
          return Promise.resolve({ ok: true } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [{ id: PROJECT, name: 'Proj', rootFolder: ROOT, createdAt: '', lastOpenedAt: '' }] } as T);
        case 'document.pruneMissing':
          return Promise.resolve({ pruned: 0 } as T);
        case 'fileopUndo.get':
          return Promise.resolve({ stackJson: null } as T);
        default:
          return Promise.resolve({} as T);
      }
    },
  };
}

let opened: PreviewOpenIntent[];

beforeEach(() => {
  opened = [];
  localStorage.clear();
  __resetPreviewStore();
  __resetPreviewOpenStore();
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

/* ══ S1, S6a — Files & Folders Open In → Preview ═════════════════════════════════════════════════ */

describe('S1 / S6a — Files & Folders offers Open In → Preview for both test providers (FR-003, FR-062, FR-070)', () => {
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

  const entry = (name: string): FileTreeEntry => ({ name, kind: 'file', isSymlink: false, hasChildren: false });

  async function mountTree(settings: Record<string, unknown>) {
    const user = userEvent.setup();
    const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
    const services = servicesOver(daemonOver(layout));
    let configLoaded = false;
    Reflect.set(window, 'throng', {
      files: {
        setRoot: vi.fn(),
        list: vi.fn(() => Promise.resolve({ entries: [entry('a.prvtxt'), entry('a.prvbin'), entry('a.txt')] })),
        onChange: vi.fn(() => () => {}),
        onWatchFailed: vi.fn(() => () => {}),
      },
      editor: { isOpen: () => Promise.resolve(false) },
      preview: { isOpen: vi.fn(() => Promise.resolve(false)) },
      config: {
        get: () => {
          configLoaded = true;
          return Promise.resolve({ settings });
        },
        onChange: () => () => {},
      },
    });
    render(
      withTestProviders(
        createElement(
          ConfigProvider,
          null,
          createElement(
            ServicesProvider,
            { services },
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
                    createElement(FileTree, { rootFolder: ROOT, projectId: PROJECT, hiddenPaths: [], onHide: vi.fn() }),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    const tree = await screen.findByRole('tree');
    await waitFor(() => expect(configLoaded).toBe(true));
    await act(() => Promise.resolve());
    return { user, tree };
  }

  async function openInFlyout(user: ReturnType<typeof userEvent.setup>, tree: HTMLElement, name: string): Promise<HTMLElement> {
    await user.pointer({ keys: '[MouseRight]', target: await within(tree).findByText(name) });
    await user.click(await screen.findByTestId('menu-item-Open In'));
    const flyout = await screen.findByTestId('submenu-Open In');
    expect(within(flyout).getByTestId('menu-item-Terminal')).toBeInTheDocument();
    return flyout;
  }

  const disabled = (row: HTMLElement): string | null => row.getAttribute('aria-disabled');

  it('offers an enabled Preview for the text provider’s file', async () => {
    const { user, tree } = await mountTree(testPreviewSettings());
    const flyout = await openInFlyout(user, tree, 'a.prvtxt');
    expect(disabled(within(flyout).getByTestId('menu-item-Preview'))).toBe('false');
  });

  it('offers an enabled Preview for the binary provider’s file, and choosing it runs preview.open (FR-073 permits the explorer)', async () => {
    const { user, tree } = await mountTree(testPreviewSettings());
    const flyout = await openInFlyout(user, tree, 'a.prvbin');
    const row = within(flyout).getByTestId('menu-item-Preview');
    expect(disabled(row)).toBe('false');
    await user.click(row);
    expect(opened).toEqual([{ absPath: BINARY_FILE, projectId: PROJECT }]);
  });

  it('offers no Preview for a file neither provider claims', async () => {
    const { user, tree } = await mountTree(testPreviewSettings());
    const flyout = await openInFlyout(user, tree, 'a.txt');
    expect(within(flyout).getByTestId('menu-item-New Editor')).toBeInTheDocument();
    expect(within(flyout).queryByTestId('menu-item-Preview')).toBeNull();
  });

  it('S6a — draws Preview DISABLED for the text provider’s file while testText is off, and opens nothing', async () => {
    const { user, tree } = await mountTree(TEXT_OFF);
    const flyout = await openInFlyout(user, tree, 'a.prvtxt');
    const row = within(flyout).getByTestId('menu-item-Preview');
    expect(disabled(row)).toBe('true');
    await user.click(row);
    expect(opened).toEqual([]);
  });

  it('S6a — draws Preview DISABLED for the binary provider’s file while testBinary is off', async () => {
    const { user, tree } = await mountTree(BINARY_OFF);
    const flyout = await openInFlyout(user, tree, 'a.prvbin');
    expect(disabled(within(flyout).getByTestId('menu-item-Preview'))).toBe('true');
  });
});

/* ══ S2, S6a — the editor status strip ═══════════════════════════════════════════════════════════ */

describe('S2 / S6a — the editor status strip’s preview button (FR-001, FR-062, FR-073)', () => {
  const PANEL = 'p-ed';
  const button = (): HTMLElement | null => screen.queryByTestId(`editor-preview-${PANEL}`);

  async function strip(filePath: string, settings: Record<string, unknown>): Promise<void> {
    setEditorState(PANEL, { filePath, ownerProjectId: PROJECT });
    let loaded = false;
    Reflect.set(window, 'throng', {
      config: {
        get: () => {
          loaded = true;
          return Promise.resolve({ settings });
        },
        onChange: () => () => {},
      },
      preview: { destroyed: vi.fn() },
    });
    render(
      withTestProviders(
        createElement(
          ConfigProvider,
          null,
          createElement(StatusStrip, { panelId: PANEL, projectId: PROJECT, relPath: null, projectRoot: ROOT }),
        ),
      ),
    );
    await waitFor(() => expect(loaded).toBe(true));
    await act(() => Promise.resolve());
  }

  afterEach(() => removeEditorState(PANEL));

  it('shows Open Preview for the text provider’s file, and it runs preview.open for this editor', async () => {
    await strip(TEXT_FILE, testPreviewSettings());
    const b = button() as HTMLElement;
    expect(b).toBeEnabled();
    expect(b).toHaveAttribute('title', 'Open Preview');
    await userEvent.click(b);
    expect(opened).toEqual([{ absPath: TEXT_FILE, projectId: PROJECT, requesterPanelId: PANEL }]);
  });

  it('shows no button for the binary provider’s file, enabled though it is (FR-073)', async () => {
    await strip(BINARY_FILE, testPreviewSettings());
    expect(screen.getByTestId(`editor-word-wrap-${PANEL}`)).toBeInTheDocument();
    expect(button()).toBeNull();
  });

  it('S6a — draws the button DISABLED while testText is off, titled from the provider’s display name', async () => {
    await strip(TEXT_FILE, TEXT_OFF);
    await waitFor(() => expect(button()).toBeDisabled());
    expect(button()).toHaveAttribute('title', `${TEST_TEXT.displayName} previews are turned off — Preferences → Editor → Previews`);
  });
});

/* ══ FR-051 — the default open action of each kind ═══════════════════════════════════════════════ */

describe('the default open action follows the provider’s kind (FR-050, FR-051, FR-062, FR-073)', () => {
  const live: { ws: Ws | null } = { ws: null };
  function Probe(): null {
    live.ws = useWorkspace();
    return null;
  }

  function mountListener(settings: Record<string, unknown>): { openInto: ReturnType<typeof vi.fn> } {
    live.ws = null;
    const openInto = vi.fn(() => Promise.resolve({ action: 'open' }));
    Reflect.set(window, 'throng', {
      editor: { openInto },
      panel: { notifyTyped: () => {} },
      osName: 'windows',
      notices: { log: () => {} },
      config: { get: () => Promise.resolve({ settings }), onChange: () => () => {} },
    });
    const services = servicesOver(daemonOver(createDefaultLayout(PROJECT, { tab: 'tab-1', panel: 'panel-1' })));
    render(
      withTestProviders(
        createElement(
          ServicesProvider,
          { services },
          createElement(
            ConfigProvider,
            null,
            createElement(
              ProjectsProvider,
              { client: services.projects },
              createElement(
                WorkspaceProvider,
                { client: services.workspace, activeProjectId: PROJECT },
                createElement(
                  NotificationProvider,
                  null,
                  createElement(WhenSettingsAreLive, null, createElement(Probe, null), createElement(EditorOpenListener, null)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    return { openInto };
  }

  /** A Files & Folders click, once the settings are live and the workspace has loaded. */
  async function treeOpen(absPath: string): Promise<void> {
    await waitFor(() => expect(live.ws?.layout).toBeTruthy());
    // The Probe renders in the same commit as `EditorOpenListener`, whose `addEventListener` is a passive
    // effect of that commit: flush it before dispatching, or the intent can reach a window with no listener
    // and be dropped (1 in 20 on React 19; `editor-open-router.test.ts`'s `mountChrome` is the same fix).
    await act(async () => {});
    await act(async () => {
      const relPath = absPath.slice(ROOT.length + 1);
      window.dispatchEvent(new CustomEvent('throng:open-file', { detail: { projectId: PROJECT, relPath, absPath } }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('opens the binary provider’s file as a preview while it is enabled — it has no open action to set (FR-051)', async () => {
    const { openInto } = mountListener(testPreviewSettings());
    await treeOpen(BINARY_FILE);
    expect(opened).toEqual([{ absPath: BINARY_FILE, projectId: PROJECT }]);
    expect(openInto).not.toHaveBeenCalled();
  });

  it('opens it in an editor while testBinary is off (FR-062)', async () => {
    const { openInto } = mountListener(BINARY_OFF);
    await treeOpen(BINARY_FILE);
    await waitFor(() => expect(openInto).toHaveBeenCalled());
    expect(opened).toEqual([]);
  });

  it('opens the text provider’s file in an editor at its shipped default open action (the control)', async () => {
    const shipped = mountListener(testPreviewSettings());
    await treeOpen(TEXT_FILE);
    await waitFor(() => expect(shipped.openInto).toHaveBeenCalled());
    expect(opened).toEqual([]);
  });

  it('…and as a preview once testText’s default open action is Preview', async () => {
    const { openInto } = mountListener(testPreviewSettings({ testText: { defaultOpenAction: 'preview' } }));
    await treeOpen(TEXT_FILE);
    expect(opened).toEqual([{ absPath: TEXT_FILE, projectId: PROJECT }]);
    expect(openInto).not.toHaveBeenCalled();
  });
});

/* ══ S3, S7 — a preview panel of each kind ═══════════════════════════════════════════════════════ */

describe('S3 / S7 — a preview of each kind mounts in the real panel, with the chrome its kind gets (FR-015e, FR-033, FR-073)', () => {
  const captured: { ws: Ws | null } = { ws: null };

  function Host(): ReactElement | null {
    const ws = useWorkspace();
    captured.ws = ws;
    const tab = ws.layout?.tabs[0];
    if (!tab) return null;
    return createElement(
      'div',
      null,
      ...collectPanels(tab.root).map((p) => createElement(PanelPlaceholder, { key: p.id, panel: p, tabId: tab.id })),
    );
  }

  /** What main's snapshot of a new run carries, by the provider's kind (contracts/preview-provider-seam.md §4). */
  const snapshot = (req: PreviewAttachRequest): PreviewUpdate => {
    const provider = TEST_PREVIEW_REGISTRY.forPath(req.filePath)!;
    return {
      panelId: req.panelId,
      filePath: req.filePath,
      providerId: provider.id,
      revision: 1,
      content:
        provider.kind === 'binary'
          ? { kind: 'resource', url: `throng-preview://source/${req.panelId}?rev=1` }
          : { kind: 'text', text: 'hello' },
      dirty: false,
      parent: null,
      notice: null,
    };
  };

  async function mountPreview(filePath: string) {
    const user = userEvent.setup();
    captured.ws = null;
    setActivePane('workspace');
    const attach = vi.fn((req: PreviewAttachRequest) => Promise.resolve({ ok: true as const, update: snapshot(req) }));
    Reflect.set(window, 'throng', {
      panel: { notifyDestroyed: vi.fn(), onDestroyed: () => () => {}, notifyTyped: vi.fn() },
      preview: {
        attach,
        detach: vi.fn(),
        destroyed: vi.fn(),
        refresh: vi.fn(() => Promise.resolve({ update: null })),
        openPaths: vi.fn(() => Promise.resolve([])),
        onUpdate: vi.fn(() => () => {}),
        onOpenChanged: vi.fn(() => () => {}),
        onPathChanged: vi.fn(() => () => {}),
        onPlace: vi.fn(() => () => {}),
        onFocus: vi.fn(() => () => {}),
      },
      editor: { openInto: vi.fn(() => Promise.resolve({ action: 'open' })) },
      files: { revealDocument: vi.fn() },
      config: { get: () => Promise.resolve({ settings: testPreviewSettings() }), onChange: () => () => {} },
    });
    const services = servicesOver(daemonOver(createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' })));
    const view = render(
      withTestProviders(
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
                  createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, createElement(Host))),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
    const id = collectPanels(captured.ws!.layout!.tabs[0].root)[0].id;
    act(() => captured.ws!.setPanelType(id, PREVIEW_KIND, { filePath }));
    return { user, id, attach, unmount: view.unmount };
  }

  async function headerMenuLabels(user: ReturnType<typeof userEvent.setup>, id: string): Promise<string[]> {
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`panel-handle-${id}`) });
    const refresh = await screen.findByTestId('menu-item-Refresh');
    const menu = refresh.closest('[role="menu"]') as HTMLElement;
    return [...menu.querySelectorAll('[role="menuitem"]')]
      .filter((el) => el.closest('[role="menu"]') === menu)
      .map((el) => (el.getAttribute('data-testid') ?? '').replace(/^menu-item-/, ''));
  }

  afterEach(() => removeEditorState('ed-bin'));

  it('S3 — the binary preview’s header menu is the text preview’s, less Open in Editor and Synchronise Scrolling', async () => {
    const text = await mountPreview(TEXT_FILE);
    await screen.findByTestId(`test-body-testText-${text.id}`);
    const textLabels = await headerMenuLabels(text.user, text.id);
    expect(textLabels).toContain('Open in Editor');
    // 044 FR-122a — scroll sync pairs a preview with an editor, so it is offered on a text provider only.
    expect(textLabels).toContain('Synchronise Scrolling');
    await text.user.keyboard('{Escape}');
    text.unmount();
    // Both mounts type panel `p1`; the first run's revision would make the second's attach look stale.
    __resetPreviewStore();

    const binary = await mountPreview(BINARY_FILE);
    await screen.findByTestId(`test-body-testBinary-${binary.id}`);
    const binaryLabels = await headerMenuLabels(binary.user, binary.id);

    expect(binaryLabels).not.toContain('Open in Editor');
    expect(binaryLabels).not.toContain('Go to Editor');
    expect(binaryLabels).not.toContain('Synchronise Scrolling');
    expect(binaryLabels).toEqual(
      textLabels.filter((label) => label !== 'Open in Editor' && label !== 'Synchronise Scrolling'),
    );
  });

  it('S7 — the text body is handed text, and the text preview carries the status bar (the control)', async () => {
    const { id } = await mountPreview(TEXT_FILE);
    const body = await screen.findByTestId(`test-body-testText-${id}`);
    expect(body).toHaveAttribute('data-content-kind', 'text');
    expect(screen.getByTestId(`preview-status-bar-${id}`)).toBeInTheDocument();
  });

  it('S7 — the binary body is handed a resource, with no status bar and no route to an editor, even with an editor open on the file', async () => {
    // An editor document for the very file, as main would see one registered (FR-073: still standalone).
    setEditorState('ed-bin', { filePath: BINARY_FILE, ownerProjectId: PROJECT });
    const { user, id, attach } = await mountPreview(BINARY_FILE);

    const body = await screen.findByTestId(`test-body-testBinary-${id}`);
    expect(body).toHaveAttribute('data-content-kind', 'resource');
    expect(body).toHaveTextContent(`throng-preview://source/${id}?rev=1`);
    expect(attach).toHaveBeenCalledWith({ panelId: id, projectId: PROJECT, filePath: BINARY_FILE });

    expect(screen.queryByTestId(`preview-status-bar-${id}`)).toBeNull();
    await waitFor(() => expect(screen.getByTestId(`panel-title-${id}`).textContent).toBe(`${editorAutoTitle(BINARY_FILE)} - Preview`));
    const labels = await headerMenuLabels(user, id);
    expect(labels).not.toContain('Go to Editor');
    expect(labels).not.toContain('Open in Editor');
  });
});

/* ══ S4, S6a — Preferences → Editor → Previews ═══════════════════════════════════════════════════ */

describe('S4 / S6a — the settings tab draws each provider’s generated settings (FR-051, FR-061, FR-071)', () => {
  const SUBSECTION = 'settings-subgroup-Editor-Previews';
  const TEXT_KEY = 'editor.previews.providers.testText';
  const BINARY_KEY = 'editor.previews.providers.testBinary';
  const control = (key: string): HTMLInputElement | HTMLSelectElement =>
    screen.getByTestId(`control-${key}`) as HTMLInputElement | HTMLSelectElement;

  async function mountTab(settings: Record<string, unknown>): Promise<void> {
    Reflect.set(window, 'throng', {
      config: { get: () => Promise.resolve({ settings }), onChange: () => () => {} },
    });
    render(
      createElement(
        ConfigProvider,
        null,
        createElement(
          NotificationProvider,
          null,
          createElement(
            ResetNoticeProvider,
            null,
            createElement(
              ConfirmProvider,
              null,
              createElement(
                SettingsMetadataContext.Provider,
                { value: previewSettingsDescriptors(TEST_PREVIEW_REGISTRY) },
                createElement(SettingsTab, null),
              ),
            ),
          ),
        ),
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('renders testText’s enabled, default open action and own toggle, and testBinary’s enabled only', async () => {
    await mountTab(testPreviewSettings());
    const rows = [...screen.getByTestId(SUBSECTION).querySelectorAll('.settings-row')].map((el) => el.getAttribute('data-testid'));
    expect(rows).toEqual([
      'setting-editor.previews.updateDelayMs',
      'setting-editor.previews.maxWaitMs',
      'setting-editor.previews.copyFormat',
      // 044 FR-114 (iteration 2026-09-15) — static, so a test registry draws it too.
      'setting-editor.previews.syncScroll',
      `setting-${TEXT_KEY}.enabled`,
      `setting-${TEXT_KEY}.defaultOpenAction`,
      `setting-${TEXT_KEY}.shout`,
      `setting-${BINARY_KEY}.enabled`,
    ]);
    const section = screen.getByTestId(SUBSECTION);
    expect(within(section).getByText(`${TEST_TEXT.displayName}: Shout`)).toBeInTheDocument();
    expect(within(section).getByText(`${TEST_BINARY.displayName}: Enabled`)).toBeInTheDocument();
    expect(within(section).queryByText(`${TEST_BINARY.displayName}: Default open action`)).toBeNull();
  });

  it('S6a — draws testText’s default open action and own toggle DISABLED while it is off, and leaves its toggle live', async () => {
    await mountTab(TEXT_OFF);
    await waitFor(() => expect((control(`${TEXT_KEY}.enabled`) as HTMLInputElement).checked).toBe(false));
    expect(control(`${TEXT_KEY}.defaultOpenAction`).disabled).toBe(true);
    expect(control(`${TEXT_KEY}.shout`).disabled).toBe(true);
    expect(control(`${TEXT_KEY}.enabled`).disabled).toBe(false);
    // One provider's switch suspends only its own options: testBinary's toggle stays live.
    expect(control(`${BINARY_KEY}.enabled`).disabled).toBe(false);
  });

  it('S6a control — the same two are live while testText is on', async () => {
    await mountTab(testPreviewSettings());
    await waitFor(() => expect((control(`${TEXT_KEY}.enabled`) as HTMLInputElement).checked).toBe(true));
    expect(control(`${TEXT_KEY}.defaultOpenAction`).disabled).toBe(false);
    expect(control(`${TEXT_KEY}.shout`).disabled).toBe(false);
  });
});

/* ══ S5 — configuration-editor completeness ══════════════════════════════════════════════════════ */

describe('S5 — every generated default has a descriptor, and every descriptor a default', () => {
  it('declares the same leaves both ways for the test registry', () => {
    const descriptors = previewSettingsDescriptors(TEST_PREVIEW_REGISTRY);
    const leaves = leavesOfDeclared(previewSettingsDefaults(TEST_PREVIEW_REGISTRY), descriptors, 'editor.previews');
    const keys = descriptors.map((d) => d.key);
    expect(leaves.filter((leaf) => !keys.includes(leaf)), 'defaults with no descriptor').toEqual([]);
    expect(keys.filter((key) => !leaves.includes(key)), 'descriptors with no default').toEqual([]);
    // Anti-vacuity: both providers contributed.
    expect(leaves).toEqual(
      expect.arrayContaining([
        'editor.previews.providers.testText.shout',
        'editor.previews.providers.testText.defaultOpenAction',
        'editor.previews.providers.testBinary.enabled',
      ]),
    );
    expect(leaves).not.toContain('editor.previews.providers.testBinary.defaultOpenAction');
  });
});

/* ══ S6 — layout restore ═════════════════════════════════════════════════════════════════════════ */

describe('S6 — a restored layout keeps a test provider’s preview while it is enabled, and drops it while disabled (FR-066, FR-067)', () => {
  const captured: { ws: Ws | null; seen: Set<string> } = { ws: null, seen: new Set() };
  function Probe(): null {
    captured.ws = useWorkspace();
    for (const tab of captured.ws.layout?.tabs ?? []) for (const p of collectPanels(tab.root)) captured.seen.add(p.id);
    return null;
  }

  const preview = (id: string, filePath: string): Panel => ({
    type: 'panel',
    id,
    originProjectId: PROJECT,
    title: `Panel ${id}`,
    kind: PREVIEW_KIND,
    config: { filePath },
  });
  const plain = (id: string): Panel => ({ type: 'panel', id, originProjectId: PROJECT, title: `Panel ${id}` });

  function restore(settings: Record<string, unknown>): WorkspaceLayout[] {
    captured.ws = null;
    captured.seen = new Set();
    const root: LayoutNode = {
      type: 'split',
      orientation: 'row',
      children: [preview('text', TEXT_FILE), preview('binary', BINARY_FILE), plain('b')],
      sizes: [1 / 3, 1 / 3, 1 / 3],
    };
    const layout: WorkspaceLayout = {
      ...createDefaultLayout(PROJECT, { tab: 't1', panel: 'unused' }),
      tabs: [{ id: 't1', title: 'Tab 1', root }],
      activeTabId: 't1',
    };
    const saves: WorkspaceLayout[] = [];
    Reflect.set(window, 'throng', {
      config: { get: () => Promise.resolve({ settings }), onChange: () => () => {} },
      subWorkspace: { notifyChanged: vi.fn(), close: vi.fn() },
    });
    const services = servicesOver(daemonOver(layout, saves));
    render(
      withTestProviders(
        createElement(
          ServicesProvider,
          { services },
          createElement(
            ConfigProvider,
            null,
            createElement(
              WhenSettingsAreLive,
              null,
              createElement(WorkspaceProvider, { client: services.workspace, activeProjectId: PROJECT }, createElement(Probe, null)),
            ),
          ),
        ),
      ),
    );
    return saves;
  }

  const ids = (): string[] => (captured.ws?.layout?.tabs ?? []).flatMap((t) => collectPanels(t.root).map((p) => p.id));

  it('keeps both test providers’ previews while both are enabled', async () => {
    restore(testPreviewSettings());
    await waitFor(() => expect(ids()).toEqual(['text', 'binary', 'b']));
  });

  it('drops the text provider’s preview while testText is off, never mounting it, and keeps the binary one', async () => {
    const saves = restore(TEXT_OFF);
    await waitFor(() => expect(ids()).toEqual(['binary', 'b']));
    expect(captured.seen.has('text'), 'a disabled provider’s preview was mounted').toBe(false);
    await waitFor(() => expect(saves.length).toBeGreaterThan(0));
    expect(saves.at(-1)!.tabs.flatMap((t) => collectPanels(t.root).map((p) => p.id))).toEqual(['binary', 'b']);
  });

  it('drops the binary provider’s preview while testBinary is off, and keeps the text one', async () => {
    restore(BINARY_OFF);
    await waitFor(() => expect(ids()).toEqual(['text', 'b']));
    expect(captured.seen.has('binary')).toBe(false);
  });
});
