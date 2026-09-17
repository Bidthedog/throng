/**
 * 044 T230 — the pure decisions of two-way scroll sync (FR-121e, FR-121g, FR-121h; data-model §15.3,
 * plan.md Iteration 2026-09-16 decisions 4 and 5, research R31–R32).
 *
 * Each rule is a function of plain values, so it is pinned here without a body, a store or a layout. The
 * body and the chrome only feed them (`preview-scroll-sync.test.ts`, `preview-scroll-pairing.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { pairStart, placeOnStep, shouldDrive, shouldFollow } from '../../src/renderer/preview/scroll-sync-policy.js';

const TOP = { line: 0, offsetRatio: 0 } as const;
const PLACE = { line: 40, offsetRatio: 0.25 } as const;

describe('P1 placeOnStep — where a history step lands (FR-121e, FR-107, FR-115)', () => {
  const synced = { crossFile: true, synced: true, editorLine: 13 };

  it('a cross-file step onto the top of a document, synced, with the editor line known → the editor line', () => {
    expect(placeOnStep({ ...synced, place: null })).toEqual({ kind: 'editorLine', line: 13 });
    expect(placeOnStep({ ...synced, place: { ...TOP } })).toEqual({ kind: 'editorLine', line: 13 });
  });

  it('the same step with sync off, or with no editor line in this window → the top (FR-107)', () => {
    expect(placeOnStep({ ...synced, place: null, synced: false })).toEqual({ kind: 'top' });
    expect(placeOnStep({ ...synced, place: { ...TOP }, editorLine: null })).toEqual({ kind: 'top' });
  });

  it('a SAME-file step onto the top → the top, whatever the sync (the ruling of 519d3a8a)', () => {
    expect(placeOnStep({ ...synced, place: null, crossFile: false })).toEqual({ kind: 'top' });
    expect(placeOnStep({ ...synced, place: { ...TOP }, crossFile: false })).toEqual({ kind: 'top' });
  });

  it('a saved place part-way down is restored, synced or not, across files or not', () => {
    for (const s of [true, false]) {
      for (const crossFile of [true, false]) {
        expect(placeOnStep({ place: PLACE, crossFile, synced: s, editorLine: 13 })).toEqual({ kind: 'restore', place: PLACE });
      }
    }
    // Line 0 with an offset is not the top: the reader was part-way into the first block.
    const intoFirst = { line: 0, offsetRatio: 0.5 };
    expect(placeOnStep({ ...synced, place: intoFirst })).toEqual({ kind: 'restore', place: intoFirst });
  });

  it('an ABSENT place never yields the editor line (analysis C2: absent is a link or an update, never a step)', () => {
    const decided = placeOnStep({ ...synced, place: undefined });
    expect(decided.kind).not.toBe('editorLine');
    expect(decided).toEqual({ kind: 'restore', place: undefined });
  });
});

describe('P2 pairStart — which side decides when a pair forms (FR-121h, FR-121f)', () => {
  const base = { firstUpdate: false, drawn: true, parentBefore: null, parentNow: null, navigationSeqBefore: 3, navigationSeqNow: 3 };

  it('a view whose first update is already parented is an opening: the editor decides', () => {
    expect(pairStart({ ...base, firstUpdate: true, drawn: false, parentNow: 'ed-1' })).toBe('editor');
  });

  it('a drawn standalone preview gaining a parent with the navigation count standing still is an adoption: the preview decides', () => {
    expect(pairStart({ ...base, parentNow: 'ed-1' })).toBe('preview');
  });

  it('a parent that changes with the navigation count moving is a link or a step: the preview decides', () => {
    expect(pairStart({ ...base, parentBefore: 'ed-1', parentNow: 'ed-2', navigationSeqNow: 4 })).toBe('preview');
    expect(pairStart({ ...base, parentBefore: null, parentNow: 'ed-2', navigationSeqNow: 4 })).toBe('preview');
  });

  it('no parent now → no pair', () => {
    expect(pairStart({ ...base, parentBefore: 'ed-1', parentNow: null })).toBe('none');
    expect(pairStart({ ...base, firstUpdate: true, parentNow: null })).toBe('none');
  });

  it('a parent that arrives before anything was drawn is still an opening: the editor decides', () => {
    expect(pairStart({ ...base, drawn: false, parentNow: 'ed-1' })).toBe('editor');
  });

  it('a parent replaced by another with the count standing still: the new editor decides, as FR-113 shipped', () => {
    expect(pairStart({ ...base, parentBefore: 'ed-1', parentNow: 'ed-2' })).toBe('editor');
  });

  it('an unchanged parent starts nothing', () => {
    expect(pairStart({ ...base, parentBefore: 'ed-1', parentNow: 'ed-1' })).toBe('none');
  });
});

describe('P4 shouldFollow / shouldDrive — the same block is already there (FR-121g)', () => {
  for (const [name, decide] of [
    ['shouldFollow', shouldFollow],
    ['shouldDrive', shouldDrive],
  ] as const) {
    it(`${name}: equal blocks → false; either unknown → false; different → true`, () => {
      expect(decide({ previewTopBlock: 20, editorLineBlock: 20 })).toBe(false);
      expect(decide({ previewTopBlock: null, editorLineBlock: 20 })).toBe(false);
      expect(decide({ previewTopBlock: 20, editorLineBlock: null })).toBe(false);
      expect(decide({ previewTopBlock: 0, editorLineBlock: 20 })).toBe(true);
    });
  }
});
