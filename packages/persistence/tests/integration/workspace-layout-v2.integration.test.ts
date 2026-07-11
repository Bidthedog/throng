import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPanels, createDefaultLayout, createProject } from '@throng/core';
import { openDatabase, runMigrations, WorkspaceRepository, ProjectRepository } from '@throng/persistence';

const tempDirs: string[] = [];
function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-layoutv2-'));
  tempDirs.push(dir);
  return join(dir, 'throng.db');
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('workspace layout v1 → v2 migration on load (T028)', () => {
  it('populates Tab.activePanelId (default = first panel) for a v1 document', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      // The layout FK requires the project to exist.
      new ProjectRepository(db).insert(
        createProject(
          { name: 'P', colour: '#6aa3ff', rootFolder: 'C:/p' },
          { id: 'p1', ownerUser: 'u', now: new Date().toISOString(), isActive: false },
        ),
      );

      // Build a v1 layout: schema 1, tabs WITHOUT activePanelId.
      const v2 = createDefaultLayout('p1', { tab: 't1', panel: 'pan1' });
      const firstPanelId = collectPanels(v2.tabs[0].root)[0].id;
      const v1 = {
        ...v2,
        schemaVersion: 1,
        tabs: v2.tabs.map((t) => {
          const copy = { ...t } as Record<string, unknown>;
          delete copy.activePanelId;
          return copy;
        }),
      };
      db.prepare(
        `INSERT INTO workspace_layout (owner_user, project_id, schema_version, layout_json, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('u', 'p1', 1, JSON.stringify(v1), 't');

      const result = new WorkspaceRepository(db).load('u', 'p1');
      expect(result.restored).toBe(true);
      // v1 now migrates all the way to the current schema (v3), populating the
      // activePanelId (v2 step). v3 adds per-panel zoom, which is inherited-by-default
      // — so there is no layout-level zoom field to add.
      expect(result.layout.schemaVersion).toBe(3);
      expect(result.layout.tabs[0].activePanelId).toBe(firstPanelId);
      expect((result.layout as { zoom?: unknown }).zoom).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
