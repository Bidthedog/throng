/**
 * 044 T113 — Open in Editor, a preview's route back to its source (FR-015b, FR-015c, FR-015d;
 * contracts/menus-and-controls.md §1, §4, §8). One label whether or not the preview is parented (v1 review, #732).
 *
 * ══ THE MIRROR OF OPEN PREVIEW ══
 *
 * An editor's Open Preview asks main and places a preview to the editor's RIGHT. A standalone preview's
 * Open in Editor does the reverse: it asks main's one-buffer oracle (`editor.openInto`) FIRST — the same
 * question every editor open asks, so a file already open in some editor is focused rather than opened
 * twice — and only on `open` splits the preview's slot with a new editor on the LEFT. The preview then
 * becomes parented in place (FR-013a), which is main's business and not asserted here.
 *
 * A parented preview's Open in Editor focuses the parent: its tab to the front, the panel active and
 * focused, and — through the same `openInto`, whose `focus` answer has main raise the window holding the
 * editor — its window.
 *
 * ══ WHAT IS REAL ══
 *
 * The first half drives the functions over core's real layout operations with a fake bridge, as
 * `open-preview.test.ts` does. The second mounts the panel and proves the three entry points — the status
 * bar's button, the body menu and the header menu — all reach the one function (FR-015b), observed at its
 * first step: the `openInto` question for the preview's file.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_KIND,
  addPanel as opAddPanel,
  addPanelBeside as opAddPanelBeside,
  collectPanels,
  createDefaultLayout,
  createPreviewProviderRegistry,
  effectiveActivePanelId,
  setActivePanel as opSetActivePanel,
  setActiveTab as opSetActiveTab,
  setPanelType as opSetPanelType,
  type LayoutNode,
  type Panel,
  type PanelConfig,
  type PanelKind,
  type WorkspaceLayout,
} from '@throng/core';
import type { PreviewPlacementWorkspace } from '../../src/renderer/preview/open-preview.js';
import { goToPreviewParent, openPreviewInEditor } from '../../src/renderer/preview/open-in-editor.js';
import { __resetPanelFocus, registerPanelFocus } from '../../src/renderer/workspace/panel-focus.js';
import { registerEditorActions, unregisterEditorActions, type EditorActions } from '../../src/renderer/editor/editor-actions.js';
import { setLastActiveEditor } from '../../src/renderer/editor/last-active-editor.js';
import { removeEditorState, setEditorState } from '../../src/renderer/editor/editor-state.js';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const PROJECT = 'proj-1';
const FILE = 'D:/proj/notes.prvtxt';

/* ── A workspace store over core's real operations (as open-preview.test.ts) ─────────────────── */

const panel = (id: string, over: Partial<Panel> = {}): Panel => ({
  type: 'panel',
  id,
  originProjectId: PROJECT,
  title: `Panel ${id}`,
  ...over,
});

/** Tab 1 in front holds a terminal; Tab 2 holds [other | preview], and optionally the parent editor. */
function layoutWith(opts: { parentInBackground?: boolean } = {}): WorkspaceLayout {
  const base = createDefaultLayout(PROJECT, { tab: 't1', panel: 'front' });
  const children: LayoutNode[] = [panel('other'), panel('pv', { kind: PREVIEW_KIND, config: { filePath: FILE } })];
  return {
    ...base,
    tabs: [
      { id: 't1', title: 'Tab 1', root: panel('front', { kind: 'terminal' }) },
      { id: 't2', title: 'Tab 2', root: { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children } },
      ...(opts.parentInBackground
        ? [{ id: 't3', title: 'Tab 3', root: panel('ed', { kind: 'editor', config: { filePath: FILE } }) }]
        : []),
    ],
    activeTabId: 't2',
  };
}

function fakeWs(initial: WorkspaceLayout) {
  let layout = initial;
  let next = 0;
  const calls: string[] = [];
  const beside: { targetId: string; edge: 'left' | 'right' }[] = [];
  const ws: PreviewPlacementWorkspace & { calls: string[]; beside: typeof beside } = {
    calls,
    beside,
    get layout() {
      return layout;
    },
    addPanel(tabId: string): string {
      calls.push('addPanel');
      const id = `new-${++next}`;
      layout = opAddPanel(layout, tabId, id);
      return id;
    },
    addPanelBeside(targetId: string, edge: 'left' | 'right'): string | null {
      calls.push('addPanelBeside');
      beside.push({ targetId, edge });
      const target = layout.tabs.flatMap((t) => collectPanels(t.root)).find((p) => p.id === targetId);
      if (!target) return null;
      const id = `new-${++next}`;
      layout = opAddPanelBeside(layout, targetId, edge, panel(id, { originProjectId: target.originProjectId }));
      return id;
    },
    setPanelType(panelId: string, kind: PanelKind, config: PanelConfig): void {
      calls.push('setPanelType');
      layout = opSetPanelType(layout, panelId, kind, config);
    },
    setActiveTab(tabId: string): void {
      calls.push('setActiveTab');
      layout = opSetActiveTab(layout, tabId);
    },
    setActivePanel(tabId: string, panelId: string): void {
      calls.push('setActivePanel');
      layout = opSetActivePanel(layout, tabId, panelId);
    },
  };
  return ws;
}

const allPanels = (l: WorkspaceLayout): Panel[] => l.tabs.flatMap((t) => collectPanels(t.root) as Panel[]);

type OpenIntoAnswer =
  | { action: 'focus'; panelId: string; windowId: string }
  | { action: 'open' }
  | { action: 'refuse'; reason: string };
const bridgeAnswering = (answer: OpenIntoAnswer) => ({ openInto: vi.fn(() => Promise.resolve(answer)) });

let focused: string[];
const watchFocus = (...ids: string[]): void => {
  for (const id of ids) registerPanelFocus(id, () => focused.push(id));
};

beforeEach(() => {
  focused = [];
  Reflect.set(window, 'throng', { panel: { notifyTyped: vi.fn() } });
});
afterEach(() => {
  __resetPanelFocus();
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

/* ── Open in Editor (FR-015c) ─────────────────────────────────────────────────────────────────── */

describe('Open in Editor asks editor.openInto first (FR-015c, one buffer)', () => {
  it('asks about the preview’s file, as the preview’s project', async () => {
    const ws = fakeWs(layoutWith());
    const bridge = bridgeAnswering({ action: 'open' });

    await openPreviewInEditor({ ws, bridge, previewPanelId: 'pv', filePath: FILE, projectId: PROJECT });

    expect(bridge.openInto).toHaveBeenCalledTimes(1);
    expect(bridge.openInto).toHaveBeenCalledWith({ absPath: FILE, ownerKind: 'project', ownerProjectId: PROJECT });
  });

  it('`focus` — the file is open in an editor already: nothing is placed, that editor is focused', async () => {
    const ws = fakeWs(layoutWith({ parentInBackground: true }));
    const before = allPanels(ws.layout as WorkspaceLayout).map((p) => p.id);
    watchFocus('ed');

    const outcome = await openPreviewInEditor({
      ws,
      bridge: bridgeAnswering({ action: 'focus', panelId: 'ed', windowId: 'w1' }),
      previewPanelId: 'pv',
      filePath: FILE,
      projectId: PROJECT,
    });

    expect(outcome).toEqual({ kind: 'focused', panelId: 'ed' });
    expect(allPanels(ws.layout as WorkspaceLayout).map((p) => p.id)).toEqual(before);
    expect(ws.calls).not.toContain('addPanelBeside');
    expect(ws.calls).not.toContain('setPanelType');
    expect(focused).toEqual(['ed']);
  });

  it('`open` — a new editor splits the preview’s slot on its LEFT, typed to the file, active and focused', async () => {
    const ws = fakeWs(layoutWith());
    watchFocus('new-1');

    const outcome = await openPreviewInEditor({
      ws,
      bridge: bridgeAnswering({ action: 'open' }),
      previewPanelId: 'pv',
      filePath: FILE,
      projectId: PROJECT,
    });

    expect(outcome).toEqual({ kind: 'opened', panelId: 'new-1' });
    expect(ws.beside).toEqual([{ targetId: 'pv', edge: 'left' }]);
    const l = ws.layout as WorkspaceLayout;
    const t2 = l.tabs.find((t) => t.id === 't2');
    // [other, editor, preview] — the editor immediately to the preview's left.
    expect(collectPanels(t2!.root).map((p) => p.id)).toEqual(['other', 'new-1', 'pv']);
    expect(allPanels(l).find((p) => p.id === 'new-1')).toMatchObject({ kind: 'editor', config: { filePath: FILE } });
    expect(effectiveActivePanelId(t2!)).toBe('new-1');
    expect(focused).toEqual(['new-1']);
    // Mirrored to other windows, as every created panel is.
    expect((window.throng as unknown as { panel: { notifyTyped: ReturnType<typeof vi.fn> } }).panel.notifyTyped).toHaveBeenCalledWith(
      'new-1',
      'editor',
      { filePath: FILE },
    );
  });

  it('`refuse` — throng will not open this file: nothing is placed', async () => {
    const ws = fakeWs(layoutWith());
    const outcome = await openPreviewInEditor({
      ws,
      bridge: bridgeAnswering({ action: 'refuse', reason: 'too-large' }),
      previewPanelId: 'pv',
      filePath: FILE,
      projectId: PROJECT,
    });
    expect(outcome).toEqual({ kind: 'refused', reason: 'too-large' });
    expect(ws.calls).not.toContain('addPanelBeside');
  });
});

/* ── Go to Editor (FR-015d) ───────────────────────────────────────────────────────────────────── */

describe('Go to Editor focuses the parent, its tab and its window (FR-015d)', () => {
  it('brings the parent’s background tab forward, makes it active and focuses it; openInto raises its window', async () => {
    const ws = fakeWs(layoutWith({ parentInBackground: true }));
    const bridge = bridgeAnswering({ action: 'focus', panelId: 'ed', windowId: 'w1' });
    watchFocus('ed');

    const outcome = await goToPreviewParent({
      ws,
      bridge,
      previewPanelId: 'pv',
      parentPanelId: 'ed',
      filePath: FILE,
      projectId: PROJECT,
    });

    expect(outcome).toEqual({ kind: 'focused', panelId: 'ed' });
    // Main's `focus` answer is what raises the window holding the editor (`focusExisting`).
    expect(bridge.openInto).toHaveBeenCalledWith({ absPath: FILE, ownerKind: 'project', ownerProjectId: PROJECT });
    const l = ws.layout as WorkspaceLayout;
    expect(l.activeTabId).toBe('t3');
    expect(effectiveActivePanelId(l.tabs.find((t) => t.id === 't3')!)).toBe('ed');
    expect(focused).toEqual(['ed']);
    // Never places anything, whatever main answers.
    expect(ws.calls).not.toContain('addPanelBeside');
  });

  it('a parent in ANOTHER window: nothing local moves; main’s focus answer raises that window', async () => {
    const ws = fakeWs(layoutWith());
    const bridge = bridgeAnswering({ action: 'focus', panelId: 'ed-elsewhere', windowId: 'w2' });

    const outcome = await goToPreviewParent({
      ws,
      bridge,
      previewPanelId: 'pv',
      parentPanelId: 'ed-elsewhere',
      filePath: FILE,
      projectId: PROJECT,
    });

    expect(outcome).toEqual({ kind: 'focused', panelId: 'ed-elsewhere' });
    expect(bridge.openInto).toHaveBeenCalledTimes(1);
    expect(ws.calls).not.toContain('setActiveTab');
    expect(ws.calls).not.toContain('addPanelBeside');
  });
});

/* ── Every entry point calls the same function (FR-015b) ──────────────────────────────────────── */

const registry = createPreviewProviderRegistry([
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
]);
function FakeBody({ panelId, content }: PreviewBodyProps): ReactElement {
  return createElement('div', { 'data-testid': `fake-body-${panelId}` }, content.kind === 'text' ? content.text : '');
}
const views: Record<string, PreviewProviderView> = {
  testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(FakeBody) },
};

// v1 review (#732): Open in Editor names the panel's link to its source, so the title menu holds it and the body
// menu does not; the status bar and the title menu reach the one route.
describe('the status bar and the header menu reach the one route (FR-015b)', () => {
  let m: MountedPreviewWindow | undefined;
  const mountText = async (): Promise<MountedPreviewWindow> => {
    m = await mountMarkdownPreview('hello', FILE, { providers: { registry, views }, providerId: 'testText' });
    // `focus` on a panel no window here holds: the route stops at its first step, so no editor body (and
    // its whole bridge) is mounted by a test that is only about which entry points reach the route.
    m.openInto.mockImplementation(() => Promise.resolve({ action: 'focus', panelId: 'elsewhere', windowId: 'w2' }));
    await screen.findByTestId(`fake-body-${m.id}`);
    return m;
  };
  afterEach(() => {
    m?.unmount();
    m = undefined;
  });

  const openInto = (): ReturnType<typeof vi.fn> => (m as MountedPreviewWindow).openInto;

  it('the status bar’s Open in Editor', async () => {
    const { id } = await mountText();
    fireEvent.click(await screen.findByTestId(`preview-editor-${id}`));
    await waitFor(() => expect(openInto()).toHaveBeenCalledWith(expect.objectContaining({ absPath: FILE })));
  });

  it('the body menu carries no Open in Editor', async () => {
    const { id } = await mountText();
    fireEvent.contextMenu(screen.getByTestId(`preview-body-${id}`));
    await screen.findByTestId('context-menu');
    expect(screen.queryByTestId('menu-item-Open in Editor')).toBeNull();
  });

  it('the header menu’s Open in Editor', async () => {
    const { id } = await mountText();
    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${id}`));
    fireEvent.click(await screen.findByTestId('menu-item-Open in Editor'));
    await waitFor(() => expect(openInto()).toHaveBeenCalledWith(expect.objectContaining({ absPath: FILE })));
  });

  it('parented, both still read Open in Editor — and the header’s focuses the parent through openInto', async () => {
    const mounted = await mountText();
    const { id } = mounted;
    const ws = mounted.ws();
    // The parent: an editor panel in this window's layout (untyped here — its body is not under test).
    let parentId = '';
    act(() => {
      parentId = ws.addPanel(ws.layout!.tabs[0].id);
    });
    mounted.openInto.mockImplementation(() => Promise.resolve({ action: 'focus', panelId: parentId, windowId: 'w1' }));
    mounted.push(
      previewUpdate({ panelId: id, providerId: 'testText', filePath: FILE, revision: 2, content: null, parent: { panelId: parentId, title: 'notes' } }),
    );

    // Parented: the button draws pressed, its name unchanged (#732).
    await waitFor(() => expect(screen.getByTestId(`preview-editor-${id}`)).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId(`preview-editor-${id}`)).toHaveAccessibleName('Open in Editor');

    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${id}`));
    const entry = await screen.findByTestId('menu-item-Open in Editor');
    expect(screen.queryByTestId('menu-item-Go to Editor')).toBeNull();
    fireEvent.click(entry);

    await waitFor(() => expect(mounted.openInto).toHaveBeenCalledWith(expect.objectContaining({ absPath: FILE })));
    await waitFor(() => {
      const tab = mounted.ws().layout!.tabs[0];
      expect(effectiveActivePanelId(tab)).toBe(parentId);
    });
    // Nothing was placed: the tab holds the preview and its parent, as before.
    expect(collectPanels(mounted.ws().layout!.tabs[0].root)).toHaveLength(2);
  });
});

/*
 * The maintainer, 2026-11-20 17:00 — "When clicking 'open in editor' in any preview, the 'Open files in' preference
 * should control where the editor opens." Open in Editor from a standalone preview obeys `editor.openTarget` (023
 * FR-025/FR-026) as every other open does: Last Active Editor puts the file in the tab's last active editor; New
 * Editor opens a new one beside the preview (044 FR-015c), as it always did.
 */
describe('Open in Editor obeys "Open files in" (023 FR-026)', () => {
  let m: MountedPreviewWindow | undefined;
  afterEach(() => {
    if (editorId !== '') {
      unregisterEditorActions(editorId);
      removeEditorState(editorId);
    }
    m?.unmount();
    m = undefined;
  });

  /** A window with the preview and, in the same tab, an editor the user last worked in. */
  async function withLastActiveEditor(openTarget: 'lastActive' | 'new') {
    m = await mountMarkdownPreview('hello', FILE, {
      providers: { registry, views },
      providerId: 'testText',
      settings: { editor: { openTarget } },
    });
    await screen.findByTestId(`fake-body-${m.id}`);
    const ws = m.ws();
    const tabId = ws.layout!.tabs[0]!.id;
    act(() => {
      const id = ws.addPanel(tabId);
      editorId = id;
    });
    const openFile = vi.fn(() => Promise.resolve());
    registerEditorActions(editorId, { openFile, isDirty: () => false } as unknown as EditorActions);
    // An editor as the open routes see one — its actions and its published state — without mounting an editor body,
    // which is not under test; and the tab's last active editor.
    setEditorState(editorId, { displayName: 'other.prvtxt' });
    setLastActiveEditor(tabId, editorId);
    m.openInto.mockImplementation(() => Promise.resolve({ action: 'open' }));
    // A new editor's body asks main for its file: answered never, as this is about where the panel goes, not its load.
    Reflect.set((window.throng as unknown as { editor: object }).editor, 'load', vi.fn(() => new Promise(() => {})));
    return { openFile, tabId };
  }
  let editorId = '';

  it('Last Active Editor: the file lands in the tab’s last active editor, and no panel is added', async () => {
    const { openFile, tabId } = await withLastActiveEditor('lastActive');
    const before = collectPanels(m!.ws().layout!.tabs.find((t) => t.id === tabId)!.root).length;

    fireEvent.click(await screen.findByTestId(`preview-editor-${m!.id}`));

    await waitFor(() => expect(openFile).toHaveBeenCalledWith(FILE));
    expect(collectPanels(m!.ws().layout!.tabs.find((t) => t.id === tabId)!.root)).toHaveLength(before);
  });

  it('New Editor: a new editor opens beside the preview, and the last active one is left alone', async () => {
    const { openFile, tabId } = await withLastActiveEditor('new');
    const before = collectPanels(m!.ws().layout!.tabs.find((t) => t.id === tabId)!.root).length;

    fireEvent.click(await screen.findByTestId(`preview-editor-${m!.id}`));

    await waitFor(() =>
      expect(collectPanels(m!.ws().layout!.tabs.find((t) => t.id === tabId)!.root)).toHaveLength(before + 1),
    );
    expect(openFile).not.toHaveBeenCalled();
  });
});
