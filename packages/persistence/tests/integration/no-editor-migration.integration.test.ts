import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '@throng/persistence';
import { applyMigrationV2 } from '../../src/migrations/v2-projects-workspace.js';
import { applyMigrationV3 } from '../../src/migrations/v3-project-order.js';
import { applyMigrationV4 } from '../../src/migrations/v4-subworkspace-identity.js';
import { applyMigrationV5 } from '../../src/migrations/v5-subworkspace-order.js';
import { applyMigrationV6 } from '../../src/migrations/v6-project-hidden.js';
import { applyMigrationV7, MIGRATION_V7_VERSION } from '../../src/migrations/v7-document-state.js';

/**
 * REWRITTEN by 016 — and the history is the point.
 *
 * This file used to pin the schema at v6, guarding feature 006's decision that an editor needs NO
 * table: a panel's kind and config ride the `workspace_layout` blob, and unsaved content lives in
 * recovery temp files.
 *
 * That decision was right for what 006 stored, and it does not survive what 016 stores. A language
 * override is not PANEL state, it is DOCUMENT state: it must be found by a panel opening the file
 * LATER — in another window, another session, or a sub-workspace — which a blob keyed by panel
 * cannot answer. Riding the layout blob would leave it with no key, no foreign key, no pruning,
 * and no protection from a layout rebuild.
 *
 * So the guard is REVERSED — deliberately, and in the open — rather than deleted quietly to make a
 * migration pass. What it asserts now is the new intent.
 */
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-docstate-'));
  tempDirs.push(dir);
  return join(dir, 'throng.db');
}

describe('016 adds per-document state at v7 (reversing 006’s "no editor migration")', () => {
  // The exact latest version is pinned once, in user-version-pin. What this file owns is WHERE
  // document_state arrives: at v7, and not before — a claim no later migration has to edit.
  it('document_state arrives at exactly v7: absent after v2–v6, present after v7', () => {
    expect(MIGRATION_V7_VERSION).toBe(7);
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      const tables = (): string[] =>
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((r) => (r as { name: string }).name);
      db.transaction(() => {
        for (const step of [applyMigrationV2, applyMigrationV3, applyMigrationV4, applyMigrationV5, applyMigrationV6]) {
          step(db);
        }
      })();
      expect(tables()).not.toContain('document_state');
      db.transaction(() => applyMigrationV7(db))();
      expect(tables()).toContain('document_state');
    } finally {
      db.close();
    }
  });

  it('creates `document_state` — and still no `editors` table, because a DOCUMENT is not a PANEL', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => (r as { name: string }).name);
      expect(tables).toContain('document_state');
      // The distinction 006 drew is still correct and still enforced: PANEL state rides the layout
      // blob and has no table. What changed is that this feature has state that is not panel state.
      expect(tables).not.toContain('editors');
    } finally {
      db.close();
    }
  });
});
