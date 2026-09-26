import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, ProjectRepository, reconcileSchema, runMigrations } from '@throng/persistence';
import type { ThrongDatabase } from '@throng/persistence';
import { applyMigrationV2 } from '../../src/migrations/v2-projects-workspace.js';
import { applyMigrationV3 } from '../../src/migrations/v3-project-order.js';
import { applyMigrationV4 } from '../../src/migrations/v4-subworkspace-identity.js';
import { applyMigrationV5 } from '../../src/migrations/v5-subworkspace-order.js';
import { applyMigrationV6 } from '../../src/migrations/v6-project-hidden.js';
import { applyMigrationV7 } from '../../src/migrations/v7-document-state.js';
import { applyMigrationV8 } from '../../src/migrations/v8-fileop-undo.js';
import {
  applyMigrationV9,
  MIGRATION_V9_VERSION,
} from '../../src/migrations/v9-project-categories.js';

/**
 * Migration v9 — project categories (046, FR-058, SC-006; contracts/project-categories.md §3).
 *
 * Startup runs the chain EVERY time, so the property that matters most is the constitution's: a
 * migration is safe to re-run and safe against an already-migrated store, converging on the same
 * state without erroring or duplicating data. The four shapes below are the four ways a store can
 * arrive at v9: fresh, from v8, half-backfilled by an interrupted run, and stamped 9 by an
 * intermediate build that never added the column.
 *
 * The v8 store is built by applying v2–v8 directly rather than through `runMigrations`, so this
 * file keeps describing a v8 store after `LATEST_VERSION` moves past 9.
 */
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-v9-'));
  tempDirs.push(dir);
  return join(dir, 'throng.db');
}

/** The shipped default category name (FR-050; `SHIPPED_DEFAULT_CATEGORY_NAME` in core). */
const DEFAULT_NAME = 'In Progress';

/** A store exactly as a v8 build left it: every table and column up to v8, stamped 8. */
function openV8Db(path: string = freshDbPath()): ThrongDatabase {
  const db = openDatabase({ databasePath: path });
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
  })();
  db.pragma('user_version = 8');
  return db;
}

/** Insert a project row using only v8 columns, at an explicit global `position`. */
function seedV8Project(db: ThrongDatabase, owner: string, id: string, position: number): void {
  db.prepare(
    `INSERT INTO projects (id, owner_user, name, colour, root_folder, is_active, created_at, updated_at, position)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(id, owner, `p-${id}`, '#123456', `C:\\src\\${id}`, '2026-01-01', '2026-01-01', position);
}

function tableNames(db: ThrongDatabase): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => (r as { name: string }).name);
}

function columns(db: ThrongDatabase, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => (r as { name: string }).name);
}

interface CategoryRow {
  id: string;
  owner_user: string;
  name: string;
  is_default: number;
  minimised: number;
  created_at: string;
  updated_at: string;
}

function categories(db: ThrongDatabase): CategoryRow[] {
  return db.prepare('SELECT * FROM project_categories ORDER BY owner_user, id').all() as CategoryRow[];
}

function projectsInOrder(db: ThrongDatabase, owner: string): Array<{ id: string; position: number; category_id: string }> {
  return db
    .prepare(
      'SELECT id, position, category_id FROM projects WHERE owner_user = ? ORDER BY position ASC, id ASC',
    )
    .all(owner) as Array<{ id: string; position: number; category_id: string }>;
}

/** Every row of both touched tables — the idempotence comparison is over the whole store. */
function snapshot(db: ThrongDatabase): { projects: unknown[]; categories: unknown[] } {
  return {
    projects: db.prepare('SELECT * FROM projects ORDER BY id').all(),
    categories: db.prepare('SELECT * FROM project_categories ORDER BY id').all(),
  };
}

describe('migration v9 (project categories)', () => {
  it('is version 9, and a fresh database reaches it with the new table and column', () => {
    expect(MIGRATION_V9_VERSION).toBe(9);
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      const result = runMigrations(db);
      expect(result.to).toBeGreaterThanOrEqual(9);
      expect(columns(db, 'project_categories')).toEqual(
        expect.arrayContaining([
          'id',
          'owner_user',
          'name',
          'is_default',
          'minimised',
          'created_at',
          'updated_at',
        ]),
      );
      expect(columns(db, 'projects')).toContain('category_id');
      // A fresh store has no owners yet, so the backfill seeds nothing; the default is created on
      // demand by the repository's ensureDefault (R9 "Default on demand").
      expect(categories(db)).toEqual([]);
      expect(result.repairs).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('makes "one default per owner" a database fact: a second default insert fails', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      const insert = db.prepare(
        `INSERT INTO project_categories (id, owner_user, name, is_default, minimised, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, '2026-01-01', '2026-01-01')`,
      );
      insert.run('d1', 'alice', DEFAULT_NAME, 1);
      expect(() => insert.run('d2', 'alice', 'Other default', 1)).toThrow(/UNIQUE/i);
      // The index is partial: non-default categories and another owner's default are unaffected.
      expect(() => insert.run('c1', 'alice', 'Later', 0)).not.toThrow();
      expect(() => insert.run('c2', 'alice', 'Someday', 0)).not.toThrow();
      expect(() => insert.run('d3', 'bob', DEFAULT_NAME, 1)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('upgrades a v8 store: all three projects land in "In Progress" in their old position order', () => {
    const db = openV8Db();
    try {
      // Positions deliberately NOT in creation or id order, so an order rebuilt from anything but
      // `position` is caught.
      seedV8Project(db, 'alice', 'p-a', 2);
      seedV8Project(db, 'alice', 'p-b', 0);
      seedV8Project(db, 'alice', 'p-c', 1);
      // Read with v8 columns only: `category_id` does not exist until v9 runs.
      const before = db
        .prepare('SELECT id, position FROM projects WHERE owner_user = ? ORDER BY position ASC, id ASC')
        .all('alice') as Array<{ id: string; position: number }>;

      const result = runMigrations(db);
      expect(result.from).toBe(8);
      expect(result.to).toBeGreaterThanOrEqual(9);

      const cats = categories(db);
      expect(cats).toHaveLength(1);
      expect(cats[0]).toMatchObject({ owner_user: 'alice', name: DEFAULT_NAME, is_default: 1, minimised: 0 });
      expect(cats[0].id).not.toBe('');

      const after = projectsInOrder(db, 'alice');
      expect(after.map((p) => ({ id: p.id, position: p.position }))).toEqual(before);
      expect(after.map((p) => p.id)).toEqual(['p-b', 'p-c', 'p-a']);
      expect(after.every((p) => p.category_id === cats[0].id)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('seeds one default per owner, and each owner\'s projects join their own owner\'s default', () => {
    const db = openV8Db();
    try {
      seedV8Project(db, 'alice', 'a1', 0);
      seedV8Project(db, 'alice', 'a2', 1);
      seedV8Project(db, 'bob', 'b1', 0);
      runMigrations(db);

      const cats = categories(db);
      expect(cats.map((c) => c.owner_user)).toEqual(['alice', 'bob']);
      expect(cats.every((c) => c.is_default === 1 && c.name === DEFAULT_NAME)).toBe(true);
      const byOwner = new Map(cats.map((c) => [c.owner_user, c.id]));
      expect(projectsInOrder(db, 'alice').every((p) => p.category_id === byOwner.get('alice'))).toBe(true);
      expect(projectsInOrder(db, 'bob').every((p) => p.category_id === byOwner.get('bob'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('is idempotent: re-running v9 leaves every row identical (constitution, migrations)', () => {
    const db = openV8Db();
    try {
      seedV8Project(db, 'alice', 'p-a', 2);
      seedV8Project(db, 'alice', 'p-b', 0);
      seedV8Project(db, 'alice', 'p-c', 1);
      runMigrations(db);
      const first = snapshot(db);

      expect(() => db.transaction(() => applyMigrationV9(db))()).not.toThrow();
      expect(() => db.transaction(() => applyMigrationV9(db))()).not.toThrow();
      expect(snapshot(db)).toEqual(first);

      // And through the runner: nothing applied, nothing repaired, nothing changed.
      const again = runMigrations(db);
      expect(again.applied).toBe(false);
      expect(again.repairs).toEqual([]);
      expect(snapshot(db)).toEqual(first);
    } finally {
      db.close();
    }
  });

  it('completes an interrupted backfill: a default row exists, projects still carry \'\'', () => {
    const path = freshDbPath();
    let db = openV8Db(path);
    seedV8Project(db, 'alice', 'p-a', 2);
    seedV8Project(db, 'alice', 'p-b', 0);
    seedV8Project(db, 'alice', 'p-c', 1);
    runMigrations(db);
    const defaultId = categories(db)[0].id;
    // Reproduce the half-state: the category was inserted, the UPDATE never ran, the version
    // never stamped.
    db.prepare(`UPDATE projects SET category_id = ''`).run();
    db.pragma('user_version = 8');
    db.close();

    db = openDatabase({ databasePath: path });
    try {
      const result = runMigrations(db);
      expect(result.applied).toBe(true);
      const cats = categories(db);
      // The existing default is reused, never duplicated.
      expect(cats).toHaveLength(1);
      expect(cats[0].id).toBe(defaultId);
      const rows = projectsInOrder(db, 'alice');
      expect(rows.map((p) => p.id)).toEqual(['p-b', 'p-c', 'p-a']);
      expect(rows.every((p) => p.category_id === defaultId)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('heals a store stamped 9 with the table and projects.category_id missing, through reconcileSchema', () => {
    const path = freshDbPath();
    let db = openV8Db(path);
    seedV8Project(db, 'alice', 'p-a', 0);
    // An intermediate build stamped 9 without ever adding the column.
    db.pragma(`user_version = ${MIGRATION_V9_VERSION}`);
    expect(columns(db, 'projects')).not.toContain('category_id');
    expect(tableNames(db)).not.toContain('project_categories');

    // Directly: the guard alone knows the column and adds it.
    const repairs = reconcileSchema(db);
    expect(repairs).toContainEqual({ table: 'projects', column: 'category_id' });
    expect(repairs).toContainEqual({ table: 'project_categories', column: '*' });
    expect(columns(db, 'projects')).toContain('category_id');
    // The healed column carries the '' default that the read-time heal rule resolves (R9).
    const row = db.prepare(`SELECT category_id FROM projects WHERE id = 'p-a'`).get() as {
      category_id: string;
    };
    expect(row.category_id).toBe('');
    // The project store reads through project_categories (the heal rule JOINs it), so the guard must
    // recreate the TABLE too, or projects.list throws "no such table" and the list never loads.
    expect(new ProjectRepository(db).list('alice').map((p) => p.id)).toEqual(['p-a']);
    // Healing is idempotent: a second pass finds nothing to do.
    expect(reconcileSchema(db)).toEqual([]);
    db.close();

    // Through the runner as well, on a second drifted store.
    const path2 = freshDbPath();
    db = openV8Db(path2);
    db.pragma(`user_version = ${MIGRATION_V9_VERSION}`);
    db.close();
    db = openDatabase({ databasePath: path2 });
    try {
      const result = runMigrations(db);
      expect(result.repairs).toContainEqual({ table: 'projects', column: 'category_id' });
      expect(new ProjectRepository(db).list('alice')).toEqual([]);
      expect(() =>
        db
          .prepare(
            `INSERT INTO projects (id, owner_user, name, colour, root_folder, is_active, created_at, updated_at, position, category_id)
             VALUES ('p-new', 'alice', 'New', '#123456', 'C:\\src\\new', 0, 't', 't', 0, 'cat-1')`,
          )
          .run(),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });
});
