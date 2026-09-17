/**
 * 044 T144 — `navigate.back` / `navigate.forward` (FR-102, FR-105, FR-106b, FR-106c, FR-107, FR-112;
 * contracts/navigation-history.md §4).
 *
 * The command acts on the FOCUSED editor or preview panel — the active panel of the active tab while the
 * workspace pane is active — and on nothing else. Its target is `targetOf` over THIS window's mirrored
 * history; the renderer never computes a new history, it only asks for a move:
 *
 * - an editor → `openIntoEditorPanel(…, { kind: 'history', index })`, observed as the load it makes;
 * - a preview → `preview.navigate` with the history intent and the body's captured view state, and the
 *   panel's handling of main's reply.
 *
 * The chord is proved through the REAL window key handler (`app.tsx`) over a REAL CodeMirror view, because
 * FR-105's last sentence is a precedence claim: Alt+Left must beat CodeMirror's `cursorSyntaxLeft`, which
 * only the capture-phase window listener can do.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { EditorSelection } from '@codemirror/state';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultLayout,
  type NavigationHistory,
  type Panel,
  type PreviewNavigateResponse,
  type WorkspaceLayout,
} from '@throng/core';
import { KeybindingsHandler } from '../../src/renderer/app.js';
import {
  getEditorActions,
  registerEditorActions,
  unregisterEditorActions,
  type EditorActions,
} from '../../src/renderer/editor/editor-actions.js';
import { __resetHistoryStore, setPanelHistory } from '../../src/renderer/navigation/history-store.js';
import { navigateFocusedHistory, navigatePanelHistory } from '../../src/renderer/navigation/navigate-history.js';
import { getPreviewState } from '../../src/renderer/preview/preview-store.js';
import { captureScrollAnchor } from '../../src/renderer/preview/providers/markdown/scroll-anchor.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { NavigationChrome } from '../../src/renderer/navigate/navigation-chrome.js';
import { SubWorkspaceWindowContext } from '../../src/renderer/workspace/subworkspace-window-context.js';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { COLD, README, ROOT, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
const A = 'D:/proj/a.ts';
const B = 'D:/proj/b.ts';
const C = 'D:/proj/c.ts';
const D = 'D:/proj/d.ts';
const SETUP = `${ROOT}/docs/setup.md`;

const history = (paths: string[], index: number): NavigationHistory => ({
  entries: paths.map((filePath) => ({ filePath })),
  index,
});

let ws: MountedWorkspace | undefined;
let ed: EditorHarness | undefined;
let pv: MountedPreviewWindow | undefined;
const registered = new Set<string>();

function asEditor(panelId: string) {
  const actions = {
    save: vi.fn(() => Promise.resolve(true)),
    saveAs: vi.fn(() => Promise.resolve(true)),
    isDirty: vi.fn(() => false),
    openFile: vi.fn(() => Promise.resolve()),
    revert: vi.fn(),
    reloadFromDisk: vi.fn(() => Promise.resolve(true)),
  };
  registerEditorActions(panelId, actions as unknown as EditorActions);
  registered.add(panelId);
  return actions;
}

/** One tab: editors e1 (active) and e2 side by side, and an untyped panel u1. */
function editorsLayout(): WorkspaceLayout {
  const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'e1' });
  const e1: Panel = { type: 'panel', id: 'e1', originProjectId: PROJECT, title: 'One', kind: 'editor', config: { filePath: B } };
  const e2: Panel = { type: 'panel', id: 'e2', originProjectId: PROJECT, title: 'Two', kind: 'editor', config: { filePath: D } };
  const u1: Panel = { type: 'panel', id: 'u1', originProjectId: PROJECT, title: 'Three' };
  layout.tabs[0].root = { type: 'split', orientation: 'row', children: [e1, e2, u1], sizes: [0.4, 0.3, 0.3] };
  layout.tabs[0].activePanelId = 'e1';
  return layout;
}

beforeEach(() => {
  __resetHistoryStore();
  setActivePane('workspace');
});

afterEach(() => {
  for (const id of registered) unregisterEditorActions(id);
  registered.clear();
  ws?.unmount();
  ws = undefined;
  ed?.unmount();
  ed = undefined;
  pv?.unmount();
  pv = undefined;
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

describe('an editor (FR-102, FR-112)', () => {
  async function mount(): Promise<{ e1: ReturnType<typeof asEditor>; e2: ReturnType<typeof asEditor> }> {
    ws = await mountWorkspace(editorsLayout(), {
      throng: { editor: { openInto: () => Promise.resolve({ action: 'open' }) } },
    });
    const e1 = asEditor('e1');
    const e2 = asEditor('e2');
    setPanelHistory('e1', history([A, B], 1));
    setPanelHistory('e2', history([C, D], 1));
    return { e1, e2 };
  }

  it('Back on the focused editor loads its older entry with the history intent', async () => {
    const { e1 } = await mount();
    await act(() => navigateFocusedHistory(ws!.ws(), 'back'));
    expect(e1.openFile).toHaveBeenCalledWith(A, { navigation: { kind: 'history', index: 0, filePath: A } });
  });

  it('never touches another panel’s history', async () => {
    const { e2 } = await mount();
    await act(() => navigateFocusedHistory(ws!.ws(), 'back'));
    expect(e2.openFile).not.toHaveBeenCalled();
  });

  it('Forward at the newest entry has no target, and does nothing', async () => {
    const { e1, e2 } = await mount();
    await act(() => navigateFocusedHistory(ws!.ws(), 'forward'));
    expect(e1.openFile).not.toHaveBeenCalled();
    expect(e2.openFile).not.toHaveBeenCalled();
  });

  it('a named panel moves that panel — the mouse and the buttons name theirs', async () => {
    const { e1, e2 } = await mount();
    await act(() => navigatePanelHistory(ws!.ws(), 'e2', 'back'));
    expect(e2.openFile).toHaveBeenCalledWith(C, { navigation: { kind: 'history', index: 0, filePath: C } });
    expect(e1.openFile).not.toHaveBeenCalled();
  });

  it('does nothing with Files & Folders active, with an untyped panel active, or with no history known', async () => {
    const { e1, e2 } = await mount();
    setActivePane('explorer');
    await act(() => navigateFocusedHistory(ws!.ws(), 'back'));
    setActivePane('workspace');
    act(() => ws!.ws().setActivePanel('t1', 'u1'));
    await act(() => navigateFocusedHistory(ws!.ws(), 'back'));
    act(() => ws!.ws().setActivePanel('t1', 'e1'));
    __resetHistoryStore();
    await act(() => navigateFocusedHistory(ws!.ws(), 'back'));
    expect(e1.openFile).not.toHaveBeenCalled();
    expect(e2.openFile).not.toHaveBeenCalled();
  });
});

describe('the chord, through the window’s own key handler, over a real editor (FR-105)', () => {
  it('Alt+ArrowLeft is Back, and CodeMirror does not move the caret by syntax', async () => {
    ed = mountEditor({
      doc: { text: 'call(alpha, beta);\n', version: 1, absPath: 'C:/proj/b.ts' },
      extras: [createElement(KeybindingsHandler, { key: 'keys', onToggleProjects: () => {}, onToggleExplorer: () => {} })],
    });
    await waitFor(() => expect(ed!.text()).toContain('call(alpha'));
    setPanelHistory('p-ed', history(['C:/proj/a.ts', 'C:/proj/b.ts'], 1));
    const view = ed.view();
    act(() => view.dispatch({ selection: EditorSelection.cursor(17) }));
    view.focus();

    fireEvent.keyDown(ed.content(), { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });

    expect(view.state.selection.main.head).toBe(17);
    await waitFor(() =>
      expect(ed!.calls.load).toHaveBeenCalledWith(
        expect.objectContaining({
          absPath: 'C:/proj/a.ts',
          navigation: { kind: 'history', index: 0, filePath: 'C:/proj/a.ts' },
        }),
      ),
    );
  });
});

describe('US7b fix round 1, item 1 — Shift+Alt+Arrow is still column select (CRITICAL)', () => {
  /*
   * The window listener used to DROP Shift for arrow keys, so Shift+Alt+ArrowLeft resolved as
   * Alt+ArrowLeft — `navigate.back`, which comes first in the binding map — and the capture phase then
   * swallowed the column-select chord before CodeMirror saw it.
   */
  it('Shift+Alt+ArrowLeft extends the column selection and loads nothing', async () => {
    ed = mountEditor({
      doc: { text: 'call(alpha, beta);\n', version: 1, absPath: 'C:/proj/b.ts' },
      extras: [createElement(KeybindingsHandler, { key: 'keys', onToggleProjects: () => {}, onToggleExplorer: () => {} })],
    });
    await waitFor(() => expect(ed!.text()).toContain('call(alpha'));
    setPanelHistory('p-ed', history(['C:/proj/a.ts', 'C:/proj/b.ts'], 1));
    const view = ed.view();
    act(() => view.dispatch({ selection: EditorSelection.cursor(17) }));
    view.focus();

    fireEvent.keyDown(ed.content(), { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true, shiftKey: true });

    expect(view.state.selection.main.from).toBe(16);
    expect(view.state.selection.main.to).toBe(17);
    await new Promise((r) => setTimeout(r, 20));
    expect(ed.calls.load).not.toHaveBeenCalled();
  });
});

describe('US7b fix round 1, item 2 — Alt+Left in a SUB-WORKSPACE window (FR-105)', () => {
  const keys = (): void => {
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
  };

  it('the sub-workspace window’s capture listener steps the focused editor back', async () => {
    ws = await mountWorkspace(editorsLayout(), {
      throng: { editor: { openInto: () => Promise.resolve({ action: 'open' }) } },
      extras: [
        createElement(
          SubWorkspaceWindowContext.Provider,
          { key: 'sub', value: { id: 'sub-1', name: 'Sub', colour: '#336699' } },
          createElement(NavigationChrome),
        ),
      ],
    });
    const e1 = asEditor('e1');
    setPanelHistory('e1', history([A, B], 1));
    keys();
    await waitFor(() =>
      expect(e1.openFile).toHaveBeenCalledWith(A, { navigation: { kind: 'history', index: 0, filePath: A } }),
    );
  });

  it('the MAIN window’s NavigationChrome leaves the chord to app.tsx, so it is never handled twice', async () => {
    ws = await mountWorkspace(editorsLayout(), {
      throng: { editor: { openInto: () => Promise.resolve({ action: 'open' }) } },
      extras: [createElement(NavigationChrome, { key: 'nav' })],
    });
    const e1 = asEditor('e1');
    setPanelHistory('e1', history([A, B], 1));
    keys();
    await new Promise((r) => setTimeout(r, 20));
    expect(e1.openFile).not.toHaveBeenCalled();
  });
});

describe('US7b fix round 2, item 2 — the sub-workspace listener honours the transient-input guard (FR-105)', () => {
  const altLeft = (): void => {
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
  };
  const ctrlG = (): void => {
    fireEvent.keyDown(document.body, { key: 'g', code: 'KeyG', ctrlKey: true });
  };

  async function mountSub(): Promise<{ e1: ReturnType<typeof asEditor> }> {
    ws = await mountWorkspace(editorsLayout(), {
      throng: { editor: { openInto: () => Promise.resolve({ action: 'open' }) } },
      extras: [
        createElement(
          SubWorkspaceWindowContext.Provider,
          { key: 'sub', value: { id: 'sub-1', name: 'Sub', colour: '#336699' } },
          createElement(NavigationChrome),
        ),
        // A plain input, standing in for a find bar / Quick Open filter box — `transientInputFocused`
        // only cares about the focused element's tag, not which surface drew it.
        createElement('input', { key: 'find-bar', 'data-testid': 'fake-transient-input' }),
      ],
    });
    const e1 = asEditor('e1');
    setPanelHistory('e1', history([A, B], 1));
    return { e1 };
  }

  it('a focused transient input swallows Alt+Left for CodeMirror, exactly as `app.tsx` does', async () => {
    const { e1 } = await mountSub();
    (screen.getByTestId('fake-transient-input') as HTMLInputElement).focus();

    altLeft();

    await new Promise((r) => setTimeout(r, 20));
    expect(e1.openFile).not.toHaveBeenCalled();
  });

  it('a focused transient input swallows Go To Line the same way', async () => {
    await mountSub();
    (screen.getByTestId('fake-transient-input') as HTMLInputElement).focus();

    ctrlG();

    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('gotoline-input')).toBeNull();
  });

  it('control: with nothing transient focused, both chords still fire', async () => {
    const { e1 } = await mountSub();
    document.body.focus();

    altLeft();
    await waitFor(() =>
      expect(e1.openFile).toHaveBeenCalledWith(A, { navigation: { kind: 'history', index: 0, filePath: A } }),
    );

    ctrlG();
    await waitFor(() => expect(screen.getByTestId('gotoline-input')).toBeInTheDocument());
  });
});

describe('US7b fix round 1, item 3 — Back onto a deleted file shows the could-not-read banner (FR-106d)', () => {
  it('the banner names the entry’s file, and Forward returns to the previous file', async () => {
    ed = mountEditor({
      doc: { text: 'const b = 1;\n', version: 1, absPath: 'C:/proj/b.ts' },
      withHeader: true,
      registerProject: true,
    });
    await waitFor(() => expect(getEditorActions('p-ed')).toBeDefined());
    act(() => setPanelHistory('p-ed', history(['C:/proj/gone.ts', 'C:/proj/b.ts'], 1)));

    // The harness answers a load of a file it holds nothing for with `io` — could not read.
    fireEvent.click(screen.getByTestId('panel-back-p-ed'));

    const banner = await screen.findByTestId('panel-failure-p-ed');
    expect(banner.textContent).toContain('gone.ts');
    await waitFor(() => expect(screen.getByTestId('panel-file-p-ed').textContent).toContain('gone.ts'));

    // Main moved the position; its broadcast reaches the mirror.
    act(() => setPanelHistory('p-ed', history(['C:/proj/gone.ts', 'C:/proj/b.ts'], 0)));
    ed.serve({ text: 'const b = 1;\n', version: 3, absPath: 'C:/proj/b.ts' });
    fireEvent.click(screen.getByTestId('panel-forward-p-ed'));

    await waitFor(() => expect(screen.queryByTestId('panel-failure-p-ed')).toBeNull());
    expect(screen.getByTestId('panel-file-p-ed').textContent).toContain('b.ts');
    expect(ed.calls.load).toHaveBeenLastCalledWith(
      expect.objectContaining({ absPath: 'C:/proj/b.ts', navigation: { kind: 'history', index: 1, filePath: 'C:/proj/b.ts' } }),
    );
  });
});

describe('US7b fix round 1, item 6 — every editor load carries config.history (§6)', () => {
  const persisted = { v: 1, entries: [{ filePath: 'C:/proj/a.ts' }, { filePath: 'C:/proj/b.ts' }], index: 1 };

  it('the restoring mount load sends it beside the path', async () => {
    ed = mountEditor({
      doc: { text: 'const b = 1;\n', version: 1, absPath: 'C:/proj/b.ts' },
      panelConfig: { history: persisted },
      restoreByLoad: true,
    });
    await waitFor(() =>
      expect(ed!.calls.load).toHaveBeenCalledWith(expect.objectContaining({ absPath: 'C:/proj/b.ts', history: persisted })),
    );
  });

  it('an in-place open sends it too', async () => {
    ed = mountEditor({
      doc: { text: 'const b = 1;\n', version: 1, absPath: 'C:/proj/b.ts' },
      panelConfig: { history: persisted },
    });
    await waitFor(() => expect(getEditorActions('p-ed')).toBeDefined());
    await ed.openFile({ text: 'const c = 1;\n', version: 2, absPath: 'C:/proj/c.ts' });
    expect(ed.calls.load).toHaveBeenCalledWith(expect.objectContaining({ absPath: 'C:/proj/c.ts', history: persisted }));
  });
});

describe('an editor’s history reaches this window on mount (T158)', () => {
  it('a remount onto an open document attaches with the persisted history and mirrors the answer', async () => {
    const persisted = { v: 1, entries: [{ filePath: 'C:/proj/a.ts' }, { filePath: 'C:/proj/b.ts' }], index: 1 };
    const attach = vi.fn(() => Promise.resolve(history(['C:/proj/a.ts', 'C:/proj/b.ts'], 1)));
    ed = mountEditor({
      doc: { text: 'x\n', version: 1, absPath: 'C:/proj/b.ts' },
      withHeader: true,
      panelConfig: { history: persisted },
      throng: { history: { attach, purge: vi.fn(), setViewState: vi.fn(), onChanged: () => () => {} } },
    });
    await waitFor(() => expect(attach).toHaveBeenCalledWith({ panelId: 'p-ed', panelKind: 'editor', persisted }));
    await waitFor(() => expect((screen.getByTestId('panel-back-p-ed') as HTMLButtonElement).disabled).toBe(false));
  });
});

describe('a preview (FR-102, FR-107, FR-106b, FR-106c)', () => {
  const DOC = ['# Readme', '', 'One.', '', '## Two', '', 'Two text.', '', '## Three', '', 'Three text.'].join('\n');
  const SETUP_TEXT = '# Setup\n\nIntro.\n\n## Install\n\nSteps.\n';

  /** Supply layout: the host's viewport starts at y 100; each source line is 20px (as preview-follow does). */
  function withGeometry(): void {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
      const scroller = document.querySelector<HTMLElement>('.preview-panel__body');
      if (this === scroller) return { top: 100, height: 400, left: 0, width: 400 } as DOMRect;
      const line = Number(this.getAttribute('data-source-line'));
      return { top: 100 + line * 20 - (scroller?.scrollTop ?? 0), height: 40, left: 0, width: 400 } as DOMRect;
    });
  }

  async function mount(): Promise<{ id: string; host: () => HTMLElement }> {
    withGeometry();
    pv = await mountMarkdownPreview(DOC);
    await screen.findByText('Two text.', {}, COLD);
    const id = pv.id;
    act(() => pv!.ws().setActivePanel(pv!.ws().layout!.tabs[0].id, id));
    // README is current, SETUP is older.
    setPanelHistory(id, history([SETUP, README], 1));
    return { id, host: () => screen.getByTestId(`preview-body-${id}`) };
  }

  it('Back sends navigate with the history intent and the view state captured before the call', async () => {
    const { id, host } = await mount();
    host().scrollTop = 90;
    const expected = captureScrollAnchor(host());
    expect(expected).not.toBeNull();
    pv!.preview.navigate.mockResolvedValue({ kind: 'focusedOther', panelId: 'other' });

    await act(() => navigateFocusedHistory(pv!.ws(), 'back'));

    expect(pv!.preview.navigate).toHaveBeenCalledTimes(1);
    expect(pv!.preview.navigate).toHaveBeenCalledWith({
      panelId: id,
      target: { absPath: SETUP },
      intent: { kind: 'history', index: 0 },
      leavingViewState: expected,
    });
  });

  it('shown → applies the update and restores its view state (FR-107)', async () => {
    const { id, host } = await mount();
    const reply: PreviewNavigateResponse = {
      kind: 'shown',
      update: previewUpdate({
        panelId: id,
        filePath: SETUP,
        revision: 5,
        // A step onto ANOTHER file is a navigation, and main raises the run's count for it (T177).
        navigationSeq: 1,
        content: { kind: 'text', text: SETUP_TEXT },
        viewState: { line: 4, offsetRatio: 0 },
      }),
    };
    pv!.preview.navigate.mockResolvedValue(reply);

    await act(() => navigateFocusedHistory(pv!.ws(), 'back'));

    await waitFor(() => expect(screen.getByText('Steps.')).toBeInTheDocument());
    expect(getPreviewState(id)?.filePath).toBe(SETUP);
    // `## Install` is on line 4: restored to the top of the body.
    await waitFor(() => expect(host().scrollTop).toBe(80));
  });

  it('refused → exactly one notice naming the file, and nothing else changes (FR-106c)', async () => {
    const { id } = await mount();
    const before = getPreviewState(id);
    pv!.preview.navigate.mockResolvedValue({ kind: 'refused', notice: { kind: 'history-refused', target: SETUP } });

    await act(() => navigateFocusedHistory(pv!.ws(), 'back'));

    const notices = await screen.findAllByTestId(`preview-link-notice-${id}`);
    expect(notices).toHaveLength(1);
    expect(notices[0].getAttribute('data-notice-kind')).toBe('history-refused');
    expect(notices[0].textContent).toContain('setup.md');
    expect(getPreviewState(id)).toBe(before);
    expect(screen.getByText('Two text.')).toBeInTheDocument();
  });

  it('focusedOther → nothing changes in this panel (FR-106b)', async () => {
    const { id } = await mount();
    const before = getPreviewState(id);
    pv!.preview.navigate.mockResolvedValue({ kind: 'focusedOther', panelId: 'another' });

    await act(() => navigateFocusedHistory(pv!.ws(), 'back'));

    expect(getPreviewState(id)).toBe(before);
    expect(screen.queryByTestId(`preview-link-notice-${id}`)).toBeNull();
    expect(screen.getByText('Two text.')).toBeInTheDocument();
  });

  it('fix round 1, item 4 — a REMOUNT restores the place the re-attach names, not the one the store held (FR-107)', async () => {
    const { id } = await mount();
    const A_PLACE = { line: 4, offsetRatio: 0 };
    const B_PLACE = { line: 8, offsetRatio: 0 };
    // The store holds place A for this run: main's last update carried it.
    pv!.push(previewUpdate({ panelId: id, filePath: README, revision: 2, content: { kind: 'text', text: DOC }, viewState: A_PLACE }));
    expect(getPreviewState(id)?.viewState).toEqual(A_PLACE);

    // A tab switch: the view detaches (telling main where the reader was — B) and later re-attaches. Main's
    // attach answers the run's UNCHANGED revision, now carrying B.
    pv!.preview.attach.mockImplementation((req) =>
      Promise.resolve({
        ok: true as const,
        update: previewUpdate({ panelId: req.panelId, filePath: README, revision: 2, content: { kind: 'text', text: DOC }, viewState: B_PLACE }),
      }),
    );
    const tabId = pv!.ws().layout!.tabs[0].id;
    act(() => pv!.ws().clearPanelType(id));
    act(() => pv!.ws().setPanelType(id, 'preview', { filePath: README }));
    await screen.findByText('Two text.', {}, COLD);
    expect(pv!.ws().layout!.tabs[0].id).toBe(tabId);

    // `## Three` is on line 8: the re-attach's place, at the top of the body.
    await waitFor(() => expect(screen.getByTestId(`preview-body-${id}`).scrollTop).toBe(160));
  });

  /*
   * 044 T192 (FR-115, US7 scenario 7) — jump entries and file entries are one sequence. The mirrored history is
   * README, then guide.md at its top, then guide.md at a heading the reader jumped to. Back steps to the top of
   * guide.md IN PLACE — main answers a same-file step with `content: null` and the entry's place — and the next
   * Back goes to README.
   */
  it('FR-115 — Back steps through a heading jump to the top of the document, then to the previous document', async () => {
    const GUIDE = `${ROOT}/docs/guide.md`;
    const TOP = { line: 0, offsetRatio: 0 };
    const AT_THREE = { line: 8, offsetRatio: 0 };
    withGeometry();
    pv = await mountMarkdownPreview(DOC, GUIDE);
    await screen.findByText('Two text.', {}, COLD);
    const id = pv.id;
    const host = (): HTMLElement => screen.getByTestId(`preview-body-${id}`);
    act(() => pv!.ws().setActivePanel(pv!.ws().layout!.tabs[0].id, id));
    const mirrored = (index: number): NavigationHistory => ({
      entries: [{ filePath: README }, { filePath: GUIDE, viewState: TOP }, { filePath: GUIDE, viewState: AT_THREE }],
      index,
    });
    setPanelHistory(id, mirrored(2));
    // Where the jump left the reader: `## Three`, line 8, at the top of the body.
    host().scrollTop = 160;
    const drawn = screen.getByText('Three text.');

    pv!.preview.navigate.mockImplementationOnce((req) =>
      Promise.resolve({
        kind: 'shown',
        update: previewUpdate({ panelId: req.panelId, filePath: GUIDE, revision: 2, content: null, viewState: TOP }),
      }),
    );
    await act(() => navigateFocusedHistory(pv!.ws(), 'back'));

    expect(pv!.preview.navigate).toHaveBeenCalledTimes(1);
    expect(pv!.preview.navigate).toHaveBeenLastCalledWith({
      panelId: id,
      target: { absPath: GUIDE },
      intent: { kind: 'history', index: 1 },
      leavingViewState: AT_THREE,
    });
    // The top of guide.md, restored in place: the same drawn document, not a redraw.
    await waitFor(() => expect(host().scrollTop).toBe(0));
    expect(screen.getByText('Three text.')).toBe(drawn);
    expect(getPreviewState(id)?.content).toEqual({ kind: 'text', text: DOC });

    // Main broadcasts the moved position; the next Back names README.
    act(() => setPanelHistory(id, mirrored(1)));
    pv!.preview.navigate.mockImplementationOnce(() => new Promise(() => {}));
    await act(() => navigateFocusedHistory(pv!.ws(), 'back'));
    expect(pv!.preview.navigate).toHaveBeenCalledTimes(2);
    expect(pv!.preview.navigate.mock.calls[1][0]).toMatchObject({
      target: { absPath: README },
      intent: { kind: 'history', index: 0 },
    });
  });

  it('a detaching view stores its place on its current entry first, so a re-attach restores it (§6)', async () => {
    const { id, host } = await mount();
    const setViewState = vi.fn();
    Reflect.set((window as unknown as { throng: Record<string, unknown> }).throng, 'history', {
      setViewState,
      purge: vi.fn(),
      attach: vi.fn(),
      onChanged: () => () => {},
    });
    host().scrollTop = 90;
    const expected = captureScrollAnchor(host());

    pv!.unmount();
    pv = undefined;

    expect(setViewState).toHaveBeenCalledWith(id, expected);
  });

  /*
   * U3b concern 1 — the top of the document is a PLACE, and the renderer never reports "no place" for it.
   * With it omitted, an entry left at the top keeps nothing; main's later step onto that entry then carries
   * no `viewState`, which the body cannot tell from an ordinary update — so Back moved the position and
   * left the reader at the heading they had jumped to. Both routes out of an entry send the explicit top.
   */
  describe('the top of the document is an explicit place (FR-107, FR-115)', () => {
    it('a history step from the top sends { line: 0, offsetRatio: 0 } as the place left', async () => {
      const { id, host } = await mount();
      expect(host().scrollTop).toBe(0);
      expect(captureScrollAnchor(host())).toBeNull();
      pv!.preview.navigate.mockResolvedValue({ kind: 'focusedOther', panelId: 'other' });

      await act(() => navigateFocusedHistory(pv!.ws(), 'back'));

      expect(pv!.preview.navigate).toHaveBeenCalledWith({
        panelId: id,
        target: { absPath: SETUP },
        intent: { kind: 'history', index: 0 },
        leavingViewState: { line: 0, offsetRatio: 0 },
      });
    });

    it('a view that detaches at the top stores the top, not “nothing”', async () => {
      const { id, host } = await mount();
      const setViewState = vi.fn();
      Reflect.set((window as unknown as { throng: Record<string, unknown> }).throng, 'history', {
        setViewState,
        purge: vi.fn(),
        attach: vi.fn(),
        onChanged: () => () => {},
      });
      expect(host().scrollTop).toBe(0);

      pv!.unmount();
      pv = undefined;

      expect(setViewState).toHaveBeenCalledWith(id, { line: 0, offsetRatio: 0 });
    });
  });
});
