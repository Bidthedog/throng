/**
 * 044 T114 — a preview is read-only, and the document commands are inert over it (FR-020, FR-021, FR-030;
 * quickstart §4 steps 1 and 3).
 *
 * ══ THREE WAYS SOMETHING COULD CHANGE ══
 *
 * 1. **Input in the body.** Typing, paste and drop. The body is not editable, so typing has nothing to
 *    change; paste and drop are REFUSED outright (their default prevented) so no surface underneath — a
 *    window-level drop handler, a future editable body — can act on them, and no editor bridge is called.
 * 2. **Commands resolved by chord.** With a preview active, Ctrl+S, Delete, F2, Ctrl+X, Ctrl+C and Ctrl+F
 *    resolve to nothing file-, save-, rename- or find-shaped. The preview has its own keyboard scope
 *    (044 R16), so they cannot fall back to the Files & Folders scope and act on the TREE's selection
 *    while the reader looks at the page (FR-021).
 * 3. **Renaming the panel.** The rename chord has no starter to reach and a header double-click opens no
 *    box (FR-030).
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  collectPanels,
  createPreviewProviderRegistry,
  effectiveActivePanelId,
  resolveAction,
} from '@throng/core';
import { resolveScoped } from '../../src/renderer/keybindings/scope.js';
import { requestPanelRename } from '../../src/renderer/workspace/panel-rename.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { EditorKeybindings } from '../../src/renderer/editor/editor-chrome.js';
import {
  registerEditorActions,
  unregisterEditorActions,
  type EditorActions,
} from '../../src/renderer/editor/editor-actions.js';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { mountMarkdownPreview, type MountPreviewOptions, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const FILE = 'D:/proj/notes.prvtxt';
const registry = createPreviewProviderRegistry([
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
]);
function FakeBody({ panelId, content }: PreviewBodyProps): ReactElement {
  return createElement(
    'div',
    { 'data-testid': `fake-body-${panelId}`, tabIndex: -1 },
    content.kind === 'text' ? content.text : '',
  );
}
const views: Record<string, PreviewProviderView> = {
  testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(FakeBody) },
};

let m: MountedPreviewWindow | undefined;

async function mountText(extra: Pick<MountPreviewOptions, 'extras'> = {}): Promise<MountedPreviewWindow> {
  m = await mountMarkdownPreview('The document.', FILE, { providers: { registry, views }, providerId: 'testText', ...extra });
  await screen.findByTestId(`fake-body-${m.id}`);
  // Everything a preview could reach to change a document, recorded.
  const throng = window.throng as unknown as Record<string, Record<string, unknown>>;
  throng.editor = {
    ...throng.editor,
    save: vi.fn(),
    applyChange: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    load: vi.fn(),
  };
  return m;
}

const editorBridgeCalls = (): number =>
  Object.values((window.throng as unknown as { editor: Record<string, ReturnType<typeof vi.fn>> }).editor).reduce(
    (n, fn) => n + (typeof fn?.mock?.calls?.length === 'number' ? fn.mock.calls.length : 0),
    0,
  );

afterEach(() => {
  m?.unmount();
  m = undefined;
  document.body.replaceChildren();
});

describe('input in the body changes nothing (FR-020)', () => {
  it('typing leaves the body as it was and calls no editor bridge', async () => {
    const { id } = await mountText();
    const body = screen.getByTestId(`fake-body-${id}`);
    body.focus();

    for (const key of ['a', 'Backspace', 'Delete', 'Enter']) {
      fireEvent.keyDown(body, { key });
      fireEvent.keyUp(body, { key });
    }

    expect(body).toHaveTextContent('The document.');
    expect(editorBridgeCalls()).toBe(0);
  });

  it('paste is refused: its default is prevented, nothing is read from the clipboard, nothing changes', async () => {
    const { id } = await mountText();
    const body = screen.getByTestId(`fake-body-${id}`);

    const event = new Event('paste', { bubbles: true, cancelable: true });
    body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect((window.throng as unknown as { clipboard: { paste: ReturnType<typeof vi.fn> } }).clipboard.paste).not.toHaveBeenCalled();
    expect(body).toHaveTextContent('The document.');
    expect(editorBridgeCalls()).toBe(0);
  });

  it('cut is refused: its default is prevented and nothing is written', async () => {
    const { id } = await mountText();
    const event = new Event('cut', { bubbles: true, cancelable: true });
    screen.getByTestId(`fake-body-${id}`).dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(m!.clipboardWrite).not.toHaveBeenCalled();
    expect(m!.writeRich).not.toHaveBeenCalled();
  });

  it('a drop is refused, and opens nothing', async () => {
    const { id } = await mountText();
    const body = screen.getByTestId(`fake-body-${id}`);

    const event = new Event('drop', { bubbles: true, cancelable: true });
    body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(m!.openInto).not.toHaveBeenCalled();
    expect(body).toHaveTextContent('The document.');
    expect(editorBridgeCalls()).toBe(0);
  });
});

describe('document commands are inert while a preview is active (FR-021)', () => {
  const resolve = (key: string, mods: { ctrl?: boolean; shift?: boolean } = {}) => {
    const layout = m!.ws().layout!;
    return resolveScoped(
      DEFAULT_KEYBINDINGS,
      { key, ctrl: mods.ctrl ?? false, shift: mods.shift ?? false, alt: false },
      { tabs: layout.tabs, activeTabId: layout.activeTabId },
      { transientFocus: false },
    );
  };

  it.each([
    ['the save chord', 's', { ctrl: true }, 'editor', 'editor.save'],
    ['Delete', 'Delete', {}, 'explorer', 'file.delete'],
    ['F2', 'F2', {}, 'explorer', 'file.rename'],
    ['Ctrl+X', 'x', { ctrl: true }, 'explorer', 'file.cut'],
    ['Ctrl+C', 'c', { ctrl: true }, 'explorer', 'file.copy'],
    ['Ctrl+F', 'f', { ctrl: true }, 'editor', 'search.find'],
  ] as const)('%s resolves to no save, file, rename or find command', async (_name, key, mods, elsewhere, meansThere) => {
    const { id } = await mountText();
    // The preview is the active panel of the active tab, in the workspace pane.
    expect(effectiveActivePanelId(m!.ws().layout!.tabs[0])).toBe(id);
    // Positive control: the same key IS that command in the scope it belongs to, so a null below is the
    // preview's scope speaking, not a key spelled wrongly.
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key, ctrl: mods.ctrl ?? false, shift: false, alt: false }, elsewhere)).toBe(
      meansThere,
    );

    const action = resolve(key, mods);

    expect(action === null || !/^(editor\.save|file\.|panel\.rename|search\.)/.test(action)).toBe(true);
  });

  /*
   * US3 fix round 1 (item 4) — through the REAL save dispatcher, not only the resolver.
   *
   * `EditorKeybindings` is the window's Ctrl+S / Ctrl+Shift+S handler. It saves whatever `getEditorActions`
   * holds for the active panel, so actions are registered under the PREVIEW's id too: had the chord
   * resolved to a save over the preview, that spy is what it would call. The positive control makes an
   * EDITOR panel active in another tab first and shows the same keypress saving it — so the dispatcher is
   * mounted and live, and the silence afterwards is the preview's scope.
   */
  it('the save dispatcher is live, and saves nothing while the preview is active', async () => {
    const { id } = await mountText({ extras: [createElement(EditorKeybindings, { key: 'save-keys', isSubWorkspace: false })] });
    const ws = m!.ws();
    const previewTab = ws.layout!.tabs[0].id;
    const spies = (): EditorActions & { save: ReturnType<typeof vi.fn>; saveAs: ReturnType<typeof vi.fn> } => ({
      save: vi.fn(() => Promise.resolve(true)),
      saveAs: vi.fn(() => Promise.resolve(true)),
      isDirty: () => true,
      openFile: () => Promise.resolve(),
      revert: () => {},
      reloadFromDisk: () => Promise.resolve(true),
    });
    const onPreview = spies();
    const onEditor = spies();

    // An editor panel in a second tab — typed, but not mounted (the host draws only the first tab).
    let editorTab = '';
    act(() => {
      editorTab = ws.addTab();
    });
    const editorId = collectPanels(m!.ws().layout!.tabs.find((t) => t.id === editorTab)!.root)[0].id;
    act(() => m!.ws().setPanelType(editorId, 'editor', { filePath: 'D:/proj/other.txt' }));
    registerEditorActions(id, onPreview);
    registerEditorActions(editorId, onEditor);
    try {
      setActivePane('workspace');

      // Positive control: with the editor active, Ctrl+S saves it.
      act(() => m!.ws().setActiveTab(editorTab));
      fireEvent.keyDown(window, { key: 's', ctrlKey: true });
      await waitFor(() => expect(onEditor.save).toHaveBeenCalledTimes(1));

      // The preview active and focused: Ctrl+S and Ctrl+Shift+S reach no save at all.
      act(() => m!.ws().setActiveTab(previewTab));
      expect(effectiveActivePanelId(m!.ws().layout!.tabs.find((t) => t.id === previewTab)!)).toBe(id);
      const host = screen.getByTestId(`preview-body-${id}`);
      host.focus();
      const save = fireEvent.keyDown(host, { key: 's', ctrlKey: true });
      const saveAs = fireEvent.keyDown(host, { key: 'S', ctrlKey: true, shiftKey: true });
      await act(() => new Promise((r) => setTimeout(r, 10)));

      expect(onPreview.save).not.toHaveBeenCalled();
      expect(onPreview.saveAs).not.toHaveBeenCalled();
      expect(onEditor.save).toHaveBeenCalledTimes(1);
      // Not claimed by the dispatcher either: nothing prevented the keys' defaults.
      expect(save).toBe(true);
      expect(saveAs).toBe(true);
      expect(screen.getByTestId(`fake-body-${id}`)).toHaveTextContent('The document.');
    } finally {
      unregisterEditorActions(id);
      unregisterEditorActions(editorId);
    }
  });
});

describe('the panel cannot be renamed (FR-030)', () => {
  it('the rename chord reaches no rename starter', async () => {
    const { id } = await mountText();
    act(() => {
      expect(requestPanelRename(id)).toBe(false);
    });
    expect(screen.queryByTestId(`panel-rename-input-${id}`)).toBeNull();
  });

  it('a header double-click opens no rename box', async () => {
    const { id } = await mountText();
    fireEvent.doubleClick(screen.getByTestId(`panel-handle-${id}`));
    expect(screen.queryByTestId(`panel-rename-input-${id}`)).toBeNull();
  });
});
