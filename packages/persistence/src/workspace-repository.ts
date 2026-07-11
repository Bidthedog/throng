import { randomUUID } from 'node:crypto';
import {
  collectPanels,
  createDefaultLayout,
  isMainLayoutValid,
  LAYOUT_SCHEMA_VERSION,
  type IWorkspaceStore,
  type SubWorkspace,
  type WorkspaceLayout,
  type WorkspaceLoadResult,
} from '@throng/core';
import type { ThrongDatabase } from './database.js';
import {
  parseSubWorkspaceContent,
  serializeSubWorkspaceContent,
} from './subworkspace-content.js';

interface LayoutRow {
  layout_json: string;
}

interface SubWorkspaceRow {
  id: string;
  owner_user: string;
  name: string;
  colour: string;
  bounds_json: string;
  content_json: string;
  updated_at: string;
}

/**
 * `IWorkspaceStore` over better-sqlite3 (research D4/D5): the per-project layout
 * is stored whole as a JSON document. On load, a missing or unparseable/invalid
 * document falls back to the default empty workspace with `restored: false`
 * (FR-029). Sub-workspace records are stored as JSON documents too (US4).
 */
export class WorkspaceRepository implements IWorkspaceStore {
  constructor(private readonly db: ThrongDatabase) {}

  load(ownerUser: string, projectId: string): WorkspaceLoadResult {
    const row = this.db
      .prepare(`SELECT layout_json FROM workspace_layout WHERE owner_user = ? AND project_id = ?`)
      .get(ownerUser, projectId) as LayoutRow | undefined;

    if (row) {
      const parsed = this.tryParseLayout(row.layout_json, projectId);
      if (parsed) return { layout: parsed, restored: true };
      // A row exists but could not be parsed/validated → corrupt (FR-029, SC-011).
      return { layout: this.defaultLayout(projectId), restored: false, reason: 'corrupt' };
    }
    return { layout: this.defaultLayout(projectId), restored: false, reason: 'missing' };
  }

  save(ownerUser: string, projectId: string, layout: WorkspaceLayout): void {
    this.db
      .prepare(
        `INSERT INTO workspace_layout (owner_user, project_id, schema_version, layout_json, updated_at)
         VALUES (@owner_user, @project_id, @schema_version, @layout_json, @updated_at)
         ON CONFLICT(owner_user, project_id) DO UPDATE SET
           schema_version = excluded.schema_version,
           layout_json    = excluded.layout_json,
           updated_at     = excluded.updated_at`,
      )
      .run({
        owner_user: ownerUser,
        project_id: projectId,
        schema_version: layout.schemaVersion,
        layout_json: JSON.stringify(layout),
        updated_at: new Date().toISOString(),
      });
  }

  loadSubWorkspaces(ownerUser: string): SubWorkspace[] {
    const rows = this.db
      .prepare(`SELECT * FROM sub_workspaces WHERE owner_user = ? ORDER BY position, updated_at`)
      .all(ownerUser) as SubWorkspaceRow[];
    const result: SubWorkspace[] = [];
    for (const row of rows) {
      // A single corrupt row must not break the whole load path (FR-029
      // robustness, mirroring the layout fallback): skip unparseable records.
      try {
        const content = parseSubWorkspaceContent(row.content_json);
        result.push({
          id: row.id,
          ownerUser: row.owner_user,
          name: row.name,
          colour: row.colour,
          bounds: JSON.parse(row.bounds_json) as SubWorkspace['bounds'],
          tabs: content.tabs,
          activeTabId: content.activeTabId,
        });
      } catch {
        /* skip corrupt sub-workspace row */
      }
    }
    return result;
  }

  persistSubWorkspaces(ownerUser: string, subWorkspaces: SubWorkspace[]): void {
    const replace = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM sub_workspaces WHERE owner_user = ?`).run(ownerUser);
      const insert = this.db.prepare(
        `INSERT INTO sub_workspaces (id, owner_user, name, colour, bounds_json, content_json, updated_at, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const now = new Date().toISOString();
      // Position by array order so the persisted/reordered order round-trips
      // (the array arrives in list order; detach appends new entries last).
      subWorkspaces.forEach((sub, index) => {
        insert.run(
          sub.id,
          ownerUser,
          sub.name,
          sub.colour,
          JSON.stringify(sub.bounds),
          serializeSubWorkspaceContent(sub),
          now,
          index,
        );
      });
    });
    replace();
  }

  private tryParseLayout(json: string, projectId: string): WorkspaceLayout | null {
    try {
      const layout = this.migrateLayout(JSON.parse(json) as WorkspaceLayout);
      // A layout stored for this project must reference it and satisfy the
      // invariants; otherwise treat it as corrupt and fall back (FR-029).
      if (layout.projectId === projectId && isMainLayoutValid(layout)) {
        return layout;
      }
    } catch {
      // fall through to fallback
    }
    return null;
  }

  /**
   * Migrate a stored layout document up to the current schema. v1 lacked
   * `Tab.activePanelId`; v2 populates it (default = the tab's first panel). v3 (012)
   * introduces per-panel `Panel.zoom` — absent means inherited (level 0), so v3
   * needs no zoom-content migration; the version bump just records the new shape.
   * Out-of-range hand-edited `Panel.zoom` is clamped on read (`panelZoomLevel`), not
   * here. Each step is additive and version-guarded, so re-running is idempotent.
   */
  private migrateLayout(layout: WorkspaceLayout): WorkspaceLayout {
    if ((layout.schemaVersion ?? 1) >= LAYOUT_SCHEMA_VERSION) return layout;
    // v1 → v2: default activePanelId (idempotent — guarded per tab).
    const tabs = layout.tabs.map((tab) =>
      tab.activePanelId ? tab : { ...tab, activePanelId: collectPanels(tab.root)[0]?.id },
    );
    // v2 → v3: per-panel zoom is inherited-by-default; only the version bumps.
    return { ...layout, schemaVersion: LAYOUT_SCHEMA_VERSION, tabs };
  }

  private defaultLayout(projectId: string): WorkspaceLayout {
    return createDefaultLayout(projectId, { tab: randomUUID(), panel: randomUUID() });
  }
}
