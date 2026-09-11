/**
 * 043 T099 — the pure replace model: what a commit would write, and which of its matches still
 * hold (FR-054, FR-054a, FR-055, FR-046a, FR-047).
 *
 * ══ WHY THE UNIT TIER, WHEN THE COMMIT ITSELF IS INTEGRATION ══
 *
 * FR-055 — "replacement text MUST NOT be re-matched by the same operation" — is a property of the
 * TRANSFORM, not of the filesystem. A term whose replacement contains it is the shape that fails,
 * and it fails identically over a buffer and over a file on disk. Proving it here costs a string;
 * proving it through `ReplaceCommitService` costs a temp tree per case and would still be proving
 * something about this function.
 *
 * The same argument covers the verification: `verifyEdits` is "does this text still say what the
 * scan said it said", which is a comparison, and `replace-commit.integration.test.ts` is where the
 * question of WHEN it runs (unconditionally, immediately before each write) is settled.
 */
import { describe, it, expect } from 'vitest';
import { NO_MODES, applyReplacements, verifyEdits, type Match } from '../../src/index.js';

const CASE_SENSITIVE = { caseSensitive: true, wholeWord: false };
const WHOLE_WORD = { caseSensitive: false, wholeWord: true };

/** Every match of `term`, as the scan would have recorded them. */
function scan(text: string, term: string, modes = NO_MODES): Match[] {
  return verifyEdits(text, term, modes, allOffsets(text, term)).applicable as Match[];
}

/** Candidate offsets, found the crude way, so `verifyEdits` is the thing under test. */
function allOffsets(text: string, term: string): Match[] {
  const out: Match[] = [];
  for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + 1)) {
    out.push({ from: i, to: i + term.length });
  }
  return out;
}

describe('applyReplacements — FR-055: the replacement is never re-matched', () => {
  it('a replacement CONTAINING the term is written once per match, not repeatedly', () => {
    /*
     * The shape that fails. An implementation that re-scanned after each write — or that walked
     * left to right recomputing offsets against the growing text — would find `foo` inside the
     * `foofoo` it had just written and keep going.
     */
    const text = 'foo bar foo';
    const edits = scan(text, 'foo');
    expect(edits).toHaveLength(2);
    expect(applyReplacements(text, edits, 'foofoo')).toBe('foofoo bar foofoo');
  });

  it('a single match whose replacement contains itself terminates', () => {
    expect(applyReplacements('foo', [{ from: 0, to: 3 }], 'xfoox')).toBe('xfoox');
  });

  it('adjacent matches do not consume each other', () => {
    const text = 'aaaa';
    const edits: Match[] = [
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ];
    expect(applyReplacements(text, edits, 'aaa')).toBe('aaaaaa');
  });
});

describe('applyReplacements — the offsets are the ORIGINAL text’s', () => {
  it('an earlier replacement of a different length does not move a later one', () => {
    // 'one' at 0..3 and 'one' at 8..11. Replacing with a longer string shifts nothing, because
    // every edit is measured against the text that was scanned.
    const text = 'one two one';
    const edits = scan(text, 'one');
    expect(edits).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ]);
    expect(applyReplacements(text, edits, 'ONE!')).toBe('ONE! two ONE!');
  });

  it('accepts its edits in any order and writes the same text', () => {
    const text = 'one two one';
    const forwards = scan(text, 'one');
    const backwards = [...forwards].reverse();
    expect(applyReplacements(text, backwards, 'X')).toBe(applyReplacements(text, forwards, 'X'));
  });

  it('leaves the text untouched when there is nothing to replace', () => {
    expect(applyReplacements('unchanged', [], 'X')).toBe('unchanged');
  });
});

describe('applyReplacements — FR-046a: an empty replacement deletes', () => {
  it('removes each match and nothing else', () => {
    const text = 'keep DROP keep DROP keep';
    expect(applyReplacements(text, scan(text, 'DROP'), '')).toBe('keep  keep  keep');
  });
});

describe('verifyEdits — FR-054: the match must still be there', () => {
  it('an edit whose text has gone is refused, and every other edit still holds (FR-054a)', () => {
    const scanned = scan('alpha needle beta needle', 'needle');
    expect(scanned).toHaveLength(2);
    // The user deleted the FIRST occurrence since the scan; the offsets no longer describe it.
    const now = 'alpha ------ beta needle';
    const checked = verifyEdits(now, 'needle', NO_MODES, scanned);
    expect(checked.gone).toEqual([{ from: 6, to: 12 }]);
    expect(checked.applicable).toEqual([{ from: 18, to: 24 }]);
  });

  it('an edit shifted by something OTHER than this commit is refused rather than written blind', () => {
    /*
     * The word is still in the file, at an offset no arithmetic of this operation can produce:
     * `needle` → `thread` is length-preserving, so this commit could not have moved anything, and
     * something else edited the file. Writing at the scanned position would splice the replacement
     * into the middle of unrelated text — the defect FR-054 exists for. Re-resolution (below) is
     * about a shift this operation ITSELF caused; this is not one.
     */
    const checked = verifyEdits('xx needle', 'needle', NO_MODES, [{ from: 0, to: 6 }], 'thread');
    expect(checked.applicable).toEqual([]);
    expect(checked.gone).toEqual([{ from: 0, to: 6 }]);
  });

  it('honours the match modes rather than comparing raw substrings', () => {
    // Same offsets, same letters, different question. A case-sensitive commit must not write over
    // text that only matches case-insensitively.
    const edits: Match[] = [{ from: 0, to: 6 }];
    expect(verifyEdits('NEEDLE', 'needle', NO_MODES, edits).applicable).toEqual(edits);
    expect(verifyEdits('NEEDLE', 'needle', CASE_SENSITIVE, edits).applicable).toEqual([]);
  });

  it('honours whole word', () => {
    const edits: Match[] = [{ from: 0, to: 3 }];
    expect(verifyEdits('cat', 'cat', WHOLE_WORD, edits).applicable).toEqual(edits);
    expect(verifyEdits('cats', 'cat', WHOLE_WORD, edits).applicable).toEqual([]);
  });

  it('refuses an edit that runs off the end of the text', () => {
    const checked = verifyEdits('short', 'needle', NO_MODES, [{ from: 900, to: 906 }]);
    expect(checked.applicable).toEqual([]);
    expect(checked.gone).toHaveLength(1);
  });

  it('refuses everything when the term is empty — a commit with no term writes nothing', () => {
    expect(verifyEdits('anything', '', NO_MODES, [{ from: 0, to: 1 }]).applicable).toEqual([]);
  });

  it('preserves document order, whatever order the edits arrived in', () => {
    const text = 'a needle b needle c needle';
    const scanned = scan(text, 'needle');
    const shuffled = [scanned[2], scanned[0], scanned[1]] as Match[];
    expect(verifyEdits(text, 'needle', NO_MODES, shuffled).applicable).toEqual(scanned);
  });

  it('counts a duplicated edit once — two rows for one match write one replacement', () => {
    const edits: Match[] = [
      { from: 2, to: 8 },
      { from: 2, to: 8 },
    ];
    const checked = verifyEdits('a needle', 'needle', NO_MODES, edits);
    expect(checked.applicable).toEqual([{ from: 2, to: 8 }]);
    expect(checked.gone).toEqual([]);
  });
});

/**
 * #378 — `applied` says WHICH of the caller's edits were written, in the caller's own coordinates.
 *
 * The caller this exists for keeps naming offsets from one scan across several commits and rebases
 * the rows it has not written yet past the ones it has (`commit-replace.ts`). That ledger is only as
 * good as its knowledge of what actually landed, and neither `applicable` — which may name a
 * re-resolved position — nor "everything I sent minus `gone`" can supply it.
 */
describe('verifyEdits — which of the caller’s edits were written (#378)', () => {
  it('names the caller’s offsets, not the re-resolved ones', () => {
    // The row still says `(8,11)`; the write lands at `(11,14)`. A caller marking its row committed
    // needs the first, and a caller building the ChangeSet needs the second.
    const checked = verifyEdits('bazqux bar foo', 'foo', NO_MODES, [{ from: 8, to: 11 }], 'bazqux');
    expect(checked.applicable).toEqual([{ from: 11, to: 14 }]);
    expect(checked.applied).toEqual([{ from: 8, to: 11 }]);
  });

  it('pairs entry for entry with applicable, in the same order', () => {
    const text = 'a needle b needle c needle';
    const scanned = scan(text, 'needle');
    const shuffled = [scanned[2], scanned[0], scanned[1]] as Match[];
    const checked = verifyEdits(text, 'needle', NO_MODES, shuffled, 'thread');
    expect(checked.applied).toEqual(checked.applicable);
    expect(checked.applied).toEqual(scanned);
  });

  it('counts one write once, however many rows named it', () => {
    /*
     * The case that makes "sent minus gone" wrong rather than merely indirect. Two rows landing on
     * one match are ONE replacement, so a ledger that recorded two would shift every later row twice
     * as far as the text actually moved.
     */
    const checked = verifyEdits('a needle', 'needle', NO_MODES, [
      { from: 2, to: 8 },
      { from: 2, to: 8 },
    ]);
    expect(checked.applied).toEqual([{ from: 2, to: 8 }]);
  });

  it('says nothing about an edit that was refused', () => {
    const checked = verifyEdits('a needle', 'needle', NO_MODES, [
      { from: 2, to: 8 },
      { from: 40, to: 46 },
    ]);
    expect(checked.applied).toEqual([{ from: 2, to: 8 }]);
    expect(checked.gone).toEqual([{ from: 40, to: 46 }]);
  });

  it('is empty when nothing is written', () => {
    expect(verifyEdits('anything', '', NO_MODES, [{ from: 0, to: 1 }]).applied).toEqual([]);
    expect(verifyEdits('anything', 'x', NO_MODES, []).applied).toEqual([]);
  });
});

/**
 * 043 FR-050/FR-054 — a SECOND commit in a file this operation has already committed once.
 *
 * ══ THE DEFECT THIS DESCRIBES ══
 *
 * Nothing rebases a panel's rows after a commit. So `foo bar foo` with `foo` → `bazqux`: commit row
 * 1, and row 2 still carries the scan-time offsets `(8,11)` while the match it names now sits at
 * `(11,14)`. Refusing it tells the user "the match had gone" about a match they are looking at, and
 * makes FR-050's ordinary case — replace one, then replace the next — fail on the second click.
 *
 * FR-054 permits either answer: "MUST be re-resolved or refused, never written blind." Only refusal
 * was implemented; this is the re-resolution half.
 *
 * ══ THE LADDER, AND WHY IT CANNOT WRITE SOMEWHERE THE USER DID NOT MEAN ══
 *
 * A previous commit of THIS operation moves a later match by exactly `|replacement| - |term|` per
 * replacement made before it, so the only offsets this operation can have shifted a match to are
 * `from + k·(|replacement| - |term|)` for a whole number of previous replacements `k`. Nothing else
 * on the line is a candidate, and "the nearest match" is never asked for.
 *
 * The rungs are then required to be UNAMBIGUOUS: if two of them hold a live match, the edit is
 * refused. That is what stops the case the reviewer found — term `ab`, replacement `zzabzz`, file
 * `abab` — where a stale offset can land on text the previous replacement itself inserted.
 */
describe('verifyEdits — FR-054: a match this commit ITSELF moved is re-resolved', () => {
  it('re-resolves the second row after the first has been committed (FR-050)', () => {
    const scanned = scan('foo bar foo', 'foo');
    expect(scanned).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ]);
    // Row 1 committed: the file is now this, and row 2 still carries `(8,11)`.
    const now = 'bazqux bar foo';
    const checked = verifyEdits(now, 'foo', NO_MODES, [scanned[1] as Match], 'bazqux');
    expect(checked.gone).toEqual([]);
    expect(checked.applicable).toEqual([{ from: 11, to: 14 }]);
    expect(applyReplacements(now, checked.applicable as Match[], 'bazqux')).toBe(
      'bazqux bar bazqux',
    );
  });

  it('re-resolves a Replace All issued after a single commit', () => {
    // The panel still lists all three rows at their scan-time offsets. The first has already been
    // written and is genuinely gone; the other two have simply moved.
    const scanned = scan('foo bar foo baz foo', 'foo');
    const now = 'bazqux bar foo baz foo';
    const checked = verifyEdits(now, 'foo', NO_MODES, scanned, 'bazqux');
    expect(checked.applicable).toEqual([
      { from: 11, to: 14 },
      { from: 19, to: 22 },
    ]);
    expect(checked.gone).toEqual([{ from: 0, to: 3 }]);
    expect(applyReplacements(now, checked.applicable as Match[], 'bazqux')).toBe(
      'bazqux bar bazqux baz bazqux',
    );
  });

  it('re-resolves backwards when the replacement is SHORTER, including a deletion', () => {
    const scanned = scan('foo bar foo', 'foo');
    // Row 1 deleted (FR-046a): everything after it moved back by the term's own length.
    const checked = verifyEdits(' bar foo', 'foo', NO_MODES, [scanned[1] as Match], '');
    expect(checked.applicable).toEqual([{ from: 5, to: 8 }]);
    expect(applyReplacements(' bar foo', checked.applicable as Match[], '')).toBe(' bar ');
  });

  it('re-resolves past a replacement that CONTAINS the term, without landing inside it', () => {
    /*
     * Term `ab`, replacement `zzabzz`, file `abXab`. Committing row 1 leaves `zzabzzXab`, which now
     * holds an `ab` at 2 that the replacement itself wrote. Row 2's scanned `(3,5)` must reach the
     * match at 7 — the one the user is looking at — and the inserted `ab` at 2 is not on the ladder
     * at all, because a rung is an offset this operation's own arithmetic can produce and nothing
     * else. "The nearest match" would have picked the wrong one.
     */
    const checked = verifyEdits('zzabzzXab', 'ab', NO_MODES, [{ from: 3, to: 5 }], 'zzabzz');
    expect(checked.applicable).toEqual([{ from: 7, to: 9 }]);
  });

  it('refuses when two rungs both hold a match — ambiguity is never resolved by guessing', () => {
    /*
     * The uniqueness rule, which is what keeps the ladder from writing somewhere the user did not
     * mean. `ab` → `zzabzz` shifts by 4 per replacement, and from a scanned offset of 1 both the
     * first rung (5) and the second (9) hold a live match. There is no way to tell how many
     * replacements happened, so there is no way to tell which of the two the row named. The row is
     * refused and stays listed for a re-run — the rest of the commit is unaffected (FR-054a).
     */
    const checked = verifyEdits('XXXXXabXXab', 'ab', NO_MODES, [{ from: 1, to: 3 }], 'zzabzz');
    expect(checked.applicable).toEqual([]);
    expect(checked.gone).toEqual([{ from: 1, to: 3 }]);
  });

  it('the scanned offset still holding a match is written, and is never re-resolved away', () => {
    /*
     * FR-054's own words: a match whose position NO LONGER holds is re-resolved or refused. One
     * that still holds is simply written — which is also what makes an ordinary Replace All over an
     * untouched file work when the replacement contains the term (`abab`, `ab` → `abab`, above).
     *
     * The residual case this leaves is worth stating rather than hiding: with `ab` → `zzabzz` over
     * `abab`, committing row 1 leaves `zzabzzab`, where row 2's `(2,4)` still holds a match — the
     * one the replacement inserted. It is written there. That is unchanged from before
     * re-resolution existed, and no local evidence distinguishes it from the untouched `abab` case
     * one line above, which must keep working.
     */
    const checked = verifyEdits('zzabzzab', 'ab', NO_MODES, [{ from: 2, to: 4 }], 'zzabzz');
    expect(checked.applicable).toEqual([{ from: 2, to: 4 }]);
  });

  it('still accepts an untouched file whose replacement contains the term', () => {
    /*
     * The same self-matching shape with NOTHING committed yet: `abab`, `ab` → `abab`. Both rows are
     * exactly where the scan left them, so nothing has moved and the uniqueness rule must not fire
     * — a Replace All here is the ordinary case, not an ambiguity.
     */
    const edits = scan('abab', 'ab');
    expect(edits).toHaveLength(2);
    const checked = verifyEdits('abab', 'ab', NO_MODES, edits, 'abab');
    expect(checked.applicable).toEqual(edits);
    expect(checked.gone).toEqual([]);
  });

  it('does not re-resolve to a rung that is not a match', () => {
    // `foo` → `bazqux` shifts by 3, and 3 characters along from the scanned offset is `ar `, not a
    // match. Nothing on the ladder holds, so the row is refused rather than moved to the far match.
    const checked = verifyEdits('xxx bar foo', 'foo', NO_MODES, [{ from: 0, to: 3 }], 'bazqux');
    expect(checked.applicable).toEqual([]);
    expect(checked.gone).toEqual([{ from: 0, to: 3 }]);
  });

  it('never writes two replacements where two rows re-resolve to one match', () => {
    // Rows at 0 and 8 can both reach 11 only if the ladder allows it; whether they do or not, the
    // result must name each live position once.
    const checked = verifyEdits('bazqux bar foo', 'foo', NO_MODES, [
      { from: 8, to: 11 },
      { from: 8, to: 11 },
    ], 'bazqux');
    expect(checked.applicable).toEqual([{ from: 11, to: 14 }]);
  });

  it('honours the modes when re-resolving, not just when verifying', () => {
    // The rung holds `FOO`, which a case-sensitive commit must not write over even though the
    // arithmetic points straight at it.
    const edit: Match[] = [{ from: 8, to: 11 }];
    expect(
      verifyEdits('bazqux bar FOO', 'foo', CASE_SENSITIVE, edit, 'bazqux').applicable,
    ).toEqual([]);
    expect(verifyEdits('bazqux bar FOO', 'foo', NO_MODES, edit, 'bazqux').applicable).toEqual([
      { from: 11, to: 14 },
    ]);
  });
});
