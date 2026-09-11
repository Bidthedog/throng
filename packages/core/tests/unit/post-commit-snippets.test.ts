/**
 * 043 T206 — the snippet a committed row shows afterwards, re-derived from the NEW text (FR-083b).
 *
 * ══ THE CASE THAT FORCES THIS TO EXIST ══
 *
 * Two matches on ONE line each carry the other's OLD text in their surrounding context. Swapping
 * only `matched` in the renderer therefore leaves each row correct about itself and stale about its
 * neighbour — one row saying `thread = needle`, the row under it saying `needle = thread`, when the
 * line now reads `thread = thread`. That reads as a rendering glitch and sends the next person to
 * the CSS, so the commit re-derives every changed line's snippets from one new text instead.
 *
 * ══ WHY THE SAME FUNCTION AS THE SCAN, RATHER THAN A SECOND ONE ══
 *
 * `snippetFor` decides how far the context reaches, when it snaps to a word boundary, and when it
 * gives up and clips. A re-derivation that answered those questions differently would move a row's
 * text sideways for a reason that has nothing to do with the replacement — so the assertions below
 * compare against `snippetFor` over the new line rather than against literals of their own.
 */
import { describe, it, expect } from 'vitest';
import { Text } from '@codemirror/state';
import {
  MAX_COMMIT_SNIPPET_CHARS,
  postCommitSnippets,
  snippetFor,
  type Match,
} from '@throng/core';

const doc = (text: string): Text => Text.of(text.split('\n'));

/** Every offset of `term` in `text`, exactly as a scan would have recorded them. */
function matchesOf(text: string, term: string): Match[] {
  const out: Match[] = [];
  for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + 1)) {
    out.push({ from: i, to: i + term.length });
  }
  return out;
}

describe('postCommitSnippets — one new text, every changed row (FR-083b)', () => {
  it('gives a same-line neighbour its NEW text, not the text the commit invalidated', () => {
    const before = 'const needle = needle;\n';
    const after = 'const thread = thread;\n';
    const snippets = postCommitSnippets(doc(after), matchesOf(before, 'needle'), 'thread'.length);

    expect(snippets).toHaveLength(2);
    // Row 1's context reaches past its own replacement to row 2's — which is the whole defect.
    expect(snippets[0]?.matched).toBe('thread');
    expect(snippets[0]?.after).toBe(' = thread;');
    expect(snippets[1]?.matched).toBe('thread');
    expect(snippets[1]?.before).toBe('const thread = ');
    // Neither row mentions the term anywhere any more.
    for (const s of snippets) {
      expect(`${s?.before}${s?.matched}${s?.after}`).not.toContain('needle');
    }
  });

  it('is the SCAN’s own snippet of the new line — same truncation, same word snapping', () => {
    const pad = 'x'.repeat(200);
    const before = `${pad} needle ${pad}\n`;
    const after = `${pad} thread ${pad}\n`;
    const [derived] = postCommitSnippets(doc(after), matchesOf(before, 'needle'), 'thread'.length);

    const at = after.indexOf('thread');
    expect(derived).toEqual(snippetFor(after.slice(0, -1), at, at + 'thread'.length));
  });

  it('follows a replacement that CHANGES the line’s length, match by match', () => {
    const before = 'a needle b needle c\n';
    const after = 'a x b x c\n';
    const snippets = postCommitSnippets(doc(after), matchesOf(before, 'needle'), 1);

    expect(snippets.map((s) => s?.before)).toEqual(['a ', 'a x b ']);
    expect(snippets.map((s) => s?.matched)).toEqual(['x', 'x']);
    expect(snippets.map((s) => s?.after)).toEqual([' b x c', ' c']);
  });

  it('renders a DELETION as an empty match between its two halves (FR-046a)', () => {
    const before = 'keep needle keep\n';
    const after = 'keep  keep\n';
    const [only] = postCommitSnippets(doc(after), matchesOf(before, 'needle'), 0);

    expect(only?.matched).toBe('');
    expect(`${only?.before}${only?.matched}${only?.after}`).toBe('keep  keep');
  });

  it('crosses lines without carrying one line’s shift into the next', () => {
    const before = 'needle one\nneedle two\n';
    const after = 'x one\nx two\n';
    const snippets = postCommitSnippets(doc(after), matchesOf(before, 'needle'), 1);

    expect(snippets.map((s) => `${s?.before}${s?.matched}${s?.after}`)).toEqual(['x one', 'x two']);
  });

  it('stops at the size bound and says so by omission, rather than returning a great deal of text', () => {
    const line = 'needle needle needle\n';
    const snippets = postCommitSnippets(doc(line), matchesOf(line, 'needle'), 6, 30);

    // The budget is spent part-way through: what fits comes back, and the rest is `undefined` —
    // never a snippet derived from something else, and never a silently shortened array.
    expect(snippets).toHaveLength(3);
    expect(snippets[0]).toBeDefined();
    expect(snippets.at(-1)).toBeUndefined();
  });

  it('has a bound that is a stated constant, not a figure', () => {
    expect(MAX_COMMIT_SNIPPET_CHARS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_COMMIT_SNIPPET_CHARS)).toBe(true);
  });
});
