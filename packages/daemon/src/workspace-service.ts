import {
  WORKSPACE_LOAD_METHOD,
  WORKSPACE_SAVE_METHOD,
  WORKSPACE_LOAD_SUBS_METHOD,
  WORKSPACE_PERSIST_SUBS_METHOD,
  WORKSPACE_SUMMARY_METHOD,
  JSON_RPC_INVALID_PARAMS,
} from '@throng/ipc-contract';
import {
  validateMainLayout,
  migratePanelTitles,
  countPanels,
  ProjectNotFoundError,
  type IProjectStore,
  type IUserContext,
  type IWorkspaceStore,
  type SubWorkspace,
  type WorkspaceLayout,
} from '@throng/core';
import { RpcError, type RpcRouter } from './rpc-router.js';

export interface WorkspaceIpcDeps {
  workspaceStore: IWorkspaceStore;
  projectStore: IProjectStore;
  userContext: IUserContext;
}

function asObject(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new RpcError('Params must be an object', JSON_RPC_INVALID_PARAMS);
  }
  return params as Record<string, unknown>;
}

function requireProjectId(params: unknown): string {
  const id = asObject(params).projectId;
  if (typeof id !== 'string' || id.length === 0) {
    throw new RpcError('A non-empty "projectId" is required', JSON_RPC_INVALID_PARAMS);
  }
  return id;
}

/**
 * Daemon adapter for `workspace.*` (002 / contracts/ipc-workspace.md). Loads/saves
 * the per-project layout document through the {@link IWorkspaceStore}. Enforces
 * INV-4 at the persistence boundary as defence-in-depth: a `workspace.save` whose
 * layout mixes another project's Panel is rejected with -32602 (the core already
 * prevents producing such a layout). Owner is resolved from {@link IUserContext}.
 */
export class WorkspaceIpcService {
  constructor(private readonly deps: WorkspaceIpcDeps) {}

  private get owner(): string {
    return this.deps.userContext.currentUser().userId;
  }

  private requireExistingProject(projectId: string): void {
    if (!this.deps.projectStore.getById(this.owner, projectId)) {
      throw new ProjectNotFoundError(projectId);
    }
  }

  register(router: RpcRouter): void {
    router.register(WORKSPACE_LOAD_METHOD, (params) => {
      const projectId = requireProjectId(params);
      this.requireExistingProject(projectId);
      const loaded = this.deps.workspaceStore.load(this.owner, projectId);
      // 048 FR-035 — a layout saved before panel renaming was removed loads with its custom titles
      // dropped. Idempotent, so every load may run it; the next save writes the clean document.
      return { ...loaded, layout: migratePanelTitles(loaded.layout) };
    });

    router.register(WORKSPACE_SAVE_METHOD, (params) => {
      const projectId = requireProjectId(params);
      this.requireExistingProject(projectId);
      const raw = asObject(params).layout as WorkspaceLayout | undefined;
      if (!raw || typeof raw !== 'object') {
        throw new RpcError('A "layout" document is required', JSON_RPC_INVALID_PARAMS);
      }
      // 048 FR-035 — never write a custom panel title back (a window still holding a pre-048 layout).
      // A malformed document passes through untouched, for `validateMainLayout` to report below.
      const layout = migratePanelTitles(raw);
      if (layout.projectId !== projectId) {
        throw new RpcError('layout.projectId must match the target project', JSON_RPC_INVALID_PARAMS);
      }
      // Validate defensively: a structurally malformed document (e.g. a missing
      // tab root) must surface as invalid-params (-32602), not an internal error.
      let violations: string[];
      try {
        violations = validateMainLayout(layout);
      } catch (error) {
        throw new RpcError(
          `Malformed layout document: ${(error as Error).message}`,
          JSON_RPC_INVALID_PARAMS,
        );
      }
      if (violations.length > 0) {
        // INV-4 (and other structural) defence-in-depth.
        throw new RpcError(`Invalid layout: ${violations.join('; ')}`, JSON_RPC_INVALID_PARAMS);
      }
      this.deps.workspaceStore.save(this.owner, projectId, layout);
      return { ok: true } as const;
    });

    // 048 FR-035 — sub-workspaces (and so tear-offs) hold panels in tabs too: the same migration.
    router.register(WORKSPACE_LOAD_SUBS_METHOD, () => ({
      subWorkspaces: this.deps.workspaceStore.loadSubWorkspaces(this.owner).map(migratePanelTitles),
    }));

    router.register(WORKSPACE_PERSIST_SUBS_METHOD, (params) => {
      const subWorkspaces = asObject(params).subWorkspaces as SubWorkspace[] | undefined;
      if (!Array.isArray(subWorkspaces)) {
        throw new RpcError('"subWorkspaces" must be an array', JSON_RPC_INVALID_PARAMS);
      }
      this.deps.workspaceStore.persistSubWorkspaces(this.owner, subWorkspaces.map(migratePanelTitles));
      return { ok: true } as const;
    });

    router.register(WORKSPACE_SUMMARY_METHOD, () => {
      // Aggregate counts across all of the owner's projects for the window title
      // (FR-040). A project with no saved layout contributes its default 1 tab/1
      // panel (what it would open as).
      const projects = this.deps.projectStore.list(this.owner);
      let tabs = 0;
      let panels = 0;
      for (const project of projects) {
        const { layout } = this.deps.workspaceStore.load(this.owner, project.id);
        tabs += layout.tabs.length;
        panels += layout.tabs.reduce((n, tab) => n + countPanels(tab.root), 0);
      }
      return { projects: projects.length, tabs, panels };
    });
  }
}
