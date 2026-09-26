import type { IUserContext } from '../abstractions/user-context.js';
import type { IProjectStore } from '../ports/project-store.js';
import { assertOrderedIds, ProjectValidationError } from './project.js';
import { MAX_CATEGORY_NAME_LENGTH, mergeIntoDefault, validateCategoryName } from './project-list.js';

/**
 * The name the default category is created with (046 FR-050, Principle X). The user can rename it
 * afterwards; this is only what a fresh owner, or migration v9, seeds.
 */
export const SHIPPED_DEFAULT_CATEGORY_NAME = 'In Progress';

/** A named group of projects in the Projects pane (046, data-model §1). */
export interface ProjectCategory {
  id: string;
  /** Owner key — the current OS user, like {@link Project.ownerUser}. */
  ownerUser: string;
  /** Trimmed, non-empty, unique per owner ignoring case. */
  name: string;
  /** Exactly one per owner. It cannot be deleted or minimised. */
  isDefault: boolean;
  /** Collapsed to its header. Always false for the default category. */
  minimised: boolean;
  /**
   * Orders the non-default categories (FR-083 / FR-084, superseding FR-056's creation order). Set by
   * the store: `create` appends one past the owner's highest, `reorder` writes each index. The
   * default is listed first whatever its position.
   */
  position: number;
  /** ISO-8601. */
  createdAt: string;
  updatedAt: string;
}

/** What a new default category is built from when {@link IProjectCategoryStore.ensureDefault} needs one. */
export interface DefaultCategorySeed {
  id: string;
  name: string;
  /** ISO-8601 timestamp. */
  now: string;
}

/**
 * Persistence port for project categories (046, contracts/project-categories.md §2). Implemented by
 * the persistence package's `ProjectCategoryRepository`. Every operation is scoped by `ownerUser`.
 * Synchronous, like {@link IProjectStore}.
 */
export interface IProjectCategoryStore {
  /** The owner's default category; created from `seed` when the owner has none. Idempotent. */
  ensureDefault(ownerUser: string, seed: DefaultCategorySeed): ProjectCategory;
  /** The owner's categories: the default first, then by `position`, then by `id`. */
  list(ownerUser: string): ProjectCategory[];
  /**
   * Insert a category row, appended after the owner's others (FR-084): the store assigns `position`
   * one past the owner's highest and ignores the value passed.
   */
  create(category: ProjectCategory): void;
  /**
   * In ONE transaction, set each of the owner's non-default categories' `position` to its index in
   * `orderedIds` (FR-083). Validation is the service's; the store only writes.
   */
  reorder(ownerUser: string, orderedIds: readonly string[]): void;
  rename(ownerUser: string, id: string, name: string, now: string): void;
  setMinimised(ownerUser: string, id: string, minimised: boolean, now: string): void;
  /**
   * In ONE transaction: move the category's projects to `defaultId`, rewrite the global project
   * order to `orderedIds`, and delete the category row (FR-054).
   */
  deleteMerge(ownerUser: string, id: string, defaultId: string, orderedIds: readonly string[]): void;
}

/**
 * What the user reads when a category named by a request no longer exists — deleted in another
 * window, say. It carries no id: the notice already names the category it was about (030).
 */
export const CATEGORY_GONE_MESSAGE = 'That category no longer exists';

/** Why a category operation was refused. */
export type ProjectCategoryRefusal =
  | 'empty'
  | 'duplicate'
  | 'tooLong'
  | 'unknown'
  | 'isDefault'
  /** A `reorder` list that leaves a category out or names one twice (FR-083). */
  | 'incomplete';

/**
 * A refused category operation. A {@link ProjectValidationError}, so the daemon's router reports it as
 * invalid params (-32602), which is what the contract names for every category refusal, an unknown
 * id included.
 */
export class ProjectCategoryError extends ProjectValidationError {
  constructor(
    message: string,
    readonly reason: ProjectCategoryRefusal,
  ) {
    super(message, 'category');
    this.name = 'ProjectCategoryError';
  }
}

/** Collaborators for {@link ProjectCategoryService}; identity and the clock are injected (Principle II). */
export interface ProjectCategoryServiceDeps {
  store: IProjectCategoryStore;
  /** Read for the global project order a delete rewrites. */
  projectStore: IProjectStore;
  userContext: IUserContext;
  newId: () => string;
  /** Returns an ISO-8601 timestamp. */
  now: () => string;
}

/**
 * The rules for project categories (046 FR-050 – FR-054), scoped to the current OS user. The
 * repository stores; this decides. The default category is refused by `delete` and `setMinimised`
 * whoever calls them — the UI drawing no control for it is not the guard.
 */
export class ProjectCategoryService {
  constructor(private readonly deps: ProjectCategoryServiceDeps) {}

  private get owner(): string {
    return this.deps.userContext.currentUser().userId;
  }

  list(): ProjectCategory[] {
    const owner = this.owner;
    this.ensureDefault(owner);
    return this.deps.store.list(owner);
  }

  create(name: string): ProjectCategory {
    const owner = this.owner;
    this.ensureDefault(owner);
    const validName = this.validName(name, this.deps.store.list(owner));
    const now = this.deps.now();
    const category: ProjectCategory = {
      id: this.deps.newId(),
      ownerUser: owner,
      name: validName,
      isDefault: false,
      minimised: false,
      // The store appends (FR-084); what it assigned is read back below.
      position: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.deps.store.create(category);
    return this.deps.store.list(owner).find((c) => c.id === category.id) ?? category;
  }

  /**
   * Set the order of the owner's non-default categories (FR-083, contracts/project-categories.md §5).
   * `orderedIds` names every non-default category exactly once; the default stays first and may not
   * be named. Every refusal is a {@link ProjectValidationError} and is raised before anything is
   * written. Returns the owner's categories in their new list order.
   */
  reorder(orderedIds: string[]): ProjectCategory[] {
    assertOrderedIds(orderedIds);
    const owner = this.owner;
    this.ensureDefault(owner);
    const existing = this.deps.store.list(owner);
    for (const id of orderedIds) {
      const found = requireCategory(existing, id);
      if (found.isDefault) {
        throw new ProjectCategoryError('The default category is always listed first', 'isDefault');
      }
    }
    const nonDefault = existing.filter((c) => !c.isDefault);
    if (new Set(orderedIds).size !== orderedIds.length || orderedIds.length !== nonDefault.length) {
      throw new ProjectCategoryError(
        'The new category order must name every category exactly once',
        'incomplete',
      );
    }
    this.deps.store.reorder(owner, orderedIds);
    return this.deps.store.list(owner);
  }

  rename(id: string, name: string): ProjectCategory {
    const owner = this.owner;
    const existing = this.deps.store.list(owner);
    const target = requireCategory(existing, id);
    const validName = this.validName(name, existing, id);
    const now = this.deps.now();
    this.deps.store.rename(owner, id, validName, now);
    return { ...target, name: validName, updatedAt: now };
  }

  setMinimised(id: string, minimised: boolean): ProjectCategory {
    const owner = this.owner;
    const target = requireNonDefault(this.deps.store.list(owner), id, 'minimised');
    const now = this.deps.now();
    this.deps.store.setMinimised(owner, id, minimised, now);
    return { ...target, minimised, updatedAt: now };
  }

  delete(id: string): { movedProjectIds: string[] } {
    const owner = this.owner;
    requireNonDefault(this.deps.store.list(owner), id, 'deleted');
    const defaultId = this.ensureDefault(owner).id;
    /*
     * arch review #3 (32fd53ed): no read-time heal here. `IProjectStore.list()`'s contract already
     * resolves every project's `categoryId` (own category, else the owner's default) before this
     * code ever sees it — `SELECT_RESOLVED` in the SQL-backed `ProjectRepository`. Re-deriving the
     * same heal from a freshly-fetched `known` set was dead weight duplicating that one rule.
     */
    const projects = this.deps.projectStore.list(owner);
    const categoryOf = new Map(projects.map((p) => [p.id, p.categoryId] as const));
    const orderedIds = mergeIntoDefault(
      projects.map((p) => p.id),
      (projectId) => categoryOf.get(projectId) ?? defaultId,
      id,
      defaultId,
    );
    const movedProjectIds = projects.filter((p) => categoryOf.get(p.id) === id).map((p) => p.id);
    this.deps.store.deleteMerge(owner, id, defaultId, orderedIds);
    return { movedProjectIds };
  }

  private ensureDefault(owner: string): ProjectCategory {
    return this.deps.store.ensureDefault(owner, {
      id: this.deps.newId(),
      name: SHIPPED_DEFAULT_CATEGORY_NAME,
      now: this.deps.now(),
    });
  }

  private validName(name: string, existing: readonly ProjectCategory[], selfId?: string): string {
    const result = validateCategoryName(name, existing, selfId);
    if (result.ok) return result.name;
    const message =
      result.reason === 'empty'
        ? 'A category name must not be empty'
        : result.reason === 'tooLong'
          ? `A category name must be at most ${MAX_CATEGORY_NAME_LENGTH} characters`
          : `A category named "${name.trim()}" already exists`;
    throw new ProjectCategoryError(message, result.reason);
  }
}

function requireCategory(categories: readonly ProjectCategory[], id: string): ProjectCategory {
  const found = categories.find((c) => c.id === id);
  // No id in the message: the renderer shows it beside a subject that names the category.
  if (!found) throw new ProjectCategoryError(CATEGORY_GONE_MESSAGE, 'unknown');
  return found;
}

function requireNonDefault(
  categories: readonly ProjectCategory[],
  id: string,
  verb: 'deleted' | 'minimised',
): ProjectCategory {
  const found = requireCategory(categories, id);
  if (found.isDefault) {
    throw new ProjectCategoryError(`The default category cannot be ${verb}`, 'isDefault');
  }
  return found;
}
