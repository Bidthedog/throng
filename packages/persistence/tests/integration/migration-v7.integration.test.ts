import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, DocumentStateRepository } from '@throng/persistence';

/**
 * Migration v7 + the document-state store (016, FR-028e).
 *
 * Idempotence is the property that matters: startup runs the chain EVERY TIME, so a migration that
 * is not safe to re-run is a migration that corrupts the store on the second launch.
 */
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): ReturnType<typeof openDatabase> {
  const dir = mkdtempSync(join(tmpdir(), 'throng-v7-'));
  tempDirs.push(dir);
  const db = openDatabase({ databasePath: join(dir, 'throng.db') });
  runMigrations(db);
  return db;
}

const OWNER = 'user-1';

function seedProject(db: ReturnType<typeof openDatabase>, id: string): void {
  // Only the columns the base schema declares; the later additive columns carry defaults.
  db.prepare(
    `INSERT INTO projects (id, owner_user, name, colour, root_folder, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, OWNER, `p-${id}`, '#123456', `C:\\src\\${id}`, '2026-01-01', '2026-01-01');
}

describe('migration v7', () => {
  it('creates document_state and its index', () => {
    const db = freshDb();
    try {
      const objects = db
        .prepare("SELECT name, type FROM sqlite_master WHERE name IN ('document_state', 'idx_docstate_owner_project')")
        .all() as { name: string; type: string }[];
      expect(objects.map((o) => o.name).sort()).toEqual([
        'document_state',
        'idx_docstate_owner_project',
      ]);
    } finally {
      db.close();
    }
  });

  it('is IDEMPOTENT — re-running the chain against an already-migrated store changes nothing', () => {
    const db = freshDb();
    try {
      seedProject(db, 'p1');
      const repo = new DocumentStateRepository(db);
      repo.set(OWNER, 'p1', 'src/main.rs', 'python');

      const again = runMigrations(db);
      expect(again.applied).toBe(false);
      expect(again.to).toBe(7);
      // The data survived: a migration that dropped and recreated the table would lose it.
      expect(repo.get(OWNER, 'p1', 'src/main.rs')?.languageId).toBe('python');
    } finally {
      db.close();
    }
  });
});

describe('DocumentStateRepository (FR-028e)', () => {
  it('round-trips an override, and reports null for a document that has none', () => {
    const db = freshDb();
    try {
      seedProject(db, 'p1');
      const repo = new DocumentStateRepository(db);
      expect(repo.get(OWNER, 'p1', 'never/seen.txt')).toBeNull();

      repo.set(OWNER, 'p1', 'src/main.rs', 'python');
      expect(repo.get(OWNER, 'p1', 'src/main.rs')).toEqual({
        projectId: 'p1',
        relPath: 'src/main.rs',
        languageId: 'python',
      });

      // Setting again overwrites rather than duplicating (the composite primary key).
      repo.set(OWNER, 'p1', 'src/main.rs', 'ruby');
      expect(repo.get(OWNER, 'p1', 'src/main.rs')?.languageId).toBe('ruby');
    } finally {
      db.close();
    }
  });

  it('treats null as an ERASURE, but stores `plaintext` as a real row (FR-004c)', () => {
    const db = freshDb();
    try {
      seedProject(db, 'p1');
      const repo = new DocumentStateRepository(db);

      // 'plaintext' is a DECISION — the user said this file is plain text. Collapsing it to null
      // would hand the file back to detection, which is exactly what they overrode.
      repo.set(OWNER, 'p1', 'a.rs', 'plaintext');
      expect(repo.get(OWNER, 'p1', 'a.rs')?.languageId).toBe('plaintext');

      repo.set(OWNER, 'p1', 'a.rs', null);
      expect(repo.get(OWNER, 'p1', 'a.rs')).toBeNull();
    } finally {
      db.close();
    }
  });

  it('PRESERVES an id this build does not recognise (FR-005b)', () => {
    const db = freshDb();
    try {
      seedProject(db, 'p1');
      const repo = new DocumentStateRepository(db);
      // A language a later build removed, or an older build has not yet gained. It round-trips
      // unchanged, so a build that reintroduces it resolves the user's choice again.
      repo.set(OWNER, 'p1', 'a.zz', 'elvish');
      expect(repo.get(OWNER, 'p1', 'a.zz')?.languageId).toBe('elvish');
    } finally {
      db.close();
    }
  });

  it('carries the row with the file across a rename (movePath)', () => {
    const db = freshDb();
    try {
      seedProject(db, 'p1');
      const repo = new DocumentStateRepository(db);
      repo.set(OWNER, 'p1', 'old.txt', 'sql');

      expect(repo.movePath(OWNER, 'p1', 'old.txt', 'new.txt')).toBe(true);
      expect(repo.get(OWNER, 'p1', 'old.txt')).toBeNull();
      expect(repo.get(OWNER, 'p1', 'new.txt')?.languageId).toBe('sql');
    } finally {
      db.close();
    }
  });

  it('reports `false` — not an error — when the moved file had no override', () => {
    const db = freshDb();
    try {
      seedProject(db, 'p1');
      const repo = new DocumentStateRepository(db);
      // The COMMON case: most files carry no override at all.
      expect(repo.movePath(OWNER, 'p1', 'plain.txt', 'renamed.txt')).toBe(false);
    } finally {
      db.close();
    }
  });

  it('lets the moved row win when the rename clobbers an existing file', () => {
    const db = freshDb();
    try {
      seedProject(db, 'p1');
      const repo = new DocumentStateRepository(db);
      repo.set(OWNER, 'p1', 'from.txt', 'go');
      repo.set(OWNER, 'p1', 'to.txt', 'ruby');

      expect(repo.movePath(OWNER, 'p1', 'from.txt', 'to.txt')).toBe(true);
      // The row that survives describes the file that now lives there.
      expect(repo.get(OWNER, 'p1', 'to.txt')?.languageId).toBe('go');
      expect(repo.get(OWNER, 'p1', 'from.txt')).toBeNull();
    } finally {
      db.close();
    }
  });

  it('removes a row when the file is deleted inside throng', () => {
    const db = freshDb();
    try {
      seedProject(db, 'p1');
      const repo = new DocumentStateRepository(db);
      repo.set(OWNER, 'p1', 'gone.rs', 'rust');
      expect(repo.remove(OWNER, 'p1', 'gone.rs')).toBe(true);
      expect(repo.get(OWNER, 'p1', 'gone.rs')).toBeNull();
      // A file re-created at the same path must NOT inherit the old override.
      expect(repo.get(OWNER, 'p1', 'gone.rs')).toBeNull();
    } finally {
      db.close();
    }
  });

  it('prunes only the rows whose file is gone', () => {
    const db = freshDb();
    try {
      seedProject(db, 'p1');
      const repo = new DocumentStateRepository(db);
      repo.set(OWNER, 'p1', 'kept.rs', 'rust');
      repo.set(OWNER, 'p1', 'vanished.rs', 'go');

      // The predicate is asked about each ROW — it is never handed a list of survivors, because an
      // incomplete list would silently delete every override the caller forgot to enumerate.
      expect(repo.pruneMissing(OWNER, 'p1', (rel) => rel === 'kept.rs')).toBe(1);
      expect(repo.get(OWNER, 'p1', 'kept.rs')?.languageId).toBe('rust');
      expect(repo.get(OWNER, 'p1', 'vanished.rs')).toBeNull();
    } finally {
      db.close();
    }
  });

  it('keeps one user’s rows away from another’s, and one project’s from another’s', () => {
    const db = freshDb();
    try {
      seedProject(db, 'p1');
      seedProject(db, 'p2');
      const repo = new DocumentStateRepository(db);
      repo.set(OWNER, 'p1', 'a.txt', 'sql');

      expect(repo.get('someone-else', 'p1', 'a.txt')).toBeNull();
      expect(repo.get(OWNER, 'p2', 'a.txt')).toBeNull();
    } finally {
      db.close();
    }
  });

  it('CASCADES: deleting the project takes its document rows with it (Principle I)', () => {
    const db = freshDb();
    try {
      seedProject(db, 'p1');
      const repo = new DocumentStateRepository(db);
      repo.set(OWNER, 'p1', 'a.txt', 'sql');

      db.prepare('DELETE FROM projects WHERE id = ?').run('p1');
      expect(repo.get(OWNER, 'p1', 'a.txt')).toBeNull();
    } finally {
      db.close();
    }
  });
});
