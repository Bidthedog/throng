/**
 * 067 T093 (FR-076, FR-079) — the `tabs.rename` chord reaches no running terminal program.
 *
 * Two layers hold it. The window dispatcher takes the chord in the capture phase, so a focused terminal's
 * textarea never sees it; and the terminal's own key handler, should an event ever reach it, reserves the
 * chord (keeps it off the pty and cancels the browser default) rather than letting xterm encode it as the
 * escape sequence a shell would receive. Plain `F2` is the program's and still is.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, DEFAULT_KEYBINDINGS } from '@throng/core';
import { MAIN_WINDOW_CAPABILITIES, WindowDispatcher } from '../../src/renderer/keybindings/window-dispatcher.js';
import { terminalReservesKeydown } from '../../src/renderer/search/search-actions.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { mountTabGroup, type MountedTabGroup } from './helpers/mount-tab-group.js';

const CHORD = { key: 'F2', code: 'F2', ctrlKey: true, shiftKey: true, altKey: true } as const;
let m: MountedTabGroup | undefined;
const extra: HTMLElement[] = [];

beforeEach(() => setActivePane('workspace'));
afterEach(() => {
  for (const el of extra.splice(0)) el.remove();
  m?.unmount();
  m = undefined;
});

const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', { cancelable: true, ...init });

describe('the terminal’s own key handler (FR-076)', () => {
  it('reserves the chord, so xterm never encodes it for the program', () => {
    expect(terminalReservesKeydown(DEFAULT_KEYBINDINGS, key(CHORD), false, false)).toBe(true);
    // And whether or not the program asked for the keyboard: it is a window command either way.
    expect(terminalReservesKeydown(DEFAULT_KEYBINDINGS, key(CHORD), false, true)).toBe(true);
  });

  it('does not reserve plain F2, nor F2 with only some of the modifiers (FR-079)', () => {
    expect(terminalReservesKeydown(DEFAULT_KEYBINDINGS, key({ key: 'F2', code: 'F2' }), false, false)).toBe(false);
    expect(
      terminalReservesKeydown(DEFAULT_KEYBINDINGS, key({ key: 'F2', code: 'F2', ctrlKey: true, shiftKey: true }), false, false),
    ).toBe(false);
  });
});

describe('through the window dispatcher (FR-076, FR-079)', () => {
  async function mount(): Promise<HTMLTextAreaElement> {
    m = mountTabGroup(createDefaultLayout('proj-keys', { tab: 't1', panel: 'p1' }), {
      extras: [createElement(WindowDispatcher, { key: 'd', capabilities: MAIN_WINDOW_CAPABILITIES })],
    });
    await screen.findByTestId('panel-p1');
    // A stand-in for xterm's helper textarea, inside the panel's box as the real one is.
    const box = document.querySelector('[data-panel-host="p1"]') as HTMLElement;
    const textarea = document.createElement('textarea');
    box.appendChild(textarea);
    extra.push(textarea);
    return textarea;
  }

  it('the chord is consumed before the textarea hears it', async () => {
    const terminal = await mount();
    const heard = vi.fn();
    terminal.addEventListener('keydown', heard);
    terminal.focus();
    let notTaken = true;
    act(() => {
      notTaken = fireEvent.keyDown(terminal, CHORD);
    });
    expect(notTaken).toBe(false);
    expect(heard).not.toHaveBeenCalled();
  });

  it('plain F2 still reaches it', async () => {
    const terminal = await mount();
    const heard = vi.fn();
    terminal.addEventListener('keydown', heard);
    terminal.focus();
    let notTaken = true;
    act(() => {
      notTaken = fireEvent.keyDown(terminal, { key: 'F2', code: 'F2' });
    });
    expect(notTaken).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
