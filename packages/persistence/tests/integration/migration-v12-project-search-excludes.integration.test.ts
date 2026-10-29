import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject } from '@throng/core';
import {
  LATEST_VERSION,
  ProjectRepository,
  openDatabase,
  reconcileSchema,
  runMigrations,
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

/**
 * Migration v12 — a project's own Find in Files exclusions (060 #532, FR-040, research R21).
 * Constitution: a migration is safe to re-run and safe against an already-migrated store.
 *
 * Layer: integration — an upgrade against a real SQLite schema is the thing under test; no fake
 * enforces DDL idempotence or the schema guard's heal.
 */
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function openV11Db(): ThrongDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'throng-v12-'));
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
  })();
  db.pragma('user_version = 11');
  return db;
}

function hasColumn(db: ThrongDatabase): boolean {
  const cols = db.prepare('PRAGMA table_info(projects)').all() as { name: string }[];
  return cols.some((c) => c.name === 'search_exclude_globs');
}

const project = (id: string) =>
  createProject(
    { name: id, colour: '#336699', rootFolder: `D:/${id}` },
    { id, ownerUser: 'alice', now: '2026-10-29T00:00:00.000Z' },
  );

describe('migration v12', () => {
  it('upgrades a v11 store: adds the column and stamps the latest version', () => {
    const db = openV11Db();
    try {
      expect(hasColumn(db)).toBe(false);
      const result = runMigrations(db);
      expect(result.from).toBe(11);
      expect(result.to).toBe(LATEST_VERSION);
      expect(hasColumn(db)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('reads an existing project back with an empty list, and round-trips a set one', () => {
    const db = openV11Db();
    try {
      runMigrations(db);
      const repo = new ProjectRepository(db);
      repo.insert(project('p1'));
      expect(repo.list('alice')[0]?.searchExcludeGlobs).toEqual([]);
      repo.update({ ...repo.list('alice')[0]!, searchExcludeGlobs: ['**/gen', '**/fixtures'] });
      const back = repo.list('alice')[0]!;
      expect(back.searchExcludeGlobs).toEqual(['**/gen', '**/fixtures']);
      expect(back.hiddenPaths).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('is idempotent — re-running v12 keeps what a project holds', () => {
    const db = openV11Db();
    try {
      runMigrations(db);
      const repo = new ProjectRepository(db);
      repo.insert({ ...project('p1'), searchExcludeGlobs: ['**/gen'] });
      expect(() => applyMigrationV12(db)).not.toThrow();
      expect(() => runMigrations(db)).not.toThrow();
      expect(repo.list('alice')[0]?.searchExcludeGlobs).toEqual(['**/gen']);
    } finally {
      db.close();
    }
  });

  it('the schema guard re-adds the column on a store stamped past v12 without it', () => {
    const db = openV11Db();
    try {
      runMigrations(db);
      db.exec('ALTER TABLE projects DROP COLUMN search_exclude_globs');
      const repairs = reconcileSchema(db);
      expect(repairs.some((r) => r.table === 'projects')).toBe(true);
      expect(hasColumn(db)).toBe(true);
    } finally {
      db.close();
    }
  });
});
