import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AttentionLedgerEntry } from '@throng/core';
import { AttentionLedgerRepository, openDatabase, reconcileSchema, runMigrations, LATEST_VERSION } from '@throng/persistence';
import type { ThrongDatabase } from '@throng/persistence';

/*
 * #692, 057 FR-091a — migration v15: the daemon's attention ledger on disk. A v14 store gains the table; a re-run is a
 * no-op; a store stamped 15 without the table (an intermediate build) regains it through the schema guard; and the
 * repository keeps the ledger whole and in order.
 *
 * Layer: integration — a real SQLite file.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): ThrongDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'throng-v15-'));
  dirs.push(dir);
  return openDatabase({ databasePath: join(dir, 'throng.db') });
}

const hasTable = (db: ThrongDatabase): boolean =>
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='attention_ledger'").get();

const entry = (panelId: string, raisedAt: number): AttentionLedgerEntry => ({
  panelId,
  projectId: 'proj',
  kind: 'attention',
  reason: { signal: 'bell', detail: null },
  raisedAt,
  panelTitle: `panel ${panelId}`,
  projectName: 'Project',
  tabTitle: 'Tab 1',
  whileDetached: false,
});

describe('migration v15', () => {
  it('upgrades a v14 store, and a re-run changes nothing', () => {
    const db = freshDb();
    try {
      runMigrations(db);
      db.exec('DROP TABLE attention_ledger');
      db.pragma('user_version = 14');
      const result = runMigrations(db);
      expect([result.from, result.to, LATEST_VERSION]).toEqual([14, 15, 15]);
      expect(hasTable(db)).toBe(true);
      new AttentionLedgerRepository(db).save([entry('a', 1)]);
      const again = runMigrations(db);
      expect([again.from, again.to]).toEqual([15, 15]);
      expect(new AttentionLedgerRepository(db).load().map((e) => e.panelId)).toEqual(['a']);
    } finally {
      db.close();
    }
  });

  it('the schema guard recreates the table on a store stamped 15 without it', () => {
    const db = freshDb();
    try {
      runMigrations(db);
      db.exec('DROP TABLE attention_ledger');
      reconcileSchema(db);
      expect(hasTable(db)).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('AttentionLedgerRepository', () => {
  it('replaces the stored ledger whole and gives it back in its own order', () => {
    const db = freshDb();
    try {
      runMigrations(db);
      const repo = new AttentionLedgerRepository(db);
      expect(repo.load()).toEqual([]);
      repo.save([entry('b', 2), entry('a', 1), entry('c', 3)]);
      expect(repo.load()).toEqual([entry('b', 2), entry('a', 1), entry('c', 3)]);
      repo.save([entry('c', 3)]);
      expect(repo.load()).toEqual([entry('c', 3)]);
    } finally {
      db.close();
    }
  });
});
