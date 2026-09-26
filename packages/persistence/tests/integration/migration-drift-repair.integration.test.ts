import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectService } from '@throng/core';
import {
  openDatabase,
  runMigrations,
  LATEST_VERSION,
  ProjectCategoryRepository,
  ProjectRepository,
} from '@throng/persistence';
import type { ThrongDatabase } from '@throng/persistence';

const tempDirs: string[] = [];
function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-drift-'));
  tempDirs.push(dir);
  return join(dir, 'throng.db');
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function columns(db: ThrongDatabase, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => (r as { name: string }).name);
}

/**
 * Regression for the "can no longer create sub-workspaces" defect: a developer DB
 * left half-migrated by an intermediate build — stamped to the LATEST
 * `user_version` (so the version-keyed runner short-circuits) yet missing columns a
 * later-renumbered migration was meant to add. The schema guard must reconcile this
 * drift on the next run so persistence works again.
 */
describe('schema-drift repair (migration safety net)', () => {
  it('heals a DB stamped to LATEST but missing sub_workspaces name/colour columns', () => {
    const path = freshDbPath();

    // Build the exact drifted shape: base + position, but NO name/colour, then
    // stamp user_version to LATEST so a naive version-keyed runner does nothing.
    let db = openDatabase({ databasePath: path });
    db.exec('DROP TABLE IF EXISTS sub_workspaces');
    db.exec(`
      CREATE TABLE sub_workspaces (
        id           TEXT PRIMARY KEY,
        owner_user   TEXT NOT NULL,
        bounds_json  TEXT NOT NULL,
        content_json TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        position     INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.pragma(`user_version = ${LATEST_VERSION}`);
    expect(columns(db, 'sub_workspaces')).not.toContain('name');
    db.close();

    // Re-open and run migrations: the guard should add the missing columns even
    // though the version is already current.
    db = openDatabase({ databasePath: path });
    try {
      const result = runMigrations(db);

      const cols = columns(db, 'sub_workspaces');
      expect(cols).toContain('name');
      expect(cols).toContain('colour');
      expect(result.repairs).toEqual(
        expect.arrayContaining([
          { table: 'sub_workspaces', column: 'name' },
          { table: 'sub_workspaces', column: 'colour' },
        ]),
      );

      // The whole point: a persist-shaped insert now succeeds instead of throwing
      // "no such column: name".
      expect(() =>
        db
          .prepare(
            `INSERT INTO sub_workspaces
               (id, owner_user, name, colour, bounds_json, content_json, updated_at, position)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run('s1', 'u', 'Sub-workspace 1', '#6aa3ff', '{}', '[]', 't', 0),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('heals a DB stamped to LATEST but missing projects.category_id (046, v9)', () => {
    const path = freshDbPath();

    // A fully migrated store, then the category column taken away again: the shape an
    // intermediate build leaves when it stamps the version without adding the column.
    let db = openDatabase({ databasePath: path });
    runMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, owner_user, name, colour, root_folder, is_active, created_at, updated_at)
       VALUES ('p1', 'u', 'P', '#123456', 'C:/p1', 0, 't', 't')`,
    ).run();
    db.exec('ALTER TABLE projects DROP COLUMN category_id');
    db.pragma(`user_version = ${LATEST_VERSION}`);
    expect(columns(db, 'projects')).not.toContain('category_id');
    db.close();

    db = openDatabase({ databasePath: path });
    try {
      const result = runMigrations(db);
      expect(columns(db, 'projects')).toContain('category_id');
      expect(result.repairs).toEqual(
        expect.arrayContaining([{ table: 'projects', column: 'category_id' }]),
      );
      // The existing row survives and carries the '' default the read-time heal resolves.
      const row = db.prepare(`SELECT category_id FROM projects WHERE id = 'p1'`).get() as {
        category_id: string;
      };
      expect(row.category_id).toBe('');
      // This owner has NO default category (v9 ran on an empty store, so it seeded none). Listing
      // through the service must still never report '' (ipc-contract ProjectDto.categoryId): the
      // list creates the default the heal rule resolves into.
      expect(new ProjectCategoryRepository(db).list('u')).toEqual([]);
      const service = new ProjectService({
        store: new ProjectRepository(db),
        categories: new ProjectCategoryRepository(db),
        userContext: { currentUser: () => ({ userId: 'u', userName: 'U' }) },
        newId: () => 'default-u',
        now: () => '2026-01-01T00:00:00.000Z',
      });
      expect(service.list().map((p) => [p.id, p.categoryId])).toEqual([['p1', 'default-u']]);
      // A write naming the column now succeeds instead of "no such column: category_id".
      expect(() =>
        db.prepare(`UPDATE projects SET category_id = ? WHERE id = 'p1'`).run('cat-1'),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('heals a DB stamped to LATEST but missing project_categories.position (046, v10)', () => {
    const path = freshDbPath();

    // A fully migrated store with two categories, then the position column taken away again.
    let db = openDatabase({ databasePath: path });
    runMigrations(db);
    const categories = new ProjectCategoryRepository(db);
    categories.ensureDefault('u', { id: 'd-u', name: 'In Progress', now: '2026-01-01T00:00:00.000Z' });
    db.prepare(
      `INSERT INTO project_categories (id, owner_user, name, is_default, minimised, created_at, updated_at)
       VALUES ('c-1', 'u', 'Later', 0, 0, 't', 't')`,
    ).run();
    db.exec('ALTER TABLE project_categories DROP COLUMN position');
    db.pragma(`user_version = ${LATEST_VERSION}`);
    expect(columns(db, 'project_categories')).not.toContain('position');
    db.close();

    db = openDatabase({ databasePath: path });
    try {
      const result = runMigrations(db);
      expect(columns(db, 'project_categories')).toContain('position');
      expect(result.repairs).toEqual(
        expect.arrayContaining([{ table: 'project_categories', column: 'position' }]),
      );
      // The rows survive, and the store reads them instead of throwing "no such column: position".
      expect(new ProjectCategoryRepository(db).list('u').map((c) => c.id)).toEqual(['d-u', 'c-1']);
      // A write naming the column now succeeds.
      expect(() =>
        db.prepare(`UPDATE project_categories SET position = ? WHERE id = 'c-1'`).run(3),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('is a no-op (no repairs) on a healthy, fully-migrated DB', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      const result = runMigrations(db);
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
      expect(result.repairs).toEqual([]);
    } finally {
      db.close();
    }
  });
});
