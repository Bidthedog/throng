/**
 * 073 FR-008g — with the window's guard installed (as `main.tsx` installs it in every window), a middle click pastes
 * into nothing: a text box, a CodeMirror editor, a terminal. Chromium's middle-click paste is the default of the press and
 * release, delivered as a `paste` to the focused element; jsdom performs no default, so what is asserted is that each
 * is cancelled and that the paste after one never reaches the element's own listeners.
 *
 * Layer: component — real DOM elements and the guard as the entry installs it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNoMiddlePaste } from '../../src/renderer/common/no-middle-paste.js';

let uninstall: (() => void) | undefined;
beforeEach(() => {
  uninstall = installNoMiddlePaste(window);
});
afterEach(() => {
  uninstall?.();
  document.body.replaceChildren();
});

function pasteEvent(): Event {
  return new Event('paste', { bubbles: true, cancelable: true });
}

/** Middle-click `el`, then deliver the paste Chromium would follow it with; whether `el`'s own listener heard it. */
function middleClickThenPaste(el: HTMLElement): { heard: boolean; cancelled: boolean[] } {
  const heard = vi.fn();
  el.addEventListener('paste', heard);
  const cancelled = (['mousedown', 'mouseup', 'auxclick'] as const).map((type) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 1 });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  });
  el.dispatchEvent(pasteEvent());
  return { heard: heard.mock.calls.length > 0, cancelled };
}

describe('a middle click pastes nowhere (073 FR-008g)', () => {
  it('a text box: its press, release and auxclick are cancelled and the paste never reaches it', () => {
    const input = document.body.appendChild(document.createElement('input'));
    expect(middleClickThenPaste(input)).toEqual({ heard: false, cancelled: [true, true, true] });
  });

  it('a contenteditable, as CodeMirror\'s editors are', () => {
    const editable = document.body.appendChild(document.createElement('div'));
    editable.contentEditable = 'true';
    expect(middleClickThenPaste(editable).heard).toBe(false);
  });

  // The maintainer's rule includes terminals; this is the one case that names them, so it is the one to remove if
  // terminals are to paste on a middle click again.
  it('a terminal: xterm\'s input textarea hears no middle-click paste', () => {
    const term = document.body.appendChild(document.createElement('div'));
    term.className = 'xterm';
    const helper = term.appendChild(document.createElement('textarea'));
    helper.className = 'xterm-helper-textarea';
    expect(middleClickThenPaste(helper).heard).toBe(false);
  });

  it('the reader\'s own paste, from a key, still arrives', () => {
    const input = document.body.appendChild(document.createElement('input'));
    const heard = vi.fn();
    input.addEventListener('paste', heard);
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'v', ctrlKey: true }));
    input.dispatchEvent(pasteEvent());
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('listeners still hear the middle button: a pan or Ctrl+middle-click\'s zoom reset is not stopped', () => {
    const el = document.body.appendChild(document.createElement('div'));
    const pressed = vi.fn();
    el.addEventListener('mousedown', pressed);
    window.addEventListener('mousedown', pressed);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1, ctrlKey: true }));
    window.removeEventListener('mousedown', pressed);
    expect(pressed).toHaveBeenCalledTimes(2);
  });

  it('leaves pointerdown alone, where the previews\' middle-drag pan reads defaultPrevented', () => {
    const el = document.body.appendChild(document.createElement('div'));
    const e = new Event('pointerdown', { bubbles: true, cancelable: true }) as Event & { button: number };
    Object.defineProperty(e, 'button', { value: 1 });
    el.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
