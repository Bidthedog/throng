import type { AttentionFlagEntry } from '@throng/core';
import type { ThrongDatabase } from './database.js';

interface AttentionFlagRow {
  panel_id: string;
  project_id: string;
  panel_title: string | null;
  tab_title: string | null;
  project_name: string | null;
  raised_at: number | null;
}

/**
 * Manual attention flags over better-sqlite3 (057 round 12, FR-125 / FR-128; migration v11).
 *
 * Keyed by panel. There is deliberately no foreign key to `projects`: a flag's project is a plain
 * column, and the daemon's project delete path calls {@link clearProject}.
 */
export class AttentionFlagRepository {
  constructor(private readonly db: ThrongDatabase) {}

  list(): AttentionFlagEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM attention_flag ORDER BY raised_at, panel_id')
      .all() as AttentionFlagRow[];
    return rows.map((r) => ({
      panelId: r.panel_id,
      projectId: r.project_id,
      panelTitle: r.panel_title ?? '',
      tabTitle: r.tab_title ?? '',
      projectName: r.project_name ?? '',
      raisedAt: r.raised_at ?? 0,
    }));
  }

  /** Upsert by `panelId`. */
  set(entry: AttentionFlagEntry): void {
    this.db
      .prepare(
        `INSERT INTO attention_flag(panel_id, project_id, panel_title, tab_title, project_name, raised_at)
           VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(panel_id) DO UPDATE SET
           project_id = excluded.project_id,
           panel_title = excluded.panel_title,
           tab_title = excluded.tab_title,
           project_name = excluded.project_name,
           raised_at = excluded.raised_at`,
      )
      .run(
        entry.panelId,
        entry.projectId,
        entry.panelTitle,
        entry.tabTitle,
        entry.projectName,
        entry.raisedAt,
      );
  }

  /** Delete one flag; a missing row is not an error. */
  clear(panelId: string): void {
    this.db.prepare('DELETE FROM attention_flag WHERE panel_id = ?').run(panelId);
  }

  /** Delete every flag of a project (the project was deleted). */
  clearProject(projectId: string): void {
    this.db.prepare('DELETE FROM attention_flag WHERE project_id = ?').run(projectId);
  }
}
