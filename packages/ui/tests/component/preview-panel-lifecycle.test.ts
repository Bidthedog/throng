/**
 * 044 u8 fix round 1 — `PreviewPanel` on its own: its effect lifecycle, and the failures a body load
 * can meet (review items 1, 5 and 7).
 *
 * Rendered directly rather than through `PanelPlaceholder` because every claim here is about the
 * panel's OWN effects and banner: how many times an attach's answer is applied under StrictMode's
 * double mount, whether its update subscription is released, and what a rejected body load or a
 * rejected renderer shows. `usePanelPlace` is the one hook substituted — it reads the workspace and
 * project stores only to NAME the panel in copied failure text, which nothing here asserts.
 *
 * ══ WHY A BODY FAILURE NEEDS A BANNER AT ALL ══
 *
 * Both loads were `void`ed promises with no catch. A chunk that failed to arrive, or a renderer that
 * threw while being built, left the panel's body blank with an unhandled rejection at the top of the
 * renderer and nothing on screen saying anything was wrong — the "failure that vanishes" 030 exists
 * to end. The shared banner is the one surface for it, its Try again loads again, and the cause goes
 * to the diagnostics log.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_KIND,
  createDefaultLayout,
  createPreviewProviderRegistry,
  type Panel,
  type PreviewAttachRequest,
  type PreviewUpdate,
} from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { PreviewPanel } from '../../src/renderer/preview/preview-panel.js';
import { PreviewProviderRegistryContext } from '../../src/renderer/preview/provider-registry-context.js';
import { __resetPreviewStore, getPreviewFailure } from '../../src/renderer/preview/preview-store.js';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';

vi.mock('../../src/renderer/common/panel-subject.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/common/panel-subject.js')>();
  return { ...actual, usePanelPlace: () => undefined };
});

/*
 * The production renderer, made to fail ONCE when it is built. The body reaches it only through a
 * dynamic import, so this is the same rejection a chunk that failed to load produces at that `then`.
 */
/*
 * `renders` fails RENDERS rather than the build. The body caches the window's one renderer once built, so a
 * later test in this file cannot make the build fail again; a render that throws reaches the body's same
 * `catch`, and the same `onBodyFailure`.
 */
const rendererFaults = vi.hoisted(() => ({ remaining: 0, renders: 0 }));
vi.mock('../../src/renderer/preview/providers/markdown/markdown-renderer.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/preview/providers/markdown/markdown-renderer.js')>();
  return {
    ...actual,
    createMarkdownRenderer: (...args: Parameters<typeof actual.createMarkdownRenderer>) => {
      if (rendererFaults.remaining > 0) {
        rendererFaults.remaining -= 1;
        throw new Error('renderer chunk failed to load');
      }
      const built = actual.createMarkdownRenderer(...args);
      const render = built.render.bind(built);
      built.render = (...renderArgs: Parameters<typeof render>) => {
        if (rendererFaults.renders > 0) {
          rendererFaults.renders -= 1;
          throw new Error('renderer failed to draw');
        }
        return render(...renderArgs);
      };
      return built;
    },
  };
});

const FILE = 'D:/proj/notes.prvtxt';
const COLD = { timeout: 10_000 };

const registry = createPreviewProviderRegistry([
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
]);

function FakeBody({ content, panelId }: PreviewBodyProps): ReactElement {
  return createElement('div', { 'data-testid': `fake-body-${panelId}` }, content.kind === 'text' ? content.text : '');
}

const update = (over: Partial<PreviewUpdate> = {}): PreviewUpdate => ({
  panelId: 'p1',
  revision: 1,
  filePath: FILE,
  providerId: 'testText',
  content: { kind: 'text', text: '# Heading' },
  dirty: false,
  parent: null,
  notice: null,
  ...over,
});

const previewPanel = (): Panel => ({
  type: 'panel',
  id: 'p1',
  originProjectId: 'proj-1',
  title: 'Panel 1',
  kind: PREVIEW_KIND,
  config: { filePath: FILE },
});

function installBridge() {
  const offs: ReturnType<typeof vi.fn>[] = [];
  const log = vi.fn();
  const preview = {
    attach: vi.fn((req: PreviewAttachRequest) =>
      Promise.resolve({ ok: true as const, update: update({ panelId: req.panelId }) }),
    ),
    detach: vi.fn(),
    destroyed: vi.fn(),
    onUpdate: vi.fn(() => {
      const off = vi.fn();
      offs.push(off);
      return off;
    }),
  };
  Reflect.set(window, 'throng', { preview, notices: { log } });
  return { preview, offs, log };
}

/**
 * 045 FR-169 – FR-171 — the Link menu's Open In ▸ rows need the workspace layout (`useWorkspace`), and
 * its failure report needs a project to name (`useReportSubjectFailure` → `useProjects`). Neither is
 * exercised by anything this file asserts — no test here opens the Link menu or fails a link — so a
 * minimal client over one fake bridge, shared by both providers, stands in for the real ones.
 */
function fakeBridge(): ThrongBridge {
  const layout = createDefaultLayout('proj-1', { tab: 't1', panel: 'p1' });
  return {
    invoke: <T,>(method: string): Promise<T> => {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save':
          return Promise.resolve({ ok: true } as T);
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

function renderPanel(
  view: PreviewProviderView,
  opts: { strict?: boolean; onRefused?: () => void } = {},
) {
  const bridge = fakeBridge();
  const tree = createElement(
    ProjectsProvider,
    { client: new ProjectsClient(bridge) },
    createElement(
      WorkspaceProvider,
      { client: new WorkspaceClient(bridge), activeProjectId: 'proj-1' },
      createElement(
        PreviewProviderRegistryContext.Provider,
        { value: { registry, views: { testText: view } } },
        createElement(
          NotificationProvider,
          null,
          // Every window's composition root provides the menu host; the panel opens its link menu through it.
          createElement(
            ContextMenuProvider,
            null,
            createElement(PreviewPanel, {
              panel: previewPanel(),
              projectRoot: 'D:/proj',
              onRefused: opts.onRefused ?? (() => {}),
              onClearType: () => {},
              onClose: () => {},
            }),
          ),
        ),
      ),
    ),
  );
  return render(opts.strict ? createElement(StrictMode, null, tree) : tree);
}

const fakeView = (load: PreviewProviderView['load']): PreviewProviderView => ({
  id: 'testText',
  textSelection: true,
  load,
});

beforeEach(() => {
  __resetPreviewStore();
  rendererFaults.remaining = 0;
  rendererFaults.renders = 0;
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('the attach lifecycle under StrictMode’s double mount (review item 5)', () => {
  it('applies a refusal once, not once per mount', async () => {
    const bridge = installBridge();
    bridge.preview.attach.mockImplementation(() =>
      Promise.resolve({ ok: false, reason: 'no-provider' } as never),
    );
    const onRefused = vi.fn();
    renderPanel(fakeView(() => Promise.resolve(FakeBody)), { strict: true, onRefused });

    // StrictMode mounts, unmounts and mounts again: two attaches are sent, and the first view's
    // answer arrives for a view that no longer exists.
    await waitFor(() => expect(bridge.preview.attach).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onRefused).toHaveBeenCalled());
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(onRefused).toHaveBeenCalledTimes(1);
  });
});

describe('the update subscription is released (review item 7)', () => {
  it('unsubscribes from onUpdate when the panel unmounts', async () => {
    const bridge = installBridge();
    const view = renderPanel(fakeView(() => Promise.resolve(FakeBody)));
    await screen.findByTestId('fake-body-p1');
    expect(bridge.preview.onUpdate).toHaveBeenCalledTimes(1);
    expect(bridge.offs[0]).not.toHaveBeenCalled();

    view.unmount();

    expect(bridge.offs[0]).toHaveBeenCalledTimes(1);
    expect(bridge.preview.detach).toHaveBeenCalledWith('p1');
  });
});

describe('a body that cannot be loaded says so, and Try again loads it (review item 1)', () => {
  it('shows the failure banner for a rejected view.load, logs the cause, and recovers on Try again', async () => {
    const bridge = installBridge();
    const load = vi
      .fn<PreviewProviderView['load']>()
      .mockRejectedValueOnce(new Error('chunk preview-x.js failed'))
      .mockResolvedValue(FakeBody);
    const user = userEvent.setup();
    renderPanel(fakeView(load));

    const banner = await screen.findByTestId('panel-failure-p1');
    expect(screen.queryByTestId('fake-body-p1')).toBeNull();
    // Readable by the header, which is what lets its menu mirror the banner (item 4).
    expect(getPreviewFailure('p1')?.kind).toBe('body');
    // The cause reaches the diagnostics log — the raw error as the detail, never on screen.
    expect(bridge.log).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', detail: 'chunk preview-x.js failed' }),
    );
    expect(banner).not.toHaveTextContent('chunk preview-x.js failed');
    // 044 US2 fix round 1 (item 1) — the cause goes to the log, not a notification, so the pointer names none.
    expect(banner.querySelector('.panel-failure__pointer')?.textContent).toBe('Copy the details here.');
    expect(banner).not.toHaveTextContent(/notification/i);

    await user.click(screen.getByTitle('Try again'));

    expect(await screen.findByTestId('fake-body-p1')).toHaveTextContent('# Heading');
    expect(load).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByTestId('panel-failure-p1')).toBeNull());
    expect(getPreviewFailure('p1')).toBeUndefined();
  });

  it('shows the failure banner when the Markdown renderer cannot be built, and Try again renders', async () => {
    installBridge();
    rendererFaults.remaining = 1;
    const user = userEvent.setup();
    renderPanel(
      fakeView(() =>
        import('../../src/renderer/preview/providers/markdown/markdown-body.js').then((m) => m.MarkdownBody),
      ),
    );

    await screen.findByTestId('panel-failure-p1', {}, COLD);
    expect(getPreviewFailure('p1')?.kind).toBe('body');

    await user.click(screen.getByTitle('Try again'));

    await waitFor(
      () => expect(screen.getByTestId('preview-markdown-p1').querySelector('h1')?.textContent).toBe('Heading'),
      COLD,
    );
    await waitFor(() => expect(screen.queryByTestId('panel-failure-p1')).toBeNull());
  });

  /*
   * 044 US3 (carried from the US2 review) — a redraw that fails AGAIN is a failed retry, and says so.
   *
   * The draw branch of the body's retry used to clear the failure and resolve `true` the moment it asked
   * for a remount — before the remounted body had tried anything. The banner went, came straight back
   * with the second failure as a NEW banner, and never showed "That did not work…", which the load
   * branch's retry does show (030 FR-045). The retry now resolves from the redraw's own outcome.
   */
  it('a redraw that fails again keeps the ONE banner and says the condition is still there', async () => {
    installBridge();
    rendererFaults.renders = 2;
    const user = userEvent.setup();
    renderPanel(
      fakeView(() =>
        import('../../src/renderer/preview/providers/markdown/markdown-body.js').then((m) => m.MarkdownBody),
      ),
    );

    const first = await screen.findByTestId('panel-failure-p1', {}, COLD);
    expect(first.querySelector('.panel-failure__retry-failed')).toBeNull();

    await user.click(screen.getByTitle('Try again'));

    await waitFor(() => expect(first.querySelector('.panel-failure__retry-failed')).not.toBeNull(), COLD);
    // The same element: the banner stayed up through the retry rather than going and coming back.
    expect(screen.getByTestId('panel-failure-p1')).toBe(first);
    expect(getPreviewFailure('p1')?.kind).toBe('body');
    expect(rendererFaults.renders).toBe(0);
  });

  it('a redraw that succeeds clears the banner only once the body has drawn', async () => {
    installBridge();
    rendererFaults.renders = 1;
    const user = userEvent.setup();
    renderPanel(
      fakeView(() =>
        import('../../src/renderer/preview/providers/markdown/markdown-body.js').then((m) => m.MarkdownBody),
      ),
    );
    const banner = await screen.findByTestId('panel-failure-p1', {}, COLD);

    await user.click(screen.getByTitle('Try again'));

    await waitFor(() => expect(screen.queryByTestId('panel-failure-p1')).toBeNull(), COLD);
    expect(screen.getByTestId('preview-markdown-p1').querySelector('h1')?.textContent).toBe('Heading');
    expect(banner.querySelector('.panel-failure__retry-failed')).toBeNull();
  });
});
