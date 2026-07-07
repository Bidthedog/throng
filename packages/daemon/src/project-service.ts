import {
  PROJECTS_LIST_METHOD,
  PROJECTS_CREATE_METHOD,
  PROJECTS_UPDATE_METHOD,
  PROJECTS_DELETE_METHOD,
  PROJECTS_SET_ACTIVE_METHOD,
  PROJECTS_REORDER_METHOD,
  PROJECTS_SET_HIDDEN_METHOD,
  JSON_RPC_INVALID_PARAMS,
  type ProjectDto,
} from '@throng/ipc-contract';
import type { Project, ProjectService } from '@throng/core';
import { RpcError, type RpcRouter } from './rpc-router.js';

function toDto(project: Project): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    colour: project.colour,
    rootFolder: project.rootFolder,
    isActive: project.isActive,
    hiddenPaths: project.hiddenPaths,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function asObject(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new RpcError('Params must be an object', JSON_RPC_INVALID_PARAMS);
  }
  return params as Record<string, unknown>;
}

function requireId(params: unknown): string {
  const id = asObject(params).id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new RpcError('A non-empty "id" is required', JSON_RPC_INVALID_PARAMS);
  }
  return id;
}

function asString(value: unknown): string {
  // Coerce to string so the core validator (not a TypeError) reports bad input
  // as a ProjectValidationError → JSON-RPC -32602.
  return typeof value === 'string' ? value : '';
}

/** Per-project layout counts, supplied by the daemon (reads the workspace store). */
export type LayoutCounts = (projectId: string) => { tabCount: number; panelCount: number };

/**
 * Thin daemon adapter (002 / contracts/ipc-projects.md): translates `projects.*`
 * JSON-RPC calls to the pure core {@link ProjectService} and back to DTOs. Holds
 * no business rules — the single-active invariant and validation live in core.
 * `projects.list` is enriched with each project's saved tab/panel counts via the
 * optional `countLayout` provider.
 */
export class ProjectIpcService {
  constructor(
    private readonly service: ProjectService,
    private readonly countLayout?: LayoutCounts,
    /** Whether a project has open terminals — gates root-path edits (005, FR-022). */
    private readonly hasOpenTerminals?: (projectId: string) => boolean,
    /** Kill a deleted project's terminals so their OS hosts aren't orphaned (005). */
    private readonly killProjectTerminals?: (projectId: string) => void,
  ) {}

  register(router: RpcRouter): void {
    router.register(PROJECTS_LIST_METHOD, () => ({
      projects: this.service.list().map((project) => {
        const dto = toDto(project);
        return this.countLayout ? { ...dto, ...this.countLayout(project.id) } : dto;
      }),
    }));

    router.register(PROJECTS_CREATE_METHOD, (params) => {
      const p = asObject(params);
      const project = this.service.create({
        name: asString(p.name),
        colour: asString(p.colour),
        rootFolder: asString(p.rootFolder),
      });
      return { project: toDto(project) };
    });

    router.register(PROJECTS_UPDATE_METHOD, (params) => {
      const id = requireId(params);
      const p = asObject(params);
      // FR-022: a project's root path cannot change while it has open terminals
      // (the running terminals' binding context must not be pulled out from under them).
      if (p.rootFolder !== undefined && this.hasOpenTerminals?.(id)) {
        throw new RpcError(
          'Cannot change the project root folder while it has open terminals',
          JSON_RPC_INVALID_PARAMS,
        );
      }
      const patch: { name?: string; colour?: string; rootFolder?: string } = {};
      if (p.name !== undefined) patch.name = asString(p.name);
      if (p.colour !== undefined) patch.colour = asString(p.colour);
      if (p.rootFolder !== undefined) patch.rootFolder = asString(p.rootFolder);
      return { project: toDto(this.service.update(id, patch)) };
    });

    router.register(PROJECTS_DELETE_METHOD, (params) => {
      const id = requireId(params);
      // Tear down the project's terminals first so deleting it never orphans their
      // OS hosts (the daemon keeps terminals keyed by panelId, not by project).
      this.killProjectTerminals?.(id);
      return this.service.delete(id);
    });

    router.register(PROJECTS_SET_ACTIVE_METHOD, (params) =>
      this.service.setActive(requireId(params)),
    );

    router.register(PROJECTS_REORDER_METHOD, (params) => {
      const orderedIds = asObject(params).orderedIds;
      if (!Array.isArray(orderedIds) || !orderedIds.every((id) => typeof id === 'string')) {
        throw new RpcError('"orderedIds" must be an array of strings', JSON_RPC_INVALID_PARAMS);
      }
      return this.service.reorder(orderedIds as string[]);
    });

    router.register(PROJECTS_SET_HIDDEN_METHOD, (params) => {
      const id = requireId(params);
      const hiddenPaths = asObject(params).hiddenPaths;
      if (!Array.isArray(hiddenPaths) || !hiddenPaths.every((p) => typeof p === 'string')) {
        throw new RpcError('"hiddenPaths" must be an array of strings', JSON_RPC_INVALID_PARAMS);
      }
      return { project: toDto(this.service.setHidden(id, hiddenPaths as string[])) };
    });
  }
}
