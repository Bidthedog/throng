import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openDatabase,
  reconcileSchema,
  runMigrations,
  DocumentStateRepository,
  LATEST_VERSION,
  type ThrongDatabase,
} from '@throng/persistence';
import { applyMigrationV2 } from '../../src/migrations/v2-projects-workspace.js';
import { applyMigrationV3 } from '../../src/migrations/v3-project-order.js';
import { applyMigrationV4 } from '../../src/migrations/v4-subworkspace-identity.js';
import { applyMigrationV5 } from '../../src/migrations/v5-subworkspace-order.js';
import { applyMigrationV6 } from '../../src/migrations/v6-project-hidden.js';
import { applyMigrationV7 } from '../../src/migrations/v7-document-state.js';
import { applyMigrationV8 } from '../../src/migrations/v8-fileop-undo.js';
import { applyMigrationV9 } from '../../src/migrations/v9-project-categories.js';
import { applyMigrationV10 } from '../../src/migrations/v10-category-position.js';
import { applyMigrationV11 } from '../../src/migrations/v11-attention-flags.js';
import { applyMigrationV12 } from '../../src/migrations/v12-project-search-excludes.js';
import { applyMigrationV13 } from '../../src/migrations/v13-grid-column-widths.js';

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

/** A store exactly as a v12 build left it: every step through v12, stamped 12, no widths column. */
function openV12Db(): ThrongDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'throng-v13-up-'));
  tempDirs.push(dir);
  const db = openDatabase({ databasePath: join(dir, 'throng.db') });
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT OR REPLACE INTO _meta(key, value) VALUES (?, ?)').run('baseline_version', '1');
    applyMigrationV2(db);
    applyMigrationV3(db);
    applyMigrationV4(db);
    applyMigrationV5(db);
    applyMigrationV6(db);
    applyMigrationV7(db);
    applyMigrationV8(db);
    applyMigrationV9(db);
    applyMigrationV10(db);
    applyMigrationV11(db);
    applyMigrationV12(db);
  })();
  db.pragma('user_version = 12');
  return db;
}

function hasWidthsColumn(db: ThrongDatabase): boolean {
  const cols = db.prepare('PRAGMA table_info(document_state)').all() as { name: string }[];
  return cols.some((c) => c.name === 'grid_column_widths');
}

/** Seed the document rows a v12 build could have written: language overrides only. */
function seedV12Documents(db: ThrongDatabase): void {
  seedProject(db, 'p1');
  const insert = db.prepare(
    `INSERT INTO document_state (owner_user, project_id, rel_path, language_id, updated_at) VALUES (?, ?, ?, ?, ?)`,
  );
  insert.run(OWNER, 'p1', 'a.csv', 'plaintext', '2026-01-01');
  insert.run(OWNER, 'p1', 'src/b.ts', 'typescript', '2026-01-02');
}

describe('migration v13 against an existing store', () => {
  it('upgrades a v12 store holding document rows: every row survives and reads back with no widths', () => {
    const db = openV12Db();
    try {
      seedV12Documents(db);
      expect(hasWidthsColumn(db)).toBe(false);

      const result = runMigrations(db);
      expect(result.from).toBe(12);
      expect(result.to).toBe(LATEST_VERSION);
      expect(hasWidthsColumn(db)).toBe(true);

      // The column default lands on the old rows as '' — the "no widths" value the repository reads as null.
      const raw = db
        .prepare(`SELECT rel_path, language_id, grid_column_widths FROM document_state ORDER BY rel_path`)
        .all();
      expect(raw).toEqual([
        { rel_path: 'a.csv', language_id: 'plaintext', grid_column_widths: '' },
        { rel_path: 'src/b.ts', language_id: 'typescript', grid_column_widths: '' },
      ]);
      const repo = new DocumentStateRepository(db);
      expect(repo.get(OWNER, 'p1', 'a.csv')).toEqual({
        projectId: 'p1',
        relPath: 'a.csv',
        languageId: 'plaintext',
        gridColumnWidths: null,
      });

      // An upgraded row takes widths beside its override without losing it.
      repo.setGridColumnWidths(OWNER, 'p1', 'a.csv', '{"0":120}');
      expect(repo.get(OWNER, 'p1', 'a.csv')).toMatchObject({ languageId: 'plaintext', gridColumnWidths: '{"0":120}' });
    } finally {
      db.close();
    }
  });

  it('is idempotent: applyMigrationV13 re-run on a migrated store neither throws nor changes a row', () => {
    const db = openV12Db();
    try {
      seedV12Documents(db);
      runMigrations(db);
      const repo = new DocumentStateRepository(db);
      repo.setGridColumnWidths(OWNER, 'p1', 'a.csv', '{"2":75}');
      const before = db.prepare(`SELECT * FROM document_state ORDER BY rel_path`).all();

      expect(() => applyMigrationV13(db)).not.toThrow();
      expect(() => applyMigrationV13(db)).not.toThrow();
      const rerun = runMigrations(db);
      expect(rerun.applied).toBe(false);
      expect(rerun.repairs).toEqual([]);

      expect(db.prepare(`SELECT * FROM document_state ORDER BY rel_path`).all()).toEqual(before);
      const cols = db.prepare('PRAGMA table_info(document_state)').all() as { name: string }[];
      expect(cols.filter((c) => c.name === 'grid_column_widths')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('the schema guard re-adds a missing grid_column_widths column on a store stamped past v13', () => {
    const db = openV12Db();
    try {
      seedV12Documents(db);
      runMigrations(db);
      db.exec('ALTER TABLE document_state DROP COLUMN grid_column_widths');
      expect(hasWidthsColumn(db)).toBe(false);

      const repairs = reconcileSchema(db);
      expect(repairs).toContainEqual({ table: 'document_state', column: 'grid_column_widths' });
      expect(hasWidthsColumn(db)).toBe(true);

      // The healed store is writable again, and the rows it held kept their overrides.
      const repo = new DocumentStateRepository(db);
      expect(repo.get(OWNER, 'p1', 'src/b.ts')).toMatchObject({ languageId: 'typescript', gridColumnWidths: null });
      repo.setGridColumnWidths(OWNER, 'p1', 'src/b.ts', '{"1":64}');
      expect(repo.get(OWNER, 'p1', 'src/b.ts')?.gridColumnWidths).toBe('{"1":64}');
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
