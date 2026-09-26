import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openDatabase,
  ProjectCategoryRepository,
  reconcileSchema,
  runMigrations,
} from '@throng/persistence';
import type { ThrongDatabase } from '@throng/persistence';
import { applyMigrationV2 } from '../../src/migrations/v2-projects-workspace.js';
import { applyMigrationV3 } from '../../src/migrations/v3-project-order.js';
import { applyMigrationV4 } from '../../src/migrations/v4-subworkspace-identity.js';
import { applyMigrationV5 } from '../../src/migrations/v5-subworkspace-order.js';
import { applyMigrationV6 } from '../../src/migrations/v6-project-hidden.js';
import { applyMigrationV7 } from '../../src/migrations/v7-document-state.js';
import { applyMigrationV8 } from '../../src/migrations/v8-fileop-undo.js';
import { applyMigrationV9 } from '../../src/migrations/v9-project-categories.js';
import {
  applyMigrationV10,
  MIGRATION_V10_VERSION,
} from '../../src/migrations/v10-category-position.js';

/**
 * Migration v10 — an explicit category position (046 iterate round 1, FR-083 / FR-084;
 * contracts/project-categories.md §5; data-model §1).
 *
 * Before v10 the category list was ordered "default first, then `created_at`, then `id`". v10 adds
 * `project_categories.position` and seeds it FROM that order, so an upgraded list looks exactly as
 * it did (FR-084). The constitution's migration rule binds the rest: safe to re-run, safe against an
 * already-migrated store, and every added column registered with the schema-drift guard.
 *
 * The v9 store is built by applying v2–v9 directly rather than through `runMigrations`, so this file
 * keeps describing a v9 store after `LATEST_VERSION` moves past 10.
 */
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-v10-'));
  tempDirs.push(dir);
  return join(dir, 'throng.db');
}

/** A store exactly as a v9 build left it: every table and column up to v9, stamped 9. */
function openV9Db(path: string = freshDbPath()): ThrongDatabase {
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
    applyMigrationV9(db);
  })();
  db.pragma('user_version = 9');
  return db;
}

/** Insert a category row using only v9 columns. */
function seedV9Category(
  db: ThrongDatabase,
  owner: string,
  id: string,
  createdAt: string,
  isDefault = false,
): void {
  db.prepare(
    `INSERT INTO project_categories (id, owner_user, name, is_default, minimised, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, owner, `Cat ${id}`, isDefault ? 1 : 0, createdAt, createdAt);
}

/**
 * Three non-default categories whose creation order differs from their id order, plus a default
 * created LAST in time — so an order rebuilt from `id`, or from `created_at` without the "default
 * first" rule, is caught. The v9 visible order is: d-alice, c-z, c-a, c-m.
 */
function seedThreeCategories(db: ThrongDatabase, owner = 'alice'): string[] {
  seedV9Category(db, owner, 'c-m', '2026-03-01T00:00:00.000Z');
  seedV9Category(db, owner, 'c-z', '2026-01-01T00:00:00.000Z');
  seedV9Category(db, owner, 'c-a', '2026-02-01T00:00:00.000Z');
  seedV9Category(db, owner, `d-${owner}`, '2026-09-01T00:00:00.000Z', true);
  return [`d-${owner}`, 'c-z', 'c-a', 'c-m'];
}

/** The pre-v10 visible order, read with v9 columns only (`position` does not exist yet). */
function v9VisibleOrder(db: ThrongDatabase, owner: string): string[] {
  return (
    db
      .prepare(
        `SELECT id FROM project_categories WHERE owner_user = ?
          ORDER BY is_default DESC, created_at ASC, id ASC`,
      )
      .all(owner) as Array<{ id: string }>
  ).map((r) => r.id);
}

function columns(db: ThrongDatabase, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => (r as { name: string }).name);
}

/** The non-default rows' raw positions, in the order the list shows them. */
function nonDefaultPositions(db: ThrongDatabase, owner: string, visible: readonly string[]): number[] {
  const byId = new Map(
    (
      db
        .prepare(`SELECT id, position FROM project_categories WHERE owner_user = ? AND is_default = 0`)
        .all(owner) as Array<{ id: string; position: number }>
    ).map((r) => [r.id, r.position] as const),
  );
  return visible.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
}

/** Every category row — the idempotence comparison is over the whole table. */
function snapshot(db: ThrongDatabase): unknown[] {
  return db.prepare('SELECT * FROM project_categories ORDER BY owner_user, id').all();
}

describe('migration v10 (category position)', () => {
  it('is version 10, and a fresh database reaches it with project_categories.position', () => {
    expect(MIGRATION_V10_VERSION).toBe(10);
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      const result = runMigrations(db);
      expect(result.to).toBeGreaterThanOrEqual(10);
      expect(columns(db, 'project_categories')).toContain('position');
      expect(result.repairs).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('upgrades a v9 store with three categories: the visible order is unchanged (FR-084)', () => {
    const db = openV9Db();
    try {
      const expected = seedThreeCategories(db);
      expect(v9VisibleOrder(db, 'alice')).toEqual(expected);

      const result = runMigrations(db);
      expect(result.from).toBe(9);
      expect(result.to).toBeGreaterThanOrEqual(10);

      // Through the store's own read, which after v10 orders by position.
      expect(new ProjectCategoryRepository(db).list('alice').map((c) => c.id)).toEqual(expected);
      // And the positions really carry that order, strictly increasing — not all left at the column
      // default, where only the id tie-break would decide (and would say c-a, c-m, c-z).
      const positions = nonDefaultPositions(db, 'alice', expected);
      expect(positions).toHaveLength(3);
      for (let i = 1; i < positions.length; i += 1) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]!);
      }
    } finally {
      db.close();
    }
  });

  it('seeds each owner from that owner\'s own order', () => {
    const db = openV9Db();
    try {
      const alice = seedThreeCategories(db, 'alice');
      seedV9Category(db, 'bob', 'b-late', '2026-05-01T00:00:00.000Z');
      seedV9Category(db, 'bob', 'b-early', '2026-04-01T00:00:00.000Z');
      seedV9Category(db, 'bob', 'd-bob', '2026-01-01T00:00:00.000Z', true);

      runMigrations(db);

      const repo = new ProjectCategoryRepository(db);
      expect(repo.list('alice').map((c) => c.id)).toEqual(alice);
      expect(repo.list('bob').map((c) => c.id)).toEqual(['d-bob', 'b-early', 'b-late']);
    } finally {
      db.close();
    }
  });

  it('is idempotent: running v10 twice leaves every row identical (constitution, migrations)', () => {
    const db = openV9Db();
    try {
      seedThreeCategories(db);
      runMigrations(db);
      const first = snapshot(db);

      expect(() => db.transaction(() => applyMigrationV10(db))()).not.toThrow();
      expect(() => db.transaction(() => applyMigrationV10(db))()).not.toThrow();
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

  it('never re-seeds over an order the user has set since: a re-run keeps a reordered list', () => {
    const db = openV9Db();
    try {
      seedThreeCategories(db);
      runMigrations(db);
      // The user reverses the three (the shape `reorder` writes: 0..n-1 over the non-default rows).
      const setPosition = db.prepare(
        `UPDATE project_categories SET position = ? WHERE owner_user = 'alice' AND id = ?`,
      );
      setPosition.run(0, 'c-m');
      setPosition.run(1, 'c-a');
      setPosition.run(2, 'c-z');
      const reordered = snapshot(db);

      db.transaction(() => applyMigrationV10(db))();

      expect(snapshot(db)).toEqual(reordered);
      expect(new ProjectCategoryRepository(db).list('alice').map((c) => c.id)).toEqual([
        'd-alice',
        'c-m',
        'c-a',
        'c-z',
      ]);
    } finally {
      db.close();
    }
  });

  it('completes an interrupted run: the column exists, nothing is seeded, the version is still 9', () => {
    const path = freshDbPath();
    let db = openV9Db(path);
    const expected = seedThreeCategories(db);
    // The half-state: the ALTER landed, the seeding never ran, the version never stamped.
    db.exec('ALTER TABLE project_categories ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
    db.close();

    db = openDatabase({ databasePath: path });
    try {
      const result = runMigrations(db);
      expect(result.from).toBe(9);
      expect(result.applied).toBe(true);
      expect(new ProjectCategoryRepository(db).list('alice').map((c) => c.id)).toEqual(expected);
      const positions = nonDefaultPositions(db, 'alice', expected);
      expect(new Set(positions).size).toBe(3);
    } finally {
      db.close();
    }
  });

  it('heals a store stamped 10 with project_categories.position missing, through reconcileSchema (FR-058)', () => {
    const path = freshDbPath();
    let db = openV9Db(path);
    const expected = seedThreeCategories(db);
    // An intermediate build stamped 10 without ever adding the column.
    db.pragma(`user_version = ${MIGRATION_V10_VERSION}`);
    expect(columns(db, 'project_categories')).not.toContain('position');

    // Directly: the guard alone knows the column and adds it.
    const repairs = reconcileSchema(db);
    expect(repairs).toContainEqual({ table: 'project_categories', column: 'position' });
    expect(columns(db, 'project_categories')).toContain('position');
    // The store's read now works rather than throwing "no such column: position", and still lists
    // every category with the default first.
    const listed = new ProjectCategoryRepository(db).list('alice').map((c) => c.id);
    expect(listed[0]).toBe('d-alice');
    expect([...listed].sort()).toEqual([...expected].sort());
    // Healing is idempotent: a second pass finds nothing to do.
    expect(reconcileSchema(db)).toEqual([]);
    db.close();

    // Through the runner as well, on a second drifted store.
    const path2 = freshDbPath();
    db = openV9Db(path2);
    seedThreeCategories(db);
    db.pragma(`user_version = ${MIGRATION_V10_VERSION}`);
    db.close();
    db = openDatabase({ databasePath: path2 });
    try {
      const result = runMigrations(db);
      expect(result.applied).toBe(false);
      expect(result.repairs).toContainEqual({ table: 'project_categories', column: 'position' });
      expect(() =>
        db
          .prepare(`UPDATE project_categories SET position = 5 WHERE owner_user = 'alice' AND id = 'c-a'`)
          .run(),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });
});
