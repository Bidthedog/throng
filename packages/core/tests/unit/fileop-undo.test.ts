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
  removeById,
  pushUndoEntry,
  pushRedoEntry,
  dropEntriesNamingProjects,
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

/*
 * 050 R10 — the widened entry: an `id` on every kind, a `projects` pair on a cross-project move, and a
 * `paste` kind for a paste or drag that REPLACED something (FR-018b).
 */
describe('fileop undo — cross-project and paste entries (050)', () => {
  const xmove: FileOpUndoEntry = {
    kind: 'move',
    id: 'e1',
    items: [{ from: 'C:/a/x.md', to: 'D:/b/x.md' }],
    projects: { source: 'pa', target: 'pb' },
    at: 2,
  };
  const paste: FileOpUndoEntry = {
    kind: 'paste',
    id: 'e2',
    moved: [{ from: 'C:/a/m.md', to: 'D:/b/m.md' }],
    copied: [{ from: 'C:/a/c.md', to: 'D:/b/c.md' }],
    replaced: [{ path: 'D:/b/c.md', trashedAt: 10 }],
    projects: { source: 'pa', target: 'pb' },
    at: 3,
  };

  describe('parse', () => {
    it('round-trips a cross-project move and a paste entry', () => {
      const s = { undo: [xmove, paste], redo: [] };
      expect(parse(serialise(s))).toEqual(s);
    });

    it('still parses every pre-050 entry shape unchanged', () => {
      const s = record(record(record(emptyStack(), mv('a', 'b')), rn('c', 'd')), del('x'));
      expect(parse(serialise(s))).toEqual(s);
    });

    it('rejects a malformed projects pair or paste entry', () => {
      expect(parse(JSON.stringify({ undo: [{ ...xmove, projects: { source: 1 } }], redo: [] }))).toEqual(emptyStack());
      expect(parse(JSON.stringify({ undo: [{ ...paste, replaced: [{ path: 'x' }] }], redo: [] }))).toEqual(emptyStack());
      expect(parse(JSON.stringify({ undo: [{ ...paste, copied: 'no' }], redo: [] }))).toEqual(emptyStack());
    });

    it('round-trips the folders a paste created on a move and a paste entry (FR-033, R16)', () => {
      const s = {
        undo: [
          { ...xmove, createdDirs: ['D:/b/test'] },
          { ...paste, createdDirs: ['D:/b/test', 'D:/b/test/sub'] },
        ],
        redo: [],
      };
      expect(parse(serialise(s))).toEqual(s);
    });

    it('rejects a malformed createdDirs, as any malformed field', () => {
      expect(parse(JSON.stringify({ undo: [{ ...xmove, createdDirs: 'D:/b/test' }], redo: [] }))).toEqual(emptyStack());
      expect(parse(JSON.stringify({ undo: [{ ...paste, createdDirs: [1] }], redo: [] }))).toEqual(emptyStack());
    });
  });

  describe('plannedMoves', () => {
    it('is unchanged by createdDirs (FR-033, R16)', () => {
      const withDirs: FileOpUndoEntry = { ...xmove, createdDirs: ['D:/b/test'] };
      expect(plannedMoves(withDirs, 'undo')).toEqual(plannedMoves(xmove, 'undo'));
    });

    it('reverses only the moved items of a paste on undo, and replays them on redo', () => {
      expect(plannedMoves(paste, 'undo')).toEqual([{ from: 'D:/b/m.md', to: 'C:/a/m.md' }]);
      expect(plannedMoves(paste, 'redo')).toEqual([{ from: 'C:/a/m.md', to: 'D:/b/m.md' }]);
    });
  });

  describe('validate', () => {
    const world = (present: string[]) => (p: string) => present.includes(p);

    it('accepts a paste undo when everything it placed is still there and every moved source is free', () => {
      expect(validate(paste, 'undo', world(['D:/b/m.md', 'D:/b/c.md'])).ok).toBe(true);
    });

    it('refuses a paste undo when a moved or copied item has gone', () => {
      expect(validate(paste, 'undo', world(['D:/b/c.md'])).ok).toBe(false);
      expect(validate(paste, 'undo', world(['D:/b/m.md'])).ok).toBe(false);
    });

    it('refuses a paste undo when a moved item\'s source is occupied again', () => {
      expect(validate(paste, 'undo', world(['D:/b/m.md', 'D:/b/c.md', 'C:/a/m.md'])).ok).toBe(false);
    });

    it('accepts a paste redo when the sources are back and the targets are free or were replaced', () => {
      // D:/b/c.md exists again because the undo restored the replaced item — redo disposes of it again.
      expect(validate(paste, 'redo', world(['C:/a/m.md', 'C:/a/c.md', 'D:/b/c.md'])).ok).toBe(true);
    });

    it('refuses a paste redo when a source is gone, or a target not replaced is occupied', () => {
      expect(validate(paste, 'redo', world(['C:/a/c.md'])).ok).toBe(false);
      expect(validate(paste, 'redo', world(['C:/a/m.md', 'C:/a/c.md', 'D:/b/m.md'])).ok).toBe(false);
    });
  });

  describe('moving one entry between two projects\' stacks (FR-020)', () => {
    it('removeById takes the entry out of whichever list holds it', () => {
      const s = { undo: [mv('a', 'b'), xmove], redo: [paste] };
      expect(removeById(s, 'e1')).toEqual({ undo: [mv('a', 'b')], redo: [paste] });
      expect(removeById(s, 'e2')).toEqual({ undo: [mv('a', 'b'), xmove], redo: [] });
      expect(removeById(s, 'nope')).toEqual(s);
    });

    it('pushRedoEntry and pushUndoEntry add to one list without clearing the other', () => {
      const s = { undo: [mv('a', 'b')], redo: [rn('c', 'd')] };
      expect(pushRedoEntry(s, xmove)).toEqual({ undo: [mv('a', 'b')], redo: [rn('c', 'd'), xmove] });
      expect(pushUndoEntry(s, xmove)).toEqual({ undo: [mv('a', 'b'), xmove], redo: [rn('c', 'd')] });
    });

    it('pushUndoEntry keeps the stack bound', () => {
      let s = emptyStack();
      for (let i = 0; i < FILEOP_UNDO_BOUND; i += 1) s = record(s, mv(`a${i}`, `b${i}`));
      s = pushUndoEntry(s, xmove);
      expect(s.undo).toHaveLength(FILEOP_UNDO_BOUND);
      expect(s.undo[s.undo.length - 1]).toEqual(xmove);
    });

    it('dropEntriesNamingProjects drops entries that name a project no longer present', () => {
      const s = { undo: [mv('a', 'b'), xmove], redo: [paste] };
      expect(dropEntriesNamingProjects(s, ['pa', 'pb'])).toEqual(s);
      expect(dropEntriesNamingProjects(s, ['pb'])).toEqual({ undo: [mv('a', 'b')], redo: [] });
    });
  });
});
