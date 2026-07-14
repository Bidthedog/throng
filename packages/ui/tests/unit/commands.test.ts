/**
 * Translating a throng chord into a CodeMirror key (016, US3).
 *
 * This has a test of its own because getting it wrong FAILS INVISIBLY. CodeMirror matches bindings
 * against `KeyboardEvent.key` — lowercase `"x"` for Ctrl+X — so a binding written `Ctrl-X` matches
 * nothing and the command silently never runs.
 *
 * And the editor still LOOKS right when that happens: CodeMirror's own cut already removes the whole
 * line when the selection is empty, so `Ctrl+X` went on cutting the line exactly as expected while
 * `cut-line` had never fired at all. The only symptom was two steps later — the clipboard record was
 * never written, so the paste came back verbatim and empty. It cost an hour to find. Hence this.
 */
import { describe, expect, it } from 'vitest';
import { toCodeMirrorKey } from '../../src/renderer/editor/commands.js';

describe('toCodeMirrorKey', () => {
  it('LOWERCASES a bare letter — `Ctrl+X` is `Ctrl-x`, because that is what the event says', () => {
    expect(toCodeMirrorKey('Ctrl+X')).toBe('Ctrl-x');
    expect(toCodeMirrorKey('Ctrl+C')).toBe('Ctrl-c');
    expect(toCodeMirrorKey('Alt+F')).toBe('Alt-f');
  });

  it('leaves a SHIFTED letter uppercase — the event says `X`, and CodeMirror resolves it', () => {
    expect(toCodeMirrorKey('Ctrl+Shift+X')).toBe('Ctrl-Shift-X');
  });

  it('leaves named keys exactly as they are', () => {
    expect(toCodeMirrorKey('Tab')).toBe('Tab');
    expect(toCodeMirrorKey('Shift+Tab')).toBe('Shift-Tab');
    expect(toCodeMirrorKey('Shift+Alt+ArrowUp')).toBe('Shift-Alt-ArrowUp');
    expect(toCodeMirrorKey('F3')).toBe('F3');
    expect(toCodeMirrorKey('Ctrl+Alt+ArrowLeft')).toBe('Ctrl-Alt-ArrowLeft');
  });

  it('refuses a chord CodeMirror cannot express, rather than binding nonsense', () => {
    // The keybinding model permits a mouse wheel for zoom. It is not a key, and a keymap entry for
    // it would be a binding that can never match — which is exactly the invisible failure above.
    expect(toCodeMirrorKey('Ctrl+WheelUp')).toBeNull();
    expect(toCodeMirrorKey('')).toBeNull();
  });
});
