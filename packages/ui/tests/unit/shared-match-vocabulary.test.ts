import { Text } from '@codemirror/state';
import * as core from '@throng/core';
import { describe, expect, it } from 'vitest';
import * as bar from '../../src/renderer/search/search-model.js';

/**
 * 043 T006a — FR-039 and FR-040, asserted rather than argued.
 *
 * ══ WHY THIS EXISTS WHEN T002–T005 ALREADY MOVED THE MODEL ══
 *
 * The move discharges both requirements *structurally*: there is one definition, so the two find
 * surfaces cannot offer different match vocabularies. That is an argument about the current shape
 * of the tree, and the next person to add a mode to the Find in Files panel will not read it.
 *
 * FR-040's whole point is that the two surfaces can never drift apart — 013 FR-007 deferred regex,
 * #376 will land it, and when it does it MUST reach both. So the thing worth asserting is not "no
 * regex today" but "the bar and the file search are the SAME model", which is what makes a third
 * mode arriving on one of them impossible to do quietly.
 *
 * ══ WHY IDENTITY AND NOT A SOURCE SWEEP ══
 *
 * A text scan for the word "regular expression" across the search sources would match this comment,
 * and `packaged-runtime-deps.test.ts` already carries the scar of a guard that matched prose (#369).
 * Object identity across the two import paths is exact, cheap, and fails on the only change that
 * actually matters: a second definition appearing anywhere.
 */

const PLAIN: core.MatchModes = { caseSensitive: false, wholeWord: false };
const doc = (...lines: string[]): Text => Text.of(lines);

describe('FR-039 — the file search and the find bar share ONE match model', () => {
  it('is the same object reached through the renderer re-export and through core', () => {
    // If `search-model.ts` ever grows a definition of its own instead of re-exporting, these stop
    // being the same function and the two surfaces are free to diverge.
    expect(bar.editorMatches).toBe(core.editorMatches);
    expect(bar.indexFrom).toBe(core.indexFrom);
    expect(bar.stepIndex).toBe(core.stepIndex);
    expect(bar.countOf).toBe(core.countOf);
    expect(bar.seedFrom).toBe(core.seedFrom);
    expect(bar.NO_MODES).toBe(core.NO_MODES);
    expect(bar.NO_MATCHES).toBe(core.NO_MATCHES);
  });

  it('offers exactly case sensitivity and whole word, and nothing else', () => {
    // `MatchModes` is erased at runtime, so `NO_MODES` is its witness: every mode has to have a
    // default here to be a mode at all, which makes this list the vocabulary itself.
    expect(Object.keys(core.NO_MODES).sort()).toEqual(['caseSensitive', 'wholeWord']);
  });
});

describe('FR-040 — no regular-expression matching, on either surface', () => {
  it('treats a metacharacter in the term as the literal character it is', () => {
    // `a.c` as a pattern would also find `abc`; as text it finds only itself.
    const m = core.editorMatches(doc('a.c abc'), 'a.c', PLAIN);
    expect(m).toEqual([{ from: 0, to: 3 }]);
  });

  it('finds nothing for a term that is only a pattern', () => {
    // `a+` as a pattern matches all three characters of `aaa`; as text it matches nothing here.
    expect(core.editorMatches(doc('aaa'), 'a+', PLAIN)).toEqual([]);
  });

  it('finds a pattern-shaped term where it literally occurs', () => {
    // The negative above must not be passing because the term was rejected outright.
    expect(core.editorMatches(doc('x a+ y'), 'a+', PLAIN)).toEqual([{ from: 2, to: 4 }]);
  });
});
