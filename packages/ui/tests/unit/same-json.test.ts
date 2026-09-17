/**
 * 044 US7b fix round 2, item 4 — `sameJson` was copy-pasted in `history-mirror-sync.tsx` and
 * `preview-store.ts`: identical structural-equality-over-JSON bodies, each with its own copy of the
 * same bug surface. Moved into one shared helper both files import instead.
 */
import { describe, expect, it } from 'vitest';
import { sameJson } from '../../src/renderer/common/same-json.js';

describe('sameJson — structural equality over JSON values, ignoring key order', () => {
  it('is true for primitives that are ===', () => {
    expect(sameJson(1, 1)).toBe(true);
    expect(sameJson('a', 'a')).toBe(true);
    expect(sameJson(undefined, undefined)).toBe(true);
    expect(sameJson(null, null)).toBe(true);
  });

  it('is false for primitives that differ', () => {
    expect(sameJson(1, 2)).toBe(false);
    expect(sameJson('a', 'b')).toBe(false);
  });

  it('ignores key order in an object', () => {
    expect(sameJson({ line: 4, offsetRatio: 0 }, { offsetRatio: 0, line: 4 })).toBe(true);
  });

  it('is false when a key is missing on either side', () => {
    expect(sameJson({ line: 4 }, { line: 4, offsetRatio: 0 })).toBe(false);
    expect(sameJson({ line: 4, offsetRatio: 0 }, { line: 4 })).toBe(false);
  });

  it('is false when a value differs at any depth', () => {
    expect(sameJson({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    expect(sameJson({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
  });

  it('distinguishes an array from an object', () => {
    expect(sameJson([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it('compares arrays element-wise, in order', () => {
    expect(sameJson([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(sameJson([1, 2, 3], [1, 3, 2])).toBe(false);
  });

  it('null and undefined are not objects, and are not equal to {}', () => {
    expect(sameJson(null, {})).toBe(false);
    expect(sameJson(undefined, {})).toBe(false);
  });
});
