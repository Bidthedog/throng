/**
 * The Files & Folders pane with NO PROJECT OPEN — its options control, and the toolbar it draws in
 * that state (018 / US8 FR-041/FR-043a; 033 / #219 FR-018c, V4).
 *
 * PLACE AT: `packages/ui/tests/component/file-explorer-pane.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/project-settings.e2e.ts:113` and the pane half of
 * `packages/ui/tests/e2e/quick-open-toolbar.e2e.ts:122` (034 FR-045).
 *
 * ══ BOTH STATES ARE HERE NOW, AND THE CORRECTION THAT MADE THAT POSSIBLE ══
 *
 * This file used to say the ACTIVE-project half could not be reached, because the pane renders
 * `FileTree`, which calls `useWorkspace` — "a context that throws without its provider, and whose
 * provider subscribes to the daemon". **That was wrong, and it was wrong in the one way that
 * matters: it is a claim about an EXPORT.** `WorkspaceProvider` is exported from
 * `state/workspace-store.tsx` and takes its client as a PROP; only `WorkspaceContext` itself is
 * private, and nothing here needs it. `file-tree.test.ts` had already mounted the whole stack this
 * way before that sentence was written. So the enabled options control needs no production change,
 * and the last E2E test in `project-settings.e2e.ts` comes down with it (034 FR-045).
 *
 * "No project is open" remains the state the first two migrations are about: FR-041's disabled cog
 * and FR-018c's disabled Quick Open are the same judgement — a control that vanishes teaches the
 * user nothing, one that is visibly unavailable explains itself — and this pane is the only place
 * either is decided.
 *
 * Contexts: `ProjectsProvider` (a real `ProjectsClient` over a fake bridge; see
 * `project-settings-dialog.test.ts` for why the fake goes in at the bridge), ConfigContext's real
 * defaults for `useKeybindings` and `Icon`, and `workspace/active-pane.js`, which is a plain module
 * store and needs no provider at all. The active-project block below adds the five providers
 * `FileTree` needs, in `file-tree.test.ts`'s order.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Withhold `ProjectsProvider` — render the subject bare instead of wrapping it — and `useProjects`
 * throws (`projects-store.tsx:270`), so the pane never renders. **Run, and it fails all 11 tests
 * in this file** — measured rather than assumed: this count read 12 until it was executed, which
 * is the whole reason a control is run and not merely written down. For the active-project block
 * alone, deleting the `ResizeObserver` stub in its `beforeAll` leaves `useSize` at 0×0, `<Tree>`
 * never mounts, and `findByRole('tree')` in `mountWithProject()` throws — failing its 4 tests
 * without any of them reaching an assertion.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
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
import { FileExplorerPane } from '../../src/renderer/panes/file-explorer-pane.js';
import type { FileTreeEntry } from '../../src/renderer/global.js';

/** A daemon with no projects at all — the state a first launch is in (lazy loading, research D7). */
function emptyProjectsClient(): ProjectsClient {
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string): Promise<TResult> {
      if (method === 'projects.list') return Promise.resolve({ projects: [] } as unknown as TResult);
      return Promise.reject(new Error(`unexpected RPC from the empty pane: ${method}`));
    },
  };
  return new ProjectsClient(bridge);
}

async function mount() {
  const user = userEvent.setup();
  render(
    createElement(ProjectsProvider, {
      client: emptyProjectsClient(),
      children: createElement(FileExplorerPane, { onResizeStart: vi.fn(), resizing: false }),
    }),
  );
  // The empty placeholder is the pane's no-project branch; waiting for it means every assertion
  // below is made against a LOADED store rather than against the frame before the list arrived.
  await waitFor(() => expect(screen.getByTestId('file-explorer-empty')).toBeVisible());
  return { user };
}

describe('the project-settings control with no project (US8, FR-041)', () => {
  it('is DRAWN AND DISABLED rather than absent', async () => {
    // The spec originally allowed either. The 2026-08-15 clarification settled it for every
    // temporarily-unavailable control: a control that vanishes teaches the user nothing.
    await mount();

    const options = screen.getByTestId('project-settings-open');
    expect(options).toBeVisible();
    expect(options).toBeDisabled();
  });

  it('explains itself in its hover title', async () => {
    // The migrated spec asserted /no project|No project/. The phrasing is what makes "disabled"
    // legible; a disabled control with a title that only names the action answers the wrong question.
    await mount();

    expect(screen.getByTestId('project-settings-open')).toHaveAttribute(
      'title',
      expect.stringMatching(/no project/i),
    );
  });

  it('opens nothing when it is clicked', async () => {
    /*
     * The behavioural half. `disabled` on a <button> is what makes this true, and asserting the
     * attribute alone would still pass if the pane later moved to a div-with-role, where `disabled`
     * is inert and the click would open a dialog onto a project that does not exist.
     */
    const { user } = await mount();
    const cog = screen.getByTestId('project-settings-open');

    /*
     * THE ASSERTION THAT ACTUALLY BITES, and the absence check below does not.
     *
     * `ProjectSettingsDialog` returns `null` when there is no active project, so
     * `project-settings-dialog` can never be in this tree whether or not the click was honoured —
     * the absence proves nothing about the control. A vacuity audit caught that.
     *
     * What the comment above claims to guard is a pane that moved to a div-with-role, where
     * `disabled` is inert and the click WOULD go through. That is a claim about the element, so it
     * is asserted about the element: a real `<button>` is what makes `disabled` mean anything.
     */
    expect(cog.tagName, 'disabled is inert on anything but a real button').toBe('BUTTON');

    await user.click(cog);

    expect(screen.queryByTestId('project-settings-dialog')).toBeNull();
  });

  it('is a themed icon with a title, never a word (FR-043a)', async () => {
    await mount();

    const options = screen.getByTestId('project-settings-open');
    expect(options).toHaveAttribute('title', expect.stringMatching(/.+/));
    expect(options.querySelectorAll('.icon')).toHaveLength(1);
    expect(options.textContent ?? '').not.toMatch(/settings/i);
  });
});

describe('the toolbar is drawn in the no-project state too (033 FR-018c, V4)', () => {
  it('renders the toolbar beside the empty placeholder', async () => {
    /*
     * This is the structural half of FR-018c and the reason #219 was not merely unimplemented but
     * UNSATISFIABLE: the toolbar used to live inside `FileTree`, and `FileTree` is not mounted in
     * this branch — so there was no toolbar at all on which to draw a disabled Quick Open button.
     * A regression here does not look like a broken button; it looks like no toolbar.
     */
    await mount();

    expect(screen.getByTestId('explorer-toolbar')).toBeVisible();
  });

  it('passes quickOpenEnabled=false, so Quick Open is drawn and disabled', async () => {
    /*
     * `explorer-toolbar.test.ts` proves the TOOLBAR draws a disabled button when it is told to. Only
     * this test proves the pane TELLS it to — the two are different defects and neither test sees
     * the other's.
     */
    await mount();

    const quickOpen = screen.getByRole('button', { name: 'Quick Open' });
    expect(quickOpen).toBeVisible();
    expect(quickOpen).toBeDisabled();
    expect(quickOpen).toHaveAttribute('title', expect.stringMatching(/no project is open/i));
  });

  it('disables the four tree actions, which have nothing to act on', async () => {
    // With no project there is nothing to expand, collapse, create or delete. The pane omits every
    // handler, and an omitted handler is what disables its control.
    await mount();

    for (const name of ['Expand', 'Collapse all', 'New folder', 'Delete']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The pane WITH a project open
 *
 * MIGRATED FROM `packages/ui/tests/e2e/project-settings.e2e.ts:108` — the pane half of "every
 * control this story adds is a themed icon with a hover title (US8, FR-043a)". Its dialog half was
 * already migrated to `project-settings-dialog.test.ts:405`.
 *
 * That E2E made no style measurement of any kind: it read a `title` attribute and counted `.icon`
 * children. The file's own trim comment claimed it "reads `getComputedStyle` for a themed icon,
 * which needs a real cascade (FR-049)" — it does not, and never did; grep the spec. FR-049 protects
 * assertions about REAL layout and a real cascade, and an attribute is neither.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * jsdom implements no `ResizeObserver`, and `FileTree` renders `<Tree>` behind
 * `{ready && width > 0 && height > 0}` fed from `useSize`. Without this the tree never mounts —
 * see the long version in `file-tree.test.ts`, which owns the reasoning. Scoped to this block and
 * removed afterwards, so nothing else in this file starts passing for a reason nobody wrote down.
 */
class ImmediateResizeObserver implements ResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    const contentRect = {
      width: 320,
      height: 600,
      top: 0,
      left: 0,
      right: 320,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } satisfies DOMRectReadOnly;
    this.cb([{ target, contentRect } as ResizeObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}

const DEMO: ProjectDto = {
  id: 'p1',
  name: 'Demo',
  colour: '#3b82f6',
  rootFolder: 'C:/projects/demo',
  isActive: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  hiddenPaths: ['a.txt'],
};

const listing: FileTreeEntry[] = [
  { name: 'b.txt', kind: 'file', isSymlink: false, hasChildren: false },
];

/** A daemon holding one project, which `switchProject` can make active. */
function oneProjectClient(): ProjectsClient {
  let active: string | null = null;
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: [{ ...DEMO }] } as unknown as TResult);
        case 'projects.setActive':
          active = (params as { id: string }).id;
          return Promise.resolve({ activeId: active } as unknown as TResult);
        case 'projects.setHidden':
          return Promise.resolve({ project: { ...DEMO } } as unknown as TResult);
        default:
          return Promise.reject(new Error(`unexpected projects RPC from the pane: ${method}`));
      }
    },
  };
  return new ProjectsClient(bridge);
}

/**
 * The clients `FileTree` resolves through `useServices`, over one shared fake bridge.
 *
 * Two RPCs actually arrive during a mount, both fire-and-forget at the call site; anything else
 * rejects by name so an unexpected call reads as a message rather than as an undefined destructure.
 */
function fakeServices(): Services {
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string): Promise<TResult> {
      switch (method) {
        case 'document.pruneMissing':
          return Promise.resolve({ pruned: 0 } as TResult);
        case 'fileopUndo.get':
          return Promise.resolve({ stackJson: null } as TResult);
        default:
          return Promise.reject(new Error(`unexpected RPC from the open pane: ${method}`));
      }
    },
  };
  return {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}

describe('the project-settings control WITH a project open (US8, FR-041, FR-043a)', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = ImmediateResizeObserver;
  });
  afterAll(() => {
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
  });
  afterEach(() => {
    localStorage.clear();
    Reflect.deleteProperty(window, 'throng');
  });

  /**
   * Mount the pane and OPEN the project.
   *
   * `activeProject` is `projects.find(p => p.id === openedId)`, and `openedId` is set only by
   * `switchProject` — a project flagged `isActive` in the list is not enough — so the host below
   * carries the button that opens it, exactly as `project-settings-dialog.test.ts` does.
   *
   * `WorkspaceProvider` is given `activeProjectId: null` deliberately: nothing under test reads
   * `ws.layout`, and null skips the layout load, so a fake daemon does not have to invent one.
   */
  async function mountWithProject() {
    const user = userEvent.setup();
    const services = fakeServices();

    Reflect.set(window, 'throng', {
      files: {
        setRoot: vi.fn(),
        list: vi.fn(() => Promise.resolve({ entries: listing })),
        onChange: vi.fn(() => () => {}),
        onWatchFailed: vi.fn(() => () => {}),
      },
      editor: { isOpen: () => Promise.resolve(false) },
    });

    function Host(): ReactElement {
      const { activeProject, switchProject } = useProjects();
      return createElement(
        'div',
        null,
        createElement(
          'button',
          { 'data-testid': 'open-p1', onClick: () => void switchProject('p1') },
          'open',
        ),
        createElement('span', { 'data-testid': 'active-project' }, activeProject?.name ?? 'none'),
        createElement(FileExplorerPane, { onResizeStart: vi.fn(), resizing: false }),
      );
    }

    // Innermost last. ProjectsProvider must sit outermost of the pair the pane itself reads.
    const wrap = (children: ReactNode): ReactElement =>
      createElement(
        ServicesProvider,
        { services },
        createElement(
          ProjectsProvider,
          { client: oneProjectClient() },
          createElement(
            WorkspaceProvider,
            { client: services.workspace, activeProjectId: null },
            createElement(
              NotificationProvider,
              null,
              createElement(
                ConfirmProvider,
                null,
                createElement(ContextMenuProvider, null, children),
              ),
            ),
          ),
        ),
      );

    render(wrap(createElement(Host, null)));
    await user.click(await screen.findByTestId('open-p1'));
    await waitFor(() => expect(screen.getByTestId('active-project')).toHaveTextContent('Demo'));
    /*
     * Waiting for the TREE, not merely for the name, is what stops every assertion below from being
     * a claim about an empty pane: with no project open the pane renders the placeholder and the
     * options control is disabled, which is the exact state three of these four tests would then
     * pass in for the wrong reason.
     */
    await screen.findByRole('tree');
    return { user };
  }

  it('is ENABLED once a project is open, and the two states differ', async () => {
    await mountWithProject();

    // The disabled block above proves the other half; asserted here so a control that is disabled
    // in BOTH states cannot satisfy this file.
    expect(screen.getByTestId('project-settings-open')).toBeEnabled();
  });

  it('NAMES the project in its hover title', async () => {
    /*
     * The E2E asserted `/.+/` — any title at all — which a control titled "Project settings — no
     * project is active" would have satisfied while a project was open. Asserted against the
     * project's NAME here, which is what makes the title answer "whose settings?".
     */
    await mountWithProject();

    expect(screen.getByTestId('project-settings-open')).toHaveAttribute(
      'title',
      expect.stringContaining('Demo'),
    );
  });

  it('is a themed icon and never a word (FR-043a)', async () => {
    await mountWithProject();

    /*
     * `textContent` is NOT asserted empty: a `glyph` icon pack renders its glyph as text inside the
     * `.icon` span (`common/icon.tsx:64`), so an empty-string assertion would fail on a perfectly
     * conformant pack. What the rule actually forbids is a WORD naming the action, which is what the
     * E2E's `not.toContainText(/remove/i)` was reaching for on the dialog's side.
     */
    const options = screen.getByTestId('project-settings-open');
    expect(options.querySelectorAll('.icon')).toHaveLength(1);
    expect(options.textContent ?? '').not.toMatch(/settings|project/i);
  });

  it('opens the project settings dialog when it is clicked', async () => {
    /*
     * NOT in the migrated E2E, and it is the assertion that makes the other three worth having: a
     * themed, titled, enabled control that opens nothing is exactly as broken as a missing one, and
     * the disabled-state block cannot make this claim — `ProjectSettingsDialog` returns null with no
     * active project, so its absence there proves nothing about the button.
     */
    const { user } = await mountWithProject();

    expect(screen.queryByTestId('project-settings-dialog')).toBeNull();
    await user.click(screen.getByTestId('project-settings-open'));

    await waitFor(() => expect(screen.getByTestId('project-settings-dialog')).toBeVisible());
  });
});
