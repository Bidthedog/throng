/**
 * #378 — the panel's record of what it has replaced, and the arithmetic it is kept for.
 *
 * A result row is an offset into the text as ONE scan found it, and the panel goes on naming those
 * offsets for as long as the list stands. Every commit it makes moves the rows after it, and it is
 * the only thing that can know so: main sees one commit at a time, and for adjacent matches whose
 * replacement contains the term the file's bytes cannot tell "row 1 was committed, so row 2 moved"
 * from "this file is untouched" — they are identical, at identical offsets.
 *
 * The panel-driven half of this is `find-in-files-adjacent-replace.test.ts`, which drives the real
 * menu and asserts the user's file. What lives here is the arithmetic on its own, including the case
 * that tier cannot reach cheaply: a ledger whose entries were written with DIFFERENT replacements.
 */
import { describe, it, expect } from 'vitest';
import {
  committedWrite,
  isCommitted,
  rebase,
  type CommittedEdits,
} from '../../src/renderer/find-in-files/find-in-files-store.js';

/**
 * A ledger, spelled the way `markFindInFilesCommitted` builds one: file → scanned offset → what that
 * write did.
 *
 * The value used to be the shift alone. FR-083 widened it because a committed row is now RENDERED
 * from the ledger rather than merely marked by it, and the replacement box is the wrong place to
 * read that text back from — see the last describe below.
 */
function ledger(entries: Record<string, [number, number][]>): CommittedEdits {
  return new Map(
    Object.entries(entries).map(([relPath, pairs]) => [
      relPath,
      new Map(pairs.map(([from, shift]) => [from, { shift, replacement: 'x'.repeat(2 + shift) }])),
    ]),
  );
}

const row = (relPath: string, from: number, length = 2): { relPath: string; from: number; to: number } => ({
  relPath,
  from,
  to: from + length,
});

describe('rebase — where a scanned match is now (#378)', () => {
  it('leaves a row alone when its file has had no commit', () => {
    expect(rebase(ledger({}), row('a.txt', 2))).toEqual({ from: 2, to: 4 });
  });

  it('moves a row by the shift of every commit BEFORE it', () => {
    // `abab`, `ab` → `zzabzz`: committing the match at 0 moved the one at 2 four along.
    expect(rebase(ledger({ 'a.txt': [[0, 4]] }), row('a.txt', 2))).toEqual({ from: 6, to: 8 });
  });

  it('ignores a commit AFTER it — replacing later text moves nothing earlier', () => {
    expect(rebase(ledger({ 'a.txt': [[8, 4]] }), row('a.txt', 2))).toEqual({ from: 2, to: 4 });
  });

  it('sums the shift each commit ACTUALLY caused, whether it grew or shrank the text', () => {
    /*
     * Two commits before the row, with DIFFERENT shifts — which is why the ledger records one per
     * entry instead of deriving them from the replacement box. The user may replace one match with
     * `zzabzz` (+4), then change the replacement to `` (-2, a deletion — FR-046a) and commit the
     * next. What moved the text is what was written; re-deriving it from the box now would put the
     * following write six characters from the match the user is looking at.
     */
    expect(rebase(ledger({ 'a.txt': [[0, 4], [4, -2]] }), row('a.txt', 10))).toEqual({
      from: 12,
      to: 14,
    });
  });

  it('is per file — one file’s commits never move another’s rows', () => {
    expect(rebase(ledger({ 'a.txt': [[0, 4]] }), row('b.txt', 2))).toEqual({ from: 2, to: 4 });
  });
});

describe('isCommitted — the FR-051 marking reads the same ledger', () => {
  it('answers for the SCANNED offset, which is the row’s identity', () => {
    const committed = ledger({ 'a.txt': [[0, 4]] });
    expect(isCommitted(committed, row('a.txt', 0))).toBe(true);
    // Not the rebased one: the row on screen still says 2, and marking 6 would mark nothing at all.
    expect(isCommitted(committed, row('a.txt', 6))).toBe(false);
    expect(isCommitted(committed, row('b.txt', 0))).toBe(false);
  });
});

describe('committedWrite — what a committed row is RENDERED from (FR-083)', () => {
  it('is absent for a row this panel has not written to', () => {
    const committed = ledger({ 'a.txt': [[0, 4]] });
    expect(committedWrite(committed, row('a.txt', 2))).toBeUndefined();
    expect(committedWrite(committed, row('b.txt', 0))).toBeUndefined();
  });

  it('answers with the text that was WRITTEN, per write, not with one replacement for the panel', () => {
    /*
     * The reason the replacement lives here rather than being read back from `state.replacement`.
     * FR-050's stepping model makes this the ordinary sequence: replace one match with `zzabzz`,
     * change your mind about the wording, replace the next with nothing at all (FR-046a). Rendering
     * the box would make the first row claim, retrospectively, that it had deleted its match.
     */
    const committed = ledger({ 'a.txt': [[0, 4], [4, -2]] });
    expect(committedWrite(committed, row('a.txt', 0))?.replacement).toBe('xxxxxx');
    expect(committedWrite(committed, row('a.txt', 4))?.replacement).toBe('');
  });

  it('carries main’s re-derived snippet when the commit had room to send one (FR-083b)', () => {
    const snippet = {
      before: 'const ',
      matched: 'thread',
      after: ' = thread;',
      truncatedStart: false,
      truncatedEnd: false,
    };
    const committed: CommittedEdits = new Map([
      ['a.txt', new Map([[6, { shift: 0, replacement: 'thread', snippet }]])],
    ]);
    expect(committedWrite(committed, { relPath: 'a.txt', from: 6 })?.snippet).toEqual(snippet);
  });
});
