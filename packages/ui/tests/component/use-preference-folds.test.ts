/**
 * `usePreferenceFolds` (056 FR-008..FR-011b, FR-016, FR-017, data-model "Effective fold state", research R6).
 *
 * Layer: component (jsdom) — the hook reads and writes the real `localStorage`, and the claims are about
 * what a tab would render, which is React state.
 *
 *   folded(key) = searching ? searchFolds.has(key) : persisted[tab][key] ?? defaultFolded(key)
 *
 * "Searching" is ONE definition for the folds and the bulk buttons: the box text OR the applied query is
 * non-blank once trimmed — the box text counts so that the debounce gap between typing and filtering is
 * not a window in which a click is written as a real fold.
 *
 * The suite runs in two modes. Most describes run WITH the open seam (`?foldDefault=open`, research R10),
 * where every heading starts unfolded — the behaviour the search and persistence cases were written against.
 * The "FR-016 defaults" describe runs with NO seam, which is what a real user gets: sections folded,
 * subgroups unfolded.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePreferenceFolds } from '../../src/renderer/preferences/use-preference-folds.js';
import { readFolds, writeFolds } from '../../src/renderer/preferences/preferences-folds.js';

const A = '["A"]';
const B = '["B"]';
const C = '["A","C"]';
const KEYS: ReadonlySet<string> = new Set([A, B, C]);

type Args = { tab?: 'settings' | 'keybindings' | 'themes'; typed?: string; applied?: string };

/** `typed` defaults to `applied`: the common state, where the debounce has settled. */
function mount(init: Args = {}) {
  return renderHook(
    (p: Args) => {
      const applied = p.applied ?? '';
      return usePreferenceFolds(p.tab ?? 'settings', p.typed ?? applied, applied, KEYS);
    },
    { initialProps: init },
  );
}

const choices = (entries: Array<[string, boolean]>): ReadonlyMap<string, boolean> => new Map(entries);
const useSeam = (open: boolean): void => window.history.replaceState(null, '', open ? '/?foldDefault=open' : '/');

beforeEach(() => {
  localStorage.clear();
  useSeam(true);
});

describe('FR-016 defaults (no seam)', () => {
  beforeEach(() => useSeam(false));

  it('reads a section folded and a subgroup unfolded with nothing stored', () => {
    const { result } = mount();
    expect(result.current.isFolded(A)).toBe(true);
    expect(result.current.isFolded(B)).toBe(true);
    expect(result.current.isFolded(C)).toBe(false);
  });

  it('reads a stored state lacking a key at that key default', () => {
    writeFolds('settings', choices([[B, false]]), KEYS);
    const { result } = mount();
    expect(result.current.isFolded(A), 'section, no entry: folded').toBe(true);
    expect(result.current.isFolded(C), 'subgroup, no entry: unfolded').toBe(false);
    expect(result.current.isFolded(B)).toBe(false);
  });

  it('opens sections too under the open seam', () => {
    useSeam(true);
    const { result } = mount();
    expect([A, B, C].some((k) => result.current.isFolded(k))).toBe(false);
  });

  it('records false when a defaulted section is unfolded, and a remount keeps it unfolded (FR-017)', () => {
    const { result } = mount();
    act(() => result.current.toggle(A));
    expect(result.current.isFolded(A)).toBe(false);
    expect(readFolds('settings').get(A)).toBe(false);
    const again = mount();
    expect(again.result.current.isFolded(A)).toBe(false);
    expect(again.result.current.isFolded(B)).toBe(true);
  });

  it('records true when a defaulted subgroup is folded, and a remount keeps it folded', () => {
    const { result } = mount();
    act(() => result.current.toggle(C));
    expect(readFolds('settings').get(C)).toBe(true);
    expect(mount().result.current.isFolded(C)).toBe(true);
  });

  it('expandAll records false for every key and collapseAll records true', () => {
    const { result } = mount();
    act(() => result.current.expandAll());
    expect([A, B, C].some((k) => result.current.isFolded(k))).toBe(false);
    expect(readFolds('settings')).toEqual(choices([[A, false], [B, false], [C, false]]));
    act(() => result.current.collapseAll());
    expect([A, B, C].every((k) => result.current.isFolded(k))).toBe(true);
    expect(readFolds('settings')).toEqual(choices([[A, true], [B, true], [C, true]]));
  });

  it('keeps DISPLAYING the effective state in the debounce gap, then unfolds on the applied search', () => {
    const { result, rerender } = mount({ typed: 'fo', applied: '' });
    expect(result.current.isFolded(A), 'a defaulted section stays folded in the gap').toBe(true);
    expect(result.current.isFolded(C)).toBe(false);
    rerender({ typed: 'fo', applied: 'fo' });
    expect(result.current.isFolded(A), 'the applied search unfolds it').toBe(false);
    expect(localStorage.getItem('throng.preferences.folds')).toBeNull();
  });

  it('restores the defaults when a search clears (nothing was stored)', () => {
    const { result, rerender } = mount();
    rerender({ applied: 'x' });
    expect(result.current.isFolded(A)).toBe(false);
    rerender({ applied: '' });
    expect(result.current.isFolded(A)).toBe(true);
  });
});

describe('initial state (open seam)', () => {
  it('is everything unfolded with nothing stored', () => {
    const { result } = mount();
    expect([A, B, C].some((k) => result.current.isFolded(k))).toBe(false);
    expect(result.current.searching).toBe(false);
  });

  it('comes from the store', () => {
    writeFolds('settings', choices([[A, true]]), KEYS);
    const { result } = mount();
    expect(result.current.isFolded(A)).toBe(true);
    expect(result.current.isFolded(B)).toBe(false);
  });

  it('lets an explicit unfold override a folded default and an explicit fold a subgroup (v2)', () => {
    useSeam(false);
    writeFolds('settings', choices([[A, false], [C, true]]), KEYS);
    const { result } = mount();
    expect(result.current.isFolded(A)).toBe(false);
    expect(result.current.isFolded(C)).toBe(true);
  });

  it('ignores a stored key naming a heading that does not exist (FR-011a)', () => {
    writeFolds('settings', choices([['["Gone"]', true]]), new Set(['["Gone"]']));
    const { result } = mount();
    expect(() => result.current.isFolded(A)).not.toThrow();
    expect(result.current.isFolded(A)).toBe(false);
  });
});

describe('toggle outside a search', () => {
  it('folds, unfolds and writes the store each time', () => {
    const { result } = mount();
    act(() => result.current.toggle(A));
    expect(result.current.isFolded(A)).toBe(true);
    expect([...readFolds('settings')]).toEqual([[A, true]]);
    act(() => result.current.toggle(A));
    expect(result.current.isFolded(A)).toBe(false);
    expect([...readFolds('settings')]).toEqual([[A, false]]);
  });
});

describe('during a search (FR-008, FR-009)', () => {
  it('reads every key unfolded, whatever is persisted', () => {
    writeFolds('settings', choices([[A, true], [B, true]]), KEYS);
    const { result } = mount({ applied: 'x' });
    expect(result.current.searching).toBe(true);
    expect(result.current.isFolded(A)).toBe(false);
    expect(result.current.isFolded(B)).toBe(false);
  });

  it('sends toggles to a transient set and never to the store', () => {
    const { result } = mount({ applied: 'x' });
    act(() => result.current.toggle(A));
    expect(result.current.isFolded(A)).toBe(true);
    expect(readFolds('settings').size).toBe(0);
    expect(localStorage.getItem('throng.preferences.folds')).toBeNull();
  });

  it('resets the transient set when the applied query changes', () => {
    const { result, rerender } = mount({ applied: 'x' });
    act(() => result.current.toggle(A));
    rerender({ applied: 'xy' });
    expect(result.current.isFolded(A)).toBe(false);
  });

  it('renders the persisted state again when the query clears, discarding the transient toggles', () => {
    writeFolds('settings', choices([[B, true]]), KEYS);
    const { result, rerender } = mount();
    rerender({ applied: 'x' });
    act(() => result.current.toggle(A));
    expect(result.current.isFolded(B)).toBe(false);
    rerender({ applied: '' });
    expect(result.current.isFolded(B)).toBe(true);
    expect(result.current.isFolded(A)).toBe(false);
    expect([...readFolds('settings')]).toEqual([[B, true]]);
  });

  it('does not bring a discarded toggle back when the SAME query is searched again (FR-009)', () => {
    const { result, rerender } = mount({ applied: 'font' });
    act(() => result.current.toggle(A));
    expect(result.current.isFolded(A)).toBe(true);
    rerender({ applied: '' });
    rerender({ applied: 'font' });
    expect(result.current.isFolded(A), 'the old toggle must not resurface').toBe(false);
  });
});

describe('one definition of "searching" (the debounce gap, whitespace)', () => {
  it('counts the box text, so a click before the debounce settles is transient and never written', () => {
    const { result } = mount({ typed: 'fo', applied: '' });
    expect(result.current.searching).toBe(true);
    act(() => result.current.toggle(A));
    expect(result.current.isFolded(A)).toBe(true);
    expect(localStorage.getItem('throng.preferences.folds')).toBeNull();
  });

  it('keeps DISPLAYING the persisted folds in the gap — no unfold flash — until the filter is applied', () => {
    writeFolds('settings', choices([[A, true]]), KEYS);
    const { result, rerender } = mount({ typed: 'fo', applied: '' });
    expect(result.current.searching).toBe(true);
    expect(result.current.isFolded(A), 'still folded while only the box has text').toBe(true);
    expect(result.current.isFolded(B)).toBe(false);
    rerender({ typed: 'fo', applied: 'fo' });
    expect(result.current.isFolded(A), 'the applied search unfolds it').toBe(false);
  });

  it('shows a gap click on the displayed state without writing it', () => {
    writeFolds('settings', choices([[A, true]]), KEYS);
    const { result } = mount({ typed: 'fo', applied: '' });
    act(() => result.current.toggle(A));
    expect(result.current.isFolded(A), 'the click unfolds the displayed fold').toBe(false);
    act(() => result.current.toggle(B));
    expect(result.current.isFolded(B), 'and folds an unfolded one').toBe(true);
    expect([...readFolds('settings')], 'the store is untouched').toEqual([[A, true]]);
  });

  it('keeps a bulk fold from writing while the box has text but nothing is applied yet', () => {
    const { result } = mount({ typed: 'fo', applied: '' });
    act(() => result.current.collapseAll());
    act(() => result.current.expandAll());
    expect(localStorage.getItem('throng.preferences.folds')).toBeNull();
  });

  it('still counts as searching while the filter is applied but the box was just cleared', () => {
    const { result } = mount({ typed: '', applied: 'fo' });
    expect(result.current.searching).toBe(true);
  });

  it('does not count a whitespace-only query: the filter shows everything, so nothing is a match', () => {
    writeFolds('settings', choices([[A, true]]), KEYS);
    const { result } = mount({ typed: '   ', applied: '  ' });
    expect(result.current.searching).toBe(false);
    expect(result.current.isFolded(A)).toBe(true);
    act(() => result.current.toggle(B));
    expect([...readFolds('settings')].sort()).toEqual([[A, true], [B, true]]);
  });
});

describe('expandAll and collapseAll (FR-011b, FR-017)', () => {
  it('collapseAll folds every current key and records true for each', () => {
    const { result } = mount();
    act(() => result.current.collapseAll());
    expect([A, B, C].every((k) => result.current.isFolded(k))).toBe(true);
    expect(readFolds('settings')).toEqual(choices([[A, true], [B, true], [C, true]]));
  });

  it('expandAll unfolds every key and records false for each', () => {
    writeFolds('settings', choices([[A, true], [B, true]]), KEYS);
    const { result } = mount();
    act(() => result.current.expandAll());
    expect([A, B, C].some((k) => result.current.isFolded(k))).toBe(false);
    expect(readFolds('settings')).toEqual(choices([[A, false], [B, false], [C, false]]));
  });
});

describe('tab independence (FR-010)', () => {
  it('keeps the settings and themes namespaces apart for identical group names', () => {
    const settings = mount({ tab: 'settings' });
    const themes = mount({ tab: 'themes' });
    act(() => settings.result.current.toggle(A));
    expect(settings.result.current.isFolded(A)).toBe(true);
    expect(themes.result.current.isFolded(A)).toBe(false);
    expect(readFolds('themes').size).toBe(0);
    act(() => themes.result.current.toggle(B));
    expect([...readFolds('settings')]).toEqual([[A, true]]);
    expect([...readFolds('themes')]).toEqual([[B, true]]);
  });
});
