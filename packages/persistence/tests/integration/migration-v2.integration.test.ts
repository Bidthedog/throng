import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, LATEST_VERSION } from '@throng/persistence';
import type { ThrongDatabase } from '@throng/persistence';

const tempDirs: string[] = [];

function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-migv2-'));
  tempDirs.push(dir);
  return join(dir, 'throng.db');
}

function tableNames(db: ThrongDatabase): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => (r as { name: string }).name)
    .sort();
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('migration v2 (projects + workspace + sub-workspaces)', () => {
  it('applies the v2 domain tables when migrating to the latest version', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      const result = runMigrations(db);
      expect(result.applied).toBe(true);
      expect(result.to).toBe(LATEST_VERSION);
      expect(LATEST_VERSION).toBeGreaterThanOrEqual(2);
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
    } finally {
      db.close();
    }
  });

  it('creates the projects, workspace_layout and sub_workspaces tables', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      const tables = tableNames(db);
      expect(tables).toContain('projects');
      expect(tables).toContain('workspace_layout');
      expect(tables).toContain('sub_workspaces');
    } finally {
      db.close();
    }
  });

  it('gives projects the owner_user-scoped columns the domain needs', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      const cols = db
        .prepare('PRAGMA table_info(projects)')
        .all()
        .map((r) => (r as { name: string }).name);
      for (const col of [
        'id',
        'owner_user',
        'name',
        'colour',
        'root_folder',
        'is_active',
        'created_at',
        'updated_at',
      ]) {
        expect(cols).toContain(col);
      }
    } finally {
      db.close();
    }
  });

  it('cascades workspace_layout deletion when its project is removed (FK on)', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      db.prepare(
        `INSERT INTO projects (id, owner_user, name, colour, root_folder, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('p1', 'alice', 'P1', '#abcdef', 'C:/p1', 1, 'now', 'now');
      db.prepare(
        `INSERT INTO workspace_layout (owner_user, project_id, schema_version, layout_json, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('alice', 'p1', 1, '{}', 'now');

      db.prepare('DELETE FROM projects WHERE id = ?').run('p1');

      const remaining = db
        .prepare('SELECT COUNT(*) AS n FROM workspace_layout WHERE project_id = ?')
        .get('p1') as { n: number };
      expect(remaining.n).toBe(0);
    } finally {
      db.close();
    }
  });

  it('is idempotent: a second run against a v2 store changes nothing', () => {
    const databasePath = freshDbPath();
    let db = openDatabase({ databasePath });
    runMigrations(db);
    db.close();

    db = openDatabase({ databasePath });
    try {
      const result = runMigrations(db);
      expect(result.applied).toBe(false);
      expect(result.from).toBe(LATEST_VERSION);
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
    } finally {
      db.close();
    }
  });
});
