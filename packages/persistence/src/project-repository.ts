import type { IProjectStore, Project } from '@throng/core';
import type { ThrongDatabase } from './database.js';

interface ProjectRow {
  id: string;
  owner_user: string;
  name: string;
  colour: string;
  root_folder: string;
  is_active: number;
  hidden_paths: string | null;
  created_at: string;
  updated_at: string;
}

function parseHidden(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerUser: row.owner_user,
    name: row.name,
    colour: row.colour,
    rootFolder: row.root_folder,
    isActive: row.is_active === 1,
    hiddenPaths: parseHidden(row.hidden_paths),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * `IProjectStore` over better-sqlite3 (research D4 — daemon is the single
 * writer). All operations scoped by `owner_user`; `setActiveExclusive` flips the
 * single-active flag atomically in a transaction (data-model §3).
 */
export class ProjectRepository implements IProjectStore {
  constructor(private readonly db: ThrongDatabase) {}

  list(ownerUser: string): Project[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM projects WHERE owner_user = ? ORDER BY position ASC, created_at ASC, id ASC`,
      )
      .all(ownerUser) as ProjectRow[];
    return rows.map(toProject);
  }

  getById(ownerUser: string, id: string): Project | undefined {
    const row = this.db
      .prepare(`SELECT * FROM projects WHERE owner_user = ? AND id = ?`)
      .get(ownerUser, id) as ProjectRow | undefined;
    return row ? toProject(row) : undefined;
  }

  insert(project: Project): void {
    // New projects append to the end of the owner's order (FR-046).
    const next = this.db
      .prepare(`SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM projects WHERE owner_user = ?`)
      .get(project.ownerUser) as { pos: number };
    this.db
      .prepare(
        `INSERT INTO projects (id, owner_user, name, colour, root_folder, is_active, hidden_paths, created_at, updated_at, position)
         VALUES (@id, @owner_user, @name, @colour, @root_folder, @is_active, @hidden_paths, @created_at, @updated_at, @position)`,
      )
      .run({ ...this.toRow(project), position: next.pos });
  }

  reorder(ownerUser: string, orderedIds: string[]): void {
    const update = this.db.prepare(
      `UPDATE projects SET position = ? WHERE owner_user = ? AND id = ?`,
    );
    const tx = this.db.transaction(() => {
      orderedIds.forEach((id, index) => update.run(index, ownerUser, id));
    });
    tx();
  }

  update(project: Project): void {
    this.db
      .prepare(
        `UPDATE projects
            SET name = @name, colour = @colour, root_folder = @root_folder,
                is_active = @is_active, hidden_paths = @hidden_paths, updated_at = @updated_at
          WHERE owner_user = @owner_user AND id = @id`,
      )
      .run(this.toRow(project));
  }

  remove(ownerUser: string, id: string): void {
    this.db.prepare(`DELETE FROM projects WHERE owner_user = ? AND id = ?`).run(ownerUser, id);
  }

  setActiveExclusive(ownerUser: string, id: string): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE projects
              SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END
            WHERE owner_user = ?`,
        )
        .run(id, ownerUser);
    });
    tx();
  }

  private toRow(project: Project): ProjectRow {
    return {
      id: project.id,
      owner_user: project.ownerUser,
      name: project.name,
      colour: project.colour,
      root_folder: project.rootFolder,
      is_active: project.isActive ? 1 : 0,
      hidden_paths: JSON.stringify(project.hiddenPaths ?? []),
      created_at: project.createdAt,
      updated_at: project.updatedAt,
    };
  }
}
