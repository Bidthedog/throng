import { describe, expect, it } from 'vitest';
import {
  emptyStack,
  record,
  undo,
  redo,
  validate,
  serialise,
  parse,
  plannedMoves,
  deletePaths,
  FILEOP_UNDO_BOUND,
  type FileOpUndoEntry,
} from '../../src/fileop-undo/undo-stack.js';

const mv = (from: string, to: string, at = 1): FileOpUndoEntry => ({ kind: 'move', items: [{ from, to }], at });
const rn = (from: string, to: string, at = 1): FileOpUndoEntry => ({ kind: 'rename', from, to, at });
const del = (p: string, at = 1): FileOpUndoEntry => ({ kind: 'delete', items: [{ originalPath: p }], at });

describe('fileop undo engine (024 US3)', () => {
  it('records to the undo stack and clears redo', () => {
    let s = record(emptyStack(), mv('a', 'b'));
    const u = undo(s)!;
    s = u.stack; // now b→ has a redo entry
    expect(s.redo).toHaveLength(1);
    s = record(s, rn('c', 'd')); // a NEW op clears redo
    expect(s.redo).toHaveLength(0);
    expect(s.undo).toHaveLength(1);
  });

  it('undo moves an entry to redo; redo moves it back', () => {
    const s = record(emptyStack(), mv('a', 'b'));
    const u = undo(s)!;
    expect(u.entry.kind).toBe('move');
    expect(u.stack.undo).toHaveLength(0);
    expect(u.stack.redo).toHaveLength(1);
    const r = redo(u.stack)!;
    expect(r.stack.undo).toHaveLength(1);
    expect(r.stack.redo).toHaveLength(0);
  });

  it('returns null when there is nothing to undo/redo', () => {
    expect(undo(emptyStack())).toBeNull();
    expect(redo(emptyStack())).toBeNull();
  });

  it('is bounded to the most recent 50 — the oldest drops off', () => {
    let s = emptyStack();
    for (let i = 0; i < FILEOP_UNDO_BOUND + 10; i++) s = record(s, rn(`f${i}`, `t${i}`, i));
    expect(s.undo).toHaveLength(FILEOP_UNDO_BOUND);
    // The oldest 10 were dropped; the first surviving entry is #10.
    expect((s.undo[0] as { from: string }).from).toBe('f10');
  });

  it('plans the reverse move on undo and the forward move on redo', () => {
    expect(plannedMoves(mv('a', 'b'), 'undo')).toEqual([{ from: 'b', to: 'a' }]);
    expect(plannedMoves(mv('a', 'b'), 'redo')).toEqual([{ from: 'a', to: 'b' }]);
    expect(plannedMoves(rn('a', 'b'), 'undo')).toEqual([{ from: 'b', to: 'a' }]);
    expect(deletePaths(del('x'))).toEqual(['x']);
  });

  describe('validate (FR-008 — refuse a stale entry)', () => {
    const world = (present: string[]) => (p: string) => present.includes(p);

    it('accepts a move undo when the destination is present and the source is free', () => {
      expect(validate(mv('a', 'b'), 'undo', world(['b']))).toEqual({ ok: true });
    });

    it('refuses a move undo when the source path is now taken', () => {
      const r = validate(mv('a', 'b'), 'undo', world(['b', 'a']));
      expect(r.ok).toBe(false);
    });

    it('refuses a move undo when the moved item is no longer where it was put', () => {
      expect(validate(mv('a', 'b'), 'undo', world([])).ok).toBe(false);
    });

    it('accepts a delete undo (restore) only when the original path is free', () => {
      expect(validate(del('x'), 'undo', world([]))).toEqual({ ok: true });
      expect(validate(del('x'), 'undo', world(['x'])).ok).toBe(false);
    });

    it('accepts a delete redo (re-trash) only when the item is present', () => {
      expect(validate(del('x'), 'redo', world(['x']))).toEqual({ ok: true });
      expect(validate(del('x'), 'redo', world([])).ok).toBe(false);
    });
  });

  describe('serialise / parse (v8 persistence, FR-010a)', () => {
    it('round-trips a stack', () => {
      const s = record(record(emptyStack(), mv('a', 'b')), del('x'));
      expect(parse(serialise(s))).toEqual(s);
    });

    it('degrades a missing / corrupt / unrecognised blob to empty', () => {
      expect(parse(null)).toEqual(emptyStack());
      expect(parse('not json')).toEqual(emptyStack());
      expect(parse('{"undo":"nope"}')).toEqual(emptyStack());
      expect(parse('{"undo":[{"kind":"bogus","at":1}]}')).toEqual(emptyStack());
      expect(parse('42')).toEqual(emptyStack());
    });
  });
});
