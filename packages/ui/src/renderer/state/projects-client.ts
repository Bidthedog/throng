import type {
  ProjectDto,
  ProjectsCreateParams,
  ProjectsCreateResult,
  ProjectsDeleteResult,
  ProjectsListResult,
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
}
