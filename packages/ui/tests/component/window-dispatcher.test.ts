/**
 * 048 R5, FR-090 – FR-093 (#275) — ONE window dispatcher, the same code in the main window and in every
 * sub-workspace window.
 *
 * Each `WINDOW_HANDLED_ACTIONS` chord is pressed through the dispatcher mounted as each kind of window:
 *  - the main window consumes every one of them (the behaviour `app.tsx`'s `KeybindingsHandler` had);
 *  - a sub-workspace window consumes EXACTLY the same set (SC-012) — the ones with nothing to act on
 *    there are still consumed, never reaching a terminal, and say so on the active panel's status bar
 *    (FR-092) instead of doing nothing silently;
 *  - Quick Open, Go To Line and Back/Forward act in a sub-workspace window as in the main one (FR-093).
 */
import { act, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMAND_SCOPES,
  KEYBINDINGS_METADATA,
  createDefaultLayout,
  shippedBindingsFor,
  splitStrokes,
  type ActionId,
  type Panel,
  type WorkspaceLayout,
} from '@throng/core';
import {
  MAIN_WINDOW_CAPABILITIES,
  SUB_WORKSPACE_CAPABILITIES,
  SUB_WORKSPACE_UNAVAILABLE,
  WINDOW_HANDLED_ACTIONS,
  WindowDispatcher,
  type WindowCapabilities,
} from '../../src/renderer/keybindings/window-dispatcher.js';
import { UNBOUND_NOTICE_MS } from '../../src/renderer/keybindings/chord-engine.js';
import {
  getPendingChord,
  pendingChordText,
  setPendingChord,
} from '../../src/renderer/editor/pending-chord.js';
import { registerEditorActions, unregisterEditorActions, type EditorActions } from '../../src/renderer/editor/editor-actions.js';
import { __resetHistoryStore, setPanelHistory } from '../../src/renderer/navigation/history-store.js';
import {
  closeNavigationModal,
  navigationModal,
  registerQuickOpen,
} from '../../src/renderer/navigate/navigation-store.js';
import { registerFindInFilesOpener } from '../../src/renderer/find-in-files/open-find-in-files.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { chordEvent } from '../shared/chord-event.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
let m: MountedWorkspace | undefined;
let statusHost: HTMLElement | undefined;

const editor = (id: string): Panel => ({
  type: 'panel',
  id,
  originProjectId: PROJECT,
  title: id,
  kind: 'editor',
  config: { filePath: `D:/proj/${id}.ts` },
});

function layout(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = editor('p1');
  l.tabs[0].activePanelId = 'p1';
  return l;
}

async function mount(capabilities: WindowCapabilities): Promise<void> {
  m = await mountWorkspace(layout(), {
    extras: [createElement(WindowDispatcher, { key: 'dispatcher', capabilities })],
    throng: { editor: { openInto: () => Promise.resolve({ action: 'open' }) } },
  });
}

/** The active panel's box with a shown status bar, as `panel-placeholder.tsx` renders it. */
function panelBoxWithStatusBar(): HTMLElement {
  const box = document.createElement('div');
  box.setAttribute('data-panel-host', 'p1');
  const strip = document.createElement('div');
  strip.className = 'editor-status-strip';
  box.appendChild(strip);
  document.body.appendChild(box);
  return box;
}

const SHIPPED = shippedBindingsFor().bindings;

/** The single-stroke shipped chord of `action`, or undefined for one that ships none. */
function singleStroke(action: string): string | undefined {
  return (SHIPPED[action] ?? []).find((t) => (splitStrokes(t)?.length ?? 1) === 1);
}

/** Put the keyboard where `action` is live: the workspace (an editor panel) or the File Explorer. */
function paneFor(action: string): void {
  const scopes = COMMAND_SCOPES[action as ActionId];
  setActivePane(scopes.has('editor') ? 'workspace' : 'files');
}

/** Press `token`'s US keydown at a stand-in terminal; true when the dispatcher consumed it. */
function pressAtTerminal(token: string): { consumed: boolean; reachedTerminal: boolean } {
  const terminal = document.createElement('textarea');
  const reached = vi.fn();
  terminal.addEventListener('keydown', reached);
  document.body.appendChild(terminal);
  try {
    let notTaken = true;
    act(() => {
      notTaken = fireEvent.keyDown(terminal, chordEvent(token));
    });
    return { consumed: !notTaken, reachedTerminal: reached.mock.calls.length > 0 };
  } finally {
    terminal.remove();
  }
}

const labelOf = (action: string): string =>
  KEYBINDINGS_METADATA.find((d) => d.key === action)?.label ?? action;

const PRESSABLE = [...WINDOW_HANDLED_ACTIONS].filter((a) => singleStroke(a) !== undefined);

beforeEach(() => {
  __resetHistoryStore();
  setActivePane('workspace');
  setPendingChord(null);
});

afterEach(() => {
  vi.useRealTimers();
  unregisterEditorActions('p1');
  registerQuickOpen(null);
  registerFindInFilesOpener(null);
  closeNavigationModal();
  setPendingChord(null);
  statusHost?.remove();
  statusHost = undefined;
  setActivePane('workspace');
  m?.unmount();
  m = undefined;
});

describe('the sub-workspace unavailable set (FR-092)', () => {
  it('is exactly the eleven commands with nothing to act on in a sub-workspace window', () => {
    expect([...SUB_WORKSPACE_UNAVAILABLE].sort()).toEqual(
      [
        'project.next',
        'project.previous',
        'focus.projects',
        'focus.explorer',
        'view.toggleProjects',
        'view.toggleExplorer',
        'file.undo',
        'file.redo',
        'search.findInFiles',
        'search.replaceInFiles',
        'focus.notice',
      ].sort(),
    );
    for (const a of SUB_WORKSPACE_UNAVAILABLE) expect(WINDOW_HANDLED_ACTIONS.has(a)).toBe(true);
  });

  it('the capabilities agree with it: main has everything, a sub-workspace lacks exactly that set', () => {
    for (const a of WINDOW_HANDLED_ACTIONS) {
      expect(MAIN_WINDOW_CAPABILITIES.has(a as ActionId)).toBe(true);
      expect(SUB_WORKSPACE_CAPABILITIES.has(a as ActionId)).toBe(!SUB_WORKSPACE_UNAVAILABLE.has(a));
    }
    expect(MAIN_WINDOW_CAPABILITIES.kind).toBe('main');
    expect(SUB_WORKSPACE_CAPABILITIES.kind).toBe('sub-workspace');
  });
});

describe('every window chord resolves the same in both windows (FR-090, SC-012)', () => {
  it('has chords to press — the loop below is not vacuous', () => {
    expect(PRESSABLE.length).toBeGreaterThan(20);
  });

  for (const [name, caps] of [
    ['main', MAIN_WINDOW_CAPABILITIES],
    ['sub-workspace', SUB_WORKSPACE_CAPABILITIES],
  ] as const) {
    it(`${name}: each is consumed and never reaches a focused terminal`, async () => {
      await mount(caps);
      for (const action of PRESSABLE) {
        act(() => paneFor(action));
        const r = pressAtTerminal(singleStroke(action) as string);
        expect(r.consumed, `${action} (${singleStroke(action)}) was not consumed`).toBe(true);
        expect(r.reachedTerminal, `${action} reached the terminal`).toBe(false);
        act(() => closeNavigationModal());
      }
    });
  }
});

describe('a command with nothing to act on in a sub-workspace window (FR-092)', () => {
  for (const action of SUB_WORKSPACE_UNAVAILABLE) {
    it(`${action}: consumed, and the status bar says it is not available`, async () => {
      await mount(SUB_WORKSPACE_CAPABILITIES);
      statusHost = panelBoxWithStatusBar();
      const opened = vi.fn(() => true);
      registerFindInFilesOpener(opened);
      act(() => paneFor(action));

      const r = pressAtTerminal(singleStroke(action) as string);

      expect(r.consumed).toBe(true);
      expect(r.reachedTerminal).toBe(false);
      expect(opened, 'the command acted anyway').not.toHaveBeenCalled();
      const state = getPendingChord();
      expect(state?.kind).toBe('unavailable');
      expect(state?.host).toBe(statusHost);
      expect(pendingChordText(state!)).toBe(
        `${labelOf(action)} is not available in a sub-workspace window.`,
      );
    });
  }

  it('a panel with NO status bar still says so — on the panel itself (SC-012, FR-092)', async () => {
    await mount(SUB_WORKSPACE_CAPABILITIES);
    const box = document.createElement('div');
    box.setAttribute('data-panel-host', 'p1'); // a placeholder: no status bar at all
    document.body.appendChild(box);
    statusHost = box;
    pressAtTerminal(singleStroke('project.next') as string);
    const state = getPendingChord();
    expect(state?.kind).toBe('unavailable');
    expect(state?.host).toBe(box);
  });

  it('the notice lasts UNBOUND_NOTICE_MS, then clears', async () => {
    await mount(SUB_WORKSPACE_CAPABILITIES);
    statusHost = panelBoxWithStatusBar();
    vi.useFakeTimers();
    pressAtTerminal(singleStroke('focus.notice') as string);
    expect(getPendingChord()?.kind).toBe('unavailable');
    act(() => vi.advanceTimersByTime(UNBOUND_NOTICE_MS - 1));
    expect(getPendingChord()?.kind).toBe('unavailable');
    act(() => vi.advanceTimersByTime(1));
    expect(getPendingChord()).toBeNull();
  });

  it('the main window acts on the same chord and raises no notice', async () => {
    await mount(MAIN_WINDOW_CAPABILITIES);
    statusHost = panelBoxWithStatusBar();
    const opened = vi.fn(() => true);
    registerFindInFilesOpener(opened);
    pressAtTerminal(singleStroke('search.findInFiles') as string);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(getPendingChord()).toBeNull();
  });
});

describe('Quick Open, Go To Line and Back/Forward act in a sub-workspace window as today (FR-093)', () => {
  it('Quick Open asks the window to open it', async () => {
    await mount(SUB_WORKSPACE_CAPABILITIES);
    const opener = vi.fn(() => true);
    registerQuickOpen(opener);
    pressAtTerminal(singleStroke('navigate.quickOpen') as string);
    expect(opener).toHaveBeenCalledTimes(1);
    expect(getPendingChord()).toBeNull();
  });

  /*
   * 048 iterate round 1, defect D2 (FR-092, SC-012) — an editor the sub-workspace itself owns has no
   * project root, so the opener declines. In a sub-workspace window that is "nothing to act on here",
   * and the chord must say so rather than do nothing; in the main window a decline means no project is
   * open, which stays silent (033 FR-018).
   */
  it('Quick Open declined in a sub-workspace window: consumed, and the status bar says it is not available', async () => {
    await mount(SUB_WORKSPACE_CAPABILITIES);
    statusHost = panelBoxWithStatusBar();
    const opener = vi.fn(() => false);
    registerQuickOpen(opener);
    const r = pressAtTerminal(singleStroke('navigate.quickOpen') as string);
    expect(r.consumed).toBe(true);
    expect(r.reachedTerminal).toBe(false);
    expect(opener).toHaveBeenCalledTimes(1);
    const state = getPendingChord();
    expect(state?.kind).toBe('unavailable');
    expect(state?.host).toBe(statusHost);
    expect(pendingChordText(state!)).toBe(
      `${labelOf('navigate.quickOpen')} is not available in a sub-workspace window.`,
    );
  });

  it('Quick Open declined in the main window stays silent (033 FR-018)', async () => {
    await mount(MAIN_WINDOW_CAPABILITIES);
    statusHost = panelBoxWithStatusBar();
    const opener = vi.fn(() => false);
    registerQuickOpen(opener);
    const r = pressAtTerminal(singleStroke('navigate.quickOpen') as string);
    expect(r.consumed).toBe(true);
    expect(opener).toHaveBeenCalledTimes(1);
    expect(getPendingChord()).toBeNull();
  });

  it('Go To Line opens over the active editor', async () => {
    await mount(SUB_WORKSPACE_CAPABILITIES);
    pressAtTerminal(singleStroke('navigate.gotoLine') as string);
    expect(navigationModal()).toEqual({ kind: 'gotoLine', panelId: 'p1' });
  });

  it('Back steps the focused editor’s history', async () => {
    await mount(SUB_WORKSPACE_CAPABILITIES);
    const openFile = vi.fn(() => Promise.resolve());
    registerEditorActions('p1', {
      save: () => Promise.resolve(true),
      saveAs: () => Promise.resolve(true),
      isDirty: () => false,
      openFile,
      revert: () => {},
      reloadFromDisk: () => Promise.resolve(true),
    } as EditorActions);
    setPanelHistory('p1', {
      entries: [{ filePath: 'D:/proj/a.ts' }, { filePath: 'D:/proj/p1.ts' }],
      index: 1,
    });
    pressAtTerminal(singleStroke('navigate.back') as string);
    await vi.waitFor(() =>
      expect(openFile).toHaveBeenCalledWith('D:/proj/a.ts', expect.anything()),
    );
  });
});
