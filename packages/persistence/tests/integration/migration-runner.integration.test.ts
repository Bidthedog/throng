import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, BASELINE_VERSION, LATEST_VERSION } from '@throng/persistence';

const tempDirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-persist-'));
  tempDirs.push(dir);
  return dir;
}

function freshDbPath(): string {
  return join(freshDir(), 'throng.db');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('persistence migration runner', () => {
  it('creates the database file and migrates a fresh directory to the latest version', () => {
    const databasePath = freshDbPath();
    const db = openDatabase({ databasePath });
    try {
      const result = runMigrations(db);
      expect(result.applied).toBe(true);
      expect(result.to).toBe(LATEST_VERSION);
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
    } finally {
      db.close();
    }
    expect(existsSync(databasePath)).toBe(true);
  });

  it('is a no-op when re-run against an already-migrated store', () => {
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

  it('supports a trivial read/write after initialisation (smoke)', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      db.prepare('INSERT OR REPLACE INTO _meta(key, value) VALUES (?, ?)').run('smoke', 'hello');
      const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get('smoke') as
        | { value: string }
        | undefined;
      expect(row?.value).toBe('hello');
    } finally {
      db.close();
    }
  });

  it('retains the baseline _meta marker alongside the v2 domain tables', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map((r) => (r as { name: string }).name);
      expect(tables).toContain('_meta');
      // Domain tables (migration v2) coexist with the baseline marker.
      expect(tables).toContain('projects');
      const baseline = db.prepare('SELECT value FROM _meta WHERE key = ?').get('baseline_version') as
        | { value: string }
        | undefined;
      expect(baseline?.value).toBe(String(BASELINE_VERSION));
    } finally {
      db.close();
    }
  });

  it('surfaces an open failure on an unwritable/invalid path', () => {
    // Opening an existing directory as a database file fails deterministically.
    expect(() => openDatabase({ databasePath: freshDir() })).toThrow();
  });
});
