/**
 * 047 T029 — the last-active preview per tab (US2, research.md R8, data-model.md "LastActivePreview").
 *
 * A per-tab, most-recent-first list of panel ids — a LIST rather than `last-active-editor.ts`'s single
 * value, because R8's fallback ("the last active preview in the visible tab, falling back to the most
 * recently active remaining one there") needs a second choice once the first is gone. Pruning of
 * closed panels happens at READ time (`candidateFor`'s `isLive` predicate) rather than on write or on
 * an explicit forget call — the list can hold ids for panels long closed, and that is fine: nothing
 * reads it except through the predicate.
 */
import { describe, expect, it } from 'vitest';
import {
  __resetLastActivePreview,
  candidateFor,
  recordLastActivePreview,
} from '../../src/renderer/preview/last-active-preview.js';

const ALIVE = (): ((panelId: string) => boolean) => () => true;

describe('recordLastActivePreview / candidateFor', () => {
  it('candidateFor answers null for a tab with no recorded preview', () => {
    __resetLastActivePreview();
    expect(candidateFor('t1', ALIVE())).toBeNull();
  });

  it('the most recently recorded panel wins', () => {
    __resetLastActivePreview();
    recordLastActivePreview('t1', 'p1');
    recordLastActivePreview('t1', 'p2');
    expect(candidateFor('t1', ALIVE())).toBe('p2');
  });

  it('recording an already-recorded panel again moves it to the front, without duplicating it', () => {
    __resetLastActivePreview();
    recordLastActivePreview('t1', 'p1');
    recordLastActivePreview('t1', 'p2');
    recordLastActivePreview('t1', 'p1'); // p1 becomes most recent again
    // p2 is now the SECOND choice — proven by making p1 not-live and getting p2, not null.
    expect(candidateFor('t1', (id) => id !== 'p1')).toBe('p2');
    expect(candidateFor('t1', ALIVE())).toBe('p1');
  });

  it('closed panels are skipped at read: falls back to the next most recent still-live one', () => {
    __resetLastActivePreview();
    recordLastActivePreview('t1', 'p1');
    recordLastActivePreview('t1', 'p2');
    recordLastActivePreview('t1', 'p3'); // most recent
    const isLive = (id: string): boolean => id !== 'p3' && id !== 'p2'; // only p1 survives
    expect(candidateFor('t1', isLive)).toBe('p1');
  });

  it('answers null once every recorded panel in the tab is closed', () => {
    __resetLastActivePreview();
    recordLastActivePreview('t1', 'p1');
    recordLastActivePreview('t1', 'p2');
    expect(candidateFor('t1', () => false)).toBeNull();
  });

  it('another tab is never returned, whatever it holds', () => {
    __resetLastActivePreview();
    recordLastActivePreview('t1', 'p1');
    recordLastActivePreview('t2', 'p2');
    expect(candidateFor('t1', ALIVE())).toBe('p1');
    expect(candidateFor('t2', ALIVE())).toBe('p2');
    // t1's candidate is never t2's panel, even though it would satisfy `isLive`.
    expect(candidateFor('t1', (id) => id === 'p2')).toBeNull();
  });

  it('pointerdown and focus are the SAME store operation — either call records identically', () => {
    // The store takes no opinion on why a panel became active; `preview-panel.tsx` calls this same
    // function from both its pointerdown and focus handlers (T030), which is exactly what this proves
    // at the store's own level: two calls, from whatever source, compose the same way one would.
    __resetLastActivePreview();
    recordLastActivePreview('t1', 'p1'); // stands in for a pointerdown
    recordLastActivePreview('t1', 'p2'); // stands in for a focus
    expect(candidateFor('t1', ALIVE())).toBe('p2');
  });
});
