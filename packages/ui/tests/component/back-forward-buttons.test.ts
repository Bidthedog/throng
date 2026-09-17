/**
 * 044 T140 — Back and Forward in the panel header, the header menu and the mouse (FR-100, FR-104, FR-105,
 * FR-110, FR-111; contracts/menus-and-controls.md §1, §6; contracts/navigation-history.md §4, §7).
 *
 * Mounted the way a window mounts a panel — `PanelPlaceholder`, its body, its menu — for an editor (a real
 * CodeMirror behind `mountEditor`'s fake authority) and for a preview (a test provider behind
 * `mountMarkdownPreview`'s fake bridge). The enabled state comes from THIS window's history store, which is
 * fed only by main's `changed` broadcast (`HistoryMirrorSync`); the tests seed it the way that broadcast
 * would.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THRONG_THEME,
  collectPanels,
  createPreviewProviderRegistry,
  type NavigationHistory,
  type Panel,
} from '@throng/core';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { __resetHistoryStore, setPanelHistory } from '../../src/renderer/navigation/history-store.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { getEditorActions } from '../../src/renderer/editor/editor-actions.js';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const FILE = 'D:/proj/notes.prvtxt';
const OTHER = 'D:/proj/other.prvtxt';
const registry = createPreviewProviderRegistry([
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
]);
function FakeBody({ panelId, content }: PreviewBodyProps): ReactElement {
  return createElement('div', { 'data-testid': `fake-body-${panelId}` }, content.kind === 'text' ? content.text : '');
}
const views: Record<string, PreviewProviderView> = {
  testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(FakeBody) },
};

const ED_A = 'C:/proj/a.ts';
const ED_B = 'C:/proj/b.ts';

let pv: MountedPreviewWindow | undefined;
let ed: EditorHarness | undefined;

const history = (paths: string[], index: number): NavigationHistory => ({
  entries: paths.map((filePath) => ({ filePath })),
  index,
});

function historyBridge() {
  return {
    attach: vi.fn(() => Promise.resolve({ entries: [], index: -1 })),
    purge: vi.fn(),
    setViewState: vi.fn(),
    onChanged: vi.fn(() => () => {}),
  };
}

async function mountPreview(): Promise<{ id: string; history: ReturnType<typeof historyBridge> }> {
  pv = await mountMarkdownPreview('hello', FILE, { providers: { registry, views }, providerId: 'testText' });
  const bridge = historyBridge();
  Reflect.set((window as unknown as { throng: Record<string, unknown> }).throng, 'history', bridge);
  await screen.findByTestId(`fake-body-${pv.id}`);
  return { id: pv.id, history: bridge };
}

function mountEditorPanel(keybindings?: Record<string, string[]>) {
  const bridge = historyBridge();
  ed = mountEditor({
    doc: { text: 'const b = 1;\n', version: 1, absPath: ED_B },
    withHeader: true,
    registerProject: true,
    ...(keybindings ? { keybindings } : {}),
    throng: { history: bridge },
  });
  return { id: 'p-ed', history: bridge };
}

const back = (id: string): HTMLButtonElement => screen.getByTestId(`panel-back-${id}`) as HTMLButtonElement;
const forward = (id: string): HTMLButtonElement => screen.getByTestId(`panel-forward-${id}`) as HTMLButtonElement;

async function openHeaderMenu(id: string, firstItem: string): Promise<void> {
  fireEvent.contextMenu(screen.getByTestId(`panel-handle-${id}`));
  await screen.findByTestId(`menu-item-${firstItem}`);
}
const menuItem = (label: string): HTMLElement => screen.getByTestId(`menu-item-${label}`);

beforeEach(() => {
  __resetHistoryStore();
  setActivePane('workspace');
});

afterEach(() => {
  pv?.unmount();
  pv = undefined;
  ed?.unmount();
  ed = undefined;
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

describe('drawn on editor and preview headers, before the type icon, and on no other kind (FR-100, FR-104)', () => {
  it('a preview draws Back then Forward before its type icon', async () => {
    const { id } = await mountPreview();
    const kind = screen.getByTestId(`panel-kind-${id}`);
    expect(back(id).compareDocumentPosition(kind) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(back(id).compareDocumentPosition(forward(id)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('an editor draws them before its type icon', async () => {
    const { id } = mountEditorPanel();
    const kind = await screen.findByTestId(`panel-kind-${id}`);
    expect(back(id).compareDocumentPosition(kind) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('an untyped panel draws neither', async () => {
    await mountPreview();
    let added = '';
    act(() => {
      added = pv!.ws().addPanel(pv!.ws().layout!.tabs[0].id);
      pv!.ws().clearLastAddedPanel();
    });
    await screen.findByTestId(`panel-handle-${added}`);
    expect(screen.queryByTestId(`panel-back-${added}`)).toBeNull();
    expect(screen.queryByTestId(`panel-forward-${added}`)).toBeNull();
  });
});

describe('the controls themselves (FR-104, Principle VI)', () => {
  it('carry the navigateBack / navigateForward glyphs, accessible names and titles with the live chord', async () => {
    const { id } = await mountPreview();
    expect(back(id).getAttribute('aria-label')).toBe('Back');
    expect(forward(id).getAttribute('aria-label')).toBe('Forward');
    expect(back(id).title).toBe('Back (Alt+ArrowLeft)');
    expect(forward(id).title).toBe('Forward (Alt+ArrowRight)');
    expect(back(id).textContent).toBe(THRONG_THEME.icons.navigateBack);
    expect(forward(id).textContent).toBe(THRONG_THEME.icons.navigateForward);
  });

  it('a rebound chord is what the title shows', async () => {
    const { id } = mountEditorPanel({ 'navigate.back': ['Ctrl+Alt+B'] });
    await waitFor(() => expect(back(id).title).toBe('Back (Ctrl+Alt+B)'));
  });

  it('are disabled at the ends of the mirrored history, and never hidden', async () => {
    const { id } = await mountPreview();
    // No history known yet: both drawn, both disabled.
    expect(back(id).disabled).toBe(true);
    expect(forward(id).disabled).toBe(true);

    act(() => setPanelHistory(id, history([FILE, OTHER], 1)));
    expect(back(id).disabled).toBe(false);
    expect(forward(id).disabled).toBe(true);

    act(() => setPanelHistory(id, history([FILE, OTHER], 0)));
    expect(back(id).disabled).toBe(true);
    expect(forward(id).disabled).toBe(false);
  });

  it('a press on either does not start the REAL header’s drag (fix round 1, item 6)', async () => {
    /*
     * The header is dnd-kit's drag handle, under the same PointerSensor and 4 px activation `tab-group.tsx`
     * gives it. The control first: a press on the TITLE and a 20 px move does start a drag — so the absence
     * below is not an absence of any drag at all.
     */
    const onDragStart = vi.fn();
    function DragHost({ children }: { children: ReactNode }): ReactElement {
      const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
      return createElement(DndContext, { sensors, onDragStart }, children);
    }
    pv = await mountMarkdownPreview('hello', FILE, {
      providers: { registry, views },
      providerId: 'testText',
      wrap: (children) => createElement(DragHost, null, children),
    });
    const id = pv.id;
    await screen.findByTestId(`fake-body-${id}`);
    act(() => setPanelHistory(id, history([FILE, OTHER, FILE], 1)));

    const drag = (from: HTMLElement): void => {
      fireEvent.pointerDown(from, { isPrimary: true, button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(document, { isPrimary: true, clientX: 30, clientY: 10 });
      fireEvent.pointerUp(document, { isPrimary: true, clientX: 30, clientY: 10 });
    };

    drag(screen.getByTestId(`panel-title-${id}`));
    await waitFor(() => expect(onDragStart).toHaveBeenCalledTimes(1));

    drag(back(id));
    drag(forward(id));
    await new Promise((r) => setTimeout(r, 20));
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });
});

describe('the header menu’s Back and Forward match the buttons (FR-111)', () => {
  it('on a preview', async () => {
    const { id } = await mountPreview();
    act(() => setPanelHistory(id, history([FILE, OTHER], 1)));
    await openHeaderMenu(id, 'Back');
    expect(menuItem('Back').getAttribute('aria-disabled')).toBe('false');
    expect(menuItem('Forward').getAttribute('aria-disabled')).toBe('true');
  });

  it('on an editor', async () => {
    const { id } = mountEditorPanel();
    await screen.findByTestId(`panel-handle-${id}`);
    act(() => setPanelHistory(id, history([ED_A, ED_B], 0)));
    await openHeaderMenu(id, 'Forward');
    expect(menuItem('Back').getAttribute('aria-disabled')).toBe('true');
    expect(menuItem('Forward').getAttribute('aria-disabled')).toBe('false');
  });

  it('choosing Back on a preview navigates it', async () => {
    const { id } = await mountPreview();
    act(() => setPanelHistory(id, history([OTHER, FILE], 1)));
    await openHeaderMenu(id, 'Back');
    fireEvent.click(menuItem('Back'));
    await waitFor(() => expect(pv!.preview.navigate).toHaveBeenCalledTimes(1));
    expect(pv!.preview.navigate.mock.calls[0][0]).toMatchObject({
      panelId: id,
      target: { absPath: OTHER },
      intent: { kind: 'history', index: 0 },
    });
  });

  it('the Back button on an editor loads the older entry with the history intent', async () => {
    const { id } = mountEditorPanel();
    await screen.findByTestId(`panel-handle-${id}`);
    await waitFor(() => expect(getEditorActions(id)).toBeDefined());
    act(() => setPanelHistory(id, history([ED_A, ED_B], 1)));
    fireEvent.click(back(id));
    await waitFor(() =>
      expect(ed!.calls.load).toHaveBeenCalledWith(
        expect.objectContaining({ absPath: ED_A, navigation: { kind: 'history', index: 0, filePath: ED_A } }),
      ),
    );
  });
});

describe('the mouse’s back and forward buttons over the panel (FR-105)', () => {
  it('button 3 over a preview is Back, button 4 is Forward, and each prevents default', async () => {
    const { id } = await mountPreview();
    act(() => setPanelHistory(id, history([OTHER, FILE, OTHER], 1)));
    const box = screen.getByTestId(`panel-${id}`);
    const body = screen.getByTestId(`fake-body-${id}`);

    expect(fireEvent.mouseDown(body, { button: 3 })).toBe(false);
    expect(fireEvent.mouseUp(body, { button: 3 })).toBe(false);
    await waitFor(() => expect(pv!.preview.navigate).toHaveBeenCalledTimes(1));
    expect(pv!.preview.navigate.mock.calls[0][0]).toMatchObject({ intent: { kind: 'history', index: 0 } });

    expect(fireEvent.mouseDown(box, { button: 4 })).toBe(false);
    expect(fireEvent.mouseUp(box, { button: 4 })).toBe(false);
    await waitFor(() => expect(pv!.preview.navigate).toHaveBeenCalledTimes(2));
    expect(pv!.preview.navigate.mock.calls[1][0]).toMatchObject({ intent: { kind: 'history', index: 2 } });
  });

  it('acts on the panel UNDER the pointer, not the focused one', async () => {
    const { id } = await mountPreview();
    let other = '';
    act(() => {
      other = pv!.ws().addPanel(pv!.ws().layout!.tabs[0].id);
      pv!.ws().clearLastAddedPanel();
    });
    act(() => pv!.ws().setActivePanel(pv!.ws().layout!.tabs[0].id, other));
    // The untyped panel is the active one; the pointer is over the preview.
    expect(pv!.ws().layout!.tabs[0].activePanelId).toBe(other);
    act(() => setPanelHistory(id, history([OTHER, FILE], 1)));
    fireEvent.mouseDown(screen.getByTestId(`panel-${id}`), { button: 3 });
    fireEvent.mouseUp(screen.getByTestId(`panel-${id}`), { button: 3 });
    await waitFor(() => expect(pv!.preview.navigate).toHaveBeenCalledTimes(1));
    expect(pv!.preview.navigate.mock.calls[0][0]).toMatchObject({ panelId: id });
  });

  it('fix round 1, item 5 — a press over one panel released over another steps neither', async () => {
    const { id } = await mountPreview();
    let other = '';
    act(() => {
      other = pv!.ws().addPanel(pv!.ws().layout!.tabs[0].id);
      pv!.ws().clearLastAddedPanel();
    });
    act(() => setPanelHistory(id, history([OTHER, FILE], 1)));
    const previewBox = screen.getByTestId(`panel-${id}`);
    const otherBox = await screen.findByTestId(`panel-${other}`);

    // Pressed over the other panel, released over the preview.
    fireEvent.mouseDown(otherBox, { button: 3 });
    fireEvent.mouseUp(previewBox, { button: 3 });
    // Pressed over the preview, released over the other panel — and then a stray release back over the
    // preview, which the abandoned press must not arm.
    fireEvent.mouseDown(previewBox, { button: 3 });
    fireEvent.mouseUp(otherBox, { button: 3 });
    fireEvent.mouseUp(previewBox, { button: 3 });

    await new Promise((r) => setTimeout(r, 20));
    expect(pv!.preview.navigate).not.toHaveBeenCalled();
  });

  it('an ordinary left button does nothing of the kind', async () => {
    const { id } = await mountPreview();
    act(() => setPanelHistory(id, history([OTHER, FILE], 1)));
    fireEvent.mouseUp(screen.getByTestId(`panel-${id}`), { button: 0 });
    await new Promise((r) => setTimeout(r, 10));
    expect(pv!.preview.navigate).not.toHaveBeenCalled();
  });
});

describe('Send to Tab keeps the history; destroying the panel purges it (FR-110)', () => {
  const previewPanels = (): Panel[] => pv!.ws().layout!.tabs.flatMap((t) => collectPanels(t.root) as Panel[]);

  it('Send to Tab ▸ New Tab on a preview moves it without purge or destroyed', async () => {
    const { id, history: bridge } = await mountPreview();
    act(() => {
      pv!.ws().addPanel(pv!.ws().layout!.tabs[0].id);
      pv!.ws().clearLastAddedPanel();
    });
    await openHeaderMenu(id, 'Send to Tab');
    fireEvent.click(menuItem('Send to Tab'));
    fireEvent.click(await screen.findByTestId('menu-item-New Tab'));
    await waitFor(() => expect(pv!.ws().layout!.tabs).toHaveLength(2));
    expect(previewPanels().map((p) => p.id)).toContain(id);
    expect(bridge.purge).not.toHaveBeenCalled();
    expect(pv!.preview.destroyed).not.toHaveBeenCalled();
  });

  it('Close Panel on a preview sends destroyed and purges its history', async () => {
    const { id, history: bridge } = await mountPreview();
    act(() => {
      pv!.ws().addPanel(pv!.ws().layout!.tabs[0].id);
      pv!.ws().clearLastAddedPanel();
    });
    await openHeaderMenu(id, 'Close Panel');
    fireEvent.click(menuItem('Close Panel'));
    await waitFor(() => expect(pv!.preview.destroyed).toHaveBeenCalledWith(id));
    expect(bridge.purge).toHaveBeenCalledWith(id);
  });

  it('Send to Tab ▸ New Tab on an editor does not purge', async () => {
    const { id, history: bridge } = mountEditorPanel();
    await screen.findByTestId(`panel-handle-${id}`);
    await openHeaderMenu(id, 'Send to Tab');
    fireEvent.click(menuItem('Send to Tab'));
    fireEvent.click(await screen.findByTestId('menu-item-New Tab'));
    await new Promise((r) => setTimeout(r, 10));
    expect(bridge.purge).not.toHaveBeenCalled();
    expect(ed!.calls.destroy).not.toHaveBeenCalled();
  });

  it('destroying an editor purges its history', async () => {
    const { id, history: bridge } = mountEditorPanel();
    await screen.findByTestId(`panel-handle-${id}`);
    fireEvent.click(screen.getByTestId(`panel-close-${id}`));
    await waitFor(() => expect(bridge.purge).toHaveBeenCalledWith(id));
    expect(ed!.calls.destroy).toHaveBeenCalledWith(id);
  });
});
