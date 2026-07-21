import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveEditorViewState,
  takeEditorViewState,
  clearEditorViewState,
  clampSelection,
  type SelectionJson,
} from '../../src/renderer/editor/editor-view-state.js';

const sel = (anchor: number, head = anchor): SelectionJson => ({
  ranges: [{ anchor, head }],
  main: 0,
});

describe('editor view-state store (#144)', () => {
  beforeEach(() => {
    clearEditorViewState('p1');
    clearEditorViewState('p2');
  });

  it('carries a saved caret/scroll across an unmount → remount', () => {
    saveEditorViewState('p1', { selection: sel(42), scrollAnchor: 320 });
    expect(takeEditorViewState('p1')).toEqual({ selection: sel(42), scrollAnchor: 320 });
  });

  it('consumes the saved state so it restores only once', () => {
    saveEditorViewState('p1', { selection: sel(5), scrollAnchor: 0 });
    expect(takeEditorViewState('p1')).toBeDefined();
    expect(takeEditorViewState('p1')).toBeUndefined();
  });

  it('keeps per-panel state independent', () => {
    saveEditorViewState('p1', { selection: sel(1), scrollAnchor: 10 });
    saveEditorViewState('p2', { selection: sel(2), scrollAnchor: 20 });
    expect(takeEditorViewState('p2')?.scrollAnchor).toBe(20);
    expect(takeEditorViewState('p1')?.scrollAnchor).toBe(10);
  });

  it('clears saved state on explicit destroy', () => {
    saveEditorViewState('p1', { selection: sel(9), scrollAnchor: 0 });
    clearEditorViewState('p1');
    expect(takeEditorViewState('p1')).toBeUndefined();
  });
});

describe('clampSelection (#144)', () => {
  it('returns the selection unchanged when it fits the document', () => {
    expect(clampSelection(sel(3, 7), 100)).toEqual(sel(3, 7));
  });

  it('pulls out-of-range positions back to the document end (shrunk document)', () => {
    expect(clampSelection(sel(50, 60), 10)).toEqual(sel(10, 10));
  });

  it('never yields a negative offset', () => {
    expect(clampSelection(sel(-5, -1), 100)).toEqual(sel(0, 0));
  });

  it('degrades non-finite positions to 0 rather than throwing', () => {
    expect(clampSelection(sel(Number.NaN, Number.POSITIVE_INFINITY), 100)).toEqual(sel(0, 0));
  });

  it('returns undefined for an empty or missing selection', () => {
    expect(clampSelection(undefined, 100)).toBeUndefined();
    expect(clampSelection({ ranges: [], main: 0 }, 100)).toBeUndefined();
  });

  it('clamps the main index to the available ranges', () => {
    const twoRanges: SelectionJson = { ranges: [{ anchor: 0, head: 1 }, { anchor: 2, head: 3 }], main: 9 };
    expect(clampSelection(twoRanges, 100).main).toBe(1);
  });
});
