/**
 * 073 data-model §2 — a grid operation from the renderer, validated and resolved by main against the
 * document's CURRENT text into minimal text changes.
 */
import { describe, expect, it } from 'vitest';
import { applyCsvChanges } from '../../src/csv/csv-edit.js';
import { resolveGridOperation, validateGridOperation } from '../../src/csv/grid-operation.js';

describe('validateGridOperation', () => {
  it('accepts each well-formed operation', () => {
    expect(validateGridOperation({ kind: 'setCells', cells: [{ row: 0, col: 1, value: 'x' }] })).not.toBeNull();
    expect(validateGridOperation({ kind: 'insertRows', at: 0, count: 2 })).not.toBeNull();
    expect(validateGridOperation({ kind: 'insertColumn', at: 3 })).not.toBeNull();
    expect(validateGridOperation({ kind: 'deleteRows', from: 1, count: 1 })).not.toBeNull();
  });

  it('refuses negatives, fractions, wrong types, oversized counts and unknown kinds', () => {
    for (const bad of [
      null,
      { kind: 'setCells', cells: [{ row: -1, col: 0, value: 'x' }] },
      { kind: 'setCells', cells: [{ row: 0.5, col: 0, value: 'x' }] },
      { kind: 'setCells', cells: [{ row: 0, col: 0, value: 7 }] },
      { kind: 'setCells', cells: 'no' },
      { kind: 'insertRows', at: 0, count: 0 },
      { kind: 'insertRows', at: 0, count: 10_001 },
      { kind: 'deleteRows', from: 0, count: -2 },
      { kind: 'sort', column: 1 },
    ]) {
      expect(validateGridOperation(bad)).toBeNull();
    }
  });

  it('refuses a paste of more than a million cells', () => {
    const cells = Array.from({ length: 1_000_001 }, (_, i) => ({ row: i, col: 0, value: '' }));
    expect(validateGridOperation({ kind: 'setCells', cells })).toBeNull();
  });
});

describe('resolveGridOperation', () => {
  it('resolves each kind against the text it is given', () => {
    const text = 'a,b\n1,2\n';
    const apply = (op: Parameters<typeof resolveGridOperation>[1]): string => {
      const r = resolveGridOperation(text, op);
      if ('refuse' in r) throw new Error(r.refuse);
      return applyCsvChanges(text, r.changes);
    };
    expect(apply({ kind: 'setCells', cells: [{ row: 1, col: 0, value: 'x' }] })).toBe('a,b\nx,2\n');
    expect(apply({ kind: 'insertRows', at: 1, count: 1 })).toBe('a,b\n,\n1,2\n');
    expect(apply({ kind: 'insertColumn', at: 0 })).toBe(',a,b\n,1,2\n');
    expect(apply({ kind: 'deleteRows', from: 0, count: 1 })).toBe('1,2\n');
  });

  it('refuses every operation on a document with an unterminated quote, naming its line', () => {
    expect(resolveGridOperation('a\n"open\n', { kind: 'insertColumn', at: 0 })).toEqual({ refuse: 'malformed', line: 2 });
  });
});
