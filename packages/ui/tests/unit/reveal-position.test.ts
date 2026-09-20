import { describe, expect, it } from 'vitest';
import { positionRevealTarget } from '../../src/renderer/editor/reveal-range.js';

/**
 * 045 FR-033 / FR-052 — where the caret lands when a positioned link opens an editor (T096).
 *
 * ══ WHY THIS IS A RESOLVER AND NOT A RANGE ══
 *
 * `openFileInTab` takes either. A RANGE is document offsets, and a caller only has those for a
 * document it is already holding — which a link's opener never is: the file may not be open, the
 * panel may not exist yet, and the editor reads its content over the bridge a turn or two later.
 * `src/foo.ts:42` names line 42 of a document nobody has read, so the position can only be turned
 * into an offset once the view holds the text. That is exactly what `RevealResolver` is for, and
 * `headingRevealTarget` beside it is the same shape for the same reason (044 FR-090d).
 *
 * ══ AND WHY IT CLAMPS RATHER THAN FAILING ══
 *
 * The spec's *position beyond the file's end* edge case. A build log naming line 400 of a file that
 * has since been cut to 80 lines is stale, not wrong: the user still wants the file, and refusing to
 * place the caret would either open nothing or raise a notice about a line number they did not type.
 * Clamping puts them at the end of the file, which is the nearest true answer — the same reasoning
 * `resolveGotoLine` already applies to a typed line number.
 */

const DOC = ['alpha', 'bravo', 'charlie', 'delta'].join('\n');
// offsets: alpha 0-5, bravo 6-11, charlie 12-19, delta 20-25

describe('positionRevealTarget (FR-033)', () => {
  it('places a caret at the start of the named line when there is no column', () => {
    expect(positionRevealTarget(2).resolve(DOC)).toEqual({ from: 6, to: 6 });
  });

  it('places it at the column when there is one — both 1-based', () => {
    // line 3, column 4 → the 'r' of "charlie": 12 + 3.
    expect(positionRevealTarget(3, 4).resolve(DOC)).toEqual({ from: 15, to: 15 });
  });

  it('column 1 is the start of the line, not one character in', () => {
    expect(positionRevealTarget(3, 1).resolve(DOC)).toEqual({ from: 12, to: 12 });
  });

  it('a line beyond the end of the file clamps to the last line (the edge case)', () => {
    expect(positionRevealTarget(400).resolve(DOC)).toEqual({ from: 20, to: 20 });
  });

  it('a column beyond the end of its line clamps to the end of that line', () => {
    expect(positionRevealTarget(2, 99).resolve(DOC)).toEqual({ from: 11, to: 11 });
  });

  it('a line of 0 or less clamps to the first line rather than erroring', () => {
    expect(positionRevealTarget(0).resolve(DOC)).toEqual({ from: 0, to: 0 });
    expect(positionRevealTarget(-3, -9).resolve(DOC)).toEqual({ from: 0, to: 0 });
  });

  it('answers for an empty document rather than throwing', () => {
    expect(positionRevealTarget(12, 7).resolve('')).toEqual({ from: 0, to: 0 });
  });

  it('is a caret, not a selection — a link names a place, never a span', () => {
    const range = positionRevealTarget(3, 4).resolve(DOC);
    expect(range).not.toBeNull();
    expect(range!.from).toBe(range!.to);
  });

  it('handles CRLF text, since the document arrives as it was written on disk', () => {
    const crlf = ['alpha', 'bravo', 'charlie'].join('\r\n');
    // alpha\r\n = 7 characters, so line 2 starts at 7.
    expect(positionRevealTarget(2).resolve(crlf)).toEqual({ from: 7, to: 7 });
  });
});
