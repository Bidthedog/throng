import type { DefaultCategorySeed, IProjectCategoryStore, ProjectCategory } from '@throng/core';
import type { ThrongDatabase } from './database.js';
import { writeProjectOrder } from './project-repository.js';

interface CategoryRow {
  id: string;
  owner_user: string;
  name: string;
  is_default: number;
  minimised: number;
  position: number;
  created_at: string;
  updated_at: string;
}

function toCategory(row: CategoryRow): ProjectCategory {
  return {
    id: row.id,
    ownerUser: row.owner_user,
    name: row.name,
    isDefault: row.is_default === 1,
    minimised: row.minimised === 1,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * `IProjectCategoryStore` over better-sqlite3 (046, data-model §1, research R9). Every statement is
 * scoped by `owner_user`, so one owner can never touch another's category even when the ids
 * collide. The rules — naming, which category may be deleted or minimised — live in core's
 * `ProjectCategoryService`; this only stores.
 */
export class ProjectCategoryRepository implements IProjectCategoryStore {
  constructor(private readonly db: ThrongDatabase) {}

  ensureDefault(ownerUser: string, seed: DefaultCategorySeed): ProjectCategory {
    const tx = this.db.transaction((): CategoryRow => {
      this.db
        .prepare(
          `INSERT INTO project_categories (id, owner_user, name, is_default, minimised, created_at, updated_at)
           SELECT ?, ?, ?, 1, 0, ?, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM project_categories WHERE owner_user = ? AND is_default = 1
            )`,
        )
        .run(seed.id, ownerUser, seed.name, seed.now, seed.now, ownerUser);
      return this.db
        .prepare(`SELECT * FROM project_categories WHERE owner_user = ? AND is_default = 1`)
        .get(ownerUser) as CategoryRow;
    });
    return toCategory(tx());
  }

  list(ownerUser: string): ProjectCategory[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM project_categories WHERE owner_user = ?
          ORDER BY is_default DESC, position ASC, id ASC`,
      )
      .all(ownerUser) as CategoryRow[];
    return rows.map(toCategory);
  }

  /**
   * Insert a category, appended after every one the owner already has (FR-084): its `position` is
   * one past the owner's highest non-default position, whatever `category.position` says. The read
   * and the insert share one statement, so no interleaved create can take the same slot.
   */
  create(category: ProjectCategory): void {
    this.db
      .prepare(
        `INSERT INTO project_categories
           (id, owner_user, name, is_default, minimised, position, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, COALESCE(MAX(position), -1) + 1, ?, ?
           FROM project_categories WHERE owner_user = ? AND is_default = 0`,
      )
      .run(
        category.id,
        category.ownerUser,
        category.name,
        category.isDefault ? 1 : 0,
        category.minimised ? 1 : 0,
        category.createdAt,
        category.updatedAt,
        category.ownerUser,
      );
  }

  /**
   * Rewrite the order of the owner's non-default categories in ONE transaction (FR-083): each id's
   * `position` becomes its index in `orderedIds`. Scoped by owner and to non-default rows, so an id
   * the owner does not have, or the default's, changes nothing. Which lists are acceptable is core's
   * `ProjectCategoryService`'s decision; this only writes.
   */
  reorder(ownerUser: string, orderedIds: readonly string[]): void {
    const setPosition = this.db.prepare(
      `UPDATE project_categories SET position = ?
        WHERE owner_user = ? AND id = ? AND is_default = 0`,
    );
    const tx = this.db.transaction(() => {
      orderedIds.forEach((id, index) => setPosition.run(index, ownerUser, id));
    });
    tx();
  }

  rename(ownerUser: string, id: string, name: string, now: string): void {
    this.db
      .prepare(`UPDATE project_categories SET name = ?, updated_at = ? WHERE owner_user = ? AND id = ?`)
      .run(name, now, ownerUser, id);
  }

  setMinimised(ownerUser: string, id: string, minimised: boolean, now: string): void {
    // The default category is never minimised (data-model §1); the service refuses it first.
    this.db
      .prepare(
        `UPDATE project_categories SET minimised = ?, updated_at = ?
          WHERE owner_user = ? AND id = ? AND is_default = 0`,
      )
      .run(minimised ? 1 : 0, now, ownerUser, id);
  }

  deleteMerge(ownerUser: string, id: string, defaultId: string, orderedIds: readonly string[]): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE projects SET category_id = ? WHERE owner_user = ? AND category_id = ?`)
        .run(defaultId, ownerUser, id);
      writeProjectOrder(this.db, ownerUser, orderedIds);
      this.db
        .prepare(`DELETE FROM project_categories WHERE owner_user = ? AND id = ? AND is_default = 0`)
        .run(ownerUser, id);
    });
    tx();
  }
}
