import {
  WORKSPACE_LOAD_METHOD,
  WORKSPACE_SAVE_METHOD,
  WORKSPACE_LOAD_SUBS_METHOD,
  WORKSPACE_PERSIST_SUBS_METHOD,
  WORKSPACE_SUMMARY_METHOD,
  WORKSPACE_FOLLOW_MOVES_METHOD,
  WORKSPACE_SAVE_SUB_METHOD,
  WORKSPACE_DELETE_SUBS_METHOD,
  JSON_RPC_INVALID_PARAMS,
  type WorkspaceFollowMovesParams,
  type WorkspaceFollowMovesResult,
} from '@throng/ipc-contract';
import {
  validateMainLayout,
  migratePanelTitles,
  countPanels,
  moveLayoutTabs,
  ProjectNotFoundError,
  type IProjectStore,
  type IUserContext,
  type IWorkspaceStore,
  type Panel,
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

    // 052 R3 — one record at a time, so no writer can put back a stale copy of a sibling (FR-005).
    router.register(WORKSPACE_SAVE_SUB_METHOD, (params) => {
      const sub = asObject(params).subWorkspace as SubWorkspace | undefined;
      if (!sub || typeof sub !== 'object' || typeof sub.id !== 'string' || !Array.isArray(sub.tabs)) {
        throw new RpcError('A "subWorkspace" record is required', JSON_RPC_INVALID_PARAMS);
      }
      this.deps.workspaceStore.saveSubWorkspace(this.owner, migratePanelTitles(sub));
      return { ok: true } as const;
    });

    router.register(WORKSPACE_DELETE_SUBS_METHOD, (params) => {
      const ids = asObject(params).ids;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
        throw new RpcError('"ids" must be an array of strings', JSON_RPC_INVALID_PARAMS);
      }
      return { ok: true, deleted: this.deps.workspaceStore.deleteSubWorkspaces(this.owner, ids as string[]) } as const;
    });

    router.register(WORKSPACE_FOLLOW_MOVES_METHOD, (params) => this.followMoves(params));

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

  /**
   * 052 R2 — after an in-app move, rewrite every layout no window holds (FR-001 – FR-004, FR-006, FR-009).
   *
   * Synchronous from first read to last write, inside one transaction: the daemon serves one request at a time, so
   * no save can land between this walk's read of a record and its write of it — the race that made the old
   * main-side walk able to lose a window's change, or have its own undone (FR-005).
   *
   * A record that cannot be read or written is left exactly as it was, counted in `skipped`, and logged once; it
   * never fails the walk, and the walk never fails the move (FR-009).
   */
  private followMoves(params: unknown): WorkspaceFollowMovesResult {
    const raw = asObject(params);
    const moves = raw.moves as WorkspaceFollowMovesParams['moves'] | undefined;
    const held = raw.held as WorkspaceFollowMovesParams['held'] | undefined;
    const only = raw.only as WorkspaceFollowMovesParams['only'] | undefined;
    if (!Array.isArray(moves) || !held || !Array.isArray(held.projectIds) || !Array.isArray(held.subWorkspaceIds)) {
      throw new RpcError('"moves" and "held" are required', JSON_RPC_INVALID_PARAMS);
    }
    const result: WorkspaceFollowMovesResult = { changedProjectIds: [], changedSubWorkspaceIds: [], skipped: 0 };
    if (moves.length === 0) return result;

    // `only` names the records to walk whatever `held` says (R4: a renderer's save that was in flight); otherwise
    // every record a window does not hold.
    const walks = (id: string, heldIds: readonly string[], onlyIds: readonly string[] | undefined): boolean =>
      only !== undefined ? (onlyIds ?? []).includes(id) : !heldIds.includes(id);
    const skip = (kind: string, id: string, why: unknown): void => {
      result.skipped += 1;
      console.warn(`[workspace] followMoves skipped ${kind} ${id}: ${why instanceof Error ? why.message : String(why)}`);
    };

    const store = this.deps.workspaceStore;
    const projectList = this.deps.projectStore.list(this.owner);
    const roots = new Map(projectList.map((p) => [p.id, p.rootFolder] as const));
    const rootOf = (fallbackProjectId: string | undefined) => (panel: Panel): string | undefined =>
      roots.get(panel.originProjectId) ?? (fallbackProjectId !== undefined ? roots.get(fallbackProjectId) : undefined);

    store.atomically(() => {
      for (const { id: projectId } of projectList) {
        if (!walks(projectId, held.projectIds, only?.projectIds)) continue;
        try {
          const loaded = store.load(this.owner, projectId);
          if (!loaded.restored) {
            // Never write a record that did not restore: saving would persist the default the store synthesised.
            if (loaded.reason === 'corrupt') skip('project', projectId, 'its saved layout could not be read');
            continue;
          }
          const layout = migratePanelTitles(loaded.layout);
          const tabs = moveLayoutTabs(layout.tabs, moves, rootOf(projectId));
          if (tabs === null) continue;
          store.save(this.owner, projectId, { ...layout, tabs });
          result.changedProjectIds.push(projectId);
        } catch (error) {
          skip('project', projectId, error);
        }
      }

      const corrupt = (id: string, error: unknown): void => {
        if (walks(id, held.subWorkspaceIds, only?.subWorkspaceIds)) skip('sub-workspace', id, error);
      };
      for (const sub of store.loadSubWorkspaces(this.owner, corrupt)) {
        if (!walks(sub.id, held.subWorkspaceIds, only?.subWorkspaceIds)) continue;
        try {
          const tabs = moveLayoutTabs(sub.tabs, moves, rootOf(undefined));
          if (tabs === null) continue;
          store.saveSubWorkspace(this.owner, migratePanelTitles({ ...sub, tabs }));
          result.changedSubWorkspaceIds.push(sub.id);
        } catch (error) {
          skip('sub-workspace', sub.id, error);
        }
      }
    });
    return result;
  }
}
