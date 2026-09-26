/**
 * 044 US1 fix round 1, item 3 — the preview entry points are WIRED, end to end, below E2E.
 *
 * Every other US1 test drives one piece against a stub of its neighbours: the status-bar button against
 * a registered opener, `openPreview` against a fake store, the menus against a hand-built affordance.
 * Each would stay green if the piece were never mounted. This file mounts the editor panel the way a
 * window does — `PanelPlaceholder` (header, menu, `PanelBody`'s root), a REAL CodeMirror view, and
 * `EditorChrome` beside it — with only main's preview bridge faked, and asks the one question those
 * tests cannot: does each gesture reach `window.throng.preview.open`?
 *
 * What it pins, and what deleting would turn it red:
 * - the status-bar button (`editor-panel.tsx` passing the root, `status-strip.tsx` the command);
 * - the header's Open Preview (`panel-placeholder.tsx`'s affordance and action);
 * - the body's Open Preview (`use-editor.ts`'s menu-open-time affordance);
 * - the chord, in the workspace only, and not for a key something else already handled;
 * - `<PreviewCommands/>` in `EditorChrome`: the opener, `onPlace`/`onFocus`/`onOpenChanged` added and
 *   removed, the `openPaths` seed asked for;
 * - `<EditorTitlePublisher/>` in `EditorChrome`.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorAutoTitle, type PreviewOpenRequest } from '@throng/core';
import { mountEditor } from './helpers/mount-editor.js';
import { removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { __resetPreviewOpenStore } from '../../src/renderer/preview/preview-open-store.js';

const PANEL = 'p-ed';
const ROOT = 'C:/proj';
const FILE = `${ROOT}/README.md`;
const CHORD = { key: 'F9', ctrlKey: true, altKey: true };

function fakePreviewBridge() {
  const off = { place: vi.fn(), focus: vi.fn(), openChanged: vi.fn() };
  return {
    off,
    bridge: {
      // `focused` with no panel id: main says a preview is already being placed, so nothing else runs.
      open: vi.fn((_req: PreviewOpenRequest) => Promise.resolve({ kind: 'focused' as const, panelId: null })),
      placeDeclined: vi.fn(),
      publishEditorTitle: vi.fn(),
      openPaths: vi.fn(() => Promise.resolve([] as string[])),
      onPlace: vi.fn(() => off.place),
      onFocus: vi.fn(() => off.focus),
      onOpenChanged: vi.fn(() => off.openChanged),
      destroyed: vi.fn(),
    },
  };
}

async function mount() {
  const fake = fakePreviewBridge();
  const h = mountEditor({
    panelId: PANEL,
    doc: { text: '# Hello\n', version: 1, absPath: FILE },
    projectRoot: ROOT,
    withHeader: true,
    withChrome: true,
    registerProject: true,
    keybindings: { 'preview.open': ['Ctrl+Alt+F9'] },
    throng: { preview: fake.bridge },
  });
  // The button appears only once the project list, the editor's file and the settings have all landed.
  await screen.findByTestId(`editor-preview-${PANEL}`, {}, { timeout: 10_000 });
  await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  return { h, ...fake };
}

const EXPECTED: PreviewOpenRequest = {
  absPath: FILE,
  projectId: 'proj-editor',
  requesterPanelId: PANEL,
  hasParentLocally: true,
};

beforeEach(() => {
  __resetPreviewOpenStore();
  setActivePane('workspace');
});
afterEach(() => {
  removeEditorState(PANEL);
  setActivePane('workspace');
  Reflect.deleteProperty(window, 'throng');
});

describe('each entry point reaches preview.open (FR-001, FR-002, FR-005)', () => {
  it('the status-bar button', async () => {
    const { bridge } = await mount();
    fireEvent.click(screen.getByTestId(`editor-preview-${PANEL}`));
    await waitFor(() => expect(bridge.open).toHaveBeenCalledWith(EXPECTED));
  });

  it('the header menu’s Open Preview', async () => {
    const { bridge } = await mount();
    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${PANEL}`), { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByTestId('menu-item-Open Preview'));
    await waitFor(() => expect(bridge.open).toHaveBeenCalledWith(EXPECTED));
  });

  it('the body menu’s Open Preview', async () => {
    const { h, bridge } = await mount();
    fireEvent.contextMenu(h.content(), { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByTestId('menu-item-Open Preview'));
    await waitFor(() => expect(bridge.open).toHaveBeenCalledWith(EXPECTED));
  });

  it('the chord, over the focused editor', async () => {
    const { bridge } = await mount();
    fireEvent.keyDown(document.body, CHORD);
    await waitFor(() => expect(bridge.open).toHaveBeenCalledWith(EXPECTED));
  });
});

describe('the chord is the workspace’s only when nothing else took the key', () => {
  it('does nothing while File Explorer is the active pane — the tree owns the chord there', async () => {
    const { bridge } = await mount();
    setActivePane('explorer');
    fireEvent.keyDown(document.body, CHORD);
    await act(() => Promise.resolve());
    expect(bridge.open).not.toHaveBeenCalled();
  });

  it('does nothing for a key another handler already prevented', async () => {
    const { bridge } = await mount();
    const claim = (e: KeyboardEvent): void => e.preventDefault();
    document.body.addEventListener('keydown', claim);
    try {
      fireEvent.keyDown(document.body, CHORD);
      await act(() => Promise.resolve());
      expect(bridge.open).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener('keydown', claim);
    }
  });
});

describe('EditorChrome mounts the window’s preview listeners and the title publisher', () => {
  it('subscribes to place, focus and openChanged, asks for the open seed, and unsubscribes on unmount', async () => {
    const { h, bridge, off } = await mount();
    expect(bridge.onPlace).toHaveBeenCalledTimes(1);
    expect(bridge.onFocus).toHaveBeenCalledTimes(1);
    expect(bridge.onOpenChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(bridge.openPaths).toHaveBeenCalledTimes(1));

    h.unmount();

    expect(off.place).toHaveBeenCalledTimes(1);
    expect(off.focus).toHaveBeenCalledTimes(1);
    expect(off.openChanged).toHaveBeenCalledTimes(1);
  });

  it('publishes the editor’s displayed name to main (FR-031)', async () => {
    const { bridge } = await mount();
    await waitFor(() => expect(bridge.publishEditorTitle).toHaveBeenCalledWith(PANEL, editorAutoTitle(FILE)));
  });
});
