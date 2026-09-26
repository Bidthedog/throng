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
  category_id: string;
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
    categoryId: row.category_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A project row with `category_id` RESOLVED (046, research R9 heal rule): the project's own
 * category when it names one of the owner's, otherwise the owner's default. So `''` (a row the
 * backfill or the guard left uncategorised), a dangling id and another owner's id all read back as
 * the default, and a project handed out is never uncategorised once the owner has a default.
 */
const SELECT_RESOLVED = `
  SELECT p.id, p.owner_user, p.name, p.colour, p.root_folder, p.is_active, p.hidden_paths,
         p.created_at, p.updated_at, COALESCE(own.id, def.id, '') AS category_id
    FROM projects p
    LEFT JOIN project_categories own ON own.owner_user = p.owner_user AND own.id = p.category_id
    LEFT JOIN project_categories def ON def.owner_user = p.owner_user AND def.is_default = 1`;

/**
 * Rewrite the owner's global project order to `orderedIds` (FR-046). The caller owns the
 * transaction, so a reorder can share one with the write that motivated it (046 move, delete-merge).
 */
export function writeProjectOrder(
  db: ThrongDatabase,
  ownerUser: string,
  orderedIds: readonly string[],
): void {
  const update = db.prepare(`UPDATE projects SET position = ? WHERE owner_user = ? AND id = ?`);
  orderedIds.forEach((id, index) => update.run(index, ownerUser, id));
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
        `${SELECT_RESOLVED} WHERE p.owner_user = ? ORDER BY p.position ASC, p.created_at ASC, p.id ASC`,
      )
      .all(ownerUser) as ProjectRow[];
    return rows.map(toProject);
  }

  getById(ownerUser: string, id: string): Project | undefined {
    const row = this.db
      .prepare(`${SELECT_RESOLVED} WHERE p.owner_user = ? AND p.id = ?`)
      .get(ownerUser, id) as ProjectRow | undefined;
    return row ? toProject(row) : undefined;
  }

  insert(project: Project): void {
    // New projects append to the end of the owner's order (FR-046), in the category they name, or
    // the owner's default category when they name none (046 FR-059).
    const next = this.db
      .prepare(`SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM projects WHERE owner_user = ?`)
      .get(project.ownerUser) as { pos: number };
    this.db
      .prepare(
        `INSERT INTO projects (id, owner_user, name, colour, root_folder, is_active, hidden_paths, created_at, updated_at, position, category_id)
         VALUES (@id, @owner_user, @name, @colour, @root_folder, @is_active, @hidden_paths, @created_at, @updated_at, @position,
                 COALESCE(
                   NULLIF(@category_id, ''),
                   (SELECT id FROM project_categories WHERE owner_user = @owner_user AND is_default = 1),
                   ''
                 ))`,
      )
      .run({ ...this.toRow(project), position: next.pos });
  }

  reorder(ownerUser: string, orderedIds: string[]): void {
    this.db.transaction(() => writeProjectOrder(this.db, ownerUser, orderedIds))();
  }

  move(ownerUser: string, id: string, categoryId: string, orderedIds: readonly string[]): void {
    this.db.transaction(() => {
      this.db
        .prepare(`UPDATE projects SET category_id = ? WHERE owner_user = ? AND id = ?`)
        .run(categoryId, ownerUser, id);
      writeProjectOrder(this.db, ownerUser, orderedIds);
    })();
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
      category_id: project.categoryId ?? '',
      created_at: project.createdAt,
      updated_at: project.updatedAt,
    };
  }
}
