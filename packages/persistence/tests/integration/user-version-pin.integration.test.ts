import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, LATEST_VERSION } from '@throng/persistence';

// Feature 007 (preferences editor) is entirely file-based config + UI chrome; it
// adds NO SQLite migration. This guard pins the schema at user_version 6 so that
// any accidental v7 migration (or a bump to LATEST_VERSION) fails loudly here.
// See specs/007-preferences-editor/plan.md (Storage: "user_version stays 6").

const PINNED_VERSION = 6;
const tempDirs: string[] = [];

function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-verpin-'));
  tempDirs.push(dir);
  return join(dir, 'throng.db');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('schema version pin (feature 007 adds no migration)', () => {
  it('LATEST_VERSION is 6', () => {
    expect(LATEST_VERSION).toBe(PINNED_VERSION);
  });

  it('a freshly migrated store reports user_version 6', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      const result = runMigrations(db);
      expect(result.to).toBe(PINNED_VERSION);
      expect(db.pragma('user_version', { simple: true })).toBe(PINNED_VERSION);
    } finally {
      db.close();
    }
  });
});
