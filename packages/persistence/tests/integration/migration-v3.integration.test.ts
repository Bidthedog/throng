import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, LATEST_VERSION } from '@throng/persistence';
import type { ThrongDatabase } from '@throng/persistence';

const tempDirs: string[] = [];
function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-migv3-'));
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

describe('migration v3 (project ordering)', () => {
  it('adds a projects.position column when migrating to the latest version', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
      expect(columns(db, 'projects')).toContain('position');
    } finally {
      db.close();
    }
  });

  it('is idempotent (re-run is a no-op)', () => {
    const path = freshDbPath();
    let db = openDatabase({ databasePath: path });
    runMigrations(db);
    db.close();
    db = openDatabase({ databasePath: path });
    try {
      const result = runMigrations(db);
      expect(result.applied).toBe(false);
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
    } finally {
      db.close();
    }
  });
});
