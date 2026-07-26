import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, LATEST_VERSION } from '@throng/persistence';

/**
 * REWRITTEN by 016 — the SECOND version pin.
 *
 * The spec named ONE guard to retire (`no-editor-migration`). There were two. This one was written
 * for feature 007 and pinned the same v6 for its own reasons, so it would have failed identically
 * and for a reason nobody had written down. Finding it was the point of looking; deleting it to
 * make the migration pass would have thrown away the guard AND the record of why it existed.
 *
 * The pin is now a MOVING one: the schema is at whatever `LATEST_VERSION` says, and a fresh store
 * must actually reach it. That still catches the thing both pins were really for — a migration
 * added without the version being bumped, or bumped without the migration — while no longer
 * asserting a number that a later feature is entitled to change.
 */
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

describe('the schema version and the migration chain agree', () => {
  it('LATEST_VERSION is 8 — 024 US3 adds the fileop_undo migration', () => {
    expect(LATEST_VERSION).toBe(8);
  });

  it('a freshly migrated store actually REACHES LATEST_VERSION', () => {
    // A migration added without a version bump, or a bump without a migration, fails here.
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      const result = runMigrations(db);
      expect(result.to).toBe(LATEST_VERSION);
      expect(Number(db.pragma('user_version', { simple: true }))).toBe(LATEST_VERSION);
    } finally {
      db.close();
    }
  });
});
