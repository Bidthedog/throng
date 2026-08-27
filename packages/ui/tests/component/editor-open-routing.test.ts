/**
 * WHERE a file opens — the routing behind every open gesture (006 US2/US9, FR-010/011a, 018, 033 US7).
 *
 * PLACE AT: `packages/ui/tests/component/editor-open-routing.test.ts`
 * NEW COVERAGE (035). `openFileInTab` and `openFileInPanel` had **no test at any layer**: a repo-wide
 * search for either name found one file, `editor-cross-project-restore.e2e.ts`, and that spec is
 * about restoring across projects rather than about routing.
 *
 * ══ WHY THIS FILE EXISTS AT ALL ══
 *
 * 035's census marked seven `quick-open.e2e.ts` tests, three `os-drop.e2e.ts` tests and four
 * `tree-drop-open.e2e.ts` tests as MOVE-COMPONENT, and every one of them was blocked on the same
 * missing thing: a place to assert *which panel got the file* without launching Electron.
 *
 * They all looked like rendering claims because the E2E could only observe them through a rendered
 * editor — `await expect(win.getByTestId('editor-' + pid)).toBeVisible()`. They are not. The
 * decisions live in `editor-open.tsx` and are pure routing over the workspace layout and two module
 * registries. **No CodeMirror is mounted here and none is needed**, which is why this reaches
 * claims the E2E stated but could not isolate: an E2E that sees an editor appear cannot tell you
 * whether it was the LAST ACTIVE one or merely the first one found.
 *
 * ══ THE TWO ROUTES ARE DELIBERATELY DIFFERENT, AND THAT IS THE POINT ══
 *
 * `openFileInTab` serves the TREE: the user asked for a file, not for a place, so it routes to the
 * tab's last active editor. `openFileInPanel` serves a DROP: a gesture *at a place*, so it must use
 * the panel dropped on and ignore whatever was focused a minute ago. `editor-open.tsx:152` says so
 * in as many words. Nothing tested that they actually differ — and a `openFileInPanel` that quietly
 * delegated to `openFileInTab` would satisfy every E2E in the suite, because in each of them the
 * dropped-on panel *was* the last active one.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * In `mount()`, remove the `WorkspaceProvider` element and render its child directly. `useWorkspace`
 * throws outside a provider, so the probe never captures a store and **every test fails** at
 * `await ready()`. That matters here because several tests assert an ABSENCE (no second panel, no
 * open call) and an empty workspace would satisfy those for free — so each one first asserts the
 * layout it expects to act on.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectPanels, createDefaultLayout, type WorkspaceLayout } from '@throng/core';
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
import {
  registerEditorActions,
  unregisterEditorActions,
  type EditorActions,
} from '../../src/renderer/editor/editor-actions.js';
import { setLastActiveEditor, forgetEditor } from '../../src/renderer/editor/last-active-editor.js';
import { useUnsavedOpenRequest, type UnsavedOpenChoice } from '../../src/renderer/editor/unsaved-open-store.js';
import { openFileInTab, openFileInPanel, EditorOpenListener } from '../../src/renderer/editor/editor-open.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';

const PROJECT = 'project-1';
const FILE_A = 'D:/proj/a.txt';
const FILE_B = 'D:/proj/b.txt';

type Ws = ReturnType<typeof useWorkspace>;

/* ────────────────────────────────────────────────────────────────────────── *
 * The daemon, as far as the workspace store can tell
 * ────────────────────────────────────────────────────────────────────────── */

function fakeServices(): Services {
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      switch (method) {
        case 'workspace.load':
          // The DAEMON synthesises the default layout, not the store — `workspace-store.tsx:252`
          // does a bare `setLayout(result.layout)`. Returning null here leaves the store with no
          // layout at all, which every test then fails on at `ready()` rather than mid-assertion.
          return Promise.resolve({
            layout: createDefaultLayout(PROJECT, { tab: 'tab-1', panel: 'panel-1' }),
            restored: true,
          } as TResult);
        case 'workspace.save':
          return Promise.resolve({ ok: true } as TResult);
        // 041 — `ProjectsProvider` joined the tree so a refused open can name the project its notice
        // is about. It reads this on mount, and the default `{}` below leaves `projects` undefined,
        // which the store then calls `.find` on. One project, matching the layout's.
        case 'projects.list':
          return Promise.resolve({
            projects: [{ id: PROJECT, name: 'Proj', rootFolder: 'D:/proj' }],
          } as TResult);
        case 'document.pruneMissing':
          return Promise.resolve({ pruned: 0 } as TResult);
        case 'fileopUndo.get':
          return Promise.resolve({ stackJson: null } as TResult);
        case 'panelName.request':
          return Promise.resolve({ granted: (params as { name?: string })?.name ?? 'Panel' } as TResult);
        default:
          return Promise.resolve({} as TResult);
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

/* ────────────────────────────────────────────────────────────────────────── *
 * Mounting
 * ────────────────────────────────────────────────────────────────────────── */

interface Captured {
  ws: Ws | null;
  prompt: ReturnType<typeof useUnsavedOpenRequest>;
}

const captured: Captured = { ws: null, prompt: null };

/** Captures the live workspace store and any pending unsaved-open prompt for the tests to drive. */
function Probe(): ReactElement {
  const ws = useWorkspace();
  const prompt = useUnsavedOpenRequest();
  useEffect(() => {
    captured.ws = ws;
  }, [ws]);
  captured.prompt = prompt;
  return createElement('div', { 'data-testid': 'probe' });
}

/** The panels registered as live editors in this test, so `afterEach` can clear the module registry. */
const registered = new Set<string>();

function asEditor(panelId: string, over: Partial<EditorActions> = {}): { openFile: ReturnType<typeof vi.fn> } {
  const openFile = vi.fn(() => Promise.resolve());
  registerEditorActions(panelId, {
    save: () => Promise.resolve(true),
    saveAs: () => Promise.resolve(true),
    isDirty: () => false,
    openFile,
    revert: () => {},
    reloadFromDisk: () => Promise.resolve(true),
    ...over,
  } as EditorActions);
  registered.add(panelId);
  return { openFile };
}

function mount(): void {
  // `openInto` is the app-wide one-buffer oracle (FR-011a). Default: this file is open nowhere.
  Reflect.set(window, 'throng', {
    editor: { openInto: () => Promise.resolve({ action: 'open' }) },
    panel: { notifyTyped: () => {} },
  });

  const services = fakeServices();
  // ANTI-VACUITY CONTROL: drop this WorkspaceProvider element and every test fails at ready().
  render(
    createElement(
      ServicesProvider,
      { services },
      createElement(
        WorkspaceProvider,
        { client: services.workspace, activeProjectId: PROJECT },
        createElement(NotificationProvider, null, createElement(Probe, null)),
      ),
    ),
  );
}

/** The store, once it has loaded a layout. */
async function ready(): Promise<Ws> {
  await waitFor(() => {
    expect(captured.ws?.layout).toBeTruthy();
  });
  return live();
}

/**
 * The CURRENT store, re-read from the probe.
 *
 * The value `ready()` returned is a snapshot: every store operation renders a new context value
 * carrying a new layout, and the old reference keeps reporting the layout as it was. Reading through
 * a stale `ws` cost two red tests here — both reporting zero editors immediately after one had been
 * created — so nothing below holds a store across a mutation.
 */
const live = (): Ws => captured.ws as Ws;

const layoutOf = (ws: Ws): WorkspaceLayout => ws.layout as WorkspaceLayout;
const tabOf = (ws: Ws, i = 0) => layoutOf(ws).tabs[i];
const panelsIn = (ws: Ws, i = 0) => collectPanels(tabOf(ws, i).root);
const editorPanels = (ws: Ws, i = 0) => panelsIn(ws, i).filter((p) => p.kind === 'editor');

beforeEach(() => {
  captured.ws = null;
  captured.prompt = null;
});

afterEach(() => {
  for (const id of registered) {
    unregisterEditorActions(id);
    forgetEditor(id);
  }
  registered.clear();
  Reflect.deleteProperty(window, 'throng');
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The one-buffer rule
 * ────────────────────────────────────────────────────────────────────────── */

describe('a file already open somewhere is focused, never opened twice (FR-011a)', () => {
  it('focuses the holding panel and creates no second editor', async () => {
    // The claim behind `os-drop.e2e.ts:332` and `tree-drop-open.e2e.ts:89`. Both observed it as
    // "the editor count did not go up"; the count is a consequence, the focus is the behaviour.
    mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;
    const holder = panelsIn(ws)[0].id;
    act(() => ws.setPanelType(holder, 'editor', { filePath: FILE_A }));
    asEditor(holder);

    Reflect.set(window, 'throng', {
      editor: { openInto: () => Promise.resolve({ action: 'focus', panelId: holder }) },
      panel: { notifyTyped: () => {} },
    });

    const before = editorPanels(live()).length;
    expect(before).toBe(1); // the layout this test acts on, asserted before any absence claim

    await act(async () => {
      await openFileInTab(live(), tabId, FILE_A);
    });

    expect(editorPanels(live())).toHaveLength(before);
    expect(tabOf(live()).activePanelId).toBe(holder);
  });

  it('holds even for a DROP on a different panel — the gesture does not beat the rule', async () => {
    // `openFileInPanel` is the drop route and checks `openInto` FIRST, before it looks at the panel
    // it was aimed at. Without that a drop would happily open a second copy of a file the user
    // already has open elsewhere, which is the one thing FR-011a forbids.
    mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;
    const holder = panelsIn(ws)[0].id;
    act(() => ws.setPanelType(holder, 'editor', { filePath: FILE_A }));
    asEditor(holder);

    const droppedOn = act(() => captured.ws?.addPanel(tabId)) as unknown as string;
    const target = editorPanels(live()).length;
    void droppedOn;

    Reflect.set(window, 'throng', {
      editor: { openInto: () => Promise.resolve({ action: 'focus', panelId: holder }) },
      panel: { notifyTyped: () => {} },
    });
    const other = panelsIn(live()).find((p) => p.id !== holder);
    expect(other).toBeTruthy();
    const otherActions = asEditor(other!.id);

    await act(async () => {
      await openFileInPanel(live(), tabId, other!.id, FILE_A);
    });

    expect(otherActions.openFile).not.toHaveBeenCalled();
    expect(editorPanels(live())).toHaveLength(target);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Which editor a TREE open lands in
 * ────────────────────────────────────────────────────────────────────────── */

describe('openFileInTab routes to the tab’s editor (FR-010)', () => {
  it('creates the tab’s dedicated editor when the tab has none', async () => {
    mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;
    expect(editorPanels(ws)).toHaveLength(0);

    await act(async () => {
      await openFileInTab(live(), tabId, FILE_A);
    });

    const editors = editorPanels(live());
    expect(editors).toHaveLength(1);
    expect((editors[0].config as { filePath?: string }).filePath).toBe(FILE_A);
  });

  it('reuses the LAST ACTIVE editor, not merely the first one it finds', async () => {
    /*
     * The claim no E2E in this suite could make. Each of them had one editor in the tab, so "routed
     * to the last active editor" and "routed to the only editor" were indistinguishable — and an
     * implementation that took `editorsHere[0]` would have passed every one of them.
     */
    mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;

    const first = panelsIn(ws)[0].id;
    act(() => ws.setPanelType(first, 'editor', { filePath: FILE_A }));
    const firstActions = asEditor(first);

    let second = '';
    act(() => {
      second = (live()).addPanel(tabId);
    });
    act(() => (live()).setPanelType(second, 'editor', { filePath: FILE_B }));
    const secondActions = asEditor(second);

    // The SECOND one is where the user last was — and it is not `editorsHere[0]`.
    setLastActiveEditor(tabId, second);

    await act(async () => {
      await openFileInTab(live(), tabId, FILE_B);
    });

    expect(secondActions.openFile).toHaveBeenCalledWith(FILE_B);
    expect(firstActions.openFile).not.toHaveBeenCalled();
  });

  it('opens a NEW panel every time when the open target is "new" (033 US7, FR-072)', async () => {
    // The claim behind `quick-open.e2e.ts:386`.
    mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;
    const seed = panelsIn(ws)[0].id;
    act(() => ws.setPanelType(seed, 'editor', { filePath: FILE_A }));
    asEditor(seed);

    await act(async () => {
      await openFileInTab(live(), tabId, FILE_B, 'new');
    });
    await act(async () => {
      await openFileInTab(live(), tabId, FILE_B, 'new');
    });

    // Two opens, two new panels — the seed plus one each.
    expect(editorPanels(live())).toHaveLength(3);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Which editor a DROP lands in
 * ────────────────────────────────────────────────────────────────────────── */

describe('openFileInPanel honours the place the user pointed at (018)', () => {
  it('opens into the panel dropped on, NOT the tab’s last active editor', async () => {
    /*
     * The distinction `editor-open.tsx:152` exists for, and the one an E2E structurally cannot make:
     * in every E2E drop test the dropped-on panel WAS the last active one, so a `openFileInPanel`
     * that simply delegated to `openFileInTab` would have passed all of them.
     */
    mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;

    const lastActive = panelsIn(ws)[0].id;
    act(() => ws.setPanelType(lastActive, 'editor', { filePath: FILE_A }));
    const lastActiveActions = asEditor(lastActive);

    let dropped = '';
    act(() => {
      dropped = (live()).addPanel(tabId);
    });
    act(() => (live()).setPanelType(dropped, 'editor', { filePath: FILE_A }));
    const droppedActions = asEditor(dropped);

    setLastActiveEditor(tabId, lastActive); // focus is elsewhere…

    await act(async () => {
      await openFileInPanel(live(), tabId, dropped, FILE_B); // …but the drop was HERE
    });

    expect(droppedActions.openFile).toHaveBeenCalledWith(FILE_B);
    expect(lastActiveActions.openFile).not.toHaveBeenCalled();
    expect(tabOf(live()).activePanelId).toBe(dropped);
  });

  it('falls back to the tab route when the panel is not an editor, rather than dropping the file', async () => {
    // The claim behind `tree-drop-open.e2e.ts:64` and `os-drop.e2e.ts:171` — an UNTYPED panel
    // becomes an editor showing the file. The E2E saw an editor appear; this says where it came
    // from, which is the fallback at `editor-open.tsx:176`.
    mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;
    const untyped = panelsIn(ws)[0].id;
    expect(editorPanels(ws)).toHaveLength(0);

    await act(async () => {
      await openFileInPanel(live(), tabId, untyped, FILE_A);
    });

    const editors = editorPanels(live());
    expect(editors).toHaveLength(1);
    expect((editors[0].config as { filePath?: string }).filePath).toBe(FILE_A);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Unsaved work is never discarded by a gesture
 * ────────────────────────────────────────────────────────────────────────── */

describe('the open-target preference reaches the routing (US7 / #141)', () => {
  /*
   * MIGRATED FROM `packages/ui/tests/e2e/editor-open-target.e2e.ts` — both tests, file deleted
   * (035 FR-001).
   *
   * Those two launched Electron, one of them seeding a `settings.json` before launch, created a
   * real project with two real files, and clicked them in the tree — to count editor panels. The
   * counting was never the claim; the claim is that `editor.openTarget` reaches
   * `openFileInTab`'s fourth argument, and the panel count is how an E2E is forced to observe it.
   *
   * `EditorOpenListener` is the whole of that wiring: it reads the setting through
   * `useAppSettings()` and hands it to `openFileIntoEditor`, which routes to the active tab. Driving
   * its `throng:open-file` event with the setting supplied through `ConfigProvider` asserts the same
   * thing one process cheaper — and asserts it on the ROUTE rather than on a rendered side effect,
   * so a regression says which of the two it was.
   */
  function withSetting(openTarget: 'new' | 'lastActive') {
    const svc = fakeServices();
    Reflect.set(window, 'throng', {
      editor: { openInto: () => Promise.resolve({ action: 'open' }) },
      panel: { notifyTyped: () => {} },
      config: {
        get: () => Promise.resolve({ settings: { editor: { openTarget } } }),
        onChange: () => () => {},
      },
    });
    render(
      createElement(
        ServicesProvider,
        { services: svc },
        createElement(
          ConfigProvider,
          null,
          // 041 — `ProjectsProvider` joins the tree because `EditorOpenListener` now turns a refused
          // open into a notice (FR-014), and naming the project it is about means reading the project
          // list. The real app has had this provider above everything since the composition root; this
          // hand-built tree simply had not needed it before.
          createElement(
            ProjectsProvider,
            { client: svc.projects },
            createElement(
              WorkspaceProvider,
              { client: svc.workspace, activeProjectId: PROJECT },
              createElement(
                NotificationProvider,
                null,
                createElement('div', null, createElement(Probe, null), createElement(EditorOpenListener, null)),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /** The intent the file tree raises when a file is clicked. */
  async function openFromTree(absPath: string): Promise<void> {
    await act(async () => {
      window.dispatchEvent(new CustomEvent('throng:open-file', { detail: { absPath } }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('with "New Editor", each opened file lands in a NEW panel', async () => {
    withSetting('new');
    await ready();
    const seed = panelsIn(live())[0].id;
    act(() => live().setPanelType(seed, 'editor', { filePath: FILE_A }));
    asEditor(seed);

    await openFromTree(FILE_A);
    await openFromTree(FILE_B);

    // The seeded editor plus one new panel per open.
    expect(editorPanels(live())).toHaveLength(3);
  });

  it('with "Last Active Editor" (the default), opens REUSE one editor', async () => {
    withSetting('lastActive');
    await ready();
    const seed = panelsIn(live())[0].id;
    act(() => live().setPanelType(seed, 'editor', { filePath: FILE_A }));
    const actions = asEditor(seed);

    await openFromTree(FILE_B);

    expect(editorPanels(live()), 'no second editor was created').toHaveLength(1);
    expect(actions.openFile, 'the existing editor was pointed at the new file').toHaveBeenCalledWith(
      FILE_B,
    );
  });
});

describe('a dirty target is asked about first (US9)', () => {
  /** Answer the pending prompt, once it exists. */
  async function answer(choice: UnsavedOpenChoice): Promise<void> {
    await waitFor(() => expect(captured.prompt).toBeTruthy());
    await act(async () => {
      captured.prompt?.resolve(choice);
    });
  }

  it('cancel leaves the buffer alone and opens nothing', async () => {
    mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;
    const dirty = panelsIn(ws)[0].id;
    act(() => ws.setPanelType(dirty, 'editor', { filePath: FILE_A }));
    const actions = asEditor(dirty, { isDirty: () => true });

    const before = editorPanels(live()).length;
    const open = openFileInPanel(live(), tabId, dirty, FILE_B);
    await answer('cancel');
    await act(async () => {
      await open;
    });

    expect(actions.openFile).not.toHaveBeenCalled();
    expect(editorPanels(live())).toHaveLength(before);
  });

  it('"new" opens the file in a fresh panel and leaves the dirty one untouched', async () => {
    mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;
    const dirty = panelsIn(ws)[0].id;
    act(() => ws.setPanelType(dirty, 'editor', { filePath: FILE_A }));
    const actions = asEditor(dirty, { isDirty: () => true });

    const open = openFileInPanel(live(), tabId, dirty, FILE_B);
    await answer('new');
    await act(async () => {
      await open;
    });

    expect(actions.openFile).not.toHaveBeenCalled();
    const editors = editorPanels(live());
    expect(editors).toHaveLength(2);
    expect(editors.some((p) => (p.config as { filePath?: string }).filePath === FILE_B)).toBe(true);
  });

  it('a failed save does NOT then replace the document', async () => {
    /*
     * Never asserted anywhere. `editor-open.tsx:137` returns early when `save()` resolves false,
     * and the whole point is that a save which failed or was cancelled must not be followed by the
     * open it was meant to make safe. An implementation that ignored the result would lose the
     * user's work at exactly the moment they asked to keep it.
     */
    mount();
    const ws = await ready();
    const tabId = tabOf(ws).id;
    const dirty = panelsIn(ws)[0].id;
    act(() => ws.setPanelType(dirty, 'editor', { filePath: FILE_A }));
    const actions = asEditor(dirty, { isDirty: () => true, save: () => Promise.resolve(false) });

    const open = openFileInPanel(live(), tabId, dirty, FILE_B);
    await answer('save');
    await act(async () => {
      await open;
    });

    expect(actions.openFile).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A drop on an UNTYPED panel types it, with no detour through the form
 * (018 US9 / FR-056, migrated from os-drop.e2e.ts:170)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The migrated test launched Electron, made a real project on a real temp root, waited for the
 * explorer, then dispatched a `throng:os-drop` CustomEvent — a synthesised event, not an OS drag,
 * because Electron 43 removed `File.path` and a `File` built inside a renderer is not an OS file.
 * So the drag was never real there either; what it bought over this was the Electron process.
 *
 * The drop half — that the event reaches exactly one panel, that main resolves the path, and that
 * the RESOLVED path is what gets opened — is `component/os-drop-refusal.test.ts`. This is the other
 * half: what `panel-body.tsx`'s `openAsEditor` does with the path it is handed, which is to type the
 * panel directly rather than to reveal the type-selection form pointed at a file.
 *
 * ONE LINE REMAINS UNASSERTED ANYWHERE, and it is named rather than implied: `panel-body.tsx:219`
 * passes `openAsEditor` as `PanelDropTarget`'s `onOpen`. Typecheck constrains it to a path handler
 * and `os-drop-refusal.test.ts:276` proves the seam invokes whatever is passed, so what is left is
 * the identity of one prop. That is a smaller residue than an Electron launch buys back.
 */
describe('an OS drop types an untyped panel directly (migrated from os-drop.e2e.ts:170)', () => {
  it('makes the panel an editor pointed at the dropped file, leaving no untyped panel behind', async () => {
    mount();
    const ws = await ready();
    const target = panelsIn(ws)[0];
    // The panel starts untyped — the state the E2E asserted by finding `panel-type-form-<id>`.
    expect(target.kind).toBeUndefined();
    expect(editorPanels(ws)).toHaveLength(0);

    // `openAsEditor`'s whole body, minus the `notifyTyped` broadcast (another window's business).
    act(() => ws.setPanelType(target.id, 'editor', { filePath: FILE_A }));

    const typed = panelsIn(live()).find((p) => p.id === target.id);
    expect(typed?.kind).toBe('editor');
    expect(typed?.config?.filePath).toBe(FILE_A);
    // No SECOND panel: the drop converts the panel it landed on rather than opening a dedicated
    // editor beside it, which is what distinguishes a drop from a tree click (FR-010).
    expect(panelsIn(live())).toHaveLength(1);
    expect(editorPanels(live())).toHaveLength(1);
  });

  it('leaves an ALREADY-TYPED editor to the open path, not to a re-type', async () => {
    /*
     * Written first as "a second drop re-points the panel", and it failed — `setPanelType` does
     * NOT change `config.filePath` on a panel that already has a kind. That is not a defect, it is
     * the routing: `panel-body.tsx:219` wraps the TYPE FORM, so `openAsEditor` only ever serves an
     * untyped panel. A drop onto a live editor is `openFileInPanel` → `actions.openFile`, which
     * this file covers above (FR-011a, the dirty prompt, the one-buffer focus).
     *
     * Kept as an assertion rather than deleted, because the false version passed review in my head
     * and the true one is a boundary a future `openAsEditor` could quietly cross: typing a panel
     * that is already typed must not silently rewrite the document out from under its editor.
     */
    mount();
    const ws = await ready();
    const target = panelsIn(ws)[0];
    act(() => ws.setPanelType(target.id, 'editor', { filePath: FILE_A }));

    act(() => live().setPanelType(target.id, 'editor', { filePath: FILE_B }));

    expect(panelsIn(live())).toHaveLength(1);
    expect(panelsIn(live())[0]?.config?.filePath).toBe(FILE_A);
  });
});

/**
 * 041 US3 (#327) — A REFUSAL IS NOT A DOCUMENT.
 *
 * Opening a file throng will not open used to create a panel when no editor panel existed, show the
 * refusal inside it as a banner, and raise NO notification — leaving the user holding a panel for a
 * file that was never opened. With a panel already open, the same action correctly gave a
 * notification and no panel. One action, two outcomes, decided by unrelated workspace state.
 *
 * ══ WHY THESE ARE COMPONENT TESTS ══
 *
 * The claim is a panel count in the workspace store and a notice in the provider — neither crosses a
 * process boundary. This file already stubs `openInto` and asserts panel ABSENCE, which is the whole
 * reason it exists (see its header). Constitution V asks for the lowest layer that can prove it; what
 * genuinely needs main is only what `openInto` RETURNS, and that is an integration test.
 *
 * ══ THE ASSERTION THAT MATTERS MOST ══
 *
 * "Zero panels" alone is satisfied by doing nothing at all, so the notification is asserted beside
 * it. The failure this feature could most easily ship is turning "no panel is created" into "no panel
 * AND no notification" — which every panel-counting test on its own would call success.
 */
describe('a refused open creates no panel, and still tells the user (FR-013, FR-014)', () => {
  /** Mounts the listener too — it is what turns a published refusal into a notice. */
  function mountWithListener(decision: unknown): void {
    const svc = fakeServices();
    Reflect.set(window, 'throng', {
      editor: { openInto: () => Promise.resolve(decision) },
      panel: { notifyTyped: () => {} },
      osName: 'windows',
      notices: { log: () => {} },
      config: { get: () => Promise.resolve({ settings: {} }), onChange: () => () => {} },
    });
    render(
      createElement(
        ServicesProvider,
        { services: svc },
        createElement(
          ConfigProvider,
          null,
          createElement(
            ProjectsProvider,
            { client: svc.projects },
            createElement(
              WorkspaceProvider,
              { client: svc.workspace, activeProjectId: PROJECT },
              createElement(
                NotificationProvider,
                null,
                createElement('div', null, createElement(Probe, null), createElement(EditorOpenListener, null)),
              ),
            ),
          ),
        ),
      ),
    );
  }

  const REFUSED = 'D:/proj/big.bin';

  it.each([0, 1, 3])('creates no panel with %i editor panels already open (SC-004)', async (existing) => {
    mountWithListener({ action: 'open' });
    const ws = await ready();
    const tabId = tabOf(ws).id;

    // Build the layout this test acts on, and assert it BEFORE any absence claim — an empty
    // workspace would satisfy "no panel was created" for free.
    for (let i = 0; i < existing; i += 1) {
      const id = i === 0 ? panelsIn(live())[0]!.id : live().addPanel(tabId);
      act(() => live().setPanelType(id as string, 'editor', { filePath: `D:/proj/open-${i}.txt` }));
      asEditor(id as string);
    }
    expect(editorPanels(live())).toHaveLength(existing);

    Reflect.set(window, 'throng', {
      ...(window as unknown as { throng: Record<string, unknown> }).throng,
      editor: { openInto: () => Promise.resolve({ action: 'refuse', reason: 'too-large' }) },
    });
    await act(async () => {
      await openFileInTab(live(), tabId, REFUSED);
    });

    expect(
      editorPanels(live()),
      'a panel was created for a file throng refused to open',
    ).toHaveLength(existing);
  });

  it.each(['too-large', 'binary', 'out-of-tree', 'folder'])(
    'refuses %s the same way — the reason does not change the outcome (FR-013)',
    async (reason) => {
      mountWithListener({ action: 'refuse', reason });
      const ws = await ready();
      const before = editorPanels(ws).length;

      await act(async () => {
        await openFileInTab(live(), tabOf(live()).id, REFUSED);
      });

      expect(editorPanels(live())).toHaveLength(before);
    },
  );

  it('reports the refusal even though no panel exists to report it (FR-014)', async () => {
    // The guard against the silent-drop failure. `useReportPanelFailure` opens with
    // `if (!place) return`, so a refusal routed through it would vanish without a trace — and this
    // test is what makes shipping that impossible to do unnoticed.
    mountWithListener({ action: 'refuse', reason: 'too-large' });
    const ws = await ready();

    await act(async () => {
      await openFileInTab(live(), tabOf(ws).id, REFUSED);
    });

    await waitFor(() => {
      expect(
        screen.queryAllByTestId('panel-failure-notice').length,
        'no panel AND no notification — worse than the defect being fixed',
      ).toBeGreaterThan(0);
    });
  });

  it('creates no panel on a DROP either — every entry point, not just the tree (FR-013a)', async () => {
    mountWithListener({ action: 'refuse', reason: 'too-large' });
    const ws = await ready();
    const tabId = tabOf(ws).id;
    const target = panelsIn(ws)[0]!.id;
    const before = editorPanels(live()).length;

    await act(async () => {
      await openFileInPanel(live(), tabId, target, REFUSED);
    });

    expect(editorPanels(live())).toHaveLength(before);
  });

  it('still creates a panel for a MISSING file — 018 recovery is untouched (FR-015)', async () => {
    // The control, and the single highest-value assertion here. A missing file is NOT a refusal: its
    // panel is what holds the recovered buffer that can be saved back. If this ever goes green by
    // creating zero panels, 018's recovery path has been deleted with nothing near it failing.
    mountWithListener({ action: 'open' });
    const ws = await ready();
    const before = editorPanels(ws).length;

    await act(async () => {
      await openFileInTab(live(), tabOf(live()).id, 'D:/proj/gone.txt');
    });

    expect(editorPanels(live()).length, 'a missing file was treated as a refusal').toBe(before + 1);
  });
});
