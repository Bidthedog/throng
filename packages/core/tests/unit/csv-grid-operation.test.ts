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
    expect(validateGridOperation({ kind: 'deleteColumns', from: 2, count: 3 })).toEqual({ kind: 'deleteColumns', from: 2, count: 3 });
  });

  // A cut of more than 10,000 whole rows is one contiguous change: refusing it left the rows copied and not removed.
  it('accepts a delete of more rows than one insert may name, up to the cell cap', () => {
    expect(validateGridOperation({ kind: 'deleteRows', from: 0, count: 20_000 })).toEqual({ kind: 'deleteRows', from: 0, count: 20_000 });
    expect(validateGridOperation({ kind: 'deleteRows', from: 0, count: 1_000_001 })).toBeNull();
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
      { kind: 'deleteColumns', from: 0, count: 0 },
      { kind: 'deleteColumns', from: -1, count: 1 },
      { kind: 'sort', column: 1 },
    ]) {
      expect(validateGridOperation(bad)).toBeNull();
    }
  });

  it('accepts an insert carrying copied values, and refuses values that do not match the count (FR-038a)', () => {
    expect(validateGridOperation({ kind: 'insertRows', at: 0, count: 2, values: [['a'], ['b']] })).toEqual({
      kind: 'insertRows',
      at: 0,
      count: 2,
      values: [['a'], ['b']],
    });
    expect(validateGridOperation({ kind: 'insertColumn', at: 1, count: 2, columns: [['a'], ['b']] })).toEqual({
      kind: 'insertColumn',
      at: 1,
      count: 2,
      columns: [['a'], ['b']],
    });
    expect(validateGridOperation({ kind: 'insertColumn', at: 1, count: 3 })).toEqual({ kind: 'insertColumn', at: 1, count: 3 });
    expect(validateGridOperation({ kind: 'insertColumn', at: 1 })).toEqual({ kind: 'insertColumn', at: 1 });
    for (const bad of [
      { kind: 'insertRows', at: 0, count: 2, values: [['a']] },
      { kind: 'insertRows', at: 0, count: 1, values: [[1]] },
      { kind: 'insertRows', at: 0, count: 1, values: 'no' },
      { kind: 'insertColumn', at: 0, count: 2, columns: [['a']] },
      { kind: 'insertColumn', at: 0, count: 0 },
      { kind: 'insertColumn', at: 0, count: 1, columns: [[null]] },
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
    expect(apply({ kind: 'insertRows', at: 1, count: 1, values: [['x', 'y']] })).toBe('a,b\nx,y\n1,2\n');
    expect(apply({ kind: 'insertColumn', at: 1, count: 1, columns: [['p', 'q']] })).toBe('a,p,b\n1,q,2\n');
    expect(apply({ kind: 'deleteColumns', from: 0, count: 1 })).toBe('b\n2\n');
  });

  it('refuses every operation on a document with an unterminated quote, naming its line', () => {
    expect(resolveGridOperation('a\n"open\n', { kind: 'insertColumn', at: 0 })).toEqual({ refuse: 'malformed', line: 2 });
  });
});
