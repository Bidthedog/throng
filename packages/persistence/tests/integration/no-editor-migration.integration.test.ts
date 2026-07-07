import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, LATEST_VERSION } from '@throng/persistence';

// 006 (Editor Panel Type) adds NO SQLite migration (research D2/D14): an Editor
// Panel's kind + config ride the existing workspace_layout.layout_json blob, and
// unsaved content lives in recovery temp files — not a durable table. This guards
// that the schema version stays 6 (no editor migration crept in).

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-noedmig-'));
  tempDirs.push(dir);
  return join(dir, 'throng.db');
}

describe('006 adds no editor migration', () => {
  it('the latest schema version is 6 (unchanged by the editor feature)', () => {
    expect(LATEST_VERSION).toBe(6);
  });

  it('a freshly migrated store reports user_version 6', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      const result = runMigrations(db);
      expect(result.to).toBe(6);
      expect(Number(db.pragma('user_version', { simple: true }))).toBe(6);
    } finally {
      db.close();
    }
  });

  it('there is no editors table (editor state rides the layout blob)', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => (r as { name: string }).name);
      expect(tables).not.toContain('editors');
    } finally {
      db.close();
    }
  });
});
