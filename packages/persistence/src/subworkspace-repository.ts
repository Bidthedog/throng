import {
  countPanels,
  type ISubWorkspaceStore,
  type SubWorkspace,
  type SubWorkspaceMeta,
} from '@throng/core';
import type { ThrongDatabase } from './database.js';
import { parseSubWorkspaceContent } from './subworkspace-content.js';

interface FullRow {
  id: string;
  owner_user: string;
  name: string;
  colour: string;
  bounds_json: string;
  content_json: string;
}

/** Tab + Panel counts from a sub-workspace's stored content JSON (best-effort). */
function countsOf(contentJson: string): { tabCount: number; panelCount: number } {
  try {
    const { tabs } = parseSubWorkspaceContent(contentJson);
    return {
      tabCount: tabs.length,
      panelCount: tabs.reduce((n, tab) => n + countPanels(tab.root), 0),
    };
  } catch {
    return { tabCount: 0, panelCount: 0 };
  }
}

/**
 * `ISubWorkspaceStore` over better-sqlite3 (003 / research D5). Reads/writes the
 * first-class sub-workspace identity (name/colour, migration v4) and its
 * tabs/bounds JSON from the shared `sub_workspaces` table. `list` returns
 * metadata only for the lazy sidebar list; `get` hydrates a full sub-workspace on
 * demand. Bulk persistence (detach/save) stays in {@link WorkspaceRepository}.
 */
export class SubWorkspaceRepository implements ISubWorkspaceStore {
  constructor(private readonly db: ThrongDatabase) {}

  list(ownerUser: string): SubWorkspaceMeta[] {
    return (
      this.db
        .prepare(
          `SELECT id, name, colour, content_json FROM sub_workspaces WHERE owner_user = ? ORDER BY position, updated_at`,
        )
        .all(ownerUser) as Array<{ id: string; name: string; colour: string; content_json: string }>
    ).map((r) => ({ id: r.id, name: r.name, colour: r.colour, ...countsOf(r.content_json) }));
  }

  /** Reorder the owner's sub-workspaces to match `orderedIds` (drag-to-reorder). */
  reorder(ownerUser: string, orderedIds: string[]): void {
    const update = this.db.prepare(
      `UPDATE sub_workspaces SET position = ? WHERE owner_user = ? AND id = ?`,
    );
    const apply = this.db.transaction(() => {
      orderedIds.forEach((id, index) => update.run(index, ownerUser, id));
    });
    apply();
  }

  get(ownerUser: string, id: string): SubWorkspace | null {
    const row = this.db
      .prepare(`SELECT * FROM sub_workspaces WHERE owner_user = ? AND id = ?`)
      .get(ownerUser, id) as FullRow | undefined;
    if (!row) return null;
    try {
      const content = parseSubWorkspaceContent(row.content_json);
      return {
        id: row.id,
        ownerUser: row.owner_user,
        name: row.name,
        colour: row.colour,
        bounds: JSON.parse(row.bounds_json) as SubWorkspace['bounds'],
        tabs: content.tabs,
        activeTabId: content.activeTabId,
      };
    } catch {
      return null; // a corrupt record is treated as absent
    }
  }

  rename(ownerUser: string, id: string, name: string): void {
    this.db
      .prepare(`UPDATE sub_workspaces SET name = ?, updated_at = ? WHERE owner_user = ? AND id = ?`)
      .run(name, new Date().toISOString(), ownerUser, id);
  }

  recolour(ownerUser: string, id: string, colour: string): void {
    this.db
      .prepare(`UPDATE sub_workspaces SET colour = ?, updated_at = ? WHERE owner_user = ? AND id = ?`)
      .run(colour, new Date().toISOString(), ownerUser, id);
  }

  delete(ownerUser: string, id: string): void {
    this.db.prepare(`DELETE FROM sub_workspaces WHERE owner_user = ? AND id = ?`).run(ownerUser, id);
  }

  updateBounds(ownerUser: string, id: string, bounds: SubWorkspace['bounds']): void {
    this.db
      .prepare(`UPDATE sub_workspaces SET bounds_json = ?, updated_at = ? WHERE owner_user = ? AND id = ?`)
      .run(JSON.stringify(bounds), new Date().toISOString(), ownerUser, id);
  }
}
