/**
 * 048 US3 (FR-020a – FR-025, SC-004) — split mode, driven through the real window dispatcher.
 *
 * `Ctrl+Shift+Alt+End` starts split mode on the active panel; an arrow — with those modifiers held or
 * released — splits it that way; Escape, any other key, the timeout, a blur or another panel ends it
 * with no split. The ending by a menu opening or a drag starting is `ui`'s (T032, their own tests);
 * here, only the store's side of it: an outside `endSplitMode()` ends the engine too.
 *
 * The pulse's own class (`panel-box__split-mode`) is drawn by `panel-placeholder.tsx` from
 * `useSplitMode`; this file asserts the store that drives it, and the pending text the dispatcher
 * publishes onto a panel box that shows a status bar.
 */
import { act, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectPanels,
  createDefaultLayout,
  type LayoutNode,
  type Panel,
  type WorkspaceLayout,
} from '@throng/core';
import {
  MAIN_WINDOW_CAPABILITIES,
  WindowDispatcher,
} from '../../src/renderer/keybindings/window-dispatcher.js';
import { TWO_STROKE_TIMEOUT_MS } from '../../src/renderer/keybindings/chord-engine.js';
import { getPendingChord, pendingChordText, setPendingChord } from '../../src/renderer/editor/pending-chord.js';
import { __resetSplitMode, endSplitMode, getSplitModePanel } from '../../src/renderer/workspace/split-mode.js';
import { getActivePane, setActivePane } from '../../src/renderer/workspace/active-pane.js';
import {
  __resetPanelFocus,
  registerPanelFocus,
} from '../../src/renderer/workspace/panel-focus.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
let m: MountedWorkspace | undefined;
const cleanup: HTMLElement[] = [];

const editor = (id: string): Panel => ({
  type: 'panel',
  id,
  originProjectId: PROJECT,
  title: id,
  kind: 'editor',
  config: { filePath: `D:/proj/${id}.ts` },
});

/** p1 over p2 — so `focus.down` from p1 WOULD move to p2, which is what FR-020a must prevent. */
function column(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = {
    type: 'split',
    orientation: 'column',
    sizes: [0.5, 0.5],
    children: [editor('p1'), editor('p2')],
  };
  l.tabs[0].activePanelId = 'p1';
  return l;
}

const tab = () => m!.ws().layout!.tabs[0]!;
const active = (): string | undefined => tab().activePanelId;
const panelIds = (): string[] => collectPanels(tab().root).map((p) => p.id);

function mounted(el: HTMLElement): HTMLElement {
  document.body.appendChild(el);
  cleanup.push(el);
  return el;
}

/** p1's box, showing a status bar — where the pending text goes (FR-021). */
function boxWithStatusBar(id = 'p1'): HTMLElement {
  const box = document.createElement('div');
  box.setAttribute('data-panel-host', id);
  const strip = document.createElement('div');
  strip.className = 'terminal-status-bar';
  box.appendChild(strip);
  return mounted(box);
}

/** A focused stand-in for a terminal's textarea, recording every key that reaches it. */
function terminal(): { el: HTMLTextAreaElement; reached: ReturnType<typeof vi.fn> } {
  const el = mounted(document.createElement('textarea')) as HTMLTextAreaElement;
  const reached = vi.fn();
  el.addEventListener('keydown', reached);
  el.focus();
  return { el, reached };
}

const HELD = { ctrlKey: true, shiftKey: true, altKey: true } as const;

/** Press a key at `target`; returns whether it was consumed (default prevented). */
function press(
  target: HTMLElement,
  key: string,
  mods: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {},
  code = key,
): boolean {
  let notTaken = true;
  act(() => {
    notTaken = fireEvent.keyDown(target, { key, code, ...mods });
  });
  return !notTaken;
}
const firstStroke = (target: HTMLElement): boolean => press(target, 'End', HELD);

/** The panel the split placed `dir` of p1: its parent split's orientation and p1's index in it. */
function parentOf(id: string, node: LayoutNode = tab().root): { orientation: string; ids: string[] } | null {
  if (node.type !== 'split') return null;
  const ids = node.children.map((c) => (c.type === 'panel' ? c.id : ''));
  if (ids.includes(id)) return { orientation: node.orientation, ids };
  for (const c of node.children) {
    const hit = parentOf(id, c);
    if (hit) return hit;
  }
  return null;
}

let focused: string[];

beforeEach(async () => {
  __resetSplitMode();
  __resetPanelFocus();
  setPendingChord(null);
  setActivePane('workspace');
  m = await mountWorkspace(column(), {
    extras: [createElement(WindowDispatcher, { key: 'dispatcher', capabilities: MAIN_WINDOW_CAPABILITIES })],
  });
  focused = [];
  registerPanelFocus('p1', () => focused.push('p1'));
  registerPanelFocus('p2', () => focused.push('p2'));
});

afterEach(() => {
  vi.useRealTimers();
  for (const el of cleanup.splice(0)) el.remove();
  setPendingChord(null);
  __resetSplitMode();
  __resetPanelFocus();
  setActivePane('workspace');
  m?.unmount();
  m = undefined;
});

describe('the first stroke starts split mode on the active panel (FR-021)', () => {
  it('pulse state and pending text appear with the key event itself (SC-004)', () => {
    const box = boxWithStatusBar();
    const t = terminal();
    expect(firstStroke(t.el)).toBe(true);
    // Synchronously — no await, no timer: the pulse and the text are there when the event returns.
    expect(getSplitModePanel()).toBe('p1');
    const state = getPendingChord();
    expect(state?.host).toBe(box);
    expect(pendingChordText(state!)).toBe(
      '(Ctrl+Shift+Alt+End) was pressed. Waiting for the next key of the chord…',
    );
  });

  it('a panel with no status bar shows the pulse alone', () => {
    const t = terminal();
    firstStroke(t.el);
    expect(getSplitModePanel()).toBe('p1');
    expect(getPendingChord()).toBeNull();
  });

  for (const side of ['files', 'projects'] as const) {
    it(`from the ${side === 'files' ? 'File Explorer' : 'project list'}, keyboard focus moves to the panel`, () => {
      const tree = mounted(document.createElement('div'));
      tree.tabIndex = 0;
      tree.focus();
      act(() => setActivePane(side));
      expect(firstStroke(tree)).toBe(true);
      expect(getSplitModePanel()).toBe('p1');
      expect(getActivePane()).toBe('workspace');
      expect(focused).toEqual(['p1']);
    });
  }

  it('from a find bar, keyboard focus moves to the panel', () => {
    const bar = mounted(document.createElement('div'));
    bar.setAttribute('data-find-bar', '');
    const input = document.createElement('input');
    bar.appendChild(input);
    input.focus();
    expect(firstStroke(input)).toBe(true);
    expect(getSplitModePanel()).toBe('p1');
    expect(focused).toEqual(['p1']);
  });
});

describe('an arrow completes it (FR-020a, FR-022)', () => {
  it('ArrowDown with Ctrl+Shift+Alt still held splits DOWN, and does not run focus.down', () => {
    const t = terminal();
    firstStroke(t.el);
    expect(press(t.el, 'ArrowDown', HELD)).toBe(true);
    const parent = parentOf('p1');
    expect(parent?.orientation).toBe('column');
    expect(parent?.ids[0]).toBe('p1');
    expect(parent?.ids).not.toContain('p2'); // p1's own leaf was split — p2 is untouched elsewhere
    expect(panelIds()).toHaveLength(3);
    expect(active()).not.toBe('p2'); // focus.down would have moved here
    expect(active()).toBe(parent?.ids[1]);
    expect(getSplitModePanel()).toBeNull();
  });

  it('ArrowDown with the modifiers released splits down too', () => {
    const t = terminal();
    firstStroke(t.el);
    act(() => {
      fireEvent.keyUp(t.el, { key: 'Control', code: 'ControlLeft' });
    });
    expect(press(t.el, 'ArrowDown')).toBe(true);
    expect(parentOf('p1')?.orientation).toBe('column');
    expect(panelIds()).toHaveLength(3);
  });

  it('ArrowRight splits RIGHT: p1 and its new panel side by side', () => {
    const t = terminal();
    firstStroke(t.el);
    press(t.el, 'ArrowRight');
    const parent = parentOf('p1');
    expect(parent?.orientation).toBe('row');
    expect(parent?.ids[0]).toBe('p1');
  });

  it('the pulse and the text end with the completing key', () => {
    boxWithStatusBar();
    const t = terminal();
    firstStroke(t.el);
    press(t.el, 'ArrowUp');
    expect(getSplitModePanel()).toBeNull();
    expect(getPendingChord()).toBeNull();
  });
});

describe('the endings that cancel (FR-022)', () => {
  it('Escape: consumed, closes no bar, splits nothing, and focus stays on the panel', () => {
    boxWithStatusBar();
    const t = terminal();
    const barClosed = vi.fn();
    window.addEventListener('keydown', barClosed); // a bubble-phase find-bar Escape handler
    try {
      firstStroke(t.el);
      expect(press(t.el, 'Escape')).toBe(true);
      expect(barClosed).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', barClosed);
    }
    expect(getSplitModePanel()).toBeNull();
    expect(getPendingChord()).toBeNull();
    expect(panelIds()).toEqual(['p1', 'p2']);
    expect(active()).toBe('p1');
    expect(getActivePane()).toBe('workspace');
  });

  it('another key: consumed, and reported as not bound', () => {
    const box = boxWithStatusBar();
    const t = terminal();
    firstStroke(t.el);
    expect(press(t.el, 'x', {}, 'KeyX')).toBe(true);
    expect(getSplitModePanel()).toBeNull();
    expect(panelIds()).toEqual(['p1', 'p2']);
    const state = getPendingChord();
    expect(state?.host).toBe(box);
    expect(pendingChordText(state!)).toBe('The key combination (Ctrl+Shift+Alt+End,X) is not bound.');
    expect(active()).toBe('p1');
  });

  it('the timeout ends it with no split', () => {
    vi.useFakeTimers();
    boxWithStatusBar();
    const t = terminal();
    firstStroke(t.el);
    act(() => vi.advanceTimersByTime(TWO_STROKE_TIMEOUT_MS));
    expect(getSplitModePanel()).toBeNull();
    expect(getPendingChord()).toBeNull();
    expect(panelIds()).toEqual(['p1', 'p2']);
    expect(active()).toBe('p1');
  });

  it('the window losing focus ends it', () => {
    const t = terminal();
    firstStroke(t.el);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(getSplitModePanel()).toBeNull();
  });

  it('another panel becoming active ends it', () => {
    const t = terminal();
    firstStroke(t.el);
    act(() => m!.ws().setActivePanel('t1', 'p2'));
    expect(getSplitModePanel()).toBeNull();
    // …and the arrow that follows is an ordinary key again, splitting nothing.
    press(t.el, 'ArrowDown');
    expect(panelIds()).toEqual(['p1', 'p2']);
  });

  it('an outside ending (a menu, a drag — T032) ends the engine too: the next arrow splits nothing', () => {
    boxWithStatusBar();
    const t = terminal();
    firstStroke(t.el);
    act(() => endSplitMode());
    expect(getPendingChord()).toBeNull();
    press(t.el, 'ArrowDown');
    expect(panelIds()).toEqual(['p1', 'p2']);
  });
});

describe('a second first stroke re-arms the timeout on the same panel (FR-025)', () => {
  it('pending for a full timeout after the SECOND press', () => {
    vi.useFakeTimers();
    const t = terminal();
    firstStroke(t.el);
    act(() => vi.advanceTimersByTime(TWO_STROKE_TIMEOUT_MS - 1000));
    firstStroke(t.el);
    act(() => vi.advanceTimersByTime(TWO_STROKE_TIMEOUT_MS - 1000));
    expect(getSplitModePanel()).toBe('p1');
    act(() => vi.advanceTimersByTime(1000));
    expect(getSplitModePanel()).toBeNull();
  });
});

describe('a split command rebound to a SINGLE stroke (FR-003)', () => {
  /** Remount with the user's keybindings: Split Down on one key, the other three as shipped. */
  async function remountWithSingleStrokeSplitDown(): Promise<void> {
    m?.unmount();
    m = await mountWorkspace(column(), {
      extras: [createElement(WindowDispatcher, { key: 'dispatcher', capabilities: MAIN_WINDOW_CAPABILITIES })],
      throng: {
        config: {
          get: () => Promise.resolve({ settings: {}, keybindings: { bindings: { 'panel.splitDown': ['Ctrl+Alt+F9'] } } }),
          onChange: () => () => {},
        },
      },
    });
  }

  it('splits the active panel that way, and the key is consumed', async () => {
    await remountWithSingleStrokeSplitDown();
    const t = terminal();
    let consumed = false;
    await vi.waitFor(() => {
      // The user's keybindings arrive asynchronously; press until the rebind is live, once.
      if (panelIds().length === 2) consumed = press(t.el, 'F9', { ctrlKey: true, altKey: true });
      expect(panelIds()).toHaveLength(3);
    });
    expect(consumed).toBe(true);
    expect(t.reached).not.toHaveBeenCalled();
    const parent = parentOf('p1');
    expect(parent?.orientation).toBe('column');
    expect(parent?.ids[0]).toBe('p1');
    expect(getSplitModePanel()).toBeNull(); // one stroke: no split mode in between
  });
});

describe('any window command on a multi-stroke chord (048 T060, FR-024)', () => {
  it('panel.zoomIn rebound to Ctrl+Shift+Alt+Home,Z zooms from a focused terminal, and neither stroke reaches it', async () => {
    m?.unmount();
    m = await mountWorkspace(column(), {
      extras: [createElement(WindowDispatcher, { key: 'dispatcher', capabilities: MAIN_WINDOW_CAPABILITIES })],
      throng: {
        config: {
          get: () =>
            Promise.resolve({ settings: {}, keybindings: { bindings: { 'panel.zoomIn': ['Ctrl+Shift+Alt+Home,Z'] } } }),
          onChange: () => () => {},
        },
      },
    });
    const zoomOf = (id: string): unknown => collectPanels(tab().root).find((p) => p.id === id)?.zoom;
    const before = zoomOf('p1');
    const t = terminal();
    const strokes: boolean[] = [];
    await vi.waitFor(() => {
      // The user's keybindings arrive asynchronously; press until the rebind is live, once.
      if (zoomOf('p1') === before) {
        strokes.length = 0;
        strokes.push(press(t.el, 'Home', HELD), press(t.el, 'z', HELD, 'KeyZ'));
      }
      expect(zoomOf('p1')).not.toEqual(before);
    });
    expect(strokes).toEqual([true, true]);
    expect(t.reached).not.toHaveBeenCalled();
    expect(getSplitModePanel(), 'a zoom prefix is not split mode').toBeNull();
    expect(panelIds()).toEqual(['p1', 'p2']);
  });
});

describe('neither stroke reaches a terminal (FR-023)', () => {
  for (const [name, second] of [
    ['a completed split', 'ArrowLeft'],
    ['a cancelled one', 'Escape'],
    ['an unbound second key', 'q'],
  ] as const) {
    it(`${name}: both strokes consumed and stopped`, () => {
      const t = terminal();
      expect(firstStroke(t.el)).toBe(true);
      expect(press(t.el, second, {}, second === 'q' ? 'KeyQ' : second)).toBe(true);
      expect(t.reached).not.toHaveBeenCalled();
    });
  }
});
