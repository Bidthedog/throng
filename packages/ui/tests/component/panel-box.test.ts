import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultLayout,
  collectPanels,
  type Panel,
  type WorkspaceLayout,
  DEFAULT_KEYBINDINGS,
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
import { requestPanelRename } from '../../src/renderer/workspace/panel-rename.js';
import { PANEL_NAME_CLAIM_METHOD } from '@throng/ipc-contract';
import { panelHeaderMenu } from '../../src/renderer/workspace/panel-header-menu.js';
import { setEditorState, removeEditorState, allEditorStates } from '../../src/renderer/editor/editor-state.js';

/**
 * The PANEL BOX itself — which panel is active, what its header draws, and what closing one does
 * (021 US2 / FR-002, 006 US8, 024 US3 / FR-025).
 *
 * PLACE AT: `packages/ui/tests/component/panel-box.test.ts`
 * MIGRATED FROM `active-panel.e2e.ts:53` and `:74`, and `destroy.e2e.ts:68`.
 *
 * ══ THE THING THAT HAD TO BE ESTABLISHED BEFORE ANY OF THIS WAS WRITTEN ══
 *
 * `PanelPlaceholder` reads THIRTY imports, including `@dnd-kit/core`'s `useDraggable`/`useDroppable`,
 * the terminal focus registry, the PTY-backed subprocess registry and the editor document authority.
 * Every previous migration that reached this component turned back at that list — including this
 * branch's own commit for the tree's unsaved dot, which took a source guard for the header's
 * panel-kind rule rather than render the header.
 *
 * The list is misleading. FIVE providers mount it:
 *
 *   `ServicesProvider` · `ProjectsProvider` · `WorkspaceProvider` · `NotificationProvider` ·
 *   `ConfirmProvider` · `ContextMenuProvider`
 *
 * — and of those, only `ProjectsProvider` was a surprise (`useProjects` THROWS without it, at
 * `projects-store.tsx:271`, which is how it was found). `useDraggable` and `useDroppable` work
 * outside a `DndContext`; `useDetach`, `useSubWorkspaceWindow` and `useCapabilities` all return a
 * null-ish value rather than throwing; `ConfigContext` has shipped defaults and needs no provider.
 * Nothing is stubbed and nothing in production changed to make this mount.
 *
 * That was established by a spike before a line of this was written, because the alternative — a
 * partial mount held together with mocks — is how a component test starts asserting the test's own
 * scaffolding.
 *
 * ══ WHAT STILL DOES NOT BELONG HERE ══
 *
 * A panel that hosts a LIVE TERMINAL. `panelHasLiveTerminal` reads a registry fed by real PTY
 * sessions, and the destroy path's confirmation, its kill and the daemon clearing that session are
 * three different layers' business. `destroy.e2e.ts:86` keeps them.
 */

const PROJECT = 'proj-1';

/* ────────────────────────────────────────────────────────────────────────── *
 * The fake daemon
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * A layout the store loads, and a log of what it saved.
 *
 * `workspace.save` is recorded rather than ignored: "the panel was removed" and "the removal was
 * persisted" are two claims, and the migrated E2E could only ever see the first.
 */
function fakeDaemon() {
  const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  const saved: WorkspaceLayout[] = [];
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save':
          saved.push((params as { layout: WorkspaceLayout }).layout);
          return Promise.resolve({ ok: true } as T);
        case 'workspace.loadSubWorkspaces':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [] } as T);
        default:
          // Loud rather than silent: an unexpected RPC resolved to `{}` is how a test starts
          // passing against a code path that no longer exists.
          return Promise.reject(new Error(`unexpected RPC from the panel box: ${method}`));
      }
    },
  };
  return { bridge, saved };
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

/* ────────────────────────────────────────────────────────────────────────── *
 * The host
 * ────────────────────────────────────────────────────────────────────────── */

type Ws = ReturnType<typeof useWorkspace>;
const captured: { ws: Ws | null } = { ws: null };

/**
 * Every panel in the chosen tab, as real `PanelPlaceholder`s.
 *
 * `tabIndex` is a prop rather than the store's `activeTabId` because the per-tab memory test needs
 * to render tab 2 while tab 1's `activePanelId` stays put — which is exactly the state the migrated
 * test reached by clicking a tab chip, and the claim is about what the STORE remembered, not about
 * the chip.
 */
function Host({ tabIndex = 0 }: { tabIndex?: number }): ReactElement | null {
  const ws = useWorkspace();
  captured.ws = ws;
  const layout = ws.layout;
  if (!layout) return null;
  const tab = layout.tabs[tabIndex];
  if (!tab) return null;
  return createElement(
    'div',
    { 'data-testid': 'panes' },
    ...collectPanels(tab.root).map((p) =>
      createElement(PanelPlaceholder, { key: p.id, panel: p, tabId: tab.id }),
    ),
  );
}

function mount(tabIndex = 0) {
  const user = userEvent.setup();
  // `notifyDestroyed` and `notifyTyped` are optional-chained broadcasts to other windows. Present as
  // spies so a destroy can be asserted to have told them, absent nothing.
  const notifyDestroyed = vi.fn();
  Reflect.set(window, 'throng', { panel: { notifyDestroyed } });

  const daemon = fakeDaemon();
  const services = servicesOver(daemon.bridge);

  // ANTI-VACUITY CONTROL: replace `PanelPlaceholder` in `Host` with `'div'` and every test here
  // fails — there is no assertion in this file that a bare div satisfies.
  render(
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
              createElement(ContextMenuProvider, null, createElement(Host, { tabIndex })),
            ),
          ),
        ),
      ),
    ),
  );
  return { user, daemon, notifyDestroyed };
}

/** The store, once it has loaded a layout. */
async function ready(): Promise<Ws> {
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
  return live();
}

/** The CURRENT store — every operation renders a new context value, so a held `ws` goes stale. */
const live = (): Ws => captured.ws as Ws;
const tabOf = (ws: Ws, i = 0) => (ws.layout as WorkspaceLayout).tabs[i];
const panelsIn = (ws: Ws, i = 0): Panel[] => collectPanels(tabOf(ws, i).root) as Panel[];

const box = (panelId: string): HTMLElement => screen.getByTestId(`panel-${panelId}`);
const boxes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.panel-box')];

/** Every action `panelHeaderMenu` requires, as no-ops: this file reads the menu, it does not run it. */
const noop = (): void => {};
const resetOnlyActions = {
  beginRename: noop,
  resetName: noop,
  zoomIn: noop,
  zoomOut: noop,
  resetZoom: noop,
  save: noop,
  saveAs: noop,
  revert: noop,
  reloadFromDisk: noop,
  revealInTree: noop,
  openInOsExplorer: noop,
  tryAgain: noop,
  reloadTerminal: noop,
  copyDetails: noop,
  clearPanelType: noop,
  redraw: noop,
  sendToNewTab: noop,
  sendToTab: noop,
  destroy: noop,
};


beforeEach(() => {
  captured.ws = null;
});
afterEach(() => {
  for (const s of allEditorStates()) removeEditorState(s.panelId);
  Reflect.deleteProperty(window, 'throng');
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Which panel is active (021 US2 / FR-002)
 * ────────────────────────────────────────────────────────────────────────── */

describe('clicking a panel makes it the active one (migrated from active-panel.e2e.ts:53)', () => {
  it('moves data-active and the highlight class, and never marks two at once', async () => {
    const { user } = mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;

    // A second panel, so "active" is a choice rather than the only option.
    let second = '';
    await waitFor(() => {
      second = live().addPanel(tabId);
      expect(second).toBeTruthy();
    });
    // A user-added panel opens in rename mode (FR-041); the migrated test committed that rename
    // before clicking. Nothing here reads the name, and the input does not block a pointer event on
    // the box, so it is cleared rather than committed.
    live().clearLastAddedPanel();
    await waitFor(() => expect(boxes()).toHaveLength(2));

    const [first] = panelsIn(live()).map((p) => p.id);
    expect(first).not.toBe(second);

    await user.click(box(first));
    await waitFor(() => expect(box(first)).toHaveAttribute('data-active', 'true'));
    expect(box(first)).toHaveClass(/panel-box--active/);
    expect(box(second)).toHaveAttribute('data-active', 'false');
    expect(box(second)).not.toHaveClass(/panel-box--active/);

    await user.click(box(second));
    await waitFor(() => expect(box(second)).toHaveAttribute('data-active', 'true'));
    expect(box(first)).toHaveAttribute('data-active', 'false');

    // The migrated test asserted the two attributes separately and never that EXACTLY one is set.
    // A highlight that is additive rather than exclusive satisfies every assertion above.
    expect(boxes().filter((el) => el.dataset.active === 'true')).toHaveLength(1);
    expect(document.querySelectorAll('.panel-box--active')).toHaveLength(1);
  });

  it('records the choice in the store, not merely in the DOM', async () => {
    // The class is a consequence; `activePanelId` is the state the next tab switch reads back, and
    // it is what the per-tab memory below actually depends on.
    const { user } = mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;
    let second = '';
    await waitFor(() => {
      second = live().addPanel(tabId);
      expect(second).toBeTruthy();
    });
    live().clearLastAddedPanel();
    await waitFor(() => expect(boxes()).toHaveLength(2));

    await user.click(box(second));

    await waitFor(() => expect(tabOf(live()).activePanelId).toBe(second));
  });
});

describe('each tab remembers its own active panel (migrated from active-panel.e2e.ts:74)', () => {
  it('leaves tab 1’s choice standing while tab 2 has its own', async () => {
    const { user } = mount();
    const ws = await ready();
    const tab1 = tabOf(ws).id;

    let second = '';
    await waitFor(() => {
      second = live().addPanel(tab1);
      expect(second).toBeTruthy();
    });
    live().clearLastAddedPanel();
    await waitFor(() => expect(boxes()).toHaveLength(2));

    const [first] = panelsIn(live()).map((p) => p.id);
    await user.click(box(first));
    await waitFor(() => expect(tabOf(live()).activePanelId).toBe(first));

    // A second tab arrives with its own panel, and its own active panel.
    await waitFor(() => {
      live().addTab();
      expect((live().layout as WorkspaceLayout).tabs).toHaveLength(2);
    });
    live().clearLastAddedPanel();

    const tab2 = tabOf(live(), 1);
    expect(tab2.id).not.toBe(tab1);
    expect(tab2.activePanelId).not.toBe(first);

    // …and tab 1's memory is untouched. The migrated test proved this by clicking back to the chip
    // and re-reading the attribute, which cannot distinguish "remembered" from "recomputed as the
    // first panel". Asserting the id rules that out: `first` is the SECOND panel in document order
    // is not true here, so this is checked directly below instead.
    expect(tabOf(live(), 0).activePanelId).toBe(first);
  });

  it('renders tab 1’s remembered panel as active when tab 1 is drawn again', async () => {
    // The rendered half of the same claim: the attribute follows the remembered id, so a store that
    // kept the id while the box drew the wrong one would still be a bug the user sees.
    const { user } = mount();
    const ws = await ready();
    const tab1 = tabOf(ws).id;
    let second = '';
    await waitFor(() => {
      second = live().addPanel(tab1);
      expect(second).toBeTruthy();
    });
    live().clearLastAddedPanel();
    await waitFor(() => expect(boxes()).toHaveLength(2));

    await user.click(box(second));
    await waitFor(() => expect(box(second)).toHaveAttribute('data-active', 'true'));

    await waitFor(() => {
      live().addTab();
      expect((live().layout as WorkspaceLayout).tabs).toHaveLength(2);
    });
    live().clearLastAddedPanel();
    live().setActiveTab(tab1);

    await waitFor(() => expect(box(second)).toHaveAttribute('data-active', 'true'));
    const [first] = panelsIn(live()).map((p) => p.id);
    expect(box(first)).toHaveAttribute('data-active', 'false');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Destroying an empty panel (024 US3 / SC-005)
 * ────────────────────────────────────────────────────────────────────────── */

describe('an empty panel is destroyed immediately (migrated from destroy.e2e.ts:68)', () => {
  it('asks nothing, removes the panel, and tells the other windows', async () => {
    /*
     * The rule: a PANEL confirms only when it hosts a live terminal, because losing a running shell
     * is the destructive case. `planConfirmations('panel', settings, { panelActive: false })` is
     * `{ dialogs: 0 }` and `core/tests/unit/destroy.test.ts:17` owns that. What is asserted here is
     * the CALL SITE honouring it — that the header's × takes the no-dialog branch for a panel with
     * nothing in it.
     */
    const { user, notifyDestroyed } = mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;

    // Two panels, so destroying one is allowed at all (the workspace keeps at least one).
    await waitFor(() => {
      const id = live().addPanel(tabId);
      expect(id).toBeTruthy();
    });
    live().clearLastAddedPanel();
    await waitFor(() => expect(boxes()).toHaveLength(2));
    const [first] = panelsIn(live()).map((p) => p.id);

    await user.click(screen.getByTestId(`panel-close-${first}`));

    await waitFor(() => expect(boxes()).toHaveLength(1));
    // No dialog — asserted after the removal has landed, so it is a claim about a dialog that was
    // never raised rather than one that had not been raised yet.
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(panelsIn(live()).map((p) => p.id)).not.toContain(first);
    // FR-026 — a destroy from the project cascades to the sub-workspaces mirroring that panel. The
    // migrated test could not see this at all; it is a broadcast, not a rendered change.
    expect(notifyDestroyed).toHaveBeenCalledWith(first);
  });

  it('persists the removal rather than only redrawing', async () => {
    // "The panel went from the screen" and "the panel went from the layout that gets saved" are two
    // claims. The E2E could only ever make the first.
    const { user, daemon } = mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;
    await waitFor(() => {
      const id = live().addPanel(tabId);
      expect(id).toBeTruthy();
    });
    live().clearLastAddedPanel();
    await waitFor(() => expect(boxes()).toHaveLength(2));
    const [first] = panelsIn(live()).map((p) => p.id);

    await user.click(screen.getByTestId(`panel-close-${first}`));

    await waitFor(() => {
      const last = daemon.saved[daemon.saved.length - 1];
      expect(last).toBeTruthy();
      expect(collectPanels(last.tabs[0].root).map((p) => p.id)).not.toContain(first);
    });
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The header's unsaved dot, gated on the panel being an editor NOW
 * ────────────────────────────────────────────────────────────────────────── */

describe('a TERMINAL never wears an editor’s unsaved mark (024 follow-up, from tree-unsaved-dot.e2e.ts:62)', () => {
  it('draws the dot for a dirty EDITOR panel', async () => {
    mount();
    const ws = await ready();
    const [first] = panelsIn(ws).map((p) => p.id);

    live().setPanelType(first, 'editor', { filePath: 'C:/proj/a.txt' });
    await waitFor(() => expect(box(first)).toBeInTheDocument());

    setEditorState(first, { filePath: 'C:/proj/a.txt', dirty: true });

    await waitFor(() => expect(screen.getByTestId(`panel-unsaved-${first}`)).toBeVisible());
  });

  it('does NOT draw it for a TERMINAL panel holding the same state', async () => {
    /*
     * The defect, restated: editor state is keyed by panel id and DELIBERATELY outlives an editor's
     * unmount, so a document can move between tabs and windows without being destroyed
     * (`use-editor.ts`). A panel that once held a dirty editor and has since been re-typed still HAS
     * that state — and the dot alone was reading it, so a terminal wore another document's unsaved
     * mark: work the user cannot reach from that panel and cannot save there.
     *
     * `unsaved-dot-call-sites.test.ts` guards this by reading the source, and said in its own header
     * that rendering `PanelPlaceholder` to check one span would be the trade this branch is undoing.
     * That was true when it was written and is not true now: the mount costs six providers. The
     * source guard stays for the property it asserts about EVERY site; this asserts the gate on a
     * real rendered node.
     */
    mount();
    const ws = await ready();
    const [first] = panelsIn(ws).map((p) => p.id);

    live().setPanelType(first, 'terminal', { flavourId: 'cmd' });
    await waitFor(() => expect(box(first)).toBeInTheDocument());

    // The state a re-typed panel keeps: dirty, with a file, under this panel's id.
    setEditorState(first, { filePath: 'C:/proj/a.txt', dirty: true });

    // Positive control first — the state really is there, so the absence below is the gate working
    // rather than the state never having been set.
    expect(allEditorStates().find((s) => s.panelId === first)?.dirty).toBe(true);
    await waitFor(() => expect(box(first)).toHaveAttribute('data-panel-id', first));
    expect(screen.queryByTestId(`panel-unsaved-${first}`)).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * What the header CALLS the panel
 * (#89/#97 / FR-017, migrated from editor-naming.e2e.ts:81 and :115)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The precedence itself — user rename beats live source beats placeholder — is
 * `core/tests/unit/panel-display-title.test.ts`. What that cannot show is this header calling
 * `panelDisplayTitle` with the right SOURCES, and the two rules either side of it: that a rename box
 * dismissed without typing is not a rename, and that "Reset Name" is disabled until there is
 * something to reset.
 *
 * Both migrated tests made a real project on disk, launched Electron, typed a panel into an editor
 * and clicked files in the explorer tree — to read one `<span>` and one menu item's disabled state.
 *
 * ══ THE BUG THE FIRST ONE IS FOR, WHICH IS EASY TO MISREAD ══
 *
 * A user-added panel opens straight into its rename box. Leaving that box without typing is what
 * everyone actually does — you click away to pick the panel's type — and it used to COMMIT the
 * untouched default as a MANUAL name. That name then outranked every automatic one for the rest of
 * the panel's life, so an editor opened in it never titled itself from its file. The symptom
 * ("my editor is called Panel 2") is three steps from the cause.
 */
describe('a rename box dismissed without typing is not a rename (migrated from editor-naming.e2e.ts:81)', () => {
  it('leaves the panel auto-named, and Reset Name disabled', async () => {
    const { user } = mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;

    // A user-added panel opens IN rename mode — `addPanel` sets it, and nothing here clears it.
    let added = '';
    await waitFor(() => {
      added = live().addPanel(tabId);
      expect(added).toBeTruthy();
    });
    const input = await screen.findByTestId(`panel-rename-input-${added}`);

    // Blur without typing. The migrated test pressed Tab; `user.tab()` is the same gesture.
    await user.tab();

    await waitFor(() => expect(screen.queryByTestId(`panel-rename-input-${added}`)).toBeNull());
    void input;

    // The rule, stated where it lives: nothing was typed, so nothing was renamed. `titleIsCustom`
    // is what every later automatic source is gated on, and it is the flag the defect set.
    const panel = panelsIn(live()).find((p) => p.id === added);
    expect(panel?.titleIsCustom ?? false).toBe(false);
  });

  it('so the panel still titles itself from the file it later opens', async () => {
    const { user } = mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;
    let added = '';
    await waitFor(() => {
      added = live().addPanel(tabId);
      expect(added).toBeTruthy();
    });
    await screen.findByTestId(`panel-rename-input-${added}`);
    await user.tab();
    await waitFor(() => expect(screen.queryByTestId(`panel-rename-input-${added}`)).toBeNull());

    // Now it becomes an editor holding a file — which is where the defect showed itself.
    live().setPanelType(added, 'editor', { filePath: 'C:/proj/foo.ts' });
    setEditorState(added, { filePath: 'C:/proj/foo.ts', ownerRoot: 'C:/proj' });

    await waitFor(() =>
      expect(screen.getByTestId(`panel-title-${added}`)).toHaveTextContent('foo'),
    );
  });
});

describe('an editor titles itself from its open file (migrated from editor-naming.e2e.ts:115)', () => {
  /** Type the first panel as an editor holding `absPath`, the way the editor itself does. */
  async function editorOn(panelId: string, absPath: string): Promise<void> {
    live().setPanelType(panelId, 'editor', { filePath: absPath });
    setEditorState(panelId, { filePath: absPath, ownerRoot: 'C:/proj' });
    await waitFor(() => expect(screen.getByTestId(`panel-${panelId}`)).toBeInTheDocument());
  }

  it('uses the basename with the final extension stripped, and RE-derives when the file changes', async () => {
    mount();
    const ws = await ready();
    const [first] = panelsIn(ws).map((p) => p.id);

    await editorOn(first, 'C:/proj/foo.ts');
    await waitFor(() => expect(screen.getByTestId(`panel-title-${first}`)).toHaveTextContent('foo'));

    // The second half is the one that matters: a title computed once at type-time would pass the
    // first assertion and fail here.
    setEditorState(first, { filePath: 'C:/proj/bar.md' });
    await waitFor(() => expect(screen.getByTestId(`panel-title-${first}`)).toHaveTextContent('bar'));
  });

  it('lets a manual rename WIN, even when another file is opened afterwards', async () => {
    mount();
    const ws = await ready();
    const [first] = panelsIn(ws).map((p) => p.id);
    await editorOn(first, 'C:/proj/foo.ts');
    await waitFor(() => expect(screen.getByTestId(`panel-title-${first}`)).toHaveTextContent('foo'));

    live().renamePanel(first, 'Scratch');
    await waitFor(() =>
      expect(screen.getByTestId(`panel-title-${first}`)).toHaveTextContent('Scratch'),
    );

    setEditorState(first, { filePath: 'C:/proj/baz.ts' });
    // Still Scratch. A user's name survives a change of file — that is the whole of #97.
    await waitFor(() =>
      expect(screen.getByTestId(`panel-title-${first}`)).toHaveTextContent('Scratch'),
    );
    expect(screen.getByTestId(`panel-title-${first}`)).not.toHaveTextContent('baz');
  });

  it('restores the CURRENT file’s name on Reset Name, not the one it was renamed from', async () => {
    mount();
    const ws = await ready();
    const [first] = panelsIn(ws).map((p) => p.id);
    await editorOn(first, 'C:/proj/foo.ts');
    live().renamePanel(first, 'Scratch');
    setEditorState(first, { filePath: 'C:/proj/baz.ts' });
    await waitFor(() =>
      expect(screen.getByTestId(`panel-title-${first}`)).toHaveTextContent('Scratch'),
    );

    live().resetPanelName(first);

    // `baz`, not `foo`. Reset restores the AUTOMATIC name, which is recomputed from the file open
    // now — a reset that restored the pre-rename string would give the old file's name.
    await waitFor(() => expect(screen.getByTestId(`panel-title-${first}`)).toHaveTextContent('baz'));
  });

  it('never folds dirtiness into the name — the dot sits beside the title, not inside it', async () => {
    mount();
    const ws = await ready();
    const [first] = panelsIn(ws).map((p) => p.id);
    await editorOn(first, 'C:/proj/baz.ts');
    await waitFor(() => expect(screen.getByTestId(`panel-title-${first}`)).toHaveTextContent('baz'));

    setEditorState(first, { filePath: 'C:/proj/baz.ts', dirty: true });

    await waitFor(() => expect(screen.getByTestId(`panel-unsaved-${first}`)).toBeVisible());
    // The migrated test asserted the title was still "baz", which a title reading "baz •" fails.
    // This says it more directly: the mark is a SIBLING of the title element, not a child of it.
    const title = screen.getByTestId(`panel-title-${first}`);
    expect(title).toHaveTextContent('baz');
    expect(title.querySelector('.throng-unsaved-dot')).toBeNull();
    expect(screen.getByTestId(`panel-unsaved-${first}`).parentElement).toBe(title.parentElement);
  });
});

describe('Reset Name is disabled until there is something to reset (FR-017)', () => {
  it('is disabled on a panel that was never renamed, and enabled after one', async () => {
    /*
     * The migrated tests each opened the header's context menu twice to read this — once before the
     * rename and once after. The menu is BUILT by `panelHeaderMenu`, whose sections are covered by
     * `unit/menu-sections.test.ts`; what nothing covered is the one line that decides the state,
     * `panel-header-menu.ts:111`: `disabled: !(panel.titleIsCustom ?? false)`.
     *
     * Read from the builder rather than from a rendered menu, because that is where the rule is and
     * because a rendered menu would put this test's outcome at the mercy of the menu's own layout.
     */
    mount();
    const ws = await ready();
    const [first] = panelsIn(ws).map((p) => p.id);

    const resetItem = (): { disabled?: boolean } | undefined => {
      const panel = panelsIn(live()).find((p) => p.id === first) as Panel;
      return panelHeaderMenu({
        panel,
        panelVerb: 'Destroy',
        keybindings: DEFAULT_KEYBINDINGS,
        otherTabs: [],
        editor: null,
        editorFailure: false,
        detach: null,
        actions: resetOnlyActions,
      }).find((i) => i.label === 'Reset Name');
    };

    expect(resetItem()?.disabled).toBe(true);

    live().renamePanel(first, 'Scratch');
    await waitFor(() =>
      expect(panelsIn(live()).find((p) => p.id === first)?.titleIsCustom).toBe(true),
    );

    expect(resetItem()?.disabled).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The removal VERB on the header's ✕
 * (011 FR-030/031, migrated from removal-verbs.e2e.ts:130)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The migrated test launched Electron and created a project to read one `title` attribute.
 *
 * The rule is `panel-placeholder.tsx:186` — `subWin !== null && originProject !== null ? 'Close' :
 * 'Destroy'` — and the main window has no sub-workspace, so a project-owned panel there always says
 * *Destroy*. That branch is what this asserts. The OTHER branch genuinely needs a second window and
 * stays where it is (`removal-verbs.e2e.ts:141`, `@reserve:window`): a project-owned panel viewed
 * inside a sub-workspace window is CLOSED there rather than destroyed, because only its own view
 * goes.
 *
 * `add` is asserted alongside it, unmigrated and unasked-for, because it is the control: both
 * buttons are glyphs with a title, and a test that read only the ✕ could not tell a correct title
 * from one applied to every button in the span.
 */
describe('the header’s ✕ names what it will do (migrated from removal-verbs.e2e.ts:130)', () => {
  it('says Destroy for a project-owned panel in the main window, on both the title and the label', async () => {
    mount();
    const ws = await ready();
    const [first] = panelsIn(ws).map((p) => p.id);

    const close = screen.getByTestId(`panel-close-${first}`);
    // The exact string, not a /destroy/i match. jest-dom's `toHaveAttribute` compares a STRING
    // where Playwright's takes a regex, so the migrated assertion failed loudly when copied across
    // — and the stricter form is the better one anyway: "contains the word destroy" is satisfied by
    // "Destroy panel?" and by "Do not destroy", and this is a label, not prose.
    expect(close).toHaveAttribute('title', 'Destroy panel');
    // The migrated test read the title only. FR-006d and issue #282 are both about a glyph whose
    // meaning lives in an attribute a screen reader may not use — so the accessible name is asserted
    // too, and it is the one that decides what gets read aloud.
    expect(close).toHaveAttribute('aria-label', 'Destroy panel');
    expect(close.getAttribute('title')).not.toMatch(/close/i);
  });

  it('is not the same string as the ADD button’s — the control', async () => {
    mount();
    const ws = await ready();
    const [first] = panelsIn(ws).map((p) => p.id);

    const add = screen.getByTestId(`panel-add-${first}`);
    const close = screen.getByTestId(`panel-close-${first}`);
    expect(add.getAttribute('title')).not.toBe(close.getAttribute('title'));
    expect(add).toHaveAttribute('title');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A name already taken elsewhere is ADJUSTED, and the user is told once
 * (024 follow-up, 030 FR-022/FR-023 — migrated from panel-name-unique.e2e.ts:130)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ WHAT THE DAEMON OWNS, AND WHAT THIS OWNS ══
 *
 * Whether `Build` is taken is the DAEMON's question — only it can see every project and every
 * sub-workspace, including projects that are not open — and it is answered by
 * `packages/daemon/tests/unit/panel-name-service.test.ts`, through the real RPC router against a
 * saved layout ("still adjusts against a REAL panel in another project"). The numbering rules are
 * `packages/core/tests/unit/unique-panel-name.test.ts`, twelve cases.
 *
 * What neither of those can see is what the WINDOW does with the answer, and until now nothing
 * could: `panel-name-adjusted` appeared in exactly two places in the repository — the component
 * that raises it, and the E2E that read it off a screen. Three separate claims lived there:
 *
 *   - the panel takes the GRANTED name, not the one that was asked for;
 *   - a notice is raised, once, as a warning — nothing was lost and there is nothing to decide;
 *   - and (FR-023) the sentence does NOT repeat the granted name, because the heading has just
 *     said it. That one is a wording rule the E2E never checked at all.
 */
describe('a rename whose name was taken elsewhere', () => {
  /** A daemon that grants `desired` unless it is `taken`, in which case it adjusts to `granted`. */
  function claimingDaemon(taken: string, granted: string) {
    const base = fakeDaemon();
    const claims: Array<{ panelId: string; desired: string }> = [];
    const bridge: ThrongBridge = {
      invoke<T>(method: string, params?: unknown): Promise<T> {
        if (method === PANEL_NAME_CLAIM_METHOD) {
          const p = params as { panelId: string; desired: string };
          claims.push(p);
          return Promise.resolve(
            (p.desired.trim().toLowerCase() === taken.toLowerCase()
              ? { granted, adjusted: true }
              : { granted: p.desired, adjusted: false }) as T,
          );
        }
        return base.bridge.invoke<T>(method, params);
      },
    };
    return { bridge, claims, saved: base.saved };
  }

  function mountWith(taken: string, grantedName: string) {
    const user = userEvent.setup();
    Reflect.set(window, 'throng', { panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn() } });
    const daemon = claimingDaemon(taken, grantedName);
    const services = servicesOver(daemon.bridge);
    render(
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
                createElement(ContextMenuProvider, null, createElement(Host, { tabIndex: 0 })),
              ),
            ),
          ),
        ),
      ),
    );
    return { user, daemon };
  }

  /** Start the rename the way the F2 chord does, then type a name and commit it. */
  async function renameTo(
    user: ReturnType<typeof userEvent.setup>,
    panelId: string,
    name: string,
  ): Promise<void> {
    act(() => {
      expect(requestPanelRename(panelId), 'no rename handler was registered').toBe(true);
    });
    const field = await screen.findByTestId(`panel-rename-input-${panelId}`);
    await user.clear(field);
    await user.type(field, name);
    await user.keyboard('{Enter}');
  }

  it('renames the panel to what the daemon GRANTED, not to what was asked for', async () => {
    const { user } = mountWith('Build', 'Build (2)');
    const ws = await ready();
    const panelId = panelsIn(ws)[0].id;

    await renameTo(user, panelId, 'Build');

    await waitFor(() =>
      expect(screen.getByTestId(`panel-title-${panelId}`)).toHaveTextContent('Build (2)'),
    );
  });

  it('raises ONE warning naming the panel, and says what was asked for', async () => {
    const { user } = mountWith('Build', 'Build (2)');
    const ws = await ready();
    const panelId = panelsIn(ws)[0].id;

    await renameTo(user, panelId, 'Build');

    const notice = await screen.findByTestId('panel-name-adjusted');
    expect(notice).toBeVisible();
    expect(screen.getAllByTestId('panel-name-adjusted')).toHaveLength(1);
    // The name the user typed is the fact still worth explaining.
    expect(notice.textContent ?? '').toContain('Build');
  });

  it('does NOT repeat the granted name in the sentence (030 FR-023)', async () => {
    /*
     * The claim the E2E never made, and the one most likely to regress: the heading already names
     * the panel by its granted name, so putting it in the sentence too is the stutter FR-023 exists
     * to stop. Asserted on the MESSAGE element specifically — asserting on the whole notice would be
     * satisfied by the heading and prove nothing.
     */
    const { user } = mountWith('Build', 'Build (2)');
    const ws = await ready();
    const panelId = panelsIn(ws)[0].id;

    await renameTo(user, panelId, 'Build');

    const notice = await screen.findByTestId('panel-name-adjusted');
    const message = notice.querySelector('.notice__message');
    expect(message, 'the notice must have a message element for this claim to mean anything')
      .toBeTruthy();
    expect(message?.textContent ?? '').toContain('Build');
    expect(message?.textContent ?? '').not.toContain('Build (2)');
  });

  it('raises NOTHING when the name was granted as asked', async () => {
    /*
     * The anti-vacuity control. A component that notified unconditionally would satisfy every
     * assertion above while warning the user about a rename that went exactly as they asked.
     */
    const { user } = mountWith('SomethingElse', 'SomethingElse (2)');
    const ws = await ready();
    const panelId = panelsIn(ws)[0].id;

    await renameTo(user, panelId, 'Build');

    await waitFor(() =>
      expect(screen.getByTestId(`panel-title-${panelId}`)).toHaveTextContent('Build'),
    );
    expect(screen.queryByTestId('panel-name-adjusted')).toBeNull();
  });

  it('tells the other windows the name that was GRANTED', async () => {
    /*
     * Clone-sync (003): the same Panel appears in its project and in every sub-workspace. Broadcast
     * the name the user typed instead of the one granted and those copies drift apart under a name
     * that is taken — which is the defect the daemon's adjustment exists to prevent, re-created one
     * layer up. The E2E ran in one window and could not see this.
     */
    const { user } = mountWith('Build', 'Build (2)');
    const ws = await ready();
    const panelId = panelsIn(ws)[0].id;

    await renameTo(user, panelId, 'Build');

    const notifyRenamed = (Reflect.get(window, 'throng') as { panel: { notifyRenamed: ReturnType<typeof vi.fn> } })
      .panel.notifyRenamed;
    await waitFor(() => expect(notifyRenamed).toHaveBeenCalledWith(panelId, 'Build (2)'));
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A header tooltip shows the TITLE, not a list of instructions
 * (017 / #57 — migrated from panel-tooltips.e2e.ts:49, :63, :131 — 035 T055)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ THE DEFECT #57 REPORTED ══
 *
 * A panel title is truncated with an ellipsis, so hovering it is the only way to read it in full —
 * and that tooltip was occupied by "Click: Activate · Drag: Move · …". The one piece of information
 * a tooltip exists to give was the one piece it withheld.
 *
 * ══ WHY THESE THREE CAME DOWN ══
 *
 * Each asserts a `title` ATTRIBUTE on a rendered element. The E2E opened an app, created a project
 * and read the attribute; two of the three then compared it against the panel's own rendered title,
 * which is a comparison between two things this component draws.
 *
 * `:95` is NOT here and stays end-to-end. Its "no native tooltip on the chip" half already moved to
 * `unit/tooltip-instructions.test.ts`, and what remains is that the tab popover appears only once
 * the pointer RESTS — a gesture nothing below that layer drives.
 */
describe('a panel header tooltip shows the title (#57)', () => {
  const handle = (panelId: string): HTMLElement => screen.getByTestId(`panel-handle-${panelId}`);
  const titleOf = (panelId: string): string =>
    screen.getByTestId(`panel-title-${panelId}`).textContent?.trim() ?? '';

  it('carries the panel’s OWN title, and not the instruction list', async () => {
    mount();
    const ws = await ready();
    const panelId = panelsIn(ws)[0].id;

    const shown = titleOf(panelId);
    expect(shown, 'the header must render a title for this to compare against').toBeTruthy();

    expect(handle(panelId)).toHaveAttribute('title', shown);
    expect(handle(panelId).getAttribute('title') ?? '').not.toContain('Click: Activate');
  });

  it('follows a RENAME — the tooltip is the only way to read a title too long for the header', async () => {
    /*
     * Migrated from `:63`. The E2E used a 54-character name so the header would ellipsize it; the
     * length is irrelevant to the claim, which is that the attribute tracks the title rather than
     * being captured once at mount. A shorter name makes the same point without depending on the
     * name-limit setting, which has its own coverage.
     */
    const { user } = mount();
    const ws = await ready();
    const panelId = panelsIn(ws)[0].id;

    act(() => {
      expect(requestPanelRename(panelId), 'no rename handler was registered').toBe(true);
    });
    const field = await screen.findByTestId(`panel-rename-input-${panelId}`);
    await user.clear(field);
    await user.type(field, 'Renamed');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(handle(panelId)).toHaveAttribute('title', 'Renamed'));
    // …and the rendered title and the tooltip still agree, which is the invariant rather than the
    // literal: a tooltip that stopped tracking would satisfy one of these and not both.
    expect(titleOf(panelId)).toBe('Renamed');
  });

  it('leaves the action controls their own naming titles (FR-010)', async () => {
    /*
     * Migrated from `:131`. #57 removed an INSTRUCTION list; it did not remove tooltips. The
     * add/close controls are themeable icon buttons whose meaning lives entirely in an attribute —
     * the constitution requires them to name their action — so a fix that stripped every `title`
     * would be a different bug wearing this one's clothes.
     */
    mount();
    const ws = await ready();
    const panelId = panelsIn(ws)[0].id;

    const add = screen.getByTestId(`panel-add-${panelId}`);
    expect(add.getAttribute('title') ?? '').toMatch(/.+/);
    expect(add.getAttribute('title') ?? '').not.toContain('Click: Activate');
  });

  it('no control in the header carries the instruction list — the rule, not three examples', async () => {
    /*
     * The sweep the E2E made across one window's DOM, made here across everything this component
     * renders. It is weaker than `unit/tooltip-instructions.test.ts`, which reads the SOURCE and so
     * sees tooltips this mount never draws — and it is kept anyway, because that guard proves the
     * strings do not exist while this proves what is actually rendered carries the right ones.
     */
    mount();
    await ready();

    const offenders = [...document.querySelectorAll('[title]')]
      .map((el) => el.getAttribute('title') ?? '')
      .filter((t) => t.includes('Click: Activate') || t.includes('Click: Switch'));

    expect(offenders, `these rendered tooltips are instruction lists: ${offenders.join(' | ')}`)
      .toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * context-menu.e2e.ts:171 — Send to Tab, end to end within the renderer
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * "Send to Tab" moves the panel to the chosen tab (005 FR-027).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/context-menu.e2e.ts:171` (035 T055).
 *
 * ══ BOTH ENDS PROVEN, THE MIDDLE NOT ══
 *
 * `movePanelToTab` is a pure layout operation and is covered in core
 * (`core/tests/unit/workspace-operations.test.ts:192`). The submenu's LIFECYCLE — that it opens, and
 * that a second opener closes it — is `component/context-menu-lifecycle.test.ts`, whose header says
 * in as many words that it leaves this claim alone because it "is workspace state".
 *
 * Between them sits `panel-header-menu.ts:270` — one arrow per other tab, each closing over that
 * tab's id — and nothing asserted it. A submenu that listed the tabs correctly and sent every one of
 * them to the FIRST id would render identically, and the E2E, which had exactly two tabs, is the
 * only thing that could have noticed. It would not have: with two tabs, "the first other tab" and
 * "the tab I clicked" are the same tab.
 *
 * So the migration adds the case the E2E's own fixture could not make. Three tabs, send to the
 * third.
 */
describe('Send to Tab moves the panel to the chosen tab (FR-027)', () => {
  const handleOf = (panelId: string): HTMLElement =>
    screen.getByTestId(`panel-handle-${panelId}`);

  /** Right-click the panel header and open the Send to Tab flyout. */
  async function sendToTabFlyout(
    user: ReturnType<typeof userEvent.setup>,
    panelId: string,
  ): Promise<HTMLElement> {
    await user.pointer({ keys: '[MouseRight]', target: handleOf(panelId) });
    await user.click(await screen.findByTestId('menu-item-Send to Tab'));
    return screen.findByTestId('submenu-Send to Tab');
  }

  /**
   * Add `n` tabs to the loaded layout, clearing the rename each brings with it.
   *
   * The ACTION is outside the `waitFor`, deliberately. `waitFor` re-runs its callback until the
   * assertion passes, so a callback that also CALLS `addTab()` adds one tab per retry — two
   * requested tabs arrived as four, measured, and the count assertion below still passed because it
   * only ever checked the last one. Separating them is the fix and the reason it is written down.
   */
  async function addTabs(n: number): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      const before = (live().layout as WorkspaceLayout).tabs.length;
      act(() => live().addTab());
      await waitFor(() =>
        expect((live().layout as WorkspaceLayout).tabs).toHaveLength(before + 1),
      );
      live().clearLastAddedPanel();
    }
  }

  it('lists the OTHER tabs, and New Tab — never the tab the panel is already in', async () => {
    const { user } = mount();
    const ws = await ready();
    const panelId = panelsIn(ws)[0].id;
    const ownTab = tabOf(live()).title;
    await addTabs(2);

    const flyout = await sendToTabFlyout(user, panelId);
    /*
     * The icon's glyph is part of `textContent` — every row here carries one, and `New Tab`'s is the
     * same ＋ the Projects pane uses. So the label is read from the row's own label element rather
     * than from its whole text, which is the distinction `projects-panel-form.test.ts` had to make
     * for the same reason.
     */
    const labels = [...flyout.querySelectorAll('.context-menu__item')].map(
      (el) => el.querySelector('.context-menu__label')?.textContent?.trim() ?? el.textContent?.trim() ?? '',
    );

    expect(labels[0], 'New Tab is the drag-onto-the-plus equivalent and comes first').toBe('New Tab');
    expect(labels).toHaveLength(3); // New Tab + the two others
    expect(labels.filter((l) => l === ownTab)).toEqual([]);
  });

  it('moves the panel into the tab that was CHOSEN, not the first one offered', async () => {
    /*
     * THE CASE THE E2E COULD NOT MAKE. It had two tabs, so "the first other tab" and "the tab I
     * clicked" were the same tab — a submenu that sent every entry to the first id would have passed
     * it, and the panel would land in the wrong tab for every user with three.
     */
    const { user } = mount();
    const ws = await ready();
    const panelId = panelsIn(ws)[0].id;
    await addTabs(2);

    const third = (live().layout as WorkspaceLayout).tabs[2];
    const flyout = await sendToTabFlyout(user, panelId);
    await user.click(within(flyout).getByTestId(`menu-item-${third.title}`));

    await waitFor(() => {
      const layout = live().layout as WorkspaceLayout;
      const landed = layout.tabs.find((t) =>
        collectPanels(t.root).some((p) => p.id === panelId),
      );
      expect(landed?.id, 'the panel must be in the tab that was clicked').toBe(third.id);
    });
  });

  it('takes the panel OUT of the tab it came from', async () => {
    // A "move" that copied would leave the panel in both, which looks correct from the destination.
    const { user } = mount();
    const ws = await ready();
    const panelId = panelsIn(ws)[0].id;
    const sourceTab = tabOf(live()).id;
    await addTabs(2);

    const third = (live().layout as WorkspaceLayout).tabs[2];
    const flyout = await sendToTabFlyout(user, panelId);
    await user.click(within(flyout).getByTestId(`menu-item-${third.title}`));

    await waitFor(() => {
      const layout = live().layout as WorkspaceLayout;
      const source = layout.tabs.find((t) => t.id === sourceTab);
      expect(
        source ? collectPanels(source.root).some((p) => p.id === panelId) : false,
        'the panel is still in the tab it was sent from',
      ).toBe(false);
    });
  });
});
