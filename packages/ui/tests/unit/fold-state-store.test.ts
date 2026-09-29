/**
 * The renderer's per-document `FoldState` cache (047 T040, US3, research R3) — the
 * `word-wrap-store.ts` pattern applied to folding: a document-keyed cache, seeded once, updated
 * optimistically, and reconciled from the authority's sync broadcast without echoing back.
 *
 * This store knows nothing of WHICH key an editor or a preview should use (`file:<path>` vs
 * `panel:<id>`, R3) — that is main's call, relayed through `window.throng.editor.foldState`/
 * `setFoldState`/`onSync`, which is the CALLER's job (`use-editor.ts`, T042) exactly as it is for
 * word wrap. This file tests only the cache: seed-once, optimistic set, sync application, and that a
 * no-op update (an equal `FoldState`) does nothing — the invariant that lets main's "equal states
 * relay nothing" hold on the renderer side too.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { FoldState } from '@throng/core';
import {
  applyFoldStateFromSync,
  documentFoldState,
  forgetFoldState,
  hasFoldState,
  setDocumentFoldState,
  __resetFoldStateStore,
} from '../../src/renderer/editor/fold-state-store.js';

afterEach(() => __resetFoldStateStore());

const expanded: FoldState = { base: 'expanded', flipped: [] };
const collapsed: FoldState = { base: 'collapsed', flipped: [] };
const partial: FoldState = { base: 'expanded', flipped: ['intro', 'usage'] };

describe('fold state store (047 US3) — per document, seeded once, cached', () => {
  it('seeds from the type default on first sight, then remembers', () => {
    expect(documentFoldState('file:a.md', expanded)).toEqual(expanded);
    expect(hasFoldState('file:a.md')).toBe(true);
    // Seeding again with a DIFFERENT default must not override what is already cached.
    expect(documentFoldState('file:a.md', collapsed)).toEqual(expanded);
  });

  it('has not seen a key before it is first read', () => {
    expect(hasFoldState('file:unseen.md')).toBe(false);
  });

  it('setDocumentFoldState writes the cache and is read back immediately', () => {
    documentFoldState('file:b.md', expanded);
    setDocumentFoldState('file:b.md', partial);
    expect(documentFoldState('file:b.md', expanded)).toEqual(partial);
  });

  it('applyFoldStateFromSync writes the cache exactly as a local set would', () => {
    documentFoldState('file:c.md', expanded);
    applyFoldStateFromSync('file:c.md', collapsed);
    expect(documentFoldState('file:c.md', expanded)).toEqual(collapsed);
  });

  it('a second view of the same document key adopts the current state, not its own default', () => {
    documentFoldState('file:d.md', expanded); // first view seeds Expanded
    setDocumentFoldState('file:d.md', collapsed); // toggled to Collapsed
    // A second view opens with a default of Expanded, but must see the document's current Collapsed.
    expect(documentFoldState('file:d.md', expanded)).toEqual(collapsed);
  });

  it('an equal FoldState is a no-op — structural equality, not reference equality', () => {
    documentFoldState('file:e.md', partial);
    // A FRESH object with the same base and the same flipped slugs, in the same order.
    setDocumentFoldState('file:e.md', { base: 'expanded', flipped: ['intro', 'usage'] });
    expect(documentFoldState('file:e.md', expanded)).toEqual(partial);
  });

  it('a state differing only in flipped ORDER is not treated as equal (flipped is meant sorted)', () => {
    documentFoldState('file:f.md', partial);
    setDocumentFoldState('file:f.md', { base: 'expanded', flipped: ['usage', 'intro'] });
    expect(documentFoldState('file:f.md', expanded).flipped).toEqual(['usage', 'intro']);
  });

  it('forgets a document so a reopen re-seeds from the default', () => {
    documentFoldState('file:g.md', expanded);
    setDocumentFoldState('file:g.md', collapsed);
    forgetFoldState('file:g.md');
    expect(hasFoldState('file:g.md')).toBe(false);
    expect(documentFoldState('file:g.md', expanded)).toEqual(expanded);
  });

  it('two distinct keys (an editor key and a standalone preview key) are independent', () => {
    setDocumentFoldState('file:h.md', collapsed);
    documentFoldState('panel:p1', expanded);
    expect(documentFoldState('file:h.md', expanded)).toEqual(collapsed);
    expect(documentFoldState('panel:p1', expanded)).toEqual(expanded);
  });
});
