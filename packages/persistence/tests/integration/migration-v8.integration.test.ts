import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, LATEST_VERSION, FileOpUndoRepository } from '@throng/persistence';
import { applyMigrationV8 } from '../../src/migrations/v8-fileop-undo.js';

/**
 * Migration v8 + the file-operation undo store (024 US3, #85). Idempotence is the property that
 * matters: startup runs the chain EVERY TIME, so a re-run must be a safe no-op (constitution v3.5.0).
 */
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): ReturnType<typeof openDatabase> {
  const dir = mkdtempSync(join(tmpdir(), 'throng-v8-'));
  tempDirs.push(dir);
  const db = openDatabase({ databasePath: join(dir, 'throng.db') });
  runMigrations(db);
  return db;
}

const OWNER = 'user-1';

function seedProject(db: ReturnType<typeof openDatabase>, id: string): void {
  db.prepare(
    `INSERT INTO projects (id, owner_user, name, colour, root_folder, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, OWNER, `p-${id}`, '#123456', `C:\\src\\${id}`, '2026-01-01', '2026-01-01');
}

describe('migration v8', () => {
  it('brings the chain up to v8 and creates the fileop_undo table', () => {
    const db = freshDb();
    try {
      expect(LATEST_VERSION).toBe(8);
      const t = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fileop_undo'")
        .get();
      expect(t).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('round-trips a per-project stack blob and upserts it', () => {
    const db = freshDb();
    try {
      seedProject(db, 'proj-1');
      const repo = new FileOpUndoRepository(db);
      expect(repo.get(OWNER, 'proj-1')).toBeNull();
      repo.set(OWNER, 'proj-1', '{"undo":[1],"redo":[]}', '2026-07-23');
      expect(repo.get(OWNER, 'proj-1')).toBe('{"undo":[1],"redo":[]}');
      repo.set(OWNER, 'proj-1', '{"undo":[1,2],"redo":[]}', '2026-07-24'); // upsert
      expect(repo.get(OWNER, 'proj-1')).toBe('{"undo":[1,2],"redo":[]}');
    } finally {
      db.close();
    }
  });

  it('cascades the stack away when its project is deleted', () => {
    const db = freshDb();
    try {
      seedProject(db, 'proj-2');
      const repo = new FileOpUndoRepository(db);
      repo.set(OWNER, 'proj-2', '{"undo":[],"redo":[]}', '2026-07-23');
      db.prepare('DELETE FROM projects WHERE id = ?').run('proj-2');
      expect(repo.get(OWNER, 'proj-2')).toBeNull();
    } finally {
      db.close();
    }
  });

  it('is idempotent — re-running v8 against an already-migrated store is a safe no-op (v3.5.0)', () => {
    const db = freshDb();
    try {
      seedProject(db, 'proj-3');
      const repo = new FileOpUndoRepository(db);
      repo.set(OWNER, 'proj-3', '{"undo":[9],"redo":[]}', '2026-07-23');
      // Re-run the migration directly; it must not throw and must not drop existing data.
      expect(() => applyMigrationV8(db)).not.toThrow();
      expect(repo.get(OWNER, 'proj-3')).toBe('{"undo":[9],"redo":[]}');
    } finally {
      db.close();
    }
  });
});
