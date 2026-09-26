import type { Project } from '../projects/project.js';

/**
 * Persistence port for projects (Principle VIII DIP / research D4). The core
 * `ProjectService` depends on this abstraction; the daemon's `ProjectRepository`
 * implements it over better-sqlite3 (the single SQLite writer). All operations
 * are scoped by `ownerUser`. Synchronous, mirroring better-sqlite3 — the daemon
 * owns the only DB process, so no async is needed at this boundary.
 */
export interface IProjectStore {
  /**
   * All of the owner's projects, stable order.
   *
   * `categoryId` is ALWAYS resolved (046 research R9 heal rule): a project naming a category the
   * owner still has keeps it, and one naming no known category (dangling, or never set) reads back
   * as the owner's default category. Callers (e.g. `ProjectCategoryService.delete`) rely on this —
   * they never re-heal a `categoryId` this method hands them. The SQL-backed `ProjectRepository`
   * implements it with `SELECT_RESOLVED`'s `COALESCE`; any other implementation must resolve the
   * same way.
   */
  list(ownerUser: string): Project[];
  /** A single project, or undefined if absent. */
  getById(ownerUser: string, id: string): Project | undefined;
  /** Insert a fully-formed project row. */
  insert(project: Project): void;
  /** Replace an existing project row (by id + ownerUser). */
  update(project: Project): void;
  /** Remove a project (cascades its workspace_layout). */
  remove(ownerUser: string, id: string): void;
  /** Mark exactly one project active for the owner (clears the others) atomically. */
  setActiveExclusive(ownerUser: string, id: string): void;
  /** Set the display order of the owner's projects to the given id sequence (FR-046). */
  reorder(ownerUser: string, orderedIds: string[]): void;
  /**
   * In ONE transaction: set the project's category, then set the owner's global order to
   * `orderedIds` as {@link reorder} does (046 FR-055).
   */
  move(ownerUser: string, id: string, categoryId: string, orderedIds: readonly string[]): void;
}
