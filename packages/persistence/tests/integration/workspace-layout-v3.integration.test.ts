import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDefaultLayout,
  createProject,
  collectPanels,
  panelZoomLevel,
  type WorkspaceLayout,
} from '@throng/core';
import { openDatabase, runMigrations, WorkspaceRepository, ProjectRepository } from '@throng/persistence';

// 012 (per-instance revision): per-PANEL zoom rides the layout blob (`Panel.zoom`);
// the in-JSON schema goes 2 → 3 (version bump only — zoom is inherited-by-default,
// so no zoom content is migrated). NO SQLite DDL — `user_version` is unchanged.

const tempDirs: string[] = [];
function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-layoutv3-'));
  tempDirs.push(dir);
  return join(dir, 'throng.db');
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function insertLayout(db: ReturnType<typeof openDatabase>, projectId: string, doc: unknown, version: number): void {
  db.prepare(
    `INSERT INTO workspace_layout (owner_user, project_id, schema_version, layout_json, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('u', projectId, version, JSON.stringify(doc), 't');
}

function seedProject(db: ReturnType<typeof openDatabase>, id: string): void {
  new ProjectRepository(db).insert(
    createProject(
      { name: 'P', colour: '#6aa3ff', rootFolder: `C:/${id}` },
      { id, ownerUser: 'u', now: new Date().toISOString(), isActive: false },
    ),
  );
}

/** A one-panel layout whose sole panel carries the given zoom level. */
function layoutWithPanelZoom(projectId: string, zoom: number): WorkspaceLayout {
  const layout = createDefaultLayout(projectId, { tab: 't1', panel: 'pan1' });
  const panel = collectPanels(layout.tabs[0].root)[0];
  panel.zoom = zoom;
  return layout;
}

describe('workspace layout v2 → v3 migration + per-panel zoom round-trip (012)', () => {
  it('forward-migrates a v2 layout to v3 (version bump only; no zoom field added)', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      seedProject(db, 'p1');
      const base = createDefaultLayout('p1', { tab: 't1', panel: 'pan1' });
      const v2 = { ...base, schemaVersion: 2 };
      insertLayout(db, 'p1', v2, 2);

      const result = new WorkspaceRepository(db).load('u', 'p1');
      expect(result.restored).toBe(true);
      expect(result.layout.schemaVersion).toBe(3);
      expect(collectPanels(result.layout.tabs[0].root)[0].zoom).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('round-trips a panel zoom level through save and load', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      seedProject(db, 'p2');
      const repo = new WorkspaceRepository(db);
      repo.save('u', 'p2', layoutWithPanelZoom('p2', 3));
      const result = repo.load('u', 'p2');
      expect(panelZoomLevel(collectPanels(result.layout.tabs[0].root)[0])).toBe(3);
      expect(result.layout.schemaVersion).toBe(3);
    } finally {
      db.close();
    }
  });

  it('clamps an out-of-range hand-edited panel zoom on read (panelZoomLevel)', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      seedProject(db, 'p3');
      const doc = { ...layoutWithPanelZoom('p3', 99), schemaVersion: 3 };
      insertLayout(db, 'p3', doc, 3);

      const result = new WorkspaceRepository(db).load('u', 'p3');
      // The raw stored value survives the round-trip; the read clamps it into range.
      expect(panelZoomLevel(collectPanels(result.layout.tabs[0].root)[0])).toBe(5);
    } finally {
      db.close();
    }
  });

  it('re-saving a loaded v3 layout preserves the panel zoom (idempotent, v3.5.0)', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      seedProject(db, 'p4');
      const repo = new WorkspaceRepository(db);
      repo.save('u', 'p4', layoutWithPanelZoom('p4', 2));
      const once = repo.load('u', 'p4').layout;
      repo.save('u', 'p4', once);
      const twice = repo.load('u', 'p4').layout;
      expect(panelZoomLevel(collectPanels(twice.tabs[0].root)[0])).toBe(2);
      expect(twice.schemaVersion).toBe(3);
    } finally {
      db.close();
    }
  });

  it('leaves the SQLite user_version unchanged (no DDL for this feature)', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      const before = db.pragma('user_version', { simple: true });
      seedProject(db, 'p5');
      const repo = new WorkspaceRepository(db);
      repo.save('u', 'p5', layoutWithPanelZoom('p5', 1));
      repo.load('u', 'p5');
      const after = db.pragma('user_version', { simple: true });
      expect(after).toBe(before);
    } finally {
      db.close();
    }
  });
});
