import type { ThrongDatabase } from '../database.js';

/**
 * Migration v2 (002 / data-model §3): adds the project + workspace domain tables.
 * All rows carry an `owner_user` key (per-user local-storage constraint, shaped
 * for future multi-user + import/export). The per-project layout is stored as a
 * JSON document (`layout_json`) rather than a normalised tree (research D5);
 * `workspace_layout` cascades when its project is deleted (FR-006, requires
 * `PRAGMA foreign_keys = ON`, set at connection open).
 */
export const MIGRATION_V2_VERSION = 2;

export function applyMigrationV2(db: ThrongDatabase): void {
  db.exec(`
    CREATE TABLE projects (
      id           TEXT PRIMARY KEY,
      owner_user   TEXT NOT NULL,
      name         TEXT NOT NULL,
      colour       TEXT NOT NULL,
      root_folder  TEXT NOT NULL,
      is_active    INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX idx_projects_owner ON projects(owner_user);

    CREATE TABLE workspace_layout (
      owner_user     TEXT NOT NULL,
      project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      schema_version INTEGER NOT NULL,
      layout_json    TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      PRIMARY KEY (owner_user, project_id)
    );

    CREATE TABLE sub_workspaces (
      id           TEXT PRIMARY KEY,
      owner_user   TEXT NOT NULL,
      bounds_json  TEXT NOT NULL,
      content_json TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX idx_subws_owner ON sub_workspaces(owner_user);
  `);
}
