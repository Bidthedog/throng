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
  seedLastActivePreview,
  subscribeLastActivePreview,
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

/** 054 T009 — per-type Last Active (FR-007) and a recency that survives a restart (FR-001, FR-002, R1). */
describe('054 — the provider filter (FR-007)', () => {
  const providers: Record<string, string> = { md1: 'markdown', mmd: 'mermaid', md2: 'markdown' };
  const of = (id: string): string | undefined => providers[id];

  it('a candidate counts only when its current file is the same provider\'s', () => {
    __resetLastActivePreview();
    recordLastActivePreview('t1', 'md1');
    recordLastActivePreview('t1', 'mmd'); // most recent, but a Mermaid preview
    expect(candidateFor('t1', ALIVE(), { id: 'markdown', of })).toBe('md1');
    expect(candidateFor('t1', ALIVE(), { id: 'mermaid', of })).toBe('mmd');
  });

  it('no same-provider candidate is null — never another provider\'s preview', () => {
    __resetLastActivePreview();
    recordLastActivePreview('t1', 'mmd');
    expect(candidateFor('t1', ALIVE(), { id: 'markdown', of })).toBeNull();
  });

  it('still prunes by liveness first', () => {
    __resetLastActivePreview();
    recordLastActivePreview('t1', 'md1');
    recordLastActivePreview('t1', 'md2');
    expect(candidateFor('t1', (id) => id !== 'md2', { id: 'markdown', of })).toBe('md1');
  });
});

describe('054 — seeded from the layout, reported back to it (FR-001, R1)', () => {
  it('seedLastActivePreview gives a restored tab its order, most recent first', () => {
    __resetLastActivePreview();
    seedLastActivePreview('t1', ['p2', 'p1']);
    expect(candidateFor('t1', ALIVE())).toBe('p2');
    expect(candidateFor('t1', (id) => id !== 'p2')).toBe('p1');
  });

  it('a seed replaces whatever the tab held', () => {
    __resetLastActivePreview();
    recordLastActivePreview('t1', 'old');
    seedLastActivePreview('t1', ['p1']);
    expect(candidateFor('t1', ALIVE())).toBe('p1');
    expect(candidateFor('t1', (id) => id !== 'p1')).toBeNull();
  });

  it('recording reports the new order to every subscriber; a seed reports nothing (it came FROM the layout)', () => {
    __resetLastActivePreview();
    const heard: [string, string[]][] = [];
    const off = subscribeLastActivePreview((tabId, ids) => heard.push([tabId, ids]));
    seedLastActivePreview('t1', ['p1']);
    recordLastActivePreview('t1', 'p2');
    recordLastActivePreview('t1', 'p2'); // already first: the order did not change
    off();
    recordLastActivePreview('t1', 'p1');
    expect(heard).toEqual([['t1', ['p2', 'p1']]]);
  });
});
