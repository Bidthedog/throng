/**
 * 044 T068 — the preview panel kind MOUNTS: dispatched, attached, fed, zoomed, detached, destroyed.
 *
 * FR-002 is not here; what is here is the checkpoint "a preview panel can be created by code, attached
 * to `PreviewService`, and be destroyed" — asserted through the REAL `PanelPlaceholder` and
 * `PanelBody`, mounted under the same six providers `panel-box.test.ts` established, with main's
 * preview bridge replaced by a recording fake.
 *
 * ══ WHY THE PROVIDER IS A TEST PROVIDER ══
 *
 * The panel must resolve its body through `PreviewProviderRegistryContext` (contracts/
 * preview-provider-seam.md §3) and never name a provider. So this file registers `testText` for
 * `.prvtxt` inside the test, hands it to the context, and asserts ITS body renders. A panel that
 * imported the shipped Markdown view directly would render nothing here — which is the assertion.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_KIND,
  collectPanels,
  createDefaultLayout,
  createPreviewProviderRegistry,
  editorAutoTitle,
  panelZoomLevel,
  zoomFactor,
  type Panel,
  type PersistedHistory,
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
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { PanelPlaceholder } from '../../src/renderer/workspace/panel-placeholder.js';
import { PanelDestroySync } from '../../src/renderer/workspace/panel-destroy-sync.js';
import { requestPanelRename } from '../../src/renderer/workspace/panel-rename.js';
import { allEditorStates } from '../../src/renderer/editor/editor-state.js';
import { PreviewProviderRegistryContext } from '../../src/renderer/preview/provider-registry-context.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import {
  __resetPreviewReservations,
  previewReservationFor,
  setPreviewReservation,
} from '../../src/renderer/preview/preview-reservations.js';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';

const PROJECT = 'proj-1';
const FILE = 'D:/proj/notes.prvtxt';
const HISTORY: PersistedHistory = { v: 1, entries: [{ filePath: FILE }], index: 0 };

/* ── The test provider, registered here and nowhere else ─────────────────────────────────── */

const registry = createPreviewProviderRegistry([
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
]);

function FakeBody({ content, panelId }: PreviewBodyProps): ReactElement {
  return createElement(
    'div',
    { 'data-testid': `fake-body-${panelId}` },
    content.kind === 'text' ? content.text : content.url,
  );
}

const testView: PreviewProviderView = {
  id: 'testText',
  textSelection: true,
  load: () => Promise.resolve(FakeBody),
};

/* ── The fake daemon (as panel-box.test.ts) and the fake preview bridge ─────────────────────── */

function fakeDaemon() {
  const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
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
        default:
          return Promise.reject(new Error(`unexpected RPC from the preview mount: ${method}`));
      }
    },
  };
  return bridge;
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

const update = (over: Partial<PreviewUpdate> & { revision: number }): PreviewUpdate => ({
  panelId: 'p1',
  filePath: FILE,
  providerId: 'testText',
  content: { kind: 'text', text: 'first' },
  dirty: false,
  parent: null,
  notice: null,
  ...over,
});

function fakePreviewBridge() {
  const updateListeners = new Set<(u: PreviewUpdate) => void>();
  const preview = {
    attach: vi.fn((req: PreviewAttachRequest) =>
      // Echoes the file it was asked for, as main's snapshot of a new run does.
      Promise.resolve({
        ok: true as const,
        update: update({ panelId: req.panelId, filePath: req.filePath, revision: 1 }),
      }),
    ),
    detach: vi.fn(),
    destroyed: vi.fn(),
    refresh: vi.fn(() => Promise.resolve({ update: null })),
    onUpdate: vi.fn((cb: (u: PreviewUpdate) => void) => {
      updateListeners.add(cb);
      return () => updateListeners.delete(cb);
    }),
    onOpenChanged: vi.fn(() => () => {}),
    onPathChanged: vi.fn(() => () => {}),
  };
  const push = (u: PreviewUpdate): void => {
    act(() => {
      for (const l of [...updateListeners]) l(u);
    });
  };
  return { preview, push };
}

/* ── The host ──────────────────────────────────────────────────────────────────────────────── */

type Ws = ReturnType<typeof useWorkspace>;
const captured: { ws: Ws | null } = { ws: null };

function Host(): ReactElement | null {
  const ws = useWorkspace();
  captured.ws = ws;
  const tab = ws.layout?.tabs[0];
  if (!tab) return null;
  return createElement(
    'div',
    null,
    createElement(PanelDestroySync),
    ...collectPanels(tab.root).map((p) =>
      createElement(PanelPlaceholder, { key: p.id, panel: p, tabId: tab.id }),
    ),
  );
}

function mount() {
  const user = userEvent.setup();
  const bridge = fakePreviewBridge();
  const destroyedListeners: ((id: string) => void)[] = [];
  Reflect.set(window, 'throng', {
    panel: {
      notifyDestroyed: vi.fn(),
      onDestroyed: (cb: (id: string) => void) => {
        destroyedListeners.push(cb);
        return () => {};
      },
    },
    preview: bridge.preview,
  });
  const services = servicesOver(fakeDaemon());
  const view = render(
    createElement(
      PreviewProviderRegistryContext.Provider,
      { value: { registry, views: { testText: testView } } },
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
  );
  const remoteDestroy = (id: string): void => {
    act(() => {
      for (const l of destroyedListeners) l(id);
    });
  };
  return { user, ...bridge, unmount: view.unmount, remoteDestroy };
}

const live = (): Ws => captured.ws as Ws;
const panelsIn = (): Panel[] => collectPanels((live().layout as WorkspaceLayout).tabs[0].root) as Panel[];

/** Mount, then type the first panel as a preview of FILE — the way `openPreview` will (T080). */
async function mountPreview(filePath = FILE) {
  const m = mount();
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
  const id = panelsIn()[0].id;
  act(() => live().setPanelType(id, PREVIEW_KIND, { filePath, history: HISTORY }));
  return { ...m, id };
}

beforeEach(() => {
  captured.ws = null;
  __resetPreviewStore();
  __resetPreviewReservations();
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

/* ── The tests ─────────────────────────────────────────────────────────────────────────────── */

describe('PanelBody routes kind "preview" to PreviewPanel (T068)', () => {
  it('renders the preview panel, not the neutral placeholder', async () => {
    const { id } = await mountPreview();
    expect(await screen.findByTestId(`preview-${id}`)).toBeInTheDocument();
    expect(screen.queryByText('Empty Panel')).toBeNull();
  });
});

describe('mounting attaches to main, and main’s updates drive the body', () => {
  it('attaches with the persisted filePath and history (FR-066)', async () => {
    const { id, preview } = await mountPreview();
    await waitFor(() => expect(preview.attach).toHaveBeenCalledTimes(1));
    expect(preview.attach).toHaveBeenCalledWith({
      panelId: id,
      projectId: PROJECT,
      filePath: FILE,
      history: HISTORY,
    });
  });

  it('attaches with the reservation its placement was handed, so main consumes it (044 T080, FR-012)', async () => {
    const m = mount();
    await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
    const id = panelsIn()[0].id;
    // What `openPreview` does between main's `placeLocally` and the panel mounting.
    setPreviewReservation(id, 'r-7');
    act(() => live().setPanelType(id, PREVIEW_KIND, { filePath: FILE }));

    await waitFor(() => expect(m.preview.attach).toHaveBeenCalledTimes(1));
    expect(m.preview.attach).toHaveBeenCalledWith({
      panelId: id,
      projectId: PROJECT,
      filePath: FILE,
      reservation: 'r-7',
    });
    // Consumed by an attach that answered: a later mount of the same panel re-attaches without it.
    await waitFor(() => expect(previewReservationFor(id)).toBeUndefined());
  });

  it('resolves the body through PreviewProviderRegistryContext and shows the attached content', async () => {
    const { id } = await mountPreview();
    expect(await screen.findByTestId(`fake-body-${id}`)).toHaveTextContent('first');
  });

  it('drops an update whose revision is not above the last applied (contracts/preview-ipc.md §2)', async () => {
    const { id, push } = await mountPreview();
    const body = await screen.findByTestId(`fake-body-${id}`);

    push(update({ revision: 3, content: { kind: 'text', text: 'third' } }));
    await waitFor(() => expect(body).toHaveTextContent('third'));

    // Late and equal revisions both lose.
    push(update({ revision: 2, content: { kind: 'text', text: 'second — stale' } }));
    push(update({ revision: 3, content: { kind: 'text', text: 'third again — duplicate' } }));
    expect(screen.getByTestId(`fake-body-${id}`)).toHaveTextContent('third');

    // `content: null` is "unchanged", not "empty": a dirty-only update keeps what is shown.
    push(update({ revision: 4, content: null, dirty: true }));
    expect(screen.getByTestId(`fake-body-${id}`)).toHaveTextContent('third');
  });

  it('ignores an update for another panel', async () => {
    const { id, push } = await mountPreview();
    await screen.findByTestId(`fake-body-${id}`);
    push(update({ panelId: 'someone-else', revision: 9, content: { kind: 'text', text: 'not mine' } }));
    expect(screen.getByTestId(`fake-body-${id}`)).toHaveTextContent('first');
  });

  it('detaches when it unmounts', async () => {
    const { id, preview, unmount } = await mountPreview();
    await waitFor(() => expect(preview.attach).toHaveBeenCalled());
    expect(preview.detach).not.toHaveBeenCalled();
    unmount();
    expect(preview.detach).toHaveBeenCalledWith(id);
  });
});

/*
 * contracts/preview-ipc.md §1 `attach`, as amended 2026-09-15: three refusals mean the preview must not
 * exist here (FR-067) and clear the panel; ANY other refusal — `failed`, or a reason added later — keeps
 * the panel and shows the shared failure banner.
 */
describe('an attach refusal clears the panel only for the three FR-067 reasons', () => {
  it('keeps the panel and shows its failure banner for `failed`', async () => {
    const m = mount();
    m.preview.attach.mockImplementation(() =>
      Promise.resolve({ ok: false, reason: 'failed' } as unknown as { ok: true; update: PreviewUpdate }),
    );
    await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
    const id = panelsIn()[0].id;
    act(() => live().setPanelType(id, PREVIEW_KIND, { filePath: FILE }));

    expect(await screen.findByTestId(`panel-failure-${id}`)).toBeInTheDocument();
    expect(panelsIn().find((p) => p.id === id)?.kind).toBe(PREVIEW_KIND);
  });

  it('044 US2 fix round 1 (item 1) — the attach banner’s pointer names no notification: none is raised', async () => {
    const m = mount();
    m.preview.attach.mockImplementation(() =>
      Promise.resolve({ ok: false, reason: 'failed' } as unknown as { ok: true; update: PreviewUpdate }),
    );
    await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
    const id = panelsIn()[0].id;
    act(() => live().setPanelType(id, PREVIEW_KIND, { filePath: FILE }));

    const banner = await screen.findByTestId(`panel-failure-${id}`);
    expect(banner.querySelector('.panel-failure__pointer')?.textContent).toBe('Copy the details here.');
    expect(banner).not.toHaveTextContent(/notification/i);
  });

  it('attaches again from the banner’s Try again, and the banner goes when it succeeds', async () => {
    const m = mount();
    m.preview.attach.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, reason: 'failed' } as unknown as { ok: true; update: PreviewUpdate }),
    );
    await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
    const id = panelsIn()[0].id;
    act(() => live().setPanelType(id, PREVIEW_KIND, { filePath: FILE }));
    await screen.findByTestId(`panel-failure-${id}`);

    await m.user.click(screen.getByTitle('Try again'));

    await waitFor(() => expect(screen.queryByTestId(`panel-failure-${id}`)).toBeNull());
    expect(m.preview.attach).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId(`fake-body-${id}`)).toHaveTextContent('first');
  });

  it.each(['no-provider', 'disabled', 'outside-project'])('clears the panel for `%s` (FR-067)', async (reason) => {
    const m = mount();
    m.preview.attach.mockImplementation(() =>
      Promise.resolve({ ok: false, reason } as unknown as { ok: true; update: PreviewUpdate }),
    );
    await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
    const tabId = live().layout!.tabs[0].id;
    act(() => {
      live().addPanel(tabId);
      live().clearLastAddedPanel();
    });
    await waitFor(() => expect(panelsIn()).toHaveLength(2));
    const id = panelsIn()[0].id;
    act(() => live().setPanelType(id, PREVIEW_KIND, { filePath: FILE }));

    await waitFor(() => expect(panelsIn().map((p) => p.id)).not.toContain(id));
    expect(screen.queryByTestId(`panel-failure-${id}`)).toBeNull();
  });
});

describe('the header menu mirrors a preview’s failure banner (review item 4, 030 FR-042c)', () => {
  const openHeaderMenu = async (user: ReturnType<typeof userEvent.setup>, id: string): Promise<void> => {
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId(`panel-handle-${id}`) });
  };

  it('offers Try again exactly while the banner is up, and it reaches the banner’s own retry', async () => {
    const m = mount();
    m.preview.attach.mockImplementationOnce(() => Promise.resolve({ ok: false, reason: 'failed' } as never));
    await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
    const id = panelsIn()[0].id;
    act(() => live().setPanelType(id, PREVIEW_KIND, { filePath: FILE }));
    await screen.findByTestId(`panel-failure-${id}`);

    await openHeaderMenu(m.user, id);
    // Positive control for the absence below: the three banner commands are on the menu now.
    expect(await screen.findByTestId('menu-item-Try again')).toBeInTheDocument();
    expect(screen.getByTestId('menu-item-Copy details')).toBeInTheDocument();
    expect(screen.getByTestId('menu-item-Clear panel type')).toBeInTheDocument();

    await m.user.click(screen.getByTestId('menu-item-Try again'));

    // The MENU's Try again ran the banner's retry: a second attach, and the banner went with success.
    await waitFor(() => expect(m.preview.attach).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId(`panel-failure-${id}`)).toBeNull());

    await openHeaderMenu(m.user, id);
    await screen.findByTestId('menu-item-Close Panel');
    expect(screen.queryByTestId('menu-item-Try again')).toBeNull();
  });
});

describe('closing the main window’s LAST panel when it is a preview (review item 3)', () => {
  it('ends the preview and leaves an empty panel in its place (FR-042, FR-064)', async () => {
    const { id, preview, user } = await mountPreview();
    await screen.findByTestId(`fake-body-${id}`);
    expect(panelsIn()).toHaveLength(1);

    await user.click(screen.getByTestId(`panel-close-${id}`));

    await waitFor(() => expect(preview.destroyed).toHaveBeenCalledWith(id));
    // `removePanel` keeps the workspace's last panel; it must not stay a preview main has dropped.
    await waitFor(() => expect(panelsIn()[0].kind).toBeUndefined());
    expect(panelsIn()).toHaveLength(1);
    expect(screen.queryByTestId(`preview-${id}`)).toBeNull();
  });
});

describe('closing a preview never prompts and tells main it is gone (FR-042)', () => {
  it('sends destroyed and removes the panel with no dialog, even while the source is dirty', async () => {
    const { id, preview, push, user } = await mountPreview();
    await screen.findByTestId(`fake-body-${id}`);
    // A second panel, so closing this one is allowed at all.
    act(() => {
      live().addPanel(live().layout!.tabs[0].id);
      live().clearLastAddedPanel();
    });
    await waitFor(() => expect(panelsIn()).toHaveLength(2));
    // Parented to a dirty document — the state in which an editor WOULD prompt.
    push(update({ revision: 2, content: null, dirty: true, parent: { panelId: 'ed1', title: 'notes.prvtxt' } }));

    await user.click(screen.getByTestId(`panel-close-${id}`));

    await waitFor(() => expect(panelsIn().map((p) => p.id)).not.toContain(id));
    expect(preview.destroyed).toHaveBeenCalledWith(id);
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(screen.queryByTestId('dirty-close-dialog')).toBeNull();
  });

  it('names its removal Close on the header ✕', async () => {
    const { id } = await mountPreview();
    expect(screen.getByTestId(`panel-close-${id}`)).toHaveAttribute('aria-label', 'Close panel');
  });

  it('sends destroyed when the panel is destroyed in another window (remote destroy)', async () => {
    const { id, preview, remoteDestroy } = await mountPreview();
    await screen.findByTestId(`fake-body-${id}`);
    remoteDestroy(id);
    expect(preview.destroyed).toHaveBeenCalledWith(id);
  });

  it('does not send destroyed for a remote destroy of a panel that is not a preview', async () => {
    const { preview, remoteDestroy } = mount();
    await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
    remoteDestroy(panelsIn()[0].id);
    expect(preview.destroyed).not.toHaveBeenCalled();
  });
});

describe('a preview counts no document (FR-044, SC-006)', () => {
  it('publishes nothing to editor-state, however dirty its source', async () => {
    const { id, push } = await mountPreview();
    await screen.findByTestId(`fake-body-${id}`);
    push(update({ revision: 2, content: null, dirty: true, parent: { panelId: 'ed1', title: 'notes.prvtxt' } }));
    expect(allEditorStates()).toEqual([]);
  });
});

describe('zoom is the preview’s own (FR-034)', () => {
  it('publishes --throng-zoom-preview from Panel.zoom, and follows it', async () => {
    const { id } = await mountPreview();
    const root = await screen.findByTestId(`preview-${id}`);
    expect(root.style.getPropertyValue('--throng-zoom-preview')).toBe(String(zoomFactor(0)));

    act(() => live().bumpZoom(id, 2));
    const level = panelZoomLevel(panelsIn().find((p) => p.id === id) as Panel);
    // Positive control: the store really moved, so the equality below is not 1 === 1.
    expect(level).not.toBe(0);
    await waitFor(() =>
      expect(screen.getByTestId(`preview-${id}`).style.getPropertyValue('--throng-zoom-preview')).toBe(
        String(zoomFactor(level)),
      ),
    );
  });
});

describe('a preview is not renamable and not editable (FR-030, FR-020)', () => {
  it('registers no rename starter, so the rename chord does nothing', async () => {
    const { id } = await mountPreview();
    await screen.findByTestId(`preview-${id}`);
    act(() => {
      expect(requestPanelRename(id)).toBe(false);
    });
    expect(screen.queryByTestId(`panel-rename-input-${id}`)).toBeNull();
  });

  it('opens no rename box on a header double-click', async () => {
    const { id, user } = await mountPreview();
    await screen.findByTestId(`preview-${id}`);
    await user.dblClick(screen.getByTestId(`panel-handle-${id}`));
    expect(screen.queryByTestId(`panel-rename-input-${id}`)).toBeNull();
  });

  it('hosts its body in an element that is not contenteditable', async () => {
    const { id } = await mountPreview();
    await screen.findByTestId(`fake-body-${id}`);
    const host = screen.getByTestId(`preview-body-${id}`);
    // jsdom does not implement `isContentEditable`, so the attribute is what can be asserted — on the
    // host and on everything inside the panel, body included.
    expect(host.hasAttribute('contenteditable')).toBe(false);
    expect(screen.getByTestId(`preview-${id}`).querySelector('[contenteditable]')).toBeNull();
  });
});

describe('the header names a preview through panelDisplayTitle, marking the NAME when shortened (FR-031, FR-032)', () => {
  it('titles a standalone preview `<name an editor would derive> - Preview`', async () => {
    const { id } = await mountPreview();
    await waitFor(() =>
      expect(screen.getByTestId(`panel-title-${id}`).textContent).toBe(`${editorAutoTitle(FILE)} - Preview`),
    );
  });

  it('puts the truncation marker on the name part, never after the suffix', async () => {
    const long = `D:/proj/${'n'.repeat(90)}.prvtxt`;
    const { id } = await mountPreview(long);
    const title = await screen.findByTestId(`panel-title-${id}`);

    // The whole title must not carry the marker class — that would draw `… - Preview…`.
    expect(title).not.toHaveClass('panel-box__title--truncated');
    const name = title.querySelector('.panel-box__title-name');
    const suffix = title.querySelector('.panel-box__title-suffix');
    expect(name).toHaveClass('panel-box__title-name--truncated');
    expect(suffix?.textContent).toBe(' - Preview');
    // The marker is CSS (`::after` on the name), so the text is the bounded name plus the whole suffix.
    expect(name?.nextElementSibling).toBe(suffix);
    expect(title.textContent?.endsWith(' - Preview')).toBe(true);
  });

  it('draws no marker when nothing was shortened', async () => {
    const { id } = await mountPreview();
    const title = await screen.findByTestId(`panel-title-${id}`);
    expect(title.querySelector('.panel-box__title-name--truncated')).toBeNull();
  });
});
