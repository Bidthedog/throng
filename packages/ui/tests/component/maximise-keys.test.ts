/**
 * 054 FR-071, FR-071a — `panel.toggleMaximise` (`Alt+Shift+Enter`) from the keyboard, and the two Enter
 * chords it must leave alone.
 *
 * Layer: component — the claim is about the WINDOW DISPATCHER's capture-phase gate: which keydowns it
 * takes before a focused terminal or editor sees them. jsdom runs the real dispatcher over stand-in
 * `.xterm` and `.cm-editor` surfaces; that a real shell still receives Shift+Enter's bytes is
 * `e2e/maximise-terminal.e2e.ts` (T069).
 */
import { act, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { MAIN_WINDOW_CAPABILITIES, WindowDispatcher } from '../../src/renderer/keybindings/window-dispatcher.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { __resetMaximise, getMaximiseStack, maximisePanel, restoreAll } from '../../src/renderer/workspace/maximise-store.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
const MAXIMISE = { key: 'Enter', code: 'Enter', altKey: true, shiftKey: true } as const;
const SHIFT_ENTER = { key: 'Enter', code: 'Enter', shiftKey: true } as const;
const CTRL_ENTER = { key: 'Enter', code: 'Enter', ctrlKey: true } as const;

let m: MountedWorkspace | undefined;
const cleanup: HTMLElement[] = [];

const panel = (id: string, kind: string): Panel => ({ type: 'panel', id, originProjectId: PROJECT, title: id, kind });

/** p1 (terminal) beside p2 (editor), p1 the active panel. */
function twoPanels(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = {
    type: 'split',
    orientation: 'row',
    sizes: [0.5, 0.5],
    children: [panel('p1', 'terminal'), panel('p2', 'editor')],
  };
  l.tabs[0].activePanelId = 'p1';
  return l;
}

/**
 * A stand-in panel box, as `panel-placeholder.tsx` marks it, holding the focusable surface a terminal
 * (xterm's helper textarea inside `.xterm`) or an editor (`.cm-editor`'s content) puts focus on.
 */
function surface(panelId: string, kind: 'terminal' | 'editor'): { el: HTMLElement; reached: ReturnType<typeof vi.fn> } {
  const box = document.createElement('div');
  box.setAttribute('data-panel-host', panelId);
  document.body.appendChild(box);
  cleanup.push(box);
  const host = document.createElement('div');
  host.className = kind === 'terminal' ? 'xterm' : 'cm-editor';
  box.appendChild(host);
  const el = document.createElement(kind === 'terminal' ? 'textarea' : 'div');
  if (kind === 'editor') {
    el.className = 'cm-content';
    el.setAttribute('contenteditable', 'true');
  }
  el.tabIndex = 0;
  host.appendChild(el);
  const reached = vi.fn();
  // What xterm's key handler and CodeMirror's keymap see: the keydown, unprevented, at the surface.
  el.addEventListener('keydown', (e) => reached(e.defaultPrevented));
  return { el, reached };
}

/** Press at `target`; true when the dispatcher consumed it. */
function press(target: Element, init: KeyboardEventInit): boolean {
  let notTaken = true;
  act(() => {
    notTaken = fireEvent.keyDown(target, init);
  });
  return !notTaken;
}

const shape = (): string[] => getMaximiseStack('t1').map((t) => `${t.kind}:${t.panelId}`);

beforeEach(async () => {
  __resetMaximise();
  setActivePane('workspace');
  m = await mountWorkspace(twoPanels(), {
    extras: [createElement(WindowDispatcher, { key: 'dispatcher', capabilities: MAIN_WINDOW_CAPABILITIES })],
  });
});

afterEach(() => {
  for (const el of cleanup.splice(0)) el.remove();
  m?.unmount();
  m = undefined;
  __resetMaximise();
  setActivePane('workspace');
});

describe('Alt+Shift+Enter maximises the focused panel (FR-071a)', () => {
  for (const [kind, id] of [
    ['terminal', 'p1'],
    ['editor', 'p2'],
  ] as const) {
    it(`from a focused ${kind}: consumed, never reaching it, and maximises THAT panel`, () => {
      const { el, reached } = surface(id, kind);
      el.focus();
      expect(press(el, MAXIMISE)).toBe(true);
      expect(reached).not.toHaveBeenCalled();
      expect(shape()).toEqual([`panel:${id}`]);
    });
  }

  it('pressed again restores the tab', () => {
    const { el } = surface('p1', 'terminal');
    el.focus();
    press(el, MAXIMISE);
    press(el, MAXIMISE);
    expect(shape()).toEqual([]);
  });

  it('with focus nowhere in particular it maximises the active panel', () => {
    expect(press(document.body, MAXIMISE)).toBe(true);
    expect(shape()).toEqual(['panel:p1']);
  });

  it('with focus in a side pane it maximises nothing and leaves the key to the pane', () => {
    const tree = document.createElement('div');
    tree.tabIndex = 0;
    document.body.appendChild(tree);
    cleanup.push(tree);
    tree.focus();
    setActivePane('files');
    expect(press(tree, MAXIMISE)).toBe(false);
    expect(shape()).toEqual([]);
  });
});

/**
 * Review finding 1 (FR-074) — a maximised tab hides every other panel, so the move/cycle chords must not
 * make one active: it could not be seen and `panel.destroy` would then close it unseen.
 * Layer: component — the claim is about the WINDOW DISPATCHER's own candidate filtering.
 */
describe('move/cycle focus never targets a hidden panel (FR-074)', () => {
  const activeId = (): string | undefined => m!.ws().layout!.tabs[0].activePanelId;
  const FOCUS_RIGHT = { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, shiftKey: true, altKey: true } as const;
  const CYCLE = { key: '`', code: 'Backquote', ctrlKey: true } as const;
  const CYCLE_BACK = { key: '`', code: 'Backquote', ctrlKey: true, shiftKey: true } as const;

  it.each([
    ['focus.right', FOCUS_RIGHT],
    ['focus.cycle', CYCLE],
    ['focus.cycleBack', CYCLE_BACK],
  ] as const)('%s leaves the maximised panel active', (_name, chord) => {
    act(() => maximisePanel('t1', 'p1'));
    press(document.body, chord);
    expect(activeId()).toBe('p1');
  });

  it('once restored, the same chord moves again', () => {
    act(() => maximisePanel('t1', 'p1'));
    act(() => restoreAll('t1'));
    press(document.body, FOCUS_RIGHT);
    expect(activeId()).toBe('p2');
  });
});

describe('Shift+Enter and Ctrl+Enter keep their behaviour (FR-071a)', () => {
  for (const kind of ['terminal', 'editor'] as const) {
    for (const [name, chord] of [
      ['Shift+Enter', SHIFT_ENTER],
      ['Ctrl+Enter', CTRL_ENTER],
    ] as const) {
      it(`${name} in a focused ${kind} reaches it unconsumed and maximises nothing`, () => {
        const { el, reached } = surface(kind === 'terminal' ? 'p1' : 'p2', kind);
        el.focus();
        expect(press(el, chord)).toBe(false);
        expect(reached).toHaveBeenCalledTimes(1);
        expect(reached).toHaveBeenCalledWith(false);
        expect(shape()).toEqual([]);
      });
    }
  }
});
