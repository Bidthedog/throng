import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AttentionFlagRepository,
  openDatabase,
  reconcileSchema,
  runMigrations,
  LATEST_VERSION,
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
import { applyMigrationV10 } from '../../src/migrations/v10-category-position.js';
import { applyMigrationV11 } from '../../src/migrations/v11-attention-flags.js';

/**
 * Migration v11 — the manual attention flag table (057 round 12, FR-125 / FR-128;
 * contracts/daemon-attention.md). Constitution: a migration is safe to re-run and safe against an
 * already-migrated store.
 *
 * Layer: integration — an upgrade against a real SQLite schema is the thing under test; no fake
 * enforces DDL idempotence or the schema guard's heal.
 *
 * The v10 store is built by applying v2–v10 directly, so this file keeps describing a v10 store
 * after `LATEST_VERSION` moves on.
 */
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-v11-'));
  tempDirs.push(dir);
  return join(dir, 'throng.db');
}

function openV10Db(): ThrongDatabase {
  const db = openDatabase({ databasePath: freshDbPath() });
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
  })();
  db.pragma('user_version = 10');
  return db;
}

function tableExists(db: ThrongDatabase): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='attention_flag'").get();
}

const entry = (panelId: string, projectId = 'p1') => ({
  panelId,
  projectId,
  panelTitle: `panel ${panelId}`,
  tabTitle: 'tab',
  projectName: 'Project',
  raisedAt: 1000,
});

describe('migration v11', () => {
  it('upgrades a v10 store: creates attention_flag and stamps the latest version', () => {
    const db = openV10Db();
    try {
      expect(tableExists(db)).toBe(false);
      const result = runMigrations(db);
      expect(result.from).toBe(10);
      expect(result.to).toBe(LATEST_VERSION);
      expect(LATEST_VERSION).toBeGreaterThanOrEqual(11);
      expect(tableExists(db)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('is idempotent — re-running v11 keeps existing flags', () => {
    const db = openV10Db();
    try {
      runMigrations(db);
      const repo = new AttentionFlagRepository(db);
      repo.set(entry('a'));
      expect(() => applyMigrationV11(db)).not.toThrow();
      expect(() => runMigrations(db)).not.toThrow();
      expect(repo.list()).toEqual([entry('a')]);
    } finally {
      db.close();
    }
  });

  it('the schema guard recreates the table on a store stamped past v11 without it', () => {
    const db = openV10Db();
    try {
      runMigrations(db);
      db.exec('DROP TABLE attention_flag');
      const repairs = reconcileSchema(db);
      expect(repairs.some((r) => r.table === 'attention_flag')).toBe(true);
      expect(tableExists(db)).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('AttentionFlagRepository', () => {
  function open(): { db: ThrongDatabase; repo: AttentionFlagRepository } {
    const db = openDatabase({ databasePath: freshDbPath() });
    runMigrations(db);
    return { db, repo: new AttentionFlagRepository(db) };
  }

  it('lists nothing on an empty store', () => {
    const { db, repo } = open();
    try {
      expect(repo.list()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('set upserts by panelId', () => {
    const { db, repo } = open();
    try {
      repo.set(entry('a'));
      repo.set({ ...entry('a'), panelTitle: 'renamed', raisedAt: 2000 });
      const flags = repo.list();
      expect(flags).toHaveLength(1);
      expect(flags[0]).toMatchObject({ panelId: 'a', panelTitle: 'renamed', raisedAt: 2000 });
    } finally {
      db.close();
    }
  });

  it('clear deletes one row and a missing row is not an error', () => {
    const { db, repo } = open();
    try {
      repo.set(entry('a'));
      repo.set(entry('b'));
      repo.clear('a');
      expect(() => repo.clear('nope')).not.toThrow();
      expect(repo.list().map((f) => f.panelId)).toEqual(['b']);
    } finally {
      db.close();
    }
  });

  it("clearProject deletes only that project's rows", () => {
    const { db, repo } = open();
    try {
      repo.set(entry('a', 'p1'));
      repo.set(entry('b', 'p2'));
      repo.set(entry('c', 'p1'));
      repo.clearProject('p1');
      expect(repo.list().map((f) => f.panelId)).toEqual(['b']);
    } finally {
      db.close();
    }
  });
});
