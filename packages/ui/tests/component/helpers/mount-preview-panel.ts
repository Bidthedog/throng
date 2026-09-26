/**
 * A preview panel mounted the way a window mounts one, with the SHIPPED Markdown view (044 US6).
 *
 * `preview-panel-mount.test.ts` proves the chrome names no provider by mounting a test provider. The
 * link, notice and menu tests need the opposite: the real Markdown body — its pipeline, its sanitiser
 * hooks, its gestures — inside the real `PanelPlaceholder`, under the same providers, with main's
 * preview bridge replaced by a recording fake. `PreviewCommands` is mounted beside it, because
 * `preview.followLink` is dispatched there (FR-096c).
 */
import { act, render, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { expect, vi } from 'vitest';
import {
  PREVIEW_KIND,
  SHIPPED_PREVIEW_PROVIDERS,
  collectPanels,
  createDefaultLayout,
  type Panel,
  type PreviewAttachRequest,
  type PreviewNavigateRequest,
  type PreviewNavigateResponse,
  type PreviewOpenChanged,
  type PreviewProviderRegistry,
  type PreviewUpdate,
  type WorkspaceLayout,
} from '@throng/core';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { __resetPreviewOpenStore } from '../../../src/renderer/preview/preview-open-store.js';
import type { PreviewProviderView } from '../../../src/renderer/preview/provider-view.js';
import type { ThrongBridge } from '../../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../../src/renderer/composition-root.js';
import { WorkspaceProvider, useWorkspace } from '../../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { PanelPlaceholder } from '../../../src/renderer/workspace/panel-placeholder.js';
import { PreviewProviderRegistryContext } from '../../../src/renderer/preview/provider-registry-context.js';
import { PREVIEW_PROVIDER_VIEWS } from '../../../src/renderer/preview/providers/index.js';
import { PreviewCommands } from '../../../src/renderer/preview/preview-commands.js';
import { setActivePane } from '../../../src/renderer/workspace/active-pane.js';
import { __resetPreviewStore } from '../../../src/renderer/preview/preview-store.js';

export const PROJECT = 'proj-1';
export const ROOT = 'D:/proj';
export const README = `${ROOT}/README.md`;

/** The first import of markdown-it, DOMPurify and yaml through vite's transform is slow (see markdown-body.test.ts). */
export const COLD = { timeout: 10_000 };

/**
 * An update as main builds one. `navigationSeq` is on every real update (044 T177), and a test that
 * simulates a NAVIGATION — a link followed, a history step onto another file — raises it, exactly as main
 * does: a file that changes while it stands still is a re-point, and the body keeps the reader's place.
 */
export const previewUpdate = (over: Partial<PreviewUpdate> & { revision: number }): PreviewUpdate => ({
  panelId: 'p1',
  filePath: README,
  providerId: 'markdown',
  content: { kind: 'text', text: '# Readme\n' },
  dirty: false,
  parent: null,
  notice: null,
  navigationSeq: 0,
  ...over,
});

function fakeDaemon(): ThrongBridge {
  const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  return {
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
          return Promise.resolve({
            projects: [{ id: PROJECT, name: 'proj', rootFolder: ROOT, createdAt: '', lastOpenedAt: '' }],
          } as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as T);
        default:
          return Promise.resolve({} as T);
      }
    },
  };
}

function servicesOver(bridge: ThrongBridge): Services {
  return {
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}

type Ws = ReturnType<typeof useWorkspace>;
const captured: { ws: Ws | null } = { ws: null };

/** Window-level components a test mounts beside the panel (a key dispatcher, say). */
let hostExtras: ReactElement[] = [];

function Host(): ReactElement | null {
  const ws = useWorkspace();
  captured.ws = ws;
  const tab = ws.layout?.tabs[0];
  if (!tab) return null;
  return createElement(
    'div',
    null,
    createElement(PreviewCommands),
    ...hostExtras,
    ...collectPanels(tab.root).map((p) => createElement(PanelPlaceholder, { key: p.id, panel: p, tabId: tab.id })),
  );
}

export interface MountedPreview {
  id: string;
  preview: {
    attach: ReturnType<typeof vi.fn>;
    navigate: ReturnType<typeof vi.fn<(req: PreviewNavigateRequest) => Promise<PreviewNavigateResponse>>>;
  } & Record<string, ReturnType<typeof vi.fn>>;
  /** `window.throng.preview.openExternal` — the preview's own channel, whose policy allows `mailto:` (044 FR-091). */
  openExternal: ReturnType<typeof vi.fn>;
  /** `window.throng.openExternal` — the GENERAL channel (terminal, About); a preview must never use it. */
  generalOpenExternal: ReturnType<typeof vi.fn>;
  clipboardWrite: ReturnType<typeof vi.fn>;
  /**
   * 045 FR-169 – FR-171 — `window.throng.links`, the Link menu's menu-open resolution and its two OS
   * routes. Every method answers a safe default (`resolve`: not resolved; `follow`/`reveal`/`open`:
   * refused) unless a test replaces it — the same pattern `preview.navigate` already uses.
   */
  links: {
    resolve: ReturnType<typeof vi.fn>;
    follow: ReturnType<typeof vi.fn>;
    reveal: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
  };
  push(update: PreviewUpdate): void;
  unmount(): void;
}

/**
 * 044 US3 — what a mount can vary beyond the document: the providers (a test provider, a binary one), the
 * settings `config.get` delivers, and which paths main reports open.
 */
export interface MountPreviewOptions {
  /** The registry and views the window holds. Default: the shipped ones (the Markdown provider). */
  providers?: { registry: PreviewProviderRegistry; views: Readonly<Record<string, PreviewProviderView>> };
  /** The provider id main's updates name. Default `markdown`. */
  providerId?: string;
  /** Settings delivered through `config.get`, parsed as a `settings.json` would be. */
  settings?: Record<string, unknown>;
  /** What main answers `openPaths` with. Default: nothing open. */
  openPaths?: string[];
  /** Window-level components mounted beside the panel, inside every provider — each with its own key. */
  extras?: ReactElement[];
  /** 044 US7 — an ancestor around the panels (a real `DndContext`, say), inside every provider. */
  wrap?: (children: ReactElement) => ReactElement;
  /** 044 T232 — fields main's attach answer carries beyond the text (a parent, a saved place). */
  attach?: Partial<PreviewUpdate>;
}

export interface MountedPreviewWindow extends MountedPreview {
  /** `window.throng.editor.openInto`, answering `open` unless a test says otherwise. */
  openInto: ReturnType<typeof vi.fn>;
  /** `window.throng.files.revealDocument`. */
  revealDocument: ReturnType<typeof vi.fn>;
  /** `window.throng.clipboard.writeRich`. */
  writeRich: ReturnType<typeof vi.fn>;
  /** The live workspace store. */
  ws(): Ws;
  /** Deliver a new settings document, as main's config watcher broadcasts one. */
  setSettings(settings: Record<string, unknown>): void;
}

/** Mount a window holding one preview of `filePath` whose attach answers `text`. */
export async function mountMarkdownPreview(
  text: string,
  filePath = README,
  opts: MountPreviewOptions = {},
): Promise<MountedPreviewWindow> {
  captured.ws = null;
  hostExtras = opts.extras ?? [];
  setActivePane('workspace');
  // The store is per window and module-level: every mount here reuses panel id `p1`, and a previous
  // test's revision would make this mount's attach look stale.
  __resetPreviewStore();
  __resetPreviewOpenStore();
  const providerId = opts.providerId ?? 'markdown';
  const updateListeners = new Set<(u: PreviewUpdate) => void>();
  const openChangedListeners = new Set<(evt: PreviewOpenChanged) => void>();
  const configListeners = new Set<(payload: { settings: unknown }) => void>();
  const openExternal = vi.fn();
  const generalOpenExternal = vi.fn();
  const preview = {
    openExternal,
    attach: vi.fn((req: PreviewAttachRequest) =>
      Promise.resolve({
        ok: true as const,
        update: previewUpdate({
          panelId: req.panelId,
          filePath: req.filePath,
          providerId,
          content: { kind: 'text', text },
          revision: 1,
          ...opts.attach,
        }),
      }),
    ),
    navigate: vi.fn(
      (_req: PreviewNavigateRequest): Promise<PreviewNavigateResponse> =>
        Promise.resolve({ kind: 'refused', notice: { kind: 'link-missing-file', target: 'unset' } }),
    ),
    detach: vi.fn(),
    // Main's answer to `destroyed`: the run is gone, so every window hears the path is no longer open.
    destroyed: vi.fn((panelId: string) => {
      const path = captured.ws?.layout?.tabs
        .flatMap((t) => collectPanels(t.root) as Panel[])
        .find((p) => p.id === panelId)?.config?.filePath;
      if (typeof path !== 'string') return;
      for (const l of [...openChangedListeners]) l({ path, open: false });
    }),
    refresh: vi.fn(() => Promise.resolve({ update: null })),
    open: vi.fn(() => Promise.resolve({ kind: 'refused', reason: 'no-file' })),
    placeDeclined: vi.fn(),
    openPaths: vi.fn(() => Promise.resolve(opts.openPaths ?? ([] as string[]))),
    onUpdate: vi.fn((cb: (u: PreviewUpdate) => void) => {
      updateListeners.add(cb);
      return () => updateListeners.delete(cb);
    }),
    onOpenChanged: vi.fn((cb: (evt: PreviewOpenChanged) => void) => {
      openChangedListeners.add(cb);
      return () => openChangedListeners.delete(cb);
    }),
    onPathChanged: vi.fn(() => () => {}),
    onPlace: vi.fn(() => () => {}),
    onFocus: vi.fn(() => () => {}),
  };
  const clipboardWrite = vi.fn(() => Promise.resolve());
  const writeRich = vi.fn(() => Promise.resolve());
  const openInto = vi.fn(() => Promise.resolve({ action: 'open' }));
  const revealDocument = vi.fn(() => Promise.resolve());
  // 045 FR-169 – FR-171 — the Link menu's menu-open resolution and its two OS routes. Safe defaults
  // (not resolved; refused) so a test that does not care about the Link menu is unaffected; a test
  // that does replaces the relevant method on `window.throng.links` before it opens the menu.
  const links = {
    resolve: vi.fn(() => Promise.resolve({ ok: false as const })),
    follow: vi.fn(() => Promise.resolve({ kind: 'refused' as const, path: '' })),
    reveal: vi.fn(() => Promise.resolve({ ok: false as const, reason: 'refused' as const, path: '' })),
    open: vi.fn(() => Promise.resolve({ ok: false as const, reason: 'refused' as const, path: '' })),
  };
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), onDestroyed: () => () => {}, notifyTyped: vi.fn() },
    preview,
    links,
    openExternal: generalOpenExternal,
    clipboard: { write: clipboardWrite, writeRich, paste: vi.fn() },
    editor: { openInto },
    files: { revealDocument },
    config: {
      get: () => Promise.resolve({ settings: opts.settings }),
      onChange: (cb: (payload: { settings: unknown }) => void) => {
        configListeners.add(cb);
        return () => configListeners.delete(cb);
      },
    },
  });
  const services = servicesOver(fakeDaemon());
  const providers = opts.providers ?? { registry: SHIPPED_PREVIEW_PROVIDERS, views: PREVIEW_PROVIDER_VIEWS };
  const view = render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        PreviewProviderRegistryContext.Provider,
        { value: providers },
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
                  createElement(ContextMenuProvider, null, opts.wrap ? opts.wrap(createElement(Host)) : createElement(Host)),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
  const layout = captured.ws!.layout as WorkspaceLayout;
  const id = (collectPanels(layout.tabs[0].root) as Panel[])[0].id;
  act(() => captured.ws!.setPanelType(id, PREVIEW_KIND, { filePath }));
  const push = (u: PreviewUpdate): void => {
    act(() => {
      for (const l of [...updateListeners]) l(u);
    });
  };
  return {
    id,
    preview: preview as unknown as MountedPreview['preview'],
    openExternal,
    generalOpenExternal,
    clipboardWrite,
    links,
    writeRich,
    openInto,
    revealDocument,
    push,
    ws: () => captured.ws as Ws,
    setSettings: (settings) => {
      act(() => {
        for (const l of [...configListeners]) l({ settings });
      });
    },
    unmount: () => {
      view.unmount();
      Reflect.deleteProperty(window, 'throng');
    },
  };
}
