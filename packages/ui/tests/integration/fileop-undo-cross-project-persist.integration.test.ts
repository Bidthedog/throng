import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FILEOP_UNDO_BOUND,
  emptyStack,
  parseFileOpStack,
  recordFileOp,
  serialiseFileOpStack,
  type FileOpUndoEntry,
  type FileOpUndoStack,
} from '@throng/core';
import { FileOpUndoRepository, openDatabase, runMigrations, type ThrongDatabase } from '@throng/persistence';

/**
 * A cross-project undo entry persists and restores like any other (050 FR-021, US3 AS5 — T064).
 *
 * One entry, in BOTH projects' stacks, through the real repository and a real reopen of the database —
 * which is the restart a user makes. It must come back from each, matched by id, and count toward each
 * stack's 50-entry bound.
 */

const OWNER = 'user-1';
let dir: string;
let dbPath: string;
let db: ThrongDatabase;

function open(): ThrongDatabase {
  const d = openDatabase({ databasePath: dbPath });
  runMigrations(d);
  return d;
}

function seedProject(id: string): void {
  db.prepare(
    `INSERT INTO projects (id, owner_user, name, colour, root_folder, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, OWNER, `p-${id}`, '#123456', `C:\\src\\${id}`, '2026-01-01', '2026-01-01');
}

const cross: FileOpUndoEntry = {
  kind: 'move',
  id: 'cross-1',
  items: [{ from: 'C:\\src\\A\\a.txt', to: 'C:\\src\\B\\a.txt' }],
  projects: { source: 'A', target: 'B' },
  at: 5000,
};

const pasteEntry: FileOpUndoEntry = {
  kind: 'paste',
  id: 'paste-1',
  moved: [],
  copied: [{ from: 'C:\\src\\A\\x.txt', to: 'C:\\src\\B\\x.txt' }],
  replaced: [{ path: 'C:\\src\\B\\x.txt', trashedAt: 4000 }],
  projects: { source: 'A', target: 'B' },
  at: 6000,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'throng-xundo-'));
  dbPath = join(dir, 'throng.db');
  db = open();
  seedProject('A');
  seedProject('B');
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function save(repo: FileOpUndoRepository, projectId: string, stack: FileOpUndoStack): void {
  repo.set(OWNER, projectId, serialiseFileOpStack(stack), '2026-10-03');
}

describe('a cross-project entry across a restart (FR-021)', () => {
  it('saved into both stacks, it reads back from each after a reopen', () => {
    let repo = new FileOpUndoRepository(db);
    save(repo, 'A', recordFileOp(recordFileOp(emptyStack(), cross), pasteEntry));
    save(repo, 'B', recordFileOp(recordFileOp(emptyStack(), cross), pasteEntry));
    db.close();
    db = open();
    repo = new FileOpUndoRepository(db);
    for (const projectId of ['A', 'B']) {
      const stack = parseFileOpStack(repo.get(OWNER, projectId));
      expect(stack.undo).toEqual([cross, pasteEntry]);
    }
  });

  it('counts toward EACH stack’s 50-entry bound', () => {
    let stackA = emptyStack();
    for (let i = 0; i < FILEOP_UNDO_BOUND; i++) {
      stackA = recordFileOp(stackA, { kind: 'rename', id: `r${i}`, from: `C:\\src\\A\\${i}`, to: `C:\\src\\A\\${i}b`, at: i });
    }
    stackA = recordFileOp(stackA, cross);
    let repo = new FileOpUndoRepository(db);
    save(repo, 'A', stackA);
    save(repo, 'B', recordFileOp(emptyStack(), cross));
    db.close();
    db = open();
    repo = new FileOpUndoRepository(db);
    const a = parseFileOpStack(repo.get(OWNER, 'A'));
    expect(a.undo).toHaveLength(FILEOP_UNDO_BOUND);
    expect(a.undo.at(-1)).toEqual(cross);
    expect(a.undo[0]).toMatchObject({ id: 'r1' });
    expect(parseFileOpStack(repo.get(OWNER, 'B')).undo).toEqual([cross]);
  });
});
