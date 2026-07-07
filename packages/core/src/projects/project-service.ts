import type { IUserContext } from '../abstractions/user-context.js';
import type { IProjectStore } from '../ports/project-store.js';
import {
  applyHiddenPaths,
  applyProjectUpdate,
  assertFolderExclusive,
  createProject,
  ProjectNotFoundError,
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
    return this.deps.store.list(this.owner);
  }

  create(input: ProjectInput): Project {
    const owner = this.owner;
    const existing = this.deps.store.list(owner);
    // Folder exclusivity (FR-029): reject identical/ancestor/descendant roots.
    assertFolderExclusive(input.rootFolder, existing);
    const isFirst = existing.length === 0;
    const project = createProject(input, {
      id: this.deps.newId(),
      ownerUser: owner,
      now: this.deps.now(),
      isActive: isFirst,
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
    this.deps.store.reorder(this.owner, orderedIds);
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

  private requireProject(owner: string, id: string): Project {
    const project = this.deps.store.getById(owner, id);
    if (!project) throw new ProjectNotFoundError(id);
    return project;
  }
}
