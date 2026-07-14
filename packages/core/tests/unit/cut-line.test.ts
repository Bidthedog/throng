/**
 * `cut-line` — Ctrl+X with no selection cuts the whole line (016, FR-016/FR-016a · T061).
 *
 * The semantics are PER CURSOR, and that is the part worth testing hard: a partial selection must
 * never be widened to a whole line (the user selected exactly what they meant), while a bare caret
 * must take its line entire. Get that backwards and Ctrl+X silently destroys text the user did not
 * select — the most damaging possible failure of a cut.
 */
import { describe, expect, it } from 'vitest';
import { cutLine, type LineIndex } from '../../src/editor/cut-line.js';

/** A line index over a plain LF string — the shape CodeMirror's `Text` already satisfies. */
function index(text: string): LineIndex {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return {
    length: text.length,
    lineAt(pos: number) {
      let n = 0;
      while (n + 1 < starts.length && starts[n + 1] <= pos) n += 1;
      const from = starts[n];
      const to = n + 1 < starts.length ? starts[n + 1] - 1 : text.length;
      return { from, to, text: text.slice(from, to) };
    },
  };
}

const caret = (at: number) => ({ from: at, to: at });

describe('what cut-line cuts', () => {
  it('takes the WHOLE line when the caret has no selection', () => {
    const doc = 'one\ntwo\nthree\n';
    const result = cutLine([caret(5)], index(doc), '\n'); // caret inside "two"

    expect(result.mode).toBe('full-line');
    expect(result.clipboardText).toBe('two\n'); // …terminated, so it pastes as a line elsewhere
    // The line goes entirely, INCLUDING its break — cutting a line must not leave a blank one.
    expect(result.changes).toEqual([{ from: 4, to: 8 }]);
  });

  it('takes EXACTLY the selection when there is one, and never widens it to a line', () => {
    // The damaging failure: a user selects three characters, presses Ctrl+X, and loses the line.
    const doc = 'one\ntwo\nthree\n';
    const result = cutLine([{ from: 4, to: 6 }], index(doc), '\n'); // "tw"

    expect(result.mode).toBe('verbatim');
    expect(result.clipboardText).toBe('tw');
    expect(result.changes).toEqual([{ from: 4, to: 6 }]);
  });

  it('is full-line ONLY when EVERY cursor is bare (FR-016a)', () => {
    // A mixed set has no single sensible shape, so the marker is verbatim — but the per-cursor
    // BEHAVIOUR is unchanged: the bare caret still takes its line, the selection still takes itself.
    const doc = 'one\ntwo\nthree\n';
    const result = cutLine([{ from: 0, to: 2 }, caret(5)], index(doc), '\n');

    expect(result.mode).toBe('verbatim');
    expect(result.changes).toEqual([
      { from: 0, to: 2 }, // "on"
      { from: 4, to: 8 }, // …and the whole of "two\n"
    ]);
  });

  it('joins several bare carets’ lines in DOCUMENT ORDER, with one newline between them', () => {
    const doc = 'one\ntwo\nthree\n';
    const result = cutLine([caret(10), caret(1)], index(doc), '\n'); // …given out of order

    expect(result.mode).toBe('full-line');
    expect(result.clipboardText).toBe('one\nthree\n'); // document order, not click order
    expect(result.changes).toEqual([
      { from: 0, to: 4 },
      { from: 8, to: 14 },
    ]);
  });

  it('cuts a line ONCE when two carets sit on it', () => {
    const doc = 'one\ntwo\n';
    const result = cutLine([caret(0), caret(2)], index(doc), '\n');

    expect(result.clipboardText).toBe('one\n'); // …not twice
    expect(result.changes).toEqual([{ from: 0, to: 4 }]);
  });

  it('removes the PRECEDING break for the last line, so no blank line is left behind', () => {
    // The last line has no trailing newline to take with it. Taking the one BEFORE it is what makes
    // the document one line shorter rather than leaving an empty line where the text was.
    const doc = 'one\ntwo';
    const result = cutLine([caret(5)], index(doc), '\n');

    expect(result.clipboardText).toBe('two\n'); // …still terminated on the clipboard
    expect(result.changes).toEqual([{ from: 3, to: 7 }]); // …the break BEFORE it
  });

  it('cuts the only line of a one-line document without going out of bounds', () => {
    const doc = 'only';
    const result = cutLine([caret(2)], index(doc), '\n');

    expect(result.clipboardText).toBe('only\n');
    expect(result.changes).toEqual([{ from: 0, to: 4 }]);
  });

  it('cuts an empty line as an empty line', () => {
    const doc = 'a\n\nb\n';
    const result = cutLine([caret(2)], index(doc), '\n');

    expect(result.clipboardText).toBe('\n');
    expect(result.changes).toEqual([{ from: 2, to: 3 }]);
  });

  it('does nothing at all when there are no cursors', () => {
    const result = cutLine([], index('a\n'), '\n');
    expect(result.changes).toEqual([]);
    expect(result.clipboardText).toBe('');
  });
});

describe('what reaches the OS clipboard (SC-009a · G4)', () => {
  it('writes the DOCUMENT’s line ending, so another application receives a proper line', () => {
    // The buffer is LF internally whatever the file is (the fidelity model normalises on read and
    // re-applies on write). The clipboard is not the buffer: it is handed to other applications, and
    // a CRLF document must put CRLF on it or the line arrives unterminated in Notepad.
    const doc = 'one\ntwo\n';
    const result = cutLine([caret(1)], index(doc), '\r\n');

    expect(result.clipboardText).toBe('one\r\n');
    // …and the DOCUMENT is edited in its own LF terms, untouched by that.
    expect(result.changes).toEqual([{ from: 0, to: 4 }]);
  });

  it('separates multiple cut lines with the document’s ending too', () => {
    const result = cutLine([caret(0), caret(9)], index('one\ntwo\nthree\n'), '\r\n');
    expect(result.clipboardText).toBe('one\r\nthree\r\n');
  });

  it('does NOT terminate a verbatim cut — it is a fragment, not a line', () => {
    const result = cutLine([{ from: 0, to: 2 }], index('one\ntwo\n'), '\r\n');
    expect(result.clipboardText).toBe('on');
  });
});
