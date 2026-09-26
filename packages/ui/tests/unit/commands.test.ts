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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS } from '@throng/core';
import { toCodeMirrorKey } from '../../src/renderer/editor/commands.js';
import { editorChordsFor } from '../../src/renderer/keybindings/scope.js';

describe('toCodeMirrorKey', () => {
  it('LOWERCASES a bare letter — `Ctrl+X` is `Ctrl-x`, because that is what the event says', () => {
    expect(toCodeMirrorKey('Ctrl+X')).toBe('Ctrl-x');
    expect(toCodeMirrorKey('Ctrl+C')).toBe('Ctrl-c');
    expect(toCodeMirrorKey('Alt+F')).toBe('Alt-f');
  });

  it('lowercases a letter shifted WITH Ctrl/Alt/Meta — CodeMirror names it by its base key (046 FR-124)', () => {
    // Re-pinned from `Ctrl-Shift-X`: with Ctrl held as well as Shift, CodeMirror's `runHandlers` tries
    // `Ctrl-X` (no Shift, the key is a character) and then the BASE key `Shift-Ctrl-x` — never
    // `Shift-Ctrl-X`, so an uppercase name matched nothing. `Ctrl+E,Shift+W`'s second stroke showed it.
    expect(toCodeMirrorKey('Ctrl+Shift+X')).toBe('Ctrl-Shift-x');
  });

  it('leaves a letter shifted by Shift ALONE uppercase — that path matches the produced `X`', () => {
    expect(toCodeMirrorKey('Shift+X')).toBe('Shift-X');
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

/**
 * 046 T115 (FR-091, FR-092, research R19) — a TWO-STROKE token in CodeMirror's prefix notation.
 *
 * CodeMirror already owns the pending-prefix engine: a keymap name with a space in it (`"Ctrl-e w"`)
 * is a two-stroke binding, and `runHandlers` stores the first stroke for 4 s. So the whole bridge is
 * this function — which today splits on `+` alone and hands CodeMirror `Ctrl-E W`. That is two
 * failures in one string, each of them the invisible kind the file header describes: the first
 * stroke `Ctrl-E` never matches the event CodeMirror names `Ctrl-e`, and the second stroke `W` never
 * matches an unshifted `w`. The chord would simply never fire, with no error anywhere.
 */
describe('toCodeMirrorKey — two-stroke chords (046 FR-092, R19)', () => {
  // 046 FR-124 (S29) re-pins the three below: a two-stroke chord is ONE continuous press, so each
  // stroke is written AS PHYSICALLY PRESSED — the second carries the first's held modifiers.
  it('writes `Ctrl+E,W` as CodeMirror’s space-separated prefix form, Ctrl held through W', () => {
    expect(toCodeMirrorKey('Ctrl+E,W')).toBe('Ctrl-e Ctrl-w');
    // A legacy space-separated token is the same binding (core `parseTwoStroke`).
    expect(toCodeMirrorKey('Ctrl+E W')).toBe('Ctrl-e Ctrl-w');
  });

  it('translates EACH physical stroke by the single-stroke rules — an added Shift is part of the second', () => {
    expect(toCodeMirrorKey('Ctrl+K,Shift+W')).toBe('Ctrl-k Ctrl-Shift-w');
    expect(toCodeMirrorKey('Ctrl+K,F3')).toBe('Ctrl-k Ctrl-F3');
    // A comma that is a stroke's own key is not a separator.
    expect(toCodeMirrorKey('Ctrl+,,W')).toBe('Ctrl-, Ctrl-w');
    // 046 FR-126 — re-pinned from "three strokes are refused": up to three keys, four refused.
    expect(toCodeMirrorKey('Ctrl+E,W,X')).toBe('Ctrl-e Ctrl-w Ctrl-x');
    expect(toCodeMirrorKey('Ctrl+E,Shift+W,Q')).toBe('Ctrl-e Ctrl-Shift-w Ctrl-q');
    expect(toCodeMirrorKey('Ctrl+E,W,X,Q')).toBeNull();
  });

  it('bridges the SHIPPED word-wrap binding, the one the editor keymap is built from (FR-091)', () => {
    const chords = editorChordsFor(DEFAULT_KEYBINDINGS, 'editor.toggleWordWrap');
    expect(chords).toEqual(['Ctrl+E,W']);
    expect(chords.map(toCodeMirrorKey)).toEqual(['Ctrl-e Ctrl-w']);
  });

  it('still refuses every gesture — a wheel or a middle click is not a key (FR-106)', () => {
    expect(toCodeMirrorKey('Ctrl+WheelUp')).toBeNull();
    expect(toCodeMirrorKey('Ctrl+WheelDown')).toBeNull();
    // Shipped for `panel.zoomReset`. A keymap entry named `Ctrl-MiddleClick` could never match.
    expect(toCodeMirrorKey('Ctrl+MiddleClick')).toBeNull();
  });
});

/**
 * 033 US2 (#219) — `navigate.gotoLine` must NOT be in the editor's CodeMirror keymap (A2, A3).
 *
 * ══ WHY AN ABSENCE, AND WHY IT IS ASSERTED HERE ══
 *
 * `editorCommandKeymap` binds its handlers at `Prec.highest` with `preventDefault: true`. Add Go To
 * Line to that table and the chord is claimed INSIDE the view — before the window-level listener
 * that carries the scope gate ever sees it. The command would still appear to work, because the
 * editor is the one context it is supposed to work in; what would break is everything the gate is
 * for. It is also the wrong shape for this command: opening a modal is not an operation on the
 * document, and the modal is mounted outside the view.
 *
 * ══ WHY THE SOURCE, AND NOT THE EXTENSION ══
 *
 * The keymap's contents are an opaque `Extension` once built, and the table that decides them
 * (`commandsFor`, in `use-editor.ts`) is module-private — deliberately, since nothing outside that
 * file should be able to add a command to a live view. So the ABSENCE is read where it is decided.
 * The two assertions either side of it are what stop this being a guard that cannot fail: the
 * positive control proves the table was found and parsed, and `editorChordsFor` proves the chord
 * really would be claimed if the table named it.
 */
describe('the editor keymap does not claim Go To Line (033 US2, A2, A3)', () => {
  const source = readFileSync(
    join(process.cwd(), 'packages', 'ui', 'src', 'renderer', 'editor', 'use-editor.ts'),
    'utf8',
  );
  /**
   * The body of `commandsFor` — the handler table `editorCommandKeymap` is built from.
   *
   * Sliced by LINES, and the end is the first line that is a bare `}` at zero indent. A character
   * offset search for a `\n}\n` sentinel looked simpler and was wrong on this repository: the file is
   * CRLF, so the sentinel never matched, the slice fell back to "the rest of the file", and the check
   * below failed against a `navigate.gotoLine` that is in the CONTENT MENU forty lines further down —
   * a false positive naming the one thing the test exists to forbid.
   */
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('function commandsFor('));
  const end = start === -1 ? -1 : lines.findIndex((l, i) => i > start && l === '}');
  const table = start === -1 ? '' : lines.slice(start, end === -1 ? undefined : end).join('\n');

  it('found the handler table — without this the assertion below is vacuous', () => {
    expect(start, 'commandsFor() has been renamed or moved; this check is now blind').toBeGreaterThan(-1);
    expect(end, 'commandsFor()’s closing brace was not found; the slice ran past it').toBeGreaterThan(
      start,
    );
    expect(table).toContain("'editor.cutLine'");
    expect(table).toContain("'editor.toggleWordWrap'");
  });

  it('names no `navigate.` command in it', () => {
    expect(
      table.match(/'navigate\.[A-Za-z]+'/g),
      'a navigate.* command was added to the editor keymap: the chord is now preventDefaulted ' +
        'inside CodeMirror and the window-level scope gate can never run (A2, A3)',
    ).toBeNull();
  });

  it('would otherwise claim Ctrl+G inside the view — so the absence above is load-bearing', () => {
    // `editorChordsFor` is what `editorCommandKeymap` filters through, and it withholds only chords
    // the WINDOW level owns. `Ctrl+G` is not one of those, so a handler entry would bind it.
    expect(editorChordsFor(DEFAULT_KEYBINDINGS, 'navigate.gotoLine')).toEqual(['Ctrl+G']);
    expect(toCodeMirrorKey('Ctrl+G')).toBe('Ctrl-g');
  });
});
