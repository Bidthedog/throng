import type { IUserContext } from '../abstractions/user-context.js';
import type { IProjectStore } from '../ports/project-store.js';
import {
  CATEGORY_GONE_MESSAGE,
  ProjectCategoryError,
  SHIPPED_DEFAULT_CATEGORY_NAME,
  type IProjectCategoryStore,
} from './categories.js';
import {
  applyHiddenPaths,
  applyProjectUpdate,
  assertFolderExclusive,
  assertOrderedIds,
  createProject,
  ProjectNotFoundError,
  ProjectValidationError,
  type Project,
  type ProjectInput,
} from './project.js';

/** Outcome of deleting a project (mirrors the `projects.delete` contract). */
export interface DeleteResult {
  deletedId: string;
  /** The project now active after the delete, or null if none remain. */
  newActiveId: string | null;
}

/**
 * Collaborators for {@link ProjectService}. Identity (`newId`) and the clock
 * (`now`) are injected so the service stays pure (Principle II — no node:crypto
 * / Date in core); the daemon composition root supplies real implementations.
 */
export interface ProjectServiceDeps {
  store: IProjectStore;
  /**
   * The category store (046). With it, a new project lands in the owner's default category and
   * `move` is available. Without it — until the daemon binds one — a new project carries `''`, which
   * the project store's heal rule reads back as the default category.
   */
  categories?: IProjectCategoryStore;
  userContext: IUserContext;
  newId: () => string;
  /** Returns an ISO-8601 timestamp. */
  now: () => string;
}

/**
 * Project lifecycle orchestration (Principle I): create / edit / delete / switch,
 * scoped to the current OS user, maintaining the single-active-project invariant.
 * Pure domain logic depending only on the {@link IProjectStore} port (DIP).
 */
export class ProjectService {
  constructor(private readonly deps: ProjectServiceDeps) {}

  private get owner(): string {
    return this.deps.userContext.currentUser().userId;
  }

  list(): Project[] {
    const owner = this.owner;
    // The read-time heal rule resolves an uncategorised project to the owner's default category, so
    // the default must exist before the read — a store the schema guard healed has none, and
    // `ProjectDto.categoryId` promises never to be ''. Idempotent: an existing default is kept.
    this.ensureDefaultCategory(owner);
    return this.deps.store.list(owner);
  }

  create(input: ProjectInput): Project {
    const owner = this.owner;
    const existing = this.deps.store.list(owner);
    // Folder exclusivity (FR-029): reject identical/ancestor/descendant roots.
    assertFolderExclusive(input.rootFolder, existing);
    const isFirst = existing.length === 0;
    const now = this.deps.now();
    const project = createProject(input, {
      id: this.deps.newId(),
      ownerUser: owner,
      now,
      isActive: isFirst,
      // FR-059: a new project lands in the default category, created here on a fresh database.
      categoryId: this.ensureDefaultCategory(owner, now),
    });
    this.deps.store.insert(project);
    if (isFirst) {
      this.deps.store.setActiveExclusive(owner, project.id);
    }
    return project;
  }

  update(id: string, patch: Partial<ProjectInput>): Project {
    const owner = this.owner;
    const existing = this.requireProject(owner, id);
    // Folder exclusivity on edit (FR-029): check the merged root against others.
    if (patch.rootFolder !== undefined) {
      assertFolderExclusive(patch.rootFolder, this.deps.store.list(owner), id);
    }
    const updated = applyProjectUpdate(existing, patch, this.deps.now());
    this.deps.store.update(updated);
    return updated;
  }

  /** Replace a project's hidden-paths list (004 — file-tree per-project hide). */
  setHidden(id: string, hiddenPaths: readonly string[]): Project {
    const owner = this.owner;
    const existing = this.requireProject(owner, id);
    const updated = applyHiddenPaths(existing, hiddenPaths, this.deps.now());
    this.deps.store.update(updated);
    return updated;
  }

  setActive(id: string): { activeId: string } {
    const owner = this.owner;
    this.requireProject(owner, id);
    this.deps.store.setActiveExclusive(owner, id);
    return { activeId: id };
  }

  /** Set the display order of the current owner's projects (FR-046). */
  reorder(orderedIds: string[]): { orderedIds: string[] } {
    assertOrderedIds(orderedIds);
    this.deps.store.reorder(this.owner, orderedIds);
    return { orderedIds };
  }

  /**
   * Move a project into a category and set the global order in one store call (046 FR-055): the
   * drop slot a drag lands in, or the end of a category for Move to Category. Every refusal is a
   * {@link ProjectValidationError}, because the contract reports each as invalid params.
   */
  move(id: string, categoryId: string, orderedIds: string[]): { orderedIds: string[] } {
    assertOrderedIds(orderedIds);
    const owner = this.owner;
    if (!this.deps.store.getById(owner, id)) {
      // No id in the message: the notice already names the project it was about (030).
      throw new ProjectValidationError('That project no longer exists', 'id');
    }
    const categories = this.deps.categories;
    if (!categories) {
      // A wiring fault, not bad input: say so rather than blaming the caller's category id.
      throw new Error('ProjectService.move needs a category store, and none was provided');
    }
    if (!categories.list(owner).some((c) => c.id === categoryId)) {
      throw new ProjectCategoryError(CATEGORY_GONE_MESSAGE, 'unknown');
    }
    this.deps.store.move(owner, id, categoryId, orderedIds);
    return { orderedIds };
  }

  delete(id: string): DeleteResult {
    const owner = this.owner;
    const target = this.requireProject(owner, id);
    this.deps.store.remove(owner, id);

    // If the active project was removed, promote another (the first remaining).
    let newActiveId: string | null = null;
    if (target.isActive) {
      const remaining = this.deps.store.list(owner);
      const next = remaining[0];
      if (next) {
        this.deps.store.setActiveExclusive(owner, next.id);
        newActiveId = next.id;
      }
    }
    return { deletedId: id, newActiveId };
  }

  /** The owner's default category id, created when missing; undefined with no category store. */
  private ensureDefaultCategory(owner: string, now: string = this.deps.now()): string | undefined {
    return this.deps.categories?.ensureDefault(owner, {
      id: this.deps.newId(),
      name: SHIPPED_DEFAULT_CATEGORY_NAME,
      now,
    }).id;
  }

  private requireProject(owner: string, id: string): Project {
    const project = this.deps.store.getById(owner, id);
    if (!project) throw new ProjectNotFoundError(id);
    return project;
  }
}
