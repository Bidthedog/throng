import type {
  ProjectCategoryDto,
  ProjectDto,
  ProjectsCategoriesCreateResult,
  ProjectsCategoriesDeleteResult,
  ProjectsCategoriesListResult,
  ProjectsCategoriesRenameResult,
  ProjectsCategoriesSetMinimisedResult,
  ProjectsCreateParams,
  ProjectsCreateResult,
  ProjectsDeleteResult,
  ProjectsListResult,
  ProjectsCategoriesReorderResult,
  ProjectsMoveResult,
  ProjectsReorderResult,
  ProjectsSetActiveResult,
  ProjectsSetHiddenResult,
  ProjectsUpdateParams,
  ProjectsUpdateResult,
} from '@throng/ipc-contract';
import type { ThrongBridge } from './bridge.js';

/**
 * Typed renderer-side client for the `projects.*` daemon methods (research D9/D10).
 * Wraps the generic JSON-RPC bridge so components depend on typed calls, not raw
 * method strings. The renderer never touches SQLite — it goes
 * renderer → preload → UI main → daemon.
 */
export class ProjectsClient {
  constructor(private readonly bridge: ThrongBridge) {}

  async list(): Promise<ProjectDto[]> {
    const result = await this.bridge.invoke<ProjectsListResult>('projects.list', {});
    return result.projects;
  }

  async create(input: ProjectsCreateParams): Promise<ProjectDto> {
    const result = await this.bridge.invoke<ProjectsCreateResult>('projects.create', input);
    return result.project;
  }

  async update(params: ProjectsUpdateParams): Promise<ProjectDto> {
    const result = await this.bridge.invoke<ProjectsUpdateResult>('projects.update', params);
    return result.project;
  }

  async remove(id: string): Promise<ProjectsDeleteResult> {
    return this.bridge.invoke<ProjectsDeleteResult>('projects.delete', { id });
  }

  async setActive(id: string): Promise<ProjectsSetActiveResult> {
    return this.bridge.invoke<ProjectsSetActiveResult>('projects.setActive', { id });
  }

  async reorder(orderedIds: string[]): Promise<ProjectsReorderResult> {
    return this.bridge.invoke<ProjectsReorderResult>('projects.reorder', { orderedIds });
  }

  async setHidden(id: string, hiddenPaths: string[]): Promise<ProjectDto> {
    const result = await this.bridge.invoke<ProjectsSetHiddenResult>('projects.setHidden', {
      id,
      hiddenPaths,
    });
    return result.project;
  }

  // ── Project categories (046, contracts/project-categories.md §1) ──────────────────────────────

  async listCategories(): Promise<ProjectCategoryDto[]> {
    const result = await this.bridge.invoke<ProjectsCategoriesListResult>(
      'projects.categories.list',
      {},
    );
    return result.categories;
  }

  async createCategory(name: string): Promise<ProjectCategoryDto> {
    const result = await this.bridge.invoke<ProjectsCategoriesCreateResult>(
      'projects.categories.create',
      { name },
    );
    return result.category;
  }

  async renameCategory(id: string, name: string): Promise<ProjectCategoryDto> {
    const result = await this.bridge.invoke<ProjectsCategoriesRenameResult>(
      'projects.categories.rename',
      { id, name },
    );
    return result.category;
  }

  async deleteCategory(id: string): Promise<ProjectsCategoriesDeleteResult> {
    return this.bridge.invoke<ProjectsCategoriesDeleteResult>('projects.categories.delete', { id });
  }

  async setCategoryMinimised(id: string, minimised: boolean): Promise<ProjectCategoryDto> {
    const result = await this.bridge.invoke<ProjectsCategoriesSetMinimisedResult>(
      'projects.categories.setMinimised',
      { id, minimised },
    );
    return result.category;
  }

  /**
   * 046 iterate round 1 (FR-083, contracts/project-categories.md §5) — `orderedIds` names every
   * NON-default category, exactly once, in its new order; the default always stays first.
   */
  async reorderCategories(orderedIds: string[]): Promise<ProjectCategoryDto[]> {
    const result = await this.bridge.invoke<ProjectsCategoriesReorderResult>(
      'projects.categories.reorder',
      { orderedIds },
    );
    return result.categories;
  }

  async moveProject(id: string, categoryId: string, orderedIds: string[]): Promise<string[]> {
    const result = await this.bridge.invoke<ProjectsMoveResult>('projects.move', {
      id,
      categoryId,
      orderedIds,
    });
    return result.orderedIds;
  }
}
