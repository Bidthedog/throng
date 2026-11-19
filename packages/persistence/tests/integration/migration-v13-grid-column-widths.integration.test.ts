import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, DocumentStateRepository, LATEST_VERSION } from '@throng/persistence';

/**
 * Migration v13 + the per-file grid column widths (073 FR-040, research R8, data-model §7).
 *
 * Layer: integration — a column added to a real SQLite schema, the guard that heals it, and the row
 * lifecycle (a row deleted only when BOTH leaves are empty) are properties of the real store.
 */
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): ReturnType<typeof openDatabase> {
  const dir = mkdtempSync(join(tmpdir(), 'throng-v13-'));
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

describe('migration v13', () => {
  it('brings the store to v13 with an empty widths column, and a re-run changes nothing', () => {
    const db = freshDb();
    try {
      expect(LATEST_VERSION).toBeGreaterThanOrEqual(13);
      const cols = db.prepare(`PRAGMA table_info(document_state)`).all() as { name: string; dflt_value: string | null }[];
      expect(cols.find((c) => c.name === 'grid_column_widths')?.dflt_value).toBe("''");
      seedProject(db, 'p1');
      new DocumentStateRepository(db).setGridColumnWidths(OWNER, 'p1', 'data.csv', '{"0":200}');
      expect(runMigrations(db).applied).toBe(false);
      expect(new DocumentStateRepository(db).get(OWNER, 'p1', 'data.csv')?.gridColumnWidths).toBe('{"0":200}');
    } finally {
      db.close();
    }
  });
});

describe('grid column widths beside the language override', () => {
  it('keeps each leaf when the other is cleared, and drops the row only when both are empty', () => {
    const db = freshDb();
    try {
      seedProject(db, 'p1');
      const repo = new DocumentStateRepository(db);
      repo.set(OWNER, 'p1', 'data.csv', 'plaintext');
      repo.setGridColumnWidths(OWNER, 'p1', 'data.csv', '{"1":90}');
      expect(repo.get(OWNER, 'p1', 'data.csv')).toEqual({
        projectId: 'p1',
        relPath: 'data.csv',
        languageId: 'plaintext',
        gridColumnWidths: '{"1":90}',
      });

      // Clearing the override used to delete the whole row; the widths must survive it.
      repo.set(OWNER, 'p1', 'data.csv', null);
      expect(repo.get(OWNER, 'p1', 'data.csv')).toMatchObject({ languageId: null, gridColumnWidths: '{"1":90}' });

      repo.setGridColumnWidths(OWNER, 'p1', 'data.csv', null);
      expect(repo.get(OWNER, 'p1', 'data.csv')).toBeNull();
    } finally {
      db.close();
    }
  });

  it('travels with the file on a move', () => {
    const db = freshDb();
    try {
      seedProject(db, 'p1');
      const repo = new DocumentStateRepository(db);
      repo.setGridColumnWidths(OWNER, 'p1', 'a.csv', '{"0":300}');
      expect(repo.movePath(OWNER, 'p1', 'a.csv', 'b.csv')).toBe(true);
      expect(repo.get(OWNER, 'p1', 'b.csv')?.gridColumnWidths).toBe('{"0":300}');
    } finally {
      db.close();
    }
  });
});
