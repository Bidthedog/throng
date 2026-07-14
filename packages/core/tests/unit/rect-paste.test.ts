/**
 * Column-wise paste (016, FR-025h · T079).
 *
 * The two hard cases are the two the requirement names, and both are ways of LOSING the user's text
 * if you get them wrong: a block that runs off the end of the document, and a line too short to
 * reach the caret's column.
 */
import { describe, expect, it } from 'vitest';
import { isRectangular, rectPaste, rowsOf } from '../../src/editor/rect-select.js';

/** A CodeMirror-shaped line index over a plain string. */
function docOf(text: string) {
  const texts = text.split('\n');
  const starts: number[] = [0];
  for (let i = 0; i < texts.length - 1; i += 1) starts.push(starts[i] + texts[i].length + 1);
  return {
    length: text.length,
    lines: texts.length,
    line: (n: number) => ({
      from: starts[n - 1],
      to: starts[n - 1] + texts[n - 1].length,
      text: texts[n - 1],
    }),
    lineAt: (pos: number) => {
      let n = 1;
      while (n < texts.length && starts[n] <= pos) n += 1;
      return {
        from: starts[n - 1],
        to: starts[n - 1] + texts[n - 1].length,
        text: texts[n - 1],
      };
    },
  };
}

/**
 * Apply the changes back to front, so earlier offsets stay valid.
 *
 * Two inserts at the SAME offset are applied in reverse order, so the one that came first in the
 * list ends up first in the text — which is what CodeMirror's own ChangeSet does.
 */
function apply(text: string, changes: { from: number; to: number; insert: string }[]): string {
  let out = text;
  const ordered = changes
    .map((change, index) => ({ change, index }))
    .sort((a, b) => b.change.from - a.change.from || b.index - a.index);
  for (const { change } of ordered) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  }
  return out;
}

describe('recognising a block', () => {
  it('is a rectangle when the rows are CONSECUTIVE and share the same columns', () => {
    expect(
      isRectangular([
        { line: 1, fromCol: 2, toCol: 5 },
        { line: 2, fromCol: 2, toCol: 5 },
        { line: 3, fromCol: 2, toCol: 5 },
      ]),
    ).toBe(true);
  });

  it('is NOT a rectangle when the columns differ — that is a multi-cursor set', () => {
    // A set the user built by clicking around. Pasting it column-wise would scatter its rows into
    // places they never pointed at.
    expect(
      isRectangular([
        { line: 1, fromCol: 2, toCol: 5 },
        { line: 2, fromCol: 7, toCol: 9 },
      ]),
    ).toBe(false);
  });

  it('is NOT a rectangle when the lines are not consecutive', () => {
    expect(
      isRectangular([
        { line: 1, fromCol: 0, toCol: 3 },
        { line: 3, fromCol: 0, toCol: 3 },
      ]),
    ).toBe(false);
  });

  it('is NOT a rectangle when there is only one row (FR-025i)', () => {
    // Indistinguishable from an ordinary selection — and treating it as a block would make an
    // ordinary copy paste column-wise.
    expect(isRectangular([{ line: 1, fromCol: 0, toCol: 4 }])).toBe(false);
    expect(isRectangular([])).toBe(false);
  });
});

describe('pasting a block', () => {
  it('lands row n at the caret’s column on the n-th successive line', () => {
    const text = 'aaaa\nbbbb\ncccc\n';
    const changes = rectPaste(['X', 'Y', 'Z'], { line: 1, col: 2 }, docOf(text), '\n');
    expect(apply(text, changes)).toBe('aaXaa\nbbYbb\nccZcc\n');
  });

  it('CREATES the lines when the block runs off the end of the document', () => {
    // Refusing to paste, or dropping the rows that do not fit, both lose the user's text.
    //
    // "aaaa\n" is TWO lines to an editor: "aaaa" and the empty one after the final newline. So row
    // Y lands on that empty line (padded out to the caret's column), and only row Z has nowhere to
    // go and must have its line created.
    const text = 'aaaa\n';
    const changes = rectPaste(['X', 'Y', 'Z'], { line: 1, col: 2 }, docOf(text), '\n');
    expect(apply(text, changes)).toBe('aaXaa\n  Y\n  Z');
  });

  it('PADS a short line to reach the caret’s column — with SPACES in a space-indented file', () => {
    const text = 'aaaaaaaa\nbb\ncccccccc\n';
    const changes = rectPaste(['1', '2', '3'], { line: 1, col: 6 }, docOf(text), '\n');
    expect(apply(text, changes)).toBe('aaaaaa1aa\nbb    2\ncccccc3cc\n');
    expect(apply(text, changes)).not.toContain('\t');
  });

  it('pads a TAB-indented file with TABS, then spaces for the remainder (FR-025c1)', () => {
    // Pouring spaces into a tab-indented file silently converts its whitespace style — the very
    // damage FR-018d exists to prevent. So the padding is tabs as far as a whole tab stop reaches…
    // and then SPACES, because a tab could only jump to the next stop and would land the text on the
    // wrong column entirely.
    //
    // Column 6, tab stop 4: one tab carries columns 0→4, and two spaces carry 4→6. Exactly column 6.
    const text = 'aaaaaaaa\n\ncccccccc\n';
    const indent = { style: 'tabs' as const, tabWidth: 4 };
    const changes = rectPaste(['1', '2', '3'], { line: 1, col: 6 }, docOf(text), '\n', indent);
    expect(apply(text, changes)).toBe('aaaaaa1aa\n\t  2\ncccccc3cc\n');
  });

  it('measures the caret’s column VISUALLY, so a tab-indented line is not a parallelogram', () => {
    // "\tx" is ONE tab then an x: character offset 1 is visual column 4. A block drawn down column 4
    // must land after the tab on this line and after four spaces on the next — the same place on
    // screen, which is the only place the user can mean.
    const text = '\txxxx\n    yyyy\n';
    const indent = { style: 'tabs' as const, tabWidth: 4 };
    const changes = rectPaste(['1', '2'], { line: 1, col: 4 }, docOf(text), '\n', indent);
    expect(apply(text, changes)).toBe('\t1xxxx\n    2yyyy\n');
  });

  it('uses the DOCUMENT’s line ending for the lines it creates', () => {
    const text = 'aaaa';
    const changes = rectPaste(['X', 'Y'], { line: 1, col: 0 }, docOf(text), '\r\n');
    expect(apply(text, changes)).toBe('Xaaaa\r\nY');
  });
});

describe('splitting clipboard text into rows', () => {
  it('splits on any line ending, and a trailing newline does not add an empty row', () => {
    expect(rowsOf('a\nb\nc')).toEqual(['a', 'b', 'c']);
    expect(rowsOf('a\r\nb\r\n')).toEqual(['a', 'b']);
    expect(rowsOf('single')).toEqual(['single']);
  });

  it('keeps a deliberately EMPTY row in the middle of a block', () => {
    // A block cut from a ragged column legitimately has empty rows, and dropping them would shift
    // every row below it up by one — silently pasting the block into the wrong lines.
    expect(rowsOf('a\n\nc\n')).toEqual(['a', '', 'c']);
  });
});

describe('a target column that falls INSIDE a tab', () => {
  it('lands at the tab’s far edge — it never splits the tab to make room', () => {
    // There is no character position inside a tab, so the paste cannot land exactly on the column.
    // Splitting the tab into spaces WOULD land it there — and would rewrite whitespace the user
    // never touched, which FR-025c1 forbids in as many words ("MUST NOT rewrite existing content").
    // So the row lands slightly right on that line, and the tab survives intact.
    const text = 'ab cd\n\tzz\n';
    const indent = { style: 'tabs' as const, tabWidth: 4 };
    // Column 2: row 1 lands between "ab" and " cd"; row 2's tab spans columns 0-4, so column 2 is
    // inside it and the row lands after it, at column 4.
    const changes = rectPaste(['1', '2'], { line: 1, col: 2 }, docOf(text), '\n', indent);

    expect(apply(text, changes)).toBe('ab1 cd\n\t2zz\n');
    expect(apply(text, changes)).toContain('\t2'); // …the tab is intact, not expanded to spaces
  });
});
